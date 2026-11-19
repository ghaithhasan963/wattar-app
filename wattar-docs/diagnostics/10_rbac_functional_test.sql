-- ============================================================
-- diagnostics/10_rbac_functional_test.sql
-- اختبار وظيفي حقيقي لـ M7.1 (RBAC + 2FA — هجرتا #69 و#70).
-- لا يغيّر شيئاً في النهاية: كل شيء داخل BEGIN … ROLLBACK.
-- التشغيل: npx supabase db query --remote=vczyjbqixqzositlkfkn -f <هذا الملف> --yes
-- ============================================================
BEGIN;

CREATE TEMP TABLE _results (step text, expected text, actual text, ok boolean) ON COMMIT DROP;

DO $do$
DECLARE
  v_super1 uuid := '2488de9e-97d9-4fa6-aa0a-856de7189287';
  v_super2 uuid := 'da3c056c-4beb-4f68-9888-03d4e091fc7c';
  v_user1  uuid := 'd62640a7-07c2-4786-984c-be7a52751ab2';
  v_rana   uuid := 'b2a1317c-1a6e-4f29-a0e1-8e82c10422b1';
  v_fake_room uuid := '00000000-0000-0000-0000-000000000001';
  v_js jsonb;
  v_msg text;
  v_ok boolean;
  v_cnt integer;
  v_cnt2 integer;
  v_text text;
  v_secret text;
  v_step bigint;
  v_code_s text;
  v_code_s1 text;
  v_code_s2 text;
  v_word_id uuid;
  v_wait numeric;
  v_total int;
  v_f int;
  v_m int;
  v_s int;
  v_o int;
  v_allowed boolean;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);

  -- ================= فحوص بنيوية =================

  -- T01: نوع الدور
  SELECT array_agg(e.enumlabel ORDER BY e.enumsortorder)::text INTO v_text
  FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
  WHERE t.typname = 'admin_staff_role' AND t.typnamespace = 'public'::regnamespace;
  v_ok := v_text = '{super_admin,finance,moderator,support,operations}';
  INSERT INTO _results VALUES ('T01', '5 أدوار بالترتيب', coalesce(v_text, 'نوع غير موجود'), v_ok);

  -- T02: كتالوج الصلاحيات
  SELECT count(*) INTO v_cnt FROM public.admin_permission_catalog;
  v_ok := v_cnt = 44;
  INSERT INTO _results VALUES ('T02', '44 صلاحية', 'عدد=' || v_cnt, v_ok);

  -- T03: المصفوفة الافتراضية
  SELECT count(*) FILTER (WHERE staff_role::text = 'super_admin' AND allowed)
       + count(*) FILTER (WHERE staff_role::text = 'finance' AND allowed) * 100
       + count(*) FILTER (WHERE staff_role::text = 'moderator' AND allowed) * 10000
       + count(*) FILTER (WHERE staff_role::text = 'support' AND allowed) * 1000000
       + count(*) FILTER (WHERE staff_role::text = 'operations' AND allowed) * 100000000
  INTO v_cnt
  FROM public.admin_role_permissions;
  v_ok := v_cnt = 44 + 14 * 100 + 16 * 10000 + 9 * 1000000 + 19 * 100000000;
  INSERT INTO _results VALUES ('T03', 'super=44 finance=14 moderator=16 support=9 operations=19',
    'مشفّر=' || v_cnt, v_ok);

  -- T04: تكليف bootstrap للإدارة العليا
  SELECT count(*) INTO v_cnt FROM public.admin_staff_roles r
  JOIN public.users u ON u.id = r.user_id
  WHERE u.role = 'super_admin' AND r.is_active AND r.staff_role::text = 'super_admin';
  v_ok := v_cnt = 2;
  INSERT INTO _results VALUES ('T04', 'حسابا الإدارة العليا مكلفان super_admin', 'عدد=' || v_cnt, v_ok);

  -- T05: مفتاح 2FA الافتراضي
  SELECT (value)::boolean INTO v_ok FROM public.admin_settings WHERE key = 'admin_2fa_required';
  v_ok := v_ok IS FALSE;
  INSERT INTO _results VALUES ('T05', 'admin_2fa_required=false', coalesce((v_ok)::text, 'مفتاح غير موجود'), v_ok);

  -- T06: منح التنفيذ (service_role يمر، والبوابات الأخرى مغلقة)
  SELECT count(*) INTO v_cnt FROM (VALUES
    (has_function_privilege('service_role', 'public.admin_staff_role(uuid)', 'EXECUTE')),
    (has_function_privilege('service_role', 'public.admin_staff_can(uuid,text)', 'EXECUTE')),
    (has_function_privilege('service_role', 'public.admin_2fa_gate_ok(uuid,boolean)', 'EXECUTE')),
    (has_function_privilege('service_role', 'public.admin_actor_authorized(uuid,text)', 'EXECUTE')),
    (has_function_privilege('service_role', 'public.edge_required_permissions()', 'EXECUTE')),
    (has_function_privilege('service_role', 'public.settle_deposit_request(uuid,text,uuid,text,text)', 'EXECUTE')),
    (has_function_privilege('service_role', 'public.settle_diamond_withdrawal(uuid,text,uuid,text,text,text)', 'EXECUTE')),
    (has_function_privilege('service_role', 'public.admin_set_user_status(uuid,uuid,text,text)', 'EXECUTE')),
    (has_function_privilege('service_role', 'public.admin_upsert_moderation_word(uuid,text,text,text,uuid,boolean,text)', 'EXECUTE')),
    (has_function_privilege('service_role', 'public.admin_delete_moderation_word(uuid,uuid,text)', 'EXECUTE')),
    (has_function_privilege('authenticated', 'public.admin_room_action(uuid,uuid,text,uuid)', 'EXECUTE')),
    (has_function_privilege('authenticated', 'public.admin_grant_staff_role(uuid,text,text)', 'EXECUTE')),
    (has_function_privilege('authenticated', 'public.admin_totp_begin()', 'EXECUTE')),
    (has_function_privilege('authenticated', 'public.admin_my_staff_profile()', 'EXECUTE'))
  ) p(priv) WHERE NOT p.priv;
  SELECT count(*) INTO v_cnt2 FROM (VALUES
    (has_function_privilege('authenticated', 'public.settle_deposit_request_int(uuid,text,uuid,text,text)', 'EXECUTE')),
    (has_function_privilege('authenticated', 'public.settle_diamond_withdrawal_int(uuid,text,uuid,text,text,text)', 'EXECUTE')),
    (has_function_privilege('authenticated', 'public.edge_required_permissions()', 'EXECUTE')),
    (has_function_privilege('anon', 'public.admin_grant_staff_role(uuid,text,text)', 'EXECUTE')),
    (has_function_privilege('authenticated', 'public.admin_totp_check(text,uuid)', 'EXECUTE')),
    (has_function_privilege('authenticated', 'public.admin_set_user_status(uuid,uuid,text,text)', 'EXECUTE'))
  ) p(priv) WHERE p.priv;
  v_ok := v_cnt = 0 AND v_cnt2 = 0;
  INSERT INTO _results VALUES ('T06', 'منح service_role كاملة + إغلاق ما عداه',
    'نواقص=' || v_cnt || ' تسريبات=' || v_cnt2, v_ok);

  -- ================= مستخدم عادي بلا تكليف (USER1) =================

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user1::text, 'role', 'authenticated')::text, true);

  -- T07: لا ملف موظف
  v_js := NULL; v_msg := NULL;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT public.admin_my_staff_profile() INTO v_js;
  EXCEPTION WHEN others THEN v_msg := SQLERRM;
  END;
  BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
  v_ok := v_js IS NULL AND v_msg IS NULL;
  INSERT INTO _results VALUES ('T07', 'profile=NULL لموظف غير مكلف', coalesce(v_msg, coalesce((v_js)::text, 'NULL')), v_ok);

  -- T08: فحص الصلاحيات
  v_js := NULL;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT jsonb_build_object('u1', public.admin_staff_can(v_user1, 'users.manage'),
                              's1', public.admin_staff_can(v_super1, 'staff.manage')) INTO v_js;
  EXCEPTION WHEN others THEN v_msg := SQLERRM;
  END;
  BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
  v_ok := v_js = '{"s1": true, "u1": false}'::jsonb;
  INSERT INTO _results VALUES ('T08', 'staff_can: مستخدم=false إداري=true', coalesce((v_js)::text, v_msg), v_ok);

  -- T09: عرض الموظفين مرفوض
  v_msg := NULL;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM public.admin_list_staff();
  EXCEPTION WHEN others THEN v_msg := SQLERRM;
  END;
  BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
  v_ok := v_msg LIKE '%لا تملك صلاحية عرض الموظفين%';
  INSERT INTO _results VALUES ('T09', 'رفض عرض الموظفين', coalesce(v_msg, 'لم يُرفض!'), v_ok);

  -- T10: بوابة الشحن
  v_msg := NULL;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM public.settle_deposit_request(NULL, 'approve', v_user1, 'اختبار');
  EXCEPTION WHEN others THEN v_msg := SQLERRM;
  END;
  BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
  v_ok := v_msg LIKE '%صلاحية إدارة الشحن%';
  INSERT INTO _results VALUES ('T10', 'رفض تسوية شحن لغير المالي', coalesce(v_msg, 'لم يُرفض!'), v_ok);

  -- T11: بوابة السحب
  v_msg := NULL;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM public.settle_diamond_withdrawal(NULL, 'approve', v_user1, NULL, NULL, 'اختبار');
  EXCEPTION WHEN others THEN v_msg := SQLERRM;
  END;
  BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
  v_ok := v_msg LIKE '%صلاحية إدارة السحب%';
  INSERT INTO _results VALUES ('T11', 'رفض تسوية سحب لغير المالي', coalesce(v_msg, 'لم يُرفض!'), v_ok);

  -- T12: بوابة أفعال الغرف
  v_msg := NULL;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM public.admin_room_action(v_user1, v_fake_room, 'force_close');
  EXCEPTION WHEN others THEN v_msg := SQLERRM;
  END;
  BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
  v_ok := v_msg LIKE '%صلاحية إدارة الغرف%';
  INSERT INTO _results VALUES ('T12', 'رفض أفعال الغرف لغير المخول', coalesce(v_msg, 'لم يُرفض!'), v_ok);

  -- T13: لا وصول مباشر للجداول (P8)
  v_msg := NULL; v_text := NULL;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT count(*) INTO v_cnt FROM public.admin_staff_roles;
  EXCEPTION WHEN others THEN v_msg := SQLERRM;
  END;
  BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT count(*) INTO v_cnt FROM public.admin_totp;
  EXCEPTION WHEN others THEN v_text := SQLERRM;
  END;
  BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
  v_ok := v_msg LIKE '%permission denied%' AND v_text LIKE '%permission denied%';
  INSERT INTO _results VALUES ('T13', 'قراءة الجداول مرفوضة', coalesce(v_msg, 'مرر!') || ' / ' || coalesce(v_text, 'مرر!'), v_ok);

  -- T14: TOTP لغير الموظفين مرفوض
  v_msg := NULL;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM public.admin_totp_begin();
  EXCEPTION WHEN others THEN v_msg := SQLERRM;
  END;
  BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
  v_ok := v_msg LIKE '%حسابات الموظفين فقط%';
  INSERT INTO _results VALUES ('T14', 'رفض TOTP لغير الموظفين', coalesce(v_msg, 'لم يُرفض!'), v_ok);

  -- ================= الإدارة العليا: إدارة الموظفين =================

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_super1::text, 'role', 'authenticated')::text, true);

  -- T15: ملف الإدارة العليا
  v_js := NULL; v_msg := NULL;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT public.admin_my_staff_profile() INTO v_js;
  EXCEPTION WHEN others THEN v_msg := SQLERRM;
  END;
  BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
  v_ok := v_js IS NOT NULL
    AND v_js->>'staff_role' = 'super_admin'
    AND (v_js->'permissions'->>'staff.manage')::boolean
    AND (v_js->>'totp_required')::boolean = false;
  INSERT INTO _results VALUES ('T15', 'ملف super_admin كامل الصلاحيات', coalesce(v_msg, coalesce((v_js)::text, 'NULL')), v_ok);

  -- T16: منح من مستخدم عادي مرفوض
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user1::text, 'role', 'authenticated')::text, true);
  v_msg := NULL;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM public.admin_grant_staff_role(v_rana, 'support', 'محاولة غير مصرح بها');
  EXCEPTION WHEN others THEN v_msg := SQLERRM;
  END;
  BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
  v_ok := v_msg LIKE '%لا تملك صلاحية إدارة الموظفين%';
  INSERT INTO _results VALUES ('T16', 'رفض منح دور من غير الإدارة', coalesce(v_msg, 'لم يُرفض!'), v_ok);

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_super1::text, 'role', 'authenticated')::text, true);

  -- T17: منح support لمستخدم عادي
  v_js := NULL; v_msg := NULL;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT public.admin_grant_staff_role(v_user1, 'support', 'تكليف دعم للاختبار') INTO v_js;
  EXCEPTION WHEN others THEN v_msg := SQLERRM;
  END;
  BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
  SELECT public.admin_staff_role(v_user1)::text INTO v_text;
  v_ok := v_js IS NOT NULL AND (v_js->>'granted')::boolean AND v_text = 'support';
  INSERT INTO _results VALUES ('T17', 'منح support نجح', coalesce(v_msg, 'دور=' || coalesce(v_text, 'NULL')), v_ok);

  -- T18: تسجيل المنح في سجل التدقيق
  SELECT count(*) INTO v_cnt FROM public.admin_audit_log
  WHERE target_type = 'admin_staff_roles' AND target_id = v_user1
    AND metadata->>'action_name' = 'grant_staff_role'
    AND reason = 'تكليف دعم للاختبار';
  v_ok := v_cnt >= 1;
  INSERT INTO _results VALUES ('T18', 'سطر تدقيق للمنح مع السبب', 'مطابقات=' || v_cnt, v_ok);

  -- T19: منح super_admin لحساب عادي مرفوض
  v_msg := NULL;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM public.admin_grant_staff_role(v_user1, 'super_admin', 'محاولة ترقية مرفوضة');
  EXCEPTION WHEN others THEN v_msg := SQLERRM;
  END;
  BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
  v_ok := v_msg LIKE '%يُمنح فقط لحساب إدارة عليا%';
  INSERT INTO _results VALUES ('T19', 'رفض super_admin لحساب عادي', coalesce(v_msg, 'لم يُرفض!'), v_ok);

  -- T20: منح دور عادي لحساب إدارة عليا مرفوض
  v_msg := NULL;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM public.admin_grant_staff_role(v_super2, 'moderator', 'محاولة تخفيض مرفوضة');
  EXCEPTION WHEN others THEN v_msg := SQLERRM;
  END;
  BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
  v_ok := v_msg LIKE '%التكليف متاح للحسابات%';
  INSERT INTO _results VALUES ('T20', 'رفض تكليف حساب إدارة عليا بدور أدنى', coalesce(v_msg, 'لم يُرفض!'), v_ok);

  -- T21: إعادة تكليف حساب إدارة عليا super_admin (مسار التحديث)
  v_js := NULL; v_msg := NULL;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT public.admin_grant_staff_role(v_super2, 'super_admin', 'إعادة تأكيد التكليف') INTO v_js;
  EXCEPTION WHEN others THEN v_msg := SQLERRM;
  END;
  BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
  v_ok := v_js IS NOT NULL AND (v_js->>'granted')::boolean;
  INSERT INTO _results VALUES ('T21', 'إعادة تكليف super_admin نجحت', coalesce(v_msg, coalesce((v_js)::text, 'NULL')), v_ok);

  -- T22: سحب صلاحيات حساب إدارة عليا محصّن
  v_msg := NULL;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM public.admin_revoke_staff_role(v_super2, 'محاولة سحب محصّن');
  EXCEPTION WHEN others THEN v_msg := SQLERRM;
  END;
  BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
  v_ok := v_msg LIKE '%محصّن%';
  INSERT INTO _results VALUES ('T22', 'رفض سحب حساب إدارة عليا', coalesce(v_msg, 'لم يُرفض!'), v_ok);

  -- T23: سحب الدور الذاتي مرفوض
  v_msg := NULL;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM public.admin_revoke_staff_role(v_super1, 'محاولة ذاتية');
  EXCEPTION WHEN others THEN v_msg := SQLERRM;
  END;
  BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
  v_ok := v_msg LIKE '%محصّن%' OR v_msg LIKE '%لا يمكنك سحب دورك%';
  INSERT INTO _results VALUES ('T23', 'رفض سحب الدور الذاتي (أو حماية الإداري)', coalesce(v_msg, 'لم يُرفض!'), v_ok);

  -- T24: سحب تكليف عادي
  v_js := NULL; v_msg := NULL;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT public.admin_revoke_staff_role(v_user1, 'إنهاء تكليف الاختبار') INTO v_js;
  EXCEPTION WHEN others THEN v_msg := SQLERRM;
  END;
  BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
  SELECT public.admin_staff_role(v_user1)::text INTO v_text;
  v_ok := v_text IS NULL AND v_msg IS NULL;
  INSERT INTO _results VALUES ('T24', 'سحب التكليف نجح', coalesce(v_msg, 'دور بعده=' || coalesce(v_text, 'NULL')), v_ok);

  -- T25: إعادة تكليف بعد السحب (دور moderator)
  v_js := NULL; v_msg := NULL;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT public.admin_grant_staff_role(v_user1, 'moderator', 'تكليف إشراف للاختبار') INTO v_js;
  EXCEPTION WHEN others THEN v_msg := SQLERRM;
  END;
  BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
  SELECT public.admin_staff_role(v_user1)::text INTO v_text;
  v_ok := v_msg IS NULL AND v_text = 'moderator';
  INSERT INTO _results VALUES ('T25', 'إعادة التكليف moderator نجحت', coalesce(v_msg, 'دور=' || coalesce(v_text, 'NULL')), v_ok);

  -- T26: منح RANA دور finance
  v_msg := NULL;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM public.admin_grant_staff_role(v_rana, 'finance', 'تكليف مالي للاختبار');
  EXCEPTION WHEN others THEN v_msg := SQLERRM;
  END;
  BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
  v_ok := v_msg IS NULL;
  INSERT INTO _results VALUES ('T26', 'منح finance لـRANA', coalesce(v_msg, 'نجح'), v_ok);

  -- ================= المصفوفة =================

  -- T27: عرض المصفوفة (44×4 أدوار)
  v_msg := NULL; v_total := 0; v_f := 0; v_m := 0; v_s := 0; v_o := 0;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT count(*),
           count(*) FILTER (WHERE staff_role = 'finance' AND allowed),
           count(*) FILTER (WHERE staff_role = 'moderator' AND allowed),
           count(*) FILTER (WHERE staff_role = 'support' AND allowed),
           count(*) FILTER (WHERE staff_role = 'operations' AND allowed)
    INTO v_total, v_f, v_m, v_s, v_o
    FROM public.admin_list_role_permissions();
  EXCEPTION WHEN others THEN v_msg := SQLERRM;
  END;
  BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
  v_ok := v_msg IS NULL AND v_total = 176 AND v_f = 14 AND v_m = 16 AND v_s = 9 AND v_o = 19;
  INSERT INTO _results VALUES ('T27', '176 صفاً: finance=14 moderator=16 support=9 operations=19',
    coalesce(v_msg, 'صفوف=' || v_total || ' f=' || v_f || ' m=' || v_m || ' s=' || v_s || ' o=' || v_o), v_ok);

  -- T28: تعديل مصفوفة (سحب store.view من support) ثم إعادته
  v_js := NULL; v_msg := NULL; v_allowed := NULL;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT public.admin_set_role_permission('support', 'store.view', false, 'اختبار سحب مؤقت') INTO v_js;
  EXCEPTION WHEN others THEN v_msg := SQLERRM;
  END;
  BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
  SELECT coalesce(allowed, false) INTO v_allowed FROM public.admin_role_permissions
  WHERE staff_role::text = 'support' AND permission = 'store.view';
  v_text := 'allowed=' || v_allowed::text;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM public.admin_set_role_permission('support', 'store.view', true, 'إعادة بعد الاختبار');
  EXCEPTION WHEN others THEN v_msg := SQLERRM;
  END;
  BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
  SELECT coalesce(allowed, false) INTO v_allowed FROM public.admin_role_permissions
  WHERE staff_role::text = 'support' AND permission = 'store.view';
  v_ok := v_js IS NOT NULL AND v_allowed IS TRUE AND v_msg IS NULL AND v_text = 'allowed=false';
  INSERT INTO _results VALUES ('T28', 'تعديل المصفوفة وردّه', v_text || ' ثم allowed=' || v_allowed::text || coalesce(' خطأ=' || v_msg, ''), v_ok);

  -- T29: تعديل مصفوفة super_admin مرفوض
  v_msg := NULL;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM public.admin_set_role_permission('super_admin', 'store.view', false, 'محاولة مرفوضة');
  EXCEPTION WHEN others THEN v_msg := SQLERRM;
  END;
  BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
  v_ok := v_msg LIKE '%لا يُعدَّل%';
  INSERT INTO _results VALUES ('T29', 'رفض تعديل مصفوفة super_admin', coalesce(v_msg, 'لم يُرفض!'), v_ok);

  -- T30: تعديل المصفوفة من moderator مرفوض
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user1::text, 'role', 'authenticated')::text, true);
  v_msg := NULL;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM public.admin_set_role_permission('support', 'store.view', false, 'محاولة غير مصرح بها');
  EXCEPTION WHEN others THEN v_msg := SQLERRM;
  END;
  BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
  v_ok := v_msg LIKE '%لا تملك صلاحية تعديل المصفوفة%';
  INSERT INTO _results VALUES ('T30', 'رفض تعديل المصفوفة من moderator', coalesce(v_msg, 'لم يُرفض!'), v_ok);

  -- ================= الدعم وأفعال الغرف والتسويات =================

  -- T31: moderator طاقم دعم (support.view)
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user1::text, 'role', 'authenticated')::text, true);
  v_js := NULL;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT public.is_wattar_support_staff() INTO v_ok;
  EXCEPTION WHEN others THEN v_msg := SQLERRM;
  END;
  BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
  v_ok := v_ok IS TRUE;
  INSERT INTO _results VALUES ('T31', 'moderator يعد طاقم دعم', coalesce(v_msg, v_ok::text), v_ok);

  -- T32: finance ليس طاقم دعم
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_rana::text, 'role', 'authenticated')::text, true);
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT public.is_wattar_support_staff() INTO v_ok;
  EXCEPTION WHEN others THEN v_ok := false;
  END;
  BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
  v_ok := v_ok IS FALSE;
  INSERT INTO _results VALUES ('T32', 'finance ليس طاقم دعم', v_ok::text, v_ok);

  -- T33: moderator (rooms.manage) يجتاز بوابة الغرف
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user1::text, 'role', 'authenticated')::text, true);
  v_msg := NULL;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM public.admin_room_action(v_user1, v_fake_room, 'force_close');
  EXCEPTION WHEN others THEN v_msg := SQLERRM;
  END;
  BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
  v_ok := v_msg LIKE '%الغرفة غير موجودة%';
  INSERT INTO _results VALUES ('T33', 'moderator يجتاز بوابة الغرف', coalesce(v_msg, 'مر بدون خطأ متوقع!'), v_ok);

  -- T34: finance مرفوض عند أفعال الغرف
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_rana::text, 'role', 'authenticated')::text, true);
  v_msg := NULL;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM public.admin_room_action(v_rana, v_fake_room, 'force_close');
  EXCEPTION WHEN others THEN v_msg := SQLERRM;
  END;
  BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
  v_ok := v_msg LIKE '%صلاحية إدارة الغرف%';
  INSERT INTO _results VALUES ('T34', 'finance مرفوض عند الغرف', coalesce(v_msg, 'لم يُرفض!'), v_ok);

  -- T35: moderator مرفوض عند تسوية الشحن
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user1::text, 'role', 'authenticated')::text, true);
  v_msg := NULL;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM public.settle_deposit_request(NULL, 'approve', v_user1, 'اختبار');
  EXCEPTION WHEN others THEN v_msg := SQLERRM;
  END;
  BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
  v_ok := v_msg LIKE '%صلاحية إدارة الشحن%';
  INSERT INTO _results VALUES ('T35', 'moderator مرفوض عند الشحن', coalesce(v_msg, 'لم يُرفض!'), v_ok);

  -- T36: finance يجتاز بوابة الشحن (لكن القناة المباشرة مغلقة)
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_rana::text, 'role', 'authenticated')::text, true);
  v_msg := NULL;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM public.settle_deposit_request(NULL, 'approve', v_rana, 'اختبار');
  EXCEPTION WHEN others THEN v_msg := SQLERRM;
  END;
  BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
  v_ok := v_msg LIKE '%قناة الإدارة الآمنة%';
  INSERT INTO _results VALUES ('T36', 'finance يجتاز بوابة الشحن', coalesce(v_msg, 'استجابة غير متوقعة'), v_ok);

  -- T37: finance يجتاز بوابة السحب
  v_msg := NULL;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM public.settle_diamond_withdrawal(NULL, 'approve', v_rana, NULL, NULL, 'اختبار');
  EXCEPTION WHEN others THEN v_msg := SQLERRM;
  END;
  BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
  v_ok := v_msg LIKE '%قناة الإدارة الآمنة%';
  INSERT INTO _results VALUES ('T37', 'finance يجتاز بوابة السحب', coalesce(v_msg, 'استجابة غير متوقعة'), v_ok);

  -- T38: انتحال هوية المراجع مرفوض
  v_msg := NULL;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM public.settle_deposit_request(NULL, 'approve', v_user1, 'انتحال');
  EXCEPTION WHEN others THEN v_msg := SQLERRM;
  END;
  BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
  v_ok := v_msg LIKE '%بهوية المستخدم المصادق عليها%';
  INSERT INTO _results VALUES ('T38', 'رفض انتحال هوية المراجع', coalesce(v_msg, 'لم يُرفض!'), v_ok);

  -- ================= مسار service_role (كما تستدعيه دوال Edge) =================

  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);

  -- T39: عبور الشحن إلى الدالة الأصلية
  v_msg := NULL; v_js := NULL;
  BEGIN
    SELECT public.settle_deposit_request(NULL, 'approve', v_rana, 'اختبار') INTO v_js;
  EXCEPTION WHEN others THEN v_msg := SQLERRM;
  END;
  v_ok := v_msg IS NOT NULL
    AND v_msg NOT LIKE '%صلاحية%' AND v_msg NOT LIKE '%قناة الإدارة%' AND v_msg NOT LIKE '%خطوتين%';
  INSERT INTO _results VALUES ('T39', 'service_role يعبر للدالة الأصلية (شحن)', coalesce(v_msg, coalesce((v_js)::text, 'NULL')), v_ok);

  -- T40: عبور السحب إلى الدالة الأصلية
  v_msg := NULL; v_js := NULL;
  BEGIN
    SELECT public.settle_diamond_withdrawal(NULL, 'approve', v_rana, NULL, NULL, 'اختبار') INTO v_js;
  EXCEPTION WHEN others THEN v_msg := SQLERRM;
  END;
  v_ok := v_msg IS NOT NULL
    AND v_msg NOT LIKE '%صلاحية%' AND v_msg NOT LIKE '%قناة الإدارة%' AND v_msg NOT LIKE '%خطوتين%';
  INSERT INTO _results VALUES ('T40', 'service_role يعبر للدالة الأصلية (سحب)', coalesce(v_msg, coalesce((v_js)::text, 'NULL')), v_ok);

  -- T41: حالة المستخدم: moderator (users.manage) عبر مسار الخدمة
  v_js := NULL; v_msg := NULL;
  BEGIN
    SELECT public.admin_set_user_status(v_user1, v_rana, 'suspended', 'اختبار بوابة الموظفين') INTO v_js;
  EXCEPTION WHEN others THEN v_msg := SQLERRM;
  END;
  v_ok := v_js IS NOT NULL AND (v_js->>'status') = 'suspended';
  INSERT INTO _results VALUES ('T41', 'moderator يغير حالة مستخدم (عبر الخدمة)', coalesce(v_msg, coalesce((v_js)::text, 'NULL')), v_ok);

  -- T42: إرجاع الحالة نشطة
  v_js := NULL; v_msg := NULL;
  BEGIN
    SELECT public.admin_set_user_status(v_user1, v_rana, 'active', NULL) INTO v_js;
  EXCEPTION WHEN others THEN v_msg := SQLERRM;
  END;
  v_ok := v_js IS NOT NULL AND (v_js->>'status') = 'active';
  INSERT INTO _results VALUES ('T42', 'إرجاع الحالة نشطة', coalesce(v_msg, coalesce((v_js)::text, 'NULL')), v_ok);

  -- T43: finance (بلا users.manage) مرفوض
  v_msg := NULL;
  BEGIN
    SELECT public.admin_set_user_status(v_rana, v_user1, 'suspended', 'محاولة غير مصرح بها') INTO v_js;
  EXCEPTION WHEN others THEN v_msg := SQLERRM;
  END;
  v_ok := v_msg LIKE '%لا تملك صلاحية تنفيذ هذا الإجراء%';
  INSERT INTO _results VALUES ('T43', 'finance مرفوض عند حالة المستخدم', coalesce(v_msg, 'لم يُرفض!'), v_ok);

  -- T44: كلمات الإشراف: moderator عبر مسار الخدمة
  v_msg := NULL; v_word_id := NULL;
  BEGIN
    SELECT public.admin_upsert_moderation_word(v_user1, 'forbidden', 'كلمةاختبار10', 'medium', NULL, true, 'اختبار RBAC') INTO v_word_id;
  EXCEPTION WHEN others THEN v_msg := SQLERRM;
  END;
  v_ok := v_word_id IS NOT NULL;
  INSERT INTO _results VALUES ('T44', 'moderator يضيف كلمة إشراف', coalesce(v_msg, coalesce(v_word_id::text, 'NULL')), v_ok);

  -- T45: حذف الكلمة
  v_js := NULL; v_msg := NULL;
  BEGIN
    SELECT public.admin_delete_moderation_word(v_user1, v_word_id, 'تنظيف اختبار RBAC') INTO v_js;
  EXCEPTION WHEN others THEN v_msg := SQLERRM;
  END;
  v_ok := v_js IS NOT NULL AND (v_js->>'deleted')::boolean;
  INSERT INTO _results VALUES ('T45', 'حذف كلمة الإشراف', coalesce(v_msg, coalesce((v_js)::text, 'NULL')), v_ok);

  -- T46: finance مرفوض عند كلمات الإشراف
  v_msg := NULL;
  BEGIN
    PERFORM public.admin_upsert_moderation_word(v_rana, 'forbidden', 'كلمةمرفوضة10', 'medium', NULL, true, 'محاولة غير مصرح بها');
  EXCEPTION WHEN others THEN v_msg := SQLERRM;
  END;
  v_ok := v_msg LIKE '%لا تملك صلاحية تنفيذ هذا الإجراء%';
  INSERT INTO _results VALUES ('T46', 'finance مرفوض عند كلمات الإشراف', coalesce(v_msg, 'لم يُرفض!'), v_ok);

  -- ================= TOTP (USER1 moderator) =================

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user1::text, 'role', 'authenticated')::text, true);

  -- T47: بدء التفعيل
  v_js := NULL; v_msg := NULL;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT public.admin_totp_begin() INTO v_js;
  EXCEPTION WHEN others THEN v_msg := SQLERRM;
  END;
  BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
  v_ok := v_js IS NOT NULL
    AND char_length(v_js->>'secret_base32') = 32
    AND v_js->>'otpauth_url' LIKE '%issuer=Wattar%';
  INSERT INTO _results VALUES ('T47', 'بدء TOTP يعيد سراً صالحاً', coalesce(v_msg, coalesce((v_js)::text, 'NULL')), v_ok);

  -- T48: حساب الرموز (سياق المالك)
  SELECT secret_hex INTO v_secret FROM public.admin_totp WHERE user_id = v_user1;
  v_step := floor(extract(epoch FROM now()) / 30)::bigint;
  v_code_s  := public.admin_totp_code(v_secret, v_step);
  v_code_s1 := public.admin_totp_code(v_secret, v_step + 1);
  v_code_s2 := public.admin_totp_code(v_secret, v_step + 2);
  v_ok := v_secret IS NOT NULL AND char_length(v_secret) = 40
    AND char_length(v_code_s) = 6
    AND NOT EXISTS (SELECT 1 FROM public.admin_totp WHERE user_id = v_user1 AND confirmed_at IS NOT NULL);
  INSERT INTO _results VALUES ('T48', 'سر 40 خانة بلا تأكيد + رمز 6 أرقام', 'code=' || coalesce(v_code_s, 'NULL'), v_ok);

  -- T49: تأكيد التفعيل
  v_js := NULL; v_msg := NULL;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT public.admin_totp_confirm(v_code_s) INTO v_js;
  EXCEPTION WHEN others THEN v_msg := SQLERRM;
  END;
  BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
  SELECT confirmed_at IS NOT NULL INTO v_ok FROM public.admin_totp WHERE user_id = v_user1;
  v_ok := v_ok AND v_js IS NOT NULL AND (v_js->>'confirmed')::boolean;
  INSERT INTO _results VALUES ('T49', 'تأكيد TOTP نجح', coalesce(v_msg, coalesce((v_js)::text, 'NULL')), v_ok);

  -- T50: منع إعادة استخدام الرمز
  v_msg := NULL;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM public.admin_totp_verify(v_code_s);
  EXCEPTION WHEN others THEN v_msg := SQLERRM;
  END;
  BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
  v_ok := v_msg LIKE '%مستخدم مسبقاً%';
  INSERT INTO _results VALUES ('T50', 'رفض إعادة استخدام الرمز', coalesce(v_msg, 'لم يُرفض!'), v_ok);

  -- T51: تحقق برمز الخطوة التالية
  v_js := NULL; v_msg := NULL;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT public.admin_totp_verify(v_code_s1) INTO v_js;
  EXCEPTION WHEN others THEN v_msg := SQLERRM;
  END;
  BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
  v_ok := v_js IS NOT NULL AND (v_js->>'verified')::boolean;
  INSERT INTO _results VALUES ('T51', 'تحقق برمز جديد نجح', coalesce(v_msg, coalesce((v_js)::text, 'NULL')), v_ok);

  -- T52: إعادة استخدام رمز الخطوة التالية مرفوضة
  v_msg := NULL;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM public.admin_totp_verify(v_code_s1);
  EXCEPTION WHEN others THEN v_msg := SQLERRM;
  END;
  BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
  v_ok := v_msg LIKE '%مستخدم مسبقاً%';
  INSERT INTO _results VALUES ('T52', 'رفض تكرار الرمز الجديد', coalesce(v_msg, 'لم يُرفض!'), v_ok);

  -- T53: الملف يظهر TOTP مفعّلاً
  v_js := NULL; v_msg := NULL;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT public.admin_my_staff_profile() INTO v_js;
  EXCEPTION WHEN others THEN v_msg := SQLERRM;
  END;
  BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
  v_ok := v_js IS NOT NULL AND (v_js->'totp'->>'enabled')::boolean
    AND (v_js->'totp'->>'verified_recently')::boolean;
  INSERT INTO _results VALUES ('T53', 'الملف يظهر TOTP مفعّلاً', coalesce(v_msg, coalesce((v_js)::text, 'NULL')), v_ok);

  -- ================= فرض 2FA =================

  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
  UPDATE public.admin_settings SET value = 'true'::jsonb, updated_at = now() WHERE key = 'admin_2fa_required';

  -- T54: البوابة بعد التفعيل (بوضع غير صارم: الإداري غير المسجل يُسمح له تمهيدياً)
  SELECT jsonb_build_object('u1', public.admin_2fa_gate_ok(v_user1),
                            'rana', public.admin_2fa_gate_ok(v_rana),
                            's1', public.admin_2fa_gate_ok(v_super1)) INTO v_js;
  v_ok := (v_js->>'u1')::boolean AND NOT (v_js->>'rana')::boolean AND (v_js->>'s1')::boolean;
  INSERT INTO _results VALUES ('T54', 'موظف موثق=نعم، غير مسجل=لا، إداري غير مسجل=نعم (تمهيد)', (v_js)::text, v_ok);

  -- T55: finance غير الموثق يُحجب عند الشحن
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_rana::text, 'role', 'authenticated')::text, true);
  v_msg := NULL;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM public.settle_deposit_request(NULL, 'approve', v_rana, 'اختبار 2FA');
  EXCEPTION WHEN others THEN v_msg := SQLERRM;
  END;
  BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
  v_ok := v_msg LIKE '%التحقق بخطوتين مطلوب%';
  INSERT INTO _results VALUES ('T55', 'حجب غير الموثق عند الشحن', coalesce(v_msg, 'لم يُحجب!'), v_ok);

  -- T56: super غير المسجل يُحجب في القناة الصارمة
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_super1::text, 'role', 'authenticated')::text, true);
  v_msg := NULL;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM public.settle_deposit_request(NULL, 'approve', v_super1, 'اختبار 2FA');
  EXCEPTION WHEN others THEN v_msg := SQLERRM;
  END;
  BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
  v_ok := v_msg LIKE '%التحقق بخطوتين مطلوب%';
  INSERT INTO _results VALUES ('T56', 'حجب super غير الموثق في القناة الصارمة', coalesce(v_msg, 'لم يُحجب!'), v_ok);

  -- T57: إجراءات الموظفين غير الصارمة تبقى متاحة للإداري غير المسجل
  v_js := NULL; v_msg := NULL;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT public.admin_grant_staff_role(v_rana, 'moderator', 'اختبار بوابة غير صارمة') INTO v_js;
  EXCEPTION WHEN others THEN v_msg := SQLERRM;
  END;
  BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
  v_ok := v_js IS NOT NULL AND (v_js->>'granted')::boolean;
  INSERT INTO _results VALUES ('T57', 'إدارة الموظفين بلا قناة صارمة للإداري', coalesce(v_msg, coalesce((v_js)::text, 'NULL')), v_ok);

  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
  UPDATE public.admin_settings SET value = 'false'::jsonb, updated_at = now() WHERE key = 'admin_2fa_required';

  -- ================= تعطيل TOTP وإعادة التسجيل =================

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user1::text, 'role', 'authenticated')::text, true);

  -- T58: تعطيل TOTP برمز صالح (بعد انتظار حدود الخطوة)
  v_wait := 30 - (extract(epoch FROM now())::bigint % 30);
  IF v_wait < 1 THEN v_wait := 1; END IF;
  PERFORM pg_sleep(v_wait + 0.2);
  v_js := NULL; v_msg := NULL;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT public.admin_totp_disable(v_code_s2, 'اختبار تعطيل مؤقت') INTO v_js;
  EXCEPTION WHEN others THEN v_msg := SQLERRM;
  END;
  BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
  SELECT count(*) INTO v_cnt FROM public.admin_totp WHERE user_id = v_user1;
  v_ok := v_js IS NOT NULL AND (v_js->>'disabled')::boolean AND v_cnt = 0;
  INSERT INTO _results VALUES ('T58', 'تعطيل TOTP نجح وحُذف السر', coalesce(v_msg, 'صفوف=' || v_cnt), v_ok);

  -- T59: سطر تدقيق التعطيل
  SELECT count(*) INTO v_cnt FROM public.admin_audit_log
  WHERE target_type = 'admin_totp' AND target_id = v_user1
    AND metadata->>'action_name' = 'disable_totp';
  v_ok := v_cnt = 1;
  INSERT INTO _results VALUES ('T59', 'سطر تدقيق للتعطيل', 'مطابقات=' || v_cnt, v_ok);

  -- T60: التحقق بعد التعطيل مرفوض
  v_msg := NULL;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM public.admin_totp_verify('123456');
  EXCEPTION WHEN others THEN v_msg := SQLERRM;
  END;
  BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
  v_ok := v_msg LIKE '%غير مفعّل%';
  INSERT INTO _results VALUES ('T60', 'رفض التحقق بعد التعطيل', coalesce(v_msg, 'لم يُرفض!'), v_ok);

  -- T61: إعادة التسجيل ممكنة
  v_js := NULL; v_msg := NULL;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT public.admin_totp_begin() INTO v_js;
  EXCEPTION WHEN others THEN v_msg := SQLERRM;
  END;
  BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
  v_ok := v_js IS NOT NULL AND char_length(v_js->>'secret_base32') = 32;
  INSERT INTO _results VALUES ('T61', 'إعادة التسجيل ممكنة', coalesce(v_msg, coalesce((v_js)::text, 'NULL')), v_ok);

  -- ================= تنظيف: سحب التكاليف =================

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_super1::text, 'role', 'authenticated')::text, true);

  -- T62: سحب تكليفي USER1 وRANA
  v_js := NULL; v_msg := NULL;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT public.admin_revoke_staff_role(v_user1, 'نهاية اختبار 10') INTO v_js;
  EXCEPTION WHEN others THEN v_msg := SQLERRM;
  END;
  BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM public.admin_revoke_staff_role(v_rana, 'نهاية اختبار 10');
  EXCEPTION WHEN others THEN v_msg := SQLERRM;
  END;
  BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
  SELECT count(*) INTO v_cnt FROM public.admin_staff_roles WHERE user_id IN (v_user1, v_rana) AND is_active;
  v_ok := v_msg IS NULL AND v_cnt = 0;
  INSERT INTO _results VALUES ('T62', 'سحب تكاليف الاختبار', coalesce(v_msg, 'نشطة=' || v_cnt), v_ok);

  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
END
$do$;

SELECT jsonb_build_object(
  'total', count(*),
  'failed', count(*) FILTER (WHERE NOT ok),
  'steps', jsonb_agg(jsonb_build_object('step', step, 'ok', ok, 'expected', expected, 'actual', actual) ORDER BY step)
) AS summary
FROM _results;

ROLLBACK;
