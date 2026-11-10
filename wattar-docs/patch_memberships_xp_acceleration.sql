-- Non-renewing Coin-paid VIP memberships and capped XP boosts.
-- Run after patch_admin_audit_controls.sql and all wallet/economy patches,
-- including patch_three_currency_economy.sql. This patch does not change existing patches.

BEGIN;

CREATE TABLE IF NOT EXISTS public.membership_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  name_ar text NOT NULL,
  duration_days integer NOT NULL CHECK (duration_days BETWEEN 1 AND 365),
  price_coins bigint NOT NULL CHECK (price_coins BETWEEN 1 AND 10000000),
  xp_boost integer NOT NULL DEFAULT 0 CHECK (xp_boost BETWEEN 0 AND 250),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT membership_plan_name_length CHECK (
    char_length(btrim(name)) BETWEEN 2 AND 80
    AND char_length(btrim(name_ar)) BETWEEN 2 AND 80
  )
);

CREATE TABLE IF NOT EXISTS public.membership_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  plan_id uuid NOT NULL REFERENCES public.membership_plans(id) ON DELETE RESTRICT,
  plan_name text NOT NULL,
  plan_name_ar text NOT NULL,
  duration_days integer NOT NULL CHECK (duration_days BETWEEN 1 AND 365),
  price_coins bigint NOT NULL CHECK (price_coins > 0),
  xp_awarded integer NOT NULL DEFAULT 0 CHECK (xp_awarded BETWEEN 0 AND 250),
  idempotency_key varchar(80) NOT NULL,
  wallet_transaction_id uuid NOT NULL REFERENCES public.wallet_transactions(id) ON DELETE RESTRICT,
  starts_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  purchased_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT membership_purchase_period_valid CHECK (expires_at > starts_at),
  CONSTRAINT membership_purchase_idempotency UNIQUE (user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_membership_purchases_user_expiry
  ON public.membership_purchases (user_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_membership_purchases_user_period
  ON public.membership_purchases (user_id, purchased_at DESC);

ALTER TABLE public.membership_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membership_purchases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.membership_plans FROM anon, authenticated;
REVOKE ALL ON public.membership_purchases FROM anon, authenticated;
GRANT SELECT ON public.membership_plans TO anon, authenticated;
GRANT SELECT ON public.membership_purchases TO authenticated;

DROP POLICY IF EXISTS membership_plans_read ON public.membership_plans;
CREATE POLICY membership_plans_read ON public.membership_plans
  FOR SELECT TO anon, authenticated
  USING (is_active OR public.is_admin());

DROP POLICY IF EXISTS membership_purchases_read ON public.membership_purchases;
CREATE POLICY membership_purchases_read ON public.membership_purchases
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

ALTER TABLE public.progress_events
  DROP CONSTRAINT IF EXISTS progress_events_event_type_check;
ALTER TABLE public.progress_events
  ADD CONSTRAINT progress_events_event_type_check CHECK (
    event_type IN (
      'daily_login', 'room_participation', 'gift_received',
      'story_post', 'social_engagement', 'membership_boost'
    )
  );

CREATE OR REPLACE FUNCTION public.admin_upsert_membership_plan(
  p_plan_id uuid,
  p_name text,
  p_name_ar text,
  p_duration_days integer,
  p_price_coins bigint,
  p_xp_boost integer,
  p_is_active boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_before public.membership_plans%ROWTYPE;
  v_plan public.membership_plans%ROWTYPE;
BEGIN
  IF v_admin_id IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 2 AND 80
     OR p_name_ar IS NULL OR char_length(btrim(p_name_ar)) NOT BETWEEN 2 AND 80
     OR p_duration_days NOT BETWEEN 1 AND 365
     OR p_price_coins NOT BETWEEN 1 AND 10000000
     OR p_xp_boost NOT BETWEEN 0 AND 250
     OR p_is_active IS NULL THEN
    RAISE EXCEPTION 'Invalid membership plan';
  END IF;

  IF p_plan_id IS NULL THEN
    INSERT INTO public.membership_plans (
      name, name_ar, duration_days, price_coins, xp_boost, is_active
    ) VALUES (
      btrim(p_name), btrim(p_name_ar), p_duration_days, p_price_coins, p_xp_boost, p_is_active
    ) RETURNING * INTO v_plan;
  ELSE
    SELECT * INTO v_before
    FROM public.membership_plans
    WHERE id = p_plan_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Membership plan not found'; END IF;

    UPDATE public.membership_plans
    SET name = btrim(p_name),
        name_ar = btrim(p_name_ar),
        duration_days = p_duration_days,
        price_coins = p_price_coins,
        xp_boost = p_xp_boost,
        is_active = p_is_active,
        updated_at = now()
    WHERE id = p_plan_id
    RETURNING * INTO v_plan;
  END IF;

  INSERT INTO public.admin_audit_log (
    admin_id, action, target_type, target_id, before, after, metadata
  ) VALUES (
    v_admin_id,
    CASE WHEN p_plan_id IS NULL THEN 'create'::public.audit_action_type
         ELSE 'update'::public.audit_action_type END,
    'membership_plan',
    v_plan.id,
    CASE WHEN p_plan_id IS NULL THEN NULL ELSE to_jsonb(v_before) END,
    to_jsonb(v_plan),
    jsonb_build_object('source', 'membership_admin')
  );

  RETURN to_jsonb(v_plan);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_upsert_membership_plan(uuid, text, text, integer, bigint, integer, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_upsert_membership_plan(uuid, text, text, integer, bigint, integer, boolean)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.purchase_membership(
  p_plan_id uuid,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_user public.users%ROWTYPE;
  v_plan public.membership_plans%ROWTYPE;
  v_existing public.membership_purchases%ROWTYPE;
  v_purchase_id uuid := gen_random_uuid();
  v_wallet_transaction_id uuid;
  v_starts_at timestamptz;
  v_expires_at timestamptz;
  v_period_start timestamptz := date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_period_xp integer;
  v_xp_awarded integer;
  v_new_xp bigint;
  v_new_level integer;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_plan_id IS NULL OR length(btrim(coalesce(p_idempotency_key, ''))) NOT BETWEEN 20 AND 40 THEN
    RAISE EXCEPTION 'Invalid membership purchase';
  END IF;

  SELECT * INTO v_existing
  FROM public.membership_purchases
  WHERE user_id = v_user_id AND idempotency_key = p_idempotency_key
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.plan_id <> p_plan_id THEN
      RAISE EXCEPTION 'Idempotency key already used for another plan';
    END IF;
    RETURN jsonb_build_object(
      'success', true, 'already_processed', true, 'purchase', to_jsonb(v_existing)
    );
  END IF;

  SELECT * INTO v_user
  FROM public.users
  WHERE id = v_user_id AND status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active user not found'; END IF;

  -- The user row lock serializes purchases and enforces the monthly XP cap.
  SELECT * INTO v_existing
  FROM public.membership_purchases
  WHERE user_id = v_user_id AND idempotency_key = p_idempotency_key
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.plan_id <> p_plan_id THEN
      RAISE EXCEPTION 'Idempotency key already used for another plan';
    END IF;
    RETURN jsonb_build_object(
      'success', true, 'already_processed', true, 'purchase', to_jsonb(v_existing)
    );
  END IF;

  SELECT * INTO v_plan
  FROM public.membership_plans
  WHERE id = p_plan_id AND is_active
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Membership plan is unavailable'; END IF;

  SELECT coalesce(max(expires_at), now()) INTO v_starts_at
  FROM public.membership_purchases
  WHERE user_id = v_user_id AND expires_at > now();
  v_expires_at := v_starts_at + make_interval(days => v_plan.duration_days);

  SELECT coalesce(sum(xp_awarded), 0)::integer INTO v_period_xp
  FROM public.membership_purchases
  WHERE user_id = v_user_id AND purchased_at >= v_period_start;
  v_xp_awarded := least(v_plan.xp_boost, greatest(0, 500 - v_period_xp));

  v_wallet_transaction_id := public.record_wallet_transaction(
    v_user_id,
    'membership_purchase'::public.wallet_tx_type,
    -v_plan.price_coins,
    'gold',
    NULL,
    'member:' || v_user_id::text || ':' || p_idempotency_key || ':coin',
    'membership_purchase',
    v_purchase_id,
    jsonb_build_object('plan_id', v_plan.id, 'plan_name', v_plan.name, 'plan_name_ar', v_plan.name_ar),
    'membership-purchase'
  );

  INSERT INTO public.membership_purchases (
    id, user_id, plan_id, plan_name, plan_name_ar, duration_days,
    price_coins, xp_awarded, idempotency_key, wallet_transaction_id,
    starts_at, expires_at
  ) VALUES (
    v_purchase_id, v_user_id, v_plan.id, v_plan.name, v_plan.name_ar,
    v_plan.duration_days, v_plan.price_coins, v_xp_awarded, p_idempotency_key,
    v_wallet_transaction_id, v_starts_at, v_expires_at
  ) RETURNING * INTO v_existing;

  IF v_xp_awarded > 0 THEN
    UPDATE public.users
    SET experience_points = experience_points + v_xp_awarded,
        level = floor(sqrt((experience_points + v_xp_awarded)::numeric / 100))::integer + 1
    WHERE id = v_user_id
    RETURNING experience_points, level INTO v_new_xp, v_new_level;

    INSERT INTO public.progress_events (user_id, event_key, event_type, points)
    VALUES (v_user_id, 'membership-purchase:' || v_purchase_id::text, 'membership_boost', v_xp_awarded);
  ELSE
    v_new_xp := v_user.experience_points;
    v_new_level := v_user.level;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'already_processed', false,
    'purchase', to_jsonb(v_existing),
    'xp_awarded', v_xp_awarded,
    'monthly_xp_cap', 500,
    'experience_points', v_new_xp,
    'level', v_new_level
  );
END;
$$;
REVOKE ALL ON FUNCTION public.purchase_membership(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purchase_membership(uuid, text) TO authenticated;

COMMIT;
