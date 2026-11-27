-- ============================================================
-- patch_m8_loyalty_streak.sql  (Migration #78)
-- M8.9 — نقاط الولاء (سلسلة الأيام) — القسم 18/خطة M8.9
--   * سلسلة دخول يومي بسيطة: نقاط وشارة فقط، **لا عملة حقيقية**:
--     لا تُحوَّل إلى رصيد ولا تُصرف ولا تدخل المحفظة أو دفتر القيود.
--   * الحساب خادمي بالكامل: اليوم يُحدَّد بتوقيت الإدارة
--     (loyalty_timezone) لا بساعة الجهاز، والنقاط تُحسب في الدالة.
--     نفس اليوم = لا تكرار (فرد على user_id + claim_date)،
--     الأمس = +1، أي فجوة = إعادة البدء من 1.
--   * الشارة تُمنح عند بلوغ عتبة (3/7/14/30 يوماً افتراضياً) وتبقى
--     مكتسبة بعد انقطاع السلسلة؛ النقاط المتراكمة لا تُسحب.
--   * كل القيم قابلة للتعديل من admin_settings، والتعطيل يوقف المنح.
-- يعتمد على: #74 (نوع إشعار loyalty_streak)، #77 (نمط الإعدادات).
-- ============================================================
BEGIN;

-- ============================================================
-- 1) الإعدادات (جلسة service_role لتجاوز زناد تدقيق admin_settings)
-- ============================================================
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
INSERT INTO public.admin_settings (key, value, description, is_public)
VALUES
  ('loyalty_enabled', 'true'::jsonb, 'تشغيل سلسلة الولاء اليومية', true),
  ('loyalty_timezone', '"Asia/Damascus"'::jsonb, 'المنطقة الزمنية التي يُحدَّد بها اليوم لسلسلة الولاء', false),
  ('loyalty_points_base', '10'::jsonb, 'نقاط الولاء عن أول يوم في السلسلة', false),
  ('loyalty_points_step', '5'::jsonb, 'نقاط إضافية لكل يوم متصل إضافي', false),
  ('loyalty_points_cap_days', '6'::jsonb, 'أقصى عدد أيام تُحسب لها الزيادة اليومية', false),
  ('loyalty_badges',
    '[{"days":3,"key":"loyalty_bronze","label":"وفيّ"},{"days":7,"key":"loyalty_silver","label":"مواظب"},{"days":14,"key":"loyalty_gold","label":"مخلص"},{"days":30,"key":"loyalty_platinum","label":"أسطوري"}]'::jsonb,
    'شارات سلسلة الولاء: عتبة الأيام ومفتاح الشارة واسمها', true)
ON CONFLICT (key) DO NOTHING;
SELECT set_config('request.jwt.claims', '', true);

-- ============================================================
-- 2) الحالة الحالية لكل مستخدم (صف واحد)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.loyalty_streaks (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  streak_days integer NOT NULL DEFAULT 0 CHECK (streak_days >= 0),
  best_streak integer NOT NULL DEFAULT 0 CHECK (best_streak >= 0),
  total_points bigint NOT NULL DEFAULT 0 CHECK (total_points >= 0),
  last_claim_date date,
  badge text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.loyalty_streaks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.loyalty_streaks FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.loyalty_streaks TO authenticated, service_role;

DROP POLICY IF EXISTS loyalty_streaks_owner_admin_select ON public.loyalty_streaks;
CREATE POLICY loyalty_streaks_owner_admin_select ON public.loyalty_streaks
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

-- ============================================================
-- 3) سجل المطالبات اليومية — التفرد يمنع المطالبة مرتين في اليوم
-- ============================================================
CREATE TABLE IF NOT EXISTS public.loyalty_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  claim_date date NOT NULL,
  streak_days integer NOT NULL CHECK (streak_days >= 1),
  points_awarded integer NOT NULL CHECK (points_awarded >= 0),
  badge text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT loyalty_claims_one_per_day UNIQUE (user_id, claim_date)
);
CREATE INDEX IF NOT EXISTS loyalty_claims_user_recent
  ON public.loyalty_claims (user_id, claim_date DESC);

ALTER TABLE public.loyalty_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.loyalty_claims FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.loyalty_claims TO authenticated, service_role;

DROP POLICY IF EXISTS loyalty_claims_owner_admin_select ON public.loyalty_claims;
CREATE POLICY loyalty_claims_owner_admin_select ON public.loyalty_claims
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

-- ============================================================
-- 4) قراءة الإعدادات
-- ============================================================
CREATE OR REPLACE FUNCTION public.loyalty_settings()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
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
    'badges', CASE WHEN jsonb_typeof(badges) = 'array' THEN badges ELSE '[]'::jsonb END
  )
  FROM s;
$$;
REVOKE ALL ON FUNCTION public.loyalty_settings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.loyalty_settings() TO authenticated, service_role;

-- اليوم المحلي المعتمد (لا ساعة الجهاز) — أي منطقة غير معروفة تعود إلى UTC
CREATE OR REPLACE FUNCTION public.loyalty_today(p_timezone text)
RETURNS date
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tz text := coalesce(nullif(btrim(p_timezone), ''), 'UTC');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names z WHERE z.name = v_tz) THEN
    v_tz := 'UTC';
  END IF;
  RETURN (now() AT TIME ZONE v_tz)::date;
END;
$$;
REVOKE ALL ON FUNCTION public.loyalty_today(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.loyalty_today(text) TO authenticated, service_role;

-- أعلى شارة بلغتها سلسلة من p_streak (أو NULL)
CREATE OR REPLACE FUNCTION public.loyalty_badge_for_streak(p_badges jsonb, p_streak integer)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT b
  FROM jsonb_array_elements(
    CASE WHEN jsonb_typeof(p_badges) = 'array' THEN p_badges ELSE '[]'::jsonb END
  ) b
  WHERE coalesce((b ->> 'days')::int, 0) <= greatest(coalesce(p_streak, 0), 0)
  ORDER BY (b ->> 'days')::int DESC
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.loyalty_badge_for_streak(jsonb, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.loyalty_badge_for_streak(jsonb, integer) TO authenticated, service_role;

-- ============================================================
-- 5) المطالبة اليومية — الحساب خادمي والنقاط لا تمس المحفظة
-- ============================================================
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
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- صف الحالة يُنشأ مرة واحدة
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

  -- الأمس ⇒ استمرار، أي فجوة ⇒ بداية جديدة
  v_streak := CASE
    WHEN v_row.last_claim_date = v_today - 1 THEN v_row.streak_days + 1
    ELSE 1
  END;

  v_points := (v_cfg ->> 'base')::int
    + (v_cfg ->> 'step')::int * least(greatest(v_streak - 1, 0), (v_cfg ->> 'cap_days')::int);

  -- الشارة الجديدة عند بلوغ عتبة، وإلا تبقى الشارة المكتسبة سابقاً
  v_badge := public.loyalty_badge_for_streak(v_cfg -> 'badges', v_streak);
  v_badge_key := CASE WHEN v_badge IS NULL THEN v_row.badge ELSE v_badge ->> 'key' END;

  INSERT INTO public.loyalty_claims (user_id, claim_date, streak_days, points_awarded, badge)
  VALUES (v_uid, v_today, v_streak, v_points, v_badge_key)
  ON CONFLICT (user_id, claim_date) DO NOTHING;
  v_claimed := FOUND;

  IF NOT v_claimed THEN
    -- سباق نادر: اليوم سُجّل بالفعل
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
      || CASE WHEN v_badge IS NOT NULL AND (v_badge ->> 'key') = v_badge_key
              THEN ' وحصلت على شارة «' || coalesce(v_badge ->> 'label', v_badge_key) || '»' ELSE '' END
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
    'badge_awarded', v_badge IS NOT NULL AND (v_badge ->> 'key') = v_badge_key,
    'next_badge', v_next,
    'claimed_on', v_today
  );
END;
$$;
REVOKE ALL ON FUNCTION public.claim_daily_loyalty() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_daily_loyalty() TO authenticated, service_role;

-- ============================================================
-- 6) حالة الولاء للتطبيق (سلسلة/نقاط/شارة/معاينة اليوم)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_my_loyalty()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_cfg jsonb := public.loyalty_settings();
  v_row public.loyalty_streaks%ROWTYPE;
  v_today date;
  v_next_streak integer;
  v_claimed boolean;
  v_points integer;
  v_badge jsonb;
  v_next_badge jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_row FROM public.loyalty_streaks WHERE user_id = v_uid;
  v_today := public.loyalty_today(v_cfg ->> 'timezone');

  v_claimed := coalesce(v_row.last_claim_date = v_today, false);
  v_next_streak := CASE
    WHEN v_row.user_id IS NULL THEN 1
    WHEN v_claimed THEN v_row.streak_days
    WHEN v_row.last_claim_date = v_today - 1 THEN v_row.streak_days + 1
    ELSE 1
  END;

  v_points := (v_cfg ->> 'base')::int
    + (v_cfg ->> 'step')::int * least(greatest(v_next_streak - 1, 0), (v_cfg ->> 'cap_days')::int);

  v_badge := public.loyalty_badge_for_streak(v_cfg -> 'badges', greatest(coalesce(v_row.streak_days, 0), v_next_streak));
  v_next_badge := (
    SELECT b
    FROM jsonb_array_elements(v_cfg -> 'badges') b
    WHERE coalesce((b ->> 'days')::int, 0) > greatest(coalesce(v_row.streak_days, 0), v_next_streak)
    ORDER BY (b ->> 'days')::int ASC
    LIMIT 1
  );

  RETURN jsonb_build_object(
    'enabled', coalesce((v_cfg ->> 'enabled')::boolean, true),
    'timezone', v_cfg ->> 'timezone',
    'streak_days', coalesce(v_row.streak_days, 0),
    'best_streak', coalesce(v_row.best_streak, 0),
    'total_points', coalesce(v_row.total_points, 0),
    'badge', coalesce(v_row.badge, v_badge ->> 'key'),
    'badge_label', coalesce(
      (SELECT b ->> 'label' FROM jsonb_array_elements(v_cfg -> 'badges') b
        WHERE (b ->> 'key') = coalesce(v_row.badge, v_badge ->> 'key') LIMIT 1),
      v_badge ->> 'label'
    ),
    'claimed_today', v_claimed,
    'last_claim_date', v_row.last_claim_date,
    'next_streak_days', v_next_streak,
    'points_if_claimed_now', CASE WHEN v_claimed THEN 0 ELSE v_points END,
    'next_badge', v_next_badge,
    'badges', v_cfg -> 'badges',
    'note', 'نقاط الولاء للعرض والشارات فقط ولا تُحوَّل إلى رصيد أو عملة.'
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_loyalty() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_loyalty() TO authenticated, service_role;

COMMIT;
