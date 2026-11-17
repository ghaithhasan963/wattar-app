-- ============================================================================
-- 59. patch_missions_coin.sql
-- M3.7 (تكملة): المهام اليومية والمكافأة اليومية تعطيان Coin (gold) لا نقاطاً
--
-- الخلل الذي يصلحه هذا الترحيل:
--   • `claim_daily_mission` ما زال يزيد `users.game_points` ويكتب في
--     `game_points_ledger` المجمَّد في #57 → كل استلام مهمة كان سيفشل.
--   • `claim_daily_game_points_for_user` (التي تستدعيها دالة الحافة
--     `daily-bonus`) تعاني نفس المشكلة.
--   • `claim_daily_task_coin` من #56 كانت تدفع المكافأة دون التحقق من
--     إنجاز المهمة ولا تسجّل استلاماً — أُلغيت.
--   • `list_daily_missions` كانت تُرجع `reward_game_points` فقط.
--
-- النموذج المعتمد (قرار الإدارة 2026-11-16):
--   • Coin = عملة الشحن، 1 USD = 3000 Coin، لا تُسحب أبداً.
--   • المهام اليومية والمكافأة اليومية تضيف Coin مجانياً بحد أقصى 100/مهمة.
--   • لا سقف على *الرصيد* (لأن Coin تُشترى)، السقف على *العطاء المجاني* فقط.
--   • XP يبقى كما هو (نظام خبرة/مستويات، ليس عملة).
-- ============================================================================

begin;

select set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);

-- ---------------------------------------------------------------------------
-- 59.1 تسجيل Coin المستلمة في سجل استلام المهمة
-- ---------------------------------------------------------------------------
alter table public.daily_mission_claims
  add column if not exists coin_awarded bigint not null default 0;

-- ---------------------------------------------------------------------------
-- 59.2 تقدم مهمة "الاستلام اليومي" يُقرأ من المحفظة لا من دفتر النقاط المجمّد
-- ---------------------------------------------------------------------------
create or replace function public.daily_mission_progress(
  p_user_id uuid,
  p_event_type text,
  p_day date
)
returns integer
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_start timestamptz := p_day::timestamp at time zone 'UTC';
  v_end timestamptz := (p_day + 1)::timestamp at time zone 'UTC';
  v_count bigint;
begin
  case p_event_type
    when 'daily_grant' then
      select count(*) into v_count
      from public.wallet_transactions w
      where w.user_id = p_user_id
        and w.type = 'daily_bonus'
        and w.currency = 'gold'
        and w.created_at >= v_start and w.created_at < v_end;
    when 'story_post' then
      select count(*) into v_count
      from public.stories s
      where s.user_id = p_user_id and s.created_at >= v_start and s.created_at < v_end;
    when 'gift_sent' then
      select count(*) into v_count
      from public.gift_transactions g
      where g.from_user_id = p_user_id and g.funding_currency = 'gold'
        and g.created_at >= v_start and g.created_at < v_end;
    when 'gift_received' then
      select count(*) into v_count
      from public.gift_transactions g
      where g.to_user_id = p_user_id and g.received_diamond_currency = 'diamond'
        and g.created_at >= v_start and g.created_at < v_end;
    when 'following' then
      select count(*) into v_count
      from public.user_follows f
      where f.follower_id = p_user_id and f.created_at >= v_start and f.created_at < v_end;
    else
      raise exception 'نوع مهمة غير مدعوم';
  end case;
  return least(coalesce(v_count, 0), 2147483647)::integer;
end;
$function$;

revoke all on function public.daily_mission_progress(uuid, text, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 59.3 الدالة المركزية للمكافأة اليومية: تُعيد Coin (gold)
--     نفس توقيع `claim_daily_game_points_for_user` حتى لا تتغير دالة الحافة.
-- ---------------------------------------------------------------------------
create or replace function public.claim_daily_game_points_for_user(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user public.users%rowtype;
  v_award bigint;
  v_today date := (now() at time zone 'UTC')::date;
  v_key text;
begin
  if p_user_id is null
     or (auth.role() <> 'service_role' and p_user_id is distinct from auth.uid()) then
    raise exception 'Not authorized';
  end if;

  select * into v_user from public.users where id = p_user_id for update;
  if not found or v_user.status <> 'active' or v_user.adult_confirmed_at is null then
    raise exception 'الحساب غير متاح أو لم يؤكد العمر';
  end if;

  v_key := 'daily-bonus:' || p_user_id::text || ':' || v_today::text;

  -- منع التكرار: سجل المحفظة هو مصدر الحقيقة
  if exists (select 1 from public.wallet_transactions w where w.idempotency_key = v_key) then
    return jsonb_build_object(
      'claimed', false,
      'balance', v_user.balance_gold,
      'currency', 'gold'
    );
  end if;

  -- المكافأة من إعدادات الإدارة، وبحد أقصى 100 Coin
  select least(greatest(coalesce((s.value #>> '{}')::bigint, 50), 1), 100)
    into v_award
  from public.admin_settings s
  where s.key = 'daily_bonus_gold';

  v_award := coalesce(v_award, 50);

  perform public.record_wallet_transaction(
    p_user_id,
    'daily_bonus'::public.wallet_tx_type,
    v_award,
    'gold',
    null,
    v_key,
    'daily_bonus',
    null,
    jsonb_build_object('source', 'daily_bonus', 'day', v_today),
    'claim-daily-bonus',
    'daily_bonus_claim',
    null,
    'system',
    jsonb_build_object('bonus_gold', v_award, 'daily_cap', 100),
    null,
    'grant'
  );

  update public.users set daily_bonus_claimed_at = now() where id = p_user_id;

  return jsonb_build_object(
    'claimed', true,
    'granted', v_award,
    'amount', v_award,
    'balance', v_user.balance_gold + v_award,
    'currency', 'gold'
  );
end;
$function$;

revoke all on function public.claim_daily_game_points_for_user(uuid) from public, anon, authenticated;
grant execute on function public.claim_daily_game_points_for_user(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 59.4 واجهة العميل للمكافأة اليومية (نفس الاسم القديم للتوافق)
-- ---------------------------------------------------------------------------
create or replace function public.claim_daily_game_points()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول';
  end if;
  return public.claim_daily_game_points_for_user(auth.uid());
end;
$function$;

revoke all on function public.claim_daily_game_points() from public, anon;
grant execute on function public.claim_daily_game_points() to authenticated;

-- ---------------------------------------------------------------------------
-- 59.5 الاسم الجديد `claim_daily_bonus_coin` يفوّض للدالة المركزية
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
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'Not authorized';
  end if;
  if length(trim(coalesce(p_idempotency_key, ''))) not between 10 and 90 then
    raise exception 'Invalid idempotency key';
  end if;
  return public.claim_daily_game_points_for_user(p_user_id);
end;
$function$;

revoke all on function public.claim_daily_bonus_coin(uuid, text) from public, anon;
grant execute on function public.claim_daily_bonus_coin(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 59.6 إلغاء الدالة غير الآمنة من #56 (لم تُستخدم في أي عميل)
-- ---------------------------------------------------------------------------
drop function if exists public.claim_daily_task_coin(uuid, text, text);

-- ---------------------------------------------------------------------------
-- 59.7 استلام المهمة: يدفع Coin بعد التحقق من الإنجاز
-- ---------------------------------------------------------------------------
create or replace function public.claim_daily_mission(p_mission_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user public.users%rowtype;
  v_mission public.daily_missions%rowtype;
  v_claim public.daily_mission_claims%rowtype;
  v_day date := (now() at time zone 'UTC')::date;
  v_progress integer;
  v_reward bigint;
  v_awarded_coin bigint := 0;
  v_awarded_xp integer := 0;
begin
  if auth.uid() is null or p_mission_id is null then
    raise exception 'طلب استلام المهمة غير صالح';
  end if;

  select * into v_user from public.users where id = auth.uid() for update;
  if not found or v_user.status <> 'active' or v_user.adult_confirmed_at is null then
    raise exception 'الحساب غير متاح أو لم يؤكد العمر';
  end if;

  select * into v_mission from public.daily_missions
  where id = p_mission_id and is_enabled and starts_at <= now()
    and (ends_at is null or ends_at > now());
  if not found then
    raise exception 'المهمة غير متاحة';
  end if;

  select * into v_claim from public.daily_mission_claims
  where mission_id = p_mission_id and user_id = auth.uid() and claim_date = v_day;
  if found then
    return jsonb_build_object(
      'success', true,
      'already_claimed', true,
      'coin_awarded', v_claim.coin_awarded,
      'game_points_awarded', 0,
      'xp_awarded', v_claim.xp_awarded,
      'balance_gold', v_user.balance_gold
    );
  end if;

  v_progress := public.daily_mission_progress(auth.uid(), v_mission.event_type, v_day);
  if v_progress < v_mission.target_count then
    raise exception 'لم يكتمل تقدم المهمة بعد';
  end if;

  -- سقف العطاء المجاني: 100 Coin لكل مهمة
  v_reward := least(greatest(coalesce(v_mission.reward_gold, 10), 0), 100);
  v_awarded_coin := v_reward;
  v_awarded_xp := v_mission.reward_xp;

  insert into public.daily_mission_claims (
    mission_id, user_id, claim_date, progress_count,
    game_points_awarded, coin_awarded, xp_awarded
  ) values (
    p_mission_id, auth.uid(), v_day, v_progress,
    0, v_awarded_coin, v_awarded_xp
  )
  returning * into v_claim;

  if v_awarded_coin > 0 then
    perform public.record_wallet_transaction(
      auth.uid(),
      'daily_bonus'::public.wallet_tx_type,
      v_awarded_coin,
      'gold',
      null,
      'mission:' || v_claim.id::text || ':coin',
      'daily_task',
      p_mission_id,
      jsonb_build_object('mission_key', v_mission.mission_key, 'mission_id', p_mission_id),
      'claim-daily-mission',
      'task_reward',
      null,
      'system',
      jsonb_build_object('reward_gold', v_awarded_coin, 'mission_cap', 100),
      null,
      'grant'
    );
  end if;

  if v_awarded_xp > 0 then
    perform public.award_user_xp(
      auth.uid(), 'mission:' || v_claim.id::text, 'social_engagement', v_awarded_xp
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'already_claimed', false,
    'coin_awarded', v_awarded_coin,
    'game_points_awarded', 0,
    'xp_awarded', v_awarded_xp,
    'balance_gold', (select balance_gold from public.users where id = auth.uid())
  );
end;
$function$;

revoke all on function public.claim_daily_mission(uuid) from public, anon;
grant execute on function public.claim_daily_mission(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 59.8 قائمة المهام: تُرجع مكافأة Coin
-- ---------------------------------------------------------------------------
drop function if exists public.list_daily_missions();

create function public.list_daily_missions()
returns table (
  mission_id uuid,
  mission_key text,
  title text,
  description text,
  event_type text,
  target_count integer,
  current_progress integer,
  reward_gold integer,
  reward_xp integer,
  is_claimed boolean,
  coin_awarded bigint,
  xp_awarded integer
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select m.id,
         m.mission_key,
         case m.mission_key
           when 'daily-free-points' then 'استلم مكافأة الدخول اليومية'
           else m.title
         end,
         case m.mission_key
           when 'daily-free-points' then 'افتح التطبيق واستلم مكافأة الدخول اليومية بالـCoin.'
           when 'send-a-paid-gift' then 'أرسل هدية باستخدام Coin.'
           when 'receive-a-paid-gift' then 'استقبل هدية أُرسلت باستخدام Coin.'
           else m.description
         end,
         m.event_type,
         m.target_count,
         public.daily_mission_progress(auth.uid(), m.event_type, (now() at time zone 'UTC')::date),
         least(greatest(coalesce(m.reward_gold, 10), 0), 100),
         m.reward_xp,
         c.id is not null,
         coalesce(c.coin_awarded, 0),
         coalesce(c.xp_awarded, 0)
  from public.daily_missions m
  left join public.daily_mission_claims c
    on c.mission_id = m.id and c.user_id = auth.uid()
    and c.claim_date = (now() at time zone 'UTC')::date
  where auth.uid() is not null
    and m.is_enabled
    and m.starts_at <= now()
    and (m.ends_at is null or m.ends_at > now())
    and exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.status = 'active' and u.adult_confirmed_at is not null
    )
  order by m.mission_key;
$function$;

revoke all on function public.list_daily_missions() from public, anon;
grant execute on function public.list_daily_missions() to authenticated;

-- ---------------------------------------------------------------------------
-- 59.9 توثيق
-- ---------------------------------------------------------------------------
comment on function public.claim_daily_mission(uuid) is 'M3.7 (2026-11-16): تمنح Coin (gold) بحد أقصى 100 للمهمة، بعد التحقق من التقدم.';
comment on function public.claim_daily_game_points_for_user(uuid) is 'M3.7 (2026-11-16): المكافأة اليومية أصبحت Coin (gold) بحد أقصى 100. الاسم تاريخي.';
comment on function public.daily_mission_progress(uuid, text, date) is 'M3.7 (2026-11-16): تقدم daily_grant يُقرأ من wallet_transactions بدل دفتر النقاط المجمّد.';
comment on column public.daily_mission_claims.coin_awarded is 'M3.7: كمية Coin الممنوحة عند استلام المهمة (game_points_awarded تاريخي = 0).';

select 'missions migrated to coin' as status;

commit;