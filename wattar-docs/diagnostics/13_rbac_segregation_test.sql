-- ============================================================
-- diagnostics/13_rbac_segregation_test.sql
-- بوابة M7: عزل الصلاحيات بين أدوار الموظفين (ثلاث تجارب موظفين).
--
-- يتحقق أن كل دور يرى/ينفّذ ما يخصه فقط عبر الدالة الفعلية
-- admin_staff_can التي تستخدمها كل دوال الحافة، وليس عبر نسخة موازية
-- من المصفوفة. يُستخدم موظف موجود ويُبدَّل دوره داخل المعاملة ثم يُعاد
-- كل شيء بـ ROLLBACK، فلا يتغيّر شيء في الإنتاج.
-- ============================================================
BEGIN;

CREATE TEMP TABLE _results (step text, expected text, actual text, ok boolean) ON COMMIT DROP;

DO $do$
DECLARE
  v_staff uuid;
  v_ok boolean;
  v_role public.admin_staff_role;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);

  SELECT user_id INTO v_staff
  FROM public.admin_staff_roles
  WHERE is_active
  ORDER BY granted_at
  LIMIT 1;

  IF v_staff IS NULL THEN
    INSERT INTO _results VALUES ('T00', 'وجود موظف فعّال لاختبار الأدوار', 'لا يوجد', false);
    RETURN;
  END IF;

  -- T01 — دعم: يرى التذاكر فقط، لا محافظ ولا إعدادات ولا موظفين.
  UPDATE public.admin_staff_roles SET staff_role = 'support' WHERE user_id = v_staff;
  v_ok := public.admin_staff_can(v_staff, 'support.manage')
      AND NOT public.admin_staff_can(v_staff, 'wallets.manage')
      AND NOT public.admin_staff_can(v_staff, 'settings.manage')
      AND NOT public.admin_staff_can(v_staff, 'staff.manage')
      AND NOT public.admin_staff_can(v_staff, 'users.manage');
  INSERT INTO _results VALUES ('T01', 'دعم: تذاكر فقط بلا محافظ/إعدادات/موظفين',
    format('support.manage=%s wallets.manage=%s settings.manage=%s staff.manage=%s users.manage=%s',
      public.admin_staff_can(v_staff, 'support.manage'),
      public.admin_staff_can(v_staff, 'wallets.manage'),
      public.admin_staff_can(v_staff, 'settings.manage'),
      public.admin_staff_can(v_staff, 'staff.manage'),
      public.admin_staff_can(v_staff, 'users.manage')), v_ok);

  -- T02 — إشراف: يدير المستخدمين والكلمات، لا يمسّ المال ولا الإعدادات.
  UPDATE public.admin_staff_roles SET staff_role = 'moderator' WHERE user_id = v_staff;
  v_ok := public.admin_staff_can(v_staff, 'users.manage')
      AND public.admin_staff_can(v_staff, 'moderation.manage')
      AND NOT public.admin_staff_can(v_staff, 'wallets.manage')
      AND NOT public.admin_staff_can(v_staff, 'deposits.manage')
      AND NOT public.admin_staff_can(v_staff, 'settings.manage');
  INSERT INTO _results VALUES ('T02', 'إشراف: مستخدمون/كلمات بلا مال أو إعدادات',
    format('users.manage=%s moderation.manage=%s wallets.manage=%s deposits.manage=%s settings.manage=%s',
      public.admin_staff_can(v_staff, 'users.manage'),
      public.admin_staff_can(v_staff, 'moderation.manage'),
      public.admin_staff_can(v_staff, 'wallets.manage'),
      public.admin_staff_can(v_staff, 'deposits.manage'),
      public.admin_staff_can(v_staff, 'settings.manage')), v_ok);

  -- T03 — مالية: تدير المحافظ والشحن والسحب، لا تدير الموظفين ولا الإشراف.
  UPDATE public.admin_staff_roles SET staff_role = 'finance' WHERE user_id = v_staff;
  v_ok := public.admin_staff_can(v_staff, 'wallets.manage')
      AND public.admin_staff_can(v_staff, 'deposits.manage')
      AND public.admin_staff_can(v_staff, 'withdrawals.manage')
      AND NOT public.admin_staff_can(v_staff, 'staff.manage')
      AND NOT public.admin_staff_can(v_staff, 'moderation.manage')
      AND NOT public.admin_staff_can(v_staff, 'users.manage');
  INSERT INTO _results VALUES ('T03', 'مالية: محافظ/شحن/سحب بلا موظفين أو إشراف',
    format('wallets.manage=%s deposits.manage=%s withdrawals.manage=%s staff.manage=%s moderation.manage=%s users.manage=%s',
      public.admin_staff_can(v_staff, 'wallets.manage'),
      public.admin_staff_can(v_staff, 'deposits.manage'),
      public.admin_staff_can(v_staff, 'withdrawals.manage'),
      public.admin_staff_can(v_staff, 'staff.manage'),
      public.admin_staff_can(v_staff, 'moderation.manage'),
      public.admin_staff_can(v_staff, 'users.manage')), v_ok);

  -- T04 — عمليات: إعدادات للعرض فقط، والصلاحية الحسّاسة settings.manage ممنوعة.
  UPDATE public.admin_staff_roles SET staff_role = 'operations' WHERE user_id = v_staff;
  v_ok := public.admin_staff_can(v_staff, 'settings.view')
      AND public.admin_staff_can(v_staff, 'maintenance.mode')
      AND NOT public.admin_staff_can(v_staff, 'settings.manage')
      AND NOT public.admin_staff_can(v_staff, 'staff.manage')
      AND NOT public.admin_staff_can(v_staff, 'wallets.manage');
  INSERT INTO _results VALUES ('T04', 'عمليات: عرض إعدادات وصيانة بلا تعديل أو مال',
    format('settings.view=%s maintenance.mode=%s settings.manage=%s staff.manage=%s wallets.manage=%s',
      public.admin_staff_can(v_staff, 'settings.view'),
      public.admin_staff_can(v_staff, 'maintenance.mode'),
      public.admin_staff_can(v_staff, 'settings.manage'),
      public.admin_staff_can(v_staff, 'staff.manage'),
      public.admin_staff_can(v_staff, 'wallets.manage')), v_ok);

  -- T05 — مدير أعلى: كل شيء مسموح.
  UPDATE public.admin_staff_roles SET staff_role = 'super_admin' WHERE user_id = v_staff;
  v_ok := public.admin_staff_can(v_staff, 'staff.manage')
      AND public.admin_staff_can(v_staff, 'wallets.manage')
      AND public.admin_staff_can(v_staff, 'settings.manage')
      AND public.admin_staff_can(v_staff, 'moderation.manage');
  INSERT INTO _results VALUES ('T05', 'مدير أعلى: كل الصلاحيات',
    format('staff=%s wallets=%s settings=%s moderation=%s',
      public.admin_staff_can(v_staff, 'staff.manage'),
      public.admin_staff_can(v_staff, 'wallets.manage'),
      public.admin_staff_can(v_staff, 'settings.manage'),
      public.admin_staff_can(v_staff, 'moderation.manage')), v_ok);

  -- T06 — تعطيل الموظف يُلغي كل صلاحياته فوراً (حتى لو بقي دوره مديراً أعلى).
  UPDATE public.admin_staff_roles SET is_active = false WHERE user_id = v_staff;
  v_ok := NOT public.admin_staff_can(v_staff, 'staff.manage')
      AND NOT public.admin_staff_can(v_staff, 'wallets.manage')
      AND NOT public.admin_staff_can(v_staff, 'dashboard.view')
      AND public.admin_staff_role(v_staff) IS NULL;
  INSERT INTO _results VALUES ('T06', 'تعطيل الموظف يلغي كل صلاحياته فوراً',
    format('staff=%s wallets=%s dashboard=%s role=%s',
      public.admin_staff_can(v_staff, 'staff.manage'),
      public.admin_staff_can(v_staff, 'wallets.manage'),
      public.admin_staff_can(v_staff, 'dashboard.view'),
      coalesce(public.admin_staff_role(v_staff)::text, 'NULL')), v_ok);

  -- T07 — تعليق حساب المستخدم نفسه يُلغي الصلاحيات أيضاً.
  UPDATE public.admin_staff_roles SET is_active = true, staff_role = 'super_admin' WHERE user_id = v_staff;
  UPDATE public.users SET status = 'suspended' WHERE id = v_staff;
  v_ok := NOT public.admin_staff_can(v_staff, 'staff.manage');
  INSERT INTO _results VALUES ('T07', 'تعليق حساب الموظف يلغي صلاحياته',
    format('staff.manage=%s', public.admin_staff_can(v_staff, 'staff.manage')), v_ok);

  -- T08 — صلاحية غير موجودة في الكتالوج لا تُمنح افتراضياً.
  UPDATE public.users SET status = 'active' WHERE id = v_staff;
  UPDATE public.admin_staff_roles SET staff_role = 'support' WHERE user_id = v_staff;
  v_ok := NOT public.admin_staff_can(v_staff, 'nonexistent.permission');
  INSERT INTO _results VALUES ('T08', 'صلاحية غير معروفة تُرفض',
    format('nonexistent=%s', public.admin_staff_can(v_staff, 'nonexistent.permission')), v_ok);

  SELECT bool_and(ok) INTO v_ok FROM _results;
  RAISE NOTICE '=== نتيجة عزل الصلاحيات: % ===', v_ok;
END $do$;

SELECT * FROM _results ORDER BY step;

ROLLBACK;
