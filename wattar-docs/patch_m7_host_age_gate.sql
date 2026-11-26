-- ============================================================
-- patch_m7_host_age_gate.sql — migration #73 (M7.4 فحص العمر)
--
-- المشكلة: `admin_review_host_application` كانت تعتمد طلب التوثيق
-- دون التحقق من تأكيد العمر وإكمال الملف على الخادم. الواجهة كانت
-- تُعطّل الزر، لكن أي استدعاء مباشر للدالة (أو نسخة واجهة قديمة)
-- كان يستطيع اعتماد حساب دون تأكيد العمر.
--
-- الإصلاح: عند `p_approve = true` فقط، يُشترط:
--   adult_confirmed_at IS NOT NULL AND onboarding_completed_at IS NOT NULL
-- الرفض يبقى مسموحاً بلا هذا الشرط (قد يُرفض طلب ناقص).
-- ============================================================
BEGIN;

SELECT set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, false);
SET search_path = public, extensions;

CREATE OR REPLACE FUNCTION public.admin_review_host_application(
  p_admin_id uuid,
  p_application_id uuid,
  p_approve boolean,
  p_review_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin public.users%ROWTYPE;
  v_application public.host_applications%ROWTYPE;
  v_user public.users%ROWTYPE;
  v_note text := nullif(btrim(p_review_note), '');
  v_status text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'غير مصرح بتنفيذ الإجراء الإداري';
  END IF;
  IF p_admin_id IS NULL OR p_application_id IS NULL OR p_approve IS NULL THEN
    RAISE EXCEPTION 'بيانات مراجعة الطلب غير مكتملة';
  END IF;
  IF (NOT p_approve AND v_note IS NULL)
     OR (v_note IS NOT NULL AND char_length(v_note) > 500) THEN
    RAISE EXCEPTION 'أدخل سببًا للرفض لا يتجاوز 500 حرف';
  END IF;

  SELECT * INTO v_admin
  FROM public.users
  WHERE id = p_admin_id
  FOR UPDATE;
  IF NOT FOUND OR v_admin.status <> 'active'
     OR v_admin.role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'لا تملك صلاحية مراجعة الطلبات';
  END IF;

  SELECT * INTO v_application
  FROM public.host_applications
  WHERE id = p_application_id
  FOR UPDATE;
  IF NOT FOUND OR v_application.status <> 'pending' THEN
    RAISE EXCEPTION 'الطلب غير موجود أو تمت مراجعته مسبقًا';
  END IF;

  SELECT * INTO v_user
  FROM public.users
  WHERE id = v_application.user_id
  FOR UPDATE;
  IF NOT FOUND OR v_user.status <> 'active' OR v_user.role <> 'user' THEN
    RAISE EXCEPTION 'حساب المتقدمة غير نشط';
  END IF;

  -- بوابة العمر: لا اعتماد توثيق قبل تأكيد العمر وإكمال الملف.
  IF p_approve
     AND (v_user.adult_confirmed_at IS NULL OR v_user.onboarding_completed_at IS NULL) THEN
    RAISE EXCEPTION 'لا يمكن اعتماد التوثيق قبل تأكيد العمر وإكمال الملف الشخصي';
  END IF;

  v_status := CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END;
  UPDATE public.host_applications
  SET status = v_status,
      review_note = v_note,
      reviewed_by = p_admin_id,
      reviewed_at = now()
  WHERE id = p_application_id;

  IF p_approve THEN
    INSERT INTO public.verified_hosts (user_id, status, approved_by, approved_at)
    VALUES (v_user.id, 'active', p_admin_id, now())
    ON CONFLICT (user_id) DO UPDATE
      SET status = 'active',
          approved_by = EXCLUDED.approved_by,
          approved_at = EXCLUDED.approved_at;
  END IF;

  INSERT INTO public.admin_audit_log (
    admin_id, action, target_type, target_id, before, after, metadata
  ) VALUES (
    p_admin_id,
    CASE WHEN p_approve THEN 'approve'::public.audit_action_type
      ELSE 'reject'::public.audit_action_type END,
    'host_application',
    p_application_id,
    jsonb_build_object('status', v_application.status),
    jsonb_build_object('status', v_status, 'user_id', v_user.id),
    jsonb_build_object('review_note', v_note)
  );

  RETURN jsonb_build_object(
    'application_id', p_application_id,
    'user_id', v_user.id,
    'status', v_status
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_review_host_application(uuid, uuid, boolean, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_review_host_application(uuid, uuid, boolean, text)
  TO service_role;

COMMIT;
