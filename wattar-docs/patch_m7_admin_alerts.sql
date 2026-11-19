-- ============================================================
-- patch_m7_admin_alerts.sql — migration #71 (M7.2 دفعة أ)
--
-- 1) جدول admin_alerts: تنبيهات إدارية فورية للبلاغات والإيداعات
--    والسحوبات المعلّقة وغيرها من الأحداث التي تحتاج متابعة.
-- 2) دالة is_maintenance_mode(): تقرأ مفتاح admin_settings.maintenance_mode.
-- 3) مشغّلات على user_reports / deposits / diamond_withdrawals تخلق
--    تنبيهاً تلقائياً عند создание سجل جديد بحالة معلّقة.
-- 4) سياسات RLS وصلاحيات التنفيذ للمديرين وservice_role.
-- ============================================================
BEGIN;

-- -----------------------------------------------------------
-- نوع التنبيه
-- -----------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'admin_alert_type') THEN
    CREATE TYPE public.admin_alert_type AS ENUM (
      'user_report',
      'pending_deposit',
      'pending_withdrawal',
      'system',
      'security'
    );
  END IF;
END $$;

-- -----------------------------------------------------------
-- جدول التنبيهات الإدارية
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_alerts (
  id            uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  alert_type    public.admin_alert_type NOT NULL DEFAULT 'system',
  title         text NOT NULL,
  message       text NOT NULL,
  reference_type text,          -- 'user_report' | 'deposit' | 'diamond_withdrawal' | null
  reference_id  uuid,            -- معرف السجل المسبب للتنبيه
  is_read       boolean NOT NULL DEFAULT false,
  is_dismissed  boolean NOT NULL DEFAULT false,
  created_by    uuid REFERENCES public.users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  read_at       timestamptz,
  dismissed_at  timestamptz
);

-- فهرس للتنبيهات غير المقروءة (الأكثر استفساراً)
CREATE INDEX IF NOT EXISTS idx_admin_alerts_unread
  ON public.admin_alerts (is_read, is_dismissed, created_at DESC)
  WHERE NOT is_read AND NOT is_dismissed;

-- -----------------------------------------------------------
-- دالة فحص وضع الصيانة (تُستخدم من الحافة والتطبيق)
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_maintenance_mode()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce((value)::boolean, false)
  FROM public.admin_settings
  WHERE key = 'maintenance_mode'
$$;
REVOKE ALL ON FUNCTION public.is_maintenance_mode() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_maintenance_mode() TO authenticated, service_role;

-- -----------------------------------------------------------
-- RPC: قائمة التنبيهات الإدارية (غير المقروءة أولًا)
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_alerts()
RETURNS TABLE(
  id uuid,
  alert_type public.admin_alert_type,
  title text,
  message text,
  reference_type text,
  reference_id uuid,
  is_read boolean,
  is_dismissed boolean,
  created_at timestamptz,
  read_at timestamptz,
  dismissed_at timestamptz,
  created_by_name text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً';
  END IF;
  IF NOT public.admin_staff_can(v_uid, 'dashboard.view') THEN
    RAISE EXCEPTION 'لا تملك صلاحية عرض التنبيهات';
  END IF;
  RETURN QUERY
  SELECT a.id, a.alert_type, a.title, a.message, a.reference_type, a.reference_id,
         a.is_read, a.is_dismissed, a.created_at, a.read_at, a.dismissed_at,
         coalesce(u.display_name, u.username)::text
  FROM public.admin_alerts a
  LEFT JOIN public.users u ON u.id = a.created_by
  WHERE NOT a.is_dismissed
  ORDER BY a.is_read ASC, a.created_at DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_list_alerts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_alerts() TO authenticated;

-- -----------------------------------------------------------
-- RPC: تحديد تنبيه كمقروء
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_mark_alert_read(p_alert_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.admin_alerts%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً';
  END IF;
  SELECT * INTO v_row FROM public.admin_alerts WHERE id = p_alert_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'التنبيه غير موجود';
  END IF;
  IF v_row.is_dismissed THEN
    RAISE EXCEPTION 'لا يمكن تحديد تنبيه مقصوف كمقروء';
  END IF;
  UPDATE public.admin_alerts
     SET is_read = true, read_at = now()
   WHERE id = p_alert_id
     AND NOT is_read;
  RETURN jsonb_build_object('alert_id', p_alert_id, 'is_read', true);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_mark_alert_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_mark_alert_read(uuid) TO authenticated;

-- -----------------------------------------------------------
-- RPC: حذف/تجاهل تنبيه
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_dismiss_alert(p_alert_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.admin_alerts%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً';
  END IF;
  SELECT * INTO v_row FROM public.admin_alerts WHERE id = p_alert_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'التنبيه غير موجود';
  END IF;
  UPDATE public.admin_alerts
     SET is_dismissed = true, dismissed_at = now()
   WHERE id = p_alert_id
     AND NOT is_dismissed;
  RETURN jsonb_build_object('alert_id', p_alert_id, 'is_dismissed', true);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_dismiss_alert(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_dismiss_alert(uuid) TO authenticated;

-- -----------------------------------------------------------
-- RPC: إنشاء تنبيه (يُستدعى من دوال Edge أو من المشغّلات)
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_create_alert(
  p_alert_type public.admin_alert_type,
  p_title text,
  p_message text,
  p_reference_type text DEFAULT NULL,
  p_reference_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً';
  END IF;
  IF NOT public.admin_staff_can(v_uid, 'dashboard.view') THEN
    RAISE EXCEPTION 'لا تملك صلاحية إنشاء تنبيهات';
  END IF;
  INSERT INTO public.admin_alerts (alert_type, title, message, reference_type, reference_id, created_by)
  VALUES (p_alert_type, p_title, p_message, p_reference_type, p_reference_id, v_uid)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_create_alert(public.admin_alert_type, text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_alert(public.admin_alert_type, text, text, text, uuid) TO authenticated, service_role;

-- -----------------------------------------------------------
-- مشغّل تلقائي: تنبيه عند إضافة بلاغ مستخدم جديد
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_alert_on_user_report()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.admin_create_alert(
      'user_report',
      'بلاغ مستخدم جديد',
      coalesce(NEW.reason, 'بدون سبب') || ' — ضد ' || coalesce(NEW.reported_id::text, 'مستخدم'),
      'user_report', NEW.id
    );
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_admin_alert_user_report
AFTER INSERT ON public.user_reports
FOR EACH ROW EXECUTE FUNCTION public.trg_alert_on_user_report();

-- -----------------------------------------------------------
-- مشغّل تلقائي: تنبيه عند إيداع معلق جديد
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_alert_on_pending_deposit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'pending' THEN
    PERFORM public.admin_create_alert(
      'pending_deposit',
      'طلب شحن معلق',
      'مبلغ ' || coalesce(NEW.amount_gold::text, '0') || ' Coin بانتظار المراجعة',
      'deposit', NEW.id
    );
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_admin_alert_pending_deposit
AFTER INSERT ON public.deposits
FOR EACH ROW EXECUTE FUNCTION public.trg_alert_on_pending_deposit();

-- -----------------------------------------------------------
-- مشغّل تلقائي: تنبيه عند سحب معلق جديد
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_alert_on_pending_withdrawal()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'pending' THEN
    PERFORM public.admin_create_alert(
      'pending_withdrawal',
      'طلب سحب معلق',
      'طلب سحب جديد بانتظار المراجعة',
      'diamond_withdrawal', NEW.id
    );
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_admin_alert_pending_withdrawal
AFTER INSERT ON public.diamond_withdrawals
FOR EACH ROW EXECUTE FUNCTION public.trg_alert_on_pending_withdrawal();

-- -----------------------------------------------------------
-- سجل تدقيق على جدول التنبيهات (قراءة/تعديل)
-- -----------------------------------------------------------
ALTER TABLE public.admin_alerts
  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_alerts_admin_select ON public.admin_alerts;
CREATE POLICY admin_alerts_admin_select ON public.admin_alerts
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND status = 'active'
        AND (role IN ('admin', 'super_admin')
             OR public.admin_staff_can(auth.uid(), 'dashboard.view'))
    )
  );

DROP POLICY IF EXISTS admin_alerts_admin_update ON public.admin_alerts;
CREATE POLICY admin_alerts_admin_update ON public.admin_alerts
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND status = 'active'
        AND (role IN ('admin', 'super_admin')
             OR public.admin_staff_can(auth.uid(), 'dashboard.view'))
    )
  );

-- الخدمة تُنشئ التنبيهات عبر المشغّلات
GRANT INSERT ON public.admin_alerts TO service_role;
GRANT SELECT, UPDATE ON public.admin_alerts TO authenticated;

COMMIT;