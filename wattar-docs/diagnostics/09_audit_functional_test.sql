-- ============================================================
-- diagnostics/09_audit_functional_test.sql
-- اختبار وظيفي حقيقي لـ M2.6 (سجل التدقيق — هجرة #51) على قاعدة الإنتاج.
-- لا يغيّر شيئاً في النهاية: كل شيء داخل BEGIN … ROLLBACK.
-- التشغيل: npx supabase db query --remote=vczyjbqixqzositlkfkn -f <هذا الملف> --yes
-- ============================================================
BEGIN;

CREATE TEMP TABLE _results (step text, expected text, actual text, ok boolean) ON COMMIT DROP;

DO $do$
DECLARE
  v_a uuid := '55942a3d-602c-4da1-99a1-05dbd1de82e9';
  v_b uuid := '2488de9e-97d9-4fa6-aa0a-856de7189287';
  v_room uuid;
  v_audit_id uuid;
  v_word_id uuid;
  v_text text;
  v_reason text;
  v_ok boolean;
  v_cnt integer;
  v_row record;
BEGIN
  -- ================= إعداد البيئة (يُتراجع عنها كلياً) =================
  -- مطالبات service_role أولاً: زناد التدقيق يرفض الإدراج في rooms بلا مطالبات
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);

  INSERT INTO public.rooms (name, owner_id, seat_count, livekit_room_id, is_private)
  VALUES ('M2.6 test room', v_a, 4, 'm26-' || gen_random_uuid()::text, false)
  RETURNING id INTO v_room;

  -- ---------------- T1: التعديل على السجل مرفوض (إلحاق فقط) ----------------
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, metadata)
  VALUES (v_b, 'update'::public.audit_action_type, 'audit_test', '{"reason":"صف تجريبي"}'::jsonb)
  RETURNING id INTO v_audit_id;

  v_ok := false;
  BEGIN
    UPDATE public.admin_audit_log SET reason = 'تلاعب' WHERE id = v_audit_id;
  EXCEPTION WHEN others THEN
    v_ok := strpos(coalesce(SQLERRM, ''), 'AUDIT_LOG_APPEND_ONLY') > 0;
  END;
  INSERT INTO _results VALUES ('T1', 'UPDATE مرفوض بـ AUDIT_LOG_APPEND_ONLY',
    v_ok::text, v_ok);

  -- ---------------- T2: الحذف من السجل مرفوض ----------------
  v_ok := false;
  BEGIN
    DELETE FROM public.admin_audit_log WHERE id = v_audit_id;
  EXCEPTION WHEN others THEN
    v_ok := strpos(coalesce(SQLERRM, ''), 'AUDIT_LOG_APPEND_ONLY') > 0;
  END;
  INSERT INTO _results VALUES ('T2', 'DELETE مرفوض بـ AUDIT_LOG_APPEND_ONLY',
    v_ok::text, v_ok);

  -- ---------------- T3: التفريغ TRUNCATE مرفوض ----------------
  v_ok := false;
  BEGIN
    TRUNCATE public.admin_audit_log;
  EXCEPTION WHEN others THEN
    v_ok := strpos(coalesce(SQLERRM, ''), 'AUDIT_LOG_APPEND_ONLY') > 0;
  END;
  INSERT INTO _results VALUES ('T3', 'TRUNCATE مرفوض بـ AUDIT_LOG_APPEND_ONLY',
    v_ok::text, v_ok);

  -- ---------------- T4: الصلاحيات مسحوبة حتى من service_role ----------------
  SELECT count(*) INTO v_cnt
  FROM (VALUES
    (has_table_privilege('service_role', 'public.admin_audit_log', 'UPDATE')),
    (has_table_privilege('service_role', 'public.admin_audit_log', 'DELETE')),
    (has_table_privilege('service_role', 'public.admin_audit_log', 'TRUNCATE')),
    (has_table_privilege('authenticated', 'public.admin_audit_log', 'UPDATE')),
    (has_table_privilege('authenticated', 'public.admin_audit_log', 'DELETE')),
    (has_table_privilege('anon', 'public.admin_audit_log', 'DELETE'))
  ) AS p(priv) WHERE p.priv;
  v_ok := v_cnt = 0;
  INSERT INTO _results VALUES ('T4', 'لا UPDATE/DELETE/TRUNCATE لأي دور',
    'مخالفات=' || v_cnt, v_ok);

  -- ---------------- T5: استخراج السبب من metadata.reason ----------------
  SELECT reason INTO v_reason FROM public.admin_audit_log WHERE id = v_audit_id;
  v_ok := v_reason = 'صف تجريبي';
  INSERT INTO _results VALUES ('T5', 'metadata.reason => reason', coalesce(v_reason, 'NULL'), v_ok);

  -- ---------------- T6: السبب الصريح في العمود يتقدم على metadata ----------------
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, reason, metadata)
  VALUES (v_b, 'update'::public.audit_action_type, 'audit_test', 'سبب صريح', '{"reason":"سبب ميتا"}'::jsonb);
  SELECT reason INTO v_reason FROM public.admin_audit_log
  WHERE target_type = 'audit_test' AND reason = 'سبب صريح';
  v_ok := v_reason = 'سبب صريح';
  INSERT INTO _results VALUES ('T6', 'reason الصريح يتقدم على metadata', coalesce(v_reason, 'NULL'), v_ok);

  -- ---------------- T7: البديل review_note في metadata ----------------
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, metadata)
  VALUES (v_b, 'approve'::public.audit_action_type, 'audit_test', '{"review_note":"ملاحظة مراجعة"}'::jsonb);
  SELECT count(*) INTO v_cnt FROM public.admin_audit_log
  WHERE target_type = 'audit_test' AND reason = 'ملاحظة مراجعة';
  v_ok := v_cnt = 1;
  INSERT INTO _results VALUES ('T7', 'metadata.review_note => reason', 'مطابقات=' || v_cnt, v_ok);

  -- ---------------- T8: RPC بكلمة جديدة مع p_reason => السبب مسجل ----------------
  SELECT public.admin_upsert_moderation_word(v_b, 'forbidden', 'كلمةتجريبية09', 'low', NULL, true,
    'إضافة كلمة من اختبار 09')
  INTO v_word_id;
  SELECT reason INTO v_reason FROM public.admin_audit_log
  WHERE target_type = 'moderation_word' AND target_id = v_word_id;
  v_ok := v_reason = 'إضافة كلمة من اختبار 09';
  INSERT INTO _results VALUES ('T8', 'p_reason في RPC => reason', coalesce(v_reason, 'NULL'), v_ok);

  -- ---------------- T9: RPC دون سبب => يعمل كما كان وreason فارغ ----------------
  PERFORM public.admin_upsert_moderation_word(v_b, 'forbidden', 'كلمةبلاسبب09');
  SELECT count(*) INTO v_cnt FROM public.admin_audit_log a
  JOIN public.moderation_words w ON w.id = a.target_id
  WHERE a.target_type = 'moderation_word' AND w.word = 'كلمةبلاسبب09'
    AND a.reason IS NULL;
  v_ok := v_cnt = 1;
  INSERT INTO _results VALUES ('T9', 'استدعاء قديم بلا سبب متوافق',
    'reason=NULL مطابقات=' || v_cnt, v_ok);

  -- ---------------- T10: تعديل مباشر بجلسة مسؤول + ترويسة السبب ----------------
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.headers',
    jsonb_build_object('x-audit-reason', 'إغلاق مؤقت من اختبار 09')::text, true);
  BEGIN
    SET LOCAL ROLE authenticated;
    UPDATE public.rooms SET name = 'M2.6 test room v2' WHERE id = v_room;
    RESET ROLE;
  EXCEPTION WHEN others THEN
    RESET ROLE;
    RAISE;
  END;
  SELECT reason INTO v_reason FROM public.admin_audit_log
  WHERE target_type = 'rooms' AND target_id = v_room
  ORDER BY created_at DESC LIMIT 1;
  v_ok := v_reason = 'إغلاق مؤقت من اختبار 09';
  INSERT INTO _results VALUES ('T10', 'ترويسة x-audit-reason => reason',
    coalesce(v_reason, 'NULL'), v_ok);

  -- ---------------- T11: التنقيح ما زال يعمل (livekit_token محجوب) ----------------
  SELECT before INTO v_row FROM public.admin_audit_log
  WHERE target_type = 'rooms' AND target_id = v_room
  ORDER BY created_at DESC LIMIT 1;
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  v_ok := v_cnt = 1 AND NOT ((v_row.before)::jsonb ? 'livekit_token');
  INSERT INTO _results VALUES ('T11', 'before بلا livekit_token',
    CASE WHEN v_cnt = 1 THEN 'تنقيح سليم' ELSE 'لا صف' END, v_ok);

  -- ---------------- T12: التعبئة الرجعية غطت الصفوف التاريخية ----------------
  SELECT count(*) INTO v_cnt FROM public.admin_audit_log
  WHERE reason IS NULL
    AND nullif(btrim(coalesce(metadata->>'reason', '')), '') IS NOT NULL;
  v_ok := v_cnt = 0;
  INSERT INTO _results VALUES ('T12', 'لا صف تاريخي غير معبأ من metadata.reason',
    'متبقية=' || v_cnt, v_ok);

  -- ---------------- T13: لا تعدد تحميلات للدوال الست ----------------
  SELECT count(*) INTO v_cnt FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname IN (
    'admin_upsert_moderation_word', 'admin_delete_moderation_word',
    'admin_update_moderation_settings', 'admin_update_private_message_settings',
    'admin_set_host_intro_template', 'admin_upsert_membership_plan');
  v_ok := v_cnt = 6;
  INSERT INTO _results VALUES ('T13', 'نسخة واحدة لكل دالة (المجموع 6)',
    'عدد=' || v_cnt, v_ok);

  -- ---------------- T14: grants مطابقة (authenticated للمستدعاة مباشرة) ----------------
  SELECT count(*) INTO v_cnt
  FROM (VALUES
    (has_function_privilege('authenticated',
      'public.admin_update_private_message_settings(integer,bigint,integer,integer,boolean,text)', 'EXECUTE')),
    (has_function_privilege('authenticated',
      'public.admin_set_host_intro_template(bigint,text,boolean,text)', 'EXECUTE')),
    (has_function_privilege('authenticated',
      'public.admin_upsert_membership_plan(uuid,text,text,integer,bigint,integer,boolean,text)', 'EXECUTE')),
    (has_function_privilege('service_role',
      'public.admin_upsert_moderation_word(uuid,text,text,text,uuid,boolean,text)', 'EXECUTE')),
    (has_function_privilege('authenticated',
      'public.admin_upsert_moderation_word(uuid,text,text,text,uuid,boolean,text)', 'EXECUTE'))
  ) AS p(priv) WHERE p.priv;
  v_ok := v_cnt = 4;
  INSERT INTO _results VALUES ('T14', 'grants: 4 صحيحة والخامسة مرفوضة',
    'متحقق=' || v_cnt, v_ok);

  -- ---------------- T15: مستخدم عادي لا يقرأ السجل (RLS) ----------------
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  BEGIN
    SET LOCAL ROLE authenticated;
    EXECUTE 'SELECT count(*) FROM public.admin_audit_log' INTO v_cnt;
    RESET ROLE;
  EXCEPTION WHEN others THEN
    RESET ROLE;
    v_cnt := -1;
  END;
  v_ok := v_cnt = 0;
  INSERT INTO _results VALUES ('T15', 'SELECT للمستخدم العادي = 0 صف',
    'عدد=' || v_cnt, v_ok);

  PERFORM set_config('request.jwt.claims', '', true);
END;
$do$;

-- التقرير النهائي (يُطبع ثم يتراجع كل شيء)
SELECT step, expected, actual, ok,
  CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS verdict
FROM _results
ORDER BY step::text;

SELECT
  count(*) AS total,
  count(*) FILTER (WHERE ok) AS passed,
  count(*) FILTER (WHERE NOT ok) AS failed,
  CASE WHEN bool_and(ok) THEN 'ALL PASS' ELSE 'HAS FAILURES' END AS verdict
FROM _results;

ROLLBACK;
