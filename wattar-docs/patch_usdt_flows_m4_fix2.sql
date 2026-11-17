-- ============================================================================
-- 61f2. patch_usdt_flows_m4_fix2.sql
-- إصلاح كشفه اختبار M4: عمود action في admin_audit_log من نوع audit_action_type،
-- وكانت الدالتان تمرران p_action نصًا بلا cast. أُضيفت القيم الجديدة
-- (review/request_info/processing/fail) إلى enum في patch_usdt_flows_m4_prep2.sql.
-- هنا إعادة تطبيق دالتي التسوية بالـcast الصحيح. نفس جسدي الدالتين في #61.
-- ============================================================================

begin;

select set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);

create or replace function public.settle_deposit_request(
  p_deposit_id uuid,
  p_action text,
  p_reviewer_id uuid,
  p_reason text default null,
  p_notes text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
DECLARE
  v_deposit public.deposits%ROWTYPE;
  v_agent public.agents%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_reviewer_id IS NULL THEN RAISE EXCEPTION 'Reviewer is required'; END IF;

  SELECT * INTO v_deposit FROM public.deposits WHERE id = p_deposit_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Deposit request not found'; END IF;

  IF p_action = 'approve' THEN
    IF v_deposit.status = 'completed' THEN
      RETURN jsonb_build_object('success', true, 'already_processed', true,
        'status', v_deposit.status, 'credited_coins', v_deposit.amount_gold);
    END IF;
    IF v_deposit.status NOT IN ('pending', 'reviewing') THEN
      RAISE EXCEPTION 'Deposit request has already been processed';
    END IF;
  ELSIF p_action IN ('reject', 'fail') THEN
    -- M4.2: سبب إلزامي عند الرفض/الفشل
    IF length(trim(coalesce(p_reason, ''))) < 3 THEN
      RAISE EXCEPTION 'A rejection reason is required';
    END IF;
    IF v_deposit.status IN ('rejected', 'failed') THEN
      RETURN jsonb_build_object('success', true, 'already_processed', true, 'status', v_deposit.status);
    END IF;
    IF v_deposit.status NOT IN ('pending', 'reviewing') THEN
      RAISE EXCEPTION 'Deposit request has already been processed';
    END IF;
  ELSIF p_action = 'review' THEN
    IF v_deposit.status <> 'pending' THEN
      RAISE EXCEPTION 'Only pending deposits can be marked under review';
    END IF;
  ELSIF p_action = 'request_info' THEN
    IF length(trim(coalesce(p_notes, '') || coalesce(p_reason, ''))) < 3 THEN
      RAISE EXCEPTION 'Information request message is required';
    END IF;
    IF v_deposit.status NOT IN ('pending', 'reviewing') THEN
      RAISE EXCEPTION 'Deposit request has already been processed';
    END IF;
  ELSE
    RAISE EXCEPTION 'Invalid deposit review action';
  END IF;

  -- review / request_info: انتقال إلى Under Review (يُشعر المستخدم عبر الزناد)
  IF p_action IN ('review', 'request_info') THEN
    UPDATE public.deposits SET status = 'reviewing',
      admin_notes = coalesce(nullif(trim(p_notes), ''), nullif(trim(p_reason), ''), admin_notes),
      assigned_to = coalesce(assigned_to, p_reviewer_id),
      updated_at = now()
    WHERE id = p_deposit_id;
    INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, before, after, metadata)
    VALUES (p_reviewer_id, p_action::public.audit_action_type, 'deposit', p_deposit_id, to_jsonb(v_deposit),
      jsonb_build_object('status', 'reviewing'),
      jsonb_build_object('notes', coalesce(nullif(trim(p_notes), ''), nullif(trim(p_reason), ''))));
    RETURN jsonb_build_object('success', true, 'status', 'reviewing');
  END IF;

  IF p_action IN ('reject', 'fail') THEN
    UPDATE public.deposits SET status = CASE p_action WHEN 'reject' THEN 'rejected'::public.tx_status ELSE 'failed'::public.tx_status END,
      rejected_reason = nullif(trim(p_reason), ''), admin_notes = nullif(trim(p_notes), ''),
      reviewed_by = p_reviewer_id, reviewed_at = now(), updated_at = now()
    WHERE id = p_deposit_id;
    INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, before, after, metadata)
    VALUES (p_reviewer_id, p_action::public.audit_action_type, 'deposit', p_deposit_id, to_jsonb(v_deposit),
      jsonb_build_object('status', CASE p_action WHEN 'reject' THEN 'rejected' ELSE 'failed' END),
      jsonb_build_object('reason', nullif(trim(p_reason), '')));
    RETURN jsonb_build_object('success', true, 'status', CASE p_action WHEN 'reject' THEN 'rejected' ELSE 'failed' END);
  END IF;

  -- approve (تنفيذ فوري: اعتماد + إضافة الرصيد + إكمال في خطوة ذرّية واحدة)
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
    jsonb_build_object('method', v_deposit.method, 'amount_usd', v_deposit.amount_usd,
                       'fee_usd', v_deposit.fee_usd),
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
    completed_at = now(), admin_notes = nullif(trim(p_notes), ''), updated_at = now()
  WHERE id = p_deposit_id;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, before, after, metadata)
  VALUES (p_reviewer_id, 'approve', 'deposit', p_deposit_id, to_jsonb(v_deposit),
    jsonb_build_object('status', 'completed', 'credited_coins', v_deposit.amount_gold),
    jsonb_build_object('agent_inventory_debited', v_deposit.agent_id IS NOT NULL));

  RETURN jsonb_build_object('success', true, 'status', 'completed',
    'credited_coins', v_deposit.amount_gold, 'agent_inventory_debited', v_deposit.agent_id IS NOT NULL);
END;
$$;

create or replace function public.settle_diamond_withdrawal(
  p_withdrawal_id uuid,
  p_action text,
  p_reviewer_id uuid,
  p_proof_url text default null,
  p_external_ref text default null,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
DECLARE
  v_withdrawal public.diamond_withdrawals%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_reviewer_id IS NULL THEN RAISE EXCEPTION 'Reviewer is required'; END IF;

  SELECT * INTO v_withdrawal FROM public.diamond_withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Withdrawal request not found'; END IF;

  IF p_action = 'approve' THEN
    IF v_withdrawal.status = 'completed' THEN
      RETURN jsonb_build_object('success', true, 'already_processed', true, 'status', 'completed');
    END IF;
    IF v_withdrawal.status NOT IN ('pending', 'reviewing', 'processing') THEN
      RAISE EXCEPTION 'Withdrawal already processed';
    END IF;
  ELSIF p_action IN ('reject', 'fail') THEN
    IF length(trim(coalesce(p_reason, ''))) < 3 THEN
      RAISE EXCEPTION 'A rejection reason is required';
    END IF;
    IF v_withdrawal.status IN ('rejected', 'failed') THEN
      RETURN jsonb_build_object('success', true, 'already_processed', true, 'status', v_withdrawal.status);
    END IF;
    IF v_withdrawal.status NOT IN ('pending', 'reviewing', 'processing') THEN
      RAISE EXCEPTION 'Withdrawal already processed';
    END IF;
  ELSIF p_action = 'processing' THEN
    IF v_withdrawal.status NOT IN ('pending', 'reviewing', 'approved') THEN
      RAISE EXCEPTION 'Withdrawal cannot move to processing from its current state';
    END IF;
  ELSIF p_action = 'review' THEN
    IF v_withdrawal.status <> 'pending' THEN
      RAISE EXCEPTION 'Only pending withdrawals can be marked under review';
    END IF;
  ELSIF p_action = 'request_info' THEN
    IF length(trim(coalesce(p_reason, ''))) < 3 THEN
      RAISE EXCEPTION 'Information request message is required';
    END IF;
    IF v_withdrawal.status NOT IN ('pending', 'reviewing') THEN
      RAISE EXCEPTION 'Withdrawal already processed';
    END IF;
  ELSE
    RAISE EXCEPTION 'Invalid review action';
  END IF;

  IF p_action IN ('review', 'request_info') THEN
    UPDATE public.diamond_withdrawals SET status = 'reviewing',
      reviewed_by = coalesce(reviewed_by, p_reviewer_id), updated_at = now()
    WHERE id = p_withdrawal_id;
    INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, before, after, metadata)
    VALUES (p_reviewer_id, p_action::public.audit_action_type, 'diamond_withdrawal', p_withdrawal_id,
      to_jsonb(v_withdrawal), jsonb_build_object('status', 'reviewing'),
      jsonb_build_object('message', trim(p_reason)));
    RETURN jsonb_build_object('success', true, 'status', 'reviewing');
  END IF;

  IF p_action = 'processing' THEN
    UPDATE public.diamond_withdrawals SET status = 'processing',
      reviewed_by = p_reviewer_id, reviewed_at = now(), updated_at = now()
    WHERE id = p_withdrawal_id;
    INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, before, after, metadata)
    VALUES (p_reviewer_id, 'processing', 'diamond_withdrawal', p_withdrawal_id,
      to_jsonb(v_withdrawal), jsonb_build_object('status', 'processing'), NULL);
    RETURN jsonb_build_object('success', true, 'status', 'processing');
  END IF;

  IF p_action IN ('reject', 'fail') THEN
    PERFORM public.record_wallet_transaction(
      v_withdrawal.user_id, 'admin_adjustment'::public.wallet_tx_type,
      v_withdrawal.amount_diamond, 'diamond', v_withdrawal.agent_id,
      'diamond-withdrawal-refund:' || v_withdrawal.id::text, 'diamond_withdrawal',
      v_withdrawal.id, jsonb_build_object('reason', trim(p_reason), 'action', p_action),
      'withdrawal-approve'
    );
    UPDATE public.diamond_withdrawals SET status = CASE p_action WHEN 'reject' THEN 'rejected'::public.tx_status ELSE 'failed'::public.tx_status END,
      rejection_reason = trim(p_reason), reviewed_by = p_reviewer_id,
      reviewed_at = now(), updated_at = now()
    WHERE id = p_withdrawal_id;
    INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, before, after, metadata)
    VALUES (p_reviewer_id, p_action::public.audit_action_type, 'diamond_withdrawal', p_withdrawal_id,
      to_jsonb(v_withdrawal),
      jsonb_build_object('status', CASE p_action WHEN 'reject' THEN 'rejected' ELSE 'failed' END),
      jsonb_build_object('reason', trim(p_reason)));
    RETURN jsonb_build_object('success', true,
      'status', CASE p_action WHEN 'reject' THEN 'rejected' ELSE 'failed' END,
      'refunded_diamonds', v_withdrawal.amount_diamond);
  END IF;

  -- approve = التنفيذ النهائي (يستلزم إثبات الدفع ومرجعه — M4.5)
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

revoke execute on function public.settle_deposit_request(uuid, text, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.settle_diamond_withdrawal(uuid, text, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.settle_deposit_request(uuid, text, uuid, text, text) to service_role;
grant execute on function public.settle_diamond_withdrawal(uuid, text, uuid, text, text, text) to service_role;

select json_build_object('fix_applied', true,
  'wallet_reconcile', public.reconcile_wallet_ledger()) as result;

commit;
