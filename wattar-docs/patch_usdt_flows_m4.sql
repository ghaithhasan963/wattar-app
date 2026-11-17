-- ============================================================================
-- 61. patch_usdt_flows_m4.sql  (M4 — الشحن والسحب USDT، القسم 13)
--
-- يبني فوق الدورة الموجودة (create_deposit_request / settle_deposit_request /
-- create_my_diamond_withdrawal / settle_diamond_withdrawal) دون تغيير التواقيع،
-- ويضيف ما تطلبه الخطة:
--   M4.1 الشبكات: trc20/bep20 فقط + تحقق صيغة العنوان + فهرس فريد على tx_hash
--          (+ فهرس فريد على مرجع الدفع لكل وسيلة) + رسوم شحن قابلة للإدارة
--   M4.2 آلة الحالات: الحالات السبع كاملة (أُضيفت processing إلى tx_status في
--          الملف التمهيدي) + سبب إلزامي عند الرفض/الفشل
--   M4.3 مراجعة إدارية: أفعال review/request_info/reject/approve/fail/processing
--          + سجل تدقيق (موجود) + إشعار المستخدم (زناد create_wattar_event_notification
--          يغطي deposits وdiamond_withdrawals)
--   M4.4 الشحن: يدوي بمراجعة (D7) — كما هو
--   M4.5 السحب: أهلية (مضيفة موثقة نشطة، D8) + سقف يومي + إثبات دفع عند الاعتماد
--          + منع احتساب مزدوج (idempotency + فهارس فريدة)
--   M4.6 المفاتيح: usdt_wallets لعناوين الاستلام العامة فقط (لا مفاتيح خاصة إطلاقًا)
--          + تجميد جدول withdrawals القديم (سحب Coin ممنوع نهائيًا — قرار D1)
-- ============================================================================

begin;

select set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);

-- ============================================================================
-- 61.1 قيود الشبكة (M4.1)
-- ============================================================================
alter table public.deposits
  drop constraint if exists deposits_usdt_network_check;
alter table public.deposits
  add constraint deposits_usdt_network_check
  check (usdt_network is null or usdt_network in ('trc20', 'bep20'));

-- ============================================================================
-- 61.2 فهارس فريدة تمنع احتساب التحويل مرتين (M4.1/M4.5)
-- ============================================================================
create unique index if not exists idx_deposits_usdt_tx_hash
  on public.deposits (usdt_tx_hash) where usdt_tx_hash is not null;

create unique index if not exists idx_deposits_method_extref
  on public.deposits (method, lower(external_ref));

create unique index if not exists idx_diamond_withdrawals_extref
  on public.diamond_withdrawals (external_ref) where external_ref is not null;

-- ============================================================================
-- 61.3 الإعدادات (M4.1/M4.6)
-- ============================================================================
insert into public.admin_settings (key, value, description, is_public)
values ('deposit_fee_percent', '0'::jsonb,
        'رسوم الشحن من المنصة كنسبة مئوية (الافتراضي 0 — رسوم شبكة USDT يتحملها المرسل على السلسلة، قرار D7).', false)
on conflict (key) do nothing;

delete from public.admin_settings where key = 'min_withdrawal_gold';

update public.admin_settings
set description = 'عناوين محافظ USDT لاستلام الشحن فقط بصيغة {"trc20":"T…","bep20":"0x…"} — عناوين عامة للاستلام فقط، لا تُخزَّن مفاتيح خاصة هنا أو في أي مكان داخل النظام (القسم 13).',
    updated_at = now()
where key = 'usdt_wallets';

-- ============================================================================
-- 61.4 create_deposit_request — إعادة كتابة بنفس التوقيع
--   جديد: تحقق شبكة/عنوان/هاش USDT + منع تكرار tx_hash + رسوم شحن اختيارية
-- ============================================================================
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

-- ============================================================================
-- 61.5 settle_deposit_request — إعادة كتابة بنفس التوقيع (آلة الحالات M4.2/M4.3)
--   أفعال: review / request_info / reject / approve / fail
-- ============================================================================
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

-- ============================================================================
-- 61.6 create_my_diamond_withdrawal — إعادة كتابة بنفس التوقيع
--   جديد: أهلية مضيفة موثقة (D8/M4.5) + طرق USDT/الوكيل فقط (القسم 13) +
--         شبكة/عنوان صارمين + سقف يومي بالدولار
-- ============================================================================
create or replace function public.create_my_diamond_withdrawal(
  p_user_id uuid,
  p_amount_diamond bigint,
  p_method public.deposit_method,
  p_payout_details jsonb,
  p_idempotency_key text
) returns public.diamond_withdrawals
language plpgsql
security definer
set search_path = public
as $$
DECLARE
  v_user public.users%ROWTYPE;
  v_existing public.diamond_withdrawals%ROWTYPE;
  v_agent_id uuid;
  v_rate numeric(14,6);
  v_minimum bigint;
  v_fee_percent numeric(8,4);
  v_gross numeric(14,2);
  v_fee numeric(14,2);
  v_max_daily numeric(14,2);
  v_daily_total numeric(14,2);
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

  -- M4.5/D8: السحب حصراً للمضيفات الموثقات النشطات
  IF NOT EXISTS (
    SELECT 1 FROM public.verified_hosts vh
    WHERE vh.user_id = p_user_id AND vh.status = 'active'
  ) THEN RAISE EXCEPTION 'Withdrawals are available to active verified hosts only'; END IF;

  -- القسم 13: السحب عبر USDT (TRC20/BEP20) أو عبر الوكيل للمستخدمين التابعين
  IF p_method NOT IN ('usdt'::public.deposit_method, 'agent'::public.deposit_method) THEN
    RAISE EXCEPTION 'Withdrawals support USDT or assigned agent only';
  END IF;

  SELECT (s.value #>> '{}')::numeric INTO v_rate
  FROM public.admin_settings s WHERE s.key = 'diamonds_per_usd';
  IF coalesce(v_rate, 0) <= 0 THEN RAISE EXCEPTION 'Withdrawal rate is not configured'; END IF;
  SELECT coalesce((s.value #>> '{}')::bigint, 30000) INTO v_minimum
  FROM public.admin_settings s WHERE s.key = 'min_withdrawal_diamonds';
  SELECT coalesce((s.value #>> '{}')::numeric, 0) INTO v_fee_percent
  FROM public.admin_settings s WHERE s.key = 'withdrawal_fee_percent';
  IF v_fee_percent < 0 OR v_fee_percent >= 100 THEN RAISE EXCEPTION 'Invalid withdrawal fee setting'; END IF;
  IF p_amount_diamond < coalesce(v_minimum, 30000) THEN RAISE EXCEPTION 'Withdrawal amount is below the minimum'; END IF;

  IF p_method = 'agent'::public.deposit_method THEN
    SELECT a.id INTO v_agent_id
    FROM public.agent_group_memberships m
    JOIN public.agent_groups g ON g.id = m.group_id
    JOIN public.agents a ON a.id = g.agent_id AND a.status = 'active' AND a.can_approve_withdrawals
    WHERE m.user_id = p_user_id AND m.status = 'active'
    ORDER BY m.decided_at DESC NULLS LAST LIMIT 1;
    IF v_agent_id IS NULL THEN RAISE EXCEPTION 'No active withdrawal agent is assigned'; END IF;
  ELSE
    -- M4.1: شبكة TRC20/BEP20 فقط مع تحقق صيغة العنوان
    IF coalesce(p_payout_details->>'network', '') NOT IN ('trc20', 'bep20') THEN
      RAISE EXCEPTION 'USDT withdrawals require network trc20 or bep20';
    END IF;
    IF (p_payout_details->>'network') = 'trc20' THEN
      IF coalesce(p_payout_details->>'address', '') !~ '^T[1-9A-HJ-NP-Za-km-z]{33}$' THEN
        RAISE EXCEPTION 'Invalid TRC20 payout address';
      END IF;
    ELSE
      IF coalesce(p_payout_details->>'address', '') !~ '^0x[0-9a-fA-F]{40}$' THEN
        RAISE EXCEPTION 'Invalid BEP20 payout address';
      END IF;
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

  -- M4.5: سقف السحب اليومي بالدولار (إعداد إداري)
  SELECT coalesce((s.value #>> '{}')::numeric, 500) INTO v_max_daily
  FROM public.admin_settings s WHERE s.key = 'max_withdrawal_usd_per_day';
  v_max_daily := coalesce(v_max_daily, 500);
  SELECT coalesce(sum(w.amount_usd), 0) INTO v_daily_total
  FROM public.diamond_withdrawals w
  WHERE w.user_id = p_user_id AND w.created_at >= date_trunc('day', now())
    AND w.status IN ('pending', 'reviewing', 'approved', 'processing', 'completed');
  IF v_daily_total + v_gross > v_max_daily THEN
    RAISE EXCEPTION 'Daily withdrawal limit exceeded';
  END IF;

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

-- ============================================================================
-- 61.7 settle_diamond_withdrawal — إعادة كتابة بنفس التوقيع (آلة الحالات)
--   أفعال: review / request_info / reject / processing / approve / fail
--   الرفض/الفشل يعيدان الـDiamond للمستخدم عبر قيد عكسي + سبب إلزامي
-- ============================================================================
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

-- ============================================================================
-- 61.8 تجميد جدول withdrawals القديم نهائيًا (قرار D1: Coin لا يُسحب أبدًا)
--   الجدول فارغ ويُبقى للأرشفة فقط؛ أي محاولة كتابة تُرفض.
-- ============================================================================
create or replace function public.freeze_gold_withdrawals() returns trigger
language plpgsql
as $$
BEGIN
  RAISE EXCEPTION 'Gold (Coin) withdrawals are permanently disabled (decision D1). Use diamond_withdrawals.';
END;
$$;

drop trigger if exists trg_freeze_gold_withdrawals on public.withdrawals;
create trigger trg_freeze_gold_withdrawals
  before insert or update or delete on public.withdrawals
  for each row execute function public.freeze_gold_withdrawals();

-- ============================================================================
-- 61.9 P8: الدوال المالية للخدمة فقط
-- ============================================================================
revoke execute on function public.create_deposit_request(uuid, public.deposit_method, numeric, text, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.settle_deposit_request(uuid, text, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.settle_diamond_withdrawal(uuid, text, uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.create_my_diamond_withdrawal(uuid, bigint, public.deposit_method, jsonb, text) from public;
grant execute on function public.create_deposit_request(uuid, public.deposit_method, numeric, text, text, text, text, text, text, text, text) to service_role;
grant execute on function public.settle_deposit_request(uuid, text, uuid, text, text) to service_role;
grant execute on function public.settle_diamond_withdrawal(uuid, text, uuid, text, text, text) to service_role;
grant execute on function public.create_my_diamond_withdrawal(uuid, bigint, public.deposit_method, jsonb, text) to service_role, authenticated;

-- ============================================================================
-- 61.10 التحقق (التوثيق في wattar-docs/MIGRATIONS_REGISTRY.md)
-- ============================================================================
select json_build_object(
  'settings', (select json_agg(json_build_object('key', key, 'value', value) order by key)
               from public.admin_settings where key in ('deposit_fee_percent','max_withdrawal_usd_per_day','min_withdrawal_diamonds','withdrawals_enabled','paid_coins_per_usd')),
  'min_withdrawal_gold_deleted', (select count(*) = 0 from public.admin_settings where key = 'min_withdrawal_gold'),
  'tx_status', (select json_agg(e.enumlabel order by e.enumsortorder) from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='tx_status'),
  'new_indexes', (select json_agg(i.relname) from pg_index ix join pg_class i on i.oid=ix.indexrelid join pg_class t on t.oid=ix.indrelid join pg_namespace n on n.oid=t.relnamespace where n.nspname='public' and i.relname in ('idx_deposits_usdt_tx_hash','idx_deposits_method_extref','idx_diamond_withdrawals_extref')),
  'freeze_trigger', (select count(*) > 0 from pg_trigger where tgname='trg_freeze_gold_withdrawals'),
  'wallet_reconcile', public.reconcile_wallet_ledger()
) as result;

commit;