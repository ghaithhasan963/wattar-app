-- ============================================================
-- diagnostics/21_m9_notifications_test.sql
-- اختبار وظيفي لترحيل #81 (M9.3 — الإشعارات) داخل BEGIN … ROLLBACK.
-- يغطي: كتالوج الأنواع، تفضيلات المستخدم، بوابة إشعارات التطبيق،
-- منع تعطيل الأنواع الإلزامية، طابور الدفع ومنع تكراره، سحب دفعة
-- وإكمالها، والحملات الإدارية بصلاحية وسبب وتدقيق وبلا تكرار.
-- ============================================================
BEGIN;

CREATE TEMP TABLE _results (step text, expected text, actual text, ok boolean) ON COMMIT DROP;

DO $do$
DECLARE
  v_admin uuid := '2488de9e-97d9-4fa6-aa0a-856de7189287';
  v_a uuid;
  v_type_count integer;
  v_res jsonb;
  v_cnt integer;
  v_ok boolean;
  v_actual text;
  v_pref jsonb;
  v_queue_id uuid;
  v_campaign uuid;
  v_campaign_status text;
  v_ref uuid := gen_random_uuid();
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);

  SELECT u.id INTO v_a FROM public.users u
  WHERE u.status = 'active' AND u.role = 'user'
  ORDER BY u.created_at LIMIT 1;
  IF v_a IS NULL THEN
    INSERT INTO _results VALUES ('T00', 'وجود مستخدم اختبار', 'لا يوجد', false);
    RETURN;
  END IF;
  DELETE FROM public.user_notification_preferences WHERE user_id = v_a;

  -- T01: كتالوج الأنواع
  SELECT count(*) INTO v_type_count FROM public.notification_type_catalog WHERE is_active;
  v_ok := v_type_count >= 23
    AND EXISTS (SELECT 1 FROM public.notification_type_catalog WHERE event_type = 'broadcast');
  INSERT INTO _results VALUES ('T01', 'كتالوج الأنواع مكتمل ويشمل broadcast',
    'types=' || v_type_count, v_ok);

  -- T02: التفضيلات الافتراضية لكل نوع
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_a::text, 'role', 'authenticated')::text, true);
  v_res := public.get_my_notification_preferences();
  v_ok := jsonb_array_length(v_res) = v_type_count
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_res) e
      WHERE (e ->> 'is_default')::boolean IS DISTINCT FROM true
         OR (e ->> 'in_app')::boolean IS DISTINCT FROM true
    );
  INSERT INTO _results VALUES ('T02', 'التفضيلات الافتراضية مفعّلة بلا استثناء',
    'rows=' || jsonb_array_length(v_res), v_ok);

  -- T03: تعديل تفضيل الدفع
  v_pref := public.set_my_notification_preference('private_message', true, false);
  v_ok := (v_pref ->> 'push')::boolean = false
    AND (SELECT count(*) FROM public.user_notification_preferences
         WHERE user_id = v_a AND event_type = 'private_message' AND push = false) = 1;
  INSERT INTO _results VALUES ('T03', 'تعطيل دفع نوع واحد يُحفظ', v_pref::text, v_ok);

  -- T04: تعطيل إشعار التطبيق يمنع إنشاء الصف
  PERFORM public.set_my_notification_preference('gift_received', false, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
  INSERT INTO public.user_notifications (user_id, actor_id, event_type, reference_id, title, body, route)
  VALUES (v_a, NULL, 'gift_received', gen_random_uuid(), 'هدية', 'هدية تجريبية', '/(tabs)/wallet');
  SELECT count(*) INTO v_cnt FROM public.user_notifications
  WHERE user_id = v_a AND event_type = 'gift_received';
  v_ok := v_cnt = 0;
  INSERT INTO _results VALUES ('T04', 'تعطيل إشعار التطبيق يمنع الصف', 'rows=' || v_cnt, v_ok);

  -- T05: النوع الإلزامي لا يُعطَّل داخل التطبيق
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_a::text, 'role', 'authenticated')::text, true);
  v_ok := true;
  v_actual := '';
  BEGIN
    PERFORM public.set_my_notification_preference('deposit_update', false, true);
    v_ok := false;
    v_actual := 'قُبل تعطيل نوع إلزامي — خطأ';
  EXCEPTION WHEN OTHERS THEN
    v_ok := position('لا يمكن تعطيل' in SQLERRM) > 0;
    v_actual := SQLERRM;
  END;
  INSERT INTO _results VALUES ('T05', 'منع تعطيل إشعار مالي داخل التطبيق', v_actual, v_ok);

  -- T06: طابور الدفع + منع التكرار
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
  INSERT INTO public.user_notifications (user_id, actor_id, event_type, reference_id, title, body, route)
  VALUES (v_a, NULL, 'new_follower', v_ref, 'متابع', 'متابع تجريبي', '/(tabs)/friends?follower=1')
  ON CONFLICT (user_id, event_type, reference_id) DO NOTHING;
  INSERT INTO public.user_notifications (user_id, actor_id, event_type, reference_id, title, body, route)
  VALUES (v_a, NULL, 'new_follower', v_ref, 'متابع', 'متابع تجريبي', '/(tabs)/friends?follower=1')
  ON CONFLICT (user_id, event_type, reference_id) DO NOTHING;
  SELECT count(*) INTO v_cnt FROM public.push_queue
  WHERE user_id = v_a AND event_type = 'new_follower' AND reference_id = v_ref;
  v_ok := v_cnt = 1;
  INSERT INTO _results VALUES ('T06', 'طابور الدفع بصف واحد رغم التكرار', 'rows=' || v_cnt, v_ok);

  -- T07: تعطيل الدفع لهذا النوع يمنع الدخول للطابور
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_a::text, 'role', 'authenticated')::text, true);
  PERFORM public.set_my_notification_preference('private_message', true, false);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
  INSERT INTO public.user_notifications (user_id, actor_id, event_type, reference_id, title, body, route)
  VALUES (v_a, NULL, 'private_message', gen_random_uuid(), 'رسالة ٢', 'رسالة أخرى', '/messages/y');
  SELECT count(*) INTO v_cnt FROM public.push_queue
  WHERE user_id = v_a AND event_type = 'private_message' AND body = 'رسالة أخرى';
  v_ok := v_cnt = 0;
  INSERT INTO _results VALUES ('T07', 'تعطيل الدفع يمنع الطابور', 'rows=' || v_cnt, v_ok);

  -- T08: سحب دفعة يزيد المحاولات ولا يكرر الصف
  v_res := public.claim_push_batch(10);
  SELECT (e ->> 'id')::uuid INTO v_queue_id
  FROM jsonb_array_elements(v_res) e
  WHERE (e ->> 'user_id')::uuid = v_a AND (e ->> 'route') = '/(tabs)/friends?follower=1'
  LIMIT 1;
  v_ok := v_queue_id IS NOT NULL
    AND (SELECT attempts FROM public.push_queue WHERE id = v_queue_id) = 1;
  v_res := public.claim_push_batch(10);
  v_ok := v_ok AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_res) e
    WHERE (e ->> 'id')::uuid = v_queue_id
  );
  INSERT INTO _results VALUES ('T08', 'سحب الدفعة يزيد المحاولات مرة واحدة',
    'queue_id=' || coalesce(v_queue_id::text, 'NULL'), v_ok);

  -- T09: إكمال الدفعة يعلّم الصف مُرسلاً
  v_res := public.finish_push_batch(ARRAY[v_queue_id], '[]'::jsonb);
  v_ok := (v_res ->> 'sent')::int = 1
    AND (SELECT status FROM public.push_queue WHERE id = v_queue_id) = 'sent';
  INSERT INTO _results VALUES ('T09', 'إكمال الدفعة يعلّم الصف مُرسلاً', v_res::text, v_ok);

  -- T10: الحملة: مستخدم عادي مرفوض، وبلا سبب مرفوضة
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_a::text, 'role', 'authenticated')::text, true);
  v_ok := true;
  v_actual := '';
  BEGIN
    PERFORM public.admin_upsert_notification_campaign(v_a, NULL, jsonb_build_object(
      'title', 'حملة اختبار', 'body', 'نص الحملة', 'audience_kind', 'all'), 'محاولة غير مصرحة');
    v_ok := false;
    v_actual := 'قُبلت من مستخدم عادي — خطأ';
  EXCEPTION WHEN OTHERS THEN
    v_ok := position('غير مصرح' in SQLERRM) > 0;
    v_actual := SQLERRM;
  END;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
  BEGIN
    PERFORM public.admin_upsert_notification_campaign(v_admin, NULL, jsonb_build_object(
      'title', 'حملة اختبار', 'body', 'نص الحملة', 'audience_kind', 'all'), 'قصير');
    v_ok := v_ok AND false;
    v_actual := v_actual || ' | قُبلت بلا سبب كافٍ — خطأ';
  EXCEPTION WHEN OTHERS THEN
    v_ok := v_ok AND position('سبب' in SQLERRM) > 0;
    v_actual := v_actual || ' | ' || SQLERRM;
  END;
  INSERT INTO _results VALUES ('T10', 'بوابة الحملات والسبب الإلزامي', v_actual, v_ok);

  -- T11: إنشاء حملة صحيحة + تدقيق
  v_res := public.admin_upsert_notification_campaign(v_admin, NULL, jsonb_build_object(
    'title', 'عرض Wattar التجريبي',
    'body', 'جرّب الميزات الجديدة الآن.',
    'route', '/(tabs)/store',
    'audience_kind', 'user_ids',
    'audience_value', jsonb_build_object('user_ids', jsonb_build_array(v_a::text))
  ), 'إنشاء حملة اختبار M9.3');
  v_campaign := (v_res ->> 'id')::uuid;
  v_campaign_status := v_res ->> 'status';
  v_ok := v_campaign IS NOT NULL AND v_campaign_status = 'draft'
    AND (SELECT count(*) FROM public.admin_audit_log
         WHERE target_type = 'notification_campaign' AND target_id = v_campaign) = 1;
  INSERT INTO _results VALUES ('T11', 'إنشاء الحملة مع تدقيق', 'status=' || v_campaign_status, v_ok);

  -- T12: الإرسال يبني الجمهور ويُدخل إشعارات broadcast
  v_res := public.dispatch_notification_campaign(v_campaign);
  v_ok := (v_res ->> 'recipients')::int >= 1
    AND (SELECT status FROM public.notification_campaigns WHERE id = v_campaign) = 'sent'
    AND (SELECT count(*) FROM public.user_notifications
         WHERE user_id = v_a AND event_type = 'broadcast' AND reference_id = v_campaign) = 1;
  INSERT INTO _results VALUES ('T12', 'إرسال الحملة ينشئ إشعارات فعلية',
    'recipients=' || (v_res ->> 'recipients'), v_ok);

  -- T13: إعادة الإرسال لا تُكرر
  v_res := public.dispatch_notification_campaign(v_campaign);
  v_ok := coalesce((v_res ->> 'already_processed')::boolean, false)
    AND (SELECT count(*) FROM public.user_notifications
         WHERE user_id = v_a AND event_type = 'broadcast' AND reference_id = v_campaign) = 1;
  INSERT INTO _results VALUES ('T13', 'إعادة إرسال الحملة بلا تكرار',
    'already=' || (v_res ->> 'already_processed'), v_ok);

  -- T14: عرض الأنواع يحتاج صلاحية
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_a::text, 'role', 'authenticated')::text, true);
  v_ok := true;
  v_actual := '';
  BEGIN
    PERFORM public.admin_list_notification_types(v_a);
    v_ok := false;
    v_actual := 'قُبل من مستخدم عادي — خطأ';
  EXCEPTION WHEN OTHERS THEN
    v_ok := position('غير مصرح' in SQLERRM) > 0;
    v_actual := SQLERRM;
  END;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
  v_res := public.admin_list_notification_types(v_admin);
  v_ok := v_ok AND jsonb_array_length(v_res) >= v_type_count;
  v_actual := v_actual || ' | admin_types=' || jsonb_array_length(v_res);
  INSERT INTO _results VALUES ('T14', 'بوابة عرض الأنواع الإدارية', v_actual, v_ok);

  -- T15: إضافة نوع جديد بلا تعديل كود + تدقيق
  v_res := public.admin_upsert_notification_type(v_admin, 'm9_test_type', jsonb_build_object(
    'category', 'marketing',
    'label_ar', 'نوع اختبار',
    'description_ar', 'نوع مضاف من الاختبار',
    'sort_order', 999,
    'is_active', true
  ), 'إضافة نوع إشعار اختباري');
  v_ok := (v_res ->> 'event_type') = 'm9_test_type'
    AND (SELECT count(*) FROM public.admin_audit_log
         WHERE target_type = 'notification_type'
           AND metadata ->> 'event_type' = 'm9_test_type') = 1;
  INSERT INTO _results VALUES ('T15', 'نوع إشعار جديد يُضاف من اللوحة', v_res ->> 'event_type', v_ok);

  PERFORM set_config('request.jwt.claims', '', true);
END $do$;

SELECT * FROM _results ORDER BY step;

ROLLBACK;
