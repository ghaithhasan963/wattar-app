-- ============================================================
-- patch_m8_vip.sql  (Migration #75)
-- M8.4 — نظام VIP من ١ إلى ١٠ (القسم 16)
--   * درجات بإدارة كاملة: سعر/مدة/مزايا/إطار/شارة/تأثير دخول/عروض
--   * شراء أي درجة مباشرة دون المرور بالدرجات السابقة
--   * ترقية بسياسة موثقة: القيمة المتبقية من الاشتراك النشط تُحتسب
--     تناسبياً من سعره المدفوع وتُخصم من سعر الدرجة الأعلى، والاشتراك
--     الجديد يبدأ من الآن بمدته الكاملة. إن غطّى الفرق كلياً لا يُخصم
--     شيء ولا يُسجَّل قيد صفر (المحفظة ترفض القيمة الصفرية).
--   * تجديد نفس الدرجة يمدد المدة من تاريخ الانتهاء الحالي.
--   * لا شراء درجة أقل أثناء اشتراك نشط، وVIP مدفوع حصراً — لا يُمنح
--     بالشحن التراكمي أو النشاط (لا يوجد أي مسار مجاني).
--   * الإيراد يُثبت محاسبياً في revenue_ledger على platform:main.
-- يعتمد على: patch_m8_enum_prep.sql ('vip_purchase') و patch_m7_rbac.sql
-- وصلاحيات vip.view/vip.manage من #74.
-- ============================================================
BEGIN;

-- ============================================================
-- 1) جدول الدرجات
-- ============================================================
CREATE TABLE IF NOT EXISTS public.vip_tiers (
  tier integer PRIMARY KEY CHECK (tier BETWEEN 1 AND 10),
  name_ar text NOT NULL CHECK (char_length(btrim(name_ar)) BETWEEN 2 AND 40),
  duration_days integer NOT NULL CHECK (duration_days BETWEEN 1 AND 3650),
  price_coins bigint NOT NULL CHECK (price_coins BETWEEN 1 AND 10000000),
  frame text CHECK (frame IS NULL OR char_length(btrim(frame)) BETWEEN 1 AND 60),
  badge text CHECK (badge IS NULL OR char_length(btrim(badge)) BETWEEN 1 AND 60),
  entry_effect text CHECK (entry_effect IS NULL OR char_length(btrim(entry_effect)) BETWEEN 1 AND 60),
  perks jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(perks) = 'array'),
  room_kick_protection boolean NOT NULL DEFAULT false,
  offer_discount_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (offer_discount_percent BETWEEN 0 AND 90),
  offer_ends_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vip_tiers_perks_shape CHECK (
    jsonb_array_length(perks) <= 12
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(perks) p
      WHERE jsonb_typeof(p) <> 'string' OR char_length(p #>> '{}') > 160
    )
  )
);

ALTER TABLE public.vip_tiers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vip_tiers FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.vip_tiers TO anon, authenticated, service_role;

DROP POLICY IF EXISTS vip_tiers_read ON public.vip_tiers;
CREATE POLICY vip_tiers_read ON public.vip_tiers
  FOR SELECT TO anon, authenticated
  USING (is_active OR public.is_admin());

-- درجات افتراضية (الإدارة تعدل الأسعار والمدد لاحقاً من اللوحة)
INSERT INTO public.vip_tiers (tier, name_ar, duration_days, price_coins, frame, badge, entry_effect)
VALUES
  (1,  'VIP 1',  30, 3000,  'vip_frame_1',  'vip_badge_1',  'vip_entry_1'),
  (2,  'VIP 2',  30, 6000,  'vip_frame_2',  'vip_badge_2',  'vip_entry_2'),
  (3,  'VIP 3',  30, 9000,  'vip_frame_3',  'vip_badge_3',  'vip_entry_3'),
  (4,  'VIP 4',  30, 12000, 'vip_frame_4',  'vip_badge_4',  'vip_entry_4'),
  (5,  'VIP 5',  30, 15000, 'vip_frame_5',  'vip_badge_5',  'vip_entry_5'),
  (6,  'VIP 6',  30, 18000, 'vip_frame_6',  'vip_badge_6',  'vip_entry_6'),
  (7,  'VIP 7',  30, 21000, 'vip_frame_7',  'vip_badge_7',  'vip_entry_7'),
  (8,  'VIP 8',  30, 24000, 'vip_frame_8',  'vip_badge_8',  'vip_entry_8'),
  (9,  'VIP 9',  30, 27000, 'vip_frame_9',  'vip_badge_9',  'vip_entry_9'),
  (10, 'VIP 10', 30, 30000, 'vip_frame_10', 'vip_badge_10', 'vip_entry_10')
ON CONFLICT (tier) DO NOTHING;

-- ============================================================
-- 2) جدول الاشتراكات (صف لكل عملية شراء/ترقية/تجديد)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.vip_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  tier integer NOT NULL REFERENCES public.vip_tiers(tier) ON DELETE RESTRICT,
  purchase_kind text NOT NULL CHECK (purchase_kind IN ('initial', 'upgrade', 'renewal')),
  duration_days integer NOT NULL CHECK (duration_days BETWEEN 1 AND 3650),
  price_coins_paid bigint NOT NULL CHECK (price_coins_paid >= 0),
  discount_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 90),
  paid_coins bigint NOT NULL CHECK (paid_coins >= 0),
  upgrade_credit_coins bigint NOT NULL DEFAULT 0 CHECK (upgrade_credit_coins >= 0),
  previous_tier integer,
  starts_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded')),
  wallet_transaction_id uuid REFERENCES public.wallet_transactions(id) ON DELETE RESTRICT,
  idempotency_key varchar(80) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vip_subscription_period_valid CHECK (expires_at > starts_at),
  CONSTRAINT vip_subscription_idempotency UNIQUE (user_id, idempotency_key),
  CONSTRAINT vip_subscription_paid_consistency CHECK (paid_coins <= price_coins_paid)
);
CREATE INDEX IF NOT EXISTS vip_subscriptions_user_created
  ON public.vip_subscriptions (user_id, created_at DESC);

ALTER TABLE public.vip_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vip_subscriptions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.vip_subscriptions TO authenticated, service_role;

DROP POLICY IF EXISTS vip_subscriptions_owner_admin_select ON public.vip_subscriptions;
CREATE POLICY vip_subscriptions_owner_admin_select ON public.vip_subscriptions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

-- ============================================================
-- 3) إعدادات
-- ============================================================
INSERT INTO public.admin_settings (key, value, description, is_public)
VALUES
  ('vip_purchase_enabled', 'true'::jsonb, 'السماح بشراء وترقية وتجديد درجات VIP', true)
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 4) كتالوج الدرجات للعامة (بسعر العرض الفعّال)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_public_vip_tiers()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN coalesce(jsonb_agg(
    jsonb_build_object(
      'tier', t.tier,
      'name_ar', t.name_ar,
      'duration_days', t.duration_days,
      'price_coins', t.price_coins,
      'frame', t.frame,
      'badge', t.badge,
      'entry_effect', t.entry_effect,
      'perks', t.perks,
      'room_kick_protection', t.room_kick_protection,
      'offer_discount_percent', t.offer_discount_percent,
      'offer_active', t.offer_ends_at IS NOT NULL AND t.offer_ends_at >= now() AND t.offer_discount_percent > 0,
      'effective_price_coins', CASE
        WHEN t.offer_ends_at IS NOT NULL AND t.offer_ends_at >= now() AND t.offer_discount_percent > 0
        THEN round(t.price_coins * (1 - t.offer_discount_percent / 100.0))
        ELSE t.price_coins
      END,
      'offer_ends_at', t.offer_ends_at
    ) ORDER BY t.tier
  ), '[]'::jsonb)
  FROM public.vip_tiers t
  WHERE t.is_active;
END;
$$;
REVOKE ALL ON FUNCTION public.get_public_vip_tiers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_public_vip_tiers() TO anon, authenticated, service_role;

-- ============================================================
-- 5) درجة VIP النشطة لحساب ما (تُستخدم في الغرف لاحقاً وفي التطبيق)
-- ============================================================
CREATE OR REPLACE FUNCTION public.active_vip_tier(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tier integer;
BEGIN
  IF p_user_id IS NULL THEN RETURN NULL; END IF;
  SELECT s.tier INTO v_tier
  FROM public.vip_subscriptions s
  WHERE s.user_id = p_user_id AND s.status = 'active'
    AND s.starts_at <= now() AND s.expires_at > now()
  ORDER BY s.created_at DESC
  LIMIT 1;
  RETURN v_tier;
END;
$$;
REVOKE ALL ON FUNCTION public.active_vip_tier(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.active_vip_tier(uuid) TO authenticated, service_role;

-- ============================================================
-- 6) حالة VIP للتطبيق
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_my_vip()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_sub public.vip_subscriptions%ROWTYPE;
  v_tier public.vip_tiers%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT * INTO v_sub
  FROM public.vip_subscriptions s
  WHERE s.user_id = v_uid AND s.status = 'active'
    AND s.starts_at <= now() AND s.expires_at > now()
  ORDER BY s.created_at DESC
  LIMIT 1;
  IF FOUND THEN
    SELECT * INTO v_tier FROM public.vip_tiers t WHERE t.tier = v_sub.tier;
    RETURN jsonb_build_object(
      'active', true,
      'tier', v_sub.tier,
      'name_ar', v_tier.name_ar,
      'frame', v_tier.frame,
      'badge', v_tier.badge,
      'entry_effect', v_tier.entry_effect,
      'perks', v_tier.perks,
      'room_kick_protection', v_tier.room_kick_protection,
      'starts_at', v_sub.starts_at,
      'expires_at', v_sub.expires_at,
      'days_remaining', greatest(0, ceil(extract(epoch FROM (v_sub.expires_at - now())) / 86400.0)),
      'purchase_kind', v_sub.purchase_kind
    );
  END IF;

  RETURN jsonb_build_object('active', false, 'tier', NULL, 'name_ar', NULL,
    'frame', NULL, 'badge', NULL, 'entry_effect', NULL, 'perks', '[]'::jsonb,
    'room_kick_protection', false, 'starts_at', NULL, 'expires_at', NULL,
    'days_remaining', 0, 'purchase_kind', NULL);
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_vip() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_vip() TO authenticated, service_role;

-- ============================================================
-- 7) تنفيذ الشراء/الترقية/التجديد — من Edge بـ service_role فقط
-- ============================================================
CREATE OR REPLACE FUNCTION public.settle_vip_purchase(
  p_user_id uuid,
  p_tier integer,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_key text := btrim(coalesce(p_idempotency_key, ''));
  v_enabled boolean := true;
  v_rate numeric(14,6) := 3000;
  v_tier public.vip_tiers%ROWTYPE;
  v_user public.users%ROWTYPE;
  v_existing public.vip_subscriptions%ROWTYPE;
  v_current public.vip_subscriptions%ROWTYPE;
  v_discount numeric(5,2) := 0;
  v_price bigint;
  v_paid bigint;
  v_credit bigint := 0;
  v_due bigint;
  v_kind text;
  v_start timestamptz;
  v_expire timestamptz;
  v_tx uuid;
  v_usd numeric(14,4);
  v_new public.vip_subscriptions%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_user_id IS NULL OR p_tier IS NULL
     OR p_tier NOT BETWEEN 1 AND 10
     OR length(v_key) NOT BETWEEN 10 AND 80 THEN
    RAISE EXCEPTION 'طلب VIP غير صالح';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('vip-purchase:' || p_user_id::text));

  -- إلغاء التفعيل عبر الإعدادات
  SELECT coalesce((s.value #>> '{}')::boolean, true) INTO v_enabled
  FROM public.admin_settings s WHERE s.key = 'vip_purchase_enabled';
  IF NOT coalesce(v_enabled, true) THEN
    RAISE EXCEPTION 'شراء VIP متوقف مؤقتاً';
  END IF;

  -- ازدواجية المفتاح
  SELECT * INTO v_existing FROM public.vip_subscriptions
  WHERE user_id = p_user_id AND idempotency_key = v_key FOR UPDATE;
  IF FOUND THEN
    IF v_existing.tier <> p_tier THEN
      RAISE EXCEPTION 'مفتاح العملية مستخدم مسبقاً بدرجة مختلفة';
    END IF;
    RETURN to_jsonb(v_existing);
  END IF;

  SELECT * INTO v_user FROM public.users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND OR v_user.status <> 'active' THEN
    RAISE EXCEPTION 'الحساب غير متاح';
  END IF;

  SELECT * INTO v_tier FROM public.vip_tiers WHERE tier = p_tier FOR UPDATE;
  IF NOT FOUND OR NOT v_tier.is_active THEN
    RAISE EXCEPTION 'درجة VIP غير متوفرة حالياً';
  END IF;

  -- الخصم إن كان عرضاً سارياً
  IF v_tier.offer_ends_at IS NOT NULL AND v_tier.offer_ends_at >= now()
     AND v_tier.offer_discount_percent > 0 THEN
    v_discount := v_tier.offer_discount_percent;
  END IF;
  v_price := v_tier.price_coins;
  v_paid := round(v_price * (1 - v_discount / 100.0));

  -- أحدث اشتراك نشط (يشمل التجديد المؤجل) هو مرجع القرار
  SELECT * INTO v_current FROM public.vip_subscriptions
  WHERE user_id = p_user_id AND status = 'active'
  ORDER BY created_at DESC LIMIT 1 FOR UPDATE;

  IF NOT FOUND THEN
    v_kind := 'initial';
    v_due := v_paid;
    v_start := now();
    v_expire := v_start + make_interval(days => v_tier.duration_days);
  ELSIF v_current.tier = p_tier THEN
    -- تجديد: صف جديد يبدأ من نهاية الصف السابق (يظل الأصلي نشطاً حتى
    -- انتهائه، فلا يفقد المستخدم تغطيته بين الآن وتاريخ انتهائه).
    -- إذا كان الصف الأخير تجديداً مؤجلاً لم يبدأ بعد، يُستبدل بسلسلة أحدث.
    v_kind := 'renewal';
    v_due := v_paid;
    v_start := v_current.expires_at;
    v_expire := v_start + make_interval(days => v_tier.duration_days);
    IF v_current.starts_at > now() THEN
      UPDATE public.vip_subscriptions
      SET status = 'superseded' WHERE id = v_current.id;
    END IF;
  ELSIF v_current.tier < p_tier THEN
    -- ترقية: قيمة المدة المتبقية من الصف الحالي تُخصم من سعر الدرجة الأعلى.
    -- الصف المؤجَل لم يبدأ بعد فيُحتسب رصيده كاملاً.
    v_kind := 'upgrade';
    v_credit := floor(
      v_current.price_coins_paid
      * greatest(0, extract(epoch FROM (v_current.expires_at - now())))
      / greatest(1, (v_current.duration_days * 86400.0))
    )::bigint;
    v_credit := least(v_credit, v_current.price_coins_paid, v_paid);
    v_due := greatest(0, v_paid - v_credit);
    v_start := now();
    v_expire := v_start + make_interval(days => v_tier.duration_days);
    UPDATE public.vip_subscriptions
    SET status = 'superseded' WHERE id = v_current.id;
  ELSE
    RAISE EXCEPTION 'لديك اشتراك أعلى نشط؛ لا يمكن شراء درجة أقل الآن';
  END IF;

  IF v_due > 0 THEN
    v_tx := public.record_wallet_transaction(
      p_user_id,
      'vip_purchase'::public.wallet_tx_type,
      -v_due,
      'gold',
      NULL,
      v_key,
      'vip_subscription',
      NULL,
      jsonb_build_object(
        'tier', v_tier.tier,
        'kind', v_kind,
        'list_price', v_price,
        'discount_percent', v_discount,
        'upgrade_credit', v_credit
      ),
      'vip-purchase',
      'شراء/ترقية VIP ' || v_tier.tier
    );
    SELECT coalesce((s.value #>> '{}')::numeric, 3000) INTO v_rate
    FROM public.admin_settings s WHERE s.key = 'paid_coins_per_usd';
    v_usd := round(v_due / greatest(v_rate, 1), 4);
    PERFORM public.credit_revenue(
      'platform:main', 'usd', v_usd, v_usd,
      'إيراد VIP ' || v_tier.tier || ' (' || v_kind || ')',
      'wallet_transaction', v_tx, v_tx, 'vip-purchase'
    );
  END IF;

  INSERT INTO public.vip_subscriptions (
    user_id, tier, purchase_kind, duration_days,
    price_coins_paid, discount_percent, paid_coins, upgrade_credit_coins,
    previous_tier, starts_at, expires_at, wallet_transaction_id, idempotency_key
  ) VALUES (
    p_user_id, p_tier, v_kind, v_tier.duration_days,
    v_price, v_discount, v_due, v_credit,
    CASE WHEN v_kind = 'upgrade' THEN v_current.tier ELSE NULL END,
    v_start, v_expire, v_tx, v_key
  ) RETURNING * INTO v_new;

  INSERT INTO public.user_notifications (
    user_id, actor_id, event_type, reference_id, title, body, route
  ) VALUES (
    p_user_id, NULL, 'vip_purchase', v_new.id,
    'تم تفعيل ' || v_tier.name_ar,
    CASE v_kind
      WHEN 'upgrade' THEN 'ترقية ناجحة — القيمة المتبقية من اشتراكك السابق خُصمت من السعر. ينتهي الاشتراك في ' || to_char(v_expire, 'YYYY-MM-DD') || '.'
      WHEN 'renewal' THEN 'تم تجديد اشتراكك حتى ' || to_char(v_expire, 'YYYY-MM-DD') || '.'
      ELSE 'مفعّل حتى ' || to_char(v_expire, 'YYYY-MM-DD') || '.'
    END,
    '/membership'
  );

  RETURN to_jsonb(v_new);
END;
$$;
REVOKE ALL ON FUNCTION public.settle_vip_purchase(uuid, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_vip_purchase(uuid, integer, text) TO service_role;

-- ============================================================
-- 8) إدارة الدرجات من اللوحة
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_upsert_vip_tier(
  p_admin_id uuid,
  p_tier integer,
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
  v_before public.vip_tiers%ROWTYPE;
  v_after public.vip_tiers%ROWTYPE;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_name text := btrim(coalesce(p_payload->>'name_ar', ''));
  v_duration integer := (p_payload->>'duration_days')::integer;
  v_price bigint := (p_payload->>'price_coins')::bigint;
  v_active boolean := coalesce((p_payload->>'is_active')::boolean, true);
  v_frame text := nullif(btrim(coalesce(p_payload->>'frame', '')), '');
  v_badge text := nullif(btrim(coalesce(p_payload->>'badge', '')), '');
  v_effect text := nullif(btrim(coalesce(p_payload->>'entry_effect', '')), '');
  v_perks jsonb := coalesce(p_payload->'perks', '[]'::jsonb);
  v_kick boolean := coalesce((p_payload->>'room_kick_protection')::boolean, false);
  v_discount numeric(5,2) := coalesce((p_payload->>'offer_discount_percent')::numeric, 0);
  v_offer_ends timestamptz := nullif(coalesce(p_payload->>'offer_ends_at', ''), '')::timestamptz;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_admin_id
       OR NOT public.admin_staff_can(p_admin_id, 'vip.manage') THEN
      RAISE EXCEPTION 'غير مصرح بإدارة درجات VIP';
    END IF;
  END IF;
  IF p_admin_id IS NULL OR p_tier IS NULL OR p_tier NOT BETWEEN 1 AND 10
     OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
     OR char_length(v_name) NOT BETWEEN 2 AND 40
     OR v_duration IS NULL OR v_duration NOT BETWEEN 1 AND 3650
     OR v_price IS NULL OR v_price NOT BETWEEN 1 AND 10000000
     OR v_discount NOT BETWEEN 0 AND 90
     OR jsonb_typeof(v_perks) <> 'array' OR jsonb_array_length(v_perks) > 12 THEN
    RAISE EXCEPTION 'بيانات الدرجة غير صالحة';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_perks) p
    WHERE jsonb_typeof(p) <> 'string' OR char_length(p #>> '{}') > 160
  ) THEN
    RAISE EXCEPTION 'قائمة المزايا غير صالحة';
  END IF;
  IF v_reason IS NULL OR char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'أدخل سبباً لا يتجاوز 500 حرف';
  END IF;

  SELECT * INTO v_admin FROM public.users WHERE id = p_admin_id FOR UPDATE;
  IF NOT FOUND OR v_admin.status <> 'active' OR v_admin.role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'الحساب الإداري غير نشط';
  END IF;

  IF v_frame IS NOT NULL AND char_length(v_frame) > 60 THEN
    RAISE EXCEPTION 'مفتاح الإطار غير صالح';
  END IF;
  IF v_badge IS NOT NULL AND char_length(v_badge) > 60 THEN
    RAISE EXCEPTION 'مفتاح الشارة غير صالح';
  END IF;
  IF v_effect IS NOT NULL AND char_length(v_effect) > 60 THEN
    RAISE EXCEPTION 'مفتاح تأثير الدخول غير صالح';
  END IF;

  SELECT * INTO v_before FROM public.vip_tiers WHERE tier = p_tier FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الدرجة غير موجودة (١–١٠)';
  END IF;

  UPDATE public.vip_tiers
  SET name_ar = v_name,
      duration_days = v_duration,
      price_coins = v_price,
      frame = v_frame,
      badge = v_badge,
      entry_effect = v_effect,
      perks = v_perks,
      room_kick_protection = v_kick,
      offer_discount_percent = v_discount,
      offer_ends_at = v_offer_ends,
      is_active = v_active,
      updated_by = p_admin_id,
      updated_at = now()
  WHERE tier = p_tier
  RETURNING * INTO v_after;

  INSERT INTO public.admin_audit_log (
    admin_id, action, target_type, target_id, before, after, metadata
  ) VALUES (
    p_admin_id, 'update'::public.audit_action_type, 'vip_tier', v_after.tier,
    to_jsonb(v_before), to_jsonb(v_after),
    jsonb_build_object('reason', v_reason)
  );

  RETURN to_jsonb(v_after);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_upsert_vip_tier(uuid, integer, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_upsert_vip_tier(uuid, integer, jsonb, text) TO authenticated, service_role;

-- ============================================================
-- 9) تجميد المسار القديم (العضوياتCoin الفارغة) وتوثيق الاستبدال
--    الجداول تبقى للأرشيف دون أي مسار نشط عليها.
-- ============================================================
UPDATE public.membership_plans SET is_active = false WHERE is_active;

REVOKE EXECUTE ON FUNCTION public.purchase_membership(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_membership(uuid, text) TO service_role;

COMMIT;
