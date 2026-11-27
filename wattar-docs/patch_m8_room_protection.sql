-- ============================================================
-- patch_m8_room_protection.sql  (Migration #76)
-- M8.5 + M8.6 — حماية VIP داخل الغرف + أدوات الحماية المدفوعة (القسمان 16/17)
--   * منتجات حماية منفصلة عن VIP وLV: مانع طرد / مانع حظر، بشراء دائم
--     أو اشتراك أو باقات، بأسعار إدارية وكتالوج عام.
--   * شراء بالكوين حصراً عبر Edge + settle (service_role) بإيراد زوجي.
--   * التعليق داخل room_manage_action: مالك الغرفة ومشرفوها لا يمكنهم
--     تجاوز الحماية الممنوحة (VIP بحماية الغرف، أو مانع طرد/حظر مدفوع)؛
--     الوكالة تتدخل ضمن صلاحياتها، والإدارة تتدخل بالكامل، والعقوبات
--     الأمنية ومكافحة الإساءة (مسارات الإدارة) تتجاوز هذه الامتيازات.
--   * لا حماية من مخالفات جسيمة: قرار الإدارة خارج هذا المسار دائماً.
-- يعتمد على: patch_m8_enum_prep.sql ('protection_purchase')، القسم 8 من #74
-- (صلاحيات protection.view/protection.manage)، توسيع أنواع الإشعارات، و#75.
-- ============================================================
BEGIN;

-- ============================================================
-- 1) كتالوج منتجات الحماية
-- ============================================================
CREATE TABLE IF NOT EXISTS public.protection_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('anti_kick', 'anti_ban')),
  mode text NOT NULL CHECK (mode IN ('permanent', 'subscription', 'bundle')),
  name_ar text NOT NULL CHECK (char_length(btrim(name_ar)) BETWEEN 2 AND 60),
  price_coins bigint NOT NULL CHECK (price_coins BETWEEN 1 AND 10000000),
  duration_days integer,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT protection_product_duration CHECK (
    (mode = 'permanent' AND duration_days IS NULL)
    OR (mode IN ('subscription', 'bundle') AND duration_days BETWEEN 1 AND 3650)
  )
);

ALTER TABLE public.protection_products ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.protection_products FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.protection_products TO anon, authenticated, service_role;

DROP POLICY IF EXISTS protection_products_read ON public.protection_products;
CREATE POLICY protection_products_read ON public.protection_products
  FOR SELECT TO anon, authenticated
  USING (is_active OR public.is_admin());

-- منتجات افتراضية (الإدارة تعدل الأسعار من اللوحة) — بذر قابل لإعادة
-- التطبيق: لا قيد فريد على (kind, mode) لأن الإدارة قد تعدل الأنماط،
-- فنستخدم WHERE NOT EXISTS بدل ON CONFLICT.
INSERT INTO public.protection_products (kind, mode, name_ar, price_coins, duration_days)
SELECT v.kind, v.mode, v.name_ar, v.price, v.days
FROM (VALUES
  ('anti_kick', 'subscription', 'مانع طرد — اشتراك شهري', 5000::bigint, 30::int),
  ('anti_kick', 'permanent',    'مانع طرد — دائم',          40000::bigint, NULL::int),
  ('anti_ban',  'subscription', 'مانع حظر — اشتراك شهري',  5000::bigint, 30::int),
  ('anti_ban',  'permanent',    'مانع حظر — دائم',          40000::bigint, NULL::int)
) AS v(kind, mode, name_ar, price, days)
WHERE NOT EXISTS (
  SELECT 1 FROM public.protection_products p WHERE p.kind = v.kind AND p.mode = v.mode
);

-- ============================================================
-- 2) حمايات المستخدمين (صف واحد لكل نوع — الدائم expires_at = NULL)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.user_protections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('anti_kick', 'anti_ban')),
  product_id uuid NOT NULL REFERENCES public.protection_products(id) ON DELETE RESTRICT,
  expires_at timestamptz,
  wallet_transaction_id uuid REFERENCES public.wallet_transactions(id) ON DELETE RESTRICT,
  idempotency_key varchar(80) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_protections_idempotency UNIQUE (user_id, idempotency_key),
  CONSTRAINT user_protections_one_per_kind UNIQUE (user_id, kind)
);
CREATE INDEX IF NOT EXISTS user_protections_kind_active
  ON public.user_protections (kind, expires_at) WHERE expires_at IS NOT NULL;

ALTER TABLE public.user_protections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_protections FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.user_protections TO authenticated, service_role;

DROP POLICY IF EXISTS user_protections_owner_admin_select ON public.user_protections;
CREATE POLICY user_protections_owner_admin_select ON public.user_protections
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

-- ============================================================
-- 3) إعدادات
-- (نفس ملاحظة #75: زناد التدقيق على admin_settings يشترط جلسة مسؤول —
--  ننحّي الجلسة مؤقتاً إلى service_role عبر الادعاءات ثم نعيدها)
-- ============================================================
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
INSERT INTO public.admin_settings (key, value, description, is_public)
VALUES
  ('protection_purchase_enabled', 'true'::jsonb, 'السماح بشراء أدوات الحماية المدفوعة', true)
ON CONFLICT (key) DO NOTHING;
SELECT set_config('request.jwt.claims', '', true);

-- ============================================================
-- 4) الكتالوج العام
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_public_protection_products()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'id', p.id,
      'kind', p.kind,
      'mode', p.mode,
      'name_ar', p.name_ar,
      'price_coins', p.price_coins,
      'duration_days', p.duration_days
    ) ORDER BY p.kind, p.price_coins
  ), '[]'::jsonb)
  FROM public.protection_products p
  WHERE p.is_active;
$$;
REVOKE ALL ON FUNCTION public.get_public_protection_products() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_public_protection_products() TO anon, authenticated, service_role;

-- ============================================================
-- 5) حماياتي للتطبيق
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_my_protections()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  RETURN coalesce(jsonb_agg(
    jsonb_build_object(
      'kind', u.kind,
      'name_ar', p.name_ar,
      'permanent', u.expires_at IS NULL,
      'expires_at', u.expires_at,
      'active', u.expires_at IS NULL OR u.expires_at > now()
    ) ORDER BY u.kind
  ), '[]'::jsonb)
  FROM public.user_protections u
  JOIN public.protection_products p ON p.id = u.product_id
  WHERE u.user_id = v_uid;
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_protections() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_protections() TO authenticated, service_role;

-- ============================================================
-- 6) تنفيذ الشراء — من Edge بـ service_role فقط
-- ============================================================
CREATE OR REPLACE FUNCTION public.settle_protection_purchase(
  p_user_id uuid,
  p_product_id uuid,
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
  v_product public.protection_products%ROWTYPE;
  v_user public.users%ROWTYPE;
  v_existing public.user_protections%ROWTYPE;
  v_old_expiry timestamptz;
  v_new_expiry timestamptz;
  v_tx uuid;
  v_usd numeric(14,4);
  v_result public.user_protections%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_user_id IS NULL OR p_product_id IS NULL
     OR length(v_key) NOT BETWEEN 10 AND 80 THEN
    RAISE EXCEPTION 'طلب حماية غير صالح';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('protection-purchase:' || p_user_id::text));

  SELECT coalesce((s.value #>> '{}')::boolean, true) INTO v_enabled
  FROM public.admin_settings s WHERE s.key = 'protection_purchase_enabled';
  IF NOT coalesce(v_enabled, true) THEN
    RAISE EXCEPTION 'شراء الحمايات متوقف مؤقتاً';
  END IF;

  -- ازدواجية المفتاح
  SELECT * INTO v_existing FROM public.user_protections
  WHERE user_id = p_user_id AND idempotency_key = v_key FOR UPDATE;
  IF FOUND THEN
    IF v_existing.product_id <> p_product_id THEN
      RAISE EXCEPTION 'مفتاح العملية مستخدم مسبقاً بمنتج مختلف';
    END IF;
    RETURN to_jsonb(v_existing);
  END IF;

  SELECT * INTO v_user FROM public.users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND OR v_user.status <> 'active' THEN
    RAISE EXCEPTION 'الحساب غير متاح';
  END IF;

  SELECT * INTO v_product FROM public.protection_products
  WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND OR NOT v_product.is_active THEN
    RAISE EXCEPTION 'منتج الحماية غير متوفر حالياً';
  END IF;

  SELECT * INTO v_existing FROM public.user_protections
  WHERE user_id = p_user_id AND kind = v_product.kind FOR UPDATE;
  v_old_expiry := v_existing.expires_at;

  IF v_product.mode = 'permanent' AND v_existing.expires_at IS NULL THEN
    RAISE EXCEPTION 'لديك حماية دائمة من هذا النوع بالفعل';
  END IF;

  -- المدّة: الدائم بلا نهاية؛ الاشتراك/الباقة تمتد من بقايا المدة الحالية
  v_new_expiry := CASE
    WHEN v_product.mode = 'permanent' THEN NULL
    ELSE greatest(coalesce(v_old_expiry, now()), now())
         + make_interval(days => v_product.duration_days)
  END;

  v_tx := public.record_wallet_transaction(
    p_user_id,
    'protection_purchase'::public.wallet_tx_type,
    -v_product.price_coins,
    'gold',
    NULL,
    v_key,
    'user_protection',
    NULL,
    jsonb_build_object(
      'kind', v_product.kind,
      'mode', v_product.mode,
      'previous_expiry', v_old_expiry
    ),
    'protection-purchase',
    'شراء ' || v_product.name_ar
  );
  SELECT coalesce((s.value #>> '{}')::numeric, 3000) INTO v_rate
  FROM public.admin_settings s WHERE s.key = 'paid_coins_per_usd';
  v_usd := round(v_product.price_coins / greatest(v_rate, 1), 4);
  PERFORM public.credit_revenue(
    'platform:main', 'usd', v_usd, v_usd,
    'إيراد حماية مدفوعة (' || v_product.kind || ')',
    'wallet_transaction', v_tx, v_tx, 'protection-purchase'
  );

  INSERT INTO public.user_protections (
    user_id, kind, product_id, expires_at, wallet_transaction_id, idempotency_key
  ) VALUES (
    p_user_id, v_product.kind, v_product.id, v_new_expiry, v_tx, v_key
  )
  ON CONFLICT (user_id, kind) DO UPDATE
    SET product_id = EXCLUDED.product_id,
        expires_at = EXCLUDED.expires_at,
        wallet_transaction_id = EXCLUDED.wallet_transaction_id,
        idempotency_key = EXCLUDED.idempotency_key,
        updated_at = now()
  RETURNING * INTO v_result;

  INSERT INTO public.user_notifications (
    user_id, actor_id, event_type, reference_id, title, body, route
  ) VALUES (
    p_user_id, NULL, 'protection_purchase', v_result.id,
    'تم تفعيل ' || v_product.name_ar,
    CASE
      WHEN v_new_expiry IS NULL THEN 'حماية دائمة من ' ||
        CASE v_product.kind WHEN 'anti_kick' THEN 'الطرد' ELSE 'الحظر' END
        || ' داخل الغرف — لا تشمل قرار الإدارة والمخالفات الجسيمة.'
      ELSE 'سارية حتى ' || to_char(v_new_expiry, 'YYYY-MM-DD')
        || ' — لا تشمل قرار الإدارة والمخالفات الجسيمة.'
    END,
    '/protection'
  )
  -- تمديد/ترقية الحماية يعيد الصف نفسه فتتعارض (user,event,reference) —
  -- نحدّث الإشعار القائم بآخر حالة بدل رفض العملية.
  ON CONFLICT (user_id, event_type, reference_id) DO UPDATE
    SET title = EXCLUDED.title,
        body = EXCLUDED.body,
        read_at = NULL,
        created_at = now();

  RETURN to_jsonb(v_result);
END;
$$;
REVOKE ALL ON FUNCTION public.settle_protection_purchase(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_protection_purchase(uuid, uuid, text)
  TO service_role;

-- ============================================================
-- 7) إدارة المنتجات من اللوحة
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_upsert_protection_product(
  p_admin_id uuid,
  p_product_id uuid,
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
  v_before public.protection_products%ROWTYPE;
  v_after public.protection_products%ROWTYPE;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_kind text := p_payload->>'kind';
  v_mode text := p_payload->>'mode';
  v_name text := btrim(coalesce(p_payload->>'name_ar', ''));
  v_price bigint := (p_payload->>'price_coins')::bigint;
  v_days integer := (p_payload->>'duration_days')::integer;
  v_active boolean := coalesce((p_payload->>'is_active')::boolean, true);
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_admin_id
       OR NOT public.admin_staff_can(p_admin_id, 'protection.manage') THEN
      RAISE EXCEPTION 'غير مصرح بإدارة منتجات الحماية';
    END IF;
  END IF;
  IF p_admin_id IS NULL OR p_product_id IS NULL OR p_payload IS NULL
     OR jsonb_typeof(p_payload) <> 'object'
     OR v_kind NOT IN ('anti_kick', 'anti_ban')
     OR v_mode NOT IN ('permanent', 'subscription', 'bundle')
     OR char_length(v_name) NOT BETWEEN 2 AND 60
     OR v_price IS NULL OR v_price NOT BETWEEN 1 AND 10000000 THEN
    RAISE EXCEPTION 'بيانات المنتج غير صالحة';
  END IF;
  IF (v_mode = 'permanent' AND v_days IS NOT NULL)
     OR (v_mode IN ('subscription', 'bundle')
         AND (v_days IS NULL OR v_days NOT BETWEEN 1 AND 3650)) THEN
    RAISE EXCEPTION 'المدة غير متوافقة مع نوع الشراء';
  END IF;
  IF v_reason IS NULL OR char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'أدخل سبباً لا يتجاوز 500 حرف';
  END IF;

  SELECT * INTO v_admin FROM public.users WHERE id = p_admin_id FOR UPDATE;
  IF NOT FOUND OR v_admin.status <> 'active'
     OR v_admin.role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'الحساب الإداري غير نشط';
  END IF;

  SELECT * INTO v_before FROM public.protection_products
  WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'المنتج غير موجود';
  END IF;

  UPDATE public.protection_products
  SET kind = v_kind,
      mode = v_mode,
      name_ar = v_name,
      price_coins = v_price,
      duration_days = v_days,
      is_active = v_active,
      updated_at = now()
  WHERE id = p_product_id
  RETURNING * INTO v_after;

  INSERT INTO public.admin_audit_log (
    admin_id, action, target_type, target_id, before, after, metadata
  ) VALUES (
    p_admin_id, 'update'::public.audit_action_type, 'protection_product',
    v_after.id, to_jsonb(v_before), to_jsonb(v_after),
    jsonb_build_object('reason', v_reason)
  );

  RETURN to_jsonb(v_after);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_upsert_protection_product(uuid, uuid, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_upsert_protection_product(uuid, uuid, jsonb, text)
  TO authenticated, service_role;

-- ============================================================
-- 8) سبب الحماية: NULL = مسموح، وإلا رسالة الرفض
-- تخص إدارة الغرفة فقط؛ الوكالة والإدارة يتجاوزانها بمسارَيهما.
-- ============================================================
CREATE OR REPLACE FUNCTION public.room_protection_block_reason(
  p_target uuid,
  p_action text
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_kind text := CASE WHEN p_action = 'kick_user' THEN 'anti_kick' ELSE 'anti_ban' END;
  v_verb text := CASE WHEN p_action = 'kick_user' THEN 'الطرد' ELSE 'الحظر' END;
BEGIN
  IF p_target IS NULL OR p_action NOT IN ('kick_user', 'ban_user') THEN
    RETURN NULL;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.vip_subscriptions s
    JOIN public.vip_tiers t ON t.tier = s.tier
    WHERE s.user_id = p_target
      AND s.status = 'active'
      AND s.starts_at <= now() AND s.expires_at > now()
      AND t.room_kick_protection
  ) THEN
    RETURN 'لا يمكن تنفيذ ' || v_verb || ': العضو محمي بامتياز VIP — لجأ للوكالة أو الإدارة عند الضرورة';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.user_protections u
    WHERE u.user_id = p_target
      AND u.kind = v_kind
      AND (u.expires_at IS NULL OR u.expires_at > now())
  ) THEN
    RETURN 'لا يمكن تنفيذ ' || v_verb || ': العضو يحمل مانع ' || v_verb || ' مدفوعاً — لجأ للوكالة أو الإدارة عند الضرورة';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.room_protection_block_reason(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.room_protection_block_reason(uuid, text)
  TO authenticated, service_role;

-- ============================================================
-- 9) room_manage_action — إعادة إنشاء مع تعليق الحماية (M8.5/M8.6)
-- الجسم مطابق لنسخة #6 الحية مع: متغير v_block + بوابة الحماية قبل
-- فرعي kick_user/ban_user مباشرة.
-- ============================================================
CREATE OR REPLACE FUNCTION public.room_manage_action(
  p_room_id uuid,
  p_actor_id uuid,
  p_action text,
  p_target_user_id uuid DEFAULT NULL,
  p_duration_minutes integer DEFAULT NULL,
  p_password text DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_role text;
  v_room public.rooms%ROWTYPE;
  v_target uuid;
  v_target_name text;
  v_actor_name text;
  v_expires timestamptz;
  v_rows integer;
  v_seat_id uuid;
  v_request room_seat_requests%ROWTYPE;
  v_reason text := NULLIF(btrim(coalesce(p_reason, '')), '');
  v_password text;
  v_new_owner uuid;
  v_claims text;
  v_block text;
BEGIN
  IF v_actor_id IS NULL OR p_actor_id IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'يجب تنفيذ الإجراء بهوية المستخدم المصادق عليها';
  END IF;
  IF v_reason IS NOT NULL AND char_length(v_reason) > 200 THEN
    RAISE EXCEPTION 'سبب الإجراء يجب ألا يتجاوز 200 حرف';
  END IF;

  IF p_action IS NULL OR p_action NOT IN (
    'close_room', 'reopen_room', 'lower_user', 'kick_user',
    'mute_mic', 'unmute_mic', 'mute_chat', 'unmute_chat',
    'ban_user', 'unban_user', 'lock_seats', 'unlock_seats',
    'mute_audience', 'unmute_audience', 'set_password', 'clear_password',
    'appoint_moderator', 'remove_moderator',
    'appoint_second_admin', 'remove_second_admin', 'handover_owner',
    'accept_seat_request', 'reject_seat_request'
  ) THEN
    RAISE EXCEPTION 'إجراء الغرفة غير صالح';
  END IF;

  IF p_action IN (
    'lower_user', 'kick_user', 'mute_mic', 'unmute_mic', 'mute_chat', 'unmute_chat',
    'ban_user', 'unban_user', 'appoint_moderator', 'remove_moderator',
    'appoint_second_admin', 'remove_second_admin', 'handover_owner',
    'accept_seat_request', 'reject_seat_request'
  ) THEN
    IF p_target_user_id IS NULL OR p_target_user_id = v_actor_id THEN
      RAISE EXCEPTION 'المستخدم المستهدف غير صالح';
    END IF;
  ELSE
    IF p_target_user_id IS NOT NULL THEN
      RAISE EXCEPTION 'هذا الإجراء لا يستهدف مستخدمًا';
    END IF;
  END IF;

  IF p_action = 'mute_chat'
     AND (p_duration_minutes IS NULL OR p_duration_minutes < 1 OR p_duration_minutes > 1440) THEN
    RAISE EXCEPTION 'مدة كتم المحادثة يجب أن تكون من دقيقة إلى 24 ساعة';
  END IF;
  IF p_action = 'ban_user'
     AND (p_duration_minutes IS NOT NULL AND (p_duration_minutes < 1 OR p_duration_minutes > 10080)) THEN
    RAISE EXCEPTION 'مدة الحظر يجب أن تكون من دقيقة إلى أسبوع أو دائمة';
  END IF;
  IF p_action NOT IN ('mute_chat', 'ban_user') AND p_duration_minutes IS NOT NULL THEN
    RAISE EXCEPTION 'لا تقبل هذه العملية مدة زمنية';
  END IF;
  IF p_action <> 'set_password' AND p_password IS NOT NULL THEN
    RAISE EXCEPTION 'لا تقبل هذه العملية كلمة مرور';
  END IF;

  SELECT * INTO v_room FROM public.rooms r WHERE r.id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الغرفة غير موجودة'; END IF;

  v_role := public.room_actor_role(p_room_id, v_actor_id);
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'لا تملك صلاحية إدارة هذه الغرفة';
  END IF;

  -- مالك الغرفة (ونادراً إدارة المنصة) فقط: المدير الثاني والنقل
  IF p_action IN ('appoint_second_admin', 'remove_second_admin', 'handover_owner')
     AND v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'تعيين المدير الثاني ونقل الإدارة متاحان لمالك الغرفة فقط';
  END IF;
  -- تعيين المشرفين: المالك أو المدير الثاني (أو إدارة المنصة)
  IF p_action IN ('appoint_moderator', 'remove_moderator')
     AND v_role NOT IN ('owner', 'second_admin', 'admin') THEN
    RAISE EXCEPTION 'إدارة المشرفين متاحة لمالك الغرفة أو المدير الثاني فقط';
  END IF;
  -- تدخل الوكالة: نطاق محدود بأفعال المتابعة فقط (القسم 9)
  IF v_role IN ('agency_manager', 'agency_agent') AND p_action NOT IN (
    'close_room', 'reopen_room', 'lower_user', 'kick_user',
    'mute_chat', 'unmute_chat', 'ban_user', 'unban_user'
  ) THEN
    RAISE EXCEPTION 'تدخل الوكالة يقتصر على إدارة الجلسة وضبط الأعضاء';
  END IF;

  SELECT coalesce(nullif(u.display_name, ''), u.username)::text INTO v_actor_name
  FROM public.users u WHERE u.id = v_actor_id;

  -- تنفيذ الإجراء بصلاحية الخدمة: زناد audit_admin_row_change على rooms يرفض
  -- تحديثات غير المالك، بينما صلاحية الفاعل حُققت أعلاه ويوثَّق سجلُّه أدناه.
  v_claims := current_setting('request.jwt.claims', true);
  IF v_claims IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
  END IF;

  ------------------------------------------------------------------
  -- أفعال على مستوى الغرفة (بلا هدف)
  ------------------------------------------------------------------
  IF p_action = 'close_room' THEN
    IF v_room.status = 'closed' THEN RAISE EXCEPTION 'الغرفة مغلقة بالفعل'; END IF;
    INSERT INTO public.room_messages (room_id, user_id, message, is_system)
    VALUES (p_room_id, v_actor_id, 'أغلق مالك الغرفة هذه الغرفة.', true);
    UPDATE public.room_seats
       SET user_id = NULL, status = 'empty', is_mic_on = false, joined_at = NULL, updated_at = now()
     WHERE room_id = p_room_id;
    DELETE FROM public.room_presence WHERE room_id = p_room_id;
    UPDATE public.room_seat_requests
       SET status = 'cancelled', decided_at = now()
     WHERE room_id = p_room_id AND status = 'pending';
    UPDATE public.rooms
       SET status = 'closed', ended_at = coalesce(ended_at, now()), updated_at = now()
     WHERE id = p_room_id;

  ELSIF p_action = 'reopen_room' THEN
    IF v_room.status <> 'closed' THEN RAISE EXCEPTION 'الغرفة مفتوحة بالفعل'; END IF;
    -- فتح الغرفة أولاً ثم إعادة مقعد المالك (زناد منع الجلوس في غرفة مغلقة)
    UPDATE public.rooms
       SET status = 'live', ended_at = NULL,
           started_at = coalesce(started_at, now()), updated_at = now()
     WHERE id = p_room_id;
    UPDATE public.room_seats
       SET user_id = v_room.owner_id, status = 'occupied', is_mic_on = false,
           joined_at = now(), updated_at = now()
     WHERE room_id = p_room_id AND seat_index = 0
       AND user_id IS NULL AND status = 'empty';
    INSERT INTO public.room_messages (room_id, user_id, message, is_system)
    VALUES (p_room_id, v_actor_id, 'أُعيد فتح الغرفة من جديد.', true);

  ELSIF p_action = 'lock_seats' THEN
    IF v_room.seats_locked THEN RAISE EXCEPTION 'المقاعد مقفلة بالفعل'; END IF;
    UPDATE public.rooms SET seats_locked = true, updated_at = now() WHERE id = p_room_id;
    INSERT INTO public.room_messages (room_id, user_id, message, is_system)
    VALUES (p_room_id, v_actor_id, 'قُفلت مقاعد الغرفة؛ الصعود يحتاج موافقة.', true);

  ELSIF p_action = 'unlock_seats' THEN
    IF NOT v_room.seats_locked THEN RAISE EXCEPTION 'المقاعد مفتوحة بالفعل'; END IF;
    UPDATE public.rooms SET seats_locked = false, updated_at = now() WHERE id = p_room_id;
    INSERT INTO public.room_messages (room_id, user_id, message, is_system)
    VALUES (p_room_id, v_actor_id, 'فُتحت مقاعد الغرفة للجميع.', true);

  ELSIF p_action = 'mute_audience' THEN
    IF v_room.audience_muted THEN RAISE EXCEPTION 'الجمهور مكتوم بالفعل'; END IF;
    UPDATE public.rooms SET audience_muted = true, updated_at = now() WHERE id = p_room_id;
    INSERT INTO public.room_messages (room_id, user_id, message, is_system)
    VALUES (p_room_id, v_actor_id, 'كُتمت محادثة الجمهور مؤقتًا.', true);

  ELSIF p_action = 'unmute_audience' THEN
    IF NOT v_room.audience_muted THEN RAISE EXCEPTION 'جمهور الغرفة غير مكتوم'; END IF;
    UPDATE public.rooms SET audience_muted = false, updated_at = now() WHERE id = p_room_id;
    INSERT INTO public.room_messages (room_id, user_id, message, is_system)
    VALUES (p_room_id, v_actor_id, 'فُتحت محادثة الجمهور.', true);

  ELSIF p_action = 'set_password' THEN
    v_password := NULLIF(btrim(coalesce(p_password, '')), '');
    IF v_password IS NULL OR char_length(v_password) < 4 OR char_length(v_password) > 50 THEN
      RAISE EXCEPTION 'كلمة مرور الغرفة يجب أن تكون من 4 إلى 50 حرفًا';
    END IF;
    INSERT INTO public.room_passwords (room_id, password_hash, updated_at, updated_by)
    VALUES (
      p_room_id,
      crypt(encode(digest(v_password, 'sha256'), 'hex'), gen_salt('bf', 10)),
      now(),
      v_actor_id
    )
    ON CONFLICT (room_id) DO UPDATE
      SET password_hash = EXCLUDED.password_hash,
          updated_at = now(),
          updated_by = EXCLUDED.updated_by;
    UPDATE public.rooms SET has_password = true, updated_at = now() WHERE id = p_room_id;
    INSERT INTO public.room_messages (room_id, user_id, message, is_system)
    VALUES (p_room_id, v_actor_id, 'حُدّثت كلمة مرور الغرفة.', true);

  ELSIF p_action = 'clear_password' THEN
    DELETE FROM public.room_passwords WHERE room_id = p_room_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN RAISE EXCEPTION 'لا توجد كلمة مرور على الغرفة'; END IF;
    UPDATE public.rooms SET has_password = false, updated_at = now() WHERE id = p_room_id;
    INSERT INTO public.room_messages (room_id, user_id, message, is_system)
    VALUES (p_room_id, v_actor_id, 'أُزيلت كلمة مرور الغرفة.', true);

  ------------------------------------------------------------------
  -- أفعال تستهدف مستخدمًا
  ------------------------------------------------------------------
  ELSE
    v_target := p_target_user_id;
    IF v_target = v_room.owner_id THEN
      RAISE EXCEPTION 'لا يمكن استهداف مالك الغرفة';
    END IF;
    IF v_target = v_room.second_admin_id
       AND p_action NOT IN ('handover_owner', 'remove_second_admin') THEN
      RAISE EXCEPTION 'لا يمكن استهداف المدير الثاني';
    END IF;
    IF v_role = 'moderator' AND EXISTS (
      SELECT 1 FROM public.room_moderators m
      WHERE m.room_id = p_room_id AND m.user_id = v_target
    ) THEN
      RAISE EXCEPTION 'لا يمكن لمشرف استهداف مشرف آخر';
    END IF;

    SELECT coalesce(nullif(u.display_name, ''), u.username)::text INTO v_target_name
    FROM public.users u WHERE u.id = v_target;
    IF NOT FOUND THEN RAISE EXCEPTION 'المستخدم المستهدف غير موجود'; END IF;

    IF p_action IN ('lower_user', 'kick_user', 'mute_mic', 'unmute_mic',
                    'ban_user', 'appoint_moderator', 'appoint_second_admin', 'handover_owner') THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.room_seats s
        WHERE s.room_id = p_room_id AND s.user_id = v_target AND s.status = 'occupied'
      ) AND NOT EXISTS (
        SELECT 1 FROM public.room_presence p
        WHERE p.room_id = p_room_id AND p.user_id = v_target
      ) AND NOT EXISTS (
        SELECT 1 FROM public.room_seat_requests q
        WHERE q.room_id = p_room_id AND q.user_id = v_target AND q.status = 'pending'
      ) THEN
        RAISE EXCEPTION 'المستخدم ليس في هذه الغرفة';
      END IF;
    END IF;

    -- M8.5/M8.6: حماية VIP والحماية المدفوعة من الطرد والحظر العادي —
    -- تخص إدارة الغرفة (مالك/مدير ثانٍ/مشرف)؛ الوكالة تتدخل ضمن صلاحياتها،
    -- والإدارة تتدخل بالكامل، والعقوبات الأمنية تتجاوز هذه الامتيازات.
    IF p_action IN ('kick_user', 'ban_user')
       AND v_role NOT IN ('admin', 'agency_manager', 'agency_agent') THEN
      v_block := public.room_protection_block_reason(v_target, p_action);
      IF v_block IS NOT NULL THEN
        RAISE EXCEPTION '%', v_block;
      END IF;
    END IF;

    IF p_action = 'lower_user' THEN
      UPDATE public.room_seats
         SET user_id = NULL, status = 'empty', is_mic_on = false, joined_at = NULL, updated_at = now()
       WHERE room_id = p_room_id AND user_id = v_target;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows = 0 THEN RAISE EXCEPTION 'المستخدم ليس على مقعد في هذه الغرفة'; END IF;
      INSERT INTO public.room_messages (room_id, user_id, message, is_system)
      VALUES (p_room_id, v_actor_id, 'أنزل ' || v_target_name || ' من المايك.', true);

    ELSIF p_action = 'kick_user' THEN
      UPDATE public.room_seats
         SET user_id = NULL, status = 'empty', is_mic_on = false, joined_at = NULL, updated_at = now()
       WHERE room_id = p_room_id AND user_id = v_target;
      DELETE FROM public.room_presence WHERE room_id = p_room_id AND user_id = v_target;
      UPDATE public.room_seat_requests
         SET status = 'cancelled', decided_at = now()
       WHERE room_id = p_room_id AND user_id = v_target AND status = 'pending';
      INSERT INTO public.room_messages (room_id, user_id, message, is_system)
      VALUES (p_room_id, v_actor_id, 'طُرد ' || v_target_name || ' من الغرفة.', true);

    ELSIF p_action = 'mute_mic' THEN
      UPDATE public.room_seats SET is_mic_on = false, updated_at = now()
       WHERE room_id = p_room_id AND user_id = v_target;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows = 0 THEN RAISE EXCEPTION 'المستخدم ليس على مقعد في هذه الغرفة'; END IF;
      INSERT INTO public.room_messages (room_id, user_id, message, is_system)
      VALUES (p_room_id, v_actor_id, 'كُتم مايك ' || v_target_name || '.', true);

    ELSIF p_action = 'unmute_mic' THEN
      UPDATE public.room_seats SET is_mic_on = true, updated_at = now()
       WHERE room_id = p_room_id AND user_id = v_target;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows = 0 THEN RAISE EXCEPTION 'المستخدم ليس على مقعد في هذه الغرفة'; END IF;
      INSERT INTO public.room_messages (room_id, user_id, message, is_system)
      VALUES (p_room_id, v_actor_id, 'فُتح مايك ' || v_target_name || '.', true);

    ELSIF p_action = 'mute_chat' THEN
      v_expires := now() + make_interval(mins => p_duration_minutes);
      INSERT INTO public.room_chat_mutes (room_id, user_id, muted_by, expires_at)
      VALUES (p_room_id, v_target, v_actor_id, v_expires)
      ON CONFLICT (room_id, user_id) DO UPDATE
        SET muted_by = EXCLUDED.muted_by,
            expires_at = EXCLUDED.expires_at,
            created_at = now();
      INSERT INTO public.room_messages (room_id, user_id, message, is_system)
      VALUES (p_room_id, v_actor_id, 'كُتمت محادثة ' || v_target_name
        || ' لمدة ' || p_duration_minutes::text || ' دقيقة.', true);

    ELSIF p_action = 'unmute_chat' THEN
      DELETE FROM public.room_chat_mutes
       WHERE room_id = p_room_id AND user_id = v_target;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows = 0 THEN RAISE EXCEPTION 'محادثة هذا المستخدم غير مكتومة'; END IF;
      INSERT INTO public.room_messages (room_id, user_id, message, is_system)
      VALUES (p_room_id, v_actor_id, 'أُلغي كتم محادثة ' || v_target_name || '.', true);

    ELSIF p_action = 'ban_user' THEN
      v_expires := CASE WHEN p_duration_minutes IS NULL
        THEN NULL ELSE now() + make_interval(mins => p_duration_minutes) END;
      UPDATE public.room_seats
         SET user_id = NULL, status = 'empty', is_mic_on = false, joined_at = NULL, updated_at = now()
       WHERE room_id = p_room_id AND user_id = v_target;
      DELETE FROM public.room_presence WHERE room_id = p_room_id AND user_id = v_target;
      UPDATE public.room_seat_requests
         SET status = 'cancelled', decided_at = now()
       WHERE room_id = p_room_id AND user_id = v_target AND status = 'pending';
      INSERT INTO public.room_bans (room_id, user_id, banned_by, reason, expires_at)
      VALUES (p_room_id, v_target, v_actor_id, v_reason, v_expires)
      ON CONFLICT (room_id, user_id) DO UPDATE
        SET banned_by = EXCLUDED.banned_by,
            reason = EXCLUDED.reason,
            expires_at = EXCLUDED.expires_at,
            created_at = now();
      INSERT INTO public.room_messages (room_id, user_id, message, is_system)
      VALUES (p_room_id, v_actor_id, 'حُظر ' || v_target_name || ' من الغرفة'
        || CASE WHEN v_expires IS NULL THEN '' ELSE ' مؤقتًا' END || '.', true);

    ELSIF p_action = 'unban_user' THEN
      DELETE FROM public.room_bans WHERE room_id = p_room_id AND user_id = v_target;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows = 0 THEN RAISE EXCEPTION 'هذا المستخدم غير محظور من الغرفة'; END IF;
      INSERT INTO public.room_messages (room_id, user_id, message, is_system)
      VALUES (p_room_id, v_actor_id, 'رُفع الحظر عن ' || v_target_name || '.', true);

    ELSIF p_action = 'appoint_moderator' THEN
      INSERT INTO public.room_moderators (room_id, user_id, granted_by)
      VALUES (p_room_id, v_target, v_actor_id)
      ON CONFLICT (room_id, user_id) DO NOTHING;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows = 0 THEN RAISE EXCEPTION 'هذا المستخدم مشرف بالفعل'; END IF;
      INSERT INTO public.room_messages (room_id, user_id, message, is_system)
      VALUES (p_room_id, v_actor_id, 'عُيّن ' || v_target_name || ' مشرفًا على الغرفة.', true);

    ELSIF p_action = 'remove_moderator' THEN
      DELETE FROM public.room_moderators WHERE room_id = p_room_id AND user_id = v_target;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows = 0 THEN RAISE EXCEPTION 'هذا المستخدم ليس مشرفًا على الغرفة'; END IF;
      INSERT INTO public.room_messages (room_id, user_id, message, is_system)
      VALUES (p_room_id, v_actor_id, 'أُزيل ' || v_target_name || ' من إشراف الغرفة.', true);

    ELSIF p_action = 'appoint_second_admin' THEN
      DELETE FROM public.room_moderators WHERE room_id = p_room_id AND user_id = v_target;
      UPDATE public.rooms
         SET second_admin_id = v_target, second_admin_at = now(), updated_at = now()
       WHERE id = p_room_id;
      INSERT INTO public.room_messages (room_id, user_id, message, is_system)
      VALUES (p_room_id, v_actor_id, 'عُيّن ' || v_target_name || ' مديرًا ثانيًا للغرفة.', true);

    ELSIF p_action = 'remove_second_admin' THEN
      IF v_room.second_admin_id IS NULL OR v_room.second_admin_id <> v_target THEN
        RAISE EXCEPTION 'هذا المستخدم ليس المدير الثاني';
      END IF;
      UPDATE public.rooms
         SET second_admin_id = NULL, second_admin_at = NULL, updated_at = now()
       WHERE id = p_room_id;
      INSERT INTO public.room_messages (room_id, user_id, message, is_system)
      VALUES (p_room_id, v_actor_id, 'أُلغيت صلاحيات المدير الثاني ' || v_target_name || '.', true);

    ELSIF p_action = 'handover_owner' THEN
      SELECT id INTO v_seat_id FROM public.users WHERE id = v_target AND status = 'active';
      IF NOT FOUND THEN RAISE EXCEPTION 'المستخدم المستهدف غير صالح'; END IF;
      v_new_owner := v_target;
      UPDATE public.room_seats
         SET user_id = NULL, status = 'empty', is_mic_on = false, joined_at = NULL, updated_at = now()
       WHERE room_id = p_room_id AND user_id = v_new_owner AND NOT is_owner_seat;
      UPDATE public.room_seats
         SET user_id = v_new_owner, status = 'occupied', is_mic_on = false,
             joined_at = now(), updated_at = now()
       WHERE room_id = p_room_id AND seat_index = 0;
      UPDATE public.rooms
         SET owner_id = v_new_owner,
             second_admin_id = CASE WHEN second_admin_id = v_new_owner THEN NULL ELSE second_admin_id END,
             second_admin_at = CASE WHEN second_admin_id = v_new_owner THEN NULL ELSE second_admin_at END,
             updated_at = now()
       WHERE id = p_room_id;
      DELETE FROM public.room_moderators WHERE room_id = p_room_id AND user_id = v_new_owner;
      INSERT INTO public.room_messages (room_id, user_id, message, is_system)
      VALUES (p_room_id, v_actor_id,
        'سلّم ' || coalesce(v_actor_name, 'المالك السابق') || ' إدارة الغرفة إلى ' || v_target_name || '.', true);

    ELSIF p_action = 'accept_seat_request' THEN
      SELECT * INTO v_request FROM public.room_seat_requests
      WHERE room_id = p_room_id AND user_id = v_target AND status = 'pending'
      FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'لا يوجد طلب صعود قائم لهذا المستخدم'; END IF;
      UPDATE public.room_seats
         SET user_id = v_target, status = 'occupied', is_mic_on = false,
             joined_at = now(), updated_at = now()
       WHERE id = (
         SELECT s.id FROM public.room_seats s
         WHERE s.room_id = p_room_id AND s.status = 'empty'
           AND s.user_id IS NULL AND NOT s.is_owner_seat
         ORDER BY s.seat_index
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       );
      IF NOT FOUND THEN RAISE EXCEPTION 'لا توجد مقاعد شاغرة'; END IF;
      UPDATE public.room_seat_requests
         SET status = 'accepted', decided_by = v_actor_id, decided_at = now()
       WHERE id = v_request.id;
      INSERT INTO public.room_messages (room_id, user_id, message, is_system)
      VALUES (p_room_id, v_actor_id, 'صعد ' || v_target_name || ' إلى المايك.', true);

    ELSIF p_action = 'reject_seat_request' THEN
      UPDATE public.room_seat_requests
         SET status = 'rejected', decided_by = v_actor_id, decided_at = now()
       WHERE room_id = p_room_id AND user_id = v_target AND status = 'pending';
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows = 0 THEN RAISE EXCEPTION 'لا يوجد طلب صعود قائم لهذا المستخدم'; END IF;
      INSERT INTO public.room_messages (room_id, user_id, message, is_system)
      VALUES (p_room_id, v_actor_id, 'رُفض طلب ' || v_target_name || ' للصعود.', true);
    END IF;
  END IF;

  -- استعادة هوية الجلسة الأصلية قبل التوثيق النهائي
  IF v_claims IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', v_claims, true);
  END IF;

  INSERT INTO public.room_moderation_audit (
    room_id, actor_id, target_user_id, action, duration_minutes, actor_role, reason
  ) VALUES (
    p_room_id, v_actor_id, p_target_user_id, p_action,
    CASE WHEN p_action IN ('mute_chat', 'ban_user') THEN p_duration_minutes ELSE NULL END,
    v_role, v_reason
  );

  RETURN jsonb_build_object(
    'room_id', p_room_id,
    'action', p_action,
    'target_user_id', p_target_user_id,
    'expires_at', v_expires,
    'actor_role', v_role
  );
END;
$$;
REVOKE ALL ON FUNCTION public.room_manage_action(uuid, uuid, text, uuid, integer, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.room_manage_action(uuid, uuid, text, uuid, integer, text, text)
  TO authenticated;

COMMIT;
