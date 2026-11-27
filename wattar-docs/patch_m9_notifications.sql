-- ============================================================
-- patch_m9_notifications.sql  (Migration #81)
-- M9.3 — الإشعارات: تحكم المستخدم بالأنواع + طابور دفع خادمي
--        بمنع تكرار + حملات إدارية + أنواع جديدة بلا تعديل كود
-- يعتمد على: user_notifications/push_tokens (patch_social_foundation)،
--             #69 RBAC، #75 VIP، #74 المضيفات، #77 LV.
-- ============================================================
BEGIN;

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- ============================================================
-- 1) كتالوج أنواع الإشعارات (مصدر واحد للتطبيق واللوحة والخادم)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.notification_type_catalog (
  event_type text PRIMARY KEY,
  category text NOT NULL CHECK (category IN ('social', 'messages', 'gifts', 'wallet', 'account', 'support', 'marketing')),
  label_ar text NOT NULL CHECK (char_length(btrim(label_ar)) BETWEEN 2 AND 80),
  description_ar text,
  push_default boolean NOT NULL DEFAULT true,
  in_app_default boolean NOT NULL DEFAULT true,
  can_disable_in_app boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.notification_type_catalog
  (event_type, category, label_ar, description_ar, push_default, in_app_default, can_disable_in_app, sort_order)
VALUES
  ('private_message',    'messages',  'الرسائل الخاصة',        'رسالة جديدة من عضو آخر',                true, true, true,  10),
  ('room_invitation',    'messages',  'دعوات الغرف',           'دعوة للانضمام إلى غرفة صوتية',          true, true, true,  20),
  ('friend_request',     'social',    'طلبات الصداقة',         'طلب صداقة جديد',                        true, true, true,  30),
  ('friend_accepted',    'social',    'قبول الصداقة',          'قبول طلب الصداقة',                      true, true, true,  40),
  ('new_follower',       'social',    'المتابعون الجدد',       'بدأ شخص بمتابعتك',                      true, true, true,  50),
  ('gift_received',      'gifts',     'الهدايا المستلمة',      'هدية وصلتك من عضو آخر',                 true, true, true,  60),
  ('level_up',           'account',   'ترقية المستوى',         'ارتفاع مستوى حسابك ومكافآته',           true, true, true,  70),
  ('loyalty_streak',     'account',   'الولاء اليومي',         'تذكير بسلسلة الأيام ونقاط الولاء',      true, true, true,  80),
  ('host_target',        'account',   'أهداف المضيفة',         'تحديث أهداف المضيفة الشهرية',           true, true, true,  90),
  ('membership_update',  'account',   'العضويات',              'تحديثات عضوية VIP القديمة',             true, true, false, 100),
  ('vip_purchase',       'account',   'شراء VIP',              'تفعيل أو تجديد أو ترقية درجة VIP',      true, true, false, 110),
  ('protection_purchase','account',   'الحمايات المدفوعة',     'شراء أو تمديد حماية الغرف',             true, true, false, 120),
  ('host_update',        'account',   'حالة المضيفة',          'تحديث توثيق أو حالة حساب المضيفة',      true, true, false, 130),
  ('host_status',        'account',   'حالة المضيفة',          'تغيير حالة توثيق المضيفة',              true, true, false, 140),
  ('host_application',   'account',   'طلبات التوثيق',         'تحديث طلب التوثيق كمضيفة',              true, true, false, 150),
  ('host_contract',      'account',   'عقود المضيفات',         'عقد جديد أو تحديث عقد',                 true, true, false, 160),
  ('host_earning',       'wallet',    'أرباح المضيفة',         'عمولة أو ربح أُضيف إلى رصيدك',           true, true, false, 170),
  ('deposit_update',     'wallet',    'طلبات الشحن',           'تحديث حالة طلب الشحن',                  true, true, false, 180),
  ('withdrawal_update',  'wallet',    'طلبات السحب',           'تحديث حالة طلب السحب',                  true, true, false, 190),
  ('support_reply',      'support',   'الدعم الفني',           'رد جديد من فريق الدعم',                 true, true, false, 200),
  ('moderation_penalty', 'support',   'العقوبات',              'عقوبة إشرافية على حسابك',               true, true, false, 210),
  ('moderation_appeal',  'support',   'الاعتراضات',            'تحديث اعتراضك على عقوبة',               true, true, false, 220),
  ('broadcast',          'marketing', 'إعلانات Wattar',        'رسائل وعروض عامة من الإدارة',           true, true, true,  230)
ON CONFLICT (event_type) DO UPDATE
  SET category = EXCLUDED.category,
      label_ar = EXCLUDED.label_ar,
      description_ar = EXCLUDED.description_ar,
      can_disable_in_app = EXCLUDED.can_disable_in_app,
      sort_order = EXCLUDED.sort_order,
      updated_at = now();

ALTER TABLE public.notification_type_catalog ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_type_catalog FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.notification_type_catalog TO anon, authenticated, service_role;

DROP POLICY IF EXISTS notification_type_catalog_public_select ON public.notification_type_catalog;
CREATE POLICY notification_type_catalog_public_select ON public.notification_type_catalog
  FOR SELECT TO anon, authenticated
  USING (is_active);

-- ============================================================
-- 2) تفضيلات المستخدم لكل نوع
-- ============================================================
CREATE TABLE IF NOT EXISTS public.user_notification_preferences (
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  event_type text NOT NULL REFERENCES public.notification_type_catalog(event_type) ON DELETE CASCADE,
  in_app boolean NOT NULL,
  push boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, event_type)
);

ALTER TABLE public.user_notification_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_notification_preferences FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.user_notification_preferences TO authenticated, service_role;

DROP POLICY IF EXISTS user_notification_preferences_select_own ON public.user_notification_preferences;
CREATE POLICY user_notification_preferences_select_own ON public.user_notification_preferences
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- هل الإشعار داخل التطبيق مفعّل لهذا النوع؟ (المصدر الوحيد للحقيقة)
CREATE OR REPLACE FUNCTION public.notification_in_app_enabled(p_user_id uuid, p_event_type text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(
    (SELECT p.in_app FROM public.user_notification_preferences p
      WHERE p.user_id = p_user_id AND p.event_type = p_event_type),
    (SELECT c.in_app_default FROM public.notification_type_catalog c
      WHERE c.event_type = p_event_type AND c.is_active),
    true
  );
$$;
REVOKE ALL ON FUNCTION public.notification_in_app_enabled(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notification_in_app_enabled(uuid, text) TO authenticated, service_role;

-- هل دفع الجوال مفعّل لهذا النوع؟ (النوع + التفضيل + المفتاح العام)
CREATE OR REPLACE FUNCTION public.notification_push_enabled(p_user_id uuid, p_event_type text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce((SELECT (s.value)::boolean FROM public.admin_settings s WHERE s.key = 'push_enabled'), true)
     AND coalesce(
       (SELECT p.push FROM public.user_notification_preferences p
         WHERE p.user_id = p_user_id AND p.event_type = p_event_type),
       (SELECT c.push_default FROM public.notification_type_catalog c
         WHERE c.event_type = p_event_type AND c.is_active),
       true
     );
$$;
REVOKE ALL ON FUNCTION public.notification_push_enabled(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notification_push_enabled(uuid, text) TO authenticated, service_role;

-- بوابة: إشعار داخل التطبيق يُحترم فيه تفضيل المستخدم (النوع الإلزامي لا يُعطَّل)
CREATE OR REPLACE FUNCTION public.gate_user_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.notification_in_app_enabled(NEW.user_id, NEW.event_type) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_notifications_gate ON public.user_notifications;
CREATE TRIGGER trg_user_notifications_gate
  BEFORE INSERT ON public.user_notifications
  FOR EACH ROW EXECUTE FUNCTION public.gate_user_notification();

CREATE OR REPLACE FUNCTION public.get_my_notification_preferences()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'event_type', c.event_type,
      'category', c.category,
      'label_ar', c.label_ar,
      'description_ar', c.description_ar,
      'can_disable_in_app', c.can_disable_in_app,
      'in_app', coalesce(p.in_app, c.in_app_default),
      'push', coalesce(p.push, c.push_default),
      'is_default', p.user_id IS NULL
    ) ORDER BY c.sort_order, c.event_type)
    FROM public.notification_type_catalog c
    LEFT JOIN public.user_notification_preferences p
      ON p.event_type = c.event_type AND p.user_id = auth.uid()
    WHERE c.is_active
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_notification_preferences() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_notification_preferences() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_my_notification_preference(
  p_event_type text,
  p_in_app boolean,
  p_push boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_type public.notification_type_catalog%ROWTYPE;
  v_in_app boolean;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF p_event_type IS NULL THEN RAISE EXCEPTION 'نوع الإشعار غير صالح'; END IF;
  SELECT * INTO v_type FROM public.notification_type_catalog
  WHERE event_type = p_event_type AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'نوع الإشعار غير معروف'; END IF;

  v_in_app := coalesce(p_in_app, v_type.in_app_default);
  IF NOT v_type.can_disable_in_app AND NOT v_in_app THEN
    RAISE EXCEPTION 'لا يمكن تعطيل إشعارات هذا النوع داخل التطبيق';
  END IF;

  INSERT INTO public.user_notification_preferences (user_id, event_type, in_app, push, updated_at)
  VALUES (v_user_id, p_event_type, v_in_app, coalesce(p_push, v_type.push_default), now())
  ON CONFLICT (user_id, event_type) DO UPDATE
    SET in_app = EXCLUDED.in_app,
        push = EXCLUDED.push,
        updated_at = now();

  RETURN jsonb_build_object(
    'event_type', p_event_type,
    'in_app', v_in_app,
    'push', coalesce(p_push, v_type.push_default)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.set_my_notification_preference(text, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_notification_preference(text, boolean, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reset_my_notification_preferences()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  DELETE FROM public.user_notification_preferences WHERE user_id = auth.uid();
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;
REVOKE ALL ON FUNCTION public.reset_my_notification_preferences() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reset_my_notification_preferences() TO authenticated, service_role;

-- ============================================================
-- 3) طابور الدفع الخادمي — منع تكرار + إعادة محاولة + تنظيف
-- ============================================================
CREATE TABLE IF NOT EXISTS public.push_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  reference_id uuid,
  title character varying(200) NOT NULL,
  body character varying(500) NOT NULL,
  route text,
  channel text NOT NULL DEFAULT 'social',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  locked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

-- ترقية الجدول إن كان منشأً بنسخة سابقة (بلا حالة إرسال جارٍ)
ALTER TABLE public.push_queue ADD COLUMN IF NOT EXISTS locked_at timestamptz;
DO $$
BEGIN
  ALTER TABLE public.push_queue DROP CONSTRAINT IF EXISTS push_queue_status_check;
  ALTER TABLE public.push_queue ADD CONSTRAINT push_queue_status_check
    CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped'));
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS push_queue_dedupe
  ON public.push_queue (
    user_id,
    event_type,
    coalesce(reference_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
DROP INDEX IF EXISTS public.push_queue_pending;
CREATE INDEX IF NOT EXISTS push_queue_pending
  ON public.push_queue (status, created_at)
  WHERE status IN ('pending', 'sending');

ALTER TABLE public.push_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_queue FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.push_queue TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_wattar_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.notification_push_enabled(NEW.user_id, NEW.event_type) THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.push_queue (user_id, event_type, reference_id, title, body, route)
  VALUES (NEW.user_id, NEW.event_type, NEW.reference_id, NEW.title, NEW.body, NEW.route)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_notifications_enqueue_push ON public.user_notifications;
CREATE TRIGGER trg_user_notifications_enqueue_push
  AFTER INSERT ON public.user_notifications
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_wattar_push();

-- استلام دفعة للعامل (service_role فقط) — يقفل الصفوف فلا تُرسل مرتين
CREATE OR REPLACE FUNCTION public.claim_push_batch(p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_max integer := coalesce((SELECT (s.value)::integer FROM public.admin_settings s WHERE s.key = 'push_max_attempts'), 5);
  v_rows jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'غير مصرح بسحب طابور الدفع';
  END IF;

  WITH picked AS (
    SELECT q.id
    FROM public.push_queue q
    WHERE q.attempts < v_max
      AND (
        q.status = 'pending'
        OR (q.status = 'sending' AND q.locked_at < now() - interval '5 minutes')
      )
    ORDER BY q.created_at
    LIMIT least(greatest(coalesce(p_limit, 50), 1), 200)
    FOR UPDATE SKIP LOCKED
  ), bumped AS (
    UPDATE public.push_queue q
    SET attempts = q.attempts + 1,
        status = 'sending',
        locked_at = now()
    FROM picked
    WHERE q.id = picked.id
    RETURNING q.id, q.user_id, q.title, q.body, q.route, q.channel, q.attempts
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id,
    'user_id', b.user_id,
    'title', b.title,
    'body', b.body,
    'route', b.route,
    'channel', b.channel,
    'attempts', b.attempts
  )), '[]'::jsonb) INTO v_rows
  FROM bumped b;

  RETURN v_rows;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_push_batch(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_push_batch(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.finish_push_batch(p_sent_ids uuid[], p_failed jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_max integer := coalesce((SELECT (s.value)::integer FROM public.admin_settings s WHERE s.key = 'push_max_attempts'), 5);
  v_sent integer := 0;
  v_failed integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'غير مصرح بإكمال طابور الدفع';
  END IF;

  IF p_sent_ids IS NOT NULL AND array_length(p_sent_ids, 1) IS NOT NULL THEN
    UPDATE public.push_queue
    SET status = 'sent', sent_at = now(), last_error = NULL, locked_at = NULL
    WHERE id = ANY(p_sent_ids);
    GET DIAGNOSTICS v_sent = ROW_COUNT;
  END IF;

  IF p_failed IS NOT NULL AND jsonb_typeof(p_failed) = 'array' THEN
    UPDATE public.push_queue q
    SET status = CASE
          WHEN f.error = 'DeviceNotRegistered' THEN 'skipped'
          WHEN q.attempts >= v_max THEN 'failed'
          ELSE 'pending'
        END,
        last_error = left(coalesce(f.error, 'unknown'), 300),
        locked_at = NULL
    FROM jsonb_to_recordset(p_failed) AS f(id uuid, error text)
    WHERE q.id = f.id;
    GET DIAGNOSTICS v_failed = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('sent', v_sent, 'failed', v_failed);
END;
$$;
REVOKE ALL ON FUNCTION public.finish_push_batch(uuid[], jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_push_batch(uuid[], jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.purge_push_queue(p_days integer DEFAULT 30)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'غير مصرح بتنظيف طابور الدفع';
  END IF;
  DELETE FROM public.push_queue
  WHERE status IN ('sent', 'skipped')
    AND coalesce(sent_at, created_at) < now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 365));
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;
REVOKE ALL ON FUNCTION public.purge_push_queue(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_push_queue(integer) TO service_role;

-- إعدادات الإشعارات
INSERT INTO public.admin_settings (key, value, description, is_public)
VALUES
  ('push_enabled', 'true'::jsonb, 'تفعيل دفع الإشعارات للجوال عامة', false),
  ('push_max_attempts', '5'::jsonb, 'أقصى محاولات إرسال الإشعار قبل اعتباره فاشلاً', false),
  ('campaign_max_recipients', '20000'::jsonb, 'أقصى عدد مستقبلين لحملة إشعارات واحدة', false)
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 4) أنواع الإشعارات: إضافة 'broadcast' إلى قيد user_notifications
-- ============================================================
ALTER TABLE public.user_notifications DROP CONSTRAINT IF EXISTS user_notifications_event_type_check;
ALTER TABLE public.user_notifications ADD CONSTRAINT user_notifications_event_type_check CHECK (
  event_type = ANY (ARRAY[
    'friend_request','friend_accepted','private_message','room_invitation','new_follower',
    'gift_received','deposit_update','withdrawal_update','host_update','membership_update',
    'host_earning','support_reply','moderation_penalty','moderation_appeal','host_application',
    'host_status','host_target','host_contract','vip_purchase','protection_purchase',
    'level_up','loyalty_streak','broadcast'
  ])
);

-- ============================================================
-- 5) الحملات الإدارية
-- ============================================================
CREATE TABLE IF NOT EXISTS public.notification_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title character varying(120) NOT NULL CHECK (char_length(btrim(title)) BETWEEN 3 AND 120),
  body character varying(500) NOT NULL CHECK (char_length(btrim(body)) BETWEEN 3 AND 500),
  route text,
  audience_kind text NOT NULL DEFAULT 'all'
    CHECK (audience_kind IN ('all', 'role', 'vip', 'hosts', 'level_min', 'user_ids')),
  audience_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'cancelled')),
  scheduled_at timestamptz,
  sent_at timestamptz,
  recipients_count integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notification_campaigns_status
  ON public.notification_campaigns (status, scheduled_at);

ALTER TABLE public.notification_campaigns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_campaigns FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.notification_campaigns TO service_role;

INSERT INTO public.admin_permission_catalog (permission, category, description)
VALUES
  ('notifications.view', 'الإشعارات', 'عرض أنواع الإشعارات والحملات'),
  ('notifications.manage', 'الإشعارات', 'إدارة الحملات الإدارية وأنواع الإشعارات')
ON CONFLICT (permission) DO UPDATE
  SET category = EXCLUDED.category, description = EXCLUDED.description;

INSERT INTO public.admin_role_permissions (staff_role, permission, allowed)
VALUES
  ('super_admin', 'notifications.view', true),
  ('super_admin', 'notifications.manage', true),
  ('operations', 'notifications.view', true),
  ('operations', 'notifications.manage', true),
  ('moderator', 'notifications.view', true),
  ('support', 'notifications.view', true)
ON CONFLICT (staff_role, permission) DO UPDATE SET allowed = EXCLUDED.allowed;

CREATE OR REPLACE FUNCTION public.admin_upsert_notification_campaign(
  p_admin_id uuid,
  p_campaign_id uuid,
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
  v_before public.notification_campaigns%ROWTYPE;
  v_after public.notification_campaigns%ROWTYPE;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_title text := btrim(coalesce(p_payload ->> 'title', ''));
  v_body text := btrim(coalesce(p_payload ->> 'body', ''));
  v_route text := nullif(btrim(coalesce(p_payload ->> 'route', '')), '');
  v_kind text := coalesce(nullif(btrim(coalesce(p_payload ->> 'audience_kind', '')), ''), 'all');
  v_value jsonb := coalesce(p_payload -> 'audience_value', '{}'::jsonb);
  v_scheduled timestamptz := nullif(btrim(coalesce(p_payload ->> 'scheduled_at', '')), '')::timestamptz;
  v_status text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_admin_id
       OR NOT public.admin_staff_can(p_admin_id, 'notifications.manage') THEN
      RAISE EXCEPTION 'غير مصرح بإدارة حملات الإشعارات';
    END IF;
  END IF;
  IF p_admin_id IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'بيانات الحملة غير صالحة';
  END IF;
  IF v_reason IS NULL OR char_length(v_reason) < 10 OR char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'أدخل سبباً بين 10 و500 حرف';
  END IF;
  IF char_length(v_title) NOT BETWEEN 3 AND 120 THEN
    RAISE EXCEPTION 'عنوان الحملة يجب أن يكون بين 3 و120 حرفاً';
  END IF;
  IF char_length(v_body) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'نص الحملة يجب أن يكون بين 3 و500 حرف';
  END IF;
  IF v_route IS NOT NULL AND v_route NOT LIKE '/%' THEN
    RAISE EXCEPTION 'مسار الحملة يجب أن يبدأ بـ /';
  END IF;
  IF v_kind NOT IN ('all', 'role', 'vip', 'hosts', 'level_min', 'user_ids') THEN
    RAISE EXCEPTION 'جمهور الحملة غير معروف';
  END IF;
  IF jsonb_typeof(v_value) <> 'object' THEN
    RAISE EXCEPTION 'بيانات جمهور الحملة غير صالحة';
  END IF;
  IF v_kind = 'role' AND coalesce(v_value ->> 'role', '') = '' THEN
    RAISE EXCEPTION 'حدد الدور المطلوب للحملة';
  END IF;
  IF v_kind = 'level_min' AND coalesce((v_value ->> 'level')::integer, 0) < 1 THEN
    RAISE EXCEPTION 'حدد أدنى مستوى للحملة';
  END IF;
  IF v_kind = 'user_ids' AND jsonb_typeof(coalesce(v_value -> 'user_ids', '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'قائمة المستخدمين غير صالحة';
  END IF;

  SELECT * INTO v_admin FROM public.users WHERE id = p_admin_id FOR UPDATE;
  IF NOT FOUND OR v_admin.status <> 'active' OR v_admin.role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'الحساب الإداري غير نشط';
  END IF;

  IF p_campaign_id IS NULL THEN
    v_status := CASE WHEN v_scheduled IS NULL THEN 'draft' ELSE 'scheduled' END;
    INSERT INTO public.notification_campaigns (
      title, body, route, audience_kind, audience_value, status, scheduled_at, created_by
    ) VALUES (
      v_title, v_body, v_route, v_kind, v_value, v_status, v_scheduled, p_admin_id
    ) RETURNING * INTO v_after;

    INSERT INTO public.admin_audit_log (
      admin_id, action, target_type, target_id, before, after, reason, metadata
    ) VALUES (
      p_admin_id, 'create'::public.audit_action_type, 'notification_campaign', v_after.id,
      NULL, to_jsonb(v_after), v_reason,
      jsonb_build_object('reason', v_reason, 'audience_kind', v_after.audience_kind)
    );
  ELSE
    SELECT * INTO v_before FROM public.notification_campaigns WHERE id = p_campaign_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'الحملة غير موجودة'; END IF;
    IF v_before.status = 'sent' THEN
      RAISE EXCEPTION 'لا يمكن تعديل حملة أُرسلت';
    END IF;
    v_status := CASE
      WHEN v_before.status = 'cancelled' THEN 'cancelled'
      WHEN v_scheduled IS NULL THEN 'draft'
      ELSE 'scheduled'
    END;

    UPDATE public.notification_campaigns
    SET title = v_title,
        body = v_body,
        route = v_route,
        audience_kind = v_kind,
        audience_value = v_value,
        status = v_status,
        scheduled_at = v_scheduled,
        updated_at = now()
    WHERE id = p_campaign_id
    RETURNING * INTO v_after;

    INSERT INTO public.admin_audit_log (
      admin_id, action, target_type, target_id, before, after, reason, metadata
    ) VALUES (
      p_admin_id, 'update'::public.audit_action_type, 'notification_campaign', v_after.id,
      to_jsonb(v_before), to_jsonb(v_after), v_reason,
      jsonb_build_object('reason', v_reason, 'audience_kind', v_after.audience_kind)
    );
  END IF;

  RETURN to_jsonb(v_after);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_upsert_notification_campaign(uuid, uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_upsert_notification_campaign(uuid, uuid, jsonb, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_cancel_notification_campaign(
  p_admin_id uuid,
  p_campaign_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_before public.notification_campaigns%ROWTYPE;
  v_after public.notification_campaigns%ROWTYPE;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_admin_id
       OR NOT public.admin_staff_can(p_admin_id, 'notifications.manage') THEN
      RAISE EXCEPTION 'غير مصرح بإدارة حملات الإشعارات';
    END IF;
  END IF;
  IF v_reason IS NULL OR char_length(v_reason) < 10 OR char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'أدخل سبباً بين 10 و500 حرف';
  END IF;
  SELECT * INTO v_before FROM public.notification_campaigns WHERE id = p_campaign_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الحملة غير موجودة'; END IF;
  IF v_before.status = 'sent' THEN RAISE EXCEPTION 'لا يمكن إلغاء حملة أُرسلت'; END IF;

  UPDATE public.notification_campaigns
  SET status = 'cancelled', updated_at = now()
  WHERE id = p_campaign_id
  RETURNING * INTO v_after;

  INSERT INTO public.admin_audit_log (
    admin_id, action, target_type, target_id, before, after, reason, metadata
  ) VALUES (
    p_admin_id, 'update'::public.audit_action_type, 'notification_campaign', v_after.id,
    to_jsonb(v_before), to_jsonb(v_after), v_reason,
    jsonb_build_object('reason', v_reason, 'cancelled', true)
  );

  RETURN to_jsonb(v_after);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_cancel_notification_campaign(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_cancel_notification_campaign(uuid, uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_list_notification_campaigns(p_admin_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_admin_id
       OR NOT public.admin_staff_can(p_admin_id, 'notifications.view') THEN
      RAISE EXCEPTION 'غير مصرح بعرض حملات الإشعارات';
    END IF;
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(row_to_json(t)::jsonb ORDER BY t.created_at DESC)
    FROM (
      SELECT c.*, u.username AS created_by_username
      FROM public.notification_campaigns c
      LEFT JOIN public.users u ON u.id = c.created_by
      ORDER BY c.created_at DESC
      LIMIT 200
    ) t
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_list_notification_campaigns(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_notification_campaigns(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_list_notification_types(p_admin_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_admin_id
       OR NOT public.admin_staff_can(p_admin_id, 'notifications.view') THEN
      RAISE EXCEPTION 'غير مصرح بعرض أنواع الإشعارات';
    END IF;
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(row_to_json(c)::jsonb ORDER BY c.sort_order, c.event_type)
    FROM public.notification_type_catalog c
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_list_notification_types(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_notification_types(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_upsert_notification_type(
  p_admin_id uuid,
  p_event_type text,
  p_payload jsonb,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_before public.notification_type_catalog%ROWTYPE;
  v_after public.notification_type_catalog%ROWTYPE;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_key text := lower(btrim(coalesce(p_event_type, '')));
  v_category text := coalesce(nullif(btrim(coalesce(p_payload ->> 'category', '')), ''), 'social');
  v_label text := btrim(coalesce(p_payload ->> 'label_ar', ''));
  v_desc text := nullif(btrim(coalesce(p_payload ->> 'description_ar', '')), '');
  v_sort integer := coalesce((p_payload ->> 'sort_order')::integer, 0);
  v_active boolean := coalesce((p_payload ->> 'is_active')::boolean, true);
  v_action public.audit_action_type;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_admin_id
       OR NOT public.admin_staff_can(p_admin_id, 'notifications.manage') THEN
      RAISE EXCEPTION 'غير مصرح بإدارة أنواع الإشعارات';
    END IF;
  END IF;
  IF v_reason IS NULL OR char_length(v_reason) < 10 OR char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'أدخل سبباً بين 10 و500 حرف';
  END IF;
  IF v_key !~ '^[a-z0-9_]{3,60}$' THEN
    RAISE EXCEPTION 'مفتاح النوع يجب أن يكون أحرفاً إنجليزية صغيرة وأرقاماً و_ بين 3 و60';
  END IF;
  IF char_length(v_label) NOT BETWEEN 2 AND 80 THEN
    RAISE EXCEPTION 'اسم النوع يجب أن يكون بين 2 و80 حرفاً';
  END IF;
  IF v_category NOT IN ('social', 'messages', 'gifts', 'wallet', 'account', 'support', 'marketing') THEN
    RAISE EXCEPTION 'فئة النوع غير معروفة';
  END IF;

  SELECT * INTO v_before FROM public.notification_type_catalog WHERE event_type = v_key FOR UPDATE;
  IF FOUND THEN
    v_action := 'update'::public.audit_action_type;
    UPDATE public.notification_type_catalog
    SET category = v_category,
        label_ar = v_label,
        description_ar = v_desc,
        can_disable_in_app = coalesce((p_payload ->> 'can_disable_in_app')::boolean, v_before.can_disable_in_app),
        push_default = coalesce((p_payload ->> 'push_default')::boolean, v_before.push_default),
        in_app_default = coalesce((p_payload ->> 'in_app_default')::boolean, v_before.in_app_default),
        sort_order = v_sort,
        is_active = v_active,
        updated_at = now()
    WHERE event_type = v_key
    RETURNING * INTO v_after;
  ELSE
    v_action := 'create'::public.audit_action_type;
    INSERT INTO public.notification_type_catalog (
      event_type, category, label_ar, description_ar,
      push_default, in_app_default, can_disable_in_app, sort_order, is_active
    ) VALUES (
      v_key, v_category, v_label, v_desc,
      coalesce((p_payload ->> 'push_default')::boolean, true),
      coalesce((p_payload ->> 'in_app_default')::boolean, true),
      coalesce((p_payload ->> 'can_disable_in_app')::boolean, true),
      v_sort, v_active
    ) RETURNING * INTO v_after;
  END IF;

  INSERT INTO public.admin_audit_log (
    admin_id, action, target_type, target_id, before, after, reason, metadata
  ) VALUES (
    p_admin_id, v_action, 'notification_type', NULL,
    CASE WHEN v_action = 'update'::public.audit_action_type THEN to_jsonb(v_before) ELSE NULL END,
    to_jsonb(v_after), v_reason,
    jsonb_build_object('reason', v_reason, 'event_type', v_after.event_type)
  );

  RETURN to_jsonb(v_after);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_upsert_notification_type(uuid, text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_upsert_notification_type(uuid, text, jsonb, text) TO authenticated, service_role;

-- إرسال الحملة: يبني الجمهور ويُدخل الإشعارات (الدفع يتكفل به الطابور)
CREATE OR REPLACE FUNCTION public.dispatch_notification_campaign(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_campaign public.notification_campaigns%ROWTYPE;
  v_max integer := coalesce((SELECT (s.value)::integer FROM public.admin_settings s WHERE s.key = 'campaign_max_recipients'), 20000);
  v_ids uuid[];
  v_inserted integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (auth.uid() IS NULL OR NOT public.admin_staff_can(auth.uid(), 'notifications.manage')) THEN
    RAISE EXCEPTION 'غير مصرح بإرسال الحملات';
  END IF;

  SELECT * INTO v_campaign FROM public.notification_campaigns WHERE id = p_campaign_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الحملة غير موجودة'; END IF;
  IF v_campaign.status IN ('sent', 'sending') THEN
    RETURN jsonb_build_object('campaign_id', p_campaign_id, 'recipients', 0, 'already_processed', true);
  END IF;
  IF v_campaign.status = 'cancelled' THEN
    RAISE EXCEPTION 'الحملة ملغاة';
  END IF;
  IF v_campaign.scheduled_at IS NOT NULL AND v_campaign.scheduled_at > now() THEN
    RAISE EXCEPTION 'موعد الحملة لم يحن بعد';
  END IF;

  UPDATE public.notification_campaigns SET status = 'sending', updated_at = now()
  WHERE id = p_campaign_id;

  IF v_campaign.audience_kind = 'all' THEN
    SELECT array_agg(u.id) INTO v_ids FROM public.users u WHERE u.status = 'active';
  ELSIF v_campaign.audience_kind = 'role' THEN
    SELECT array_agg(u.id) INTO v_ids FROM public.users u
    WHERE u.status = 'active' AND u.role::text = (v_campaign.audience_value ->> 'role');
  ELSIF v_campaign.audience_kind = 'vip' THEN
    SELECT array_agg(u.id) INTO v_ids FROM public.users u
    WHERE u.status = 'active' AND public.active_vip_tier(u.id) IS NOT NULL;
  ELSIF v_campaign.audience_kind = 'hosts' THEN
    SELECT array_agg(DISTINCT u.id) INTO v_ids
    FROM public.users u JOIN public.verified_hosts h ON h.user_id = u.id
    WHERE u.status = 'active' AND h.status = 'active';
  ELSIF v_campaign.audience_kind = 'level_min' THEN
    SELECT array_agg(u.id) INTO v_ids FROM public.users u
    WHERE u.status = 'active'
      AND u.level >= greatest(coalesce((v_campaign.audience_value ->> 'level')::integer, 1), 1);
  ELSE
    SELECT array_agg(DISTINCT x) INTO v_ids
    FROM jsonb_array_elements_text(coalesce(v_campaign.audience_value -> 'user_ids', '[]'::jsonb)) AS t(x)
    JOIN public.users u ON u.id = t.x::uuid
    WHERE u.status = 'active';
  END IF;

  IF v_ids IS NULL THEN
    UPDATE public.notification_campaigns
    SET status = 'sent', sent_at = now(), recipients_count = 0, updated_at = now()
    WHERE id = p_campaign_id;
    RETURN jsonb_build_object('campaign_id', p_campaign_id, 'recipients', 0, 'already_processed', false);
  END IF;

  v_ids := v_ids[1:greatest(v_max, 1)];

  INSERT INTO public.user_notifications (user_id, actor_id, event_type, reference_id, title, body, route)
  SELECT x, NULL, 'broadcast', p_campaign_id, v_campaign.title, v_campaign.body, v_campaign.route
  FROM unnest(v_ids) AS x
  ON CONFLICT (user_id, event_type, reference_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  UPDATE public.notification_campaigns
  SET status = 'sent', sent_at = now(), recipients_count = v_inserted, updated_at = now()
  WHERE id = p_campaign_id;

  RETURN jsonb_build_object(
    'campaign_id', p_campaign_id,
    'recipients', v_inserted,
    'already_processed', false
  );
END;
$$;
REVOKE ALL ON FUNCTION public.dispatch_notification_campaign(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dispatch_notification_campaign(uuid) TO authenticated, service_role;

SELECT set_config('request.jwt.claims', '', true);

COMMIT;
