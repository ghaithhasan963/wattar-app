-- ============================================================================
-- 53. patch_ledger_v2.sql
-- M3 (الأقسام 11، 12): ترقية دفتر المحفظة إلى سجل تدقيقي كامل
--
-- مبادئ لا تُخترق:
--   1) لا حذف ولا تعديل لأي قيد (زنادا trg_wallet_no_update/no_delete قائمان).
--   2) كل قيد جديد له رقم عملية مقروء وفريد.
--   3) التصحيح بقيد عكسي موثّق (reverse_wallet_transaction)، لا بمحو الأصل.
--   4) لا رصيد سالب في أي مسار (قيد users + قيد الدالة + قيد العكس).
--   5) الدوال الخدمية: REVOKE من PUBLIC, anon, authenticated ثم GRANT لـservice_role.
--
-- لا يغيّر هذا الملف أي مبلغ أو رصيد قائم، ولا سلوك أي دالة قائمة.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 53.1 أعمدة النسخة الثانية على wallet_transactions
-- ---------------------------------------------------------------------------
alter table public.wallet_transactions
  add column if not exists operation_no     text,
  add column if not exists ledger_seq       bigint,
  add column if not exists entry_kind       text not null default 'normal',
  add column if not exists reversal_of      uuid references public.wallet_transactions(id) on delete restrict,
  add column if not exists reason           text,
  add column if not exists executed_by      uuid references public.users(id) on delete set null,
  add column if not exists executed_by_role text,
  add column if not exists rates_snapshot   jsonb,
  add column if not exists pair_id          uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.wallet_transactions'::regclass
      and conname = 'wallet_entry_kind_valid'
  ) then
    alter table public.wallet_transactions
      add constraint wallet_entry_kind_valid
      check (entry_kind in ('normal', 'reversal', 'adjustment', 'opening'));
  end if;
end $$;

-- قيد عكسي واحد فقط لكل قيد أصلي
create unique index if not exists wallet_transactions_reversal_of_key
  on public.wallet_transactions (reversal_of)
  where reversal_of is not null;

create unique index if not exists wallet_transactions_operation_no_key
  on public.wallet_transactions (operation_no)
  where operation_no is not null;

create unique index if not exists wallet_transactions_ledger_seq_key
  on public.wallet_transactions (ledger_seq)
  where ledger_seq is not null;

-- ---------------------------------------------------------------------------
-- 53.2 ترقيم العمليات
-- ---------------------------------------------------------------------------
create sequence if not exists public.wallet_operation_seq;

create or replace function public.assign_wallet_operation_no()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.ledger_seq is null then
    new.ledger_seq := nextval('public.wallet_operation_seq');
  end if;
  if new.operation_no is null then
    new.operation_no :=
      'WT-' || to_char(coalesce(new.created_at, now()) at time zone 'UTC', 'YYYYMMDD') ||
      '-' || lpad(new.ledger_seq::text, 6, '0');
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_assign_wallet_operation_no on public.wallet_transactions;
create trigger trg_assign_wallet_operation_no
  before insert on public.wallet_transactions
  for each row execute function public.assign_wallet_operation_no();

-- تعبئة رجعية للقيود الخمسة القائمة (إجراء مالك موثّق: تعطيل زناد منع التعديل مؤقتاً)
alter table public.wallet_transactions disable trigger trg_wallet_no_update;

with numbered as (
  select id, row_number() over (order by created_at, id) as rn
  from public.wallet_transactions
  where operation_no is null
)
update public.wallet_transactions w
set ledger_seq = n.rn,
    operation_no = 'WT-' || to_char(w.created_at at time zone 'UTC', 'YYYYMMDD') || '-'
                   || lpad((100000 + n.rn)::text, 6, '0')
from numbered n
where w.id = n.id;

-- تبدأ القيود الجديدة بعد أكبر رقم رجعي حتى يبقى التسلسل تصاعدياً
select setval(
  'public.wallet_operation_seq',
  greatest(coalesce((select max(ledger_seq) from public.wallet_transactions), 1), 1),
  true
);

alter table public.wallet_transactions enable trigger trg_wallet_no_update;

-- ---------------------------------------------------------------------------
-- 53.3 إعادة إنشاء الدالة المركزية مع حقول النسخة الثانية
--     (نفس الحساب تماماً؛ إضافة معاملات اختيارية فقط)
-- ---------------------------------------------------------------------------
drop function if exists public.record_wallet_transaction(uuid, public.wallet_tx_type, bigint, character varying, uuid, character varying, character varying, uuid, jsonb, character varying);

create function public.record_wallet_transaction(
  p_user_id uuid,
  p_type public.wallet_tx_type,
  p_amount bigint,
  p_currency character varying default 'gold',
  p_agent_id uuid default null,
  p_idempotency_key character varying default null,
  p_reference_type character varying default null,
  p_reference_id uuid default null,
  p_metadata jsonb default '{}'::jsonb,
  p_function_name character varying default null,
  p_reason text default null,
  p_executed_by uuid default null,
  p_executed_by_role text default null,
  p_rates_snapshot jsonb default null,
  p_pair_id uuid default null,
  p_entry_kind text default 'normal',
  p_reversal_of uuid default null
)
returns uuid
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_existing public.wallet_transactions%rowtype;
  v_user public.users%rowtype;
  v_before bigint;
  v_after bigint;
  v_transaction_id uuid;
begin
  if p_user_id is null or p_type is null or p_amount is null or p_amount = 0 then
    raise exception 'Invalid wallet transaction';
  end if;
  if p_currency is null or p_currency not in ('gold', 'diamond', 'conv_gold', 'promo_dia') then
    raise exception 'Unknown currency: %', p_currency;
  end if;
  if p_entry_kind not in ('normal', 'reversal', 'adjustment', 'opening') then
    raise exception 'Invalid ledger entry kind: %', p_entry_kind;
  end if;
  if p_entry_kind = 'reversal' and p_reversal_of is null then
    raise exception 'A reversal entry must reference its original transaction';
  end if;
  if p_idempotency_key is not null then
    perform pg_advisory_xact_lock(hashtext('wallet-ledger:' || p_idempotency_key));
    select * into v_existing
    from public.wallet_transactions
    where idempotency_key = p_idempotency_key
    for update;
    if found then
      if v_existing.user_id <> p_user_id or v_existing.type <> p_type
         or v_existing.amount <> p_amount or v_existing.currency <> p_currency then
        raise exception 'Idempotency key already used with different transaction data';
      end if;
      return v_existing.id;
    end if;
  end if;

  select * into v_user from public.users where id = p_user_id for update;
  if not found then raise exception 'Wallet owner not found'; end if;
  if p_currency = 'gold' then
    v_before := v_user.balance_gold;
    v_after := v_before + p_amount;
    if v_after < 0 then raise exception 'Insufficient paid Coins balance'; end if;
    update public.users set balance_gold = v_after where id = p_user_id;
  elsif p_currency = 'diamond' then
    v_before := v_user.balance_diamond;
    v_after := v_before + p_amount;
    if v_after < 0 then raise exception 'Insufficient withdrawable Diamonds balance'; end if;
    update public.users set balance_diamond = v_after where id = p_user_id;
  elsif p_currency = 'conv_gold' then
    v_before := v_user.balance_converted_coins;
    v_after := v_before + p_amount;
    if v_after < 0 then raise exception 'Insufficient converted Coins balance'; end if;
    update public.users set balance_converted_coins = v_after where id = p_user_id;
  else
    v_before := v_user.balance_diamond_promo;
    v_after := v_before + p_amount;
    if v_after < 0 then raise exception 'Insufficient promotional Diamonds balance'; end if;
    update public.users set balance_diamond_promo = v_after where id = p_user_id;
  end if;

  insert into public.wallet_transactions (
    user_id, agent_id, type, amount, balance_before, balance_after, currency,
    idempotency_key, reference_type, reference_id, metadata, created_by_function,
    reason, executed_by, executed_by_role, rates_snapshot, pair_id, entry_kind, reversal_of
  ) values (
    p_user_id, p_agent_id, p_type, p_amount, v_before, v_after, p_currency,
    p_idempotency_key, p_reference_type, p_reference_id,
    coalesce(p_metadata, '{}'::jsonb), p_function_name,
    p_reason, p_executed_by, p_executed_by_role, p_rates_snapshot, p_pair_id,
    p_entry_kind, p_reversal_of
  )
  returning id into v_transaction_id;
  return v_transaction_id;
end;
$function$;

revoke all on function public.record_wallet_transaction(uuid, public.wallet_tx_type, bigint, character varying, uuid, character varying, character varying, uuid, jsonb, character varying, text, uuid, text, jsonb, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.record_wallet_transaction(uuid, public.wallet_tx_type, bigint, character varying, uuid, character varying, character varying, uuid, jsonb, character varying, text, uuid, text, jsonb, uuid, text, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- 53.4 القيد العكسي الموثّق
-- ---------------------------------------------------------------------------
create or replace function public.reverse_wallet_transaction(
  p_transaction_id uuid,
  p_reason text,
  p_admin_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_original public.wallet_transactions%rowtype;
  v_user public.users%rowtype;
  v_after bigint;
  v_existing_reversal uuid;
  v_reversal_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Not authorized';
  end if;
  if p_transaction_id is null or p_admin_id is null
     or length(trim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Reversal requires an original transaction, an admin and a reason';
  end if;

  select * into v_original
  from public.wallet_transactions
  where id = p_transaction_id
  for update;
  if not found then raise exception 'Original transaction not found'; end if;
  if v_original.entry_kind = 'reversal' then
    raise exception 'A reversal entry cannot itself be reversed';
  end if;

  select id into v_existing_reversal
  from public.wallet_transactions
  where reversal_of = p_transaction_id;
  if found then
    raise exception 'Transaction already reversed by %', v_existing_reversal;
  end if;

  select * into v_user from public.users where id = v_original.user_id for update;
  if not found then raise exception 'Wallet owner not found'; end if;

  v_after := case v_original.currency
    when 'gold' then v_user.balance_gold
    when 'diamond' then v_user.balance_diamond
    when 'conv_gold' then v_user.balance_converted_coins
    else v_user.balance_diamond_promo
  end + (-v_original.amount);

  if v_after < 0 then
    raise exception 'Reversal would make the % balance negative; adjust the account first', v_original.currency;
  end if;

  v_reversal_id := public.record_wallet_transaction(
    v_original.user_id,
    v_original.type,
    -v_original.amount,
    v_original.currency,
    v_original.agent_id,
    null,
    v_original.reference_type,
    v_original.reference_id,
    coalesce(v_original.metadata, '{}'::jsonb) || jsonb_build_object('reversal_of', p_transaction_id),
    'reverse-wallet-transaction',
    p_reason,
    p_admin_id,
    'admin',
    v_original.rates_snapshot,
    v_original.pair_id,
    'reversal',
    p_transaction_id
  );

  insert into public.admin_audit_log (admin_id, action, target_type, target_id, before, after, reason)
  values (
    p_admin_id,
    'adjust_balance'::public.audit_action_type,
    'wallet_transaction',
    p_transaction_id,
    to_jsonb(v_original),
    jsonb_build_object('reversal_transaction_id', v_reversal_id),
    p_reason
  );

  return jsonb_build_object(
    'success', true,
    'original_transaction_id', p_transaction_id,
    'reversal_transaction_id', v_reversal_id,
    'amount', -v_original.amount,
    'currency', v_original.currency,
    'balance_after', v_after
  );
end;
$function$;

revoke all on function public.reverse_wallet_transaction(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.reverse_wallet_transaction(uuid, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 53.5 المطابقة الدورية (قراءة فقط، لا تكتب شيئاً)
-- ---------------------------------------------------------------------------
create or replace function public.reconcile_wallet_ledger(p_currency text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Not authorized';
  end if;
  if p_currency is not null and p_currency not in ('gold', 'diamond', 'conv_gold', 'promo_dia') then
    raise exception 'Unknown currency: %', p_currency;
  end if;

  with led as (
    select user_id, currency, sum(amount)::bigint as ledger_sum
    from public.wallet_transactions
    where p_currency is null or currency = p_currency
    group by user_id, currency
  ),
  live as (
    select u.id as user_id, x.currency, x.balance
    from public.users u
    cross join lateral (values
      ('gold'::text, u.balance_gold),
      ('diamond'::text, u.balance_diamond),
      ('conv_gold'::text, u.balance_converted_coins),
      ('promo_dia'::text, u.balance_diamond_promo)
    ) as x(currency, balance)
    where p_currency is null or x.currency = p_currency
  ),
  diffs as (
    select coalesce(l.user_id, v.user_id) as user_id,
           coalesce(l.currency, v.currency) as currency,
           coalesce(l.ledger_sum, 0)::bigint as ledger_sum,
           coalesce(v.balance, 0)::bigint as live_balance,
           (coalesce(l.ledger_sum, 0) - coalesce(v.balance, 0))::bigint as difference
    from led l
    full join live v on v.user_id = l.user_id and v.currency = l.currency
    where coalesce(l.ledger_sum, 0) <> coalesce(v.balance, 0)
  ),
  chain as (
    select id, user_id, currency, operation_no
    from (
      select w.*,
             lag(w.balance_after) over (
               partition by w.user_id, w.currency
               order by coalesce(w.ledger_seq, 0), w.created_at, w.id
             ) as prev_after
      from public.wallet_transactions w
      where p_currency is null or w.currency = p_currency
    ) s
    where prev_after is not null and prev_after <> balance_before
  ),
  reversal_problems as (
    select w.id, 'missing_original' as issue
    from public.wallet_transactions w
    where w.reversal_of is not null
      and not exists (select 1 from public.wallet_transactions o where o.id = w.reversal_of)
    union all
    select w.id, 'not_reversal_kind'
    from public.wallet_transactions w
    where w.reversal_of is not null and w.entry_kind <> 'reversal'
    union all
    select w.id, 'amount_mismatch'
    from public.wallet_transactions w
    join public.wallet_transactions o on o.id = w.reversal_of
    where w.amount <> -o.amount or w.currency <> o.currency or w.user_id <> o.user_id
  ),
  negatives as (
    select u.id, 'negative_balance' as issue
    from public.users u
    where ((p_currency is null or p_currency = 'gold') and u.balance_gold < 0)
       or ((p_currency is null or p_currency = 'diamond') and u.balance_diamond < 0)
       or ((p_currency is null or p_currency = 'conv_gold') and u.balance_converted_coins < 0)
       or ((p_currency is null or p_currency = 'promo_dia') and u.balance_diamond_promo < 0)
  )
  select jsonb_build_object(
    'ok', not exists (select 1 from diffs)
          and not exists (select 1 from chain)
          and not exists (select 1 from reversal_problems)
          and not exists (select 1 from negatives),
    'checked_at', now(),
    'currency', coalesce(p_currency, 'all'),
    'ledger_rows', (select count(*) from public.wallet_transactions
                    where p_currency is null or currency = p_currency),
    'balance_differences', coalesce((select jsonb_agg(to_jsonb(d)) from diffs d), '[]'::jsonb),
    'broken_chains', coalesce((select jsonb_agg(jsonb_build_object('transaction_id', c.id, 'operation_no', c.operation_no)) from chain c), '[]'::jsonb),
    'reversal_problems', coalesce((select jsonb_agg(to_jsonb(r)) from reversal_problems r), '[]'::jsonb),
    'negative_balances', coalesce((select jsonb_agg(to_jsonb(n)) from negatives n), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$function$;

revoke all on function public.reconcile_wallet_ledger(text) from public, anon, authenticated;
grant execute on function public.reconcile_wallet_ledger(text) to service_role;

-- زناد الترقيم دالة داخلية لا تُستدعى من العميل
revoke all on function public.assign_wallet_operation_no() from public, anon, authenticated;

commit;
