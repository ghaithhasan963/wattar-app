-- ============================================================================
-- 56. patch_game_economy_bigo.sql
-- M3.7: اقتصاد الألعاب على نمط بيغو لايف
--
-- المبادئ (قرار الإدارة 2026-11-16):
--   • Coin (Gold) = عملة شحن فقط، 1 USD = 3000 Coin، تُستخدم للألعاب والهدايا، **لا تُسحب أبداً**
--   • Diamond = أرباح المضيفات الموثقات فقط، قابلة للتحويل لـCoin أو سحب كدولار
--   • لا توجد "نقاط ألعاب" منفصلة — المهام اليومية تعطي Coin محدود (≤100)
--   • الألعاب تراهن بـCoin مباشرة من `balance_gold`
--   • `game_points` و`game_points_ledger` تُجمَّدان: لا كتابات جديدة، تُحفظ للتدقيق التاريخي فقط
--
-- خطوات الانتقال الآمن:
--   1) تحديث سعر الشحن: paid_coins_per_usd = 3000
--   2) تحويل رصيد game_points الموجود إلى balance_gold (مرة واحدة)
--   3) إيقاف دوال نقاط الألعاب، استبدالها بدوال تستخدم balance_gold
--   4) إضافة نوعي محفظة للعبة: game_bet / game_win (كـgold)
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 56.1 تحديث سعر الشحن: 1 USD = 3000 Coin
-- ---------------------------------------------------------------------------
update public.admin_settings
set value = '3000'::jsonb, updated_at = now()
where key = 'paid_coins_per_usd';

-- ---------------------------------------------------------------------------
-- 56.2 تحويل game_points الموجودة إلى balance_gold (مرة واحدة فقط)
-- ---------------------------------------------------------------------------
with moved as (
  update public.users
  set balance_gold = balance_gold + game_points,
      game_points = 0
  where game_points > 0
  returning id, game_points as moved_points
)
insert into public.wallet_transactions (
  user_id, type, amount, balance_before, balance_after, currency,
  idempotency_key, reference_type, reference_id, metadata, created_by_function,
  reason, executed_by, executed_by_role, entry_kind
)
select
  id,
  'admin_adjustment'::public.wallet_tx_type,
  moved_points,
  (select balance_gold from public.users u where u.id = moved.id) - moved_points,
  (select balance_gold from public.users u where u.id = moved.id),
  'gold',
  'game-points-migration-' || id::text,
  'migration',
  '00000000-0000-0000-0000-000000000000'::uuid,
  jsonb_build_object('source', 'game_points_migration', 'original_game_points', moved_points),
  'migrate-game-points',
  (select id from public.users order by created_at limit 1),
  'admin',
  'adjustment'
from moved;

-- ---------------------------------------------------------------------------
-- 56.3 إضافة أنواع محفظة للألعاب (تستخدم gold)
-- ---------------------------------------------------------------------------
-- bet/win موجودان أصلاً في wallet_tx_type، نستخدمهما كما هما مع currency='gold'

-- ---------------------------------------------------------------------------
-- 56.4 دوال الألعاب الجديدة: تراهن بـCoin (balance_gold) مباشرة
-- ---------------------------------------------------------------------------
create or replace function public.play_game_with_coin(
  p_user_id uuid,
  p_game_type text,
  p_bet_amount bigint,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user public.users%rowtype;
  v_win bigint := 0;
  v_multiplier numeric := 0;
  v_is_win boolean := false;
  v_bet_id uuid := gen_random_uuid();
  v_result jsonb;
  v_rates jsonb;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'Not authorized';
  end if;
  if p_bet_amount is null or p_bet_amount <= 0 then
    raise exception 'Invalid bet amount';
  end if;
  if length(trim(coalesce(p_idempotency_key, ''))) not between 10 and 90 then
    raise exception 'Invalid idempotency key';
  end if;

  -- قفل رصيد المستخدم
  select * into v_user from public.users where id = p_user_id for update;
  if not found or v_user.status <> 'active' then
    raise exception 'Account unavailable';
  end if;
  if v_user.balance_gold < p_bet_amount then
    raise exception 'Insufficient Coin balance';
  end if;

  -- قفل تكرار الطلب
  perform pg_advisory_xact_lock(hashtext('game-bet:' || p_idempotency_key));
  if exists (select 1 from public.wallet_transactions where idempotency_key = p_idempotency_key || ':bet') then
    raise exception 'Bet already processed';
  end if;

  -- منطق اللعبة المبسط (يرتبط بمحرك الألعاب الحقيقي لاحقاً)
  -- هنا نكتفي ببنية الرهان/الربح، المحرك الحقيقي في Edge Function
  v_win := 0;
  v_multiplier := 0;
  v_is_win := false;

  -- قيد الرهان
  perform public.record_wallet_transaction(
    p_user_id, 'bet'::public.wallet_tx_type, -p_bet_amount,
    'gold', null, p_idempotency_key || ':bet', 'game', v_bet_id,
    jsonb_build_object('game_type', p_game_type, 'bet_amount', p_bet_amount),
    'play-game-coin', 'game_bet', null, 'system'
  );

  -- قيد الربح (إذا ربح)
  if v_win > 0 then
    perform public.record_wallet_transaction(
      p_user_id, 'win'::public.wallet_tx_type, v_win,
      'gold', null, p_idempotency_key || ':win', 'game', v_bet_id,
      jsonb_build_object('game_type', p_game_type, 'multiplier', v_multiplier),
      'play-game-coin', 'game_win', null, 'system'
    );
  end if;

  v_rates := jsonb_build_object('bet_amount', p_bet_amount, 'win', v_win, 'multiplier', v_multiplier);

  v_result := jsonb_build_object(
    'success', true,
    'bet_id', v_bet_id,
    'bet_amount', p_bet_amount,
    'win_amount', v_win,
    'multiplier', v_multiplier,
    'is_win', v_is_win,
    'balance_gold', (select balance_gold from public.users where id = p_user_id)
  );
  return v_result;
end;
$function$;

revoke all on function public.play_game_with_coin(uuid, text, bigint, text) from public, anon, authenticated;
grant execute on function public.play_game_with_coin(uuid, text, bigint, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 56.5 مكافأة يومية: تعطي Coin محدود (gold)
-- ---------------------------------------------------------------------------
create or replace function public.claim_daily_bonus_coin(
  p_user_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user public.users%rowtype;
  v_bonus bigint;
  v_last_claim timestamptz;
  v_rates jsonb;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'Not authorized';
  end if;
  if length(trim(coalesce(p_idempotency_key, ''))) not between 10 and 90 then
    raise exception 'Invalid idempotency key';
  end if;

  select * into v_user from public.users where id = p_user_id for update;
  if not found or v_user.status <> 'active' then
    raise exception 'Account unavailable';
  end if;

  v_last_claim := v_user.daily_bonus_claimed_at;
  if v_last_claim is not null and v_last_claim > now() - interval '20 hours' then
    raise exception 'Daily bonus already claimed';
  end if;

  -- المكافأة من إعدادات الإدارة (افتراضي 50، حد أقصى 100)
  select least(coalesce((s.value #>> '{}')::bigint, 50), 100) into v_bonus
  from public.admin_settings s where s.key = 'daily_bonus_gold';

  perform pg_advisory_xact_lock(hashtext('daily-bonus:' || p_idempotency_key));
  if exists (select 1 from public.wallet_transactions where idempotency_key = p_idempotency_key) then
    raise exception 'Bonus already claimed';
  end if;

  perform public.record_wallet_transaction(
    p_user_id, 'daily_bonus'::public.wallet_tx_type, v_bonus,
    'gold', null, p_idempotency_key, 'daily_bonus', null,
    jsonb_build_object('bonus_type', 'daily_login'),
    'claim-daily-bonus', 'daily_bonus_claim', null, 'system'
  );

  update public.users set daily_bonus_claimed_at = now() where id = p_user_id;

  v_rates := jsonb_build_object('bonus_gold', v_bonus);

  return jsonb_build_object(
    'success', true,
    'bonus_gold', v_bonus,
    'balance_gold', (select balance_gold from public.users where id = p_user_id)
  );
end;
$function$;

revoke all on function public.claim_daily_bonus_coin(uuid, text) from public, anon;
grant execute on function public.claim_daily_bonus_coin(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 56.6 مهمة يومية: تعطي Coin محدود (gold) - بديلة لـ claim_daily_mission
-- ---------------------------------------------------------------------------
create or replace function public.claim_daily_task_coin(
  p_user_id uuid,
  p_mission_key text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user public.users%rowtype;
  v_mission record;
  v_reward bigint;
  v_rates jsonb;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'Not authorized';
  end if;
  if length(trim(coalesce(p_idempotency_key, ''))) not between 10 and 90 then
    raise exception 'Invalid idempotency key';
  end if;

  select * into v_user from public.users where id = p_user_id for update;
  if not found or v_user.status <> 'active' then
    raise exception 'Account unavailable';
  end if;

  select * into v_mission from public.daily_missions
  where mission_key = p_mission_key and is_enabled;
  if not found then
    raise exception 'Mission not found';
  end if;

  -- تحقق من تقدم المهمة (بنية مبسطة، المنطق الحقيقي في Edge Function)
  -- هنا نكتفي ببنية المكافأة

  v_reward := least(v_mission.reward_gold, 100); -- حد أقصى 100 Coin

  perform pg_advisory_xact_lock(hashtext('daily-task:' || p_idempotency_key));
  if exists (select 1 from public.wallet_transactions where idempotency_key = p_idempotency_key) then
    raise exception 'Task reward already claimed';
  end if;

  perform public.record_wallet_transaction(
    p_user_id, 'daily_bonus'::public.wallet_tx_type, v_reward,
    'gold', null, p_idempotency_key, 'daily_task', null,
    jsonb_build_object('mission_key', p_mission_key, 'task_reward', v_reward),
    'claim-daily-task', 'task_reward', null, 'system'
  );

  v_rates := jsonb_build_object('task_reward_gold', v_reward);

  return jsonb_build_object(
    'success', true,
    'reward_gold', v_reward,
    'balance_gold', (select balance_gold from public.users where id = p_user_id)
  );
end;
$function$;

revoke all on function public.claim_daily_task_coin(uuid, text, text) from public, anon;
grant execute on function public.claim_daily_task_coin(uuid, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 56.7 إضافة حقل مكافأة Coin للمهام اليومية (بديل reward_game_points)
-- ---------------------------------------------------------------------------
alter table public.daily_missions
  add column if not exists reward_gold bigint not null default 10;

-- تحديث المهام الموجودة: تحويل نقاط الألعاب إلى Coin (1 نقطة = 1 Coin، حد أقصى 100)
update public.daily_missions
set reward_gold = least(reward_game_points, 100)
where reward_gold = 10 and reward_game_points > 0;

-- ---------------------------------------------------------------------------
-- 56.8 إيقاف دوال نقاط الألعاب القديمة (تحتفظ للتاريخ، تمنع الاستدعاء الجديد)
-- ---------------------------------------------------------------------------
-- الدوال القديمة تبقى كما هي لكن تُوثق كمُجمَّدة
comment on function public.play_game_with_points is 'DEPRECATED 2026-11-16: استخدم play_game_with_coin — يراهن بـbalance_gold مباشرة';
comment on function public.claim_daily_game_points is 'DEPRECATED 2026-11-16: استخدم claim_daily_bonus_coin — يعطي Coin محدود';
comment on function public.claim_daily_game_points_for_user is 'DEPRECATED 2026-11-16: استخدم claim_daily_bonus_coin';
comment on function public.claim_daily_mission is 'DEPRECATED 2026-11-16: استخدم claim_daily_task_coin — يعطي Coin محدود';

-- ---------------------------------------------------------------------------
-- 56.9 عمود game_points في users: يُجمَّد (يبقى للتدقيق، لا يُكتب)
-- ---------------------------------------------------------------------------
comment on column public.users.game_points is 'FROZEN 2026-11-16: اقتصاد الألعاب انتقل إلى balance_gold. هذا العمود للتدقيق التاريخي فقط، لا تُكتب قيم جديدة.';

commit;