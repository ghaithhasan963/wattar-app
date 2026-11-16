-- ============================================================================
-- 54. patch_gift_earnings_host_only.sql
-- M3.1 / القسم 11: أجر الهدية
--
-- القاعدة المعتمدة من الإدارة (2026-11-16):
--   • المستلم العادي: Coin في رصيده العادي (balance_gold).
--   • المضيفة المعتمدة والموثقة فقط (verified_hosts.status = 'active'): Diamond.
--   • لا يتحول Coin إلى Diamond في أي مسار.
--
-- لا يغيّر أي رصيد قائم؛ يسري على الهدايا الجديدة فقط.
-- ============================================================================

begin;

-- 54.1 السماح بعملة 'gold' في سجل الهدية (كان محصوراً بـdiamond/promo_dia)
alter table public.gift_transactions
  drop constraint if exists gift_transactions_received_currency_check;

alter table public.gift_transactions
  add constraint gift_transactions_received_currency_check
  check (received_diamond_currency in ('diamond', 'promo_dia', 'gold'));

-- 54.2 إعادة إنشاء تسوية الهدية مع قاعدة الأهلية
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
  v_received bigint;
  v_earn_currency varchar(10);
  v_is_verified_host boolean;
  v_gift_transaction_id uuid := gen_random_uuid();
  v_gift_transaction public.gift_transactions%rowtype;
  v_rates jsonb;
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
      'success', true,
      'already_processed', true,
      'gift_transaction', to_jsonb(v_existing),
      'sent_coins', v_existing.total_gold,
      'received_diamonds', v_existing.received_diamond,
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

  v_total_coins := v_gift.price_gold * p_quantity;
  v_received := floor(v_total_coins * v_gift.recipient_diamond_ratio / 100)::bigint;
  if v_total_coins <= 0 or v_received <= 0 then raise exception 'Gift value is invalid'; end if;

  -- القسم 11: Diamond حصراً للمضيفة المعتمدة والموثقة
  select exists (
    select 1 from public.verified_hosts vh
    where vh.user_id = p_to_user_id and vh.status = 'active'
  ) into v_is_verified_host;

  v_earn_currency := case when v_is_verified_host then 'diamond' else 'gold' end;
  v_rates := jsonb_build_object(
    'price_gold', v_gift.price_gold,
    'recipient_diamond_ratio', v_gift.recipient_diamond_ratio,
    'recipient_kind', case when v_is_verified_host then 'verified_host' else 'standard_user' end
  );

  perform public.record_wallet_transaction(
    p_from_user_id, 'gift_sent'::public.wallet_tx_type, -v_total_coins,
    'gold', null, p_idempotency_key || ':out', 'gift',
    v_gift_transaction_id,
    jsonb_build_object('gift_id', p_gift_id, 'to_user_id', p_to_user_id,
      'quantity', p_quantity, 'funding_currency', 'gold'),
    'gift-send',
    'gift_purchase',
    null,
    'system',
    v_rates,
    v_gift_transaction_id
  );
  perform public.record_wallet_transaction(
    p_to_user_id, 'gift_received'::public.wallet_tx_type, v_received,
    v_earn_currency, null, p_idempotency_key || ':in', 'gift',
    v_gift_transaction_id,
    jsonb_build_object('gift_id', p_gift_id, 'from_user_id', p_from_user_id,
      'quantity', p_quantity, 'funding_currency', 'gold'),
    'gift-send',
    case when v_is_verified_host then 'gift_earnings_host' else 'gift_earnings_user' end,
    null,
    'system',
    v_rates,
    v_gift_transaction_id
  );

  insert into public.gift_transactions (
    id, gift_id, from_user_id, to_user_id, room_id, quantity, total_gold,
    received_diamond, message, idempotency_key, funding_currency, received_diamond_currency
  ) values (
    v_gift_transaction_id, p_gift_id, p_from_user_id, p_to_user_id, p_room_id,
    p_quantity, v_total_coins, v_received, nullif(trim(p_message), ''),
    p_idempotency_key, 'gold', v_earn_currency
  ) returning * into v_gift_transaction;

  update public.users set total_gifts_sent = total_gifts_sent + v_total_coins where id = p_from_user_id;
  update public.users set total_gifts_received = total_gifts_received + v_received where id = p_to_user_id;
  perform public.award_user_xp(p_to_user_id, 'gift_received:' || v_gift_transaction_id::text, 'gift_received', 5);

  return jsonb_build_object(
    'success', true,
    'gift_transaction', to_jsonb(v_gift_transaction),
    'sent_coins', v_total_coins,
    'received_diamonds', v_received,
    'received_amount', v_received,
    'received_currency', v_earn_currency,
    'recipient_kind', v_rates ->> 'recipient_kind',
    'gift_name', coalesce(v_gift.name_ar, v_gift.name)
  );
end;
$function$;

revoke all on function public.settle_gift_send(uuid, uuid, uuid, integer, uuid, text, text, character varying)
  from public, anon, authenticated;
grant execute on function public.settle_gift_send(uuid, uuid, uuid, integer, uuid, text, text, character varying)
  to service_role;

commit;
