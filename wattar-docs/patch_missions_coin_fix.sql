-- ============================================================================
-- 59f. patch_missions_coin_fix.sql
-- تصحيح: `entry_kind` المسموح هو (normal, reversal, adjustment, opening)
--         لا يوجد 'grant'. منح المكافآت اليومية قيود عادية → 'normal'.
-- ============================================================================

begin;

select set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);

-- 1) المكافأة اليومية المركزية
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

  if exists (select 1 from public.wallet_transactions w where w.idempotency_key = v_key) then
    return jsonb_build_object('claimed', false, 'balance', v_user.balance_gold, 'currency', 'gold');
  end if;

  select least(greatest(coalesce((s.value #>> '{}')::bigint, 50), 1), 100)
    into v_award
  from public.admin_settings s
  where s.key = 'daily_bonus_gold';
  v_award := coalesce(v_award, 50);

  perform public.record_wallet_transaction(
    p_user_id, 'daily_bonus'::public.wallet_tx_type, v_award,
    'gold', null, v_key, 'daily_bonus', null,
    jsonb_build_object('source', 'daily_bonus', 'day', v_today),
    'claim-daily-bonus', 'daily_bonus_claim', null, 'system',
    jsonb_build_object('bonus_gold', v_award, 'daily_cap', 100),
    null, 'normal'
  );

  update public.users set daily_bonus_claimed_at = now() where id = p_user_id;

  return jsonb_build_object(
    'claimed', true, 'granted', v_award, 'amount', v_award,
    'balance', v_user.balance_gold + v_award, 'currency', 'gold'
  );
end;
$function$;

revoke all on function public.claim_daily_game_points_for_user(uuid) from public, anon, authenticated;
grant execute on function public.claim_daily_game_points_for_user(uuid) to service_role;

-- 2) استلام المهمة
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
    perform public.award_user_xp(
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

select 'entry_kind fixed' as status;

commit;