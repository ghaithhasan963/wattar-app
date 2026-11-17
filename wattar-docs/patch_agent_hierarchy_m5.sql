-- ============================================================================
-- Wattar — M5.1 + M5.2: هرمية الوكالات والمحافظ التشغيلية
-- تاريخ: 2026-11-17 · القسم 14 + 25 (وجزء من 13)
--
-- ما ينفّذه هذا الملف:
--   1) جدول الوكالات (agencies) بحالات اعتماد/تعليق/إلغاء + عمولات + حدود.
--   2) ربط كل وكيل بوكالة (agents.agency_id) + حدوده التشغيلية اليومية.
--   3) دفتر مالي منفصل لكل وكيل (agent_wallet_ledger) ولكل وكالة (agency_wallet_ledger)
--      — كل تغيير في wallet_usd يمرّ عبر دالة واحدة تكتب قيداً، فلا رصيد بلا قيد.
--   4) طلبات تمويل من الإدارة (agent_funding_requests) بدورة كاملة.
--   5) توحيد سعر صرف الوكلاء على 3000 Coin/دولار (كان 1000 وهو خارج اقتصاد M3.7).
--   6) مساعدات المصالحة reconcile_* للتأكد أن الرصيد = مجموع القيود.
--
-- ملاحظات محاسبية:
--   - wallet_usd للوكيل = محفظته التشغيلية بالدولار (تدفع سحب مستخدميه، وتقبض قيمة
--     بيع Coin من مخزونها المسبق). لا يستطيع الوكيل تعديلها بنفسه إطلاقاً.
--   - wallet_usd للوكالة = محفظة تمويل؛ تُشحن من الإدارة وتُحوَّل للوكلاء.
--   - الحدود الرقمية 0 = بلا حد (موثّق صراحة في كل دالة).
-- ============================================================================
begin;

-- ---------------------------------------------------------------------------
-- 1) الوكالات
-- ---------------------------------------------------------------------------
create table if not exists public.agencies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'suspended', 'revoked')),
  owner_user_id uuid references public.users(id) on delete set null,
  commission_rate numeric(6,2) not null default 0
    check (commission_rate >= 0 and commission_rate <= 100),
  agent_commission_rate numeric(6,2) not null default 0
    check (agent_commission_rate >= 0 and agent_commission_rate <= 100),
  wallet_usd numeric(14,2) not null default 0 check (wallet_usd >= 0),
  wallet_frozen_at timestamptz,
  wallet_frozen_reason text,
  daily_deposit_limit_usd numeric(14,2) not null default 0 check (daily_deposit_limit_usd >= 0),
  daily_withdrawal_limit_usd numeric(14,2) not null default 0 check (daily_withdrawal_limit_usd >= 0),
  max_agents integer not null default 0 check (max_agents >= 0),
  can_approve_hosts boolean not null default false,
  can_create_agents boolean not null default true,
  notes text,
  created_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  suspended_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists agencies_name_unique on public.agencies (lower(name));
create index if not exists agencies_status_idx on public.agencies (status, created_at desc);
create index if not exists agencies_owner_idx on public.agencies (owner_user_id);

alter table public.agencies enable row level security;

drop policy if exists agencies_select_own_or_admin on public.agencies;
create policy agencies_select_own_or_admin on public.agencies
  for select to authenticated
  using (owner_user_id = auth.uid() or public.is_admin());

revoke all on public.agencies from anon;
revoke insert, update, delete, truncate on public.agencies from authenticated;

-- ---------------------------------------------------------------------------
-- 2) توسيع الوكلاء: وكالة + حدود + تجميد محفظة
-- ---------------------------------------------------------------------------
alter table public.agents
  add column if not exists agency_id uuid references public.agencies(id) on delete set null,
  add column if not exists daily_withdrawal_limit_usd numeric(14,2) not null default 0,
  add column if not exists min_operation_usd numeric(14,2) not null default 0,
  add column if not exists max_operation_usd numeric(14,2) not null default 0,
  add column if not exists wallet_frozen_at timestamptz,
  add column if not exists wallet_frozen_reason text;

create index if not exists agents_agency_idx on public.agents (agency_id);

alter table public.agents
  drop constraint if exists agents_limits_nonnegative;
alter table public.agents
  add constraint agents_limits_nonnegative check (
    daily_withdrawal_limit_usd >= 0
    and min_operation_usd >= 0
    and max_operation_usd >= 0
    and (max_operation_usd = 0 or min_operation_usd <= max_operation_usd)
  );

-- ---------------------------------------------------------------------------
-- 3) الدفتر المالي للوكيل (دولار)
-- ---------------------------------------------------------------------------
create table if not exists public.agent_wallet_ledger (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  event_type text not null check (event_type in (
    'opening', 'admin_credit', 'agency_transfer', 'funding_credit',
    'deposit_sale', 'withdrawal_payout', 'commission', 'adjustment', 'reversal'
  )),
  amount_usd numeric(14,2) not null check (amount_usd <> 0),
  balance_before numeric(14,2) not null,
  balance_after numeric(14,2) not null check (balance_after >= 0),
  reference_type text,
  reference_id uuid,
  idempotency_key text,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  check (balance_after = balance_before + amount_usd)
);

create index if not exists agent_wallet_ledger_agent_idx
  on public.agent_wallet_ledger (agent_id, created_at desc);
create unique index if not exists agent_wallet_ledger_idem_unique
  on public.agent_wallet_ledger (agent_id, idempotency_key)
  where idempotency_key is not null;

alter table public.agent_wallet_ledger enable row level security;

drop policy if exists agent_wallet_ledger_select_own_or_admin on public.agent_wallet_ledger;
create policy agent_wallet_ledger_select_own_or_admin on public.agent_wallet_ledger
  for select to authenticated
  using (agent_id = public.wattar_current_agent_id() or public.is_admin());

revoke all on public.agent_wallet_ledger from anon;
revoke insert, update, delete, truncate on public.agent_wallet_ledger from authenticated;

-- ---------------------------------------------------------------------------
-- 4) الدفتر المالي للوكالة (دولار)
-- ---------------------------------------------------------------------------
create table if not exists public.agency_wallet_ledger (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  event_type text not null check (event_type in (
    'opening', 'admin_credit', 'transfer_to_agent', 'funding_credit',
    'commission', 'adjustment', 'reversal'
  )),
  amount_usd numeric(14,2) not null check (amount_usd <> 0),
  balance_before numeric(14,2) not null,
  balance_after numeric(14,2) not null check (balance_after >= 0),
  reference_type text,
  reference_id uuid,
  idempotency_key text,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  check (balance_after = balance_before + amount_usd)
);

create index if not exists agency_wallet_ledger_agency_idx
  on public.agency_wallet_ledger (agency_id, created_at desc);
create unique index if not exists agency_wallet_ledger_idem_unique
  on public.agency_wallet_ledger (agency_id, idempotency_key)
  where idempotency_key is not null;

alter table public.agency_wallet_ledger enable row level security;

drop policy if exists agency_wallet_ledger_select_own_or_admin on public.agency_wallet_ledger;
create policy agency_wallet_ledger_select_own_or_admin on public.agency_wallet_ledger
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.agencies a
      where a.id = agency_wallet_ledger.agency_id and a.owner_user_id = auth.uid()
    )
  );

revoke all on public.agency_wallet_ledger from anon;
revoke insert, update, delete, truncate on public.agency_wallet_ledger from authenticated;

-- ---------------------------------------------------------------------------
-- 5) طلبات التمويل
-- ---------------------------------------------------------------------------
create table if not exists public.agent_funding_requests (
  id uuid primary key default gen_random_uuid(),
  requester_user_id uuid not null references public.users(id) on delete cascade,
  requester_kind text not null check (requester_kind in ('agent', 'agency')),
  agent_id uuid references public.agents(id) on delete set null,
  agency_id uuid references public.agencies(id) on delete set null,
  amount_usd numeric(14,2) not null check (amount_usd > 0),
  reason text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decision_note text,
  decided_by uuid,
  decided_at timestamptz,
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (requester_kind = 'agent' and agent_id is not null and agency_id is null)
    or (requester_kind = 'agency' and agency_id is not null and agent_id is null)
  )
);

create index if not exists agent_funding_requests_status_idx
  on public.agent_funding_requests (status, created_at desc);
create index if not exists agent_funding_requests_agent_idx
  on public.agent_funding_requests (agent_id, created_at desc);
create index if not exists agent_funding_requests_agency_idx
  on public.agent_funding_requests (agency_id, created_at desc);
create unique index if not exists agent_funding_requests_idem_unique
  on public.agent_funding_requests (requester_user_id, idempotency_key)
  where idempotency_key is not null;

alter table public.agent_funding_requests enable row level security;

drop policy if exists agent_funding_requests_select_own_or_admin on public.agent_funding_requests;
create policy agent_funding_requests_select_own_or_admin on public.agent_funding_requests
  for select to authenticated
  using (requester_user_id = auth.uid() or public.is_admin());

revoke all on public.agent_funding_requests from anon;
revoke insert, update, delete, truncate on public.agent_funding_requests from authenticated;

-- ---------------------------------------------------------------------------
-- 6) توحيد سعر صرف الوكلاء على اقتصاد M3.7 (1 USD = 3000 Coin)
-- ---------------------------------------------------------------------------
update public.agents
set exchange_rate_usd_to_gold = 3000,
    exchange_rate_gold_to_usd = 0.00033333,
    updated_at = now()
where exchange_rate_usd_to_gold <> 3000 or exchange_rate_gold_to_usd <> 0.00033333;

alter table public.agents
  drop constraint if exists agents_exchange_rate_positive;
alter table public.agents
  add constraint agents_exchange_rate_positive check (
    exchange_rate_usd_to_gold > 0 and exchange_rate_gold_to_usd > 0
  );

-- ---------------------------------------------------------------------------
-- 7) الدالة الوحيدة المسموح لها تغيير محفظة الوكيل (مع قيد مطابق دائماً)
-- ---------------------------------------------------------------------------
create or replace function public.record_agent_wallet_transaction(
  p_agent_id uuid,
  p_event_type text,
  p_amount_usd numeric,
  p_reference_type text default null,
  p_reference_id uuid default null,
  p_idempotency_key text default null,
  p_notes text default null,
  p_created_by uuid default null,
  p_allow_negative boolean default false
) returns numeric
language plpgsql
security definer
set search_path = public
as $$
DECLARE
  v_agent public.agents%ROWTYPE;
  v_before numeric(14,2);
  v_after numeric(14,2);
  v_existing public.agent_wallet_ledger%ROWTYPE;
BEGIN
  IF p_amount_usd IS NULL OR p_amount_usd = 0 THEN
    RAISE EXCEPTION 'Wallet transaction amount must be non-zero';
  END IF;
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.agent_wallet_ledger
    WHERE agent_id = p_agent_id AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN v_existing.balance_after;
    END IF;
  END IF;

  SELECT * INTO v_agent FROM public.agents WHERE id = p_agent_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agent not found'; END IF;
  IF v_agent.status <> 'active' THEN RAISE EXCEPTION 'Agent is not active'; END IF;
  IF v_agent.wallet_frozen_at IS NOT NULL THEN
    RAISE EXCEPTION 'Agent wallet is frozen: %', coalesce(v_agent.wallet_frozen_reason, 'no reason recorded');
  END IF;

  v_before := v_agent.wallet_usd;
  v_after := v_before + p_amount_usd;
  IF v_after < 0 AND NOT p_allow_negative THEN
    RAISE EXCEPTION 'Insufficient agent wallet balance';
  END IF;

  UPDATE public.agents SET wallet_usd = v_after, updated_at = now()
  WHERE id = p_agent_id;

  INSERT INTO public.agent_wallet_ledger (
    agent_id, event_type, amount_usd, balance_before, balance_after,
    reference_type, reference_id, idempotency_key, notes, created_by
  ) VALUES (
    p_agent_id, p_event_type, p_amount_usd, v_before, v_after,
    p_reference_type, p_reference_id, p_idempotency_key, p_notes, p_created_by
  );

  RETURN v_after;
END;
$$;

revoke all on function public.record_agent_wallet_transaction(uuid, text, numeric, text, uuid, text, text, uuid, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8) الدالة الوحيدة المسموح لها تغيير محفظة الوكالة
-- ---------------------------------------------------------------------------
create or replace function public.record_agency_wallet_transaction(
  p_agency_id uuid,
  p_event_type text,
  p_amount_usd numeric,
  p_reference_type text default null,
  p_reference_id uuid default null,
  p_idempotency_key text default null,
  p_notes text default null,
  p_created_by uuid default null
) returns numeric
language plpgsql
security definer
set search_path = public
as $$
DECLARE
  v_agency public.agencies%ROWTYPE;
  v_before numeric(14,2);
  v_after numeric(14,2);
  v_existing public.agency_wallet_ledger%ROWTYPE;
BEGIN
  IF p_amount_usd IS NULL OR p_amount_usd = 0 THEN
    RAISE EXCEPTION 'Wallet transaction amount must be non-zero';
  END IF;
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.agency_wallet_ledger
    WHERE agency_id = p_agency_id AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN v_existing.balance_after;
    END IF;
  END IF;

  SELECT * INTO v_agency FROM public.agencies WHERE id = p_agency_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agency not found'; END IF;
  IF v_agency.status <> 'active' THEN RAISE EXCEPTION 'Agency is not active'; END IF;
  IF v_agency.wallet_frozen_at IS NOT NULL THEN
    RAISE EXCEPTION 'Agency wallet is frozen: %', coalesce(v_agency.wallet_frozen_reason, 'no reason recorded');
  END IF;

  v_before := v_agency.wallet_usd;
  v_after := v_before + p_amount_usd;
  IF v_after < 0 THEN RAISE EXCEPTION 'Insufficient agency wallet balance'; END IF;

  UPDATE public.agencies SET wallet_usd = v_after, updated_at = now()
  WHERE id = p_agency_id;

  INSERT INTO public.agency_wallet_ledger (
    agency_id, event_type, amount_usd, balance_before, balance_after,
    reference_type, reference_id, idempotency_key, notes, created_by
  ) VALUES (
    p_agency_id, p_event_type, p_amount_usd, v_before, v_after,
    p_reference_type, p_reference_id, p_idempotency_key, p_notes, p_created_by
  );

  RETURN v_after;
END;
$$;

revoke all on function public.record_agency_wallet_transaction(uuid, text, numeric, text, uuid, text, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9) قيود افتتاحية (لا رصيد بلا قيد)
-- ---------------------------------------------------------------------------
insert into public.agent_wallet_ledger (
  agent_id, event_type, amount_usd, balance_before, balance_after, notes, idempotency_key
)
select a.id, 'opening', a.wallet_usd, 0, a.wallet_usd,
       'Opening balance captured when the agent wallet ledger was introduced', 'opening:' || a.id::text
from public.agents a
where a.wallet_usd <> 0
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 10) المصالحة: الرصيد يجب أن يساوي مجموع القيود
-- ---------------------------------------------------------------------------
create or replace function public.reconcile_agent_wallets()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
DECLARE
  v_agents int;
  v_ledger int;
  v_mismatch jsonb;
  v_negative int;
BEGIN
  select count(*) into v_agents from public.agents;
  select count(*) into v_ledger from public.agent_wallet_ledger;
  select coalesce(jsonb_agg(jsonb_build_object(
           'agent_id', a.id, 'wallet_usd', a.wallet_usd, 'ledger_sum', coalesce(l.total, 0)
         )), '[]'::jsonb)
    into v_mismatch
  from public.agents a
  left join (
    select agent_id, sum(amount_usd) as total
    from public.agent_wallet_ledger group by agent_id
  ) l on l.agent_id = a.id
  where a.wallet_usd <> coalesce(l.total, 0);
  select count(*) into v_negative from public.agents where wallet_usd < 0;

  return jsonb_build_object(
    'ok', jsonb_array_length(v_mismatch) = 0 and v_negative = 0,
    'agents', v_agents,
    'ledger_rows', v_ledger,
    'negative_balances', v_negative,
    'mismatches', v_mismatch
  );
end;
$$;

create or replace function public.reconcile_agency_wallets()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
DECLARE
  v_agencies int;
  v_ledger int;
  v_mismatch jsonb;
BEGIN
  select count(*) into v_agencies from public.agencies;
  select count(*) into v_ledger from public.agency_wallet_ledger;
  select coalesce(jsonb_agg(jsonb_build_object(
           'agency_id', g.id, 'wallet_usd', g.wallet_usd, 'ledger_sum', coalesce(l.total, 0)
         )), '[]'::jsonb)
    into v_mismatch
  from public.agencies g
  left join (
    select agency_id, sum(amount_usd) as total
    from public.agency_wallet_ledger group by agency_id
  ) l on l.agency_id = g.id
  where g.wallet_usd <> coalesce(l.total, 0);

  return jsonb_build_object(
    'ok', jsonb_array_length(v_mismatch) = 0,
    'agencies', v_agencies,
    'ledger_rows', v_ledger,
    'mismatches', v_mismatch
  );
end;
$$;

revoke all on function public.reconcile_agent_wallets() from public, anon, authenticated;
revoke all on function public.reconcile_agency_wallets() from public, anon, authenticated;

commit;

-- ============================================================================
-- Wattar — M5.2/M5.3: دوال الإدارة للوكالات والمحافظ التشغيلية
-- كل الدوال هنا service_role فقط (P8) وتُكتب كل قراراتها في admin_audit_log.
-- ============================================================================
begin;

-- ---------------------------------------------------------------------------
-- إنشاء وكالة (تبدأ بحالة pending حتى تُعتمد)
-- ---------------------------------------------------------------------------
create or replace function public.admin_create_agency(
  p_name text,
  p_owner_user_id uuid default null,
  p_commission_rate numeric default 0,
  p_agent_commission_rate numeric default 0,
  p_daily_deposit_limit_usd numeric default 0,
  p_daily_withdrawal_limit_usd numeric default 0,
  p_max_agents integer default 0,
  p_can_approve_hosts boolean default false,
  p_can_create_agents boolean default true,
  p_notes text default null,
  p_admin_id uuid default null,
  p_reason text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_name text := trim(coalesce(p_name, ''));
begin
  if auth.role() <> 'service_role' then raise exception 'Not authorized'; end if;
  if length(v_name) < 2 or length(v_name) > 120 then
    raise exception 'Agency name must be between 2 and 120 characters';
  end if;
  if exists (select 1 from public.agencies where lower(name) = lower(v_name)) then
    raise exception 'An agency with this name already exists';
  end if;
  if p_owner_user_id is not null then
    if not exists (select 1 from public.users where id = p_owner_user_id and status = 'active') then
      raise exception 'Agency owner must be an active user';
    end if;
    update public.users set role = 'agency_manager', updated_at = now()
    where id = p_owner_user_id and role in ('user', 'guest');
  end if;

  insert into public.agencies (
    name, status, owner_user_id, commission_rate, agent_commission_rate,
    daily_deposit_limit_usd, daily_withdrawal_limit_usd, max_agents,
    can_approve_hosts, can_create_agents, notes, created_by
  ) values (
    v_name, 'pending', p_owner_user_id, coalesce(p_commission_rate, 0), coalesce(p_agent_commission_rate, 0),
    coalesce(p_daily_deposit_limit_usd, 0), coalesce(p_daily_withdrawal_limit_usd, 0), coalesce(p_max_agents, 0),
    coalesce(p_can_approve_hosts, false), coalesce(p_can_create_agents, true), nullif(trim(p_notes), ''), p_admin_id
  ) returning id into v_id;

  insert into public.admin_audit_log (admin_id, action, target_type, target_id, after, metadata)
  values (p_admin_id, 'create_agency', 'agency', v_id,
    jsonb_build_object('name', v_name, 'owner_user_id', p_owner_user_id, 'status', 'pending'),
    jsonb_build_object('reason', coalesce(nullif(trim(p_reason), ''), 'Agency created')));

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- تعديل إعدادات وكالة (null = أبقِ القيمة الحالية)
-- ---------------------------------------------------------------------------
create or replace function public.admin_update_agency(
  p_agency_id uuid,
  p_name text default null,
  p_commission_rate numeric default null,
  p_agent_commission_rate numeric default null,
  p_daily_deposit_limit_usd numeric default null,
  p_daily_withdrawal_limit_usd numeric default null,
  p_max_agents integer default null,
  p_can_approve_hosts boolean default null,
  p_can_create_agents boolean default null,
  p_notes text default null,
  p_admin_id uuid default null,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before public.agencies%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception 'Not authorized'; end if;
  select * into v_before from public.agencies where id = p_agency_id for update;
  if not found then raise exception 'Agency not found'; end if;
  if p_name is not null then
    if length(trim(p_name)) < 2 then raise exception 'Agency name is too short'; end if;
    if exists (
      select 1 from public.agencies
      where lower(name) = lower(trim(p_name)) and id <> p_agency_id
    ) then
      raise exception 'An agency with this name already exists';
    end if;
  end if;

  update public.agencies set
    name = coalesce(nullif(trim(p_name), ''), name),
    commission_rate = coalesce(p_commission_rate, commission_rate),
    agent_commission_rate = coalesce(p_agent_commission_rate, agent_commission_rate),
    daily_deposit_limit_usd = coalesce(p_daily_deposit_limit_usd, daily_deposit_limit_usd),
    daily_withdrawal_limit_usd = coalesce(p_daily_withdrawal_limit_usd, daily_withdrawal_limit_usd),
    max_agents = coalesce(p_max_agents, max_agents),
    can_approve_hosts = coalesce(p_can_approve_hosts, can_approve_hosts),
    can_create_agents = coalesce(p_can_create_agents, can_create_agents),
    notes = coalesce(nullif(trim(p_notes), ''), notes),
    updated_at = now()
  where id = p_agency_id;

  insert into public.admin_audit_log (admin_id, action, target_type, target_id, before, after, metadata)
  values (p_admin_id, 'update_agency', 'agency', p_agency_id, to_jsonb(v_before),
    (select to_jsonb(a) from public.agencies a where a.id = p_agency_id),
    jsonb_build_object('reason', coalesce(nullif(trim(p_reason), ''), 'Agency settings updated')));

  return (select to_jsonb(a) from public.agencies a where a.id = p_agency_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- اعتماد/تعليق/إلغاء اعتماد وكالة
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_agency_status(
  p_agency_id uuid,
  p_status text,
  p_admin_id uuid,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency public.agencies%rowtype;
  v_action public.audit_action_type;
begin
  if auth.role() <> 'service_role' then raise exception 'Not authorized'; end if;
  if p_status not in ('pending', 'active', 'suspended', 'revoked') then
    raise exception 'Invalid agency status';
  end if;
  if p_status in ('suspended', 'revoked') and length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'A reason is required to suspend or revoke an agency';
  end if;

  select * into v_agency from public.agencies where id = p_agency_id for update;
  if not found then raise exception 'Agency not found'; end if;
  if v_agency.status = p_status then
    return jsonb_build_object('success', true, 'already_processed', true, 'status', p_status);
  end if;

  v_action := case p_status
    when 'active' then 'approve_agency'::public.audit_action_type
    when 'suspended' then 'suspend_agency'::public.audit_action_type
    when 'revoked' then 'revoke_agency'::public.audit_action_type
    else 'update_agency'::public.audit_action_type
  end;

  update public.agencies set
    status = p_status,
    approved_by = case when p_status = 'active' then p_admin_id else approved_by end,
    approved_at = case when p_status = 'active' then now() else approved_at end,
    suspended_at = case when p_status = 'suspended' then now() else null end,
    revoked_at = case when p_status = 'revoked' then now() else null end,
    updated_at = now()
  where id = p_agency_id;

  -- تعليق/إلغاء الوكالة يوقف وكلاءها عن العمل التشغيلي
  if p_status in ('suspended', 'revoked') then
    update public.agents set status = 'suspended', updated_at = now()
    where agency_id = p_agency_id and status = 'active';
  end if;

  insert into public.admin_audit_log (admin_id, action, target_type, target_id, before, after, metadata)
  values (p_admin_id, v_action, 'agency', p_agency_id,
    jsonb_build_object('status', v_agency.status),
    jsonb_build_object('status', p_status),
    jsonb_build_object('reason', nullif(trim(p_reason), '')));

  return jsonb_build_object('success', true, 'status', p_status);
end;
$$;

-- ---------------------------------------------------------------------------
-- تعيين مدير الوكالة (ورفع دوره إلى agency_manager)
-- ---------------------------------------------------------------------------
create or replace function public.admin_assign_agency_manager(
  p_agency_id uuid,
  p_user_id uuid,
  p_admin_id uuid,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'Not authorized'; end if;
  if not exists (select 1 from public.users where id = p_user_id and status = 'active') then
    raise exception 'Agency manager must be an active user';
  end if;

  select owner_user_id into v_before from public.agencies where id = p_agency_id for update;
  if not found then raise exception 'Agency not found'; end if;

  update public.agencies set owner_user_id = p_user_id, updated_at = now() where id = p_agency_id;
  update public.users set role = 'agency_manager', updated_at = now()
  where id = p_user_id and role in ('user', 'guest');

  insert into public.admin_audit_log (admin_id, action, target_type, target_id, before, after, metadata)
  values (p_admin_id, 'assign_agency_manager', 'agency', p_agency_id,
    jsonb_build_object('owner_user_id', v_before),
    jsonb_build_object('owner_user_id', p_user_id),
    jsonb_build_object('reason', coalesce(nullif(trim(p_reason), ''), 'Agency manager assigned')));

  return jsonb_build_object('success', true, 'owner_user_id', p_user_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- ضم وكيل إلى وكالة (أو فصله بتمرير null)
-- ---------------------------------------------------------------------------
create or replace function public.admin_assign_agent_to_agency(
  p_agent_id uuid,
  p_agency_id uuid,
  p_admin_id uuid,
  p_reason text default null,
  p_apply_commission_default boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agent public.agents%rowtype;
  v_agency public.agencies%rowtype;
  v_count int;
begin
  if auth.role() <> 'service_role' then raise exception 'Not authorized'; end if;
  select * into v_agent from public.agents where id = p_agent_id for update;
  if not found then raise exception 'Agent not found'; end if;

  if p_agency_id is not null then
    select * into v_agency from public.agencies where id = p_agency_id;
    if not found then raise exception 'Agency not found'; end if;
    if v_agency.status <> 'active' then raise exception 'Agency must be active before agents can join'; end if;
    select count(*) into v_count from public.agents where agency_id = p_agency_id and id <> p_agent_id;
    if v_agency.max_agents > 0 and v_count >= v_agency.max_agents then
      raise exception 'Agency agent limit reached';
    end if;
  end if;

  update public.agents set
    agency_id = p_agency_id,
    commission_rate = case
      when p_apply_commission_default and p_agency_id is not null and v_agency.agent_commission_rate > 0
        then v_agency.agent_commission_rate
      else commission_rate
    end,
    updated_at = now()
  where id = p_agent_id;

  insert into public.admin_audit_log (admin_id, action, target_type, target_id, before, after, metadata)
  values (p_admin_id, 'assign_agent_agency', 'agent', p_agent_id,
    jsonb_build_object('agency_id', v_agent.agency_id),
    jsonb_build_object('agency_id', p_agency_id),
    jsonb_build_object('reason', coalesce(nullif(trim(p_reason), ''), 'Agent agency assignment updated')));

  return jsonb_build_object('success', true, 'agency_id', p_agency_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- حدود الوكيل التشغيلية (null = أبقِ القيمة الحالية)
-- ---------------------------------------------------------------------------
create or replace function public.admin_update_agent_limits(
  p_agent_id uuid,
  p_commission_rate numeric default null,
  p_daily_deposit_limit_usd numeric default null,
  p_daily_withdrawal_limit_usd numeric default null,
  p_min_operation_usd numeric default null,
  p_max_operation_usd numeric default null,
  p_max_users integer default null,
  p_credit_limit_usd numeric default null,
  p_admin_id uuid default null,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before public.agents%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception 'Not authorized'; end if;
  select * into v_before from public.agents where id = p_agent_id for update;
  if not found then raise exception 'Agent not found'; end if;

  update public.agents set
    commission_rate = coalesce(p_commission_rate, commission_rate),
    daily_deposit_limit_usd = coalesce(p_daily_deposit_limit_usd, daily_deposit_limit_usd),
    daily_withdrawal_limit_usd = coalesce(p_daily_withdrawal_limit_usd, daily_withdrawal_limit_usd),
    min_operation_usd = coalesce(p_min_operation_usd, min_operation_usd),
    max_operation_usd = coalesce(p_max_operation_usd, max_operation_usd),
    max_users = coalesce(p_max_users, max_users),
    credit_limit_usd = coalesce(p_credit_limit_usd, credit_limit_usd),
    updated_at = now()
  where id = p_agent_id;

  insert into public.admin_audit_log (admin_id, action, target_type, target_id, before, after, metadata)
  values (p_admin_id, 'adjust_balance', 'agent', p_agent_id,
    jsonb_build_object(
      'commission_rate', v_before.commission_rate,
      'daily_deposit_limit_usd', v_before.daily_deposit_limit_usd,
      'daily_withdrawal_limit_usd', v_before.daily_withdrawal_limit_usd,
      'min_operation_usd', v_before.min_operation_usd,
      'max_operation_usd', v_before.max_operation_usd,
      'max_users', v_before.max_users),
    (select jsonb_build_object(
      'commission_rate', a.commission_rate,
      'daily_deposit_limit_usd', a.daily_deposit_limit_usd,
      'daily_withdrawal_limit_usd', a.daily_withdrawal_limit_usd,
      'min_operation_usd', a.min_operation_usd,
      'max_operation_usd', a.max_operation_usd,
      'max_users', a.max_users)
     from public.agents a where a.id = p_agent_id),
    jsonb_build_object('reason', coalesce(nullif(trim(p_reason), ''), 'Agent limits updated')));

  return (select to_jsonb(a) from public.agents a where a.id = p_agent_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- شحن محفظة وكالة من الإدارة
-- ---------------------------------------------------------------------------
create or replace function public.admin_credit_agency_wallet(
  p_agency_id uuid,
  p_amount_usd numeric,
  p_reason text,
  p_idempotency_key text,
  p_admin_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric(14,2);
begin
  if auth.role() <> 'service_role' then raise exception 'Not authorized'; end if;
  if p_amount_usd is null or p_amount_usd <= 0 then raise exception 'Credit amount must be positive'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'A reason is required'; end if;

  v_balance := public.record_agency_wallet_transaction(
    p_agency_id, 'admin_credit', p_amount_usd, 'admin_credit', null,
    coalesce(p_idempotency_key, 'agency-credit:' || gen_random_uuid()::text),
    trim(p_reason), p_admin_id
  );

  insert into public.admin_audit_log (admin_id, action, target_type, target_id, after, metadata)
  values (p_admin_id, 'credit_agency', 'agency', p_agency_id,
    jsonb_build_object('wallet_usd', v_balance),
    jsonb_build_object('reason', trim(p_reason), 'amount_usd', p_amount_usd));

  return jsonb_build_object('success', true, 'wallet_usd', v_balance);
end;
$$;

-- ---------------------------------------------------------------------------
-- تحويل من محفظة الوكالة إلى محفظة وكيل تابع لها (قيدان متقابلان)
-- ---------------------------------------------------------------------------
create or replace function public.admin_transfer_agency_to_agent(
  p_agency_id uuid,
  p_agent_id uuid,
  p_amount_usd numeric,
  p_reason text,
  p_idempotency_key text,
  p_admin_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_out numeric(14,2);
  v_in numeric(14,2);
  v_key text := coalesce(p_idempotency_key, 'agency-transfer:' || gen_random_uuid()::text);
begin
  if auth.role() <> 'service_role' then raise exception 'Not authorized'; end if;
  if p_amount_usd is null or p_amount_usd <= 0 then raise exception 'Transfer amount must be positive'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'A reason is required'; end if;
  if not exists (select 1 from public.agents where id = p_agent_id and agency_id = p_agency_id) then
    raise exception 'Agent does not belong to this agency';
  end if;

  v_out := public.record_agency_wallet_transaction(
    p_agency_id, 'transfer_to_agent', -p_amount_usd, 'agent', p_agent_id,
    v_key || ':out', trim(p_reason), p_admin_id
  );
  v_in := public.record_agent_wallet_transaction(
    p_agent_id, 'agency_transfer', p_amount_usd, 'agency', p_agency_id,
    v_key || ':in', trim(p_reason), p_admin_id
  );

  insert into public.admin_audit_log (admin_id, action, target_type, target_id, after, metadata)
  values (p_admin_id, 'transfer_agency_funds', 'agency', p_agency_id,
    jsonb_build_object('agency_wallet_usd', v_out, 'agent_wallet_usd', v_in),
    jsonb_build_object('reason', trim(p_reason), 'agent_id', p_agent_id, 'amount_usd', p_amount_usd));

  return jsonb_build_object('success', true, 'agency_wallet_usd', v_out, 'agent_wallet_usd', v_in);
end;
$$;

-- ---------------------------------------------------------------------------
-- تعديل رصيد وكيل من الإدارة (شحن أو خصم موثّق بسبب)
-- ---------------------------------------------------------------------------
create or replace function public.admin_adjust_agent_wallet(
  p_agent_id uuid,
  p_amount_usd numeric,
  p_reason text,
  p_idempotency_key text,
  p_admin_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric(14,2);
begin
  if auth.role() <> 'service_role' then raise exception 'Not authorized'; end if;
  if p_amount_usd is null or p_amount_usd = 0 then raise exception 'Adjustment amount must be non-zero'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'A reason is required'; end if;

  v_balance := public.record_agent_wallet_transaction(
    p_agent_id,
    case when p_amount_usd > 0 then 'admin_credit' else 'adjustment' end,
    p_amount_usd, 'admin_adjustment', null,
    coalesce(p_idempotency_key, 'agent-adjust:' || gen_random_uuid()::text),
    trim(p_reason), p_admin_id
  );

  insert into public.admin_audit_log (admin_id, action, target_type, target_id, after, metadata)
  values (p_admin_id, 'credit_agent', 'agent', p_agent_id,
    jsonb_build_object('wallet_usd', v_balance),
    jsonb_build_object('reason', trim(p_reason), 'amount_usd', p_amount_usd));

  return jsonb_build_object('success', true, 'wallet_usd', v_balance);
end;
$$;

-- ---------------------------------------------------------------------------
-- تجميد/فك تجميد محفظة وكيل أو وكالة
-- ---------------------------------------------------------------------------
create or replace function public.admin_freeze_wallet(
  p_kind text,
  p_id uuid,
  p_frozen boolean,
  p_reason text,
  p_admin_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then raise exception 'Not authorized'; end if;
  if p_kind not in ('agent', 'agency') then raise exception 'Wallet kind must be agent or agency'; end if;
  if p_frozen and length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'A reason is required to freeze a wallet';
  end if;

  if p_kind = 'agent' then
    update public.agents set
      wallet_frozen_at = case when p_frozen then now() else null end,
      wallet_frozen_reason = case when p_frozen then trim(p_reason) else null end,
      updated_at = now()
    where id = p_id;
    if not found then raise exception 'Agent not found'; end if;
  else
    update public.agencies set
      wallet_frozen_at = case when p_frozen then now() else null end,
      wallet_frozen_reason = case when p_frozen then trim(p_reason) else null end,
      updated_at = now()
    where id = p_id;
    if not found then raise exception 'Agency not found'; end if;
  end if;

  insert into public.admin_audit_log (admin_id, action, target_type, target_id, after, metadata)
  values (p_admin_id,
    case when p_frozen then 'freeze_wallet'::public.audit_action_type else 'unfreeze_wallet'::public.audit_action_type end,
    p_kind, p_id,
    jsonb_build_object('frozen', p_frozen),
    jsonb_build_object('frozen', p_frozen, 'reason', nullif(trim(p_reason), '')));

  return jsonb_build_object('success', true, 'frozen', p_frozen);
end;
$$;

-- ---------------------------------------------------------------------------
-- قرار على طلب تمويل (اعتماد يشحن المحفظة، أو رفض بسبب)
-- ---------------------------------------------------------------------------
create or replace function public.admin_decide_funding_request(
  p_request_id uuid,
  p_decision text,
  p_admin_id uuid,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.agent_funding_requests%rowtype;
  v_balance numeric(14,2);
begin
  if auth.role() <> 'service_role' then raise exception 'Not authorized'; end if;
  if p_decision not in ('approved', 'rejected') then raise exception 'Invalid funding decision'; end if;
  if p_decision = 'rejected' and length(trim(coalesce(p_note, ''))) < 3 then
    raise exception 'A rejection note is required';
  end if;

  select * into v_request from public.agent_funding_requests where id = p_request_id for update;
  if not found then raise exception 'Funding request not found'; end if;
  if v_request.status <> 'pending' then
    return jsonb_build_object('success', true, 'already_processed', true, 'status', v_request.status);
  end if;

  if p_decision = 'approved' then
    if v_request.requester_kind = 'agent' then
      v_balance := public.record_agent_wallet_transaction(
        v_request.agent_id, 'funding_credit', v_request.amount_usd, 'funding_request', v_request.id,
        'funding:' || v_request.id::text, coalesce(nullif(trim(p_note), ''), 'Funding request approved'), p_admin_id
      );
    else
      v_balance := public.record_agency_wallet_transaction(
        v_request.agency_id, 'funding_credit', v_request.amount_usd, 'funding_request', v_request.id,
        'funding:' || v_request.id::text, coalesce(nullif(trim(p_note), ''), 'Funding request approved'), p_admin_id
      );
    end if;
  end if;

  update public.agent_funding_requests set
    status = p_decision,
    decision_note = nullif(trim(p_note), ''),
    decided_by = p_admin_id,
    decided_at = now(),
    updated_at = now()
  where id = p_request_id;

  insert into public.admin_audit_log (admin_id, action, target_type, target_id, before, after, metadata)
  values (p_admin_id, 'funding_decision', 'funding_request', p_request_id,
    jsonb_build_object('status', 'pending'),
    jsonb_build_object('status', p_decision, 'wallet_usd', v_balance),
    jsonb_build_object('reason', nullif(trim(p_note), ''), 'amount_usd', v_request.amount_usd));

  return jsonb_build_object('success', true, 'status', p_decision, 'wallet_usd', v_balance);
end;
$$;

commit;

begin;
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
    IF v_agent.wallet_frozen_at IS NOT NULL THEN RAISE EXCEPTION 'Assigned agent wallet is frozen'; END IF;
    IF v_agent.min_operation_usd > 0 AND v_deposit.amount_usd < v_agent.min_operation_usd THEN
      RAISE EXCEPTION 'Amount is below the agent minimum operation limit';
    END IF;
    IF v_agent.max_operation_usd > 0 AND v_deposit.amount_usd > v_agent.max_operation_usd THEN
      RAISE EXCEPTION 'Amount exceeds the agent maximum operation limit';
    END IF;
    IF v_agent.daily_deposit_limit_usd > 0 AND (
      coalesce((select sum(d.amount_usd) from public.deposits d
                where d.agent_id = v_agent.id and d.status = 'completed'
                  and d.approved_at >= date_trunc('day', now())), 0) + v_deposit.amount_usd
    ) > v_agent.daily_deposit_limit_usd THEN
      RAISE EXCEPTION 'Agent daily deposit limit would be exceeded';
    END IF;
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
      total_deposit_usd = total_deposit_usd + v_deposit.amount_usd
    WHERE id = v_deposit.agent_id;
    PERFORM public.record_agent_wallet_transaction(
      v_deposit.agent_id, 'deposit_sale', v_deposit.amount_usd,
      'deposit', v_deposit.id, 'deposit-sale:' || v_deposit.id::text,
      'Coins sold from agent inventory', p_reviewer_id, false
    );
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

commit;
begin;
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
      AND wallet_frozen_at IS NULL
      AND (min_operation_usd = 0 OR v_withdrawal.net_usd >= min_operation_usd)
      AND (max_operation_usd = 0 OR v_withdrawal.net_usd <= max_operation_usd)
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Assigned agent has insufficient payout funds or is inactive'; END IF;
    IF (
      SELECT daily_withdrawal_limit_usd FROM public.agents WHERE id = v_withdrawal.agent_id
    ) > 0 AND (
      coalesce((select sum(w.net_usd) from public.diamond_withdrawals w
                where w.agent_id = v_withdrawal.agent_id and w.status = 'completed'
                  and w.paid_at >= date_trunc('day', now())), 0) + v_withdrawal.net_usd
    ) > (SELECT daily_withdrawal_limit_usd FROM public.agents WHERE id = v_withdrawal.agent_id) THEN
      RAISE EXCEPTION 'Agent daily withdrawal limit would be exceeded';
    END IF;
    UPDATE public.agents
    SET total_withdrawal_usd = total_withdrawal_usd + v_withdrawal.net_usd
    WHERE id = v_withdrawal.agent_id;
    PERFORM public.record_agent_wallet_transaction(
      v_withdrawal.agent_id, 'withdrawal_payout', -v_withdrawal.net_usd,
      'diamond_withdrawal', v_withdrawal.id, 'withdrawal-payout:' || v_withdrawal.id::text,
      'Cash payout to user', p_reviewer_id, false
    );
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

commit;
-- ============================================================================
-- Wattar — M5.3: دوال الخدمة الذاتية للوكيل ومدير الوكالة (authenticated)
-- كل دالة تتحقق من هوية المتصل وتعيد بياناته فقط — لا وصول لوكيل آخر.
-- ============================================================================
begin;

-- ---------------------------------------------------------------------------
-- محفظة الوكيل: الرصيد والحدود والحركة اليومية وآخر القيود
-- ---------------------------------------------------------------------------
create or replace function public.get_my_agent_wallet()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_agent public.agents%rowtype;
  v_agency jsonb;
begin
  if v_user_id is null then raise exception 'Not authenticated'; end if;

  select * into v_agent from public.agents where user_id = v_user_id;
  if not found then
    return jsonb_build_object('is_agent', false);
  end if;

  if v_agent.agency_id is not null then
    select jsonb_build_object(
      'id', a.id, 'name', a.name, 'status', a.status,
      'commission_rate', a.commission_rate, 'wallet_usd', a.wallet_usd
    ) into v_agency
    from public.agencies a where a.id = v_agent.agency_id;
  end if;

  return jsonb_build_object(
    'is_agent', true,
    'agent', jsonb_build_object(
      'id', v_agent.id,
      'status', v_agent.status,
      'wallet_usd', v_agent.wallet_usd,
      'coin_inventory', v_agent.coin_inventory,
      'commission_rate', v_agent.commission_rate,
      'credit_limit_usd', v_agent.credit_limit_usd,
      'daily_deposit_limit_usd', v_agent.daily_deposit_limit_usd,
      'daily_withdrawal_limit_usd', v_agent.daily_withdrawal_limit_usd,
      'min_operation_usd', v_agent.min_operation_usd,
      'max_operation_usd', v_agent.max_operation_usd,
      'exchange_rate_usd_to_gold', v_agent.exchange_rate_usd_to_gold,
      'can_approve_deposits', v_agent.can_approve_deposits,
      'can_approve_withdrawals', v_agent.can_approve_withdrawals,
      'wallet_frozen_at', v_agent.wallet_frozen_at,
      'wallet_frozen_reason', v_agent.wallet_frozen_reason,
      'total_users', v_agent.total_users,
      'max_users', v_agent.max_users
    ),
    'agency', v_agency,
    'today', jsonb_build_object(
      'deposits_count', (
        select count(*) from public.deposits d
        where d.agent_id = v_agent.id and d.status = 'completed'
          and d.approved_at >= date_trunc('day', now())
      ),
      'deposit_usd', coalesce((
        select sum(d.amount_usd) from public.deposits d
        where d.agent_id = v_agent.id and d.status = 'completed'
          and d.approved_at >= date_trunc('day', now())
      ), 0),
      'withdrawals_count', (
        select count(*) from public.diamond_withdrawals w
        where w.agent_id = v_agent.id and w.status = 'completed'
          and w.paid_at >= date_trunc('day', now())
      ),
      'withdrawal_usd', coalesce((
        select sum(w.net_usd) from public.diamond_withdrawals w
        where w.agent_id = v_agent.id and w.status = 'completed'
          and w.paid_at >= date_trunc('day', now())
      ), 0)
    ),
    'pending_funding', jsonb_build_object(
      'count', (
        select count(*) from public.agent_funding_requests f
        where f.agent_id = v_agent.id and f.status = 'pending'
      ),
      'amount_usd', coalesce((
        select sum(f.amount_usd) from public.agent_funding_requests f
        where f.agent_id = v_agent.id and f.status = 'pending'
      ), 0)
    ),
    'recent_ledger', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'event_type', l.event_type, 'amount_usd', l.amount_usd,
        'balance_after', l.balance_after, 'notes', l.notes, 'created_at', l.created_at
      ) order by l.created_at desc)
      from (
        select * from public.agent_wallet_ledger
        where agent_id = v_agent.id order by created_at desc limit 20
      ) l
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- سجل محفظة الوكيل (صفحات)
-- ---------------------------------------------------------------------------
create or replace function public.list_my_agent_ledger(
  p_limit integer default 50,
  p_offset integer default 0
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agent_id uuid;
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select id into v_agent_id from public.agents where user_id = auth.uid();
  if v_agent_id is null then raise exception 'Not an agent'; end if;

  return jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(to_jsonb(l) order by l.created_at desc)
      from (
        select * from public.agent_wallet_ledger
        where agent_id = v_agent_id
        order by created_at desc
        limit v_limit offset v_offset
      ) l
    ), '[]'::jsonb),
    'total', (select count(*) from public.agent_wallet_ledger where agent_id = v_agent_id)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- تقرير الوكيل اليومي/الشهري (فترات قابلة للاختيار)
-- ---------------------------------------------------------------------------
create or replace function public.get_my_agent_report(p_days integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agent_id uuid;
  v_days int := least(greatest(coalesce(p_days, 30), 1), 180);
  v_from timestamptz := date_trunc('day', now()) - ((least(greatest(coalesce(p_days, 30), 1), 180) - 1) || ' days')::interval;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select id into v_agent_id from public.agents where user_id = auth.uid();
  if v_agent_id is null then raise exception 'Not an agent'; end if;

  return jsonb_build_object(
    'days', v_days,
    'from', v_from,
    'totals', jsonb_build_object(
      'deposits_count', (
        select count(*) from public.deposits
        where agent_id = v_agent_id and status = 'completed' and approved_at >= v_from
      ),
      'deposit_usd', coalesce((
        select sum(amount_usd) from public.deposits
        where agent_id = v_agent_id and status = 'completed' and approved_at >= v_from
      ), 0),
      'withdrawals_count', (
        select count(*) from public.diamond_withdrawals
        where agent_id = v_agent_id and status = 'completed' and paid_at >= v_from
      ),
      'withdrawal_usd', coalesce((
        select sum(net_usd) from public.diamond_withdrawals
        where agent_id = v_agent_id and status = 'completed' and paid_at >= v_from
      ), 0),
      'customers', (select count(*) from public.users where agent_id = v_agent_id)
    ),
    'daily', coalesce((
      select jsonb_agg(row_to_json(t) order by t.day)
      from (
        with days as (
          select generate_series(v_from::date, now()::date, '1 day')::date as day
        ),
        dep as (
          select approved_at::date as day, count(*) as cnt, sum(amount_usd) as usd
          from public.deposits
          where agent_id = v_agent_id and status = 'completed' and approved_at >= v_from
          group by 1
        ),
        wd as (
          select paid_at::date as day, count(*) as cnt, sum(net_usd) as usd
          from public.diamond_withdrawals
          where agent_id = v_agent_id and status = 'completed' and paid_at >= v_from
          group by 1
        )
        select d.day,
               coalesce(dep.cnt, 0) as deposits_count,
               coalesce(dep.usd, 0) as deposit_usd,
               coalesce(wd.cnt, 0) as withdrawals_count,
               coalesce(wd.usd, 0) as withdrawal_usd
        from days d
        left join dep on dep.day = d.day
        left join wd on wd.day = d.day
      ) t
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- طلب تمويل من الإدارة (وكيل أو مدير وكالة)
-- ---------------------------------------------------------------------------
create or replace function public.request_my_funding(
  p_amount_usd numeric,
  p_reason text,
  p_idempotency_key text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_agent public.agents%rowtype;
  v_agency public.agencies%rowtype;
  v_existing public.agent_funding_requests%rowtype;
  v_id uuid;
begin
  if v_user_id is null then raise exception 'Not authenticated'; end if;
  if p_amount_usd is null or p_amount_usd <= 0 then raise exception 'Funding amount must be positive'; end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'A funding reason is required'; end if;

  if p_idempotency_key is not null then
    select * into v_existing from public.agent_funding_requests
    where requester_user_id = v_user_id and idempotency_key = p_idempotency_key;
    if found then
      return jsonb_build_object('success', true, 'already_processed', true,
        'request_id', v_existing.id, 'status', v_existing.status);
    end if;
  end if;

  select * into v_agent from public.agents where user_id = v_user_id;

  if found then
    if v_agent.status <> 'active' then raise exception 'Agent account is not active'; end if;
    if v_agent.wallet_frozen_at is not null then raise exception 'Agent wallet is frozen'; end if;
    insert into public.agent_funding_requests (
      requester_user_id, requester_kind, agent_id, amount_usd, reason, idempotency_key
    ) values (v_user_id, 'agent', v_agent.id, p_amount_usd, trim(p_reason), p_idempotency_key)
    returning id into v_id;
  else
    select * into v_agency from public.agencies where owner_user_id = v_user_id;
    if not found then raise exception 'Only agents and agency managers can request funding'; end if;
    if v_agency.status <> 'active' then raise exception 'Agency is not active'; end if;
    if v_agency.wallet_frozen_at is not null then raise exception 'Agency wallet is frozen'; end if;
    insert into public.agent_funding_requests (
      requester_user_id, requester_kind, agency_id, amount_usd, reason, idempotency_key
    ) values (v_user_id, 'agency', v_agency.id, p_amount_usd, trim(p_reason), p_idempotency_key)
    returning id into v_id;
  end if;

  return jsonb_build_object('success', true, 'request_id', v_id, 'status', 'pending');
end;
$$;

-- ---------------------------------------------------------------------------
-- إلغاء طلب تمويل ما زال معلّقاً (من صاحبه)
-- ---------------------------------------------------------------------------
create or replace function public.cancel_my_funding_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.agent_funding_requests%rowtype;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select * into v_request from public.agent_funding_requests
  where id = p_request_id and requester_user_id = auth.uid() for update;
  if not found then raise exception 'Funding request not found'; end if;
  if v_request.status <> 'pending' then
    return jsonb_build_object('success', true, 'already_processed', true, 'status', v_request.status);
  end if;

  update public.agent_funding_requests
  set status = 'cancelled', updated_at = now()
  where id = p_request_id;

  return jsonb_build_object('success', true, 'status', 'cancelled');
end;
$$;

-- ---------------------------------------------------------------------------
-- قائمة طلبات تمويلي
-- ---------------------------------------------------------------------------
create or replace function public.list_my_funding_requests()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', f.id, 'requester_kind', f.requester_kind, 'amount_usd', f.amount_usd,
      'reason', f.reason, 'status', f.status, 'decision_note', f.decision_note,
      'created_at', f.created_at, 'decided_at', f.decided_at
    ) order by f.created_at desc)
    from public.agent_funding_requests f
    where f.requester_user_id = auth.uid()
    limit 100
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- لوحة مدير الوكالة: وكالته ووكلاؤها وأرصدتهم
-- ---------------------------------------------------------------------------
create or replace function public.get_my_agency_dashboard()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency public.agencies%rowtype;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select * into v_agency from public.agencies where owner_user_id = auth.uid();
  if not found then
    return jsonb_build_object('is_manager', false);
  end if;

  return jsonb_build_object(
    'is_manager', true,
    'agency', jsonb_build_object(
      'id', v_agency.id, 'name', v_agency.name, 'status', v_agency.status,
      'wallet_usd', v_agency.wallet_usd, 'commission_rate', v_agency.commission_rate,
      'agent_commission_rate', v_agency.agent_commission_rate,
      'daily_deposit_limit_usd', v_agency.daily_deposit_limit_usd,
      'daily_withdrawal_limit_usd', v_agency.daily_withdrawal_limit_usd,
      'max_agents', v_agency.max_agents,
      'wallet_frozen_at', v_agency.wallet_frozen_at,
      'wallet_frozen_reason', v_agency.wallet_frozen_reason
    ),
    'totals', jsonb_build_object(
      'agents', (select count(*) from public.agents where agency_id = v_agency.id),
      'active_agents', (select count(*) from public.agents where agency_id = v_agency.id and status = 'active'),
      'wallets_usd', coalesce((select sum(wallet_usd) from public.agents where agency_id = v_agency.id), 0),
      'deposit_usd', coalesce((select sum(total_deposit_usd) from public.agents where agency_id = v_agency.id), 0),
      'withdrawal_usd', coalesce((select sum(total_withdrawal_usd) from public.agents where agency_id = v_agency.id), 0),
      'customers', (select count(*) from public.users u join public.agents a on a.id = u.agent_id where a.agency_id = v_agency.id)
    ),
    'agents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'user_id', a.user_id, 'username', u.username, 'display_name', u.display_name,
        'status', a.status, 'wallet_usd', a.wallet_usd, 'coin_inventory', a.coin_inventory,
        'commission_rate', a.commission_rate, 'total_users', a.total_users,
        'total_deposit_usd', a.total_deposit_usd, 'total_withdrawal_usd', a.total_withdrawal_usd,
        'wallet_frozen_at', a.wallet_frozen_at
      ) order by a.created_at)
      from public.agents a join public.users u on u.id = a.user_id
      where a.agency_id = v_agency.id
    ), '[]'::jsonb),
    'pending_funding', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id, 'amount_usd', f.amount_usd, 'reason', f.reason, 'created_at', f.created_at
      ) order by f.created_at desc)
      from public.agent_funding_requests f
      where f.agency_id = v_agency.id and f.status = 'pending'
    ), '[]'::jsonb),
    'recent_ledger', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'event_type', l.event_type, 'amount_usd', l.amount_usd,
        'balance_after', l.balance_after, 'notes', l.notes, 'created_at', l.created_at
      ) order by l.created_at desc)
      from (
        select * from public.agency_wallet_ledger
        where agency_id = v_agency.id order by created_at desc limit 20
      ) l
    ), '[]'::jsonb)
  );
end;
$$;

commit;

-- ============================================================================
-- Wattar — M5: الصلاحيات (قاعدة P8)
-- كل دالة خدمية: EXECUTE مسحوب من public/anon/authenticated.
-- دوال الخدمة الذاتية: authenticated فقط بعد التحقق من الهوية داخل الدالة.
-- ============================================================================
begin;

revoke all on function public.admin_create_agency(text, uuid, numeric, numeric, numeric, numeric, integer, boolean, boolean, text, uuid, text) from public, anon, authenticated;
revoke all on function public.admin_update_agency(uuid, text, numeric, numeric, numeric, numeric, integer, boolean, boolean, text, uuid, text) from public, anon, authenticated;
revoke all on function public.admin_set_agency_status(uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function public.admin_assign_agency_manager(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.admin_assign_agent_to_agency(uuid, uuid, uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.admin_update_agent_limits(uuid, numeric, numeric, numeric, numeric, numeric, integer, numeric, uuid, text) from public, anon, authenticated;
revoke all on function public.admin_credit_agency_wallet(uuid, numeric, text, text, uuid) from public, anon, authenticated;
revoke all on function public.admin_transfer_agency_to_agent(uuid, uuid, numeric, text, text, uuid) from public, anon, authenticated;
revoke all on function public.admin_adjust_agent_wallet(uuid, numeric, text, text, uuid) from public, anon, authenticated;
revoke all on function public.admin_freeze_wallet(text, uuid, boolean, text, uuid) from public, anon, authenticated;
revoke all on function public.admin_decide_funding_request(uuid, text, uuid, text) from public, anon, authenticated;

grant execute on function public.admin_create_agency(text, uuid, numeric, numeric, numeric, numeric, integer, boolean, boolean, text, uuid, text) to service_role;
grant execute on function public.admin_update_agency(uuid, text, numeric, numeric, numeric, numeric, integer, boolean, boolean, text, uuid, text) to service_role;
grant execute on function public.admin_set_agency_status(uuid, text, uuid, text) to service_role;
grant execute on function public.admin_assign_agency_manager(uuid, uuid, uuid, text) to service_role;
grant execute on function public.admin_assign_agent_to_agency(uuid, uuid, uuid, text, boolean) to service_role;
grant execute on function public.admin_update_agent_limits(uuid, numeric, numeric, numeric, numeric, numeric, integer, numeric, uuid, text) to service_role;
grant execute on function public.admin_credit_agency_wallet(uuid, numeric, text, text, uuid) to service_role;
grant execute on function public.admin_transfer_agency_to_agent(uuid, uuid, numeric, text, text, uuid) to service_role;
grant execute on function public.admin_adjust_agent_wallet(uuid, numeric, text, text, uuid) to service_role;
grant execute on function public.admin_freeze_wallet(text, uuid, boolean, text, uuid) to service_role;
grant execute on function public.admin_decide_funding_request(uuid, text, uuid, text) to service_role;

-- الخدمة الذاتية (الوكيل ومدير الوكالة)
revoke all on function public.get_my_agent_wallet() from public, anon;
revoke all on function public.list_my_agent_ledger(integer, integer) from public, anon;
revoke all on function public.get_my_agent_report(integer) from public, anon;
revoke all on function public.request_my_funding(numeric, text, text) from public, anon;
revoke all on function public.cancel_my_funding_request(uuid) from public, anon;
revoke all on function public.list_my_funding_requests() from public, anon;
revoke all on function public.get_my_agency_dashboard() from public, anon;

grant execute on function public.get_my_agent_wallet() to authenticated, service_role;
grant execute on function public.list_my_agent_ledger(integer, integer) to authenticated, service_role;
grant execute on function public.get_my_agent_report(integer) to authenticated, service_role;
grant execute on function public.request_my_funding(numeric, text, text) to authenticated, service_role;
grant execute on function public.cancel_my_funding_request(uuid) to authenticated, service_role;
grant execute on function public.list_my_funding_requests() to authenticated, service_role;
grant execute on function public.get_my_agency_dashboard() to authenticated, service_role;

-- الدوال المعاد إنشاؤها (تسوية الشحن والسحب) تبقى service_role فقط
revoke execute on function public.settle_deposit_request(uuid, text, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.settle_diamond_withdrawal(uuid, text, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.settle_deposit_request(uuid, text, uuid, text, text) to service_role;
grant execute on function public.settle_diamond_withdrawal(uuid, text, uuid, text, text, text) to service_role;

commit;

