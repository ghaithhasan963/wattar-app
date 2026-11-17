-- ============================================================================
-- 59g. patch_missions_coin_fix2.sql
-- إصلاح: `award_user_xp` مقفلة على service_role، لكن `claim_daily_mission`
-- تُستدعى من العميل (authenticated) فكانت تفشل عند منح XP — وهذا خلل قديم
-- كان يجعل استلام أي مهمة مكتملة يفشل.
--
-- الحل: منطق XP يُنقل إلى دالة داخلية `award_user_xp_internal` بلا فحص دور
-- (غير قابلة للاستدعاء من أي دور عميل)، و`award_user_xp` تبقى كما هي
-- للاستدعاء من دوال الحافة (service_role) وتفوّض للداخلية.
-- `claim_daily_mission` تستدعي الداخلية بعد التحقق من auth.uid().
-- ============================================================================

begin;

select set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);

-- 59g.1 الدالة الداخلية لمنح XP (بلا فحص دور، لكن غير ممنوحة لأي دور عميل)
create or replace function public.award_user_xp_internal(
  p_user_id uuid,
  p_event_key text,
  p_event_type text,
  p_points integer
)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_xp bigint;
  v_level integer;
begin
  if p_user_id is null
     or length(trim(coalesce(p_event_key, ''))) not between 1 and 160
     or p_event_type not in ('daily_login', 'room_participation', 'gift_received', 'story_post', 'social_engagement')
     or p_points not between 1 and 10000 then
    raise exception 'Invalid progress event';
  end if;

  insert into public.progress_events (user_id, event_key, event_type, points)
  values (p_user_id, p_event_key, p_event_type, p_points)
  on conflict (event_key) do nothing;

  if not found then
    select u.level into v_level from public.users u where u.id = p_user_id;
    return coalesce(v_level, 1);
  end if;

  update public.users
  set experience_points = experience_points + p_points,
      level = floor(sqrt((experience_points + p_points)::numeric / 100))::integer + 1
  where id = p_user_id and status = 'active'
  returning experience_points, level into v_xp, v_level;

  if not found then
    raise exception 'User not found or inactive';
  end if;
  return v_level;
end;
$function$;

revoke all on function public.award_user_xp_internal(uuid, text, text, integer) from public, anon, authenticated;

-- 59g.2 الواجهة الخارجية تبقى مقفلة على service_role وتفوّض للداخلية
create or replace function public.award_user_xp(
  p_user_id uuid,
  p_event_key text,
  p_event_type text,
  p_points integer
)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if auth.role() <> 'service_role' then
    raise exception 'Not authorized';
  end if;
  return public.award_user_xp_internal(p_user_id, p_event_key, p_event_type, p_points);
end;
$function$;

revoke all on function public.award_user_xp(uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.award_user_xp(uuid, text, text, integer) to service_role;

-- 59g.3 استلام المهمة يستخدم الدالة الداخلية
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
      'success', true, 'already_claimed', true,
      'coin_awarded', v_claim.coin_awarded, 'game_points_awarded', 0,
      'xp_awarded', v_claim.xp_awarded, 'balance_gold', v_user.balance_gold
    );
  end if;

  v_progress := public.daily_mission_progress(auth.uid(), v_mission.event_type, v_day);
  if v_progress < v_mission.target_count then
    raise exception 'لم يكتمل تقدم المهمة بعد';
  end if;

  v_reward := least(greatest(coalesce(v_mission.reward_gold, 10), 0), 100);
  v_awarded_coin := v_reward;
  v_awarded_xp := v_mission.reward_xp;

  insert into public.daily_mission_claims (
    mission_id, user_id, claim_date, progress_count,
    game_points_awarded, coin_awarded, xp_awarded
  ) values (
    p_mission_id, auth.uid(), v_day, v_progress, 0, v_awarded_coin, v_awarded_xp
  )
  returning * into v_claim;

  if v_awarded_coin > 0 then
    perform public.record_wallet_transaction(
      auth.uid(), 'daily_bonus'::public.wallet_tx_type, v_awarded_coin,
      'gold', null, 'mission:' || v_claim.id::text || ':coin',
      'daily_task', p_mission_id,
      jsonb_build_object('mission_key', v_mission.mission_key, 'mission_id', p_mission_id),
      'claim-daily-mission', 'task_reward', null, 'system',
      jsonb_build_object('reward_gold', v_awarded_coin, 'mission_cap', 100),
      null, 'normal'
    );
  end if;

  if v_awarded_xp > 0 then
    perform public.award_user_xp_internal(
      auth.uid(), 'mission:' || v_claim.id::text, 'social_engagement', v_awarded_xp
    );
  end if;

  return jsonb_build_object(
    'success', true, 'already_claimed', false,
    'coin_awarded', v_awarded_coin, 'game_points_awarded', 0,
    'xp_awarded', v_awarded_xp,
    'balance_gold', (select balance_gold from public.users where id = auth.uid())
  );
end;
$function$;

revoke all on function public.claim_daily_mission(uuid) from public, anon;
grant execute on function public.claim_daily_mission(uuid) to authenticated, service_role;

comment on function public.award_user_xp_internal(uuid, text, text, integer) is 'M3.7: منطق XP الداخلي — يُستدعى من دوال SECURITY DEFINER بعد التحقق من الهوية، غير ممنوح لأي دور عميل.';

select 'xp internal ready' as status;

commit;