-- ============================================================================
-- 55. patch_gift_commissions.sql
-- M3.4 / القسم 11: عمولات الهدية + سجل إيرادات بقيد متوازن بالقيمة
--
-- الآلية (معتمد: «العمولات تدار من الإدارة كشيء افتراضي ويمكن التخصيص»):
--   • النِسب الافتراضية: admin_settings.gift_platform_commission_percent
--                          admin_settings.gift_agent_commission_percent
--   • تخصيص لكل مضيفة: verified_hosts.platform_commission_percent /
--                       verified_hosts.agent_commission_percent (null = الافتراضي)
--   • تخصيص لكل وكيل:  agents.gift_commission_rate (null = الافتراضي)
--   • تُحسب العمولة على أجر المضيفة الإجمالي (لا تُضاف على المرسل).
--   • القيم الافتراضية = 0٪، فقبل ضبطها يبقى الاقتصاد كما هو تماماً.
--
-- القيد المتوازن: كل هدية (pair_id) قيودها بقيمتها بالدولار تُغلق بصفر:
--   المرسل (سالب) = أجر المستلم + عمولة المنصة + عمولة الوكيل + الهامش.
--   `gold_to_usdt_rate` و`diamonds_per_usd` لقطتان محفوظتان في القيد.
--
-- لا يغيّر هذا الملف أي رصدة أو أجراً قائمة؛ يضيف حسابات إيراد داخلية فقط.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 55.1 سياسة العمولات: مفاتيح افتراضية + حقول تخصيص
-- ---------------------------------------------------------------------------
-- النِسب الافتراضية تُقرأ من هذين المفتاحين إن وُجدا (وإلا فالافتراضي صفر).
-- لا تُزرع هنا لتجنّب زناد تدقيق الإعدادات؛ تضيفها الإدارة من لوحتها:
--   admin_settings.gift_platform_commission_percent = رقم بصيغة JSON مثلاً 20
--   admin_settings.gift_agent_commission_percent     = رقم بصيغة JSON مثلاً 5

alter table public.verified_hosts
  add column if not exists platform_commission_percent numeric(5,2),
  add column if not exists agent_commission_percent numeric(5,2);

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.verified_hosts'::regclass and conname='verified_hosts_commission_range') then
    alter table public.verified_hosts
      add constraint verified_hosts_commission_range
      check ((platform_commission_percent is null or platform_commission_percent between 0 and 100)
         and (agent_commission_percent is null or agent_commission_percent between 0 and 100)
         and (coalesce(platform_commission_percent, 0) + coalesce(agent_commission_percent, 0) <= 100));
  end if;
end $$;

alter table public.agents
  add column if not exists gift_commission_rate numeric(5,2);

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.agents'::regclass and conname='agents_gift_commission_range') then
    alter table public.agents
      add constraint agents_gift_commission_range
      check (gift_commission_rate is null or gift_commission_rate between 0 and 100);
  end if;
end $$;

alter table public.gift_transactions
  add column if not exists commission_breakdown jsonb;

-- ---------------------------------------------------------------------------
-- 55.2 حسابات الإيراد وسجلها
-- ---------------------------------------------------------------------------
create table if not exists public.revenue_accounts (
  code text primary key,
  kind text not null check (kind in ('platform', 'agency', 'agent')),
  owner_id uuid references public.users(id) on delete restrict,
  balance_usd numeric(24,8) not null default 0 check (balance_usd >= -0.000001),
  created_at timestamptz not null default now()
);

insert into public.revenue_accounts (code, kind)
values ('platform:main', 'platform')
on conflict (code) do nothing;

create sequence if not exists public.revenue_operation_seq;

create table if not exists public.revenue_ledger (
  id uuid primary key default gen_random_uuid(),
  account_code text not null references public.revenue_accounts(code),
  currency text not null check (currency in ('gold', 'diamond', 'usd')),
  amount numeric(24,8) not null,
  usd_value numeric(24,8) not null,
  balance_usd_after numeric(24,8) not null,
  reason text not null,
  reference_type text,
  reference_id uuid,
  pair_id uuid,
  operation_no text,
  created_by_function text,
  created_at timestamptz not null default now()
);

create unique index if not exists revenue_ledger_operation_no_key
  on public.revenue_ledger (operation_no)
  where operation_no is not null;

create or replace function public.prevent_revenue_ledger_modification()
returns trigger
language plpgsql
as $function$
begin
  raise exception 'revenue_ledger is append-only: modification/deletion forbidden';
end;
$function$;

drop trigger if exists trg_revenue_no_update on public.revenue_ledger;
create trigger trg_revenue_no_update
  before update on public.revenue_ledger
  for each row execute function public.prevent_revenue_ledger_modification();

drop trigger if exists trg_revenue_no_delete on public.revenue_ledger;
create trigger trg_revenue_no_delete
  before delete on public.revenue_ledger
  for each row execute function public.prevent_revenue_ledger_modification();

alter table public.revenue_ledger enable row level security;
alter table public.revenue_accounts enable row level security;

revoke all on table public.revenue_ledger from public, anon, authenticated;
revoke all on table public.revenue_accounts from public, anon, authenticated;
grant select on table public.revenue_ledger to service_role;
grant select on table public.revenue_accounts to service_role;

-- ---------------------------------------------------------------------------
-- 55.3 أدوات داخلية (لا تُنادى من العميل أبداً)
-- ---------------------------------------------------------------------------
create or replace function public.get_or_create_revenue_account(
  p_code text,
  p_kind text,
  p_owner_id uuid default null
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Not authorized';
  end if;
  insert into public.revenue_accounts (code, kind, owner_id)
  values (p_code, p_kind, p_owner_id)
  on conflict (code) do nothing;
end;
$function$;

create or replace function public.credit_revenue(
  p_account_code text,
  p_currency text,
  p_amount numeric,
  p_usd_value numeric,
  p_reason text,
  p_reference_type text,
  p_reference_id uuid,
  p_pair_id uuid,
  p_function_name text default 'credit-revenue'
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_balance numeric(24,8);
  v_op_no text;
  v_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Not authorized';
  end if;
  perform pg_advisory_xact_lock(hashtext('revenue:' || p_account_code));
  select balance_usd into v_balance
  from public.revenue_accounts
  where code = p_account_code
  for update;
  if not found then
    raise exception 'Revenue account not found: %', p_account_code;
  end if;

  v_balance := v_balance + p_usd_value;
  if v_balance < -0.000001 then
    raise exception 'Revenue account balance cannot go negative: %', p_account_code;
  end if;

  v_op_no := 'RV-' || to_char(now() at time zone 'UTC', 'YYYYMMDD') || '-'
             || lpad(nextval('public.revenue_operation_seq')::text, 6, '0');

  insert into public.revenue_ledger (
    account_code, currency, amount, usd_value, balance_usd_after,
    reason, reference_type, reference_id, pair_id, operation_no, created_by_function
  ) values (
    p_account_code, p_currency, p_amount, p_usd_value, v_balance,
    p_reason, p_reference_type, p_reference_id, p_pair_id, v_op_no, p_function_name
  ) returning id into v_id;

  update public.revenue_accounts set balance_usd = v_balance where code = p_account_code;
  return v_id;
end;
$function$;

revoke all on function public.get_or_create_revenue_account(text, text, uuid) from public, anon, authenticated;
revoke all on function public.credit_revenue(text, text, numeric, numeric, text, text, uuid, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 55.4 تسوية الهدية مع العمولات وقيد القيمة المتوازن
-- ---------------------------------------------------------------------------
create or replace function public.settle_gift_send(
  p_from_user_id uuid,
  p_to_user_id uuid,
  p_gift_id uuid,
  p_quantity integer,
  p_room_id uuid,
  p_message text,
  p_idempotency_key text,
  p_funding_currency character varying
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_existing public.gift_transactions%rowtype;
  v_gift public.gifts%rowtype;
  v_total_coins bigint;
  v_gross bigint;
  v_received bigint;
  v_earn_currency varchar(10);
  v_is_verified_host boolean;
  v_gift_transaction_id uuid := gen_random_uuid();
  v_gift_transaction public.gift_transactions%rowtype;
  v_rates jsonb;
  v_gold_usdt numeric(24,8);
  v_diamonds_per_usd numeric(24,8);
  v_diamond_usdt numeric(24,8);
  v_platform_pct numeric(5,2);
  v_agent_pct numeric(5,2);
  v_agent_id uuid;
  v_agent_user_id uuid;
  v_platform_cut bigint;
  v_agent_cut bigint;
  v_host_net bigint;
  v_sender_usd numeric(24,8);
  v_credited_usd numeric(24,8);
  v_spread_usd numeric(24,8);
  v_breakdown jsonb;
begin
  if auth.role() <> 'service_role' then raise exception 'Not authorized'; end if;
  if p_from_user_id is null or p_to_user_id is null or p_from_user_id = p_to_user_id
     or p_quantity not between 1 and 100
     or p_funding_currency is distinct from 'gold'
     or length(trim(coalesce(p_idempotency_key, ''))) not between 10 and 90
     or length(coalesce(p_message, '')) > 500 then
    raise exception 'Invalid gift request';
  end if;
  perform pg_advisory_xact_lock(hashtext('gift-send:' || p_idempotency_key));
  select * into v_existing from public.gift_transactions
  where idempotency_key = p_idempotency_key for update;
  if found then
    if v_existing.from_user_id <> p_from_user_id or v_existing.to_user_id <> p_to_user_id
       or v_existing.gift_id <> p_gift_id or v_existing.quantity <> p_quantity
       or v_existing.room_id is distinct from p_room_id
       or v_existing.message is distinct from nullif(trim(p_message), '')
       or v_existing.funding_currency <> p_funding_currency then
      raise exception 'Idempotency key already used with different gift data';
    end if;
    return jsonb_build_object(
      'success', true, 'already_processed', true,
      'gift_transaction', to_jsonb(v_existing),
      'sent_coins', v_existing.total_gold,
      'received_amount', v_existing.received_diamond,
      'received_currency', v_existing.received_diamond_currency
    );
  end if;

  if not exists (select 1 from public.users where id = p_from_user_id and status = 'active')
     or not exists (select 1 from public.users where id = p_to_user_id and status = 'active') then
    raise exception 'Sender or recipient is unavailable';
  end if;
  if exists (
    select 1 from public.user_blocks b
    where (b.blocker_id = p_from_user_id and b.blocked_id = p_to_user_id)
       or (b.blocker_id = p_to_user_id and b.blocked_id = p_from_user_id)
  ) then raise exception 'Cannot send a gift to this user'; end if;
  perform 1 from public.users where id in (p_from_user_id, p_to_user_id)
    order by id for update;
  select * into v_gift from public.gifts where id = p_gift_id and is_active for share;
  if not found then raise exception 'Gift is not available'; end if;

  select (s.value #>> '{}')::numeric into v_gold_usdt
  from public.admin_settings s where s.key = 'gold_to_usdt_rate';
  select (s.value #>> '{}')::numeric into v_diamonds_per_usd
  from public.admin_settings s where s.key = 'diamonds_per_usd';
  if coalesce(v_gold_usdt, 0) <= 0 or coalesce(v_diamonds_per_usd, 0) <= 0 then
    raise exception 'Exchange rates are not configured';
  end if;
  v_diamond_usdt := round(1 / v_diamonds_per_usd, 8);

  v_total_coins := v_gift.price_gold * p_quantity;
  v_gross := floor(v_total_coins * v_gift.recipient_diamond_ratio / 100)::bigint;
  if v_total_coins <= 0 or v_gross <= 0 then raise exception 'Gift value is invalid'; end if;

  select exists (
    select 1 from public.verified_hosts vh
    where vh.user_id = p_to_user_id and vh.status = 'active'
  ) into v_is_verified_host;

  v_sender_usd := round(v_total_coins * v_gold_usdt, 8);

  if v_is_verified_host then
    v_earn_currency := 'diamond';

    select coalesce(
             (select vh.platform_commission_percent from public.verified_hosts vh where vh.user_id = p_to_user_id and vh.status = 'active'),
             (select (s.value #>> '{}')::numeric from public.admin_settings s where s.key = 'gift_platform_commission_percent'),
             0
           ),
           coalesce(
             (select vh.agent_commission_percent from public.verified_hosts vh where vh.user_id = p_to_user_id and vh.status = 'active'),
             (select a.gift_commission_rate from public.users u join public.agents a on a.id = u.referred_by_agent_id where u.id = p_to_user_id),
             (select (s.value #>> '{}')::numeric from public.admin_settings s where s.key = 'gift_agent_commission_percent'),
             0
           )
    into v_platform_pct, v_agent_pct;

    select a.id into v_agent_id
    from public.users u join public.agents a on a.id = u.referred_by_agent_id
    where u.id = p_to_user_id;

    select user_id into v_agent_user_id
    from public.agents where id = v_agent_id;

    -- لا وكيل أو لا حساب مستخدم له ⇒ لا عمولة وكيل
    if v_agent_id is null or v_agent_user_id is null then
      v_agent_pct := 0;
    end if;

    if coalesce(v_platform_pct, 0) + coalesce(v_agent_pct, 0) > 100 then
      raise exception 'Commission percentages exceed 100%% for this host';
    end if;

    v_platform_cut := floor(v_gross * v_platform_pct / 100)::bigint;
    v_agent_cut := floor((v_gross - v_platform_cut) * v_agent_pct / 100)::bigint;
    v_host_net := v_gross - v_platform_cut - v_agent_cut;
    v_received := v_host_net;  -- المضيفة تستلم الصافي فقط
    v_credited_usd := round(v_gross * v_diamond_usdt, 8);  -- كل المخرجات بالدولار

    if v_agent_cut > 0 then
      perform public.get_or_create_revenue_account('agent:' || v_agent_id::text, 'agent', v_agent_user_id);
      perform public.credit_revenue('agent:' || v_agent_id::text, 'diamond', v_agent_cut,
        round(v_agent_cut * v_diamond_usdt, 8), 'gift_commission_agent', 'gift', v_gift_transaction_id, v_gift_transaction_id, 'gift-send');
    end if;

    if v_platform_cut > 0 then
      perform public.credit_revenue('platform:main', 'diamond', v_platform_cut,
        round(v_platform_cut * v_diamond_usdt, 8), 'gift_commission_platform', 'gift', v_gift_transaction_id, v_gift_transaction_id, 'gift-send');
    end if;
  else
    v_earn_currency := 'gold';
    v_received := v_gross;
    v_credited_usd := round(v_received * v_gold_usdt, 8);
  end if;

  v_spread_usd := round(v_sender_usd - v_credited_usd, 8);
  if v_spread_usd < 0 then
    raise exception 'Gift accounting does not balance';
  end if;
  if v_spread_usd > 0 then
    perform public.credit_revenue('platform:main', 'usd', v_spread_usd, v_spread_usd,
      'gift_margin', 'gift', v_gift_transaction_id, v_gift_transaction_id, 'gift-send');
  end if;

  v_breakdown := jsonb_build_object(
    'gross_earnings', case when v_is_verified_host then v_gross else v_gross end,
    'platform_commission_percent', coalesce(v_platform_pct, 0),
    'agent_commission_percent', coalesce(v_agent_pct, 0),
    'platform_commission', case when v_is_verified_host then v_platform_cut else 0 end,
    'agent_commission', case when v_is_verified_host then v_agent_cut else 0 end,
    'host_net', case when v_is_verified_host then v_host_net else v_gross end,
    'sender_usd', v_sender_usd,
    'credited_usd', v_credited_usd,
    'margin_usd', v_spread_usd,
    'agent_id', v_agent_id
  );

  v_rates := jsonb_build_object(
    'price_gold', v_gift.price_gold,
    'recipient_diamond_ratio', v_gift.recipient_diamond_ratio,
    'recipient_kind', case when v_is_verified_host then 'verified_host' else 'standard_user' end,
    'gold_to_usdt_rate', v_gold_usdt,
    'diamonds_per_usd', v_diamonds_per_usd,
    'commission', v_breakdown
  );

  perform public.record_wallet_transaction(
    p_from_user_id, 'gift_sent'::public.wallet_tx_type, -v_total_coins,
    'gold', null, p_idempotency_key || ':out', 'gift',
    v_gift_transaction_id,
    jsonb_build_object('gift_id', p_gift_id, 'to_user_id', p_to_user_id,
      'quantity', p_quantity, 'funding_currency', 'gold'),
    'gift-send', 'gift_purchase', null, 'system', v_rates, v_gift_transaction_id
  );
  perform public.record_wallet_transaction(
    p_to_user_id, 'gift_received'::public.wallet_tx_type, v_received,
    v_earn_currency, null, p_idempotency_key || ':in', 'gift',
    v_gift_transaction_id,
    jsonb_build_object('gift_id', p_gift_id, 'from_user_id', p_from_user_id,
      'quantity', p_quantity, 'funding_currency', 'gold'),
    'gift-send',
    case when v_is_verified_host then 'gift_earnings_host' else 'gift_earnings_user' end,
    null, 'system', v_rates, v_gift_transaction_id
  );

  insert into public.gift_transactions (
    id, gift_id, from_user_id, to_user_id, room_id, quantity, total_gold,
    received_diamond, message, idempotency_key, funding_currency, received_diamond_currency,
    commission_breakdown
  ) values (
    v_gift_transaction_id, p_gift_id, p_from_user_id, p_to_user_id, p_room_id,
    p_quantity, v_total_coins, v_received, nullif(trim(p_message), ''),
    p_idempotency_key, 'gold', v_earn_currency, v_breakdown
  ) returning * into v_gift_transaction;

  update public.users set total_gifts_sent = total_gifts_sent + v_total_coins where id = p_from_user_id;
  update public.users set total_gifts_received = total_gifts_received + v_received where id = p_to_user_id;
  perform public.award_user_xp(p_to_user_id, 'gift_received:' || v_gift_transaction_id::text, 'gift_received', 5);

  return jsonb_build_object(
    'success', true,
    'gift_transaction', to_jsonb(v_gift_transaction),
    'sent_coins', v_total_coins,
    'received_amount', v_received,
    'received_currency', v_earn_currency,
    'recipient_kind', v_rates ->> 'recipient_kind',
    'commission', v_breakdown,
    'gift_name', coalesce(v_gift.name_ar, v_gift.name)
  );
end;
$function$;

revoke all on function public.settle_gift_send(uuid, uuid, uuid, integer, uuid, text, text, character varying)
  from public, anon, authenticated;
grant execute on function public.settle_gift_send(uuid, uuid, uuid, integer, uuid, text, text, character varying)
  to service_role;

-- ---------------------------------------------------------------------------
-- 55.5 مطابقة اقتصاد الهدايا (قيود كل هدية تُغلق بصفر بالقيمة)
-- ---------------------------------------------------------------------------
create or replace function public.reconcile_gift_economy()
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

  with pairs as (
    select distinct pair_id
    from public.wallet_transactions
    where pair_id is not null
  ),
  legs as (
    select w.pair_id,
           sum(round(
             case w.currency
               when 'gold' then w.amount * ((w.rates_snapshot ->> 'gold_to_usdt_rate')::numeric)
               when 'diamond' then w.amount * round(1 / nullif((w.rates_snapshot ->> 'diamonds_per_usd')::numeric, 0), 8)
               else 0
             end, 8)) as wallet_usd,
           count(*) as user_legs,
           bool_or(w.rates_snapshot is null or (w.rates_snapshot ->> 'gold_to_usdt_rate') is null) as missing_rates
    from public.wallet_transactions w
    where w.pair_id is not null
    group by w.pair_id
  ),
  rev as (
    select r.pair_id, sum(r.usd_value) as revenue_usd, count(*) as revenue_rows
    from public.revenue_ledger r
    where r.pair_id is not null
    group by r.pair_id
  ),
  all_pairs as (
    select p.pair_id,
           coalesce(l.wallet_usd, 0) as wallet_usd,
           coalesce(r.revenue_usd, 0) as revenue_usd,
           coalesce(l.user_legs, 0) as user_legs,
           coalesce(r.revenue_rows, 0) as revenue_rows,
           coalesce(l.missing_rates, false) as missing_rates
    from pairs p
    left join legs l on l.pair_id = p.pair_id
    left join rev r on r.pair_id = p.pair_id
  ),
  bad as (
    select * from all_pairs
    where abs(wallet_usd + revenue_usd) > 0.000001
       or user_legs <> 2
       or missing_rates
  )
  select jsonb_build_object(
    'ok', not exists (select 1 from bad),
    'checked_at', now(),
    'pairs', (select count(*) from all_pairs),
    'problems', coalesce((select jsonb_agg(to_jsonb(b)) from bad b), '[]'::jsonb),
    'revenue_accounts', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'code', code, 'kind', kind, 'balance_usd', balance_usd
      ) order by code), '[]'::jsonb)
      from public.revenue_accounts
    ),
    'revenue_ledger_rows', (select count(*) from public.revenue_ledger)
  ) into v_result;

  return v_result;
end;
$function$;

revoke all on function public.reconcile_gift_economy() from public, anon, authenticated;
grant execute on function public.reconcile_gift_economy() to service_role;

commit;
