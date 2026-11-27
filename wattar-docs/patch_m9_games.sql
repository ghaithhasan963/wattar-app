-- ============================================================
-- patch_m9_games.sql  (Migration #83)
-- M9.4 — الألعاب: نتائج خادم فقط + احتمالات معلنة + سجل جولات
--        + إدارة كاملة (تشغيل/إيقاف، أسعار، جوائز، حدود، عروض)
--        + وضع محاكاة بلا أرصدة + تقييد جغرافي + منع التلاعب السري
--
-- يعتمد على الألعاب الخمس القائمة (wheel/dice/aviator/plinko/slots)
-- ويُبقي `play_game_with_points` مسار التسوية الوحيد للأرصدة الحقيقية.
-- ============================================================
BEGIN;

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- ============================================================
-- 1) توسعة إعدادات اللعبة — عرض، حدود، عمر، جغرافيا، عروض، محاكاة
-- ============================================================
ALTER TABLE public.game_configs
  ADD COLUMN IF NOT EXISTS display_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS description_ar text,
  ADD COLUMN IF NOT EXISTS icon text NOT NULL DEFAULT 'gamepad',
  ADD COLUMN IF NOT EXISTS accent_color text NOT NULL DEFAULT '#7C3AED',
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS min_age integer NOT NULL DEFAULT 18,
  ADD COLUMN IF NOT EXISTS requires_adult boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS allowed_countries text[],
  ADD COLUMN IF NOT EXISTS blocked_countries text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS promo_multiplier numeric(6,2) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS promo_label text,
  ADD COLUMN IF NOT EXISTS promo_starts_at timestamptz,
  ADD COLUMN IF NOT EXISTS promo_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS test_mode_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rules_ar text,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

ALTER TABLE public.game_bets
  ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS country_code text;

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'game_configs_bet_range_check') THEN
    ALTER TABLE public.game_configs ADD CONSTRAINT game_configs_bet_range_check
      CHECK (min_bet_gold >= 1 AND max_bet_gold >= min_bet_gold AND max_bet_gold <= 1000000);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'game_configs_rtp_check') THEN
    ALTER TABLE public.game_configs ADD CONSTRAINT game_configs_rtp_check
      CHECK (default_rtp >= 0 AND default_rtp <= 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'game_configs_max_mult_check') THEN
    ALTER TABLE public.game_configs ADD CONSTRAINT game_configs_max_mult_check
      CHECK (max_multiplier >= 1 AND max_multiplier <= 1000);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'game_configs_promo_check') THEN
    ALTER TABLE public.game_configs ADD CONSTRAINT game_configs_promo_check
      CHECK (promo_multiplier >= 1 AND promo_multiplier <= 10
        AND (promo_starts_at IS NULL OR promo_ends_at IS NULL OR promo_ends_at > promo_starts_at));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'game_configs_min_age_check') THEN
    ALTER TABLE public.game_configs ADD CONSTRAINT game_configs_min_age_check
      CHECK (min_age BETWEEN 13 AND 21);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'game_configs_accent_check') THEN
    ALTER TABLE public.game_configs ADD CONSTRAINT game_configs_accent_check
      CHECK (accent_color ~ '^#[0-9A-Fa-f]{6}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_country_code_check') THEN
    ALTER TABLE public.users ADD CONSTRAINT users_country_code_check
      CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$');
  END IF;
END $do$;

CREATE INDEX IF NOT EXISTS idx_game_bets_real_time
  ON public.game_bets (game_type, created_at DESC) WHERE NOT is_test;

-- ============================================================
-- 2) إعدادات المنصة — تقييد جغرافي + وضع المحاكاة
-- ============================================================
INSERT INTO public.admin_settings (key, value, description, is_public)
VALUES
  ('games_geoblocking_enabled', 'false'::jsonb, 'تفعيل تقييد الألعاب جغرافياً', false),
  ('blocked_game_countries', '[]'::jsonb, 'دول محظورة من الألعاب (رموز ISO-2)', false),
  ('games_test_mode_enabled', 'false'::jsonb, 'السماح بوضع المحاكاة بلا أرصدة حقيقية', false)
ON CONFLICT (key) DO NOTHING;

-- لا يُسمح بإجبار مستخدم على خسارة مضمونة بصمت (قسم 19: منع التلاعب السري)
UPDATE public.users
SET is_force_lose = false, force_outcome_count = 0
WHERE is_force_lose;

-- ============================================================
-- 3) بيانات العرض + الاحتمالات المعلنة المتوافقة لكل لعبة
-- ============================================================
UPDATE public.game_configs SET
  display_name = 'عجلة الحظ',
  description_ar = 'اختر خانتك، ثم أدر العجلة. كل خانة لها احتمال معلن وعائد معلن.',
  icon = 'disc',
  accent_color = '#7C3AED',
  sort_order = 10,
  rules_ar = 'العجلة تختار الخانة الفائزة على الخادم وفق الأوزان المعلنة. إذا وقعت على خانتك تربح مضاعفها، وإلا تخسر الرهان.',
  settings = jsonb_build_object('segments', jsonb_build_array(
    jsonb_build_object('value', 0.66, 'probability', 0.45, 'color', '#6B7280', 'label', 'x0.66'),
    jsonb_build_object('value', 1.20, 'probability', 0.25, 'color', '#10B981', 'label', 'x1.2'),
    jsonb_build_object('value', 2.00, 'probability', 0.15, 'color', '#3B82F6', 'label', 'x2'),
    jsonb_build_object('value', 3.75, 'probability', 0.08, 'color', '#A78BFA', 'label', 'x3.75'),
    jsonb_build_object('value', 6.00, 'probability', 0.05, 'color', '#F59E0B', 'label', 'x6'),
    jsonb_build_object('value', 15.00, 'probability', 0.02, 'color', '#EF4444', 'label', 'x15')
  ))
WHERE game_type = 'wheel';

UPDATE public.game_configs SET
  display_name = 'نرد',
  description_ar = 'توقع أن تكون النتيجة أعلى أو أدنى من حدّك. المضاعف يُحسب على الخادم من RTP.',
  icon = 'dice-5',
  accent_color = '#10B981',
  sort_order = 20,
  rules_ar = 'السيرفر يولّد رقماً من 1 إلى 100. تربح إذا تجاوز الرقم حدّك (فوق) أو كان دونه (تحت).',
  settings = jsonb_build_object('min_value', 1, 'max_value', 100, 'default_target', 50)
WHERE game_type = 'dice';

UPDATE public.game_configs SET
  display_name = 'طيارة المضاعفات',
  description_ar = 'حدّد مضاعف السحب قبل الإقلاع. الطيارة تطير حتى نقطة انهيار يحددها الخادم.',
  icon = 'plane',
  accent_color = '#3B82F6',
  sort_order = 30,
  rules_ar = 'نقطة الانهيار تُسحب على الخادم. احتمال أن تتجاوز الطيارة مضاعف x يساوي RTP ÷ x. إن سحبت قبل الانهيار تربح x، وإلا تخسر الرهان.',
  settings = jsonb_build_object('min_crash', 1.00, 'crash_curve', 'exponential', 'seed_rotation', 'per_round')
WHERE game_type = 'aviator';

UPDATE public.game_configs SET
  display_name = 'بلانغو',
  description_ar = 'اختر المخاطرة وأسقط الكرة عبر 12 صفاً من الأوتاد إلى 13 خانة معلنة.',
  icon = 'chevrons-down',
  accent_color = '#F59E0B',
  sort_order = 40,
  rules_ar = 'مسار الكرة يتبع توزيعاً ثنائياً عادلاً (احتمال يمين/يسار = 0.5 لكل صف). مضاعفات الخانات معلنة وتُحسب منها نسبة العائد.',
  settings = jsonb_build_object(
    'rows', 12,
    'risk_levels', jsonb_build_array('low', 'medium', 'high'),
    'multipliers', jsonb_build_object(
      'low',    jsonb_build_array(5, 2, 1.2, 0.6, 0.4, 0.2, 0.1, 0.2, 0.4, 0.6, 1.2, 2, 5),
      'medium', jsonb_build_array(10, 4, 1.5, 0.7, 0.3, 0.15, 0.05, 0.15, 0.3, 0.7, 1.5, 4, 10),
      'high',   jsonb_build_array(120, 12, 2.5, 0.6, 0.12, 0.03, 0.015, 0.03, 0.12, 0.6, 2.5, 12, 120)
    )
  )
WHERE game_type = 'plinko';

UPDATE public.game_configs SET
  display_name = 'Slots',
  description_ar = 'طابق الرموز الثلاثة. جدول الجوائز واحتمالاته معلن بالكامل.',
  icon = 'gem',
  accent_color = '#C026D3',
  sort_order = 50,
  rules_ar = 'احتمالات كل رمز معلنة. تطابق الرموز الثلاثة يمنحك مضاعفه، وإلا تخسر الرهان.',
  settings = jsonb_build_object(
    'tiers', jsonb_build_array(
      jsonb_build_object('symbol', '🍒', 'multiplier', 2,  'probability', 0.05),
      jsonb_build_object('symbol', '🔔', 'multiplier', 5,  'probability', 0.02),
      jsonb_build_object('symbol', '💎', 'multiplier', 10, 'probability', 0.01)
    ),
    'loss_symbols', jsonb_build_array('🍋', '🍀', '⭐', '🍇'),
    'free_game_points_only', false
  )
WHERE game_type = 'slots';

-- ============================================================
-- 4) أدوات حساب الاحتمالات المعلنة
-- ============================================================
CREATE OR REPLACE FUNCTION public.game_binomial_prob(p_rows integer, p_k integer)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_coeff numeric := 1;
  v_i integer;
BEGIN
  IF p_rows IS NULL OR p_k IS NULL OR p_k < 0 OR p_k > p_rows THEN
    RETURN 0::numeric;
  END IF;
  -- مضاعف الذروة لتقليل التكرار
  IF p_k > p_rows - p_k THEN
    p_k := p_rows - p_k;
  END IF;
  FOR v_i IN 1 .. p_k LOOP
    v_coeff := v_coeff * (p_rows - p_k + v_i) / v_i;
  END LOOP;
  RETURN round(v_coeff / power(2::numeric, p_rows), 12);
END;
$$;

CREATE OR REPLACE FUNCTION public.game_settings_rtp(
  p_game_type public.game_type,
  p_settings jsonb,
  p_default_rtp numeric
)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v numeric := 0;
  v_risk text;
  v_rows integer;
  v_mult jsonb;
  v_k integer;
  v_count integer := 0;
BEGIN
  IF p_settings IS NULL THEN
    RETURN round(coalesce(p_default_rtp, 0), 2);
  END IF;

  IF p_game_type = 'wheel' THEN
    -- كل خانة رهان مستقل: RTP للخانة = احتمالها × عائدها.
    -- المعلن العام = متوسط الخانات (رهان موزّع بالتساوي).
    SELECT coalesce(sum((s ->> 'probability')::numeric * (s ->> 'value')::numeric), 0), count(*)
      INTO v, v_count
    FROM jsonb_array_elements(coalesce(p_settings -> 'segments', '[]'::jsonb)) s;
    RETURN round((v / greatest(v_count, 1)) * 100, 2);
  ELSIF p_game_type = 'plinko' THEN
    v_rows := coalesce((p_settings ->> 'rows')::integer, 12);
    v_risk := CASE WHEN p_settings -> 'multipliers' ? 'medium' THEN 'medium'
                   WHEN p_settings -> 'multipliers' ? 'low' THEN 'low'
                   ELSE 'high' END;
    v_mult := p_settings -> 'multipliers' -> v_risk;
    IF v_mult IS NULL OR jsonb_typeof(v_mult) <> 'array' THEN
      RETURN round(coalesce(p_default_rtp, 0), 2);
    END IF;
    FOR v_k IN 0 .. v_rows LOOP
      v := v + public.game_binomial_prob(v_rows, v_k) * coalesce((v_mult ->> v_k)::numeric, 0);
    END LOOP;
    RETURN round(v * 100, 2);
  ELSIF p_game_type = 'slots' THEN
    SELECT coalesce(sum((t ->> 'probability')::numeric * (t ->> 'multiplier')::numeric), 0)
      INTO v
    FROM jsonb_array_elements(coalesce(p_settings -> 'tiers', '[]'::jsonb)) t;
    RETURN round(v * 100, 2);
  ELSE
    RETURN round(coalesce(p_default_rtp, 0), 2);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.game_settings_odds(
  p_game_type public.game_type,
  p_settings jsonb,
  p_default_rtp numeric
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_rows integer;
  v_risk text;
  v_risks jsonb := '{}'::jsonb;
  v_mult jsonb;
  v_k integer;
  v_prob numeric;
BEGIN
  IF p_game_type = 'wheel' THEN
    RETURN jsonb_build_object(
      'type', 'wheel',
      'rtp', public.game_settings_rtp('wheel', p_settings, p_default_rtp),
      'segments', (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
          'index', (s.ord - 1),
          'value', (s.item ->> 'value')::numeric,
          'probability', (s.item ->> 'probability')::numeric,
          'segment_rtp', round((s.item ->> 'probability')::numeric * (s.item ->> 'value')::numeric * 100, 2),
          'color', s.item ->> 'color',
          'label', s.item ->> 'label'
        ) ORDER BY s.ord), '[]'::jsonb)
        FROM jsonb_array_elements(coalesce(p_settings -> 'segments', '[]'::jsonb)) WITH ORDINALITY AS s(item, ord)
      )
    );
  ELSIF p_game_type = 'plinko' THEN
    v_rows := coalesce((p_settings ->> 'rows')::integer, 12);
    FOREACH v_risk IN ARRAY ARRAY['low', 'medium', 'high'] LOOP
      v_mult := p_settings -> 'multipliers' -> v_risk;
      IF v_mult IS NULL OR jsonb_typeof(v_mult) <> 'array' THEN
        CONTINUE;
      END IF;
      v_risks := v_risks || jsonb_build_object(v_risk, jsonb_build_object(
        'rtp', round((
          SELECT coalesce(sum(public.game_binomial_prob(v_rows, k) * coalesce((v_mult ->> k)::numeric, 0)), 0)
          FROM generate_series(0, v_rows) AS k
        ) * 100, 2),
        'slots', (
          SELECT coalesce(jsonb_agg(jsonb_build_object(
            'slot', k,
            'multiplier', coalesce((v_mult ->> k)::numeric, 0),
            'probability', public.game_binomial_prob(v_rows, k)
          ) ORDER BY k), '[]'::jsonb)
          FROM generate_series(0, v_rows) AS k
        )
      ));
    END LOOP;
    RETURN jsonb_build_object('type', 'plinko', 'rows', v_rows, 'risks', v_risks);
  ELSIF p_game_type = 'slots' THEN
    RETURN jsonb_build_object(
      'type', 'slots',
      'rtp', public.game_settings_rtp('slots', p_settings, p_default_rtp),
      'hit_rate', (
        SELECT coalesce(sum((t ->> 'probability')::numeric), 0)
        FROM jsonb_array_elements(coalesce(p_settings -> 'tiers', '[]'::jsonb)) t
      ),
      'tiers', coalesce(p_settings -> 'tiers', '[]'::jsonb)
    );
  ELSIF p_game_type = 'dice' THEN
    RETURN jsonb_build_object(
      'type', 'dice',
      'rtp', round(coalesce(p_default_rtp, 0), 2),
      'min_value', coalesce((p_settings ->> 'min_value')::integer, 1),
      'max_value', coalesce((p_settings ->> 'max_value')::integer, 100),
      'formula', 'multiplier = (1 / p_win) * (rtp / 100)'
    );
  ELSE
    RETURN jsonb_build_object(
      'type', p_game_type::text,
      'rtp', round(coalesce(p_default_rtp, 0), 2),
      'formula', 'P(crash > x) = rtp / x'
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.game_declared_rtp(p_game_type public.game_type)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c public.game_configs%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public.game_configs WHERE game_type = p_game_type;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN public.game_settings_rtp(c.game_type, c.settings, c.default_rtp);
END;
$$;

-- ============================================================
-- 5) التحقق من صلاحية إعدادات كل لعبة (تُستخدم إدارياً)
-- ============================================================
CREATE OR REPLACE FUNCTION public.game_validate_settings(
  p_game_type public.game_type,
  p_settings jsonb,
  p_max_multiplier numeric
)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_sum numeric;
  v_count integer;
  v_item jsonb;
  v_rows integer;
  v_risk text;
  v_arr jsonb;
  v_i integer;
  v_value numeric;
BEGIN
  IF p_settings IS NULL OR jsonb_typeof(p_settings) <> 'object' THEN
    RAISE EXCEPTION 'إعدادات اللعبة غير صالحة';
  END IF;

  IF p_game_type = 'wheel' THEN
    IF jsonb_typeof(p_settings -> 'segments') <> 'array' THEN
      RAISE EXCEPTION 'خانات العجلة مطلوبة';
    END IF;
    SELECT count(*), coalesce(sum((s ->> 'probability')::numeric), 0)
      INTO v_count, v_sum
    FROM jsonb_array_elements(p_settings -> 'segments') s;
    IF v_count < 2 OR v_count > 12 THEN
      RAISE EXCEPTION 'عدد خانات العجلة يجب أن يكون بين 2 و12';
    END IF;
    IF v_sum < 0.999 OR v_sum > 1.001 THEN
      RAISE EXCEPTION 'مجموع احتمالات العجلة يجب أن يساوي 1';
    END IF;
    FOR v_item IN SELECT s FROM jsonb_array_elements(p_settings -> 'segments') s LOOP
      v_value := (v_item ->> 'value')::numeric;
      IF v_value IS NULL OR v_value < 0 OR v_value > p_max_multiplier THEN
        RAISE EXCEPTION 'عائد الخانة يجب أن يكون بين 0 والمضاعف الأقصى';
      END IF;
      IF (v_item ->> 'probability')::numeric <= 0 OR (v_item ->> 'probability')::numeric > 1 THEN
        RAISE EXCEPTION 'احتمال الخانة يجب أن يكون بين 0 و1';
      END IF;
      IF coalesce(v_item ->> 'color', '') !~ '^#[0-9A-Fa-f]{6}$' THEN
        RAISE EXCEPTION 'لون الخانة غير صالح';
      END IF;
      IF char_length(coalesce(v_item ->> 'label', '')) NOT BETWEEN 1 AND 8 THEN
        RAISE EXCEPTION 'عنوان الخانة يجب أن يكون بين 1 و8 أحرف';
      END IF;
    END LOOP;

  ELSIF p_game_type = 'plinko' THEN
    v_rows := coalesce((p_settings ->> 'rows')::integer, 0);
    IF v_rows < 6 OR v_rows > 16 THEN
      RAISE EXCEPTION 'عدد صفوف بلانغو يجب أن يكون بين 6 و16';
    END IF;
    FOREACH v_risk IN ARRAY ARRAY['low', 'medium', 'high'] LOOP
      v_arr := p_settings -> 'multipliers' -> v_risk;
      IF v_arr IS NULL OR jsonb_typeof(v_arr) <> 'array' THEN
        RAISE EXCEPTION 'مضاعفات مستوى المخاطرة % مطلوبة', v_risk;
      END IF;
      IF jsonb_array_length(v_arr) <> v_rows + 1 THEN
        RAISE EXCEPTION 'عدد خانات بلانغو يجب أن يساوي الصفوف + 1';
      END IF;
      FOR v_i IN 0 .. v_rows LOOP
        v_value := (v_arr ->> v_i)::numeric;
        IF v_value IS NULL OR v_value < 0 OR v_value > p_max_multiplier THEN
          RAISE EXCEPTION 'مضاعف خانة بلانغو غير صالح';
        END IF;
      END LOOP;
    END LOOP;

  ELSIF p_game_type = 'slots' THEN
    IF jsonb_typeof(p_settings -> 'tiers') <> 'array' THEN
      RAISE EXCEPTION 'جدول جوائز Slots مطلوب';
    END IF;
    SELECT count(*), coalesce(sum((t ->> 'probability')::numeric), 0)
      INTO v_count, v_sum
    FROM jsonb_array_elements(p_settings -> 'tiers') t;
    IF v_count < 1 OR v_count > 8 THEN
      RAISE EXCEPTION 'عدد جوائز Slots يجب أن يكون بين 1 و8';
    END IF;
    IF v_sum > 1.0001 THEN
      RAISE EXCEPTION 'مجموع احتمالات جوائز Slots يجب ألا يتجاوز 1';
    END IF;
    FOR v_item IN SELECT t FROM jsonb_array_elements(p_settings -> 'tiers') t LOOP
      v_value := (v_item ->> 'multiplier')::numeric;
      IF v_value IS NULL OR v_value < 1 OR v_value > p_max_multiplier THEN
        RAISE EXCEPTION 'مضاعف جائزة Slots غير صالح';
      END IF;
      IF (v_item ->> 'probability')::numeric <= 0 OR (v_item ->> 'probability')::numeric > 1 THEN
        RAISE EXCEPTION 'احتمال جائزة Slots يجب أن يكون بين 0 و1';
      END IF;
      IF char_length(coalesce(v_item ->> 'symbol', '')) NOT BETWEEN 1 AND 8 THEN
        RAISE EXCEPTION 'رمز جائزة Slots غير صالح';
      END IF;
    END LOOP;
    IF p_settings ? 'loss_symbols' THEN
      IF jsonb_typeof(p_settings -> 'loss_symbols') <> 'array'
         OR jsonb_array_length(p_settings -> 'loss_symbols') < 4 THEN
        RAISE EXCEPTION 'رموز الخسارة في Slots يجب أن تكون 4 على الأقل';
      END IF;
    END IF;

  ELSIF p_game_type = 'dice' THEN
    IF coalesce((p_settings ->> 'min_value')::integer, 1) < 1
       OR coalesce((p_settings ->> 'max_value')::integer, 100) > 100
       OR coalesce((p_settings ->> 'min_value')::integer, 1) >= coalesce((p_settings ->> 'max_value')::integer, 100) THEN
      RAISE EXCEPTION 'نطاق النرد غير صالح';
    END IF;
    IF coalesce((p_settings ->> 'default_target')::integer, 50)
       NOT BETWEEN coalesce((p_settings ->> 'min_value')::integer, 1)
               AND coalesce((p_settings ->> 'max_value')::integer, 100) THEN
      RAISE EXCEPTION 'حد النرد الافتراضي خارج النطاق';
    END IF;

  ELSIF p_game_type = 'aviator' THEN
    IF p_settings ? 'instant_crash_probability' THEN
      v_value := (p_settings ->> 'instant_crash_probability')::numeric;
      IF v_value < 0 OR v_value > 0.5 THEN
        RAISE EXCEPTION 'احتمال الانهيار الفوري يجب أن يكون بين 0 و0.5';
      END IF;
    END IF;
  END IF;
END;
$$;

-- ============================================================
-- 6) بوابة اللعب العامة (تشغيل/جغرافيا/عمر/حالة الحساب)
-- ============================================================
CREATE OR REPLACE FUNCTION public.game_play_gate(
  p_user_id uuid,
  p_game_type public.game_type
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c public.game_configs%ROWTYPE;
  u public.users%ROWTYPE;
  v_geo_enabled boolean := false;
  v_global_blocked text[] := '{}';
BEGIN
  IF p_user_id IS NULL OR p_game_type IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'invalid');
  END IF;

  SELECT * INTO c FROM public.game_configs WHERE game_type = p_game_type;
  IF NOT FOUND OR c.archived_at IS NOT NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'not_found');
  END IF;
  IF NOT c.is_enabled THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'disabled');
  END IF;

  SELECT * INTO u FROM public.users WHERE id = p_user_id;
  IF NOT FOUND OR u.status <> 'active' THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'inactive');
  END IF;
  IF c.requires_adult AND u.adult_confirmed_at IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'age');
  END IF;

  SELECT coalesce((value)::text::boolean, false) INTO v_geo_enabled
  FROM public.admin_settings WHERE key = 'games_geoblocking_enabled';
  v_geo_enabled := coalesce(v_geo_enabled, false);

  IF v_geo_enabled THEN
    SELECT coalesce(array_agg(upper(x)), '{}') INTO v_global_blocked
    FROM public.admin_settings s, jsonb_array_elements_text(s.value) x
    WHERE s.key = 'blocked_game_countries';

    IF u.country_code IS NOT NULL AND (
         u.country_code = ANY(v_global_blocked)
         OR u.country_code = ANY(c.blocked_countries)
       ) THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'region');
    END IF;
    IF c.allowed_countries IS NOT NULL AND (
         u.country_code IS NULL OR NOT (u.country_code = ANY(c.allowed_countries))
       ) THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'region');
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'reason', null,
    'test_mode_enabled', c.test_mode_enabled,
    'min_bet', c.min_bet_gold,
    'max_bet', c.max_bet_gold,
    'max_multiplier', c.max_multiplier,
    'rtp', c.default_rtp
  );
END;
$$;

-- ============================================================
-- 7) الألعاب العامة (تظهر/تختفي من قاعدة البيانات بلا تعديل كود)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_public_games()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  u public.users%ROWTYPE;
  v_has_user boolean := false;
  v_geo_enabled boolean := false;
  v_global_blocked text[] := '{}';
  v_result jsonb;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    SELECT * INTO u FROM public.users WHERE id = auth.uid();
    v_has_user := FOUND;
  END IF;

  SELECT coalesce((value)::text::boolean, false) INTO v_geo_enabled
  FROM public.admin_settings WHERE key = 'games_geoblocking_enabled';
  v_geo_enabled := coalesce(v_geo_enabled, false);

  IF v_geo_enabled THEN
    SELECT coalesce(array_agg(upper(x)), '{}') INTO v_global_blocked
    FROM public.admin_settings s, jsonb_array_elements_text(s.value) x
    WHERE s.key = 'blocked_game_countries';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'game_type', c.game_type,
    'display_name', coalesce(nullif(c.display_name, ''), initcap(c.game_type::text)),
    'description', c.description_ar,
    'icon', c.icon,
    'accent_color', c.accent_color,
    'sort_order', c.sort_order,
    'is_enabled', c.is_enabled,
    'available', v_available,
    'unavailable_reason', v_reason,
    'min_bet', c.min_bet_gold,
    'max_bet', c.max_bet_gold,
    'max_multiplier', c.max_multiplier,
    'default_rtp', c.default_rtp,
    'declared_rtp', public.game_settings_rtp(c.game_type, c.settings, c.default_rtp),
    'declared_odds', public.game_settings_odds(c.game_type, c.settings, c.default_rtp),
    'min_age', c.min_age,
    'requires_adult', c.requires_adult,
    'test_mode_enabled', c.test_mode_enabled,
    'rules', c.rules_ar,
    'settings', c.settings,
    'promo', CASE
      WHEN c.promo_multiplier > 1
       AND (c.promo_starts_at IS NULL OR c.promo_starts_at <= now())
       AND (c.promo_ends_at IS NULL OR c.promo_ends_at > now())
      THEN jsonb_build_object(
        'multiplier', c.promo_multiplier,
        'label', c.promo_label,
        'ends_at', c.promo_ends_at
      )
      ELSE NULL
    END
  ) ORDER BY c.sort_order, c.game_type), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT c.*,
      CASE
        WHEN NOT c.is_enabled THEN false
        WHEN c.requires_adult AND v_has_user AND u.adult_confirmed_at IS NULL THEN false
        WHEN NOT v_has_user THEN true
        WHEN v_geo_enabled AND u.country_code IS NOT NULL AND (
          u.country_code = ANY(v_global_blocked) OR u.country_code = ANY(c.blocked_countries)
        ) THEN false
        WHEN v_geo_enabled AND c.allowed_countries IS NOT NULL AND (
          u.country_code IS NULL OR NOT (u.country_code = ANY(c.allowed_countries))
        ) THEN false
        ELSE true
      END AS v_available,
      CASE
        WHEN NOT c.is_enabled THEN 'disabled'
        WHEN c.requires_adult AND v_has_user AND u.adult_confirmed_at IS NULL THEN 'age'
        WHEN NOT v_has_user THEN NULL
        WHEN v_geo_enabled AND u.country_code IS NOT NULL AND (
          u.country_code = ANY(v_global_blocked) OR u.country_code = ANY(c.blocked_countries)
        ) THEN 'region'
        WHEN v_geo_enabled AND c.allowed_countries IS NOT NULL AND (
          u.country_code IS NULL OR NOT (u.country_code = ANY(c.allowed_countries))
        ) THEN 'region'
        ELSE NULL
      END AS v_reason
    FROM public.game_configs c
    WHERE c.archived_at IS NULL
  ) c;

  RETURN coalesce(v_result, '[]'::jsonb);
END;
$$;

-- ============================================================
-- 8) سجل جولات المستخدم (Keyset) + إحصاءاته
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_my_game_rounds(
  p_game_type public.game_type DEFAULT NULL,
  p_limit integer DEFAULT 20,
  p_before timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 50));
  v_result jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول';
  END IF;
  IF (p_before IS NULL) <> (p_before_id IS NULL) THEN
    RAISE EXCEPTION 'مرجع الصفحة غير صالح';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'bet_id', b.id,
    'round_id', b.round_id,
    'game_type', b.game_type,
    'bet_amount', b.bet_amount,
    'payout', b.payout,
    'net', b.payout - b.bet_amount,
    'multiplier', b.multiplier,
    'is_win', b.is_win,
    'is_test', b.is_test,
    'promo_reward', b.forced_outcome = 'win',
    'result', r.result,
    'created_at', b.created_at
  ) ORDER BY b.created_at DESC, b.id DESC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT b.*
    FROM public.game_bets b
    WHERE b.user_id = v_user
      AND (p_game_type IS NULL OR b.game_type = p_game_type)
      AND (p_before IS NULL OR (b.created_at, b.id) < (p_before, p_before_id))
    ORDER BY b.created_at DESC, b.id DESC
    LIMIT v_limit
  ) b
  LEFT JOIN public.game_rounds r ON r.id = b.round_id;

  RETURN coalesce(v_result, '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_game_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_overall jsonb;
  v_by_game jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول';
  END IF;

  SELECT jsonb_build_object(
    'rounds', count(*),
    'wagered', coalesce(sum(bet_amount), 0),
    'returned', coalesce(sum(payout), 0),
    'net', coalesce(sum(payout - bet_amount), 0),
    'wins', count(*) FILTER (WHERE is_win),
    'best_multiplier', coalesce(max(multiplier), 0)
  ) INTO v_overall
  FROM public.game_bets
  WHERE user_id = v_user AND NOT is_test;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'game_type', game_type,
    'rounds', rounds,
    'wagered', wagered,
    'returned', returned,
    'net', net,
    'wins', wins
  ) ORDER BY game_type), '[]'::jsonb)
  INTO v_by_game
  FROM (
    SELECT game_type,
      count(*) AS rounds,
      coalesce(sum(bet_amount), 0) AS wagered,
      coalesce(sum(payout), 0) AS returned,
      coalesce(sum(payout - bet_amount), 0) AS net,
      count(*) FILTER (WHERE is_win) AS wins
    FROM public.game_bets
    WHERE user_id = v_user AND NOT is_test
    GROUP BY game_type
  ) s;

  RETURN jsonb_build_object('overall', v_overall, 'by_game', v_by_game);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_my_country(p_country text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_country text := upper(btrim(coalesce(p_country, '')));
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول';
  END IF;
  IF v_country !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'رمز الدولة يجب أن يكون حرفين';
  END IF;
  UPDATE public.users SET country_code = v_country, updated_at = now() WHERE id = v_user;
  RETURN jsonb_build_object('country_code', v_country);
END;
$$;

-- ============================================================
-- 9) وضع المحاكاة — نتائج خادم بلا أرصدة حقيقية
-- ============================================================
CREATE OR REPLACE FUNCTION public.play_game_simulation(
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
  p_seed text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user public.users%ROWTYPE;
  v_existing public.game_bets%ROWTYPE;
  v_config public.game_configs%ROWTYPE;
  v_round_id uuid;
  v_bet_id uuid;
  v_global_test boolean := false;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'غير مصرح بتنفيذ العملية';
  END IF;
  IF p_user_id IS NULL OR p_game_type IS NULL OR p_request_data IS NULL
     OR p_bet_data IS NULL OR p_result IS NULL
     OR p_is_win IS NULL OR p_multiplier IS NULL OR p_rtp IS NULL OR p_seed IS NULL
     OR p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9._:-]{10,100}$'
     OR p_bet_amount IS NULL OR p_payout IS NULL
     OR p_bet_amount < 1 OR p_bet_amount > 1000000
     OR p_payout < 0 OR p_payout > p_bet_amount * 1000
     OR p_multiplier < 0 OR p_multiplier > 1000
     OR p_rtp < 0 OR p_rtp > 100
     OR (p_forced_outcome IS NOT NULL AND p_forced_outcome NOT IN ('win')) THEN
    RAISE EXCEPTION 'بيانات الجولة غير صالحة';
  END IF;

  SELECT coalesce((value)::text::boolean, false) INTO v_global_test
  FROM public.admin_settings WHERE key = 'games_test_mode_enabled';
  v_global_test := coalesce(v_global_test, false);

  SELECT * INTO v_config FROM public.game_configs WHERE game_type = p_game_type;
  IF NOT FOUND OR NOT v_config.is_enabled OR v_config.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'اللعبة غير متاحة';
  END IF;
  IF NOT (v_global_test AND v_config.test_mode_enabled) THEN
    RAISE EXCEPTION 'وضع المحاكاة غير مفعّل لهذه اللعبة';
  END IF;

  SELECT * INTO v_user FROM public.users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND OR v_user.status <> 'active' OR v_user.adult_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'الحساب غير متاح أو لم يُؤكّد العمر';
  END IF;

  SELECT * INTO v_existing FROM public.game_bets
  WHERE user_id = p_user_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.game_type <> p_game_type OR v_existing.bet_amount <> p_bet_amount
       OR v_existing.request_data <> p_request_data THEN
      RAISE EXCEPTION 'مفتاح منع التكرار مستخدم لطلب مختلف';
    END IF;
    RETURN jsonb_build_object(
      'round_id', v_existing.round_id,
      'bet_id', v_existing.id,
      'result', (SELECT r.result FROM public.game_rounds r WHERE r.id = v_existing.round_id),
      'is_win', v_existing.is_win,
      'multiplier', v_existing.multiplier,
      'payout', v_existing.payout,
      'forced_outcome', v_existing.forced_outcome,
      'balance_after', v_user.balance_gold,
      'currency', 'gold',
      'test_mode', true
    );
  END IF;

  INSERT INTO public.game_rounds (
    game_type, seed, result, crash_point,
    total_bets, total_bet_gold, total_payout, rtp_applied,
    ended_at, metadata
  ) VALUES (
    p_game_type, p_seed, p_result, (p_result ->> 'crash_point')::numeric,
    1, p_bet_amount, p_payout, p_rtp, now(),
    jsonb_build_object('currency', 'test', 'test_mode', true, 'forced_outcome', p_forced_outcome)
  ) RETURNING id INTO v_round_id;

  INSERT INTO public.game_bets (
    round_id, user_id, game_type, bet_amount, bet_data, payout,
    multiplier, is_win, forced_outcome, settled_at, idempotency_key, request_data, is_test
  ) VALUES (
    v_round_id, p_user_id, p_game_type, p_bet_amount, coalesce(p_bet_data, '{}'::jsonb),
    p_payout, p_multiplier, p_is_win, p_forced_outcome, now(), p_idempotency_key, p_request_data, true
  ) RETURNING id INTO v_bet_id;

  RETURN jsonb_build_object(
    'round_id', v_round_id,
    'bet_id', v_bet_id,
    'result', p_result,
    'is_win', p_is_win,
    'multiplier', p_multiplier,
    'payout', p_payout,
    'forced_outcome', p_forced_outcome,
    'balance_after', v_user.balance_gold,
    'currency', 'gold',
    'test_mode', true
  );
END;
$$;

-- ============================================================
-- 10) الإدارة — games.view / games.manage + سبب إلزامي + تدقيق
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_list_game_configs()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT public.admin_staff_can(auth.uid(), 'games.view') THEN
    RAISE EXCEPTION 'غير مصرح بعرض إعدادات الألعاب';
  END IF;

  RETURN (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id,
      'game_type', c.game_type,
      'display_name', coalesce(nullif(c.display_name, ''), initcap(c.game_type::text)),
      'description_ar', c.description_ar,
      'icon', c.icon,
      'accent_color', c.accent_color,
      'sort_order', c.sort_order,
      'is_enabled', c.is_enabled,
      'default_rtp', c.default_rtp,
      'declared_rtp', public.game_settings_rtp(c.game_type, c.settings, c.default_rtp),
      'declared_odds', public.game_settings_odds(c.game_type, c.settings, c.default_rtp),
      'min_bet_gold', c.min_bet_gold,
      'max_bet_gold', c.max_bet_gold,
      'max_multiplier', c.max_multiplier,
      'min_age', c.min_age,
      'requires_adult', c.requires_adult,
      'allowed_countries', c.allowed_countries,
      'blocked_countries', c.blocked_countries,
      'promo_multiplier', c.promo_multiplier,
      'promo_label', c.promo_label,
      'promo_starts_at', c.promo_starts_at,
      'promo_ends_at', c.promo_ends_at,
      'test_mode_enabled', c.test_mode_enabled,
      'rules_ar', c.rules_ar,
      'settings', c.settings,
      'archived_at', c.archived_at,
      'updated_at', c.updated_at,
      'stats', jsonb_build_object(
        'rounds', coalesce(s.rounds, 0),
        'wagered', coalesce(s.wagered, 0),
        'returned', coalesce(s.returned, 0),
        'players', coalesce(s.players, 0),
        'actual_rtp', CASE WHEN coalesce(s.wagered, 0) > 0
          THEN round(s.returned::numeric * 100 / s.wagered, 2) ELSE NULL END
      )
    ) ORDER BY c.sort_order, c.game_type), '[]'::jsonb)
    FROM public.game_configs c
    LEFT JOIN (
      SELECT game_type,
        count(*) AS rounds,
        sum(bet_amount) AS wagered,
        sum(payout) AS returned,
        count(DISTINCT user_id) AS players
      FROM public.game_bets
      WHERE NOT is_test AND created_at >= now() - interval '30 days'
      GROUP BY game_type
    ) s ON s.game_type = c.game_type
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_upsert_game_config(
  p_admin_id uuid,
  p_game_type public.game_type,
  p_payload jsonb,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_before public.game_configs%ROWTYPE;
  v_after public.game_configs%ROWTYPE;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_display_name text;
  v_description text;
  v_icon text;
  v_accent text;
  v_sort integer;
  v_enabled boolean;
  v_rtp numeric;
  v_min_bet bigint;
  v_max_bet bigint;
  v_max_mult numeric;
  v_min_age integer;
  v_requires_adult boolean;
  v_allowed text[];
  v_blocked text[];
  v_promo numeric;
  v_promo_label text;
  v_promo_start timestamptz;
  v_promo_end timestamptz;
  v_test boolean;
  v_rules text;
  v_settings jsonb;
  v_archived timestamptz;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_admin_id
       OR NOT public.admin_staff_can(p_admin_id, 'games.manage') THEN
      RAISE EXCEPTION 'غير مصرح بإدارة الألعاب';
    END IF;
  END IF;
  IF p_admin_id IS NULL OR p_game_type IS NULL OR p_payload IS NULL
     OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'بيانات اللعبة غير صالحة';
  END IF;
  IF v_reason IS NULL OR char_length(v_reason) NOT BETWEEN 10 AND 500 THEN
    RAISE EXCEPTION 'أدخل سبباً بين 10 و500 حرف';
  END IF;

  SELECT * INTO v_before FROM public.game_configs WHERE game_type = p_game_type FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'اللعبة غير موجودة';
  END IF;

  v_display_name := CASE WHEN p_payload ? 'display_name'
    THEN btrim(coalesce(p_payload ->> 'display_name', '')) ELSE v_before.display_name END;
  v_description := CASE WHEN p_payload ? 'description_ar'
    THEN nullif(btrim(coalesce(p_payload ->> 'description_ar', '')), '') ELSE v_before.description_ar END;
  v_icon := CASE WHEN p_payload ? 'icon'
    THEN btrim(coalesce(p_payload ->> 'icon', '')) ELSE v_before.icon END;
  v_accent := CASE WHEN p_payload ? 'accent_color'
    THEN btrim(coalesce(p_payload ->> 'accent_color', '')) ELSE v_before.accent_color END;
  v_sort := CASE WHEN p_payload ? 'sort_order'
    THEN (p_payload ->> 'sort_order')::integer ELSE v_before.sort_order END;
  v_enabled := CASE WHEN p_payload ? 'is_enabled'
    THEN (p_payload ->> 'is_enabled')::boolean ELSE v_before.is_enabled END;
  v_rtp := CASE WHEN p_payload ? 'default_rtp'
    THEN (p_payload ->> 'default_rtp')::numeric ELSE v_before.default_rtp END;
  v_min_bet := CASE WHEN p_payload ? 'min_bet_gold'
    THEN (p_payload ->> 'min_bet_gold')::bigint ELSE v_before.min_bet_gold END;
  v_max_bet := CASE WHEN p_payload ? 'max_bet_gold'
    THEN (p_payload ->> 'max_bet_gold')::bigint ELSE v_before.max_bet_gold END;
  v_max_mult := CASE WHEN p_payload ? 'max_multiplier'
    THEN (p_payload ->> 'max_multiplier')::numeric ELSE v_before.max_multiplier END;
  v_min_age := CASE WHEN p_payload ? 'min_age'
    THEN (p_payload ->> 'min_age')::integer ELSE v_before.min_age END;
  v_requires_adult := CASE WHEN p_payload ? 'requires_adult'
    THEN (p_payload ->> 'requires_adult')::boolean ELSE v_before.requires_adult END;
  v_promo := CASE WHEN p_payload ? 'promo_multiplier'
    THEN (p_payload ->> 'promo_multiplier')::numeric ELSE v_before.promo_multiplier END;
  v_promo_label := CASE WHEN p_payload ? 'promo_label'
    THEN nullif(btrim(coalesce(p_payload ->> 'promo_label', '')), '') ELSE v_before.promo_label END;
  v_promo_start := CASE WHEN p_payload ? 'promo_starts_at'
    THEN nullif(p_payload ->> 'promo_starts_at', '')::timestamptz ELSE v_before.promo_starts_at END;
  v_promo_end := CASE WHEN p_payload ? 'promo_ends_at'
    THEN nullif(p_payload ->> 'promo_ends_at', '')::timestamptz ELSE v_before.promo_ends_at END;
  v_test := CASE WHEN p_payload ? 'test_mode_enabled'
    THEN (p_payload ->> 'test_mode_enabled')::boolean ELSE v_before.test_mode_enabled END;
  v_rules := CASE WHEN p_payload ? 'rules_ar'
    THEN nullif(btrim(coalesce(p_payload ->> 'rules_ar', '')), '') ELSE v_before.rules_ar END;
  v_settings := CASE WHEN p_payload ? 'settings'
    THEN p_payload -> 'settings' ELSE v_before.settings END;

  IF p_payload ? 'allowed_countries' THEN
    IF p_payload -> 'allowed_countries' = 'null'::jsonb THEN
      v_allowed := NULL;
    ELSE
      IF jsonb_typeof(p_payload -> 'allowed_countries') <> 'array' THEN
        RAISE EXCEPTION 'قائمة الدول المسموحة غير صالحة';
      END IF;
      SELECT array_agg(upper(btrim(x))) INTO v_allowed
      FROM jsonb_array_elements_text(p_payload -> 'allowed_countries') AS t(x);
      IF EXISTS (SELECT 1 FROM unnest(v_allowed) c WHERE c !~ '^[A-Z]{2}$') THEN
        RAISE EXCEPTION 'رموز الدول يجب أن تكون حرفين';
      END IF;
    END IF;
  ELSE
    v_allowed := v_before.allowed_countries;
  END IF;

  IF p_payload ? 'blocked_countries' THEN
    IF jsonb_typeof(p_payload -> 'blocked_countries') <> 'array' THEN
      RAISE EXCEPTION 'قائمة الدول المحظورة غير صالحة';
    END IF;
    SELECT coalesce(array_agg(upper(btrim(x))), '{}') INTO v_blocked
    FROM jsonb_array_elements_text(p_payload -> 'blocked_countries') AS t(x);
    IF EXISTS (SELECT 1 FROM unnest(v_blocked) c WHERE c !~ '^[A-Z]{2}$') THEN
      RAISE EXCEPTION 'رموز الدول يجب أن تكون حرفين';
    END IF;
  ELSE
    v_blocked := v_before.blocked_countries;
  END IF;

  v_archived := CASE WHEN p_payload ? 'archived'
    THEN CASE WHEN (p_payload ->> 'archived')::boolean THEN coalesce(v_before.archived_at, now()) ELSE NULL END
    ELSE v_before.archived_at END;

  IF char_length(v_display_name) NOT BETWEEN 2 AND 40 THEN
    RAISE EXCEPTION 'اسم اللعبة يجب أن يكون بين 2 و40 حرفاً';
  END IF;
  IF v_description IS NOT NULL AND char_length(v_description) > 300 THEN
    RAISE EXCEPTION 'وصف اللعبة يجب ألا يتجاوز 300 حرف';
  END IF;
  IF char_length(v_icon) NOT BETWEEN 1 AND 40 THEN
    RAISE EXCEPTION 'أيقونة اللعبة غير صالحة';
  END IF;
  IF v_accent !~ '^#[0-9A-Fa-f]{6}$' THEN
    RAISE EXCEPTION 'لون اللعبة غير صالح';
  END IF;
  IF v_sort NOT BETWEEN 0 AND 1000 THEN
    RAISE EXCEPTION 'ترتيب العرض غير صالح';
  END IF;
  IF v_rtp < 0 OR v_rtp > 100 THEN
    RAISE EXCEPTION 'نسبة العائد يجب أن تكون بين 0 و100';
  END IF;
  IF v_min_bet < 1 OR v_max_bet > 1000000 OR v_max_bet < v_min_bet THEN
    RAISE EXCEPTION 'حدود الرهان غير صالحة';
  END IF;
  IF v_max_mult < 1 OR v_max_mult > 1000 THEN
    RAISE EXCEPTION 'المضاعف الأقصى يجب أن يكون بين 1 و1000';
  END IF;
  IF v_min_age NOT BETWEEN 13 AND 21 THEN
    RAISE EXCEPTION 'العمر الأدنى غير صالح';
  END IF;
  IF v_promo < 1 OR v_promo > 10 THEN
    RAISE EXCEPTION 'مضاعف العرض يجب أن يكون بين 1 و10';
  END IF;
  IF v_promo_label IS NOT NULL AND char_length(v_promo_label) > 40 THEN
    RAISE EXCEPTION 'عنوان العرض يجب ألا يتجاوز 40 حرفاً';
  END IF;
  IF v_promo_start IS NOT NULL AND v_promo_end IS NOT NULL AND v_promo_end <= v_promo_start THEN
    RAISE EXCEPTION 'نهاية العرض يجب أن تكون بعد بدايته';
  END IF;
  IF v_rules IS NOT NULL AND char_length(v_rules) > 1000 THEN
    RAISE EXCEPTION 'قواعد اللعبة يجب ألا تتجاوز 1000 حرف';
  END IF;

  PERFORM public.game_validate_settings(p_game_type, v_settings, v_max_mult);

  UPDATE public.game_configs SET
    display_name = v_display_name,
    description_ar = v_description,
    icon = v_icon,
    accent_color = v_accent,
    sort_order = v_sort,
    is_enabled = v_enabled,
    default_rtp = v_rtp,
    min_bet_gold = v_min_bet,
    max_bet_gold = v_max_bet,
    max_multiplier = v_max_mult,
    min_age = v_min_age,
    requires_adult = v_requires_adult,
    allowed_countries = v_allowed,
    blocked_countries = v_blocked,
    promo_multiplier = v_promo,
    promo_label = v_promo_label,
    promo_starts_at = v_promo_start,
    promo_ends_at = v_promo_end,
    test_mode_enabled = v_test,
    rules_ar = v_rules,
    settings = v_settings,
    archived_at = v_archived,
    updated_by = p_admin_id,
    updated_at = now()
  WHERE game_type = p_game_type
  RETURNING * INTO v_after;

  INSERT INTO public.admin_audit_log (
    admin_id, action, target_type, target_id, before, after, reason, metadata
  ) VALUES (
    p_admin_id, 'update'::public.audit_action_type, 'game_config', v_after.id,
    to_jsonb(v_before), to_jsonb(v_after), v_reason,
    jsonb_build_object(
      'game_type', p_game_type,
      'declared_rtp_before', public.game_settings_rtp(v_before.game_type, v_before.settings, v_before.default_rtp),
      'declared_rtp_after', public.game_settings_rtp(v_after.game_type, v_after.settings, v_after.default_rtp),
      'reason', v_reason
    )
  );

  RETURN to_jsonb(v_after) || jsonb_build_object(
    'declared_rtp', public.game_settings_rtp(v_after.game_type, v_after.settings, v_after.default_rtp),
    'declared_odds', public.game_settings_odds(v_after.game_type, v_after.settings, v_after.default_rtp)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_game_enabled(
  p_admin_id uuid,
  p_game_type public.game_type,
  p_enabled boolean,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN public.admin_upsert_game_config(
    p_admin_id,
    p_game_type,
    jsonb_build_object('is_enabled', coalesce(p_enabled, false)),
    p_reason
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_game_promotion(
  p_admin_id uuid,
  p_game_type public.game_type,
  p_multiplier numeric,
  p_label text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN public.admin_upsert_game_config(
    p_admin_id,
    p_game_type,
    jsonb_build_object(
      'promo_multiplier', coalesce(p_multiplier, 1),
      'promo_label', p_label,
      'promo_starts_at', p_starts_at,
      'promo_ends_at', p_ends_at
    ),
    p_reason
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_game_stats(p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_days integer := greatest(1, least(coalesce(p_days, 30), 365));
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT public.admin_staff_can(auth.uid(), 'games.view') THEN
    RAISE EXCEPTION 'غير مصرح بعرض إحصاءات الألعاب';
  END IF;

  RETURN (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'game_type', c.game_type,
      'display_name', coalesce(nullif(c.display_name, ''), initcap(c.game_type::text)),
      'is_enabled', c.is_enabled,
      'declared_rtp', public.game_settings_rtp(c.game_type, c.settings, c.default_rtp),
      'rounds', coalesce(s.rounds, 0),
      'wagered', coalesce(s.wagered, 0),
      'returned', coalesce(s.returned, 0),
      'net_house', coalesce(s.wagered, 0) - coalesce(s.returned, 0),
      'actual_rtp', CASE WHEN coalesce(s.wagered, 0) > 0
        THEN round(s.returned::numeric * 100 / s.wagered, 2) ELSE NULL END,
      'unique_players', coalesce(s.players, 0),
      'test_rounds', coalesce(t.test_rounds, 0)
    ) ORDER BY c.sort_order, c.game_type), '[]'::jsonb)
    FROM public.game_configs c
    LEFT JOIN (
      SELECT game_type, count(*) AS rounds, sum(bet_amount) AS wagered,
        sum(payout) AS returned, count(DISTINCT user_id) AS players
      FROM public.game_bets
      WHERE NOT is_test AND created_at >= now() - make_interval(days => v_days)
      GROUP BY game_type
    ) s ON s.game_type = c.game_type
    LEFT JOIN (
      SELECT game_type, count(*) AS test_rounds
      FROM public.game_bets
      WHERE is_test AND created_at >= now() - make_interval(days => v_days)
      GROUP BY game_type
    ) t ON t.game_type = c.game_type
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_game_rounds(
  p_game_type public.game_type DEFAULT NULL,
  p_user_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT public.admin_staff_can(auth.uid(), 'games.view') THEN
    RAISE EXCEPTION 'غير مصرح بعرض جولات الألعاب';
  END IF;

  RETURN (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'bet_id', b.id,
      'game_type', b.game_type,
      'user_id', b.user_id,
      'username', u.username,
      'bet_amount', b.bet_amount,
      'payout', b.payout,
      'net', b.payout - b.bet_amount,
      'multiplier', b.multiplier,
      'is_win', b.is_win,
      'is_test', b.is_test,
      'forced_outcome', b.forced_outcome,
      'result', r.result,
      'created_at', b.created_at
    ) ORDER BY b.created_at DESC, b.id DESC), '[]'::jsonb)
    FROM (
      SELECT b.*
      FROM public.game_bets b
      WHERE (p_game_type IS NULL OR b.game_type = p_game_type)
        AND (p_user_id IS NULL OR b.user_id = p_user_id)
      ORDER BY b.created_at DESC, b.id DESC
      LIMIT v_limit OFFSET v_offset
    ) b
    JOIN public.users u ON u.id = b.user_id
    LEFT JOIN public.game_rounds r ON r.id = b.round_id
  );
END;
$$;

-- ============================================================
-- 11) الصلاحيات وسياسات الوصول
-- ============================================================
DROP POLICY IF EXISTS game_configs_admin_update ON public.game_configs;
DROP POLICY IF EXISTS game_rounds_public_select ON public.game_rounds;

REVOKE ALL ON FUNCTION public.game_binomial_prob(integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.game_settings_rtp(public.game_type, jsonb, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.game_settings_odds(public.game_type, jsonb, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.game_validate_settings(public.game_type, jsonb, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.game_declared_rtp(public.game_type) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.game_play_gate(uuid, public.game_type) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_public_games() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_game_rounds(public.game_type, integer, timestamptz, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_game_stats() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_my_country(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.play_game_simulation(uuid, public.game_type, text, jsonb, bigint, jsonb, jsonb, bigint, numeric, boolean, text, numeric, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_list_game_configs() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_upsert_game_config(uuid, public.game_type, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_game_enabled(uuid, public.game_type, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_game_promotion(uuid, public.game_type, numeric, text, timestamptz, timestamptz, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_game_stats(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_game_rounds(public.game_type, uuid, integer, integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.game_settings_rtp(public.game_type, jsonb, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.game_settings_odds(public.game_type, jsonb, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.game_declared_rtp(public.game_type) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.game_play_gate(uuid, public.game_type) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_public_games() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_game_rounds(public.game_type, integer, timestamptz, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_game_stats() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_my_country(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.play_game_simulation(uuid, public.game_type, text, jsonb, bigint, jsonb, jsonb, bigint, numeric, boolean, text, numeric, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_game_configs() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_upsert_game_config(uuid, public.game_type, jsonb, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_game_enabled(uuid, public.game_type, boolean, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_game_promotion(uuid, public.game_type, numeric, text, timestamptz, timestamptz, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_game_stats(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_game_rounds(public.game_type, uuid, integer, integer) TO authenticated, service_role;

COMMIT;
