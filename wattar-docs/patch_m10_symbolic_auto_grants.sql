-- ============================================================
-- patch_m10_symbolic_auto_grants.sql
-- M10.1: منح الهدايا الرمزية تلقائيًا (بدون تحويلها لعملات)
--   1) دالة منح داخلية موحّدة + إعادة توجيه grant_symbolic_gift إليها.
--   2) مكافآت المستويات: level_rewards.free_gift_id تُمنح فعليًا عند الوصول للمستوى.
--   3) مهام اليوم: daily_missions.reward_gift_id تُمنح عند استلام المهمة.
--   4) شارات الالتزام: شارة loyalty_badges التي تحمل gift_id تُمنح مرة واحدة عند اكتسابها.
--   كل المنح تُسجَّل في symbolic_gift_grants بمفتاح idempotency وتُضاف إلى user_gift_bag.
-- ============================================================
BEGIN;

-- جلسة مسؤول: مطلوبة لمُشغّلات التدقيق على admin_settings
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- ------------------------------------------------------------
-- 1) الدالة الداخلية (بلا فحص دور؛ تُستدعى من دوال SECURITY DEFINER فقط)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.grant_symbolic_gift_internal(
  p_user_id uuid,
  p_gift_id uuid,
  p_quantity integer,
  p_source text,
  p_granted_by uuid,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_gift public.gifts%rowtype;
  v_existing public.symbolic_gift_grants%rowtype;
  v_grant_id uuid;
  v_qty integer := greatest(1, least(coalesce(p_quantity, 1), 1000));
  v_source text := coalesce(nullif(btrim(p_source), ''), 'system');
BEGIN
  IF p_user_id IS NULL OR p_gift_id IS NULL THEN
    RAISE EXCEPTION 'Invalid grant';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.symbolic_gift_grants
    WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', true,
        'already_processed', true,
        'grant_id', v_existing.id,
        'user_id', v_existing.user_id,
        'gift_id', v_existing.gift_id,
        'quantity', v_existing.quantity
      );
    END IF;
  END IF;

  SELECT * INTO v_gift FROM public.gifts WHERE id = p_gift_id FOR SHARE;
  IF NOT FOUND OR NOT v_gift.is_active OR NOT v_gift.is_symbolic THEN
    RETURN jsonb_build_object('success', false, 'reason', 'gift_unavailable');
  END IF;

  PERFORM 1 FROM public.users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'user_not_found');
  END IF;

  INSERT INTO public.symbolic_gift_grants (user_id, gift_id, quantity, source, granted_by, idempotency_key)
  VALUES (p_user_id, p_gift_id, v_qty, v_source, p_granted_by, p_idempotency_key)
  RETURNING id INTO v_grant_id;

  INSERT INTO public.user_gift_bag (user_id, gift_id, quantity, source)
  VALUES (p_user_id, p_gift_id, v_qty, v_source)
  ON CONFLICT (user_id, gift_id)
  DO UPDATE SET
    quantity = public.user_gift_bag.quantity + EXCLUDED.quantity,
    source = EXCLUDED.source,
    updated_at = now();

  BEGIN
    INSERT INTO public.user_notifications (user_id, actor_id, event_type, reference_id, title, body, route)
    VALUES (
      p_user_id,
      NULL,
      'symbolic_gift',
      v_grant_id,
      'هدية رمزية جديدة',
      'أُضيفت «' || coalesce(nullif(v_gift.name_ar, ''), nullif(v_gift.name, ''), 'هدية') || '» إلى حقيبتك.',
      '/store'
    );
  EXCEPTION WHEN OTHERS THEN
    NULL; -- الإشعار ليس حرجًا: لا نُفشل المنح بسببه
  END;

  RETURN jsonb_build_object(
    'success', true,
    'already_processed', false,
    'grant_id', v_grant_id,
    'user_id', p_user_id,
    'gift_id', p_gift_id,
    'quantity', v_qty,
    'source', v_source
  );
END;
$$;

REVOKE ALL ON FUNCTION public.grant_symbolic_gift_internal(uuid, uuid, integer, text, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_symbolic_gift_internal(uuid, uuid, integer, text, uuid, text)
  TO service_role;

-- إعادة توجيه واجهة المنح الإدارية إلى الدالة الداخلية (مع فحص الدور كما كان)
CREATE OR REPLACE FUNCTION public.grant_symbolic_gift(
  p_user_id uuid,
  p_gift_id uuid,
  p_quantity integer,
  p_source text DEFAULT 'admin',
  p_granted_by uuid DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_quantity IS NULL OR p_quantity < 1 OR p_quantity > 1000 THEN
    RAISE EXCEPTION 'Invalid quantity';
  END IF;
  RETURN public.grant_symbolic_gift_internal(
    p_user_id, p_gift_id, p_quantity, p_source, p_granted_by, p_idempotency_key
  );
END;
$$;

REVOKE ALL ON FUNCTION public.grant_symbolic_gift(uuid, uuid, integer, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_symbolic_gift(uuid, uuid, integer, text, uuid, text) TO service_role;

-- ------------------------------------------------------------
-- 2) نوع إشعار جديد للهدايا الرمزية
-- ------------------------------------------------------------
ALTER TABLE public.user_notifications
  DROP CONSTRAINT IF EXISTS user_notifications_event_type_check;
ALTER TABLE public.user_notifications
  ADD CONSTRAINT user_notifications_event_type_check CHECK (event_type IN (
    'friend_request', 'friend_accepted', 'private_message',
    'room_invitation', 'new_follower', 'gift_received',
    'deposit_update', 'withdrawal_update', 'host_update', 'membership_update',
    'host_earning', 'support_reply', 'moderation_penalty', 'moderation_appeal',
    'host_application', 'host_status', 'host_target', 'host_contract',
    'vip_purchase', 'protection_purchase', 'level_up', 'loyalty_streak',
    'broadcast', 'dice_challenge', 'symbolic_gift'
  ));

-- ------------------------------------------------------------
-- 3) مكافآت المستويات: كمية الهدية + تفعيل المنح
-- ------------------------------------------------------------
ALTER TABLE public.level_rewards
  ADD COLUMN IF NOT EXISTS free_gift_quantity integer NOT NULL DEFAULT 1
  CHECK (free_gift_quantity BETWEEN 1 AND 100);

CREATE OR REPLACE FUNCTION public.m10_level_reward_symbolic_gift()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_gift_id uuid;
  v_qty integer;
BEGIN
  SELECT free_gift_id, coalesce(free_gift_quantity, 1)
    INTO v_gift_id, v_qty
  FROM public.level_rewards
  WHERE level = NEW.level;

  IF v_gift_id IS NOT NULL THEN
    PERFORM public.grant_symbolic_gift_internal(
      NEW.user_id,
      v_gift_id,
      v_qty,
      'level',
      NULL,
      'level:' || NEW.user_id::text || ':' || NEW.level::text
    );
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.m10_level_reward_symbolic_gift() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_user_level_reward_symbolic ON public.user_level_rewards;
CREATE TRIGGER trg_user_level_reward_symbolic
  AFTER INSERT ON public.user_level_rewards
  FOR EACH ROW
  EXECUTE FUNCTION public.m10_level_reward_symbolic_gift();

-- ------------------------------------------------------------
-- 4) مهام اليوم: هدية رمزية كمكافأة
-- ------------------------------------------------------------
ALTER TABLE public.daily_missions
  ADD COLUMN IF NOT EXISTS reward_gift_id uuid REFERENCES public.gifts(id) ON DELETE SET NULL;
ALTER TABLE public.daily_missions
  ADD COLUMN IF NOT EXISTS reward_gift_quantity integer NOT NULL DEFAULT 1
  CHECK (reward_gift_quantity BETWEEN 1 AND 100);

ALTER TABLE public.daily_missions
  DROP CONSTRAINT IF EXISTS daily_mission_reward_present;
ALTER TABLE public.daily_missions
  ADD CONSTRAINT daily_mission_reward_present CHECK (
    reward_game_points > 0 OR reward_xp > 0 OR reward_gift_id IS NOT NULL
  );

CREATE OR REPLACE FUNCTION public.m10_mission_reward_symbolic_gift()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_gift_id uuid;
  v_qty integer;
BEGIN
  SELECT reward_gift_id, coalesce(reward_gift_quantity, 1)
    INTO v_gift_id, v_qty
  FROM public.daily_missions
  WHERE id = NEW.mission_id;

  IF v_gift_id IS NOT NULL THEN
    PERFORM public.grant_symbolic_gift_internal(
      NEW.user_id,
      v_gift_id,
      v_qty,
      'mission',
      NULL,
      'mission:' || NEW.id::text
    );
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.m10_mission_reward_symbolic_gift() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_daily_mission_claim_symbolic ON public.daily_mission_claims;
CREATE TRIGGER trg_daily_mission_claim_symbolic
  AFTER INSERT ON public.daily_mission_claims
  FOR EACH ROW
  EXECUTE FUNCTION public.m10_mission_reward_symbolic_gift();

-- ------------------------------------------------------------
-- 5) شارات الالتزام: هدية رمزية مرة واحدة عند اكتساب الشارة
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.m10_loyalty_reward_symbolic_gift()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cfg jsonb;
  v_gift_id uuid;
  v_qty integer;
BEGIN
  IF NEW.badge IS NULL THEN
    RETURN NEW;
  END IF;

  -- تُمنح مرة واحدة فقط عند أول ظهور للشارة
  IF EXISTS (
    SELECT 1 FROM public.loyalty_claims
    WHERE user_id = NEW.user_id AND badge = NEW.badge AND id <> NEW.id
  ) THEN
    RETURN NEW;
  END IF;

  SELECT value INTO v_cfg FROM public.admin_settings WHERE key = 'loyalty_badges';
  IF v_cfg IS NULL OR jsonb_typeof(v_cfg) <> 'array' THEN
    RETURN NEW;
  END IF;

  SELECT (b ->> 'gift_id')::uuid, coalesce((b ->> 'gift_quantity')::int, 1)
    INTO v_gift_id, v_qty
  FROM jsonb_array_elements(v_cfg) AS b
  WHERE b ->> 'key' = NEW.badge
  LIMIT 1;

  IF v_gift_id IS NOT NULL THEN
    PERFORM public.grant_symbolic_gift_internal(
      NEW.user_id,
      v_gift_id,
      v_qty,
      'loyalty',
      NULL,
      'loyalty:' || NEW.id::text
    );
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.m10_loyalty_reward_symbolic_gift() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_loyalty_claim_symbolic ON public.loyalty_claims;
CREATE TRIGGER trg_loyalty_claim_symbolic
  AFTER INSERT ON public.loyalty_claims
  FOR EACH ROW
  EXECUTE FUNCTION public.m10_loyalty_reward_symbolic_gift();

-- ------------------------------------------------------------
-- 6) بذور: ربط المستويات والشارات بالهدايا الرمزية الثلاث
--    نجمة الحظ     = 829a29a1-418a-489e-b2e4-30015707bf0d
--    وردة سحرية    = 1979bd2e-b732-4af2-80bb-ec62d85ccc1c
--    وسام الشرف    = 967ac847-420c-4b9e-a1b0-d3409694be9b
-- ------------------------------------------------------------
INSERT INTO public.level_rewards (level, free_gift_id, free_gift_quantity)
VALUES
  (5,  '1979bd2e-b732-4af2-80bb-ec62d85ccc1c', 1),
  (10, '829a29a1-418a-489e-b2e4-30015707bf0d', 1),
  (25, '967ac847-420c-4b9e-a1b0-d3409694be9b', 1),
  (50, '967ac847-420c-4b9e-a1b0-d3409694be9b', 2)
ON CONFLICT (level) DO UPDATE
  SET free_gift_id = EXCLUDED.free_gift_id,
      free_gift_quantity = EXCLUDED.free_gift_quantity,
      updated_at = now()
  WHERE public.level_rewards.free_gift_id IS NULL;

UPDATE public.admin_settings
SET value = (
  SELECT jsonb_agg(
    CASE
      WHEN b ->> 'key' = 'loyalty_silver'   THEN b || jsonb_build_object('gift_id', '1979bd2e-b732-4af2-80bb-ec62d85ccc1c', 'gift_quantity', 1)
      WHEN b ->> 'key' = 'loyalty_gold'     THEN b || jsonb_build_object('gift_id', '829a29a1-418a-489e-b2e4-30015707bf0d', 'gift_quantity', 1)
      WHEN b ->> 'key' = 'loyalty_platinum' THEN b || jsonb_build_object('gift_id', '967ac847-420c-4b9e-a1b0-d3409694be9b', 'gift_quantity', 1)
      ELSE b
    END
    ORDER BY ord
  )
  FROM jsonb_array_elements(value) WITH ORDINALITY AS t(b, ord)
)
WHERE key = 'loyalty_badges'
  AND jsonb_typeof(value) = 'array'
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(value) AS b WHERE b ? 'gift_id'
  );

-- مهمة يومية تُمنح هدية رمزية بدل العملات
INSERT INTO public.daily_missions (
  mission_key, title, description, event_type, target_count,
  reward_game_points, reward_xp, reward_gift_id, reward_gift_quantity, is_enabled
)
VALUES (
  'symbolic_daily_story',
  'شارك قصتك اليومية',
  'انشر ستوري واحدًا اليوم واحصل على هدية رمزية إلى حقيبتك.',
  'story_post',
  1,
  0,
  0,
  '829a29a1-418a-489e-b2e4-30015707bf0d',
  1,
  true
)
ON CONFLICT (mission_key) DO NOTHING;

COMMIT;
