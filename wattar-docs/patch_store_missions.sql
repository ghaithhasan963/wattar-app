-- Daily missions reward non-purchasable game points and XP only.
-- Run after patch_wattar_v2_wallet_economy.sql and before patch_admin_audit_controls.sql.
BEGIN;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid()
      AND role IN ('admin', 'super_admin')
      AND status = 'active'
  );
$$;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

GRANT SELECT ON public.gifts TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.gifts TO authenticated;
DROP POLICY IF EXISTS gifts_admin_select ON public.gifts;
CREATE POLICY gifts_admin_select ON public.gifts
  FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS gifts_admin_insert ON public.gifts;
CREATE POLICY gifts_admin_insert ON public.gifts
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS gifts_admin_update ON public.gifts;
CREATE POLICY gifts_admin_update ON public.gifts
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS gifts_admin_delete ON public.gifts;
CREATE POLICY gifts_admin_delete ON public.gifts
  FOR DELETE TO authenticated USING (public.is_admin());
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'gifts_store_price_ratio_valid'
      AND conrelid = 'public.gifts'::regclass
  ) THEN
    ALTER TABLE public.gifts
      ADD CONSTRAINT gifts_store_price_ratio_valid
      CHECK (price_gold > 0 AND recipient_diamond_ratio BETWEEN 1 AND 100);
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.daily_missions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_key text NOT NULL UNIQUE CHECK (length(mission_key) BETWEEN 3 AND 80),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 2 AND 80),
  description text NOT NULL CHECK (length(trim(description)) BETWEEN 2 AND 240),
  event_type text NOT NULL CHECK (
    event_type IN ('daily_grant', 'story_post', 'gift_sent', 'gift_received', 'following')
  ),
  target_count integer NOT NULL CHECK (target_count BETWEEN 1 AND 100),
  reward_game_points integer NOT NULL DEFAULT 0 CHECK (reward_game_points BETWEEN 0 AND 5000),
  reward_xp integer NOT NULL DEFAULT 0 CHECK (reward_xp BETWEEN 0 AND 1000),
  is_enabled boolean NOT NULL DEFAULT true,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT daily_mission_reward_present CHECK (reward_game_points > 0 OR reward_xp > 0),
  CONSTRAINT daily_mission_dates_valid CHECK (ends_at IS NULL OR ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_daily_missions_active
  ON public.daily_missions (is_enabled, starts_at, ends_at);
ALTER TABLE public.daily_missions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.daily_missions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_missions TO authenticated;
DROP POLICY IF EXISTS daily_missions_admin_manage ON public.daily_missions;
CREATE POLICY daily_missions_admin_manage ON public.daily_missions
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE TABLE IF NOT EXISTS public.daily_mission_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id uuid NOT NULL REFERENCES public.daily_missions(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  claim_date date NOT NULL DEFAULT current_date,
  progress_count integer NOT NULL CHECK (progress_count >= 0),
  game_points_awarded integer NOT NULL DEFAULT 0 CHECK (game_points_awarded >= 0),
  xp_awarded integer NOT NULL DEFAULT 0 CHECK (xp_awarded >= 0),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT daily_mission_claim_once UNIQUE (mission_id, user_id, claim_date)
);
CREATE INDEX IF NOT EXISTS idx_daily_mission_claims_user_date
  ON public.daily_mission_claims (user_id, claim_date DESC);
ALTER TABLE public.daily_mission_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.daily_mission_claims FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.daily_mission_claims TO authenticated;
DROP POLICY IF EXISTS daily_mission_claims_self_select ON public.daily_mission_claims;
CREATE POLICY daily_mission_claims_self_select ON public.daily_mission_claims
  FOR SELECT TO authenticated USING (public.is_admin() OR user_id = auth.uid());

INSERT INTO public.daily_missions (
  mission_key, title, description, event_type, target_count, reward_game_points, reward_xp
)
VALUES
  ('daily-free-points', 'استلم Point اليومية', 'احصل على رصيد Point اليومي للألعاب.', 'daily_grant', 1, 100, 10),
  ('share-a-story', 'شارك لحظتك', 'انشر قصة واحدة في المجتمع.', 'story_post', 1, 100, 20),
  ('follow-community', 'وسّع مجتمعك', 'تابع ثلاثة أشخاص جدد اليوم.', 'following', 3, 150, 20),
  ('send-a-paid-gift', 'أرسل هدية', 'أرسل هدية باستخدام Coin.', 'gift_sent', 1, 100, 15),
  ('receive-a-paid-gift', 'تفاعل مجتمعي', 'استقبل هدية أُرسلت باستخدام Coin.', 'gift_received', 1, 100, 15)
ON CONFLICT (mission_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.daily_mission_progress(
  p_user_id uuid,
  p_event_type text,
  p_day date
)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_start timestamptz := p_day::timestamp AT TIME ZONE 'UTC';
  v_end timestamptz := (p_day + 1)::timestamp AT TIME ZONE 'UTC';
  v_count bigint;
BEGIN
  CASE p_event_type
    WHEN 'daily_grant' THEN
      SELECT count(*) INTO v_count
      FROM public.game_points_ledger l
      WHERE l.user_id = p_user_id
        AND l.event_type = 'daily_grant'
        AND l.idempotency_key = 'daily-grant:' || p_user_id::text || ':' || p_day::text
        AND l.created_at >= v_start AND l.created_at < v_end;
    WHEN 'story_post' THEN
      SELECT count(*) INTO v_count
      FROM public.stories s
      WHERE s.user_id = p_user_id AND s.created_at >= v_start AND s.created_at < v_end;
    WHEN 'gift_sent' THEN
      SELECT count(*) INTO v_count
      FROM public.gift_transactions g
      WHERE g.from_user_id = p_user_id AND g.funding_currency = 'gold'
        AND g.created_at >= v_start AND g.created_at < v_end;
    WHEN 'gift_received' THEN
      SELECT count(*) INTO v_count
      FROM public.gift_transactions g
      WHERE g.to_user_id = p_user_id AND g.received_diamond_currency = 'diamond'
        AND g.created_at >= v_start AND g.created_at < v_end;
    WHEN 'following' THEN
      SELECT count(*) INTO v_count
      FROM public.user_follows f
      WHERE f.follower_id = p_user_id AND f.created_at >= v_start AND f.created_at < v_end;
    ELSE
      RAISE EXCEPTION 'نوع مهمة غير مدعوم';
  END CASE;
  RETURN least(coalesce(v_count, 0), 2147483647)::integer;
END;
$$;
REVOKE ALL ON FUNCTION public.daily_mission_progress(uuid, text, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.list_daily_missions()
RETURNS TABLE (
  mission_id uuid,
  mission_key text,
  title text,
  description text,
  event_type text,
  target_count integer,
  current_progress integer,
  reward_game_points integer,
  reward_xp integer,
  is_claimed boolean,
  claimed_game_points integer,
  claimed_xp integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT m.id,
         m.mission_key,
         CASE m.mission_key
           WHEN 'daily-free-points' THEN 'استلم Point اليومية'
           ELSE m.title
         END,
         CASE m.mission_key
           WHEN 'daily-free-points' THEN 'احصل على رصيد Point اليومي للألعاب.'
           WHEN 'send-a-paid-gift' THEN 'أرسل هدية باستخدام Coin.'
           WHEN 'receive-a-paid-gift' THEN 'استقبل هدية أُرسلت باستخدام Coin.'
           ELSE m.description
         END,
         m.event_type,
         m.target_count,
         public.daily_mission_progress(auth.uid(), m.event_type, (now() AT TIME ZONE 'UTC')::date),
         m.reward_game_points, m.reward_xp,
         c.id IS NOT NULL,
         coalesce(c.game_points_awarded, 0),
         coalesce(c.xp_awarded, 0)
  FROM public.daily_missions m
  LEFT JOIN public.daily_mission_claims c
    ON c.mission_id = m.id AND c.user_id = auth.uid()
    AND c.claim_date = (now() AT TIME ZONE 'UTC')::date
  WHERE auth.uid() IS NOT NULL
    AND m.is_enabled
    AND m.starts_at <= now()
    AND (m.ends_at IS NULL OR m.ends_at > now())
    AND EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.status = 'active' AND u.adult_confirmed_at IS NOT NULL
    )
  ORDER BY m.mission_key;
$$;
REVOKE ALL ON FUNCTION public.list_daily_missions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_daily_missions() TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_daily_mission(p_mission_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user public.users%ROWTYPE;
  v_mission public.daily_missions%ROWTYPE;
  v_claim public.daily_mission_claims%ROWTYPE;
  v_day date := (now() AT TIME ZONE 'UTC')::date;
  v_progress integer;
  v_balance_cap bigint := 5000;
  v_awarded_points integer := 0;
  v_awarded_xp integer := 0;
BEGIN
  IF auth.uid() IS NULL OR p_mission_id IS NULL THEN
    RAISE EXCEPTION 'طلب استلام المهمة غير صالح';
  END IF;

  SELECT * INTO v_user FROM public.users WHERE id = auth.uid() FOR UPDATE;
  IF NOT FOUND OR v_user.status <> 'active' OR v_user.adult_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'الحساب غير متاح أو لم يؤكد العمر';
  END IF;
  SELECT * INTO v_mission FROM public.daily_missions
  WHERE id = p_mission_id AND is_enabled AND starts_at <= now()
    AND (ends_at IS NULL OR ends_at > now());
  IF NOT FOUND THEN RAISE EXCEPTION 'المهمة غير متاحة'; END IF;

  SELECT * INTO v_claim FROM public.daily_mission_claims
  WHERE mission_id = p_mission_id AND user_id = auth.uid() AND claim_date = v_day;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true, 'already_claimed', true,
      'game_points_awarded', v_claim.game_points_awarded,
      'xp_awarded', v_claim.xp_awarded
    );
  END IF;

  v_progress := public.daily_mission_progress(auth.uid(), v_mission.event_type, v_day);
  IF v_progress < v_mission.target_count THEN
    RAISE EXCEPTION 'لم يكتمل تقدم المهمة بعد';
  END IF;

  SELECT coalesce((s.value #>> '{}')::bigint, 5000)
  INTO v_balance_cap
  FROM public.admin_settings s
  WHERE s.key = 'free_coin_balance_cap';
  v_balance_cap := greatest(coalesce(v_balance_cap, 5000), 0);
  v_awarded_points := least(
    v_mission.reward_game_points,
    greatest(v_balance_cap - v_user.game_points, 0)
  )::integer;
  v_awarded_xp := v_mission.reward_xp;

  INSERT INTO public.daily_mission_claims (
    mission_id, user_id, claim_date, progress_count, game_points_awarded, xp_awarded
  )
  VALUES (
    p_mission_id, auth.uid(), v_day, v_progress, v_awarded_points, v_awarded_xp
  )
  RETURNING * INTO v_claim;

  IF v_awarded_points > 0 THEN
    UPDATE public.users SET game_points = game_points + v_awarded_points
    WHERE id = auth.uid();
    INSERT INTO public.game_points_ledger (
      user_id, event_type, amount, balance_before, balance_after, idempotency_key
    )
    VALUES (
      auth.uid(), 'daily_grant', v_awarded_points, v_user.game_points,
      v_user.game_points + v_awarded_points,
      'mission:' || v_claim.id::text || ':points'
    );
  END IF;
  IF v_awarded_xp > 0 THEN
    PERFORM public.award_user_xp(
      auth.uid(), 'mission:' || v_claim.id::text, 'social_engagement', v_awarded_xp
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true, 'already_claimed', false,
    'game_points_awarded', v_awarded_points, 'xp_awarded', v_awarded_xp
  );
END;
$$;
REVOKE ALL ON FUNCTION public.claim_daily_mission(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_daily_mission(uuid) TO authenticated;

COMMIT;
