-- ============================================================
-- patch_m10_symbolic_rewards_ui.sql
-- M10.1: إظهار الهدايا الرمزية الممنوحة في واجهات المهام/الولاء/المستويات
--   1) loyalty_settings(): إثراء كل شارة باسم/رمز/كمية هديتها الرمزية.
--   2) claim_daily_loyalty(): إرجاع اسم الهدية عند اكتساب شارة جديدة.
--   3) list_daily_missions(): أعمدة هدية المهمة (معرف/اسم/رمز/كمية).
--   4) claim_daily_mission(): إرجاع تفاصيل الهدية الممنوحة.
--   5) admin_upsert_level_reward(): دعم free_gift_quantity.
-- لا تغيير في منطق المنح نفسه (تتم عبر patch_m10_symbolic_auto_grants.sql).
-- ============================================================
BEGIN;

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- ------------------------------------------------------------
-- 1) إعدادات الولاء: إثراء الشارات ببيانات هديتها الرمزية
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.loyalty_settings()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH s AS (
    SELECT
      coalesce((SELECT (value #>> '{}')::boolean FROM public.admin_settings WHERE key = 'loyalty_enabled'), true) AS enabled,
      coalesce((SELECT value #>> '{}' FROM public.admin_settings WHERE key = 'loyalty_timezone'), 'Asia/Damascus') AS tz,
      greatest(0, coalesce((SELECT (value #>> '{}')::int FROM public.admin_settings WHERE key = 'loyalty_points_base'), 10)) AS base,
      greatest(0, coalesce((SELECT (value #>> '{}')::int FROM public.admin_settings WHERE key = 'loyalty_points_step'), 5)) AS step,
      greatest(0, coalesce((SELECT (value #>> '{}')::int FROM public.admin_settings WHERE key = 'loyalty_points_cap_days'), 6)) AS cap_days,
      coalesce((SELECT value FROM public.admin_settings WHERE key = 'loyalty_badges'), '[]'::jsonb) AS badges
  )
  SELECT jsonb_build_object(
    'enabled', enabled,
    'timezone', tz,
    'base', base,
    'step', step,
    'cap_days', cap_days,
    'badges', coalesce((
      SELECT jsonb_agg(
        CASE
          WHEN g.id IS NOT NULL THEN b || jsonb_build_object(
            'gift_name', coalesce(nullif(btrim(g.name_ar), ''), nullif(btrim(g.name), ''), 'هدية رمزية'),
            'gift_emoji', coalesce(nullif(btrim(g.icon_emoji), ''), '🎁'),
            'gift_quantity', greatest(1, least(coalesce((b ->> 'gift_quantity')::int, 1), 100))
          )
          ELSE b
        END
        ORDER BY ord
      )
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(s.badges) = 'array' THEN s.badges ELSE '[]'::jsonb END
      ) WITH ORDINALITY AS t(b, ord)
      LEFT JOIN public.gifts g
        ON g.id = CASE
             WHEN (b ->> 'gift_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               THEN (b ->> 'gift_id')::uuid
           END
        AND g.is_symbolic
        AND g.is_active
    ), '[]'::jsonb)
  )
  FROM s;
$$;

REVOKE ALL ON FUNCTION public.loyalty_settings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.loyalty_settings() TO authenticated, service_role;

-- ------------------------------------------------------------
-- 2) استلام الولاء: إرجاع هدية الشارة الجديدة
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_daily_loyalty()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_cfg jsonb := public.loyalty_settings();
  v_row public.loyalty_streaks%ROWTYPE;
  v_today date;
  v_streak integer;
  v_points integer;
  v_badge jsonb;
  v_badge_key text;
  v_next jsonb;
  v_claimed boolean := false;
  v_badge_awarded boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  INSERT INTO public.loyalty_streaks (user_id) VALUES (v_uid)
  ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO v_row FROM public.loyalty_streaks WHERE user_id = v_uid FOR UPDATE;

  v_today := public.loyalty_today(v_cfg ->> 'timezone');

  IF NOT coalesce((v_cfg ->> 'enabled')::boolean, true) THEN
    RETURN jsonb_build_object(
      'status', 'disabled',
      'streak_days', v_row.streak_days,
      'best_streak', v_row.best_streak,
      'total_points', v_row.total_points,
      'points_awarded', 0,
      'badge', v_row.badge,
      'claimed_on', v_row.last_claim_date
    );
  END IF;

  IF v_row.last_claim_date = v_today THEN
    RETURN jsonb_build_object(
      'status', 'already_claimed',
      'streak_days', v_row.streak_days,
      'best_streak', v_row.best_streak,
      'total_points', v_row.total_points,
      'points_awarded', 0,
      'badge', v_row.badge,
      'claimed_on', v_row.last_claim_date
    );
  END IF;

  v_streak := CASE
    WHEN v_row.last_claim_date = v_today - 1 THEN v_row.streak_days + 1
    ELSE 1
  END;

  v_points := (v_cfg ->> 'base')::int
    + (v_cfg ->> 'step')::int * least(greatest(v_streak - 1, 0), (v_cfg ->> 'cap_days')::int);

  v_badge := public.loyalty_badge_for_streak(v_cfg -> 'badges', v_streak);
  v_badge_key := CASE WHEN v_badge IS NULL THEN v_row.badge ELSE v_badge ->> 'key' END;
  v_badge_awarded := v_badge IS NOT NULL AND (v_badge ->> 'key') = v_badge_key;

  INSERT INTO public.loyalty_claims (user_id, claim_date, streak_days, points_awarded, badge)
  VALUES (v_uid, v_today, v_streak, v_points, v_badge_key)
  ON CONFLICT (user_id, claim_date) DO NOTHING;
  v_claimed := FOUND;

  IF NOT v_claimed THEN
    SELECT * INTO v_row FROM public.loyalty_streaks WHERE user_id = v_uid;
    RETURN jsonb_build_object(
      'status', 'already_claimed',
      'streak_days', v_row.streak_days,
      'best_streak', v_row.best_streak,
      'total_points', v_row.total_points,
      'points_awarded', 0,
      'badge', v_row.badge,
      'claimed_on', v_row.last_claim_date
    );
  END IF;

  UPDATE public.loyalty_streaks
  SET streak_days = v_streak,
      best_streak = greatest(best_streak, v_streak),
      total_points = total_points + v_points,
      last_claim_date = v_today,
      badge = v_badge_key,
      updated_at = now()
  WHERE user_id = v_uid
  RETURNING * INTO v_row;

  v_next := (
    SELECT b
    FROM jsonb_array_elements(v_cfg -> 'badges') b
    WHERE coalesce((b ->> 'days')::int, 0) > v_streak
    ORDER BY (b ->> 'days')::int ASC
    LIMIT 1
  );

  INSERT INTO public.user_notifications (
    user_id, actor_id, event_type, reference_id, title, body, route
  ) VALUES (
    v_uid, NULL, 'loyalty_streak', NULL,
    'سلسلة ولاء ' || v_streak::text || ' ' ||
      CASE WHEN v_streak = 1 THEN 'يوم' WHEN v_streak = 2 THEN 'يومان'
           WHEN v_streak BETWEEN 3 AND 10 THEN 'أيام' ELSE 'يوماً' END,
    '+' || v_points::text || ' نقطة ولاء'
      || CASE WHEN v_badge_awarded
              THEN ' وحصلت على شارة «' || coalesce(v_badge ->> 'label', v_badge_key) || '»' ELSE '' END
      || CASE WHEN v_badge_awarded AND v_badge ->> 'gift_name' IS NOT NULL
              THEN ' مع هدية «' || (v_badge ->> 'gift_name') || '» إلى حقيبتك' ELSE '' END
      || '. النقاط للعرض فقط ولا تُحوَّل إلى رصيد.',
    '/loyalty'
  );

  RETURN jsonb_build_object(
    'status', 'claimed',
    'streak_days', v_row.streak_days,
    'best_streak', v_row.best_streak,
    'total_points', v_row.total_points,
    'points_awarded', v_points,
    'badge', v_row.badge,
    'badge_label', v_badge ->> 'label',
    'badge_awarded', v_badge_awarded,
    'badge_gift_name', CASE WHEN v_badge_awarded THEN v_badge ->> 'gift_name' END,
    'badge_gift_emoji', CASE WHEN v_badge_awarded THEN v_badge ->> 'gift_emoji' END,
    'next_badge', v_next,
    'claimed_on', v_today
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_daily_loyalty() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_daily_loyalty() TO authenticated, service_role;

-- ------------------------------------------------------------
-- 3) قائمة المهام: أعمدة هدية المهمة
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.list_daily_missions();

CREATE FUNCTION public.list_daily_missions()
RETURNS TABLE(
  mission_id uuid,
  mission_key text,
  title text,
  description text,
  event_type text,
  target_count integer,
  current_progress integer,
  reward_gold integer,
  reward_xp integer,
  reward_gift_id uuid,
  reward_gift_name text,
  reward_gift_emoji text,
  reward_gift_quantity integer,
  is_claimed boolean,
  coin_awarded bigint,
  xp_awarded integer
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
         g.id,
         g.name,
         g.emoji,
         case when g.id is null then null else greatest(1, least(coalesce(m.reward_gift_quantity, 1), 100)) end,
         c.id is not null,
         coalesce(c.coin_awarded, 0),
         coalesce(c.xp_awarded, 0)
  from public.daily_missions m
  left join public.daily_mission_claims c
    on c.mission_id = m.id and c.user_id = auth.uid()
    and c.claim_date = (now() at time zone 'UTC')::date
  left join lateral (
    select gg.id,
           coalesce(nullif(btrim(gg.name_ar), ''), nullif(btrim(gg.name), ''), 'هدية رمزية') as name,
           coalesce(nullif(btrim(gg.icon_emoji), ''), '🎁') as emoji
    from public.gifts gg
    where gg.id = m.reward_gift_id and gg.is_symbolic and gg.is_active
  ) g on true
  where auth.uid() is not null
    and m.is_enabled
    and m.starts_at <= now()
    and (m.ends_at is null or m.ends_at > now())
    and exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.status = 'active' and u.adult_confirmed_at is not null
    )
  order by m.mission_key;
$$;

REVOKE ALL ON FUNCTION public.list_daily_missions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_daily_missions() TO authenticated, service_role;

-- ------------------------------------------------------------
-- 4) استلام المهمة: إرجاع تفاصيل الهدية الممنوحة
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_daily_mission(p_mission_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
declare
  v_user public.users%rowtype;
  v_mission public.daily_missions%rowtype;
  v_claim public.daily_mission_claims%rowtype;
  v_day date := (now() at time zone 'UTC')::date;
  v_progress integer;
  v_reward bigint;
  v_awarded_coin bigint := 0;
  v_awarded_xp integer := 0;
  v_gift_name text;
  v_gift_emoji text;
  v_gift_qty integer;
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

  if v_mission.reward_gift_id is not null then
    select coalesce(nullif(btrim(g.name_ar), ''), nullif(btrim(g.name), ''), 'هدية رمزية'),
           coalesce(nullif(btrim(g.icon_emoji), ''), '🎁'),
           greatest(1, least(coalesce(v_mission.reward_gift_quantity, 1), 100))
      into v_gift_name, v_gift_emoji, v_gift_qty
    from public.gifts g
    where g.id = v_mission.reward_gift_id and g.is_symbolic and g.is_active;
  end if;

  select * into v_claim from public.daily_mission_claims
  where mission_id = p_mission_id and user_id = auth.uid() and claim_date = v_day;
  if found then
    return jsonb_build_object(
      'success', true, 'already_claimed', true,
      'coin_awarded', v_claim.coin_awarded, 'game_points_awarded', 0,
      'xp_awarded', v_claim.xp_awarded, 'balance_gold', v_user.balance_gold,
      'gift_awarded', false
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
    'balance_gold', (select balance_gold from public.users where id = auth.uid()),
    'gift_awarded', v_gift_name is not null,
    'gift_name', v_gift_name,
    'gift_emoji', v_gift_emoji,
    'gift_quantity', v_gift_qty
  );
end;
$$;

REVOKE ALL ON FUNCTION public.claim_daily_mission(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_daily_mission(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 5) لوحة الإدارة: كمية هدية المستوى
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_upsert_level_reward(
  p_admin_id uuid, p_level integer, p_payload jsonb, p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin public.users%ROWTYPE;
  v_before jsonb;
  v_after public.level_rewards%ROWTYPE;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_title text := nullif(btrim(coalesce(p_payload ->> 'title', '')), '');
  v_badge text := nullif(btrim(coalesce(p_payload ->> 'badge', '')), '');
  v_frame text := nullif(btrim(coalesce(p_payload ->> 'frame', '')), '');
  v_effect text := nullif(btrim(coalesce(p_payload ->> 'entry_effect', '')), '');
  v_gift uuid := (p_payload ->> 'free_gift_id')::uuid;
  v_gift_qty integer := coalesce((p_payload ->> 'free_gift_quantity')::int, 1);
  v_coins bigint := coalesce((p_payload ->> 'coin_reward')::bigint, 0);
  v_active boolean := coalesce((p_payload ->> 'is_active')::boolean, true);
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_admin_id THEN
      RAISE EXCEPTION 'يجب تنفيذ التعديل بهوية المسؤول المصادق عليها';
    END IF;
  END IF;
  IF p_admin_id IS NULL OR p_level IS NULL OR p_level NOT BETWEEN 1 AND 1000
     OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'بيانات المكافأة غير صالحة';
  END IF;
  IF v_reason IS NULL OR char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'أدخل سبباً لا يتجاوز 500 حرف';
  END IF;
  IF v_title IS NOT NULL AND char_length(v_title) NOT BETWEEN 2 AND 40 THEN
    RAISE EXCEPTION 'اللقب يجب أن يكون بين 2 و40 حرفاً';
  END IF;
  IF v_badge IS NOT NULL AND char_length(v_badge) NOT BETWEEN 2 AND 40 THEN
    RAISE EXCEPTION 'الشارة يجب أن تكون بين 2 و40 حرفاً';
  END IF;
  IF v_frame IS NOT NULL AND char_length(v_frame) NOT BETWEEN 1 AND 60 THEN
    RAISE EXCEPTION 'مفتاح الإطار يجب ألا يتجاوز 60 حرفاً';
  END IF;
  IF v_effect IS NOT NULL AND char_length(v_effect) NOT BETWEEN 1 AND 60 THEN
    RAISE EXCEPTION 'مفتاح تأثير الدخول يجب ألا يتجاوز 60 حرفاً';
  END IF;
  IF v_coins NOT BETWEEN 0 AND 10000000 THEN
    RAISE EXCEPTION 'مكافأة الكوين يجب أن تكون بين 0 و10,000,000';
  END IF;
  IF v_gift_qty NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'كمية الهدية يجب أن تكون بين 1 و100';
  END IF;
  IF v_gift IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.gifts g WHERE g.id = v_gift AND g.is_symbolic AND g.is_active
  ) THEN
    RAISE EXCEPTION 'الهدية المجانية غير موجودة أو ليست رمزية مفعّلة';
  END IF;

  SELECT * INTO v_admin FROM public.users WHERE id = p_admin_id FOR UPDATE;
  IF NOT FOUND OR v_admin.status <> 'active'
     OR v_admin.role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'هذه العملية متاحة للإدارة العليا فقط';
  END IF;

  SELECT to_jsonb(r) INTO v_before FROM public.level_rewards r WHERE r.level = p_level;

  INSERT INTO public.level_rewards (
    level, title, badge, frame, entry_effect, free_gift_id, free_gift_quantity,
    coin_reward, is_active, updated_at
  ) VALUES (
    p_level, v_title, v_badge, v_frame, v_effect, v_gift, v_gift_qty,
    v_coins, v_active, now()
  )
  ON CONFLICT (level) DO UPDATE
    SET title = EXCLUDED.title,
        badge = EXCLUDED.badge,
        frame = EXCLUDED.frame,
        entry_effect = EXCLUDED.entry_effect,
        free_gift_id = EXCLUDED.free_gift_id,
        free_gift_quantity = EXCLUDED.free_gift_quantity,
        coin_reward = EXCLUDED.coin_reward,
        is_active = EXCLUDED.is_active,
        updated_at = now()
  RETURNING * INTO v_after;

  INSERT INTO public.admin_audit_log (
    admin_id, action, target_type, target_id, before, after, metadata
  ) VALUES (
    p_admin_id, 'update'::public.audit_action_type, 'level_reward', NULL,
    v_before, to_jsonb(v_after),
    jsonb_build_object('reason', v_reason, 'level', p_level)
  );

  RETURN to_jsonb(v_after);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_upsert_level_reward(uuid, integer, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_upsert_level_reward(uuid, integer, jsonb, text) TO service_role;

COMMIT;
