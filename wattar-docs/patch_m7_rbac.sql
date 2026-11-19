-- ============================================================
-- patch_m7_rbac.sql — migration #69 (M7.1)
--
-- نظام RBAC للإدارة (القسم 24 من المتطلبات):
--   - ٥ أدوار موظفين: super_admin / finance / moderator / support / operations
--     (تكليف الموظف منفصل عن users.role حتى لا يمتلك الموظف صلاحيات الإدارة العليا).
--   - كتالوج صلاحيات (~40) + مصفوفة أدوار×صلاحيات قابلة للتعديل من اللوحة.
--   - إدارة الموظفين: منح/سحب بسبب إلزامي + سجل تدقيق لكل قرار.
--   - 2FA TOTP لحسابات الإدارة: سرّ 20 بايت، HMAC-SHA1 ±خطوة،
--     منع إعادة الاستخدام، وفرض اختياري عبر مفتاح admin_2fa_required
--     (نافذة تحقق 30 دقيقة تُفحص داخل دوال الكتابة الحساسة).
--   - بوابات صلاحيات فعلية على مستوى القاعدة لأهم دوال الكتابة:
--     الشحن، السحب، حالة المستخدم، أفعال الغرف، ودوال الدعم
--     (عبر أغلفة تحقق حول الدوال الحالية — بلا تعديل منطقها).
--
-- التراجع: حذف الأغلفة وإعادة تسمية الدوال *_int إلى أسمائها الأصلية،
-- ثم حذف الجداول/الدوال/النوع الجديد وإعداداته.
-- ============================================================
BEGIN;

SELECT set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, false);
SET search_path = public, extensions;

-- ============================================================
-- 1) نوع الأدوار + جداول RBAC + جدول TOTP
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                 WHERE n.nspname = 'public' AND t.typname = 'admin_staff_role') THEN
    CREATE TYPE public.admin_staff_role AS ENUM ('super_admin', 'finance', 'moderator', 'support', 'operations');
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.admin_staff_roles (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  staff_role public.admin_staff_role NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  granted_by uuid REFERENCES public.users(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  grant_reason text,
  revoked_by uuid REFERENCES public.users(id),
  revoked_at timestamptz,
  revoke_reason text
);
ALTER TABLE public.admin_staff_roles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_staff_roles FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.admin_permission_catalog (
  permission text PRIMARY KEY,
  category text NOT NULL,
  description text NOT NULL DEFAULT ''
);
ALTER TABLE public.admin_permission_catalog ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_permission_catalog FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.admin_role_permissions (
  staff_role public.admin_staff_role NOT NULL,
  permission text NOT NULL REFERENCES public.admin_permission_catalog(permission) ON DELETE CASCADE,
  allowed boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (staff_role, permission)
);
ALTER TABLE public.admin_role_permissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_role_permissions FROM PUBLIC, anon, authenticated;

-- أسرار TOTP: لا وصول عميل مطلقاً — كل شيء عبر دوال SECURITY DEFINER.
-- (بلا زناد تدقيق: تحديث الرمز المتكرر ليس قراراً إدارياً؛ التفعيل/التعطيل
--  يُسجلان صراحة داخل RPC الخاصة بهما.)
CREATE TABLE IF NOT EXISTS public.admin_totp (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  secret_hex text NOT NULL CHECK (secret_hex ~ '^[0-9a-f]{40}$'),
  confirmed_at timestamptz,
  last_used_step bigint CHECK (last_used_step IS NULL OR last_used_step >= 0),
  last_verified_at timestamptz
);
ALTER TABLE public.admin_totp ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_totp FROM PUBLIC, anon, authenticated;

-- سجل تدقيق صفوف الموظفين (نفس زناد الإدارة العام؛ الإدراج تُسجله RPC نفسها)
DROP TRIGGER IF EXISTS audit_admin_row_change ON public.admin_staff_roles;
CREATE TRIGGER audit_admin_row_change
  AFTER UPDATE OR DELETE ON public.admin_staff_roles
  FOR EACH ROW EXECUTE FUNCTION public.audit_admin_row_change();

-- ============================================================
-- 2) كتالوج الصلاحيات (المجموعات تطابق أقسام لوحة الإدارة)
-- ============================================================
INSERT INTO public.admin_permission_catalog (permission, category, description) VALUES
  ('dashboard.view',        'عام',            'عرض لوحة النظرة العامة'),
  ('reports.platform',      'عام',            'عرض تقارير حركة المنصة'),
  ('audit.view',            'عام',            'عرض سجل النشاط الإداري'),
  ('users.view',            'المستخدمون',     'عرض المستخدمين وملفاتهم'),
  ('users.manage',          'المستخدمون',     'تعديل حالة المستخدم والحظر والتعليق'),
  ('user_reports.view',     'المستخدمون',     'عرض بلاغات المستخدمين'),
  ('user_reports.manage',   'المستخدمون',     'معالجة بلاغات المستخدمين'),
  ('moderation.view',       'الإشراف',        'عرض قواعد الإشراف والكلمات الممنوعة'),
  ('moderation.manage',     'الإشراف',        'تعديل قواعد الإشراف والكلمات الممنوعة'),
  ('hosts.applications.view',   'المضيفات',   'عرض طلبات توثيق المضيفات'),
  ('hosts.applications.manage', 'المضيفات',   'اعتماد/رفض/تعليق توثيق المضيفات'),
  ('messaging.settings.view',   'المضيفات',   'عرض إعدادات الرسائل وبرنامج المضيفات'),
  ('messaging.settings.manage', 'المضيفات',   'تعديل إعدادات الرسائل وبرنامج المضيفات'),
  ('support.view',          'الدعم',          'عرض تذاكر الدعم'),
  ('support.manage',        'الدعم',          'التعامل مع تذاكر الدعم وإغلاقها'),
  ('wallets.view',          'المالية',        'عرض المحافظ ودفاتر الحركات'),
  ('deposits.view',         'المالية',        'عرض طلبات الشحن'),
  ('deposits.manage',       'المالية',        'مراجعة وقبول/رفض طلبات الشحن'),
  ('withdrawals.view',      'المالية',        'عرض طلبات السحب'),
  ('withdrawals.manage',    'المالية',        'مراجعة وقبول/رفض طلبات السحب'),
  ('transfers.view',        'المالية',        'عرض التحويلات'),
  ('transfers.manage',      'المالية',        'إدارة التحويلات والقرارات المالية'),
  ('finance.reports',       'المالية',        'التقارير المالية'),
  ('agents.view',           'الوكلاء والوكالات', 'عرض الوكلاء'),
  ('agents.manage',         'الوكلاء والوكالات', 'إدارة الوكلاء ومحافظهم'),
  ('agencies.view',         'الوكلاء والوكالات', 'عرض الوكالات'),
  ('agencies.manage',       'الوكلاء والوكالات', 'إدارة الوكالات واعتمادها'),
  ('rooms.view',            'الغرف',          'عرض الغرف الصوتية'),
  ('rooms.manage',          'الغرف',          'إدارة الغرف والمقاعد والمشرفين'),
  ('games.view',            'الاقتصاد',       'عرض الألعاب وإعداداتها'),
  ('games.manage',          'الاقتصاد',       'تعديل إعدادات الألعاب'),
  ('missions.view',         'الاقتصاد',       'عرض المهمات والمكافآت'),
  ('missions.manage',       'الاقتصاد',       'تعديل المهمات والمكافآت'),
  ('store.view',            'الاقتصاد',       'عرض متجر الهدايا'),
  ('store.manage',          'الاقتصاد',       'إدارة كتالوج الهدايا'),
  ('memberships.view',      'الاقتصاد',       'عرض عضويات VIP'),
  ('memberships.manage',    'الاقتصاد',       'إدارة عضويات VIP'),
  ('features.flags',        'المنصة',         'التحكم بمفاتيح الميزات'),
  ('maintenance.mode',      'المنصة',         'تفعيل/إيقاف وضع الصيانة'),
  ('settings.view',         'المنصة',         'عرض إعدادات المنصة'),
  ('settings.manage',       'المنصة',         'تعديل إعدادات المنصة والخدمات'),
  ('staff.view',            'الموظفون',       'عرض الموظفين وأدوارهم'),
  ('staff.manage',          'الموظفون',       'منح/سحب أدوار الموظفين وتعديل المصفوفة'),
  ('security.2fa.manage',   'الموظفون',       'التحكم بإلزام التحقق بخطوتين للحسابات الإدارية')
ON CONFLICT (permission) DO UPDATE
  SET category = excluded.category,
      description = excluded.description;

-- ============================================================
-- 3) المصفوفة الافتراضية (super_admin كامل دائماً — يُحسب في الدوال)
-- ============================================================
INSERT INTO public.admin_role_permissions (staff_role, permission, allowed)
SELECT 'super_admin'::public.admin_staff_role, c.permission, true
FROM public.admin_permission_catalog c
ON CONFLICT (staff_role, permission) DO NOTHING;

INSERT INTO public.admin_role_permissions (staff_role, permission, allowed)
SELECT v.role::public.admin_staff_role, v.permission, true
FROM (VALUES
  -- Finance: المال + قراءة الحسابات/الوكلاء
  ('finance', 'dashboard.view'), ('finance', 'reports.platform'), ('finance', 'audit.view'),
  ('finance', 'wallets.view'), ('finance', 'deposits.view'), ('finance', 'deposits.manage'),
  ('finance', 'withdrawals.view'), ('finance', 'withdrawals.manage'),
  ('finance', 'transfers.view'), ('finance', 'transfers.manage'), ('finance', 'finance.reports'),
  ('finance', 'agents.view'), ('finance', 'agencies.view'), ('finance', 'users.view'),
  -- Moderator: المستخدمون والبلاغات والإشراف والغرف
  ('moderator', 'dashboard.view'), ('moderator', 'audit.view'),
  ('moderator', 'users.view'), ('moderator', 'users.manage'),
  ('moderator', 'user_reports.view'), ('moderator', 'user_reports.manage'),
  ('moderator', 'moderation.view'), ('moderator', 'moderation.manage'),
  ('moderator', 'hosts.applications.view'), ('moderator', 'support.view'),
  ('moderator', 'rooms.view'), ('moderator', 'rooms.manage'),
  ('moderator', 'games.view'), ('moderator', 'missions.view'),
  ('moderator', 'store.view'), ('moderator', 'memberships.view'),
  -- Support: المستخدمون (عرض) + الدعم
  ('support', 'dashboard.view'), ('support', 'users.view'),
  ('support', 'user_reports.view'), ('support', 'support.view'), ('support', 'support.manage'),
  ('support', 'rooms.view'), ('support', 'store.view'),
  ('support', 'missions.view'), ('support', 'memberships.view'),
  -- Operations: الغرف والاقتصاد والتشغيل
  ('operations', 'dashboard.view'), ('operations', 'reports.platform'), ('operations', 'audit.view'),
  ('operations', 'hosts.applications.view'), ('operations', 'messaging.settings.view'),
  ('operations', 'messaging.settings.manage'),
  ('operations', 'rooms.view'), ('operations', 'rooms.manage'),
  ('operations', 'games.view'), ('operations', 'games.manage'),
  ('operations', 'missions.view'), ('operations', 'missions.manage'),
  ('operations', 'store.view'), ('operations', 'store.manage'),
  ('operations', 'memberships.view'), ('operations', 'memberships.manage'),
  ('operations', 'features.flags'), ('operations', 'maintenance.mode'),
  ('operations', 'settings.view')
) AS v(role, permission)
ON CONFLICT (staff_role, permission) DO NOTHING;

-- ============================================================
-- 4) الدوال المساعدة
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_staff_role(p_user_id uuid)
RETURNS public.admin_staff_role
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT r.staff_role
  FROM public.admin_staff_roles r
  JOIN public.users u ON u.id = r.user_id
  WHERE r.user_id = p_user_id
    AND r.is_active
    AND u.status = 'active'
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.admin_staff_role(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_staff_role(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_staff_can(p_user_id uuid, p_permission text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_role public.admin_staff_role;
BEGIN
  IF p_user_id IS NULL OR p_permission IS NULL THEN
    RETURN false;
  END IF;
  v_role := public.admin_staff_role(p_user_id);
  IF v_role IS NULL THEN
    RETURN false;
  END IF;
  IF v_role = 'super_admin' THEN
    RETURN true;
  END IF;
  RETURN coalesce((
    SELECT allowed FROM public.admin_role_permissions
    WHERE staff_role = v_role AND permission = p_permission
  ), false);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_staff_can(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_staff_can(uuid, text) TO authenticated, service_role;

-- بوابة 2FA: تُرجع true دائماً ما لم يُفعَّل المفتاح admin_2fa_required.
-- عند التفعيل: يلزم تحقق TOTP خلال آخر 30 دقيقة؛ الإدارة العليا غير
-- المسجّلة بعد تُسمح لها مرة واحدة حتى تجهّز TOTP (باستثناء الوضع الصارم).
CREATE OR REPLACE FUNCTION public.admin_2fa_gate_ok(p_user_id uuid, p_block_unenrolled_super boolean DEFAULT false)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_required boolean;
  v_is_super boolean;
  v_row public.admin_totp%ROWTYPE;
BEGIN
  SELECT coalesce((value)::boolean, false) INTO v_required
  FROM public.admin_settings WHERE key = 'admin_2fa_required';
  IF NOT coalesce(v_required, false) THEN
    RETURN true;
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.users WHERE id = p_user_id AND role = 'super_admin')
    INTO v_is_super;

  SELECT * INTO v_row FROM public.admin_totp WHERE user_id = p_user_id;
  IF v_row.user_id IS NULL OR v_row.confirmed_at IS NULL THEN
    RETURN v_is_super AND NOT p_block_unenrolled_super;
  END IF;

  RETURN v_row.last_verified_at IS NOT NULL
     AND v_row.last_verified_at > now() - interval '30 minutes';
END;
$$;
REVOKE ALL ON FUNCTION public.admin_2fa_gate_ok(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_2fa_gate_ok(uuid, boolean) TO authenticated, service_role;

-- ============================================================
-- 5) التكليف الأولي + مفتاح 2FA الافتراضي
-- ============================================================
INSERT INTO public.admin_staff_roles (user_id, staff_role, is_active, granted_by, granted_at, grant_reason)
SELECT u.id, 'super_admin'::public.admin_staff_role, true, NULL, now(), 'تكليف أولي لنظام RBAC (ترحيل #69)'
FROM public.users u
WHERE u.role IN ('admin', 'super_admin')
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.admin_settings (key, value, description, is_public)
VALUES ('admin_2fa_required', 'false'::jsonb, 'إلزام التحقق بخطوتين (TOTP) لكل حسابات الإدارة', false)
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 6) TOTP — ترميز Base32 وحساب الرمز
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_totp_base32(p_bytes bytea)
RETURNS text
LANGUAGE plpgsql IMMUTABLE STRICT
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_alphabet text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  v_bits text := '';
  v_out text := '';
  b integer;
BEGIN
  FOR b IN SELECT get_byte(p_bytes, g) FROM generate_series(0, octet_length(p_bytes) - 1) AS g LOOP
    v_bits := v_bits || lpad(b::bit(8)::text, 8, '0');
  END LOOP;
  WHILE length(v_bits) % 5 <> 0 LOOP
    v_bits := v_bits || '0';
  END LOOP;
  FOR b IN 0..(length(v_bits) / 5 - 1) LOOP
    v_out := v_out || substr(v_alphabet, substr(v_bits, b * 5 + 1, 5)::bit(5)::int + 1, 1);
  END LOOP;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_totp_base32(bytea) FROM PUBLIC, anon, authenticated;

-- رمز TOTP لخطوة زمنية معينة (RFC 6238: HMAC-SHA1، 6 أرقام)
CREATE OR REPLACE FUNCTION public.admin_totp_code(p_secret_hex text, p_step bigint)
RETURNS text
LANGUAGE plpgsql IMMUTABLE STRICT
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_counter bytea := int8send(p_step);
  v_mac bytea := extensions.hmac(v_counter, decode(p_secret_hex, 'hex'), 'sha1');
  v_offset integer := get_byte(v_mac, 19) & 15;
  v_bin bigint := 0;
  i integer;
BEGIN
  FOR i IN 0..3 LOOP
    v_bin := (v_bin * 256) + get_byte(v_mac, v_offset + i);
  END LOOP;
  v_bin := v_bin & 2147483647;
  RETURN lpad((v_bin % 1000000)::text, 6, '0');
END;
$$;
REVOKE ALL ON FUNCTION public.admin_totp_code(text, bigint) FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 7) RPC الموظفين (كل قرار مسجّل في سجل التدقيق)
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_list_staff()
RETURNS TABLE(
  user_id uuid, username text, display_name text, avatar_url text,
  staff_role text, is_active boolean, granted_at timestamptz, granted_by_name text,
  grant_reason text, revoked_at timestamptz, revoke_reason text,
  totp_enabled boolean
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
  IF NOT public.admin_staff_can(v_uid, 'staff.view') THEN
    RAISE EXCEPTION 'لا تملك صلاحية عرض الموظفين';
  END IF;
  RETURN QUERY
  SELECT r.user_id, u.username::text, u.display_name::text, u.avatar_url::text,
         r.staff_role::text, r.is_active, r.granted_at,
         coalesce(g.display_name, g.username)::text,
         r.grant_reason, r.revoked_at, r.revoke_reason,
         EXISTS (SELECT 1 FROM public.admin_totp t WHERE t.user_id = r.user_id AND t.confirmed_at IS NOT NULL)
  FROM public.admin_staff_roles r
  JOIN public.users u ON u.id = r.user_id
  LEFT JOIN public.users g ON g.id = r.granted_by
  ORDER BY r.is_active DESC, r.staff_role, u.username;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_list_staff() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_staff() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_grant_staff_role(
  p_user_id uuid,
  p_staff_role text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_reason text := NULLIF(btrim(coalesce(p_reason, '')), '');
  v_target public.users%ROWTYPE;
  v_old public.admin_staff_roles%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً';
  END IF;
  IF NOT public.admin_staff_can(v_actor, 'staff.manage') THEN
    RAISE EXCEPTION 'لا تملك صلاحية إدارة الموظفين — الإدارة العليا فقط';
  END IF;
  IF v_reason IS NULL OR char_length(v_reason) < 2 OR char_length(v_reason) > 200 THEN
    RAISE EXCEPTION 'سبب إلزامي من 2 إلى 200 حرف';
  END IF;
  IF p_staff_role NOT IN ('super_admin', 'finance', 'moderator', 'support', 'operations') THEN
    RAISE EXCEPTION 'دور غير معروف: %', p_staff_role;
  END IF;
  IF NOT public.admin_2fa_gate_ok(v_actor) THEN
    RAISE EXCEPTION 'انتهت جلسة التحقق بخطوتين — أعد إدخال الرمز';
  END IF;

  SELECT * INTO v_target FROM public.users WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'المستخدم غير موجود';
  END IF;
  IF v_target.status <> 'active' THEN
    RAISE EXCEPTION 'لا يمكن تكليف حساب غير نشط';
  END IF;
  IF p_user_id = v_actor THEN
    RAISE EXCEPTION 'لا يمكنك تعديل دورك بنفسك';
  END IF;
  -- الإدارة العليا محصّنة: لا يُمنح role super_admin إلا لحساب users.role='super_admin'،
  -- وصفوفهم لا تُسحب كي لا تُغلق اللوحة على أصحابها.
  IF p_staff_role = 'super_admin' AND v_target.role <> 'super_admin' THEN
    RAISE EXCEPTION 'دور super_admin يُمنح فقط لحساب إدارة عليا (users.role = super_admin)';
  END IF;
  IF p_staff_role <> 'super_admin' AND v_target.role NOT IN ('user', 'support', 'admin') THEN
    RAISE EXCEPTION 'التكليف متاح للحسابات العادية/الدعم/الإدارة — لا للمضيفات والوكلاء ومديري الوكالات';
  END IF;

  SELECT * INTO v_old FROM public.admin_staff_roles WHERE user_id = p_user_id;
  INSERT INTO public.admin_staff_roles (user_id, staff_role, is_active, granted_by, granted_at, grant_reason, revoked_by, revoked_at, revoke_reason)
  VALUES (p_user_id, p_staff_role::public.admin_staff_role, true, v_actor, now(), v_reason, NULL, NULL, NULL)
  ON CONFLICT (user_id) DO UPDATE
    SET staff_role = excluded.staff_role,
        is_active = true,
        granted_by = excluded.granted_by,
        granted_at = excluded.granted_at,
        grant_reason = excluded.grant_reason,
        revoked_by = NULL,
        revoked_at = NULL,
        revoke_reason = NULL;

  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, before, after, reason, metadata)
  VALUES (
    v_actor, 'update', 'admin_staff_roles', p_user_id,
    CASE WHEN v_old.user_id IS NULL THEN NULL
         ELSE jsonb_build_object('staff_role', v_old.staff_role::text, 'is_active', v_old.is_active) END,
    jsonb_build_object('staff_role', p_staff_role, 'is_active', true),
    v_reason,
    jsonb_build_object('action_name', 'grant_staff_role')
  );

  RETURN jsonb_build_object('user_id', p_user_id, 'staff_role', p_staff_role, 'granted', true);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_grant_staff_role(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_grant_staff_role(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_revoke_staff_role(
  p_user_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_reason text := NULLIF(btrim(coalesce(p_reason, '')), '');
  v_old public.admin_staff_roles%ROWTYPE;
  v_target_role text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً';
  END IF;
  IF NOT public.admin_staff_can(v_actor, 'staff.manage') THEN
    RAISE EXCEPTION 'لا تملك صلاحية إدارة الموظفين — الإدارة العليا فقط';
  END IF;
  IF v_reason IS NULL OR char_length(v_reason) < 2 OR char_length(v_reason) > 200 THEN
    RAISE EXCEPTION 'سبب إلزامي من 2 إلى 200 حرف';
  END IF;
  IF NOT public.admin_2fa_gate_ok(v_actor) THEN
    RAISE EXCEPTION 'انتهت جلسة التحقق بخطوتين — أعد إدخال الرمز';
  END IF;

  SELECT * INTO v_old FROM public.admin_staff_roles WHERE user_id = p_user_id;
  IF NOT FOUND OR NOT v_old.is_active THEN
    RAISE EXCEPTION 'لا يوجد تكليف نشط لهذا المستخدم';
  END IF;
  SELECT role::text INTO v_target_role FROM public.users WHERE id = p_user_id;
  IF v_target_role = 'super_admin' THEN
    RAISE EXCEPTION 'لا يمكن سحب صلاحيات حساب إدارة عليا محصّن';
  END IF;
  IF p_user_id = v_actor THEN
    RAISE EXCEPTION 'لا يمكنك سحب دورك بنفسك';
  END IF;

  UPDATE public.admin_staff_roles
     SET is_active = false, revoked_by = v_actor, revoked_at = now(), revoke_reason = v_reason
   WHERE user_id = p_user_id AND is_active;

  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, before, after, reason, metadata)
  VALUES (
    v_actor, 'update', 'admin_staff_roles', p_user_id,
    jsonb_build_object('staff_role', v_old.staff_role::text, 'is_active', true),
    jsonb_build_object('staff_role', v_old.staff_role::text, 'is_active', false),
    v_reason,
    jsonb_build_object('action_name', 'revoke_staff_role')
  );

  RETURN jsonb_build_object('user_id', p_user_id, 'revoked', true);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_revoke_staff_role(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_revoke_staff_role(uuid, text) TO authenticated;

-- المصفوفة: عرضها وتعديلها (التعديل للإدارة العليا، ولا يُمس دور super_admin)
CREATE OR REPLACE FUNCTION public.admin_list_role_permissions()
RETURNS TABLE(staff_role text, permission text, category text, description text, allowed boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً';
  END IF;
  IF NOT public.admin_staff_can(v_uid, 'staff.view') THEN
    RAISE EXCEPTION 'لا تملك صلاحية عرض المصفوفة';
  END IF;
  RETURN QUERY
  SELECT r.staff_role::text, c.permission, c.category, c.description,
         coalesce(m.allowed, false)
  FROM public.admin_permission_catalog c
  CROSS JOIN (VALUES ('finance'), ('moderator'), ('support'), ('operations')) AS r(staff_role)
  LEFT JOIN public.admin_role_permissions m
    ON m.permission = c.permission AND m.staff_role::text = r.staff_role
  ORDER BY c.category, c.permission, r.staff_role;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_list_role_permissions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_role_permissions() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_role_permission(
  p_staff_role text,
  p_permission text,
  p_allowed boolean,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_reason text := NULLIF(btrim(coalesce(p_reason, '')), '');
  v_old_allowed boolean;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً';
  END IF;
  IF NOT public.admin_staff_can(v_actor, 'staff.manage') THEN
    RAISE EXCEPTION 'لا تملك صلاحية تعديل المصفوفة — الإدارة العليا فقط';
  END IF;
  IF v_reason IS NULL OR char_length(v_reason) < 2 OR char_length(v_reason) > 200 THEN
    RAISE EXCEPTION 'سبب إلزامي من 2 إلى 200 حرف';
  END IF;
  IF NOT public.admin_2fa_gate_ok(v_actor) THEN
    RAISE EXCEPTION 'انتهت جلسة التحقق بخطوتين — أعد إدخال الرمز';
  END IF;
  IF p_staff_role = 'super_admin' THEN
    RAISE EXCEPTION 'دور الإدارة العليا كامل دائماً ولا يُعدَّل';
  END IF;
  IF p_staff_role NOT IN ('finance', 'moderator', 'support', 'operations') THEN
    RAISE EXCEPTION 'دور غير معروف: %', p_staff_role;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.admin_permission_catalog WHERE permission = p_permission) THEN
    RAISE EXCEPTION 'صلاحية غير معروفة: %', p_permission;
  END IF;

  SELECT allowed INTO v_old_allowed FROM public.admin_role_permissions
  WHERE staff_role = p_staff_role::public.admin_staff_role AND permission = p_permission;

  INSERT INTO public.admin_role_permissions (staff_role, permission, allowed, updated_by, updated_at)
  VALUES (p_staff_role::public.admin_staff_role, p_permission, p_allowed, v_actor, now())
  ON CONFLICT (staff_role, permission) DO UPDATE
    SET allowed = excluded.allowed, updated_by = excluded.updated_by, updated_at = excluded.updated_at;

  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, before, after, reason, metadata)
  VALUES (
    v_actor, 'update', 'admin_role_permissions', NULL,
    jsonb_build_object('staff_role', p_staff_role, 'permission', p_permission, 'allowed', v_old_allowed),
    jsonb_build_object('staff_role', p_staff_role, 'permission', p_permission, 'allowed', p_allowed),
    v_reason,
    jsonb_build_object('action_name', 'set_role_permission')
  );

  RETURN jsonb_build_object('staff_role', p_staff_role, 'permission', p_permission, 'allowed', p_allowed);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_set_role_permission(text, text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_role_permission(text, text, boolean, text) TO authenticated;

-- ملف الموظف نفسه: دوره وصلاحياته وحالة التحقق بخطوتين (لأي مستخدم مصادق، عن نفسه فقط)
CREATE OR REPLACE FUNCTION public.admin_my_staff_profile()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_perms jsonb;
  v_totp jsonb;
  v_required boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً';
  END IF;
  SELECT staff_role::text INTO v_role FROM public.admin_staff_roles WHERE user_id = v_uid AND is_active;
  IF v_role IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT coalesce(jsonb_object_agg(permission, allowed), '{}'::jsonb) INTO v_perms
  FROM public.admin_role_permissions WHERE staff_role::text = v_role;
  SELECT coalesce((value)::boolean, false) INTO v_required
  FROM public.admin_settings WHERE key = 'admin_2fa_required';
  SELECT jsonb_build_object(
    'enabled', t.confirmed_at IS NOT NULL,
    'verified_recently', t.last_verified_at > now() - interval '30 minutes'
  ) INTO v_totp
  FROM public.admin_totp t WHERE t.user_id = v_uid;
  IF v_totp IS NULL THEN
    v_totp := jsonb_build_object('enabled', false, 'verified_recently', false);
  END IF;
  RETURN jsonb_build_object(
    'staff_role', v_role,
    'permissions', v_perms,
    'totp', v_totp,
    'totp_required', coalesce(v_required, false)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_my_staff_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_my_staff_profile() TO authenticated;

-- ============================================================
-- 8) TOTP — التفعيل والتأكيد والتحقق والتعطيل
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_totp_begin()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_secret_hex text;
  v_secret_b32 text;
  v_username text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً';
  END IF;
  IF public.admin_staff_role(v_uid) IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.users WHERE id = v_uid AND role = 'super_admin') THEN
    RAISE EXCEPTION 'هذه الخدمة لحسابات الموظفين فقط';
  END IF;

  IF EXISTS (SELECT 1 FROM public.admin_totp WHERE user_id = v_uid AND confirmed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'التحقق بخطوتين مفعّل مسبقاً — عطّله أولاً';
  END IF;

  v_secret_hex := encode(extensions.gen_random_bytes(20), 'hex');
  v_secret_b32 := public.admin_totp_base32(decode(v_secret_hex, 'hex'));
  SELECT username INTO v_username FROM public.users WHERE id = v_uid;

  INSERT INTO public.admin_totp (user_id, secret_hex, confirmed_at, last_used_step, last_verified_at)
  VALUES (v_uid, v_secret_hex, NULL, NULL, NULL)
  ON CONFLICT (user_id) DO UPDATE
    SET secret_hex = excluded.secret_hex,
        confirmed_at = NULL,
        last_used_step = NULL,
        last_verified_at = NULL;

  RETURN jsonb_build_object(
    'secret_base32', v_secret_b32,
    'otpauth_url', 'otpauth://totp/Wattar:' || coalesce(v_username, v_uid::text)
                   || '?secret=' || v_secret_b32 || '&issuer=Wattar&algorithm=SHA1&digits=6&period=30'
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_totp_begin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_totp_begin() TO authenticated;

-- تحقق من رمز في نافذة ±خطوة دون تحديث الحالة (مشترك بين التأكيد والتحقق)
CREATE OR REPLACE FUNCTION public.admin_totp_check(p_code text, p_user_id uuid)
RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_row public.admin_totp%ROWTYPE;
  v_code text := regexp_replace(upper(btrim(coalesce(p_code, ''))), '\s', '', 'g');
  v_step bigint;
  s bigint;
BEGIN
  IF v_code !~ '^[0-9]{6}$' THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_row FROM public.admin_totp WHERE user_id = p_user_id;
  IF v_row.user_id IS NULL THEN
    RETURN NULL;
  END IF;
  v_step := floor(extract(epoch from clock_timestamp()) / 30)::bigint;
  FOR s IN v_step - 1..v_step + 1 LOOP
    IF s > coalesce(v_row.last_used_step, 0)
       AND public.admin_totp_code(v_row.secret_hex, s) = v_code THEN
      RETURN s;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_totp_check(text, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_totp_confirm(p_code text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_step bigint;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً';
  END IF;
  v_step := public.admin_totp_check(p_code, v_uid);
  IF v_step IS NULL THEN
    RAISE EXCEPTION 'رمز غير صالح أو مستخدم مسبقاً';
  END IF;
  UPDATE public.admin_totp
     SET confirmed_at = now(), last_used_step = v_step, last_verified_at = now()
   WHERE user_id = v_uid;

  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, after, reason, metadata)
  VALUES (v_uid, 'update', 'admin_totp', v_uid,
          jsonb_build_object('totp_enabled', true),
          'تفعيل التحقق بخطوتين للحساب الإداري',
          jsonb_build_object('action_name', 'enable_totp'));

  RETURN jsonb_build_object('confirmed', true, 'verified_until', now() + interval '30 minutes');
END;
$$;
REVOKE ALL ON FUNCTION public.admin_totp_confirm(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_totp_confirm(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_totp_verify(p_code text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_step bigint;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.admin_totp WHERE user_id = v_uid AND confirmed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'التحقق بخطوتين غير مفعّل لهذا الحساب';
  END IF;
  v_step := public.admin_totp_check(p_code, v_uid);
  IF v_step IS NULL THEN
    RAISE EXCEPTION 'رمز غير صالح أو مستخدم مسبقاً';
  END IF;
  UPDATE public.admin_totp
     SET last_used_step = v_step, last_verified_at = now()
   WHERE user_id = v_uid;
  RETURN jsonb_build_object('verified', true, 'verified_until', now() + interval '30 minutes');
END;
$$;
REVOKE ALL ON FUNCTION public.admin_totp_verify(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_totp_verify(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_totp_disable(p_code text, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_reason text := NULLIF(btrim(coalesce(p_reason, '')), '');
  v_step bigint;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً';
  END IF;
  IF v_reason IS NULL OR char_length(v_reason) < 2 OR char_length(v_reason) > 200 THEN
    RAISE EXCEPTION 'سبب إلزامي من 2 إلى 200 حرف';
  END IF;
  v_step := public.admin_totp_check(p_code, v_uid);
  IF v_step IS NULL THEN
    RAISE EXCEPTION 'رمز غير صالح — يلزم رمز صحيح لتعطيل الحماية';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.admin_totp WHERE user_id = v_uid AND confirmed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'التحقق بخطوتين غير مفعّل أصلاً';
  END IF;

  DELETE FROM public.admin_totp WHERE user_id = v_uid;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, before, after, reason, metadata)
  VALUES (v_uid, 'update', 'admin_totp', v_uid,
          jsonb_build_object('totp_enabled', true),
          jsonb_build_object('totp_enabled', false),
          v_reason,
          jsonb_build_object('action_name', 'disable_totp'));
  RETURN jsonb_build_object('disabled', true);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_totp_disable(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_totp_disable(text, text) TO authenticated;

COMMIT;


