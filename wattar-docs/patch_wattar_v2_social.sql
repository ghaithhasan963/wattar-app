-- Wattar v2 social progression and agent groups.
-- Run after wattar_schema.sql and patch_social_foundation.sql.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS experience_points bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS level integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS game_points bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS game_points_initialized_at timestamptz,
  ADD COLUMN IF NOT EXISTS game_points_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS adult_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS anonymized_at timestamptz;

ALTER TABLE public.users ALTER COLUMN game_points SET DEFAULT 1000;
UPDATE public.users
SET game_points = 1000, game_points_initialized_at = now()
WHERE game_points_initialized_at IS NULL;
ALTER TABLE public.users ALTER COLUMN game_points_initialized_at SET DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_progress_non_negative'
      AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_progress_non_negative
      CHECK (experience_points >= 0 AND level >= 1 AND game_points >= 0);
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.user_follows (
  follower_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  followed_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followed_id),
  CONSTRAINT user_follow_not_self CHECK (follower_id <> followed_id)
);
CREATE INDEX IF NOT EXISTS idx_user_follows_followed
  ON public.user_follows (followed_id, created_at DESC);
ALTER TABLE public.user_follows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_follows FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.progress_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  event_key varchar(160) NOT NULL UNIQUE,
  event_type varchar(40) NOT NULL
    CHECK (event_type IN ('daily_login', 'room_participation', 'gift_received', 'story_post', 'social_engagement')),
  points integer NOT NULL CHECK (points BETWEEN 1 AND 10000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_progress_events_user_created
  ON public.progress_events (user_id, created_at DESC);
ALTER TABLE public.progress_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.progress_events FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.game_points_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('daily_grant', 'stake', 'payout')),
  amount bigint NOT NULL CHECK (amount <> 0),
  balance_before bigint NOT NULL CHECK (balance_before >= 0),
  balance_after bigint NOT NULL CHECK (balance_after >= 0 AND balance_after = balance_before + amount),
  idempotency_key text NOT NULL,
  game_bet_id uuid REFERENCES public.game_bets(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT game_points_ledger_idempotency UNIQUE (user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_game_points_ledger_user_time
  ON public.game_points_ledger (user_id, created_at DESC);
ALTER TABLE public.game_points_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.game_points_ledger FROM anon, authenticated;

ALTER TABLE public.game_bets ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE public.game_bets ADD COLUMN IF NOT EXISTS request_data jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS idx_game_bets_user_idempotency
  ON public.game_bets (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.play_game_with_points(
  p_user_id uuid,
  p_game_type public.game_type,
  p_idempotency_key text,
  p_request_data jsonb,
  p_bet_amount bigint,
  p_bet_data jsonb,
  p_result jsonb,
  p_payout bigint,
  p_multiplier numeric,
  p_is_win boolean,
  p_forced_outcome text,
  p_rtp numeric,
  p_room_id uuid,
  p_seed text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user public.users%ROWTYPE;
  v_existing public.game_bets%ROWTYPE;
  v_round_id uuid;
  v_bet_id uuid;
  v_after_stake bigint;
  v_after_payout bigint;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'غير مصرح بتنفيذ اللعبة';
  END IF;
  IF p_user_id IS NULL OR p_game_type IS NULL OR p_request_data IS NULL
     OR p_bet_data IS NULL OR p_result IS NULL
     OR p_is_win IS NULL OR p_multiplier IS NULL OR p_rtp IS NULL OR p_seed IS NULL
     OR p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9._:-]{10,100}$'
     OR p_bet_amount IS NULL OR p_payout IS NULL
     OR p_bet_amount < 1 OR p_bet_amount > 1000000
     OR p_payout < 0 OR p_payout > p_bet_amount * 1000
     OR p_multiplier < 0 OR p_multiplier > 1000
     OR p_rtp < 0 OR p_rtp > 100
     OR (p_forced_outcome IS NOT NULL AND p_forced_outcome NOT IN ('win', 'lose')) THEN
    RAISE EXCEPTION 'بيانات الجولة غير صالحة';
  END IF;

  SELECT * INTO v_user FROM public.users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND OR v_user.status <> 'active' OR v_user.adult_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'الحساب غير متاح أو لم يؤكد العمر';
  END IF;

  SELECT * INTO v_existing FROM public.game_bets
  WHERE user_id = p_user_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.game_type <> p_game_type OR v_existing.bet_amount <> p_bet_amount
       OR v_existing.request_data <> p_request_data THEN
      RAISE EXCEPTION 'مفتاح منع التكرار مستخدم لطلب مختلف';
    END IF;
    RETURN jsonb_build_object(
      'round_id', v_existing.round_id,
      'bet_id', v_existing.id,
      'result', (SELECT r.result FROM public.game_rounds r WHERE r.id = v_existing.round_id),
      'is_win', v_existing.is_win,
      'multiplier', v_existing.multiplier,
      'payout', v_existing.payout,
      'forced_outcome', v_existing.forced_outcome,
      'balance_after', v_user.game_points
    );
  END IF;
  IF v_user.game_points < p_bet_amount THEN
    RAISE EXCEPTION 'رصيد النقاط غير كافٍ';
  END IF;

  v_after_stake := v_user.game_points - p_bet_amount;
  v_after_payout := v_after_stake + p_payout;
  INSERT INTO public.game_rounds (
    game_type, room_id, seed, result, crash_point,
    total_bets, total_bet_gold, total_payout, rtp_applied,
    ended_at, metadata
  ) VALUES (
    p_game_type, p_room_id, p_seed, p_result, (p_result->>'crash_point')::numeric,
    1, p_bet_amount, p_payout, p_rtp, now(), '{"currency":"game_points"}'::jsonb
  ) RETURNING id INTO v_round_id;

  INSERT INTO public.game_bets (
    round_id, user_id, game_type, bet_amount, bet_data, payout,
    multiplier, is_win, forced_outcome, settled_at, idempotency_key, request_data
  ) VALUES (
    v_round_id, p_user_id, p_game_type, p_bet_amount, coalesce(p_bet_data, '{}'::jsonb),
    p_payout, p_multiplier, p_is_win, p_forced_outcome, now(), p_idempotency_key, p_request_data
  ) RETURNING id INTO v_bet_id;

  UPDATE public.users SET
    game_points = v_after_payout,
    is_force_win = CASE WHEN p_forced_outcome IS NOT NULL THEN false ELSE is_force_win END,
    is_force_lose = CASE WHEN p_forced_outcome IS NOT NULL THEN false ELSE is_force_lose END
  WHERE id = p_user_id;

  INSERT INTO public.game_points_ledger (
    user_id, event_type, amount, balance_before, balance_after, idempotency_key, game_bet_id
  ) VALUES (
    p_user_id, 'stake', -p_bet_amount, v_user.game_points, v_after_stake,
    p_idempotency_key || ':stake', v_bet_id
  );
  IF p_payout > 0 THEN
    INSERT INTO public.game_points_ledger (
      user_id, event_type, amount, balance_before, balance_after, idempotency_key, game_bet_id
    ) VALUES (
      p_user_id, 'payout', p_payout, v_after_stake, v_after_payout,
      p_idempotency_key || ':payout', v_bet_id
    );
  END IF;

  RETURN jsonb_build_object(
    'round_id', v_round_id,
    'bet_id', v_bet_id,
    'result', p_result,
    'is_win', p_is_win,
    'multiplier', p_multiplier,
    'payout', p_payout,
    'forced_outcome', p_forced_outcome,
    'balance_after', v_after_payout
  );
END;
$$;
REVOKE ALL ON FUNCTION public.play_game_with_points(
  uuid, public.game_type, text, jsonb, bigint, jsonb, jsonb, bigint, numeric, boolean, text, numeric, uuid, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.play_game_with_points(
  uuid, public.game_type, text, jsonb, bigint, jsonb, jsonb, bigint, numeric, boolean, text, numeric, uuid, text
) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_daily_game_points()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user public.users%ROWTYPE;
  v_award bigint;
  v_key text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  SELECT * INTO v_user FROM public.users WHERE id = auth.uid() FOR UPDATE;
  IF NOT FOUND OR v_user.status <> 'active' OR v_user.adult_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'الحساب غير متاح أو لم يؤكد العمر';
  END IF;
  IF v_user.game_points_claimed_at > now() - interval '24 hours' THEN
    RETURN jsonb_build_object('claimed', false, 'balance', v_user.game_points);
  END IF;
  v_award := least(1000, greatest(0, 5000 - v_user.game_points));
  IF v_award = 0 THEN
    RETURN jsonb_build_object('claimed', false, 'balance', v_user.game_points, 'at_cap', true);
  END IF;
  v_key := 'daily-grant:' || auth.uid()::text || ':' || gen_random_uuid()::text;
  UPDATE public.users SET
    game_points = game_points + v_award,
    game_points_claimed_at = now()
  WHERE id = auth.uid();
  INSERT INTO public.game_points_ledger (
    user_id, event_type, amount, balance_before, balance_after, idempotency_key
  ) VALUES (
    auth.uid(), 'daily_grant', v_award, v_user.game_points, v_user.game_points + v_award, v_key
  );
  RETURN jsonb_build_object('claimed', true, 'granted', v_award, 'balance', v_user.game_points + v_award);
END;
$$;
REVOKE ALL ON FUNCTION public.claim_daily_game_points() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_daily_game_points() TO authenticated;

CREATE TABLE IF NOT EXISTS public.stories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  media_path text NOT NULL UNIQUE,
  media_type text NOT NULL CHECK (media_type IN ('image', 'video')),
  caption varchar(160) NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  CONSTRAINT story_expiry_window CHECK (expires_at > created_at AND expires_at <= created_at + interval '24 hours')
);
CREATE INDEX IF NOT EXISTS idx_stories_active_time
  ON public.stories (expires_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stories_user_time
  ON public.stories (user_id, created_at DESC);
ALTER TABLE public.stories ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stories FROM anon, authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'wattar-stories',
  'wattar-stories',
  false,
  20971520,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 20971520,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE OR REPLACE FUNCTION public.wattar_can_read_story_object(p_path text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.stories s
    JOIN public.users u ON u.id = s.user_id
    WHERE s.media_path = p_path
      AND s.expires_at > now()
      AND u.status = 'active'
      AND u.adult_confirmed_at IS NOT NULL
  );
$$;
REVOKE ALL ON FUNCTION public.wattar_can_read_story_object(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wattar_can_read_story_object(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.wattar_can_manage_story_object(p_path text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL
    AND split_part(p_path, '/', 1) = auth.uid()::text
    AND EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.status = 'active' AND u.adult_confirmed_at IS NOT NULL
    );
$$;
REVOKE ALL ON FUNCTION public.wattar_can_manage_story_object(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wattar_can_manage_story_object(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.wattar_can_upload_story_object(p_path text)
RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.wattar_can_manage_story_object(p_path)
    AND (
      SELECT count(*) < 10
      FROM storage.objects o
      WHERE o.bucket_id = 'wattar-stories'
        AND split_part(o.name, '/', 1) = auth.uid()::text
        AND o.created_at > now() - interval '24 hours'
    );
$$;
REVOKE ALL ON FUNCTION public.wattar_can_upload_story_object(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wattar_can_upload_story_object(text) TO authenticated;

DROP POLICY IF EXISTS wattar_story_media_insert ON storage.objects;
CREATE POLICY wattar_story_media_insert
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'wattar-stories'
    AND public.wattar_can_upload_story_object(name)
  );
DROP POLICY IF EXISTS wattar_story_media_read ON storage.objects;
CREATE POLICY wattar_story_media_read
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'wattar-stories'
    AND public.wattar_can_read_story_object(name)
  );
DROP POLICY IF EXISTS wattar_story_media_delete ON storage.objects;
CREATE POLICY wattar_story_media_delete
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'wattar-stories'
    AND public.wattar_can_manage_story_object(name)
  );

CREATE OR REPLACE FUNCTION public.create_my_story(
  p_media_path text,
  p_media_type text,
  p_caption text DEFAULT ''
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_story_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.wattar_can_manage_story_object(p_media_path) THEN
    RAISE EXCEPTION 'غير مصرح بإنشاء القصة';
  END IF;
  PERFORM 1 FROM public.users u
  WHERE u.id = auth.uid() AND u.status = 'active' AND u.adult_confirmed_at IS NOT NULL
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الحساب غير متاح'; END IF;
  IF p_media_type NOT IN ('image', 'video')
     OR p_caption IS NULL OR length(p_caption) > 160
     OR NOT EXISTS (
       SELECT 1 FROM storage.objects o
       WHERE o.bucket_id = 'wattar-stories' AND o.name = p_media_path
     ) THEN
    RAISE EXCEPTION 'بيانات القصة أو ملفها غير صالح';
  END IF;
  IF (
    SELECT count(*) FROM public.stories s
    WHERE s.user_id = auth.uid() AND s.created_at > now() - interval '24 hours'
  ) >= 10 THEN
    RAISE EXCEPTION 'وصلت إلى الحد اليومي للقصص';
  END IF;

  INSERT INTO public.stories (user_id, media_path, media_type, caption, expires_at)
  VALUES (auth.uid(), p_media_path, p_media_type, trim(p_caption), now() + interval '24 hours')
  RETURNING id INTO v_story_id;
  RETURN v_story_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_my_story(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_my_story(text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_active_stories()
RETURNS TABLE (
  story_id uuid,
  user_id uuid,
  username varchar,
  display_name varchar,
  avatar_url text,
  caption varchar,
  media_path text,
  media_type text,
  created_at timestamptz,
  expires_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.status = 'active' AND u.adult_confirmed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول وتأكيد العمر';
  END IF;
  RETURN QUERY
  SELECT s.id, s.user_id, u.username, u.display_name, u.avatar_url,
         s.caption, s.media_path, s.media_type, s.created_at, s.expires_at
  FROM public.stories s
  JOIN public.users u ON u.id = s.user_id
  WHERE s.expires_at > now() AND u.status = 'active'
  ORDER BY s.created_at DESC
  LIMIT 50;
END;
$$;
REVOKE ALL ON FUNCTION public.list_active_stories() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_active_stories() TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_my_story(p_story_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_media_path text;
BEGIN
  DELETE FROM public.stories
  WHERE id = p_story_id AND user_id = auth.uid()
  RETURNING media_path INTO v_media_path;
  IF NOT FOUND THEN RAISE EXCEPTION 'القصة غير موجودة أو لا تملك صلاحية حذفها'; END IF;
  RETURN v_media_path;
END;
$$;
REVOKE ALL ON FUNCTION public.delete_my_story(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_my_story(uuid) TO authenticated;

CREATE TABLE IF NOT EXISTS public.agent_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL UNIQUE REFERENCES public.agents(id) ON DELETE RESTRICT,
  name varchar(80) NOT NULL DEFAULT 'مجموعة الوكيل',
  description varchar(500),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.agent_group_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.agent_groups(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'rejected', 'left', 'transferred')),
  muted_until timestamptz,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by uuid REFERENCES public.users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_group_memberships_pending
  ON public.agent_group_memberships (user_id, group_id) WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_group_memberships_one_active
  ON public.agent_group_memberships (user_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_agent_group_memberships_group_status
  ON public.agent_group_memberships (group_id, status, requested_at DESC);
ALTER TABLE public.agent_group_memberships ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_group_memberships FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.agent_group_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.agent_groups(id) ON DELETE RESTRICT,
  sender_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  body text NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_group_messages_group_time
  ON public.agent_group_messages (group_id, created_at DESC);
ALTER TABLE public.agent_group_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_group_messages FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.agent_group_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.agent_groups(id) ON DELETE RESTRICT,
  reporter_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  message_id uuid REFERENCES public.agent_group_messages(id) ON DELETE SET NULL,
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 500),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_group_reports_created
  ON public.agent_group_reports (created_at DESC);
ALTER TABLE public.agent_group_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_group_reports FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.ensure_agent_group()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.agent_groups (agent_id)
  VALUES (NEW.id)
  ON CONFLICT (agent_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ensure_agent_group ON public.agents;
CREATE TRIGGER trg_ensure_agent_group
  AFTER INSERT ON public.agents
  FOR EACH ROW EXECUTE FUNCTION public.ensure_agent_group();

INSERT INTO public.agent_groups (agent_id)
SELECT a.id FROM public.agents a
ON CONFLICT (agent_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.confirm_my_adult_status(p_is_18_or_older boolean)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_confirmed_at timestamptz;
BEGIN
  IF auth.uid() IS NULL OR p_is_18_or_older IS NOT TRUE THEN
    RAISE EXCEPTION 'يجب أن يكون المستخدم بعمر 18 عامًا أو أكثر';
  END IF;
  UPDATE public.users
  SET adult_confirmed_at = coalesce(adult_confirmed_at, now())
  WHERE id = auth.uid() AND status = 'active'
  RETURNING adult_confirmed_at INTO v_confirmed_at;
  IF NOT FOUND THEN RAISE EXCEPTION 'الحساب غير متاح'; END IF;
  RETURN v_confirmed_at;
END;
$$;
REVOKE ALL ON FUNCTION public.confirm_my_adult_status(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_my_adult_status(boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.require_wattar_adult_confirmation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.users u
       WHERE u.id = auth.uid() AND u.status = 'active' AND u.adult_confirmed_at IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'يجب تأكيد أن عمرك 18 عامًا أو أكثر';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.require_wattar_adult_confirmation() FROM PUBLIC;

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'friend_requests', 'user_blocks', 'user_reports',
    'private_conversations', 'private_messages', 'room_invitations',
    'room_messages', 'room_seats', 'game_challenges', 'game_challenge_players',
    'user_follows', 'agent_group_memberships', 'agent_group_messages', 'agent_group_reports',
    'game_bets', 'stories'
  ] LOOP
    IF to_regclass(format('public.%I', v_table)) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_wattar_adult_confirmation ON public.%I', v_table);
      EXECUTE format(
        'CREATE TRIGGER trg_wattar_adult_confirmation
         BEFORE INSERT OR UPDATE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.require_wattar_adult_confirmation()',
        v_table
      );
    END IF;
  END LOOP;
END;
$$;

INSERT INTO public.agent_group_memberships (group_id, user_id, status, decided_at)
SELECT g.id, u.id, 'active', now()
FROM public.users u
JOIN public.agent_groups g ON g.agent_id = u.referred_by_agent_id
JOIN public.agents a ON a.id = g.agent_id AND a.status = 'active'
WHERE u.status = 'active'
ON CONFLICT DO NOTHING;

UPDATE public.agents a
SET total_users = (
  SELECT count(*)::integer
  FROM public.agent_group_memberships m
  JOIN public.agent_groups g ON g.id = m.group_id
  WHERE g.agent_id = a.id AND m.status = 'active'
);

CREATE OR REPLACE FUNCTION public.follow_wattar_user(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR p_user_id IS NULL OR p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'المتابعة غير صالحة';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users u WHERE u.id = p_user_id AND u.status = 'active'
  ) THEN
    RAISE EXCEPTION 'المستخدم غير متاح';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.status = 'active'
  ) THEN
    RAISE EXCEPTION 'الحساب غير متاح';
  END IF;
  IF public.is_wattar_blocked_between(p_user_id) THEN
    RAISE EXCEPTION 'لا يمكن متابعة هذا المستخدم';
  END IF;
  INSERT INTO public.user_follows (follower_id, followed_id)
  VALUES (auth.uid(), p_user_id)
  ON CONFLICT DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION public.follow_wattar_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.follow_wattar_user(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.unfollow_wattar_user(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR p_user_id IS NULL OR p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'إلغاء المتابعة غير صالح';
  END IF;
  DELETE FROM public.user_follows
  WHERE follower_id = auth.uid() AND followed_id = p_user_id;
END;
$$;
REVOKE ALL ON FUNCTION public.unfollow_wattar_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unfollow_wattar_user(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_my_following()
RETURNS TABLE (
  user_id uuid,
  username text,
  display_name text,
  avatar_url text,
  is_online boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.id, u.username::text, u.display_name::text, u.avatar_url,
         coalesce(u.last_seen_at > now() - interval '5 minutes', false)
  FROM public.user_follows f
  JOIN public.users u ON u.id = f.followed_id
  WHERE f.follower_id = auth.uid()
    AND u.status = 'active'
    AND NOT public.is_wattar_blocked_between(u.id)
  ORDER BY f.created_at DESC
  LIMIT 500;
$$;
REVOKE ALL ON FUNCTION public.list_my_following() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_my_following() TO authenticated;

CREATE OR REPLACE FUNCTION public.list_my_followers()
RETURNS TABLE (
  user_id uuid,
  username text,
  display_name text,
  avatar_url text,
  is_online boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.id, u.username::text, u.display_name::text, u.avatar_url,
         coalesce(u.last_seen_at > now() - interval '5 minutes', false)
  FROM public.user_follows f
  JOIN public.users u ON u.id = f.follower_id
  WHERE f.followed_id = auth.uid()
    AND u.status = 'active'
    AND NOT public.is_wattar_blocked_between(u.id)
  ORDER BY f.created_at DESC
  LIMIT 500;
$$;
REVOKE ALL ON FUNCTION public.list_my_followers() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_my_followers() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_wattar_progress(p_user_id uuid DEFAULT NULL)
RETURNS TABLE (
  level integer,
  experience_points bigint,
  follower_count bigint,
  following_count bigint,
  is_following boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.level, u.experience_points,
         (SELECT count(*) FROM public.user_follows f
          JOIN public.users follower ON follower.id = f.follower_id AND follower.status = 'active'
          WHERE f.followed_id = u.id),
         (SELECT count(*) FROM public.user_follows f
          JOIN public.users followed ON followed.id = f.followed_id AND followed.status = 'active'
          WHERE f.follower_id = u.id),
         EXISTS (
           SELECT 1 FROM public.user_follows f
           WHERE f.follower_id = auth.uid() AND f.followed_id = u.id
         )
  FROM public.users u
  WHERE u.id = coalesce(p_user_id, auth.uid())
    AND u.status = 'active'
    AND auth.uid() IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.get_wattar_progress(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_wattar_progress(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.award_user_xp(
  p_user_id uuid,
  p_event_key text,
  p_event_type text,
  p_points integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_xp bigint;
  v_level integer;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_user_id IS NULL
     OR length(trim(coalesce(p_event_key, ''))) NOT BETWEEN 1 AND 160
     OR p_event_type NOT IN ('daily_login', 'room_participation', 'gift_received', 'story_post', 'social_engagement')
     OR p_points NOT BETWEEN 1 AND 10000 THEN
    RAISE EXCEPTION 'Invalid progress event';
  END IF;

  INSERT INTO public.progress_events (user_id, event_key, event_type, points)
  VALUES (p_user_id, p_event_key, p_event_type, p_points)
  ON CONFLICT (event_key) DO NOTHING;
  IF NOT FOUND THEN
    SELECT u.level INTO v_level FROM public.users u WHERE u.id = p_user_id;
    RETURN coalesce(v_level, 1);
  END IF;

  UPDATE public.users
  SET experience_points = experience_points + p_points,
      level = floor(sqrt((experience_points + p_points)::numeric / 100))::integer + 1
  WHERE id = p_user_id AND status = 'active'
  RETURNING experience_points, level INTO v_xp, v_level;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found or inactive';
  END IF;
  RETURN v_level;
END;
$$;
REVOKE ALL ON FUNCTION public.award_user_xp(uuid, text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.award_user_xp(uuid, text, text, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.award_user_xp(uuid, text, text, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.request_agent_group_membership(p_agent_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_group_id uuid;
  v_membership_id uuid;
BEGIN
  IF auth.uid() IS NULL OR p_agent_id IS NULL THEN
    RAISE EXCEPTION 'طلب الانضمام غير صالح';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.status = 'active'
  ) THEN
    RAISE EXCEPTION 'الحساب غير متاح';
  END IF;
  SELECT g.id INTO v_group_id
  FROM public.agent_groups g
  JOIN public.agents a ON a.id = g.agent_id
  WHERE a.id = p_agent_id AND a.status = 'active';
  IF v_group_id IS NULL THEN
    RAISE EXCEPTION 'الوكيل غير متاح';
  END IF;
  IF public.is_wattar_blocked_between((
    SELECT a.user_id FROM public.agents a WHERE a.id = p_agent_id
  )) THEN
    RAISE EXCEPTION 'لا يمكن طلب الانضمام إلى هذه المجموعة';
  END IF;
  SELECT m.id INTO v_membership_id
  FROM public.agent_group_memberships m
  WHERE m.user_id = auth.uid() AND m.group_id = v_group_id AND m.status = 'active';
  IF v_membership_id IS NOT NULL THEN
    RETURN v_membership_id;
  END IF;
  v_membership_id := NULL;

  INSERT INTO public.agent_group_memberships (group_id, user_id, status)
  VALUES (v_group_id, auth.uid(), 'pending')
  ON CONFLICT (user_id, group_id) WHERE status = 'pending' DO NOTHING
  RETURNING id INTO v_membership_id;

  IF v_membership_id IS NULL THEN
    SELECT m.id INTO v_membership_id
    FROM public.agent_group_memberships m
    WHERE m.user_id = auth.uid() AND m.group_id = v_group_id
      AND m.status IN ('pending', 'active')
    ORDER BY m.requested_at DESC LIMIT 1;
  END IF;
  RETURN v_membership_id;
END;
$$;
REVOKE ALL ON FUNCTION public.request_agent_group_membership(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_agent_group_membership(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_available_agent_groups()
RETURNS TABLE (
  group_id uuid,
  agent_id uuid,
  agent_name text,
  group_name text,
  membership_id uuid,
  membership_status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT g.id, a.id, coalesce(u.display_name, u.username)::text,
         g.name::text, m.id, m.status
  FROM public.agent_groups g
  JOIN public.agents a ON a.id = g.agent_id AND a.status = 'active'
  JOIN public.users u ON u.id = a.user_id AND u.status = 'active'
  LEFT JOIN public.agent_group_memberships m
    ON m.group_id = g.id AND m.user_id = auth.uid()
    AND m.status IN ('pending', 'active')
  WHERE auth.uid() IS NOT NULL
  ORDER BY (m.status = 'active') DESC NULLS LAST, g.created_at DESC
  LIMIT 100;
$$;
REVOKE ALL ON FUNCTION public.list_available_agent_groups() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_available_agent_groups() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_wallet_access()
RETURNS TABLE (
  allowed boolean,
  agent_id uuid,
  agent_name text,
  group_id uuid,
  group_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT true, access.agent_id, access.agent_name, access.group_id, access.group_name
  FROM (
    SELECT a.id AS agent_id,
           coalesce(agent_user.display_name, agent_user.username)::text AS agent_name,
           g.id AS group_id, g.name::text AS group_name,
           m.decided_at AS access_at
    FROM public.agent_group_memberships m
    JOIN public.agent_groups g ON g.id = m.group_id
    JOIN public.agents a ON a.id = g.agent_id AND a.status = 'active'
    JOIN public.users agent_user ON agent_user.id = a.user_id
    JOIN public.users member ON member.id = m.user_id AND member.status = 'active'
    WHERE m.user_id = auth.uid() AND m.status = 'active'
    UNION ALL
    SELECT a.id,
           coalesce(agent_user.display_name, agent_user.username)::text,
           g.id, g.name::text, a.created_at
    FROM public.agents a
    JOIN public.agent_groups g ON g.agent_id = a.id
    JOIN public.users agent_user ON agent_user.id = a.user_id AND agent_user.status = 'active'
    WHERE a.user_id = auth.uid() AND a.status = 'active'
  ) access
  WHERE auth.uid() IS NOT NULL
  ORDER BY access.access_at DESC NULLS LAST
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.get_my_wallet_access() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_wallet_access() TO authenticated;

CREATE OR REPLACE FUNCTION public.review_agent_group_membership(
  p_membership_id uuid,
  p_accept boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_membership public.agent_group_memberships%ROWTYPE;
  v_group public.agent_groups%ROWTYPE;
  v_agent public.agents%ROWTYPE;
  v_old_agent_id uuid;
BEGIN
  IF p_accept IS NULL THEN RAISE EXCEPTION 'قرار المراجعة مطلوب'; END IF;
  SELECT m.* INTO v_membership
  FROM public.agent_group_memberships m
  WHERE m.id = p_membership_id AND m.status = 'pending'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'طلب الانضمام غير موجود أو تمت معالجته'; END IF;

  SELECT g.* INTO v_group FROM public.agent_groups g
  WHERE g.id = v_membership.group_id FOR UPDATE;
  SELECT a.* INTO v_agent FROM public.agents a
  WHERE a.id = v_group.agent_id;

  IF NOT public.is_admin() AND v_agent.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'غير مصرح بمراجعة هذا الطلب';
  END IF;
  IF p_accept AND v_agent.status <> 'active' THEN
    RAISE EXCEPTION 'الوكيل غير نشط';
  END IF;

  IF p_accept THEN
    PERFORM 1 FROM public.users u
    WHERE u.id = v_membership.user_id AND u.status = 'active'
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'الحساب غير متاح'; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.agent_group_memberships m
      WHERE m.id = p_membership_id AND m.status = 'pending'
    ) THEN
      RAISE EXCEPTION 'تمت معالجة الطلب بالفعل';
    END IF;
    SELECT a.id INTO v_old_agent_id
    FROM public.agent_group_memberships m
    JOIN public.agent_groups g ON g.id = m.group_id
    JOIN public.agents a ON a.id = g.agent_id
    WHERE m.user_id = v_membership.user_id AND m.status = 'active'
    LIMIT 1;
    PERFORM 1
    FROM public.agents a
    WHERE a.id IN (v_old_agent_id, v_group.agent_id)
    ORDER BY a.id
    FOR UPDATE;
    SELECT a.* INTO v_agent
    FROM public.agents a
    WHERE a.id = v_group.agent_id;
    IF v_agent.status <> 'active' THEN RAISE EXCEPTION 'الوكيل غير نشط'; END IF;
    IF (
      SELECT count(*) FROM public.agent_group_memberships m
      WHERE m.group_id = v_group.id AND m.status = 'active'
    ) >= v_agent.max_users
    AND NOT EXISTS (
      SELECT 1 FROM public.agent_group_memberships m
      WHERE m.group_id = v_group.id AND m.user_id = v_membership.user_id AND m.status = 'active'
    ) THEN
      RAISE EXCEPTION 'وصلت المجموعة إلى الحد الأقصى';
    END IF;
    UPDATE public.agent_group_memberships
    SET status = 'transferred', decided_at = now(), decided_by = auth.uid()
    WHERE user_id = v_membership.user_id AND status = 'active';
    UPDATE public.agent_group_memberships
    SET status = 'active', decided_at = now(), decided_by = auth.uid()
    WHERE id = p_membership_id;
    UPDATE public.users SET referred_by_agent_id = v_agent.id
    WHERE id = v_membership.user_id;
    UPDATE public.agents a
    SET total_users = (
      SELECT count(*)::integer
      FROM public.agent_group_memberships m
      JOIN public.agent_groups g ON g.id = m.group_id
      WHERE g.agent_id = a.id AND m.status = 'active'
    )
    WHERE a.id IN (v_old_agent_id, v_agent.id);
  ELSE
    UPDATE public.agent_group_memberships
    SET status = 'rejected', decided_at = now(), decided_by = auth.uid()
    WHERE id = p_membership_id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.review_agent_group_membership(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_agent_group_membership(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_my_agent_groups()
RETURNS TABLE (
  group_id uuid,
  agent_id uuid,
  agent_name text,
  group_name text,
  membership_id uuid,
  membership_status text,
  is_agent boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT g.id, a.id, coalesce(u.display_name, u.username)::text,
         g.name::text, m.id, m.status,
         (a.user_id = auth.uid())
  FROM public.agent_groups g
  JOIN public.agents a ON a.id = g.agent_id
  JOIN public.users u ON u.id = a.user_id
  LEFT JOIN public.agent_group_memberships m
    ON m.group_id = g.id AND m.user_id = auth.uid()
    AND m.status IN ('pending', 'active')
  WHERE auth.uid() IS NOT NULL
    AND (
      a.user_id = auth.uid()
      OR m.user_id = auth.uid()
    )
  ORDER BY m.requested_at DESC NULLS LAST;
$$;
REVOKE ALL ON FUNCTION public.list_my_agent_groups() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_my_agent_groups() TO authenticated;

CREATE OR REPLACE FUNCTION public.list_agent_group_members(p_group_id uuid)
RETURNS TABLE (
  membership_id uuid,
  user_id uuid,
  username text,
  display_name text,
  avatar_url text,
  membership_status text,
  requested_at timestamptz,
  muted_until timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.agent_groups g
      JOIN public.agents a ON a.id = g.agent_id
      WHERE g.id = p_group_id AND a.user_id = auth.uid()
    )
  ) THEN
    RAISE EXCEPTION 'غير مصرح بعرض أعضاء المجموعة';
  END IF;
  RETURN QUERY
  SELECT m.id, u.id, u.username::text, u.display_name::text, u.avatar_url,
         m.status, m.requested_at, m.muted_until
  FROM public.agent_group_memberships m
  JOIN public.users u ON u.id = m.user_id
  WHERE m.group_id = p_group_id
  ORDER BY CASE m.status WHEN 'pending' THEN 0 WHEN 'active' THEN 1 ELSE 2 END,
           m.requested_at DESC
  LIMIT 500;
END;
$$;
REVOKE ALL ON FUNCTION public.list_agent_group_members(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_agent_group_members(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_agent_group_messages(
  p_group_id uuid,
  p_before timestamptz DEFAULT NULL
)
RETURNS TABLE (
  message_id uuid,
  sender_id uuid,
  sender_name text,
  sender_avatar text,
  body text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT msg.id, msg.sender_id,
         coalesce(u.display_name, u.username)::text, u.avatar_url,
         msg.body, msg.created_at
  FROM public.agent_group_messages msg
  JOIN public.users u ON u.id = msg.sender_id
  WHERE msg.group_id = p_group_id
    AND (p_before IS NULL OR msg.created_at < p_before)
    AND (
      EXISTS (
        SELECT 1 FROM public.agent_group_memberships m
        WHERE m.group_id = msg.group_id AND m.user_id = auth.uid() AND m.status = 'active'
      )
      OR EXISTS (
        SELECT 1 FROM public.agent_groups g
        JOIN public.agents a ON a.id = g.agent_id
        WHERE g.id = msg.group_id AND a.user_id = auth.uid()
      )
    )
    AND NOT public.is_wattar_blocked_between(msg.sender_id)
  ORDER BY msg.created_at DESC
  LIMIT 100;
$$;
REVOKE ALL ON FUNCTION public.list_agent_group_messages(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_agent_group_messages(uuid, timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.send_agent_group_message(p_body text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_group_id uuid;
  v_message_id uuid;
  v_agent_id uuid;
BEGIN
  IF auth.uid() IS NULL OR length(trim(coalesce(p_body, ''))) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'الرسالة غير صالحة';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.status = 'active'
  ) THEN
    RAISE EXCEPTION 'الحساب غير متاح';
  END IF;
  SELECT g.id, a.user_id INTO v_group_id, v_agent_id
  FROM public.agent_groups g JOIN public.agents a ON a.id = g.agent_id
  WHERE a.user_id = auth.uid() AND a.status = 'active'
  LIMIT 1;
  IF v_group_id IS NULL THEN
    SELECT g.id, a.user_id INTO v_group_id, v_agent_id
    FROM public.agent_group_memberships m
    JOIN public.agent_groups g ON g.id = m.group_id
    JOIN public.agents a ON a.id = g.agent_id
    WHERE m.user_id = auth.uid() AND m.status = 'active' AND a.status = 'active'
    LIMIT 1;
  END IF;
  IF v_group_id IS NULL THEN RAISE EXCEPTION 'لا يوجد لديك مجموعة نشطة'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.agent_group_memberships m
    WHERE m.group_id = v_group_id AND m.user_id = auth.uid()
      AND m.status = 'active' AND m.muted_until > now()
  ) THEN
    RAISE EXCEPTION 'تم كتمك مؤقتًا في المجموعة';
  END IF;
  IF public.is_wattar_blocked_between(v_agent_id) THEN
    RAISE EXCEPTION 'لا يمكنك إرسال رسالة لهذه المجموعة';
  END IF;
  INSERT INTO public.agent_group_messages (group_id, sender_id, body)
  VALUES (v_group_id, auth.uid(), trim(p_body))
  RETURNING id INTO v_message_id;
  RETURN v_message_id;
END;
$$;
REVOKE ALL ON FUNCTION public.send_agent_group_message(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_agent_group_message(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.moderate_agent_group_member(
  p_membership_id uuid,
  p_action text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_group_id uuid;
  v_user_id uuid;
  v_agent_id uuid;
BEGIN
  IF p_action NOT IN ('mute', 'unmute', 'remove') THEN
    RAISE EXCEPTION 'إجراء الإشراف غير صالح';
  END IF;
  SELECT m.group_id, m.user_id, a.id INTO v_group_id, v_user_id, v_agent_id
  FROM public.agent_group_memberships m
  JOIN public.agent_groups g ON g.id = m.group_id
  JOIN public.agents a ON a.id = g.agent_id
  WHERE m.id = p_membership_id AND m.status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'عضوية المجموعة غير موجودة'; END IF;
  IF NOT public.is_admin() AND NOT EXISTS (
    SELECT 1 FROM public.agent_groups g
    JOIN public.agents a ON a.id = g.agent_id
    WHERE g.id = v_group_id AND a.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'غير مصرح بإدارة أعضاء المجموعة';
  END IF;
  PERFORM 1 FROM public.users u WHERE u.id = v_user_id FOR UPDATE;
  SELECT m.group_id INTO v_group_id
  FROM public.agent_group_memberships m
  WHERE m.id = p_membership_id AND m.status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'تم تحديث العضوية بالفعل'; END IF;
  UPDATE public.agent_group_memberships
  SET muted_until = CASE
        WHEN p_action = 'mute' THEN now() + interval '24 hours'
        WHEN p_action = 'unmute' THEN NULL
        ELSE muted_until
      END,
      status = CASE WHEN p_action = 'remove' THEN 'left' ELSE status END,
      decided_at = CASE WHEN p_action = 'remove' THEN now() ELSE decided_at END,
      decided_by = CASE WHEN p_action = 'remove' THEN auth.uid() ELSE decided_by END
  WHERE id = p_membership_id;
  IF p_action = 'remove' THEN
    UPDATE public.users
    SET referred_by_agent_id = NULL
    WHERE id = v_user_id AND referred_by_agent_id = v_agent_id;
    UPDATE public.agents a
    SET total_users = (
      SELECT count(*)::integer
      FROM public.agent_group_memberships m
      JOIN public.agent_groups g ON g.id = m.group_id
      WHERE g.agent_id = a.id AND m.status = 'active'
    )
    WHERE a.id = v_agent_id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.moderate_agent_group_member(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.moderate_agent_group_member(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.report_agent_group_message(
  p_message_id uuid,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_group_id uuid;
  v_report_id uuid;
BEGIN
  IF auth.uid() IS NULL OR length(trim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'البلاغ غير صالح';
  END IF;
  SELECT msg.group_id INTO v_group_id
  FROM public.agent_group_messages msg
  WHERE msg.id = p_message_id;
  IF v_group_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.agent_group_memberships m
    WHERE m.group_id = v_group_id AND m.user_id = auth.uid() AND m.status = 'active'
  ) THEN
    RAISE EXCEPTION 'الرسالة غير متاحة للإبلاغ';
  END IF;
  INSERT INTO public.agent_group_reports (group_id, reporter_id, message_id, reason)
  VALUES (v_group_id, auth.uid(), p_message_id, trim(p_reason))
  RETURNING id INTO v_report_id;
  RETURN v_report_id;
END;
$$;
REVOKE ALL ON FUNCTION public.report_agent_group_message(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.report_agent_group_message(uuid, text) TO authenticated;

DROP POLICY IF EXISTS wattar_agent_group_reports_admin_read
  ON public.agent_group_reports;
CREATE POLICY wattar_agent_group_reports_admin_read
  ON public.agent_group_reports FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE TABLE IF NOT EXISTS public.account_cleanup_storage (
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  bucket_id text NOT NULL,
  object_path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, bucket_id, object_path)
);
ALTER TABLE public.account_cleanup_storage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_cleanup_storage FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_cleanup_storage TO service_role;

CREATE OR REPLACE FUNCTION public.anonymize_my_account(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user public.users%ROWTYPE;
  v_agent_id uuid;
  v_affected_agent_ids uuid[];
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'غير مصرح بحذف الحساب';
  END IF;
  SELECT * INTO v_user FROM public.users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الحساب غير موجود'; END IF;
  IF v_user.anonymized_at IS NOT NULL THEN RETURN; END IF;

  INSERT INTO public.account_cleanup_storage (user_id, bucket_id, object_path)
  SELECT p_user_id, o.bucket_id, o.name
  FROM storage.objects o
  WHERE (o.bucket_id IN ('avatars', 'wattar-stories')
         AND split_part(o.name, '/', 1) = p_user_id::text)
     OR (o.bucket_id = 'deposit-proofs'
         AND left(o.name, length('dep_' || p_user_id::text || '_')) = 'dep_' || p_user_id::text || '_')
  ON CONFLICT DO NOTHING;

  SELECT a.id INTO v_agent_id FROM public.agents a WHERE a.user_id = p_user_id;

  DELETE FROM public.stories WHERE user_id = p_user_id;
  SELECT array_agg(DISTINCT g.agent_id) INTO v_affected_agent_ids
  FROM public.agent_group_memberships m
  JOIN public.agent_groups g ON g.id = m.group_id
  WHERE m.user_id = p_user_id AND m.status = 'active';
  DELETE FROM public.agent_group_memberships WHERE user_id = p_user_id;
  UPDATE public.agents a
  SET total_users = (
    SELECT count(*)::integer
    FROM public.agent_group_memberships m
    JOIN public.agent_groups g ON g.id = m.group_id
    WHERE g.agent_id = a.id AND m.status = 'active'
  )
  WHERE a.id = ANY(coalesce(v_affected_agent_ids, ARRAY[]::uuid[]));
  DELETE FROM public.agent_group_reports WHERE reporter_id = p_user_id;
  UPDATE public.agent_group_messages SET body = 'رسالة محذوفة'
  WHERE sender_id = p_user_id;
  IF v_agent_id IS NOT NULL THEN
    UPDATE public.agent_group_memberships
    SET status = 'left', decided_at = now()
    WHERE group_id IN (SELECT id FROM public.agent_groups WHERE agent_id = v_agent_id)
      AND status IN ('pending', 'active');
    UPDATE public.agent_group_messages SET body = 'رسالة محذوفة'
    WHERE group_id IN (SELECT id FROM public.agent_groups WHERE agent_id = v_agent_id);
    UPDATE public.agent_groups SET name = 'مجموعة غير نشطة', description = NULL
    WHERE agent_id = v_agent_id;
    UPDATE public.users SET referred_by_agent_id = NULL WHERE referred_by_agent_id = v_agent_id;
    UPDATE public.agents SET status = 'blacklisted', total_users = 0, notes = NULL
    WHERE id = v_agent_id;
  END IF;

  DELETE FROM public.user_follows WHERE follower_id = p_user_id OR followed_id = p_user_id;
  DELETE FROM public.friend_requests WHERE requester_id = p_user_id OR recipient_id = p_user_id;
  DELETE FROM public.user_blocks WHERE blocker_id = p_user_id OR blocked_id = p_user_id;
  DELETE FROM public.user_reports WHERE reporter_id = p_user_id;
  DELETE FROM public.room_invitations WHERE sender_id = p_user_id OR recipient_id = p_user_id;
  DELETE FROM public.private_conversations
  WHERE user_one_id = p_user_id OR user_two_id = p_user_id;
  DELETE FROM public.game_challenges WHERE creator_id = p_user_id;
  DELETE FROM public.game_challenge_players WHERE user_id = p_user_id;
  DELETE FROM public.leaderboards WHERE user_id = p_user_id;
  DELETE FROM public.progress_events WHERE user_id = p_user_id;
  DELETE FROM public.game_points_ledger WHERE user_id = p_user_id;
  DELETE FROM public.push_tokens WHERE user_id = p_user_id;

  UPDATE public.game_challenges SET winner_id = NULL WHERE winner_id = p_user_id;
  UPDATE public.room_messages SET message = 'رسالة محذوفة' WHERE user_id = p_user_id;
  UPDATE public.room_seats
  SET user_id = NULL, status = 'empty', is_owner_seat = false, is_mic_on = false, joined_at = NULL
  WHERE user_id = p_user_id;
  UPDATE public.rooms
  SET name = 'غرفة مستخدم محذوف', description = NULL, cover_url = NULL,
      password = NULL, livekit_token = NULL, status = 'closed',
      listeners_count = 0, speakers_count = 0, ended_at = now()
  WHERE owner_id = p_user_id;
  UPDATE public.admin_settings SET updated_by = NULL WHERE updated_by = p_user_id;
  UPDATE public.support_tickets SET assigned_to = NULL WHERE assigned_to = p_user_id;
  UPDATE public.users SET referred_by_user_id = NULL WHERE referred_by_user_id = p_user_id;
  DELETE FROM public.otp_codes WHERE phone = v_user.phone;

  UPDATE public.deposits
  SET external_ref = '[removed]', proof_url = '[removed]',
      sender_phone = NULL, sender_name = NULL, usdt_tx_hash = NULL,
      usdt_from_address = NULL, metadata = '{}'::jsonb,
      rejected_reason = NULL, admin_notes = NULL,
      status = CASE WHEN status IN ('pending', 'reviewing') THEN 'cancelled'::public.tx_status ELSE status END
  WHERE user_id = p_user_id;
  UPDATE public.withdrawals
  SET external_ref = NULL, proof_url = NULL, usdt_address = NULL,
      sham_cash_phone = NULL, syriatel_phone = NULL, metadata = '{}'::jsonb,
      rejected_reason = NULL, admin_notes = NULL
  WHERE user_id = p_user_id;
  UPDATE public.support_tickets
  SET subject = 'طلب من حساب محذوف', description = 'تمت إزالة محتوى الطلب عند حذف الحساب.',
      metadata = '{}'::jsonb, status = 'closed'
  WHERE user_id = p_user_id;
  UPDATE public.transfers SET note = NULL
  WHERE from_user_id = p_user_id OR to_user_id = p_user_id;
  UPDATE public.gift_transactions SET message = NULL
  WHERE from_user_id = p_user_id OR to_user_id = p_user_id;
  UPDATE public.admin_audit_log
  SET ip_address = NULL, user_agent = NULL, metadata = '{}'::jsonb,
      "before" = NULL, "after" = NULL
  WHERE admin_id = p_user_id;

  UPDATE public.users SET
    username = 'deleted_' || substr(replace(p_user_id::text, '-', ''), 1, 24),
    display_name = 'مستخدم محذوف',
    avatar_url = NULL,
    bio = NULL,
    frame_url = NULL,
    background_url = NULL,
    banned_reason = NULL,
    banned_until = NULL,
    role = 'user',
    email = NULL,
    phone = NULL,
    oauth_google = NULL,
    oauth_facebook = NULL,
    oauth_apple = NULL,
    pin_code = NULL,
    referral_code = NULL,
    referred_by_agent_id = NULL,
    referred_by_user_id = NULL,
    fcm_token = NULL,
    last_seen_at = NULL,
    last_login_at = NULL,
    app_version = NULL,
    platform = NULL,
    daily_bonus_claimed_at = NULL,
    experience_points = 0,
    level = 1,
    game_points = 0,
    game_points_initialized_at = NULL,
    game_points_claimed_at = NULL,
    total_gifts_sent = 0,
    total_gifts_received = 0,
    status = 'blacklisted',
    adult_confirmed_at = NULL,
    anonymized_at = now()
  WHERE id = p_user_id;
END;
$$;
REVOKE ALL ON FUNCTION public.anonymize_my_account(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.anonymize_my_account(uuid) TO service_role;
