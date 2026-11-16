-- ============================================================================
-- 53f. patch_ledger_v2_fix.sql
-- تصحيح تشغيلي بعد #53: إضافة تسلسل قيود تصاعدي (ledger_seq)
--
-- السبب: فحص سلامة السلسلة في reconcile كان يرتّب بـ(created_at, id)، وكل
-- القيود التي تُكتب داخل معاملة واحدة تتشارك نفس created_at، فيصبح ترتيب id
-- عشوائياً وتظهر سلاسل مكسورة وهمية (كشفه اختبار T6). التسلسل التصاعدي يحل
-- ذلك ويُثبّت ترتيب التدقيق.
--
-- لا يغيّر أي مبلغ أو رصيد.
-- ============================================================================

begin;

alter table public.wallet_transactions
  add column if not exists ledger_seq bigint;

create unique index if not exists wallet_transactions_ledger_seq_key
  on public.wallet_transactions (ledger_seq)
  where ledger_seq is not null;

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

alter table public.wallet_transactions disable trigger trg_wallet_no_update;

with numbered as (
  select id, row_number() over (order by created_at, id) as rn
  from public.wallet_transactions
  where ledger_seq is null
)
update public.wallet_transactions w
set ledger_seq = n.rn
from numbered n
where w.id = n.id;

alter table public.wallet_transactions enable trigger trg_wallet_no_update;

select setval(
  'public.wallet_operation_seq',
  greatest(coalesce((select max(ledger_seq) from public.wallet_transactions), 1), 1),
  true
);

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

commit;
