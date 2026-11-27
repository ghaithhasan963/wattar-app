-- ============================================================
-- patch_m8_level_xp.sql  (Migration #77)
-- M8.7 — نظام LV/XP (القسم 18)
--   * LV 1..100 بحد أقصى قابل للتعديل (lv_max_level) ومنحنى XP
--     تصاعدي قابل للتعديل: المطلوب للترقية من L إلى L+1 =
--     floor(lv_xp_base × lv_xp_growth^(L-1)) — لا زيادة ثابتة.
--   * XP على الإنفاق الفعلي المؤهل فقط: زناد على wallet_transactions
--     يمنح XP للخصومات (موجب = شحن/فوز/استلام ⇒ لا شيء) للأنواع
--     المؤهلة (هدايا/ألعاب/شراء VIP/حمايات) بأسعار لكل 100 كوين
--     تحددها الإدارة. منع الازدواج بفرد (source_type, reference_id)
--     على معرف القيد المحاسبي نفسه.
--   * مسار المهمات/المشاركة القديم (progress_events عبر
--     award_user_xp_internal) يبقى ويُعاد ضبط صيغة المستوى على
--     المنحنى الجديد — مصدر واحد للحقيقة للمستوى.
--   * مكافآت LV (ألقاب/شارات/إطارات/تأثيرات/هدية مجانية/كوين بإذن
--     الإدارة) تُمنح آلياً عند ارتفاع المستوى — تجميلية فقط:
--     LV لا يمنح أي صلاحية إدارية ولا حماية من طرد/حظر.
--   * إعادة معايرة مستويات الحسابات القائمة على المنحنى الجديد بلا
--     منح مكافآت رجعية (تعطيل زناد الترقية أثناء المعايرة).
-- يعتمد على: #74p (نوع إشعار level_up)، #77p (enum level_reward)، #75/#76.
-- ============================================================
BEGIN;

-- ============================================================
-- 1) الإعدادات
-- (زناد التدقيق على admin_settings يشترط جلسة مسؤول — نفس نمط
--  #75/#76: ننحّي الجلسة إلى service_role ثم نعيدها)
-- ============================================================
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
INSERT INTO public.admin_settings (key, value, description, is_public)
VALUES
  ('lv_enabled', 'true'::jsonb, 'تشغيل نظام المستويات والخبرة', true),
  ('lv_max_level', '100'::jsonb, 'الحد الأقصى للمستويات (قابل للتعديل)', true),
  ('lv_xp_base', '500'::jsonb, 'الخبرة المطلوبة للترقية من المستوى 1 إلى 2', false),
  ('lv_xp_growth', '1.07'::jsonb, 'مُعامل تصاعد المنحنى لكل مستوى (≥1.01)', false),
  ('lv_xp_spend_rates', '{"gift_sent":10,"bet":5,"vip_purchase":10,"protection_purchase":10}'::jsonb,
    'نقاط الخبرة لكل 100 كوين منفق لكل نوع إنفاق مؤهل', false),
  ('lv_xp_qualifying_types', '["gift_sent","bet","vip_purchase","protection_purchase"]'::jsonb,
    'أنواع حركات المحفظة المؤهلة للخبرة (الإنفاق فقط)', false)
ON CONFLICT (key) DO NOTHING;
SELECT set_config('request.jwt.claims', '', true);

-- ============================================================
-- 2) دوال المنحنى
-- ============================================================
CREATE OR REPLACE FUNCTION public.lv_settings()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'enabled', coalesce((SELECT (s.value #>> '{}')::boolean FROM public.admin_settings s WHERE s.key = 'lv_enabled'), true),
    'max_level', greatest(1, coalesce((SELECT (s.value #>> '{}')::int FROM public.admin_settings s WHERE s.key = 'lv_max_level'), 100)),
    'base', greatest(1, coalesce((SELECT (s.value #>> '{}')::numeric FROM public.admin_settings s WHERE s.key = 'lv_xp_base'), 500)),
    'growth', greatest(1.01, coalesce((SELECT (s.value #>> '{}')::numeric FROM public.admin_settings s WHERE s.key = 'lv_xp_growth'), 1.07)),
    'rates', coalesce((SELECT s.value FROM public.admin_settings s WHERE s.key = 'lv_xp_spend_rates'), '{}'::jsonb),
    'qualifying', coalesce((SELECT s.value FROM public.admin_settings s WHERE s.key = 'lv_xp_qualifying_types'), '[]'::jsonb)
  );
$$;
REVOKE ALL ON FUNCTION public.lv_settings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lv_settings() TO authenticated, service_role;

-- الخبرة المطلوبة للترقية من المستوى p_level إلى p_level+1 —
-- تصاعدية أُسّياً وقابلة للتعديل عبر الإعدادات (بلا زيادة ثابتة)
CREATE OR REPLACE FUNCTION public.lv_xp_required_for_level(p_level integer)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_level IS NULL OR p_level < 1 THEN NULL
    WHEN p_level >= (public.lv_settings() ->> 'max_level')::int THEN NULL
    ELSE floor(
      (public.lv_settings() ->> 'base')::numeric
      * power((public.lv_settings() ->> 'growth')::numeric, p_level - 1)
    )::bigint
  END;
$$;
REVOKE ALL ON FUNCTION public.lv_xp_required_for_level(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lv_xp_required_for_level(integer) TO anon, authenticated, service_role;

-- المستوى من إجمالي الخبرة (مشي على المنحنى حتى السقف القابل للتعديل)
CREATE OR REPLACE FUNCTION public.lv_level_from_xp(p_xp bigint)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_remaining bigint := greatest(coalesce(p_xp, 0), 0);
  v_level integer := 1;
  v_max integer := (public.lv_settings() ->> 'max_level')::int;
  v_required bigint;
BEGIN
  WHILE v_level < v_max LOOP
    v_required := public.lv_xp_required_for_level(v_level);
    EXIT WHEN v_required IS NULL OR v_remaining < v_required;
    v_remaining := v_remaining - v_required;
    v_level := v_level + 1;
  END LOOP;
  RETURN v_level;
END;
$$;
REVOKE ALL ON FUNCTION public.lv_level_from_xp(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lv_level_from_xp(bigint) TO anon, authenticated, service_role;

-- ============================================================
-- 3) سجل خبرة الإنفاق — التفرد يمنع احتساب العملية مرتين
-- ============================================================
CREATE TABLE IF NOT EXISTS public.lv_xp_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  source_type text NOT NULL CHECK (source_type IN ('wallet_spend', 'mission', 'participation', 'activity', 'interaction', 'admin')),
  reference_id uuid,
  coins_spent bigint CHECK (coins_spent IS NULL OR coins_spent > 0),
  xp_amount bigint NOT NULL CHECK (xp_amount BETWEEN 1 AND 1000000),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lv_xp_events_dedup UNIQUE (source_type, reference_id)
);
CREATE INDEX IF NOT EXISTS lv_xp_events_user_recent
  ON public.lv_xp_events (user_id, created_at DESC);

ALTER TABLE public.lv_xp_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lv_xp_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.lv_xp_events TO authenticated, service_role;

DROP POLICY IF EXISTS lv_xp_events_owner_admin_select ON public.lv_xp_events;
CREATE POLICY lv_xp_events_owner_admin_select ON public.lv_xp_events
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

-- ============================================================
-- 4) مكافآت المستويات (كتالوج إداري — تجميلي بلا صلاحيات)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.level_rewards (
  level integer PRIMARY KEY CHECK (level BETWEEN 1 AND 1000),
  title text CHECK (title IS NULL OR char_length(btrim(title)) BETWEEN 2 AND 40),
  badge text CHECK (badge IS NULL OR char_length(btrim(badge)) BETWEEN 2 AND 40),
  frame text CHECK (frame IS NULL OR char_length(btrim(frame)) BETWEEN 1 AND 60),
  entry_effect text CHECK (entry_effect IS NULL OR char_length(btrim(entry_effect)) BETWEEN 1 AND 60),
  free_gift_id uuid REFERENCES public.gifts(id) ON DELETE SET NULL,
  coin_reward bigint NOT NULL DEFAULT 0 CHECK (coin_reward BETWEEN 0 AND 10000000),
  is_active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.level_rewards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.level_rewards FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.level_rewards TO anon, authenticated, service_role;

DROP POLICY IF EXISTS level_rewards_read ON public.level_rewards;
CREATE POLICY level_rewards_read ON public.level_rewards
  FOR SELECT TO anon, authenticated
  USING (is_active OR public.is_admin());

-- مكافآت المستخدم الممنوحة (سجل — صف واحد لكل مستوى)
CREATE TABLE IF NOT EXISTS public.user_level_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  level integer NOT NULL CHECK (level BETWEEN 1 AND 1000),
  reward jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_level_rewards_one_per_level UNIQUE (user_id, level)
);
CREATE INDEX IF NOT EXISTS user_level_rewards_user
  ON public.user_level_rewards (user_id, level DESC);

ALTER TABLE public.user_level_rewards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_level_rewards FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.user_level_rewards TO authenticated, service_role;

DROP POLICY IF EXISTS user_level_rewards_owner_admin_select ON public.user_level_rewards;
CREATE POLICY user_level_rewards_owner_admin_select ON public.user_level_rewards
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

-- ============================================================
-- 5) منح مكافآت الترقية — يستدعيه زناد تغيّر المستوى على users
-- ============================================================
CREATE OR REPLACE FUNCTION public.lv_grant_level_rewards(
  p_user_id uuid,
  p_from_level integer,
  p_to_level integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_level integer;
  v_reward public.level_rewards%ROWTYPE;
  v_reward_json jsonb;
  v_max integer := (public.lv_settings() ->> 'max_level')::int;
BEGIN
  IF p_user_id IS NULL OR p_to_level IS NULL OR p_from_level IS NULL THEN
    RETURN;
  END IF;
  -- سقف حماية: 50 مستوى في الحدث الواحد
  IF p_to_level - p_from_level > 50 THEN
    RETURN;
  END IF;
  FOR v_level IN greatest(p_from_level + 1, 1) .. least(p_to_level, v_max) LOOP
    SELECT * INTO v_reward FROM public.level_rewards
    WHERE level = v_level AND is_active;
    v_reward_json := CASE WHEN FOUND THEN to_jsonb(v_reward) ELSE '{}'::jsonb END;

    INSERT INTO public.user_level_rewards (user_id, level, reward)
    VALUES (p_user_id, v_level, v_reward_json)
    ON CONFLICT (user_id, level) DO NOTHING;

    -- مكافأة كوين فقط إذا اعتمدتها الإدارة على هذا المستوى
    IF FOUND AND v_reward.coin_reward > 0 THEN
      BEGIN
        PERFORM public.record_wallet_transaction(
          p_user_id,
          'level_reward'::public.wallet_tx_type,
          v_reward.coin_reward,
          'gold',
          NULL,
          'lv-reward:' || p_user_id::text || ':' || v_level::text,
          'level_rewards',
          NULL,
          jsonb_build_object('level', v_level, 'coin_reward', v_reward.coin_reward),
          'level-system',
          'مكافأة الوصول إلى المستوى ' || v_level
        );
      EXCEPTION WHEN OTHERS THEN
        NULL; -- مكافأة تكميلية: لا تعطل مسار الترقية أبداً
      END;
    END IF;

    INSERT INTO public.user_notifications (
      user_id, actor_id, event_type, reference_id, title, body, route
    ) VALUES (
      p_user_id, NULL, 'level_up', NULL,
      'وصلت إلى المستوى ' || v_level,
      CASE
        WHEN FOUND AND v_reward.coin_reward > 0 THEN
          'حصلت على ' || v_reward.coin_reward::text || ' كوين'
          || CASE WHEN v_reward.title IS NOT NULL THEN ' ولقب «' || v_reward.title || '»' ELSE '' END
          || '.'
        WHEN FOUND AND v_reward.title IS NOT NULL THEN
          'حصلت على لقب «' || v_reward.title || '» ومكافآت تجميلية.'
        ELSE 'استمر في التفاعل والإنفاق المؤهل للترقية.'
      END,
      '/profile'
    );
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.lv_grant_level_rewards(uuid, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lv_grant_level_rewards(uuid, integer, integer)
  TO service_role;

-- غلاف الزناد: لا يمكن تمرير NEW/OLD كوسائط في EXECUTE FUNCTION
CREATE OR REPLACE FUNCTION public.lv_on_level_change_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.lv_grant_level_rewards(NEW.id, OLD.level, NEW.level);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.lv_on_level_change_trigger()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_users_level_change ON public.users;
CREATE TRIGGER trg_users_level_change
  AFTER UPDATE OF level ON public.users
  FOR EACH ROW
  WHEN (OLD.level IS DISTINCT FROM NEW.level AND NEW.level > OLD.level)
  EXECUTE FUNCTION public.lv_on_level_change_trigger();

-- ============================================================
-- 6) خطاف خبرة الإنفاق — زناد على دفتر المحفظة (الخصم المؤهل فقط)
--    الشحن (deposit) والفوز (win) والاستلام موجبة ⇒ لا خبرة أبداً.
--    التفرد على (wallet_spend, tx id) يمنع احتساب العملية مرتين،
--    وأي خلل هنا لا يعطل الدفع أبداً (EXCEPTION مُلتهم).
-- ============================================================
CREATE OR REPLACE FUNCTION public.lv_wallet_spend_xp()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cfg jsonb := public.lv_settings();
  v_rate numeric;
  v_xp bigint;
  v_type text := NEW.type::text;
BEGIN
  IF NOT coalesce((v_cfg ->> 'enabled')::boolean, true) THEN
    RETURN NULL;
  END IF;
  -- الإنفاق الفعلي فقط: خصم بالكوين من قيد عادي (لا عكس/تسوية)
  IF NEW.amount >= 0 OR NEW.currency <> 'gold' OR NEW.entry_kind <> 'normal' THEN
    RETURN NULL;
  END IF;
  IF NOT (v_cfg -> 'qualifying') ? v_type THEN
    RETURN NULL;
  END IF;
  v_rate := coalesce((v_cfg -> 'rates' ->> v_type)::numeric, 0);
  IF v_rate IS NULL OR v_rate <= 0 THEN
    RETURN NULL;
  END IF;
  v_xp := floor((-NEW.amount) * v_rate / 100)::bigint;
  IF v_xp < 1 THEN
    RETURN NULL;
  END IF;

  BEGIN
    INSERT INTO public.lv_xp_events (user_id, source_type, reference_id, coins_spent, xp_amount)
    VALUES (NEW.user_id, 'wallet_spend', NEW.id, -NEW.amount, v_xp)
    ON CONFLICT (source_type, reference_id) DO NOTHING;

    IF FOUND THEN
      UPDATE public.users
      SET experience_points = experience_points + v_xp,
          level = public.lv_level_from_xp(experience_points + v_xp)
      WHERE id = NEW.user_id AND status = 'active';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL; -- الخبرة تكميلية: لا تعطل مسار الدفع أبداً
  END;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_wallet_lv_xp ON public.wallet_transactions;
CREATE TRIGGER trg_wallet_lv_xp
  AFTER INSERT ON public.wallet_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.lv_wallet_spend_xp();

-- ============================================================
-- 7) توحيد صيغة المستوى: المسار القديم (مهمات/مشاركة) على المنحنى الجديد
--    تعريف الدالة الحي مطابق لـ #59g مع استبدال سطر الحساب فقط.
-- ============================================================
CREATE OR REPLACE FUNCTION public.award_user_xp_internal(p_user_id uuid, p_event_key text, p_event_type text, p_points integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
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
      level = public.lv_level_from_xp(experience_points + p_points)
  where id = p_user_id and status = 'active'
  returning experience_points, level into v_xp, v_level;

  if not found then
    raise exception 'User not found or inactive';
  end if;
  return v_level;
end;
$fn$;
REVOKE ALL ON FUNCTION public.award_user_xp_internal(uuid, text, text, integer)
  FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 8) مستواي للتطبيق
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_my_level()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.users%ROWTYPE;
  v_cfg jsonb := public.lv_settings();
  v_level integer;
  v_xp bigint;
  v_required bigint;
  v_next_title text;
  v_rewards jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_row FROM public.users WHERE id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Authentication required'; END IF;
  v_level := coalesce(v_row.level, 1);
  v_xp := coalesce(v_row.experience_points, 0);
  v_required := public.lv_xp_required_for_level(v_level);

  SELECT to_jsonb(r) INTO v_rewards FROM public.level_rewards r WHERE r.level = v_level + 1 AND r.is_active;

  RETURN jsonb_build_object(
    'level', v_level,
    'xp', v_xp,
    'xp_to_next', v_required,
    'max_level', (v_cfg ->> 'max_level')::int,
    'at_max', v_required IS NULL,
    'next_level_reward', v_rewards,
    'rewards_earned', coalesce((
      SELECT jsonb_agg(jsonb_build_object('level', u.level, 'reward', u.reward) ORDER BY u.level)
      FROM public.user_level_rewards u WHERE u.user_id = v_uid
    ), '[]'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_level() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_level() TO authenticated, service_role;

-- ============================================================
-- 9) إدارة المكافآت — إدارة عليا فقط، سبب إلزامي وتدقيق
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_upsert_level_reward(
  p_admin_id uuid,
  p_level integer,
  p_payload jsonb,
  p_reason text
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
  IF v_gift IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.gifts g WHERE g.id = v_gift) THEN
    RAISE EXCEPTION 'الهدية المجانية غير موجودة';
  END IF;

  SELECT * INTO v_admin FROM public.users WHERE id = p_admin_id FOR UPDATE;
  IF NOT FOUND OR v_admin.status <> 'active'
     OR v_admin.role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'هذه العملية متاحة للإدارة العليا فقط';
  END IF;

  SELECT to_jsonb(r) INTO v_before FROM public.level_rewards r WHERE r.level = p_level;

  INSERT INTO public.level_rewards (
    level, title, badge, frame, entry_effect, free_gift_id, coin_reward, is_active, updated_at
  ) VALUES (
    p_level, v_title, v_badge, v_frame, v_effect, v_gift, v_coins, v_active, now()
  )
  ON CONFLICT (level) DO UPDATE
    SET title = EXCLUDED.title,
        badge = EXCLUDED.badge,
        frame = EXCLUDED.frame,
        entry_effect = EXCLUDED.entry_effect,
        free_gift_id = EXCLUDED.free_gift_id,
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
REVOKE ALL ON FUNCTION public.admin_upsert_level_reward(uuid, integer, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_upsert_level_reward(uuid, integer, jsonb, text)
  TO authenticated, service_role;

-- ============================================================
-- 10) معايرة مستويات الحسابات القائمة على المنحنى الجديد —
--     بلا مكافآت رجعية (تعطيل زناد الترقية أثناء المعايرة فقط)
-- ============================================================
ALTER TABLE public.users DISABLE TRIGGER trg_users_level_change;
UPDATE public.users
  SET level = greatest(1, public.lv_level_from_xp(coalesce(experience_points, 0)))
  WHERE level IS DISTINCT FROM greatest(1, public.lv_level_from_xp(coalesce(experience_points, 0)));
ALTER TABLE public.users ENABLE TRIGGER trg_users_level_change;

COMMIT;
