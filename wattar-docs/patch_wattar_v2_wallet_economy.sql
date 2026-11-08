-- Wattar v2 wallet economy.
-- Run after patch_wattar_v2_wallet.sql and patch_wattar_v2_social.sql.
BEGIN;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS balance_converted_coins bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS balance_diamond_promo bigint NOT NULL DEFAULT 0;
ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS balance_wallet_economy_non_negative,
  ADD CONSTRAINT balance_wallet_economy_non_negative
    CHECK (balance_gold >= 0 AND balance_diamond >= 0
      AND balance_converted_coins >= 0 AND balance_diamond_promo >= 0);

ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS coin_inventory bigint NOT NULL DEFAULT 0;
ALTER TABLE public.agents
  DROP CONSTRAINT IF EXISTS agent_coin_inventory_non_negative,
  ADD CONSTRAINT agent_coin_inventory_non_negative CHECK (coin_inventory >= 0);

ALTER TABLE public.gift_transactions
  ADD COLUMN IF NOT EXISTS funding_currency varchar(10) NOT NULL DEFAULT 'gold',
  ADD COLUMN IF NOT EXISTS received_diamond_currency varchar(10) NOT NULL DEFAULT 'diamond';

ALTER TABLE public.gift_transactions
  DROP CONSTRAINT IF EXISTS gift_transactions_funding_currency_check,
  ADD CONSTRAINT gift_transactions_funding_currency_check
    CHECK (funding_currency IN ('gold', 'conv_gold')),
  DROP CONSTRAINT IF EXISTS gift_transactions_received_currency_check,
  ADD CONSTRAINT gift_transactions_received_currency_check
    CHECK (received_diamond_currency IN ('diamond', 'promo_dia'));

CREATE TABLE IF NOT EXISTS public.agent_coin_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE RESTRICT,
  event_type varchar(30) NOT NULL CHECK (event_type IN ('prefund', 'user_sale', 'admin_adjustment')),
  amount_coins bigint NOT NULL,
  balance_before bigint NOT NULL,
  balance_after bigint NOT NULL,
  amount_usd numeric(14,2),
  reference_id uuid,
  idempotency_key varchar(100) NOT NULL UNIQUE,
  notes text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_coin_ledger_nonzero CHECK (amount_coins <> 0),
  CONSTRAINT agent_coin_ledger_balance_valid CHECK (balance_before >= 0 AND balance_after >= 0)
);

CREATE INDEX IF NOT EXISTS idx_agent_coin_ledger_agent_time
  ON public.agent_coin_ledger (agent_id, created_at DESC);
ALTER TABLE public.agent_coin_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_coin_ledger FROM anon, authenticated;
GRANT SELECT ON public.agent_coin_ledger TO authenticated;
DROP POLICY IF EXISTS agent_coin_ledger_admin_select ON public.agent_coin_ledger;
CREATE POLICY agent_coin_ledger_admin_select ON public.agent_coin_ledger
  FOR SELECT TO authenticated USING (public.is_admin());

CREATE TABLE IF NOT EXISTS public.diamond_coin_conversions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  amount_diamond bigint NOT NULL CHECK (amount_diamond > 0),
  amount_coins bigint NOT NULL CHECK (amount_coins > 0),
  coins_per_diamond numeric(14,6) NOT NULL CHECK (coins_per_diamond > 0),
  idempotency_key varchar(100) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_diamond_coin_conversions_user_time
  ON public.diamond_coin_conversions (user_id, created_at DESC);
ALTER TABLE public.diamond_coin_conversions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.diamond_coin_conversions FROM anon, authenticated;
GRANT SELECT ON public.diamond_coin_conversions TO authenticated;
DROP POLICY IF EXISTS diamond_coin_conversions_self_select ON public.diamond_coin_conversions;
CREATE POLICY diamond_coin_conversions_self_select ON public.diamond_coin_conversions
  FOR SELECT TO authenticated USING (public.is_admin() OR user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.diamond_withdrawals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  agent_id uuid REFERENCES public.agents(id) ON DELETE RESTRICT,
  method public.deposit_method NOT NULL,
  payout_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  amount_diamond bigint NOT NULL CHECK (amount_diamond > 0),
  amount_usd numeric(14,2) NOT NULL CHECK (amount_usd > 0),
  fee_usd numeric(14,2) NOT NULL DEFAULT 0 CHECK (fee_usd >= 0),
  net_usd numeric(14,2) NOT NULL CHECK (net_usd > 0),
  diamonds_per_usd numeric(14,6) NOT NULL CHECK (diamonds_per_usd > 0),
  status public.tx_status NOT NULL DEFAULT 'pending',
  proof_url text,
  external_ref text,
  rejection_reason text,
  idempotency_key varchar(100) NOT NULL UNIQUE,
  reviewed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT diamond_withdrawal_net_valid CHECK (net_usd <= amount_usd)
);
CREATE INDEX IF NOT EXISTS idx_diamond_withdrawals_user_time
  ON public.diamond_withdrawals (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_diamond_withdrawals_status_time
  ON public.diamond_withdrawals (status, created_at DESC);
ALTER TABLE public.diamond_withdrawals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.diamond_withdrawals FROM anon, authenticated;
GRANT SELECT ON public.diamond_withdrawals TO authenticated;
DROP POLICY IF EXISTS diamond_withdrawals_select ON public.diamond_withdrawals;
CREATE POLICY diamond_withdrawals_select ON public.diamond_withdrawals
  FOR SELECT TO authenticated USING (
    public.is_admin()
    OR user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.agents a
      WHERE a.id = diamond_withdrawals.agent_id
        AND a.user_id = auth.uid()
        AND a.status = 'active'
        AND a.can_approve_withdrawals
    )
  );

INSERT INTO public.admin_settings (key, value, description, is_public)
VALUES
  ('diamond_to_coin_rate', '1'::jsonb, 'مبدئي للاختبار: 1 Diamond = 1 Coin محوّلة؛ راجع السعر قبل التشغيل الحقيقي', false),
  ('diamonds_per_usd', '1000'::jsonb, 'مبدئي للاختبار: 1000 Diamonds = 1 USD؛ السحب يبقى معطّلًا حتى تفعيله', false),
  ('paid_coins_per_usd', '1000'::jsonb, 'مبدئي للاختبار ومتوافق مع سعر الوكيل الافتراضي: 1000 Coins لكل USD', false),
  ('min_withdrawal_diamonds', '10000'::jsonb, 'الحد الأدنى لسحب Diamonds', false),
  ('withdrawal_fee_percent', '5'::jsonb, 'رسوم السحب النقدي (%)', false),
  ('withdrawals_enabled', 'false'::jsonb, 'تفعيل طلبات سحب Diamonds بعد مراجعة السعر ووسائل الدفع', false),
  ('free_coin_daily_grant', '1000'::jsonb, 'المكافأة اليومية من Coins المجانية للألعاب', false),
  ('free_coin_balance_cap', '5000'::jsonb, 'الحد الأقصى لرصيد Coins المجانية للألعاب', false)
ON CONFLICT (key) DO NOTHING;
UPDATE public.admin_settings SET
  description = 'مبدئي للاختبار: 1 Diamond = 1 Coin محوّلة؛ راجع السعر قبل التشغيل الحقيقي',
  is_public = false
WHERE key = 'diamond_to_coin_rate';
UPDATE public.admin_settings SET
  description = 'مبدئي للاختبار: 1000 Diamonds = 1 USD؛ السحب يبقى معطّلًا حتى تفعيله',
  is_public = false
WHERE key = 'diamonds_per_usd';
UPDATE public.admin_settings SET
  description = 'مبدئي للاختبار ومتوافق مع سعر الوكيل الافتراضي: 1000 Coins لكل USD',
  is_public = false
WHERE key = 'paid_coins_per_usd';
UPDATE public.admin_settings
SET value = 'false'::jsonb,
    description = 'الشحن مغلق افتراضيًا للاختبار؛ فعّله بعد ضبط وسيلة الدفع'
WHERE key = 'deposits_enabled';
UPDATE public.admin_settings
SET value = 'false'::jsonb,
    description = 'السحب مغلق افتراضيًا للاختبار؛ فعّله بعد ضبط سعر السحب ووسائل الدفع'
WHERE key = 'withdrawals_enabled';
UPDATE public.admin_settings
SET description = 'إعداد قديم غير مستخدم؛ مكافأة Coins المجانية للألعاب تضبط عبر free_coin_daily_grant',
    is_public = false
WHERE key = 'daily_bonus_gold';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('deposit-proofs', 'deposit-proofs', false, 5242880, ARRAY['image/jpeg', 'image/png'])
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png'];

DROP POLICY IF EXISTS wattar_deposit_proofs_owner_insert ON storage.objects;
CREATE POLICY wattar_deposit_proofs_owner_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'deposit-proofs'
    AND left(name, length('dep_' || auth.uid()::text || '_')) = 'dep_' || auth.uid()::text || '_'
  );
DROP POLICY IF EXISTS wattar_deposit_proofs_owner_admin_select ON storage.objects;
CREATE POLICY wattar_deposit_proofs_owner_admin_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'deposit-proofs'
    AND (
      public.is_admin()
      OR left(name, length('dep_' || auth.uid()::text || '_')) = 'dep_' || auth.uid()::text || '_'
    )
  );
DROP POLICY IF EXISTS wattar_deposit_proofs_owner_delete ON storage.objects;
CREATE POLICY wattar_deposit_proofs_owner_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'deposit-proofs'
    AND left(name, length('dep_' || auth.uid()::text || '_')) = 'dep_' || auth.uid()::text || '_'
  );

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
  SELECT
    auth.uid() IS NOT NULL AND u.status = 'active' AND u.adult_confirmed_at IS NOT NULL,
    access.agent_id, access.agent_name, access.group_id, access.group_name
  FROM public.users u
  LEFT JOIN LATERAL (
    SELECT selected.agent_id, selected.agent_name, selected.group_id, selected.group_name
    FROM (
      SELECT a.id AS agent_id,
             coalesce(agent_user.display_name, agent_user.username)::text AS agent_name,
             g.id AS group_id, g.name::text AS group_name,
             m.decided_at AS access_at
      FROM public.agent_group_memberships m
      JOIN public.agent_groups g ON g.id = m.group_id
      JOIN public.agents a ON a.id = g.agent_id AND a.status = 'active'
      JOIN public.users agent_user ON agent_user.id = a.user_id AND agent_user.status = 'active'
      WHERE m.user_id = auth.uid() AND m.status = 'active'
      UNION ALL
      SELECT a.id,
             coalesce(agent_user.display_name, agent_user.username)::text,
             g.id, g.name::text, a.created_at
      FROM public.agents a
      JOIN public.agent_groups g ON g.agent_id = a.id
      JOIN public.users agent_user ON agent_user.id = a.user_id AND agent_user.status = 'active'
      WHERE a.user_id = auth.uid() AND a.status = 'active'
    ) selected
    ORDER BY selected.access_at DESC NULLS LAST
    LIMIT 1
  ) access ON true
  WHERE u.id = auth.uid();
$$;
REVOKE ALL ON FUNCTION public.get_my_wallet_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_wallet_access() TO authenticated;

CREATE OR REPLACE FUNCTION public.list_my_deposit_methods()
RETURNS TABLE (
  method public.deposit_method,
  name_ar text,
  instructions text,
  min_amount_usd numeric,
  max_amount_usd numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT d.method, d.name_ar::text, d.instructions,
         d.min_amount_usd, d.max_amount_usd
  FROM public.deposit_methods d
  JOIN public.users u ON u.id = auth.uid()
  WHERE d.is_enabled
    AND u.status = 'active'
    AND u.adult_confirmed_at IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.admin_settings s
      WHERE s.key = 'deposits_enabled' AND s.value = 'true'::jsonb
    )
    AND (
      d.method <> 'agent'::public.deposit_method
      OR EXISTS (
        SELECT 1
        FROM public.agent_group_memberships m
        JOIN public.agent_groups g ON g.id = m.group_id
        JOIN public.agents a ON a.id = g.agent_id AND a.status = 'active'
        WHERE m.user_id = auth.uid() AND m.status = 'active'
      )
      OR EXISTS (
        SELECT 1 FROM public.agents a
        WHERE a.user_id = auth.uid() AND a.status = 'active'
      )
    )
  ORDER BY d.sort_order, d.name_ar;
$$;
REVOKE ALL ON FUNCTION public.list_my_deposit_methods() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_deposit_methods() TO authenticated;

CREATE OR REPLACE FUNCTION public.record_wallet_transaction(
  p_user_id uuid,
  p_type public.wallet_tx_type,
  p_amount bigint,
  p_currency varchar(10) DEFAULT 'gold',
  p_agent_id uuid DEFAULT NULL,
  p_idempotency_key varchar(100) DEFAULT NULL,
  p_reference_type varchar(50) DEFAULT NULL,
  p_reference_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_function_name varchar(50) DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing public.wallet_transactions%ROWTYPE;
  v_user public.users%ROWTYPE;
  v_before bigint;
  v_after bigint;
  v_transaction_id uuid;
BEGIN
  IF p_user_id IS NULL OR p_type IS NULL OR p_amount IS NULL OR p_amount = 0 THEN
    RAISE EXCEPTION 'Invalid wallet transaction';
  END IF;
  IF p_currency IS NULL OR p_currency NOT IN ('gold', 'diamond', 'conv_gold', 'promo_dia') THEN
    RAISE EXCEPTION 'Unknown currency: %', p_currency;
  END IF;
  IF p_idempotency_key IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('wallet-ledger:' || p_idempotency_key));
    SELECT * INTO v_existing
    FROM public.wallet_transactions
    WHERE idempotency_key = p_idempotency_key
    FOR UPDATE;
    IF FOUND THEN
      IF v_existing.user_id <> p_user_id OR v_existing.type <> p_type
         OR v_existing.amount <> p_amount OR v_existing.currency <> p_currency THEN
        RAISE EXCEPTION 'Idempotency key already used with different transaction data';
      END IF;
      RETURN v_existing.id;
    END IF;
  END IF;

  SELECT * INTO v_user FROM public.users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Wallet owner not found'; END IF;
  IF p_currency = 'gold' THEN
    v_before := v_user.balance_gold;
    v_after := v_before + p_amount;
    IF v_after < 0 THEN RAISE EXCEPTION 'Insufficient paid Coins balance'; END IF;
    UPDATE public.users SET balance_gold = v_after WHERE id = p_user_id;
  ELSIF p_currency = 'diamond' THEN
    v_before := v_user.balance_diamond;
    v_after := v_before + p_amount;
    IF v_after < 0 THEN RAISE EXCEPTION 'Insufficient withdrawable Diamonds balance'; END IF;
    UPDATE public.users SET balance_diamond = v_after WHERE id = p_user_id;
  ELSIF p_currency = 'conv_gold' THEN
    v_before := v_user.balance_converted_coins;
    v_after := v_before + p_amount;
    IF v_after < 0 THEN RAISE EXCEPTION 'Insufficient converted Coins balance'; END IF;
    UPDATE public.users SET balance_converted_coins = v_after WHERE id = p_user_id;
  ELSE
    v_before := v_user.balance_diamond_promo;
    v_after := v_before + p_amount;
    IF v_after < 0 THEN RAISE EXCEPTION 'Insufficient promotional Diamonds balance'; END IF;
    UPDATE public.users SET balance_diamond_promo = v_after WHERE id = p_user_id;
  END IF;

  INSERT INTO public.wallet_transactions (
    user_id, agent_id, type, amount, balance_before, balance_after, currency,
    idempotency_key, reference_type, reference_id, metadata, created_by_function
  ) VALUES (
    p_user_id, p_agent_id, p_type, p_amount, v_before, v_after, p_currency,
    p_idempotency_key, p_reference_type, p_reference_id,
    coalesce(p_metadata, '{}'::jsonb), p_function_name
  )
  RETURNING id INTO v_transaction_id;
  RETURN v_transaction_id;
END;
$$;
REVOKE ALL ON FUNCTION public.record_wallet_transaction(
  uuid, public.wallet_tx_type, bigint, varchar, uuid, varchar, varchar, uuid, jsonb, varchar
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_wallet_transaction(
  uuid, public.wallet_tx_type, bigint, varchar, uuid, varchar, varchar, uuid, jsonb, varchar
) TO service_role;

DROP FUNCTION IF EXISTS public.create_deposit_request(
  uuid, public.deposit_method, numeric, text, text, text, text, text, text, text, text
);
CREATE FUNCTION public.create_deposit_request(
  p_user_id uuid,
  p_method public.deposit_method,
  p_amount_usd numeric,
  p_external_ref text,
  p_proof_url text,
  p_idempotency_key text,
  p_sender_phone text DEFAULT NULL,
  p_sender_name text DEFAULT NULL,
  p_usdt_network text DEFAULT NULL,
  p_usdt_tx_hash text DEFAULT NULL,
  p_usdt_from_address text DEFAULT NULL
)
RETURNS public.deposits
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing public.deposits%ROWTYPE;
  v_method public.deposit_methods%ROWTYPE;
  v_agent_id uuid;
  v_rate numeric(10,2);
  v_amount_coins bigint;
  v_max_daily numeric(14,2);
  v_daily_total numeric(14,2);
  v_deposit public.deposits%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_user_id IS NULL OR p_method IS NULL OR p_amount_usd IS NULL OR p_amount_usd <= 0
  OR p_amount_usd <> round(p_amount_usd, 2)
     OR length(trim(coalesce(p_external_ref, ''))) NOT BETWEEN 1 AND 200
     OR length(trim(coalesce(p_proof_url, ''))) NOT BETWEEN 1 AND 2000
     OR length(trim(coalesce(p_idempotency_key, ''))) NOT BETWEEN 10 AND 100 THEN
    RAISE EXCEPTION 'Invalid deposit request';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_user_id AND u.status = 'active' AND u.adult_confirmed_at IS NOT NULL
  ) THEN RAISE EXCEPTION 'Deposit owner is unavailable'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext('deposit-request:' || p_idempotency_key));
  SELECT * INTO v_existing FROM public.deposits
  WHERE idempotency_key = p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_existing.user_id <> p_user_id OR v_existing.method <> p_method
       OR v_existing.amount_usd <> p_amount_usd
       OR v_existing.external_ref <> trim(p_external_ref) THEN
      RAISE EXCEPTION 'Idempotency key reused with different request data';
    END IF;
    RETURN v_existing;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.admin_settings s
    WHERE s.key = 'deposits_enabled' AND s.value = 'true'::jsonb
  ) THEN RAISE EXCEPTION 'Deposits are currently disabled'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_method::text || ':' || lower(trim(p_external_ref))));
  IF EXISTS (
    SELECT 1 FROM public.deposits d
    WHERE d.method = p_method AND lower(d.external_ref) = lower(trim(p_external_ref))
  ) THEN RAISE EXCEPTION 'Duplicate payment reference'; END IF;

  IF p_method = 'agent'::public.deposit_method THEN
    SELECT a.id, a.exchange_rate_usd_to_gold
    INTO v_agent_id, v_rate
    FROM public.agent_group_memberships m
    JOIN public.agent_groups g ON g.id = m.group_id
    JOIN public.agents a ON a.id = g.agent_id AND a.status = 'active'
    WHERE m.user_id = p_user_id AND m.status = 'active'
    ORDER BY m.decided_at DESC NULLS LAST
    LIMIT 1
    FOR UPDATE OF a;
    IF v_agent_id IS NULL THEN
      SELECT a.id, a.exchange_rate_usd_to_gold INTO v_agent_id, v_rate
      FROM public.agents a WHERE a.user_id = p_user_id AND a.status = 'active'
      FOR UPDATE;
    END IF;
    IF v_agent_id IS NULL THEN RAISE EXCEPTION 'An active approved agent is required for agent deposits'; END IF;
  END IF;

  SELECT * INTO v_method FROM public.deposit_methods
  WHERE method = p_method AND is_enabled FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Deposit method is unavailable'; END IF;
  IF p_amount_usd < v_method.min_amount_usd OR p_amount_usd > v_method.max_amount_usd THEN
    RAISE EXCEPTION 'Deposit amount is outside the configured limits';
  END IF;
  IF v_method.exchange_rate_usd_to_coins IS NOT NULL THEN
    v_rate := v_method.exchange_rate_usd_to_coins;
  ELSIF v_agent_id IS NULL THEN
    SELECT (s.value #>> '{}')::numeric INTO v_rate
    FROM public.admin_settings s WHERE s.key = 'paid_coins_per_usd';
  END IF;
  IF v_rate IS NULL OR v_rate <= 0 THEN RAISE EXCEPTION 'No valid Coins exchange rate is configured'; END IF;

  SELECT coalesce((s.value #>> '{}')::numeric, 2000) INTO v_max_daily
  FROM public.admin_settings s WHERE s.key = 'max_deposit_usd_per_day';
  v_max_daily := coalesce(v_max_daily, 2000);
  SELECT coalesce(sum(d.amount_usd), 0) INTO v_daily_total
  FROM public.deposits d
  WHERE d.user_id = p_user_id AND d.created_at >= date_trunc('day', now())
    AND d.status IN ('pending', 'reviewing', 'approved', 'completed');
  IF v_daily_total + p_amount_usd > v_max_daily THEN RAISE EXCEPTION 'Daily deposit limit exceeded'; END IF;

  v_amount_coins := floor(p_amount_usd * v_rate)::bigint;
  IF v_amount_coins <= 0 THEN RAISE EXCEPTION 'Deposit amount is too small'; END IF;
  INSERT INTO public.deposits (
    user_id, agent_id, method, amount_usd, amount_gold, external_ref, proof_url,
    sender_phone, sender_name, usdt_network, usdt_tx_hash, usdt_from_address,
    status, metadata, idempotency_key
  ) VALUES (
    p_user_id, v_agent_id, p_method, p_amount_usd, v_amount_coins,
    trim(p_external_ref), trim(p_proof_url), nullif(trim(p_sender_phone), ''),
    nullif(trim(p_sender_name), ''), nullif(trim(p_usdt_network), ''),
    nullif(trim(p_usdt_tx_hash), ''), nullif(trim(p_usdt_from_address), ''),
    'pending', jsonb_build_object('exchange_rate_usd_to_coins', v_rate), p_idempotency_key
  ) RETURNING * INTO v_deposit;
  RETURN v_deposit;
END;
$$;
REVOKE ALL ON FUNCTION public.create_deposit_request(
  uuid, public.deposit_method, numeric, text, text, text, text, text, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_deposit_request(
  uuid, public.deposit_method, numeric, text, text, text, text, text, text, text, text
) TO service_role;

CREATE OR REPLACE FUNCTION public.settle_deposit_request(
  p_deposit_id uuid,
  p_action text,
  p_reviewer_id uuid,
  p_reason text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deposit public.deposits%ROWTYPE;
  v_agent public.agents%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_action NOT IN ('approve', 'reject') OR p_reviewer_id IS NULL THEN
    RAISE EXCEPTION 'Invalid deposit review action';
  END IF;
  SELECT * INTO v_deposit FROM public.deposits WHERE id = p_deposit_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Deposit request not found'; END IF;
  IF v_deposit.status = 'completed' AND p_action = 'approve' THEN
    RETURN jsonb_build_object('success', true, 'already_processed', true,
      'status', v_deposit.status, 'credited_coins', v_deposit.amount_gold);
  END IF;
  IF v_deposit.status NOT IN ('pending', 'reviewing') THEN
    RAISE EXCEPTION 'Deposit request has already been processed';
  END IF;

  IF p_action = 'reject' THEN
    UPDATE public.deposits SET status = 'rejected',
      rejected_reason = nullif(trim(p_reason), ''), admin_notes = nullif(trim(p_notes), ''),
      reviewed_by = p_reviewer_id, reviewed_at = now()
    WHERE id = p_deposit_id;
    INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, before, after, metadata)
    VALUES (p_reviewer_id, 'reject', 'deposit', p_deposit_id, to_jsonb(v_deposit),
      jsonb_build_object('status', 'rejected'),
      jsonb_build_object('reason', nullif(trim(p_reason), '')));
    RETURN jsonb_build_object('success', true, 'status', 'rejected');
  END IF;

  IF v_deposit.agent_id IS NOT NULL THEN
    SELECT * INTO v_agent FROM public.agents
    WHERE id = v_deposit.agent_id AND status = 'active' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Assigned agent is not active'; END IF;
    IF v_agent.coin_inventory < v_deposit.amount_gold THEN
      RAISE EXCEPTION 'Agent prepaid Coins inventory is insufficient';
    END IF;
    UPDATE public.agents SET coin_inventory = coin_inventory - v_deposit.amount_gold
    WHERE id = v_agent.id;
    INSERT INTO public.agent_coin_ledger (
      agent_id, event_type, amount_coins, balance_before, balance_after,
      amount_usd, reference_id, idempotency_key, notes, created_by
    ) VALUES (
      v_agent.id, 'user_sale', -v_deposit.amount_gold, v_agent.coin_inventory,
      v_agent.coin_inventory - v_deposit.amount_gold, v_deposit.amount_usd,
      v_deposit.id, 'deposit-agent-sale:' || v_deposit.id::text,
      'Coins sold from prepaid agent inventory', p_reviewer_id
    );
  END IF;

  PERFORM public.record_wallet_transaction(
    v_deposit.user_id, 'deposit'::public.wallet_tx_type, v_deposit.amount_gold,
    'gold', v_deposit.agent_id, 'deposit_' || v_deposit.id::text,
    'deposit', v_deposit.id,
    jsonb_build_object('method', v_deposit.method, 'amount_usd', v_deposit.amount_usd),
    'deposit-approve'
  );
  UPDATE public.users SET total_deposited = total_deposited + v_deposit.amount_usd
  WHERE id = v_deposit.user_id AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'Deposit owner is not active'; END IF;
  IF v_deposit.agent_id IS NOT NULL THEN
    UPDATE public.agents SET
      wallet_usd = wallet_usd + v_deposit.amount_usd,
      total_deposit_usd = total_deposit_usd + v_deposit.amount_usd
    WHERE id = v_deposit.agent_id;
  END IF;

  UPDATE public.deposits SET status = 'completed',
    approved_by = p_reviewer_id, approved_at = now(),
    reviewed_by = p_reviewer_id, reviewed_at = now(),
    completed_at = now(), admin_notes = nullif(trim(p_notes), '')
  WHERE id = p_deposit_id;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, before, after, metadata)
  VALUES (p_reviewer_id, 'approve', 'deposit', p_deposit_id, to_jsonb(v_deposit),
    jsonb_build_object('status', 'completed', 'credited_coins', v_deposit.amount_gold),
    jsonb_build_object('agent_inventory_debited', v_deposit.agent_id IS NOT NULL));

  RETURN jsonb_build_object('success', true, 'status', 'completed',
    'credited_coins', v_deposit.amount_gold, 'agent_inventory_debited', v_deposit.agent_id IS NOT NULL);
END;
$$;
REVOKE ALL ON FUNCTION public.settle_deposit_request(uuid, text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_deposit_request(uuid, text, uuid, text, text) TO service_role;

DROP FUNCTION IF EXISTS public.settle_gift_send(uuid, uuid, uuid, integer, uuid, text, text);
DROP FUNCTION IF EXISTS public.settle_gift_send(uuid, uuid, uuid, integer, uuid, text, text, varchar);
CREATE FUNCTION public.settle_gift_send(
  p_from_user_id uuid,
  p_to_user_id uuid,
  p_gift_id uuid,
  p_quantity integer,
  p_room_id uuid,
  p_message text,
  p_idempotency_key text,
  p_funding_currency varchar(10)
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing public.gift_transactions%ROWTYPE;
  v_gift public.gifts%ROWTYPE;
  v_total_coins bigint;
  v_received_diamonds bigint;
  v_recipient_currency varchar(10);
  v_gift_transaction_id uuid := gen_random_uuid();
  v_gift_transaction public.gift_transactions%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_from_user_id IS NULL OR p_to_user_id IS NULL OR p_from_user_id = p_to_user_id
     OR p_quantity NOT BETWEEN 1 AND 100
     OR p_funding_currency IS NULL OR p_funding_currency NOT IN ('gold', 'conv_gold')
     OR length(trim(coalesce(p_idempotency_key, ''))) NOT BETWEEN 10 AND 90
     OR length(coalesce(p_message, '')) > 500 THEN
    RAISE EXCEPTION 'Invalid gift request';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('gift-send:' || p_idempotency_key));
  SELECT * INTO v_existing FROM public.gift_transactions
  WHERE idempotency_key = p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_existing.from_user_id <> p_from_user_id OR v_existing.to_user_id <> p_to_user_id
       OR v_existing.gift_id <> p_gift_id OR v_existing.quantity <> p_quantity
       OR v_existing.room_id IS DISTINCT FROM p_room_id
       OR v_existing.message IS DISTINCT FROM nullif(trim(p_message), '')
       OR v_existing.funding_currency <> p_funding_currency THEN
      RAISE EXCEPTION 'Idempotency key already used with different gift data';
    END IF;
    RETURN jsonb_build_object('success', true, 'already_processed', true,
      'gift_transaction', to_jsonb(v_existing), 'sent_coins', v_existing.total_gold,
      'received_diamonds', v_existing.received_diamond);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_from_user_id AND status = 'active')
     OR NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_to_user_id AND status = 'active') THEN
    RAISE EXCEPTION 'Sender or recipient is unavailable';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.user_blocks b
    WHERE (b.blocker_id = p_from_user_id AND b.blocked_id = p_to_user_id)
       OR (b.blocker_id = p_to_user_id AND b.blocked_id = p_from_user_id)
  ) THEN RAISE EXCEPTION 'Cannot send a gift to this user'; END IF;
  PERFORM 1 FROM public.users WHERE id IN (p_from_user_id, p_to_user_id)
    ORDER BY id FOR UPDATE;
  SELECT * INTO v_gift FROM public.gifts WHERE id = p_gift_id AND is_active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Gift is not available'; END IF;

  v_total_coins := v_gift.price_gold * p_quantity;
  v_received_diamonds := floor(v_total_coins * v_gift.recipient_diamond_ratio / 100)::bigint;
  IF v_total_coins <= 0 OR v_received_diamonds <= 0 THEN RAISE EXCEPTION 'Gift value is invalid'; END IF;
  v_recipient_currency := CASE WHEN p_funding_currency = 'gold' THEN 'diamond' ELSE 'promo_dia' END;

  PERFORM public.record_wallet_transaction(
    p_from_user_id, 'gift_sent'::public.wallet_tx_type, -v_total_coins,
    p_funding_currency, NULL, p_idempotency_key || ':out', 'gift',
    v_gift_transaction_id,
    jsonb_build_object('gift_id', p_gift_id, 'to_user_id', p_to_user_id,
      'quantity', p_quantity, 'funding_currency', p_funding_currency),
    'gift-send'
  );
  PERFORM public.record_wallet_transaction(
    p_to_user_id, 'gift_received'::public.wallet_tx_type, v_received_diamonds,
    v_recipient_currency, NULL, p_idempotency_key || ':in', 'gift',
    v_gift_transaction_id,
    jsonb_build_object('gift_id', p_gift_id, 'from_user_id', p_from_user_id,
      'quantity', p_quantity, 'funding_currency', p_funding_currency),
    'gift-send'
  );

  INSERT INTO public.gift_transactions (
    id, gift_id, from_user_id, to_user_id, room_id, quantity, total_gold,
    received_diamond, message, idempotency_key, funding_currency, received_diamond_currency
  ) VALUES (
    v_gift_transaction_id, p_gift_id, p_from_user_id, p_to_user_id, p_room_id,
    p_quantity, v_total_coins, v_received_diamonds, nullif(trim(p_message), ''),
    p_idempotency_key, p_funding_currency, v_recipient_currency
  ) RETURNING * INTO v_gift_transaction;
  UPDATE public.users SET total_gifts_sent = total_gifts_sent + v_total_coins WHERE id = p_from_user_id;
  UPDATE public.users SET total_gifts_received = total_gifts_received + v_received_diamonds WHERE id = p_to_user_id;
  PERFORM public.award_user_xp(p_to_user_id, 'gift_received:' || v_gift_transaction_id::text, 'gift_received', 5);

  RETURN jsonb_build_object('success', true, 'gift_transaction', to_jsonb(v_gift_transaction),
    'sent_coins', v_total_coins, 'received_diamonds', v_received_diamonds,
    'gift_name', coalesce(v_gift.name_ar, v_gift.name));
END;
$$;
REVOKE ALL ON FUNCTION public.settle_gift_send(uuid, uuid, uuid, integer, uuid, text, text, varchar) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_gift_send(uuid, uuid, uuid, integer, uuid, text, text, varchar) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_credit_agent_inventory(
  p_agent_id uuid,
  p_amount_usd numeric,
  p_admin_id uuid,
  p_idempotency_key text,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_agent public.agents%ROWTYPE;
  v_existing public.agent_coin_ledger%ROWTYPE;
  v_coins bigint;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_agent_id IS NULL OR p_admin_id IS NULL OR p_amount_usd IS NULL OR p_amount_usd <= 0
     OR p_amount_usd <> round(p_amount_usd, 2)
     OR length(trim(coalesce(p_idempotency_key, ''))) NOT BETWEEN 10 AND 90 THEN
    RAISE EXCEPTION 'Invalid agent inventory top-up';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('agent-inventory-topup:' || p_idempotency_key));
  SELECT * INTO v_existing FROM public.agent_coin_ledger
  WHERE idempotency_key = p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_existing.agent_id <> p_agent_id OR v_existing.amount_usd <> p_amount_usd THEN
      RAISE EXCEPTION 'Idempotency key already used with different top-up data';
    END IF;
    RETURN jsonb_build_object('success', true, 'already_processed', true,
      'credited_coins', v_existing.amount_coins, 'balance', v_existing.balance_after);
  END IF;
  SELECT * INTO v_agent FROM public.agents WHERE id = p_agent_id AND status = 'active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active agent not found'; END IF;
  v_coins := floor(p_amount_usd * v_agent.exchange_rate_usd_to_gold)::bigint;
  IF v_coins <= 0 THEN RAISE EXCEPTION 'Top-up amount is too small'; END IF;
  UPDATE public.agents SET coin_inventory = coin_inventory + v_coins,
    total_credit_received_usd = total_credit_received_usd + p_amount_usd
  WHERE id = p_agent_id;
  INSERT INTO public.agent_coin_ledger (
    agent_id, event_type, amount_coins, balance_before, balance_after,
    amount_usd, idempotency_key, notes, created_by
  ) VALUES (
    p_agent_id, 'prefund', v_coins, v_agent.coin_inventory, v_agent.coin_inventory + v_coins,
    p_amount_usd, p_idempotency_key, nullif(trim(p_notes), ''), p_admin_id
  );
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, before, after, metadata)
  VALUES (p_admin_id, 'credit_agent', 'agent', p_agent_id, to_jsonb(v_agent),
    jsonb_build_object('coin_inventory', v_agent.coin_inventory + v_coins),
    jsonb_build_object('prefunded_usd', p_amount_usd, 'credited_coins', v_coins));
  RETURN jsonb_build_object('success', true, 'credited_coins', v_coins,
    'balance', v_agent.coin_inventory + v_coins);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_credit_agent_inventory(uuid, numeric, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_credit_agent_inventory(uuid, numeric, uuid, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.convert_my_diamonds_to_coins(
  p_amount_diamond bigint,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user public.users%ROWTYPE;
  v_existing public.diamond_coin_conversions%ROWTYPE;
  v_rate numeric(14,6);
  v_amount_coins bigint;
  v_conversion_id uuid := gen_random_uuid();
BEGIN
  IF auth.uid() IS NULL OR p_amount_diamond IS NULL OR p_amount_diamond <= 0
     OR length(trim(coalesce(p_idempotency_key, ''))) NOT BETWEEN 10 AND 90 THEN
    RAISE EXCEPTION 'Invalid conversion request';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('diamond-conversion:' || p_idempotency_key));
  SELECT * INTO v_existing FROM public.diamond_coin_conversions
  WHERE idempotency_key = p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_existing.user_id <> auth.uid() OR v_existing.amount_diamond <> p_amount_diamond THEN
      RAISE EXCEPTION 'Idempotency key already used with different conversion data';
    END IF;
    RETURN jsonb_build_object('success', true, 'already_processed', true,
      'amount_diamond', v_existing.amount_diamond, 'amount_coins', v_existing.amount_coins);
  END IF;
  SELECT * INTO v_user FROM public.users WHERE id = auth.uid() FOR UPDATE;
  IF NOT FOUND OR v_user.status <> 'active' OR v_user.adult_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'Account is unavailable';
  END IF;
  SELECT (s.value #>> '{}')::numeric INTO v_rate
  FROM public.admin_settings s WHERE s.key = 'diamond_to_coin_rate';
  IF coalesce(v_rate, 0) <= 0 THEN RAISE EXCEPTION 'Diamond conversion is currently disabled'; END IF;
  IF v_user.balance_diamond < p_amount_diamond THEN RAISE EXCEPTION 'Insufficient withdrawable Diamonds'; END IF;
  v_amount_coins := floor(p_amount_diamond * v_rate)::bigint;
  IF v_amount_coins <= 0 THEN RAISE EXCEPTION 'Conversion amount is too small'; END IF;
  INSERT INTO public.diamond_coin_conversions (
    id, user_id, amount_diamond, amount_coins, coins_per_diamond, idempotency_key
  ) VALUES (v_conversion_id, auth.uid(), p_amount_diamond, v_amount_coins, v_rate, p_idempotency_key);
  PERFORM public.record_wallet_transaction(
    auth.uid(), 'admin_adjustment'::public.wallet_tx_type, -p_amount_diamond,
    'diamond', NULL, p_idempotency_key || ':diamond', 'conversion', v_conversion_id,
    jsonb_build_object('direction', 'diamond_to_coin', 'rate', v_rate), 'wallet-convert'
  );
  PERFORM public.record_wallet_transaction(
    auth.uid(), 'admin_adjustment'::public.wallet_tx_type, v_amount_coins,
    'conv_gold', NULL, p_idempotency_key || ':coins', 'conversion', v_conversion_id,
    jsonb_build_object('direction', 'diamond_to_coin', 'rate', v_rate), 'wallet-convert'
  );
  RETURN jsonb_build_object('success', true, 'amount_diamond', p_amount_diamond,
    'amount_coins', v_amount_coins, 'rate', v_rate);
END;
$$;
REVOKE ALL ON FUNCTION public.convert_my_diamonds_to_coins(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.convert_my_diamonds_to_coins(bigint, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_wallet_options()
RETURNS TABLE (
  diamond_to_coin_rate numeric,
  diamonds_per_usd numeric,
  withdrawals_enabled boolean,
  min_withdrawal_diamonds bigint,
  has_assigned_agent boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    coalesce((SELECT (s.value #>> '{}')::numeric FROM public.admin_settings s WHERE s.key = 'diamond_to_coin_rate'), 0),
    coalesce((SELECT (s.value #>> '{}')::numeric FROM public.admin_settings s WHERE s.key = 'diamonds_per_usd'), 0),
    coalesce((SELECT s.value = 'true'::jsonb FROM public.admin_settings s WHERE s.key = 'withdrawals_enabled'), false),
    coalesce((SELECT (s.value #>> '{}')::bigint FROM public.admin_settings s WHERE s.key = 'min_withdrawal_diamonds'), 10000),
    EXISTS (
      SELECT 1
      FROM public.agent_group_memberships m
      JOIN public.agent_groups g ON g.id = m.group_id
      JOIN public.agents a ON a.id = g.agent_id AND a.status = 'active' AND a.can_approve_withdrawals
      WHERE m.user_id = auth.uid() AND m.status = 'active'
    )
  WHERE auth.uid() IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.get_my_wallet_options() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_wallet_options() TO authenticated;

CREATE OR REPLACE FUNCTION public.create_my_diamond_withdrawal(
  p_user_id uuid,
  p_amount_diamond bigint,
  p_method public.deposit_method,
  p_payout_details jsonb,
  p_idempotency_key text
)
RETURNS public.diamond_withdrawals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user public.users%ROWTYPE;
  v_existing public.diamond_withdrawals%ROWTYPE;
  v_agent_id uuid;
  v_rate numeric(14,6);
  v_minimum bigint;
  v_fee_percent numeric(8,4);
  v_gross numeric(14,2);
  v_fee numeric(14,2);
  v_withdrawal public.diamond_withdrawals%ROWTYPE;
BEGIN
  IF p_user_id IS NULL
     OR (auth.role() <> 'service_role' AND auth.uid() IS DISTINCT FROM p_user_id)
     OR p_amount_diamond IS NULL OR p_amount_diamond <= 0
     OR p_method IS NULL OR jsonb_typeof(coalesce(p_payout_details, '{}'::jsonb)) <> 'object'
     OR length(trim(coalesce(p_idempotency_key, ''))) NOT BETWEEN 10 AND 100 THEN
    RAISE EXCEPTION 'Invalid withdrawal request';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('diamond-withdrawal:' || p_idempotency_key));
  SELECT * INTO v_existing FROM public.diamond_withdrawals
  WHERE idempotency_key = p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_existing.user_id <> p_user_id OR v_existing.amount_diamond <> p_amount_diamond
       OR v_existing.method <> p_method
       OR v_existing.payout_details IS DISTINCT FROM coalesce(p_payout_details, '{}'::jsonb) THEN
      RAISE EXCEPTION 'Idempotency key already used with different withdrawal data';
    END IF;
    RETURN v_existing;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_settings s
    WHERE s.key = 'withdrawals_enabled' AND s.value = 'true'::jsonb
  ) THEN RAISE EXCEPTION 'Diamond withdrawals are currently disabled'; END IF;
  SELECT (s.value #>> '{}')::numeric INTO v_rate
  FROM public.admin_settings s WHERE s.key = 'diamonds_per_usd';
  IF coalesce(v_rate, 0) <= 0 THEN RAISE EXCEPTION 'Withdrawal rate is not configured'; END IF;
  SELECT coalesce((s.value #>> '{}')::bigint, 10000) INTO v_minimum
  FROM public.admin_settings s WHERE s.key = 'min_withdrawal_diamonds';
  SELECT coalesce((s.value #>> '{}')::numeric, 0) INTO v_fee_percent
  FROM public.admin_settings s WHERE s.key = 'withdrawal_fee_percent';
  IF v_fee_percent < 0 OR v_fee_percent >= 100 THEN RAISE EXCEPTION 'Invalid withdrawal fee setting'; END IF;
  IF p_amount_diamond < coalesce(v_minimum, 10000) THEN RAISE EXCEPTION 'Withdrawal amount is below the minimum'; END IF;
  IF p_method = 'agent'::public.deposit_method THEN
    SELECT a.id INTO v_agent_id
    FROM public.agent_group_memberships m
    JOIN public.agent_groups g ON g.id = m.group_id
    JOIN public.agents a ON a.id = g.agent_id AND a.status = 'active' AND a.can_approve_withdrawals
    WHERE m.user_id = p_user_id AND m.status = 'active'
    ORDER BY m.decided_at DESC NULLS LAST LIMIT 1;
    IF v_agent_id IS NULL THEN RAISE EXCEPTION 'No active withdrawal agent is assigned'; END IF;
  ELSIF p_method = 'usdt'::public.deposit_method THEN
    IF length(trim(coalesce(p_payout_details->>'address', ''))) NOT BETWEEN 8 AND 300
       OR length(trim(coalesce(p_payout_details->>'network', ''))) NOT BETWEEN 2 AND 40 THEN
      RAISE EXCEPTION 'USDT address and network are required';
    END IF;
  ELSE
    IF length(trim(coalesce(p_payout_details->>'phone', ''))) NOT BETWEEN 5 AND 40 THEN
      RAISE EXCEPTION 'A valid payout phone number is required';
    END IF;
  END IF;
  SELECT * INTO v_user FROM public.users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND OR v_user.status <> 'active' OR v_user.adult_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'Account is unavailable';
  END IF;
  IF v_user.balance_diamond < p_amount_diamond THEN RAISE EXCEPTION 'Insufficient withdrawable Diamonds'; END IF;
  v_gross := round(p_amount_diamond / v_rate, 2);
  v_fee := round(v_gross * v_fee_percent / 100, 2);
  IF v_gross <= v_fee OR v_gross - v_fee <= 0 THEN RAISE EXCEPTION 'Withdrawal amount is too small after fees'; END IF;
  INSERT INTO public.diamond_withdrawals (
    user_id, agent_id, method, payout_details, amount_diamond, amount_usd,
    fee_usd, net_usd, diamonds_per_usd, idempotency_key
  ) VALUES (
    p_user_id, v_agent_id, p_method, coalesce(p_payout_details, '{}'::jsonb),
    p_amount_diamond, v_gross, v_fee, v_gross - v_fee, v_rate, p_idempotency_key
  ) RETURNING * INTO v_withdrawal;
  PERFORM public.record_wallet_transaction(
    p_user_id, 'withdraw'::public.wallet_tx_type, -p_amount_diamond,
    'diamond', v_agent_id, 'diamond-withdrawal:' || v_withdrawal.id::text,
    'diamond_withdrawal', v_withdrawal.id,
    jsonb_build_object('amount_usd', v_gross, 'fee_usd', v_fee, 'net_usd', v_gross - v_fee),
    'withdrawal-request'
  );
  RETURN v_withdrawal;
END;
$$;
REVOKE ALL ON FUNCTION public.create_my_diamond_withdrawal(uuid, bigint, public.deposit_method, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_my_diamond_withdrawal(uuid, bigint, public.deposit_method, jsonb, text) TO service_role;

CREATE OR REPLACE FUNCTION public.clear_anonymized_wallet_withdrawals()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.anonymized_at IS NULL AND NEW.anonymized_at IS NOT NULL THEN
    UPDATE public.diamond_withdrawals SET
      payout_details = '{}'::jsonb,
      proof_url = NULL,
      external_ref = NULL,
      rejection_reason = NULL,
      status = CASE WHEN status IN ('pending', 'reviewing') THEN 'cancelled'::public.tx_status ELSE status END,
      updated_at = now()
    WHERE user_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS clear_anonymized_wallet_withdrawals ON public.users;
CREATE TRIGGER clear_anonymized_wallet_withdrawals
  AFTER UPDATE OF anonymized_at ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.clear_anonymized_wallet_withdrawals();

CREATE OR REPLACE FUNCTION public.settle_diamond_withdrawal(
  p_withdrawal_id uuid,
  p_action text,
  p_reviewer_id uuid,
  p_proof_url text DEFAULT NULL,
  p_external_ref text DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_withdrawal public.diamond_withdrawals%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_action NOT IN ('approve', 'reject') OR p_reviewer_id IS NULL THEN RAISE EXCEPTION 'Invalid review action'; END IF;
  SELECT * INTO v_withdrawal FROM public.diamond_withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Withdrawal request not found'; END IF;
  IF v_withdrawal.status = 'completed' AND p_action = 'approve' THEN
    RETURN jsonb_build_object('success', true, 'already_processed', true, 'status', 'completed');
  END IF;
  IF v_withdrawal.status = 'rejected' AND p_action = 'reject' THEN
    RETURN jsonb_build_object('success', true, 'already_processed', true, 'status', 'rejected');
  END IF;
  IF v_withdrawal.status NOT IN ('pending', 'reviewing') THEN RAISE EXCEPTION 'Withdrawal already processed'; END IF;

  IF p_action = 'reject' THEN
    PERFORM public.record_wallet_transaction(
      v_withdrawal.user_id, 'admin_adjustment'::public.wallet_tx_type,
      v_withdrawal.amount_diamond, 'diamond', v_withdrawal.agent_id,
      'diamond-withdrawal-refund:' || v_withdrawal.id::text, 'diamond_withdrawal',
      v_withdrawal.id, jsonb_build_object('reason', nullif(trim(p_reason), '')),
      'withdrawal-approve'
    );
    UPDATE public.diamond_withdrawals SET status = 'rejected',
      rejection_reason = nullif(trim(p_reason), ''), reviewed_by = p_reviewer_id,
      reviewed_at = now(), updated_at = now()
    WHERE id = p_withdrawal_id;
    INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, before, after, metadata)
    VALUES (p_reviewer_id, 'reject', 'diamond_withdrawal', p_withdrawal_id,
      to_jsonb(v_withdrawal), jsonb_build_object('status', 'rejected'),
      jsonb_build_object('reason', nullif(trim(p_reason), '')));
    RETURN jsonb_build_object('success', true, 'status', 'rejected', 'refunded_diamonds', v_withdrawal.amount_diamond);
  END IF;

  IF length(trim(coalesce(p_proof_url, ''))) NOT BETWEEN 1 AND 2000
     OR length(trim(coalesce(p_external_ref, ''))) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Payment proof and external reference are required';
  END IF;
  IF v_withdrawal.agent_id IS NOT NULL THEN
    PERFORM 1 FROM public.agents
    WHERE id = v_withdrawal.agent_id
      AND status = 'active'
      AND can_approve_withdrawals
      AND wallet_usd >= v_withdrawal.net_usd
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Assigned agent has insufficient payout funds or is inactive'; END IF;
    UPDATE public.agents
    SET wallet_usd = wallet_usd - v_withdrawal.net_usd,
        total_withdrawal_usd = total_withdrawal_usd + v_withdrawal.net_usd
    WHERE id = v_withdrawal.agent_id;
  END IF;
  UPDATE public.diamond_withdrawals SET status = 'completed',
    proof_url = trim(p_proof_url), external_ref = trim(p_external_ref),
    reviewed_by = p_reviewer_id, reviewed_at = now(), paid_at = now(), updated_at = now()
  WHERE id = p_withdrawal_id;
  UPDATE public.users SET total_withdrawn = total_withdrawn + v_withdrawal.net_usd
  WHERE id = v_withdrawal.user_id;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, before, after, metadata)
  VALUES (p_reviewer_id, 'approve', 'diamond_withdrawal', p_withdrawal_id,
    to_jsonb(v_withdrawal), jsonb_build_object('status', 'completed'),
    jsonb_build_object('paid_usd', v_withdrawal.net_usd, 'external_ref', trim(p_external_ref)));
  RETURN jsonb_build_object('success', true, 'status', 'completed', 'paid_usd', v_withdrawal.net_usd);
END;
$$;
REVOKE ALL ON FUNCTION public.settle_diamond_withdrawal(uuid, text, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_diamond_withdrawal(uuid, text, uuid, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_daily_game_points_for_user(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user public.users%ROWTYPE;
  v_award bigint;
  v_cap bigint;
  v_key text;
BEGIN
  IF p_user_id IS NULL
     OR (auth.role() <> 'service_role' AND p_user_id IS DISTINCT FROM auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  SELECT * INTO v_user FROM public.users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND OR v_user.status <> 'active' OR v_user.adult_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'الحساب غير متاح أو لم يؤكد العمر';
  END IF;
  IF v_user.game_points_claimed_at > now() - interval '24 hours' THEN
    RETURN jsonb_build_object('claimed', false, 'balance', v_user.game_points);
  END IF;
  SELECT coalesce((s.value #>> '{}')::bigint, 5000) INTO v_cap
  FROM public.admin_settings s WHERE s.key = 'free_coin_balance_cap';
  v_cap := coalesce(v_cap, 5000);
  SELECT coalesce((s.value #>> '{}')::bigint, 1000) INTO v_award
  FROM public.admin_settings s WHERE s.key = 'free_coin_daily_grant';
  v_award := least(coalesce(v_award, 1000), greatest(0, v_cap - v_user.game_points));
  IF v_award = 0 THEN
    RETURN jsonb_build_object('claimed', false, 'balance', v_user.game_points, 'at_cap', true);
  END IF;
  v_key := 'daily-grant:' || p_user_id::text || ':' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD');
  UPDATE public.users SET game_points = game_points + v_award, game_points_claimed_at = now()
  WHERE id = p_user_id;
  INSERT INTO public.game_points_ledger (user_id, event_type, amount, balance_before, balance_after, idempotency_key)
  VALUES (p_user_id, 'daily_grant', v_award, v_user.game_points, v_user.game_points + v_award, v_key);
  RETURN jsonb_build_object('claimed', true, 'granted', v_award, 'balance', v_user.game_points + v_award);
END;
$$;
REVOKE ALL ON FUNCTION public.claim_daily_game_points_for_user(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_daily_game_points_for_user(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_daily_game_points()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  RETURN public.claim_daily_game_points_for_user(auth.uid());
END;
$$;
REVOKE ALL ON FUNCTION public.claim_daily_game_points() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_daily_game_points() TO authenticated;

DROP POLICY IF EXISTS wallet_self_select ON public.wallet_transactions;
CREATE POLICY wallet_self_select ON public.wallet_transactions
  FOR SELECT TO authenticated USING (public.is_admin() OR auth.uid() = user_id);

DROP POLICY IF EXISTS deposits_self_select ON public.deposits;
CREATE POLICY deposits_self_select ON public.deposits
  FOR SELECT TO authenticated USING (public.is_admin() OR auth.uid() = user_id);

COMMIT;
