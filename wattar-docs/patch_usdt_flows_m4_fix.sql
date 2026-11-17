-- ============================================================================
-- 61f. patch_usdt_flows_m4_fix.sql
-- إصلاح كشفه اختبار M4: كان فحص تكرار tx_hash يجري قبل فحص idempotency،
-- فكانت الإعادة الآمنة لنفس طلب الشحن (نفس المفتاح) تُرفض خطأً كتكرار تحويل.
-- نُقل فحص التكرار إلى ما بعد إعادة الصف الidempotent. نفس جسم الدالة في #61.
-- ============================================================================

begin;

select set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);

create or replace function public.create_deposit_request(
  p_user_id uuid,
  p_method public.deposit_method,
  p_amount_usd numeric,
  p_external_ref text,
  p_proof_url text,
  p_idempotency_key text,
  p_sender_phone text default null,
  p_sender_name text default null,
  p_usdt_network text default null,
  p_usdt_tx_hash text default null,
  p_usdt_from_address text default null
) returns public.deposits
language plpgsql
security definer
set search_path = public
as $$
DECLARE
  v_existing public.deposits%ROWTYPE;
  v_method public.deposit_methods%ROWTYPE;
  v_agent_id uuid;
  v_rate numeric(10,2);
  v_fee_percent numeric(8,4);
  v_fee_usd numeric(14,2);
  v_amount_usd numeric(14,2);
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

  -- M4.1: شبكات USDT محصورة بـ TRC20/BEP20 مع تحقق الصيغة
  IF p_method = 'usdt'::public.deposit_method THEN
    IF coalesce(p_usdt_network, '') NOT IN ('trc20', 'bep20') THEN
      RAISE EXCEPTION 'USDT deposits require network trc20 or bep20';
    END IF;
    IF p_usdt_network = 'trc20' THEN
      IF p_usdt_tx_hash IS NULL OR p_usdt_tx_hash !~ '^[0-9a-fA-F]{64}$' THEN
        RAISE EXCEPTION 'Invalid TRC20 transaction hash';
      END IF;
      IF p_usdt_from_address IS NOT NULL AND p_usdt_from_address !~ '^T[1-9A-HJ-NP-Za-km-z]{33}$' THEN
        RAISE EXCEPTION 'Invalid TRC20 sender address';
      END IF;
    ELSE
      IF p_usdt_tx_hash IS NULL OR p_usdt_tx_hash !~ '^0x[0-9a-fA-F]{64}$' THEN
        RAISE EXCEPTION 'Invalid BEP20 transaction hash';
      END IF;
      IF p_usdt_from_address IS NOT NULL AND p_usdt_from_address !~ '^0x[0-9a-fA-F]{40}$' THEN
        RAISE EXCEPTION 'Invalid BEP20 sender address';
      END IF;
    END IF;
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

  -- منع احتساب نفس تحويل USDT مرتين (بعد فحص idempotency حتى تمر الإعادة الآمنة)
  IF p_method = 'usdt'::public.deposit_method THEN
    PERFORM pg_advisory_xact_lock(hashtext('usdt-tx:' || lower(p_usdt_tx_hash)));
    IF EXISTS (SELECT 1 FROM public.deposits d WHERE d.usdt_tx_hash = p_usdt_tx_hash) THEN
      RAISE EXCEPTION 'This USDT transaction was already submitted';
    END IF;
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
    AND d.status IN ('pending', 'reviewing', 'approved', 'processing', 'completed');
  IF v_daily_total + p_amount_usd > v_max_daily THEN RAISE EXCEPTION 'Daily deposit limit exceeded'; END IF;

  -- M4.1: رسوم شحن قابلة للإدارة (الافتراضي 0 — لا تغيير في السلوك الحالي)
  SELECT coalesce((s.value #>> '{}')::numeric, 0) INTO v_fee_percent
  FROM public.admin_settings s WHERE s.key = 'deposit_fee_percent';
  IF v_fee_percent < 0 OR v_fee_percent >= 100 THEN RAISE EXCEPTION 'Invalid deposit fee setting'; END IF;
  v_fee_usd := round(p_amount_usd * v_fee_percent / 100, 2);
  v_amount_usd := round(p_amount_usd - v_fee_usd, 2);
  IF v_amount_usd <= 0 THEN RAISE EXCEPTION 'Deposit amount is too small after fees'; END IF;

  v_amount_coins := floor(v_amount_usd * v_rate)::bigint;
  IF v_amount_coins <= 0 THEN RAISE EXCEPTION 'Deposit amount is too small'; END IF;
  INSERT INTO public.deposits (
    user_id, agent_id, method, amount_usd, amount_gold, fee_usd, external_ref, proof_url,
    sender_phone, sender_name, usdt_network, usdt_tx_hash, usdt_from_address,
    status, metadata, idempotency_key
  ) VALUES (
    p_user_id, v_agent_id, p_method, p_amount_usd, v_amount_coins, v_fee_usd,
    trim(p_external_ref), trim(p_proof_url), nullif(trim(p_sender_phone), ''),
    nullif(trim(p_sender_name), ''), nullif(trim(p_usdt_network), ''),
    nullif(trim(p_usdt_tx_hash), ''), nullif(trim(p_usdt_from_address), ''),
    'pending', jsonb_build_object('exchange_rate_usd_to_coins', v_rate,
                                  'deposit_fee_percent', v_fee_percent,
                                  'credited_amount_usd', v_amount_usd), p_idempotency_key
  ) RETURNING * INTO v_deposit;
  RETURN v_deposit;
END;
$$;

revoke execute on function public.create_deposit_request(uuid, public.deposit_method, numeric, text, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.create_deposit_request(uuid, public.deposit_method, numeric, text, text, text, text, text, text, text, text) to service_role;

select json_build_object('fix_applied', true,
  'wallet_reconcile', public.reconcile_wallet_ledger()) as result;

commit;
