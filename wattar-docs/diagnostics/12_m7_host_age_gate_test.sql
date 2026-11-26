-- ============================================================
-- diagnostics/12_m7_host_age_gate_test.sql
-- اختبار وظيفي لترحيل #73: لا اعتماد توثيق قبل تأكيد العمر وإكمال الملف.
-- كل شيء داخل BEGIN … ROLLBACK فلا يغيّر شيئًا في النهاية.
-- ============================================================
BEGIN;

CREATE TEMP TABLE _results (step text, expected text, actual text, ok boolean) ON COMMIT DROP;

DO $do$
DECLARE
  v_admin uuid := '2488de9e-97d9-4fa6-aa0a-856de7189287';
  v_user uuid;
  v_app uuid;
  v_ok boolean;
  v_actual text;
  v_result jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);

  -- اختيار مستخدم نشط بدور user، ليس مضيفة ولا لديه طلب معلّق.
  SELECT u.id INTO v_user
  FROM public.users u
  WHERE u.role = 'user'
    AND u.status = 'active'
    AND u.id <> v_admin
    AND NOT EXISTS (
      SELECT 1 FROM public.host_applications a
      WHERE a.user_id = u.id AND a.status = 'pending'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.verified_hosts h WHERE h.user_id = u.id
    )
  ORDER BY u.created_at
  LIMIT 1;

  IF v_user IS NULL THEN
    INSERT INTO _results VALUES ('T00', 'وجود مستخدم اختبار مناسب', 'لا يوجد مستخدم مناسب', false);
    RETURN;
  END IF;

  -- تهيئة: مستخدم بلا تأكيد عمر ولا ملف مكتمل + طلب معلّق.
  UPDATE public.users
  SET adult_confirmed_at = NULL,
      onboarding_completed_at = NULL
  WHERE id = v_user;

  INSERT INTO public.host_applications (user_id, application_text)
  VALUES (v_user, 'طلب توثيق اختباري لفحص بوابة العمر قبل الاعتماد — نص تجريبي كافٍ للحد الأدنى.')
  RETURNING id INTO v_app;

  -- T01: الاعتماد مرفوض قبل تأكيد العمر وإكمال الملف.
  BEGIN
    SELECT public.admin_review_host_application(v_admin, v_app, true, NULL) INTO v_result;
    v_ok := false;
    v_actual := 'تم الاعتماد — خطأ';
  EXCEPTION WHEN OTHERS THEN
    v_ok := true;
    v_actual := 'مرفوض كما هو متوقع: ' || SQLERRM;
  END;
  INSERT INTO _results VALUES ('T01', 'رفض الاعتماد بلا تأكيد عمر/ملف', v_actual, v_ok);

  -- T02: بعد تأكيد العمر وإكمال الملف يُقبل الاعتماد.
  UPDATE public.users
  SET adult_confirmed_at = now(),
      onboarding_completed_at = now()
  WHERE id = v_user;
  BEGIN
    SELECT public.admin_review_host_application(v_admin, v_app, true, NULL) INTO v_result;
    v_ok := (v_result->>'status') = 'approved'
        AND EXISTS (SELECT 1 FROM public.verified_hosts h WHERE h.user_id = v_user AND h.status = 'active');
    v_actual := 'status=' || (v_result->>'status');
  EXCEPTION WHEN OTHERS THEN
    v_ok := false;
    v_actual := 'error: ' || SQLERRM;
  END;
  INSERT INTO _results VALUES ('T02', 'قبول الاعتماد بعد استيفاء الشرطين', v_actual, v_ok);

  -- T03: الرفض يبقى مسموحاً حتى لو كان العمر غير مؤكد.
  UPDATE public.host_applications SET status = 'pending', reviewed_at = NULL WHERE id = v_app;
  UPDATE public.users SET adult_confirmed_at = NULL WHERE id = v_user;
  BEGIN
    SELECT public.admin_review_host_application(v_admin, v_app, false, 'رفض اختباري لطلب ناقص') INTO v_result;
    v_ok := (v_result->>'status') = 'rejected';
    v_actual := 'status=' || (v_result->>'status');
  EXCEPTION WHEN OTHERS THEN
    v_ok := false;
    v_actual := 'error: ' || SQLERRM;
  END;
  INSERT INTO _results VALUES ('T03', 'الرفض مسموح بلا شرط العمر', v_actual, v_ok);

  SELECT bool_and(ok) INTO v_ok FROM _results;
  RAISE NOTICE '=== نتيجة اختبار بوابة العمر: % ===', v_ok;
END $do$;

SELECT * FROM _results ORDER BY step;

ROLLBACK;
