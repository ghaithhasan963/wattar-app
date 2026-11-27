-- ============================================================
-- diagnostics/14_m8_hosts_contracts_targets_test.sql
-- اختبار وظيفي لترحيل #74 (M8.1–M8.3) داخل BEGIN … ROLLBACK.
-- يغطي: بوابة العمر، اعتماد مستقل، هوية قبل السحب، عقد فردي
-- يسبق العام، الإصدار الجديد بلا أثر رجعي، أهداف ومكافآت مرة واحدة،
-- ومسار ترشيح الوكالة.
-- ============================================================
BEGIN;

CREATE TEMP TABLE _results (step text, expected text, actual text, ok boolean) ON COMMIT DROP;

DO $do$
DECLARE
  v_admin uuid := '2488de9e-97d9-4fa6-aa0a-856de7189287';
  v_user uuid;
  v_user2 uuid;
  v_app uuid;
  v_doc uuid;
  v_host uuid;
  v_ok boolean;
  v_actual text;
  v_result jsonb;
  v_global uuid;
  v_host_contract uuid;
  v_percent numeric;
  v_target uuid;
  v_award integer;
  v_agency uuid;
  v_owner uuid;
  v_gift uuid;
  v_tx uuid;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);

  -- اختيار مستخدمة اختبار غير مضيفة.
  SELECT u.id INTO v_user
  FROM public.users u
  WHERE u.role = 'user' AND u.status = 'active'
    AND NOT EXISTS (SELECT 1 FROM public.verified_hosts h WHERE h.user_id = u.id)
    AND NOT EXISTS (SELECT 1 FROM public.host_applications a WHERE a.user_id = u.id AND a.status IN ('pending','info_requested'))
  ORDER BY u.created_at LIMIT 1;

  IF v_user IS NULL THEN
    INSERT INTO _results VALUES ('T00', 'وجود مستخدمة اختبار', 'لا يوجد', false);
    RETURN;
  END IF;

  -- T01: لا اعتماد قبل تأكيد العمر، ثم اعتماد ناجح مع هوية غير محققة.
  UPDATE public.users SET adult_confirmed_at = NULL, onboarding_completed_at = NULL WHERE id = v_user;
  INSERT INTO public.host_applications (user_id, application_text)
  VALUES (v_user, 'طلب توثيق اختبار M8 لفحص بوابة الاعتماد والهوية قبل السحب — نص كافٍ.')
  RETURNING id INTO v_app;

  BEGIN
    PERFORM public.admin_review_host_application(v_admin, v_app, true, NULL);
    v_ok := false; v_actual := 'اعتُمد بلا شرط عمر — خطأ';
  EXCEPTION WHEN OTHERS THEN
    v_ok := true; v_actual := 'مرفوض: ' || SQLERRM;
  END;
  INSERT INTO _results VALUES ('T01a', 'رفض الاعتماد بلا عمر/ملف', v_actual, v_ok);

  UPDATE public.users SET adult_confirmed_at = now(), onboarding_completed_at = now() WHERE id = v_user;
  BEGIN
    SELECT public.admin_review_host_application(v_admin, v_app, true, NULL) INTO v_result;
    SELECT h.user_id INTO v_host FROM public.verified_hosts h
    WHERE h.user_id = v_user AND h.status = 'active' AND h.identity_status = 'unverified';
    v_ok := (v_result->>'status') = 'approved' AND v_host = v_user;
    v_actual := 'status=' || (v_result->>'status') || ' identity=' || coalesce(v_host::text, 'NULL');
  EXCEPTION WHEN OTHERS THEN
    v_ok := false; v_actual := 'error: ' || SQLERRM;
  END;
  INSERT INTO _results VALUES ('T01b', 'اعتماد ناجح مع هوية غير محققة', v_actual, v_ok);

  -- T02: السحب مرفوض قبل التحقق من الهوية.
  BEGIN
    PERFORM public.create_my_diamond_withdrawal(
      v_user, 30000, 'usdt'::public.deposit_method,
      jsonb_build_object('network', 'trc20', 'address', 'T1234567890123456789012345678901234'),
      'm8-test-withdraw-1');
    v_ok := false; v_actual := 'سُمح بالسحب بلا هوية — خطأ';
  EXCEPTION WHEN OTHERS THEN
    v_ok := position('identity' in SQLERRM) > 0;
    v_actual := SQLERRM;
  END;
  INSERT INTO _results VALUES ('T02', 'منع السحب قبل التحقق من الهوية', v_actual, v_ok);

  -- T03: اعتماد مستند ثم التحقق من الهوية يفتح بوابة السحب.
  INSERT INTO public.host_documents (user_id, application_id, doc_type, file_path, status)
  VALUES (v_user, v_app, 'id_card', 'hostdoc_' || v_user::text || '_test.jpg', 'approved')
  RETURNING id INTO v_doc;

  BEGIN
    SELECT public.admin_verify_host_identity(v_admin, v_user, true, v_doc, NULL) INTO v_result;
    v_ok := (v_result->>'identity_status') = 'verified';
    v_actual := 'identity=' || (v_result->>'identity_status');
  EXCEPTION WHEN OTHERS THEN
    v_ok := false; v_actual := 'error: ' || SQLERRM;
  END;
  INSERT INTO _results VALUES ('T03a', 'التحقق من الهوية بمستند معتمد', v_actual, v_ok);

  BEGIN
    PERFORM public.create_my_diamond_withdrawal(
      v_user, 30000, 'usdt'::public.deposit_method,
      jsonb_build_object('network', 'trc20', 'address', 'T1234567890123456789012345678901234'),
      'm8-test-withdraw-1');
    v_ok := true; v_actual := 'سُمح — لا رصيد كافٍ؟';
  EXCEPTION WHEN OTHERS THEN
    v_ok := position('identity' in SQLERRM) = 0;
    v_actual := SQLERRM;
  END;
  INSERT INTO _results VALUES ('T03b', 'بوابة الهوية لم تعد تمنع السحب', v_actual, v_ok);

  -- T04: العقد الفردي يسبق العام، والتعديل ينشئ إصداراً جديداً بلا أثر رجعي.
  SELECT public.admin_upsert_host_contract(
    v_admin, NULL,
    jsonb_build_object(
      'scope','global','title','العقد العام الاختباري',
      'profit_share_percent', 60, 'platform_commission_percent', 10,
      'agent_commission_percent', 5, 'starts_at', (now() - interval '2 hours')::text,
      'status','active'
    ), 'تهيئة اختبار') INTO v_result;
  v_global := (v_result->>'id')::uuid;

  SELECT public.admin_upsert_host_contract(
    v_admin, NULL,
    jsonb_build_object(
      'scope','host','host_user_id', v_user, 'title','عقد فردي اختباري',
      'profit_share_percent', 70, 'platform_commission_percent', 15,
      'agent_commission_percent', 0, 'starts_at', (now() - interval '1 hour')::text,
      'status','active'
    ), 'تهيئة اختبار') INTO v_result;
  v_host_contract := (v_result->>'id')::uuid;

  v_ok := (public.effective_host_contract(v_user, now())->>'id')::uuid = v_host_contract;
  v_actual := 'effective=' || coalesce(public.effective_host_contract(v_user, now())->>'scope', 'NULL');
  INSERT INTO _results VALUES ('T04a', 'العقد الفردي يسبق العام', v_actual, v_ok);

  SELECT public.admin_upsert_host_contract(
    v_admin, v_host_contract,
    jsonb_build_object(
      'scope','host','host_user_id', v_user, 'title','عقد فردي معدّل',
      'profit_share_percent', 70, 'platform_commission_percent', 25,
      'agent_commission_percent', 0, 'status','active'
    ), 'تعديل اختباري') INTO v_result;

  SELECT (public.effective_host_contract(v_user, now())->>'platform_commission_percent')::numeric INTO v_percent;
  v_ok := v_percent = 25 AND (v_result->>'version')::int = 2;
  v_actual := 'platform=' || v_percent || ' version=' || (v_result->>'version');
  INSERT INTO _results VALUES ('T04b', 'تعديل العقد ينشئ إصداراً جديداً', v_actual, v_ok);

  SELECT (public.effective_host_contract(v_user, now() - interval '30 minutes')->>'platform_commission_percent')::numeric INTO v_percent;
  v_ok := v_percent = 15;
  v_actual := 'platform_before=' || coalesce(v_percent::text, 'NULL');
  INSERT INTO _results VALUES ('T04c', 'لا أثر رجعي: الفترة السابقة تحتفظ بالعقد القديم', v_actual, v_ok);

  -- T05: هدف شهري يُصرف مرة واحدة فقط.
  INSERT INTO public.host_targets (
    period_month, scope, host_user_id, metric, target_value, reward_type, reward_amount
  ) VALUES (
    date_trunc('month', now())::date, 'host', v_user, 'gift_value', 100, 'coin', 100
  ) ON CONFLICT DO NOTHING
  RETURNING id INTO v_target;
  IF v_target IS NULL THEN
    SELECT id INTO v_target FROM public.host_targets
    WHERE period_month = date_trunc('month', now())::date AND scope='host'
      AND host_user_id=v_user AND metric='gift_value';
  END IF;

  SELECT g.id INTO v_gift FROM public.gifts g WHERE g.is_active LIMIT 1;

  INSERT INTO public.gift_transactions (
    gift_id, from_user_id, to_user_id, quantity, total_gold, received_diamond,
    idempotency_key, funding_currency, received_diamond_currency, commission_breakdown
  ) VALUES (
    v_gift, v_admin, v_user, 1, 150, 150,
    'm8-test-gift-' || gen_random_uuid()::text, 'gold', 'diamond', '{}'::jsonb
  );

  SELECT public.admin_evaluate_host_targets(v_admin, date_trunc('month', now())::date) INTO v_result;
  v_award := (v_result->>'awarded_count')::int;
  SELECT count(*) INTO v_ok FROM public.host_target_awards a
  WHERE a.target_id = v_target AND a.host_user_id = v_user;
  v_ok := v_ok = 1 AND v_award = 1;
  v_actual := 'awards=' || v_ok || ' awarded_count=' || v_award;
  INSERT INTO _results VALUES ('T05a', 'صرف مكافأة الهدف مرة واحدة', v_actual, v_ok);

  SELECT public.admin_evaluate_host_targets(v_admin, date_trunc('month', now())::date) INTO v_result;
  SELECT count(*) INTO v_award FROM public.host_target_awards a
  WHERE a.target_id = v_target AND a.host_user_id = v_user;
  v_ok := v_award = 1 AND (v_result->>'awarded_count')::int = 0;
  v_actual := 'awards=' || v_award || ' second_run=' || (v_result->>'awarded_count');
  INSERT INTO _results VALUES ('T05b', 'منع ازدواج صرف المكافأة', v_actual, v_ok);

  -- T06: مسار الوكالة مع اعتماد تلقائي ضمن الصلاحيات.
  SELECT u.id INTO v_owner FROM public.users u
  WHERE u.status='active' AND u.id <> v_admin ORDER BY u.created_at LIMIT 1;
  INSERT INTO public.agencies (name, status, owner_user_id, can_approve_hosts)
  VALUES ('وكالة اختبار M8', 'active', v_owner, true)
  RETURNING id INTO v_agency;

  SELECT u.id INTO v_user2 FROM public.users u
  WHERE u.role='user' AND u.status='active' AND u.id <> v_user AND u.id <> v_owner
    AND NOT EXISTS (SELECT 1 FROM public.verified_hosts h WHERE h.user_id = u.id)
  ORDER BY u.created_at LIMIT 1;

  IF v_user2 IS NOT NULL THEN
    INSERT INTO public.admin_settings (key, value) VALUES ('agency_host_auto_approve', 'true'::jsonb)
    ON CONFLICT (key) DO UPDATE SET value='true'::jsonb;

    PERFORM set_config('request.jwt.claims',
      jsonb_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);

    BEGIN
      SELECT public.agency_nominate_host(v_agency, v_user2, 'ترشيح وكالة اختباري M8 لنص كافٍ.') INTO v_result;
      v_ok := (v_result->>'auto_approved')::boolean
        AND EXISTS (SELECT 1 FROM public.verified_hosts h WHERE h.user_id=v_user2 AND h.source='agency');
      v_actual := 'auto=' || (v_result->>'auto_approved');
    EXCEPTION WHEN OTHERS THEN
      v_ok := false; v_actual := 'error: ' || SQLERRM;
    END;
    INSERT INTO _results VALUES ('T06', 'ترشيح الوكالة يعتمد تلقائياً ضمن صلاحياتها', v_actual, v_ok);
  ELSE
    INSERT INTO _results VALUES ('T06', 'وجود مستخدمة ثانية للاختبار', 'لا يوجد', false);
  END IF;

  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
END $do$;

SELECT * FROM _results ORDER BY step;

ROLLBACK;
