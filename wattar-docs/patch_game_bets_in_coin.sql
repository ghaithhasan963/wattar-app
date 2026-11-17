-- ============================================================================
-- 57. patch_game_bets_in_coin.sql
-- M3.7 (تكملة): نقل تسوية الألعاب الفعلية من نقاط الألعاب إلى Coin
--
-- المشكلة: `play_game_with_points` (المستخدمة من كل محركات الألعاب الخمسة)
-- كانت تخصم من `users.game_points` وتكتب في `game_points_ledger`. بعد #56
-- أصبح رصيد النقاط صفراً للجميع، فكانت كل الألعاب سترفض الرهان.
--
-- الحل: نفس التوقيع تماماً (فلا تتغير أي دالة حافة)، لكن:
--   • الرهان والدفع يمرّان عبر `record_wallet_transaction` بعملة `gold`
--   • يظهران في الدفتر المالي الموحد بأرقام عمليات وسبب ولقطة
--   • يُحفظ سجل اللعبة في `game_rounds`/`game_bets` كما هو (للتدقيق وRTP)
--   • `game_points_ledger` يتوقف عن استقبال كتابات جديدة
--
-- لا يغيّر أي رصيد قائم، ولا سلوك محرك الألعاب (النتائج تُحسب في الدالة الحافة).
-- ============================================================================

begin;

-- 57.1 حذف النسخة التجريبية التي لا تُنهي جولات (من #56)
drop function if exists public.play_game_with_coin(uuid, text, bigint, text);

-- 57.2 إعادة كتابة دالة التسوية على Coin بنفس التوقيع
create or replace function public.play_game_with_points(
  p_user_id uuid,
  p_game_type public.game_type,
  p_idempotency_key text,
  p_request_data jsonb,
  p_bet_amount bigint,
  p_bet_data jsonb,
  p_result jsonb,
  p_payout bigint,
  p_multiplier numeric,
  p_is_win boolean,
  p_forced_outcome text,
  p_rtp numeric,
  p_room_id uuid,
  p_seed text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user public.users%rowtype;
  v_existing public.game_bets%rowtype;
  v_round_id uuid;
  v_bet_id uuid;
  v_balance_after bigint;
  v_rates jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'غير مصرح بتنفيذ العملية';
  end if;
  if p_user_id is null or p_game_type is null or p_request_data is null
     or p_bet_data is null or p_result is null
     or p_is_win is null or p_multiplier is null or p_rtp is null or p_seed is null
     or p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9._:-]{10,100}$'
     or p_bet_amount is null or p_payout is null
     or p_bet_amount < 1 or p_bet_amount > 1000000
     or p_payout < 0 or p_payout > p_bet_amount * 1000
     or p_multiplier < 0 or p_multiplier > 1000
     or p_rtp < 0 or p_rtp > 100
     or (p_forced_outcome is not null and p_forced_outcome not in ('win', 'lose')) then
    raise exception 'بيانات الجولة غير صالحة';
  end if;

  select * into v_user from public.users where id = p_user_id for update;
  if not found or v_user.status <> 'active' or v_user.adult_confirmed_at is null then
    raise exception 'الحساب غير متاح أو لم يجكّد العمر';
  end if;

  select * into v_existing from public.game_bets
  where user_id = p_user_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.game_type <> p_game_type or v_existing.bet_amount <> p_bet_amount
       or v_existing.request_data <> p_request_data then
      raise exception 'مفتاح منع التكرار مستخدم لطلب مختلف';
    end if;
    return jsonb_build_object(
      'round_id', v_existing.round_id,
      'bet_id', v_existing.id,
      'result', (select r.result from public.game_rounds r where r.id = v_existing.round_id),
      'is_win', v_existing.is_win,
      'multiplier', v_existing.multiplier,
      'payout', v_existing.payout,
      'forced_outcome', v_existing.forced_outcome,
      'balance_after', v_user.balance_gold,
      'currency', 'gold'
    );
  end if;

  -- القسم 11: الألعاب تُلعب بـCoin المشحون فقط
  if v_user.balance_gold < p_bet_amount then
    raise exception 'رصيد Coin غير كافٍ';
  end if;

  insert into public.game_rounds (
    game_type, room_id, seed, result, crash_point,
    total_bets, total_bet_gold, total_payout, rtp_applied,
    ended_at, metadata
  ) values (
    p_game_type, p_room_id, p_seed, p_result, (p_result->>'crash_point')::numeric,
    1, p_bet_amount, p_payout, p_rtp, now(), '{"currency":"gold"}'::jsonb
  ) returning id into v_round_id;

  insert into public.game_bets (
    round_id, user_id, game_type, bet_amount, bet_data, payout,
    multiplier, is_win, forced_outcome, settled_at, idempotency_key, request_data
  ) values (
    v_round_id, p_user_id, p_game_type, p_bet_amount, coalesce(p_bet_data, '{}'::jsonb),
    p_payout, p_multiplier, p_is_win, p_forced_outcome, now(), p_idempotency_key, p_request_data
  ) returning id into v_bet_id;

  v_rates := jsonb_build_object(
    'bet_amount', p_bet_amount,
    'multiplier', p_multiplier,
    'rtp_applied', p_rtp,
    'forced_outcome', p_forced_outcome,
    'currency', 'gold'
  );

  perform public.record_wallet_transaction(
    p_user_id, 'bet'::public.wallet_tx_type, -p_bet_amount,
    'gold', null, p_idempotency_key || ':bet', 'game', v_bet_id,
    jsonb_build_object('game_type', p_game_type, 'round_id', v_round_id, 'bet_amount', p_bet_amount),
    'play-game', 'game_bet', null, 'system', v_rates, v_bet_id
  );

  if p_payout > 0 then
    perform public.record_wallet_transaction(
      p_user_id, 'win'::public.wallet_tx_type, p_payout,
      'gold', null, p_idempotency_key || ':win', 'game', v_bet_id,
      jsonb_build_object('game_type', p_game_type, 'round_id', v_round_id, 'multiplier', p_multiplier),
      'play-game', 'game_win', null, 'system', v_rates, v_bet_id
    );
  end if;

  update public.users set
    is_force_win = case when p_forced_outcome is not null then false else is_force_win end,
    is_force_lose = case when p_forced_outcome is not null then false else is_force_lose end
  where id = p_user_id;

  select balance_gold into v_balance_after from public.users where id = p_user_id;

  return jsonb_build_object(
    'round_id', v_round_id,
    'bet_id', v_bet_id,
    'result', p_result,
    'is_win', p_is_win,
    'multiplier', p_multiplier,
    'payout', p_payout,
    'forced_outcome', p_forced_outcome,
    'balance_after', v_balance_after,
    'currency', 'gold'
  );
end;
$function$;

revoke all on function public.play_game_with_points(uuid, public.game_type, text, jsonb, bigint, jsonb, jsonb, bigint, numeric, boolean, text, numeric, uuid, text)
  from public, anon, authenticated;
grant execute on function public.play_game_with_points(uuid, public.game_type, text, jsonb, bigint, jsonb, jsonb, bigint, numeric, boolean, text, numeric, uuid, text)
  to service_role;

comment on function public.play_game_with_points is 'M3.7 (2026-11-16): الألعاب تُلعب بـCoin (balance_gold). الاسم تاريخي، النقاط ملغاة.';

-- 57.3 منع أي كتابة جديدة على دفتر نقاط الألعاب
create or replace function public.freeze_game_points_ledger()
returns trigger
language plpgsql
as $function$
begin
  raise exception 'game_points_ledger مجمّد منذ 2026-11-16: اقتصاد الألعاب انتقل إلى wallet_transactions (gold)';
end;
$function$;

drop trigger if exists trg_freeze_game_points_ledger on public.game_points_ledger;
create trigger trg_freeze_game_points_ledger
  before insert on public.game_points_ledger
  for each row execute function public.freeze_game_points_ledger();

revoke all on function public.freeze_game_points_ledger() from public, anon, authenticated;

commit;
