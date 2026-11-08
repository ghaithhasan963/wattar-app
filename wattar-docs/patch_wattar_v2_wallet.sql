-- Wattar v2 Coins and manual deposits.
-- Run after wattar_schema.sql, patch_social_foundation.sql,
-- and patch_wattar_v2_social.sql.

CREATE TABLE IF NOT EXISTS public.deposit_methods (
  method public.deposit_method PRIMARY KEY,
  name_ar varchar(80) NOT NULL,
  instructions text NOT NULL DEFAULT '',
  is_enabled boolean NOT NULL DEFAULT false,
  min_amount_usd numeric(14,2) NOT NULL DEFAULT 1,
  max_amount_usd numeric(14,2) NOT NULL DEFAULT 2000,
  exchange_rate_usd_to_coins numeric(10,2),
  sort_order integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT deposit_method_amount_limits
    CHECK (min_amount_usd > 0 AND max_amount_usd >= min_amount_usd),
  CONSTRAINT deposit_method_exchange_rate_positive
    CHECK (exchange_rate_usd_to_coins IS NULL OR exchange_rate_usd_to_coins > 0)
);

INSERT INTO public.deposit_methods (method, name_ar, instructions, is_enabled, sort_order)
VALUES
  ('usdt', 'USDT', '', false, 1),
  ('sham_cash', 'شام كاش', '', false, 2),
  ('syriatel_cash', 'سيريتل كاش', '', false, 3),
  ('agent', 'عن طريق الوكيل', '', false, 4)
ON CONFLICT (method) DO NOTHING;

ALTER TABLE public.deposit_methods ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.deposit_methods FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.deposit_methods TO authenticated;
DROP POLICY IF EXISTS wattar_deposit_methods_admin_manage ON public.deposit_methods;
CREATE POLICY wattar_deposit_methods_admin_manage
  ON public.deposit_methods FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

ALTER TABLE public.deposits
  ADD COLUMN IF NOT EXISTS idempotency_key varchar(100);

CREATE UNIQUE INDEX IF NOT EXISTS idx_deposits_idempotency_key
  ON public.deposits (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE public.gift_transactions
  ADD COLUMN IF NOT EXISTS idempotency_key varchar(100);

CREATE UNIQUE INDEX IF NOT EXISTS idx_gift_transactions_idempotency_key
  ON public.gift_transactions (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

DROP POLICY IF EXISTS wallet_self_select ON public.wallet_transactions;
CREATE POLICY wallet_self_select ON public.wallet_transactions
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR (
      auth.uid() = user_id
      AND (
      EXISTS (
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
    )
  );

DROP POLICY IF EXISTS deposits_self_select ON public.deposits;
CREATE POLICY deposits_self_select ON public.deposits
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR (
      auth.uid() = user_id
      AND (
        EXISTS (
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
    )
  );

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
  WHERE d.is_enabled
    AND EXISTS (
      SELECT 1 FROM public.admin_settings s
      WHERE s.key = 'deposits_enabled' AND s.value = 'true'::jsonb
    )
    AND auth.uid() IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.agent_group_memberships m
        JOIN public.agent_groups g ON g.id = m.group_id
        JOIN public.agents a ON a.id = g.agent_id AND a.status = 'active'
        JOIN public.users u ON u.id = m.user_id AND u.status = 'active'
        WHERE m.user_id = auth.uid() AND m.status = 'active'
      )
      OR EXISTS (
        SELECT 1 FROM public.agents a
        WHERE a.user_id = auth.uid() AND a.status = 'active'
      )
    )
  ORDER BY d.sort_order, d.name_ar;
$$;
REVOKE ALL ON FUNCTION public.list_my_deposit_methods() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_my_deposit_methods() TO authenticated;

CREATE OR REPLACE FUNCTION public.create_deposit_request(
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
  v_deposits_enabled boolean;
  v_deposit public.deposits%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_user_id IS NULL
     OR p_method IS NULL
     OR p_amount_usd IS NULL
     OR p_amount_usd <= 0
     OR length(trim(coalesce(p_external_ref, ''))) NOT BETWEEN 1 AND 200
     OR length(trim(coalesce(p_proof_url, ''))) NOT BETWEEN 1 AND 2000
     OR length(trim(coalesce(p_idempotency_key, ''))) NOT BETWEEN 10 AND 100 THEN
    RAISE EXCEPTION 'Invalid deposit request';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('deposit-request:' || p_idempotency_key));
  SELECT d.* INTO v_existing
  FROM public.deposits d
  WHERE d.idempotency_key = p_idempotency_key
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.user_id <> p_user_id
       OR v_existing.method <> p_method
       OR v_existing.amount_usd <> p_amount_usd
       OR v_existing.external_ref <> trim(p_external_ref) THEN
      RAISE EXCEPTION 'Idempotency key reused with different request data';
    END IF;
    RETURN v_existing;
  END IF;

  SELECT s.value = 'true'::jsonb
  INTO v_deposits_enabled
  FROM public.admin_settings s
  WHERE s.key = 'deposits_enabled';
  IF coalesce(v_deposits_enabled, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Deposits are currently disabled';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_method::text || ':' || lower(trim(p_external_ref))));
  IF EXISTS (
    SELECT 1 FROM public.deposits d
    WHERE d.method = p_method AND lower(d.external_ref) = lower(trim(p_external_ref))
  ) THEN
    RAISE EXCEPTION 'Duplicate payment reference';
  END IF;

  SELECT a.id, a.exchange_rate_usd_to_gold
  INTO v_agent_id, v_rate
  FROM public.agent_group_memberships m
  JOIN public.agent_groups g ON g.id = m.group_id
  JOIN public.agents a ON a.id = g.agent_id AND a.status = 'active'
  JOIN public.users u ON u.id = m.user_id AND u.status = 'active'
  WHERE m.user_id = p_user_id AND m.status = 'active'
  FOR UPDATE OF a;
  IF v_agent_id IS NULL THEN
    SELECT a.id, a.exchange_rate_usd_to_gold
    INTO v_agent_id, v_rate
    FROM public.agents a
    WHERE a.user_id = p_user_id AND a.status = 'active'
    FOR UPDATE;
  END IF;
  IF v_agent_id IS NULL THEN
    RAISE EXCEPTION 'An active approved agent is required to use the wallet';
  END IF;

  SELECT d.* INTO v_method
  FROM public.deposit_methods d
  WHERE d.method = p_method AND d.is_enabled
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Deposit method is unavailable'; END IF;
  IF p_amount_usd < v_method.min_amount_usd OR p_amount_usd > v_method.max_amount_usd THEN
    RAISE EXCEPTION 'Deposit amount is outside the configured limits';
  END IF;
  IF v_method.exchange_rate_usd_to_coins IS NOT NULL THEN
    v_rate := v_method.exchange_rate_usd_to_coins;
  END IF;
  IF v_rate IS NULL OR v_rate <= 0 THEN
    RAISE EXCEPTION 'No valid Coins exchange rate is configured';
  END IF;

  SELECT coalesce((s.value #>> '{}')::numeric, 2000)
  INTO v_max_daily
  FROM public.admin_settings s
  WHERE s.key = 'max_deposit_usd_per_day';
  v_max_daily := coalesce(v_max_daily, 2000);
  SELECT coalesce(sum(d.amount_usd), 0)
  INTO v_daily_total
  FROM public.deposits d
  WHERE d.user_id = p_user_id
    AND d.created_at >= date_trunc('day', now())
    AND d.status IN ('pending', 'reviewing', 'approved', 'completed');
  IF v_daily_total + p_amount_usd > v_max_daily THEN
    RAISE EXCEPTION 'Daily deposit limit exceeded';
  END IF;

  v_amount_coins := floor(p_amount_usd * v_rate)::bigint;
  IF v_amount_coins <= 0 THEN RAISE EXCEPTION 'Deposit amount is too small'; END IF;

  INSERT INTO public.deposits (
    user_id, agent_id, method, amount_usd, amount_gold, external_ref, proof_url,
    sender_phone, sender_name, usdt_network, usdt_tx_hash, usdt_from_address,
    status, metadata, idempotency_key
  )
  VALUES (
    p_user_id, v_agent_id, p_method, p_amount_usd, v_amount_coins,
    trim(p_external_ref), trim(p_proof_url), nullif(trim(p_sender_phone), ''),
    nullif(trim(p_sender_name), ''), nullif(trim(p_usdt_network), ''),
    nullif(trim(p_usdt_tx_hash), ''), nullif(trim(p_usdt_from_address), ''),
    'pending', jsonb_build_object('exchange_rate_usd_to_coins', v_rate),
    p_idempotency_key
  )
  RETURNING * INTO v_deposit;
  RETURN v_deposit;
END;
$$;
REVOKE ALL ON FUNCTION public.create_deposit_request(
  uuid, public.deposit_method, numeric, text, text, text, text, text, text, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_deposit_request(
  uuid, public.deposit_method, numeric, text, text, text, text, text, text, text, text
) FROM authenticated;
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
  v_commission numeric(14,2);
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_action NOT IN ('approve', 'reject') OR p_reviewer_id IS NULL THEN
    RAISE EXCEPTION 'Invalid deposit review action';
  END IF;
  SELECT d.* INTO v_deposit
  FROM public.deposits d
  WHERE d.id = p_deposit_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Deposit request not found'; END IF;

  IF v_deposit.status = 'completed' AND p_action = 'approve' THEN
    RETURN jsonb_build_object(
      'success', true, 'already_processed', true,
      'status', v_deposit.status, 'credited_coins', v_deposit.amount_gold
    );
  END IF;
  IF v_deposit.status NOT IN ('pending', 'reviewing') THEN
    RAISE EXCEPTION 'Deposit request has already been processed';
  END IF;

  IF p_action = 'reject' THEN
    UPDATE public.deposits
    SET status = 'rejected',
        rejected_reason = nullif(trim(p_reason), ''),
        admin_notes = nullif(trim(p_notes), ''),
        reviewed_by = p_reviewer_id,
        reviewed_at = now()
    WHERE id = p_deposit_id;
    INSERT INTO public.admin_audit_log (
      admin_id, action, target_type, target_id, before, after, metadata
    )
    VALUES (
      p_reviewer_id, 'reject', 'deposit', p_deposit_id, to_jsonb(v_deposit),
      jsonb_build_object('status', 'rejected'),
      jsonb_build_object('reason', nullif(trim(p_reason), ''))
    );
    RETURN jsonb_build_object('success', true, 'status', 'rejected');
  END IF;

  IF v_deposit.agent_id IS NULL THEN
    RAISE EXCEPTION 'Deposit has no assigned agent';
  END IF;
  SELECT a.* INTO v_agent
  FROM public.agents a
  WHERE a.id = v_deposit.agent_id AND a.status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Assigned agent is not active'; END IF;

  PERFORM public.record_wallet_transaction(
    v_deposit.user_id,
    'deposit'::public.wallet_tx_type,
    v_deposit.amount_gold,
    'gold',
    v_deposit.agent_id,
    'deposit_' || v_deposit.id::text,
    'deposit',
    v_deposit.id,
    jsonb_build_object('method', v_deposit.method, 'amount_usd', v_deposit.amount_usd),
    'deposit-approve'
  );

  v_commission := round(v_deposit.amount_usd * v_agent.commission_rate / 100, 2);
  UPDATE public.agents
  SET wallet_usd = wallet_usd + v_commission,
      total_commission_usd = total_commission_usd + v_commission,
      total_deposit_usd = total_deposit_usd + v_deposit.amount_usd
  WHERE id = v_agent.id;
  UPDATE public.users
  SET total_deposited = total_deposited + v_deposit.amount_usd
  WHERE id = v_deposit.user_id AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'Deposit owner is not active'; END IF;

  UPDATE public.deposits
  SET status = 'completed',
      approved_by = p_reviewer_id,
      approved_at = now(),
      reviewed_by = p_reviewer_id,
      reviewed_at = now(),
      completed_at = now(),
      admin_notes = nullif(trim(p_notes), '')
  WHERE id = p_deposit_id;
  INSERT INTO public.admin_audit_log (
    admin_id, action, target_type, target_id, before, after, metadata
  )
  VALUES (
    p_reviewer_id, 'approve', 'deposit', p_deposit_id, to_jsonb(v_deposit),
    jsonb_build_object('status', 'completed', 'credited_coins', v_deposit.amount_gold),
    jsonb_build_object('commission_usd', v_commission)
  );

  RETURN jsonb_build_object(
    'success', true, 'status', 'completed',
    'credited_coins', v_deposit.amount_gold,
    'commission_usd', v_commission
  );
END;
$$;
REVOKE ALL ON FUNCTION public.settle_deposit_request(uuid, text, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.settle_deposit_request(uuid, text, uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.settle_deposit_request(uuid, text, uuid, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.settle_gift_send(
  p_from_user_id uuid,
  p_to_user_id uuid,
  p_gift_id uuid,
  p_quantity integer,
  p_room_id uuid,
  p_message text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing public.gift_transactions%ROWTYPE;
  v_gift public.gifts%ROWTYPE;
  v_agent_id uuid;
  v_total_coins bigint;
  v_received_diamonds bigint;
  v_gift_transaction_id uuid := gen_random_uuid();
  v_gift_transaction public.gift_transactions%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_from_user_id IS NULL OR p_to_user_id IS NULL OR p_from_user_id = p_to_user_id
     OR p_quantity NOT BETWEEN 1 AND 100
     OR length(trim(coalesce(p_idempotency_key, ''))) NOT BETWEEN 10 AND 90
     OR length(coalesce(p_message, '')) > 500 THEN
    RAISE EXCEPTION 'Invalid gift request';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('gift-send:' || p_idempotency_key));
  SELECT gt.* INTO v_existing FROM public.gift_transactions gt
  WHERE gt.idempotency_key = p_idempotency_key
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.from_user_id <> p_from_user_id
       OR v_existing.to_user_id <> p_to_user_id
       OR v_existing.gift_id <> p_gift_id
       OR v_existing.quantity <> p_quantity
       OR v_existing.room_id IS DISTINCT FROM p_room_id
       OR v_existing.message IS DISTINCT FROM nullif(trim(p_message), '') THEN
      RAISE EXCEPTION 'Idempotency key already used';
    END IF;
    RETURN jsonb_build_object(
      'success', true, 'already_processed', true,
      'gift_transaction', to_jsonb(v_existing),
      'sent_coins', v_existing.total_gold,
      'received_diamonds', v_existing.received_diamond
    );
  END IF;

  SELECT a.id INTO v_agent_id
  FROM public.agent_group_memberships m
  JOIN public.agent_groups g ON g.id = m.group_id
  JOIN public.agents a ON a.id = g.agent_id AND a.status = 'active'
  WHERE m.user_id = p_from_user_id AND m.status = 'active';
  IF v_agent_id IS NULL THEN
    RAISE EXCEPTION 'An active approved agent is required to send gifts';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_from_user_id AND u.status = 'active')
     OR NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_to_user_id AND u.status = 'active') THEN
    RAISE EXCEPTION 'Sender or recipient is unavailable';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.user_blocks b
    WHERE (b.blocker_id = p_from_user_id AND b.blocked_id = p_to_user_id)
       OR (b.blocker_id = p_to_user_id AND b.blocked_id = p_from_user_id)
  ) THEN
    RAISE EXCEPTION 'Cannot send a gift to this user';
  END IF;

  PERFORM 1 FROM public.users u
  WHERE u.id IN (p_from_user_id, p_to_user_id)
  ORDER BY u.id
  FOR UPDATE;

  SELECT g.* INTO v_gift
  FROM public.gifts g
  WHERE g.id = p_gift_id AND g.is_active
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Gift is not available'; END IF;

  v_total_coins := v_gift.price_gold * p_quantity;
  v_received_diamonds := floor(v_total_coins * v_gift.recipient_diamond_ratio / 100)::bigint;
  IF v_total_coins <= 0 OR v_received_diamonds <= 0 THEN
    RAISE EXCEPTION 'Gift value is invalid';
  END IF;

  PERFORM public.record_wallet_transaction(
    p_from_user_id,
    'gift_sent'::public.wallet_tx_type,
    -v_total_coins,
    'gold',
    v_agent_id,
    p_idempotency_key || ':out',
    'gift',
    v_gift_transaction_id,
    jsonb_build_object('gift_id', p_gift_id, 'to_user_id', p_to_user_id, 'quantity', p_quantity),
    'gift-send'
  );
  PERFORM public.record_wallet_transaction(
    p_to_user_id,
    'gift_received'::public.wallet_tx_type,
    v_received_diamonds,
    'diamond',
    NULL,
    p_idempotency_key || ':in',
    'gift',
    v_gift_transaction_id,
    jsonb_build_object('gift_id', p_gift_id, 'from_user_id', p_from_user_id, 'quantity', p_quantity),
    'gift-send'
  );

  INSERT INTO public.gift_transactions (
    id, gift_id, from_user_id, to_user_id, room_id, quantity,
    total_gold, received_diamond, message, idempotency_key
  )
  VALUES (
    v_gift_transaction_id, p_gift_id, p_from_user_id, p_to_user_id, p_room_id, p_quantity,
    v_total_coins, v_received_diamonds, nullif(trim(p_message), ''), p_idempotency_key
  )
  RETURNING * INTO v_gift_transaction;

  UPDATE public.users
  SET total_gifts_sent = total_gifts_sent + v_total_coins
  WHERE id = p_from_user_id;
  UPDATE public.users
  SET total_gifts_received = total_gifts_received + v_received_diamonds
  WHERE id = p_to_user_id;
  PERFORM public.award_user_xp(
    p_to_user_id,
    'gift_received:' || v_gift_transaction_id::text,
    'gift_received',
    5
  );

  RETURN jsonb_build_object(
    'success', true,
    'gift_transaction', to_jsonb(v_gift_transaction),
    'sent_coins', v_total_coins,
    'received_diamonds', v_received_diamonds,
    'gift_name', coalesce(v_gift.name_ar, v_gift.name)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.settle_gift_send(uuid, uuid, uuid, integer, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.settle_gift_send(uuid, uuid, uuid, integer, uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.settle_gift_send(uuid, uuid, uuid, integer, uuid, text, text) TO service_role;
