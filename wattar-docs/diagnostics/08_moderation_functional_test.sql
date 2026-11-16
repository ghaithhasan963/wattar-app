-- ============================================================
-- diagnostics/08_moderation_functional_test.sql
-- اختبار وظيفي حقيقي لـ M2.5 (نظام الإشراف — هجرة #50) على قاعدة الإنتاج.
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
  v_other_room uuid;
  v_word_id uuid;
  v_exc_id uuid;
  v_pen_id uuid;
  v_perm_pen_id uuid;
  v_mute_pen_id uuid;
  v_report_id uuid;
  v_report2_id uuid;
  v_appeal_id uuid;
  v_json jsonb;
  v_text text;
  v_msg text;
  v_ok boolean;
  v_cnt integer;
  v_status text;
  v_until timestamptz;
BEGIN
  -- ================= إعداد البيئة (يُتراجع عنها كلياً) =================
  UPDATE public.users SET status = 'active', adult_confirmed_at = now(),
    banned_reason = NULL, banned_until = NULL
  WHERE id IN (v_a, v_b);

  -- مطالبات service_role أولاً: زناد التدقيق audit_admin_row_change يرفض الجلسات بلا مطالبات
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);

  INSERT INTO public.rooms (name, owner_id, seat_count, livekit_room_id, is_private)
  VALUES ('M2.5 test room', v_a, 4, 'm25-' || gen_random_uuid()::text, false)
  RETURNING id INTO v_room;

  INSERT INTO public.rooms (name, owner_id, seat_count, livekit_room_id, is_private)
  VALUES ('M2.5 other room', v_b, 4, 'm25o-' || gen_random_uuid()::text, false)
  RETURNING id INTO v_other_room;

  -- عتبات منخفضة لاختبار التصعيد: كتم عند 2، حظر مؤقت عند 3، دائم عند 4
  UPDATE public.moderation_settings
  SET warnings_before_mute = 2, violations_before_temp_ban = 3,
      violations_before_permanent_ban = 4, violation_counting_window_days = 90,
      filter_enabled = true
  WHERE id;

  -- محاكاة service_role للدوال الإدارية (postgres ينفذ أصلاً + الادعاءات للفحص الدوري)
  PERFORM public.admin_upsert_moderation_word(v_b, 'forbidden', 'كلب', 'medium');
  PERFORM public.admin_upsert_moderation_word(v_b, 'forbidden', 'احتيال', 'high');
  PERFORM public.admin_upsert_moderation_word(v_b, 'allowed', 'كلبنا');
  PERFORM public.admin_upsert_moderation_word(v_b, 'forbidden', 'خاصية', 'low', v_room);

  -- ---------------- T1: تطبيع النص العربي ----------------
  SELECT public.normalize_arabic_text('أَهْـلآ صــديق') INTO v_text;
  v_ok := v_text = 'اهلا صديق';
  INSERT INTO _results VALUES ('T1', 'normalize => اهلا صديق', v_text, v_ok);

  -- ---------------- T2: leet + الضغط ----------------
  SELECT public.normalize_arabic_text('3a5i7 KLLLBB') INTO v_text;
  v_ok := v_text = 'easih klb';
  INSERT INTO _results VALUES ('T2', 'leet+repeat => easih klb', v_text, v_ok);

  -- ---------------- T3: النص المضغوط يزيل الفواصل ----------------
  SELECT public.moderation_compact_text('ك ل ب سيء') INTO v_text;
  v_ok := v_text = 'كلبسيء';
  INSERT INTO _results VALUES ('T3', 'compact => كلبسيء', v_text, v_ok);

  -- ---------------- T4: نص نظيف مسموح ----------------
  SELECT public.check_word_filter('مرحبا بالجميع كيف الحال') INTO v_json;
  v_ok := NOT (v_json->>'blocked')::boolean;
  INSERT INTO _results VALUES ('T4', 'clean text allowed', v_json::text, v_ok);

  -- ---------------- T5: كلمة ممنوعة مباشرة ----------------
  SELECT public.check_word_filter('انت كلب حقير') INTO v_json;
  v_ok := (v_json->>'blocked')::boolean AND v_json->>'matched_word' = 'كلب'
          AND v_json->>'severity' = 'medium';
  INSERT INTO _results VALUES ('T5', 'forbidden direct match', v_json::text, v_ok);

  -- ---------------- T6: التحايل بالتشكيل والتطويل والتكرار ----------------
  SELECT public.check_word_filter('انت كــَـلــْـب') INTO v_json;
  v_ok := (v_json->>'blocked')::boolean;
  INSERT INTO _results VALUES ('T6', 'diacritics/tatweel bypass blocked', v_json::text, v_ok);

  -- ---------------- T7: التحايل بفصل الحروف (مطابقة مضغوطة) ----------------
  SELECT public.check_word_filter('هذا ا ح ت ي ا ل واضح') INTO v_json;
  v_ok := (v_json->>'blocked')::boolean AND v_json->>'matched_word' = 'احتيال';
  INSERT INTO _results VALUES ('T7', 'spaced-letters bypass blocked', v_json::text, v_ok);

  -- ---------------- T8: الكلمة المسموحة تعفي ----------------
  SELECT public.check_word_filter('كلبنا مخلص ورائع') INTO v_json;
  v_ok := NOT (v_json->>'blocked')::boolean;
  INSERT INTO _results VALUES ('T8', 'allowed word exempts', v_json::text, v_ok);

  -- ---------------- T9: كلمة خاصة بغرفة تسري في غرفتها فقط ----------------
  SELECT public.check_word_filter('هذه خاصية مميزة', v_room, v_a) INTO v_json;
  v_ok := (v_json->>'blocked')::boolean;
  SELECT public.check_word_filter('هذه خاصية مميزة', v_other_room, v_a) INTO v_json;
  v_ok := v_ok AND NOT (v_json->>'blocked')::boolean;
  SELECT public.check_word_filter('هذه خاصية مميزة', NULL, v_a) INTO v_json;
  v_ok := v_ok AND NOT (v_json->>'blocked')::boolean;
  INSERT INTO _results VALUES ('T9', 'room-scoped word applies in its room only', 'room/global checks', v_ok);

  -- ---------------- T10: استثناء مستخدم يتجاوز الفلترة ----------------
  SELECT public.admin_add_moderation_exception(v_b, 'استثناء اختبار', v_a, NULL) INTO v_exc_id;
  SELECT public.check_word_filter('انت كلب حقير', NULL, v_a) INTO v_json;
  v_ok := NOT (v_json->>'blocked')::boolean;
  PERFORM public.admin_revoke_moderation_exception(v_b, v_exc_id);
  SELECT public.check_word_filter('انت كلب حقير', NULL, v_a) INTO v_json;
  v_ok := v_ok AND (v_json->>'blocked')::boolean;
  INSERT INTO _results VALUES ('T10', 'user exception grants then revokes bypass', 'exc=' || v_exc_id, v_ok);

  -- ---------------- T11: رسالة غرفة بكلمة ممنوعة تُعاد محجوبة + مخالفة + حدث خطر ----------------
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_a::text, 'role', 'authenticated')::text, true);
  SELECT public.send_room_message(v_room, 'انت كلب') INTO v_json;
  v_ok := (v_json->>'blocked')::boolean AND v_json->>'reason_code' = 'word_filter';
  SELECT count(*) INTO v_cnt FROM public.user_violations
  WHERE user_id = v_a AND violation_type = 'word_filter';
  v_ok := v_ok AND v_cnt = 1;
  SELECT count(*) INTO v_cnt FROM public.risk_events
  WHERE user_id = v_a AND event_type = 'blocked_action';
  v_ok := v_ok AND v_cnt >= 1;
  INSERT INTO _results VALUES ('T11', 'room msg blocked + violation + risk event',
    v_json::text || ' violations=1', v_ok);

  -- ---------------- T12: رسالة نظيفة تمر ----------------
  SELECT public.send_room_message(v_room, 'مرحبا بالجميع') INTO v_json;
  v_ok := (v_json->>'id') IS NOT NULL;
  INSERT INTO _results VALUES ('T12', 'clean room msg passes', v_json::text, v_ok);

  -- ---------------- T13: المخالفة الثانية => كتم تلقائي ----------------
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
  PERFORM public.record_word_violation(v_a, v_room, 'احتيال مكرر', 'احتيال', 'high');
  SELECT public.has_active_chat_mute(v_a) INTO v_ok;
  SELECT count(*) INTO v_cnt FROM public.user_penalties
  WHERE user_id = v_a AND penalty_type = 'mute' AND revoked_at IS NULL;
  v_ok := v_ok AND v_cnt = 1;
  INSERT INTO _results VALUES ('T13', '2nd violation => auto mute', 'mutes=' || v_cnt, v_ok);

  -- ---------------- T14: الكتم يمنع رسائل الغرفة ----------------
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_a::text, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.send_room_message(v_room, 'مرحبا مرة أخرى');
    v_ok := false; v_msg := 'allowed';
  EXCEPTION WHEN others THEN
    v_ok := true; GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;
  INSERT INTO _results VALUES ('T14', 'global mute blocks room msg', 'raised=' || v_ok || ' ' || left(v_msg, 40), v_ok);

  -- ---------------- T15: المخالفة الثالثة => حظر مؤقت تلقائي ----------------
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
  PERFORM public.record_word_violation(v_a, v_room, 'تكرار ثالث', 'كلب', 'medium');
  SELECT status::text, banned_until INTO v_status, v_until FROM public.users WHERE id = v_a;
  SELECT public.is_account_active(v_a) INTO v_ok;
  v_ok := (NOT v_ok) AND v_status = 'banned' AND v_until > now();
  SELECT count(*) INTO v_cnt FROM public.user_penalties
  WHERE user_id = v_a AND penalty_type = 'temp_ban' AND revoked_at IS NULL;
  v_ok := v_ok AND v_cnt = 1;
  INSERT INTO _results VALUES ('T15', '3rd violation => auto temp ban',
    'status=' || v_status || ' penalties=' || v_cnt, v_ok);

  -- ---------------- T16: انتهاء الحظر المؤقت => استعادة تلقائية ----------------
  UPDATE public.users SET banned_until = now() - interval '1 minute' WHERE id = v_a;
  SELECT public.is_account_active(v_a) INTO v_ok;
  SELECT status::text INTO v_status FROM public.users WHERE id = v_a;
  v_ok := v_ok AND v_status = 'active';
  INSERT INTO _results VALUES ('T16', 'expired temp ban lazily restored',
    'active=' || v_ok || ' status=' || v_status, v_ok);

  -- ---------------- T17: المخالفة الرابعة => حظر دائم تلقائي ----------------
  PERFORM public.record_word_violation(v_a, v_room, 'تكرار رابع', 'احتيال', 'high');
  SELECT status::text, banned_until INTO v_status, v_until FROM public.users WHERE id = v_a;
  SELECT id INTO v_perm_pen_id FROM public.user_penalties
  WHERE user_id = v_a AND penalty_type = 'permanent_ban' AND revoked_at IS NULL
  ORDER BY created_at DESC LIMIT 1;
  v_ok := v_status = 'banned' AND v_until IS NULL AND v_perm_pen_id IS NOT NULL;
  INSERT INTO _results VALUES ('T17', '4th violation => auto permanent ban',
    'status=' || v_status || ' pen=' || v_perm_pen_id, v_ok);

  -- ---------------- T18: إلغاء الحظر الدائم يعيد التنشيط ----------------
  -- نلغي أولاً عقوبة الحظر المؤقت التلقائي (ما تزال سارية) ثم الدائم
  SELECT id INTO v_pen_id FROM public.user_penalties
  WHERE user_id = v_a AND penalty_type = 'temp_ban' AND revoked_at IS NULL
  ORDER BY created_at DESC LIMIT 1;
  PERFORM public.revoke_moderation_penalty(v_b, v_pen_id, 'إلغاء اختباري مؤقت');
  PERFORM public.revoke_moderation_penalty(v_b, v_perm_pen_id, 'إلغاء اختباري دائم');
  SELECT status::text INTO v_status FROM public.users WHERE id = v_a;
  v_ok := v_status = 'active';
  INSERT INTO _results VALUES ('T18', 'revoke permanent ban restores', 'status=' || v_status, v_ok);

  -- ---------------- T19: عقوبة إدارية يدوية (حظر مؤقت 30 دقيقة) ----------------
  SELECT public.apply_moderation_penalty(v_b, v_a, 'temp_ban', 'سبب إداري اختباري', 30) INTO v_json;
  v_pen_id := (v_json->>'penalty_id')::uuid;
  SELECT banned_until INTO v_until FROM public.users WHERE id = v_a;
  SELECT count(*) INTO v_cnt FROM public.admin_audit_log
  WHERE admin_id = v_b AND metadata->>'penalty_id' = v_pen_id::text;
  v_ok := v_pen_id IS NOT NULL AND v_until > now() AND v_cnt = 1;
  SELECT count(*) INTO v_cnt FROM public.user_notifications
  WHERE user_id = v_a AND event_type = 'moderation_penalty' AND reference_id = v_pen_id;
  v_ok := v_ok AND v_cnt = 1;
  INSERT INTO _results VALUES ('T19', 'manual temp ban: penalty+audit+notification',
    'pen=' || v_pen_id || ' audits=1 notif=' || v_cnt, v_ok);

  -- ---------------- T20: الدالة الإدارية تُرفض بدون service_role ----------------
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_b::text, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.apply_moderation_penalty(v_b, v_a, 'warning', 'محاولة غير مصرحة');
    v_ok := false; v_msg := 'allowed';
  EXCEPTION WHEN others THEN
    v_ok := true; GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;
  INSERT INTO _results VALUES ('T20', 'penalty RPC denied without service_role',
    'raised=' || v_ok || ' ' || left(v_msg, 40), v_ok);

  -- ---------------- T21: إلغاء الحظر المؤقت اليدوي ----------------
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
  PERFORM public.revoke_moderation_penalty(v_b, v_pen_id, 'إلغاء اختباري');
  SELECT status::text INTO v_status FROM public.users WHERE id = v_a;
  SELECT count(*) INTO v_cnt FROM public.user_penalties
  WHERE id = v_pen_id AND revoked_at IS NOT NULL;
  v_ok := v_status = 'active' AND v_cnt = 1;
  INSERT INTO _results VALUES ('T21', 'revoke manual temp ban restores', 'status=' || v_status, v_ok);

  -- ---------------- T22: مراجعة بلاغ مع عقوبة كتم ----------------
  INSERT INTO public.user_reports (reporter_id, reported_id, reason)
  VALUES (v_b, v_a, 'بلاغ اختبار 08') RETURNING id INTO v_report_id;
  SELECT public.admin_review_user_report(v_b, v_report_id, 'actioned', 'مؤكد بعد التحقق', 'mute', 10)
  INTO v_json;
  SELECT status::text INTO v_status FROM public.user_reports WHERE id = v_report_id;
  SELECT linked_violation_id IS NOT NULL INTO v_ok FROM public.user_reports WHERE id = v_report_id;
  SELECT count(*) INTO v_cnt FROM public.user_penalties
  WHERE user_id = v_a AND penalty_type = 'mute' AND revoked_at IS NULL
    AND ends_at > now() AND reason LIKE 'بلاغ مؤكد%';
  v_ok := v_ok AND v_status = 'actioned' AND v_cnt >= 1;
  INSERT INTO _results VALUES ('T22', 'report actioned creates violation+penalty',
    'status=' || v_status || ' penalties=' || v_cnt, v_ok);

  -- ---------------- T23: رفض بلاغ ----------------
  INSERT INTO public.user_reports (reporter_id, reported_id, reason)
  VALUES (v_b, v_a, 'بلاغ ثانٍ غير مؤكد') RETURNING id INTO v_report2_id;
  PERFORM public.admin_review_user_report(v_b, v_report2_id, 'dismissed', 'لا دليل');
  SELECT status::text, linked_violation_id IS NULL INTO v_status, v_ok
  FROM public.user_reports WHERE id = v_report2_id;
  v_ok := v_ok AND v_status = 'dismissed';
  INSERT INTO _results VALUES ('T23', 'report dismissed without violation', 'status=' || v_status, v_ok);

  -- ---------------- T24: لا مراجعة مزدوجة لنفس البلاغ ----------------
  BEGIN
    PERFORM public.admin_review_user_report(v_b, v_report_id, 'dismissed', 'تكرار');
    v_ok := false; v_msg := 'allowed double review';
  EXCEPTION WHEN others THEN
    v_ok := true; GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;
  INSERT INTO _results VALUES ('T24', 'double review rejected', 'raised=' || v_ok || ' ' || left(v_msg, 40), v_ok);

  -- ---------------- T25: تقديم اعتراض من المستخدم ----------------
  SELECT id INTO v_mute_pen_id FROM public.user_penalties
  WHERE user_id = v_a AND penalty_type = 'mute' AND revoked_at IS NULL
    AND reason LIKE 'بلاغ مؤكد%' ORDER BY created_at DESC LIMIT 1;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_a::text, 'role', 'authenticated')::text, true);
  SELECT public.submit_moderation_appeal(v_mute_pen_id, 'أعترض على هذه العقوبة لأنها صدرت بالخطأ') INTO v_appeal_id;
  SELECT count(*) INTO v_cnt FROM public.moderation_appeals
  WHERE id = v_appeal_id AND user_id = v_a AND status = 'pending';
  v_ok := v_cnt = 1;
  INSERT INTO _results VALUES ('T25', 'user submits appeal', 'appeal=' || v_appeal_id, v_ok);

  -- ---------------- T26: لا اعتراض مزدوج على نفس العقوبة ----------------
  BEGIN
    PERFORM public.submit_moderation_appeal(v_mute_pen_id, 'اعتراض مكرر على نفس العقوبة وهذه محاولة ثانية');
    v_ok := false; v_msg := 'allowed duplicate';
  EXCEPTION WHEN others THEN
    v_ok := true; GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;
  INSERT INTO _results VALUES ('T26', 'duplicate appeal rejected', 'raised=' || v_ok || ' ' || left(v_msg, 40), v_ok);

  -- ---------------- T27: قبول الاعتراض يرفع العقوبة ----------------
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
  SELECT public.admin_review_appeal(v_b, v_appeal_id, 'approved', 'الاعتراض وجيه') INTO v_json;
  SELECT status::text INTO v_status FROM public.moderation_appeals WHERE id = v_appeal_id;
  SELECT count(*) INTO v_cnt FROM public.user_penalties
  WHERE id = v_mute_pen_id AND revoked_at IS NOT NULL;
  v_ok := v_status = 'approved' AND v_cnt = 1;
  INSERT INTO _results VALUES ('T27', 'appeal approved revokes penalty',
    'status=' || v_status || ' revoked=' || v_cnt, v_ok);

  -- ---------------- T28: حالة المستخدم تعيد بنيته ----------------
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_a::text, 'role', 'authenticated')::text, true);
  SELECT public.get_my_moderation_status() INTO v_json;
  v_ok := (v_json ? 'violations_in_window') AND (v_json ? 'active_penalties')
          AND (v_json ? 'appeals') AND jsonb_array_length(v_json->'appeals') >= 1;
  INSERT INTO _results VALUES ('T28', 'get_my_moderation_status shape', 'violations=' ||
    (v_json->>'violations_in_window') || ' appeals=' || jsonb_array_length(v_json->'appeals'), v_ok);

  -- ---------------- T29: مستخدم عادي يرى 0 صفوف من جداول الإشراف (RLS) ----------------
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_a::text, 'role', 'authenticated')::text, true);
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT count(*) INTO v_cnt FROM public.moderation_words;
    EXECUTE 'RESET ROLE';
    -- القائمة فيها >= 4 كلمات (زرعناها أعلاه)؛ رؤية 0 = الإخفاء يعمل
    v_ok := (v_cnt = 0);
    INSERT INTO _results VALUES ('T29', 'moderation_words hidden for user (RLS)', 'visible_rows=' || v_cnt, v_ok);
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
    INSERT INTO _results VALUES ('T29', 'moderation_words hidden for user (RLS)', 'harness: ' || left(v_msg, 60), false);
  END;

  -- ---------------- T30: anon لا يستدعي الفلترة ----------------
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'anon')::text, true);
  BEGIN
    EXECUTE 'SET LOCAL ROLE anon';
    BEGIN
      PERFORM public.check_word_filter('نص عادي');
      v_ok := false; v_msg := 'allowed';
    EXCEPTION WHEN others THEN
      v_ok := true; GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    END;
    EXECUTE 'RESET ROLE';
    INSERT INTO _results VALUES ('T30', 'anon filter EXECUTE denied', 'denied=' || v_ok || ' ' || left(v_msg, 40), v_ok);
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
    INSERT INTO _results VALUES ('T30', 'anon filter EXECUTE denied', 'harness: ' || left(v_msg, 60), false);
  END;

  -- ---------------- T31: المصادق لا يستدعي دوال الإدارة (P8) ----------------
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_b::text, 'role', 'authenticated')::text, true);
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN
      PERFORM public.apply_moderation_penalty(v_b, v_a, 'warning', 'محاولة');
      v_ok := false; v_msg := 'allowed';
    EXCEPTION WHEN others THEN
      v_ok := true; GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    END;
    EXECUTE 'RESET ROLE';
    INSERT INTO _results VALUES ('T31', 'authenticated penalty RPC denied', 'denied=' || v_ok || ' ' || left(v_msg, 40), v_ok);
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
    INSERT INTO _results VALUES ('T31', 'authenticated penalty RPC denied', 'harness: ' || left(v_msg, 60), false);
  END;

  -- ---------------- T32: upsert الكلمة لا يكرر ----------------
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
  PERFORM public.admin_upsert_moderation_word(v_b, 'forbidden', 'كلب', 'high');
  SELECT count(*) INTO v_cnt FROM public.moderation_words WHERE list_type = 'forbidden' AND word = 'كلب';
  SELECT severity INTO v_text FROM public.moderation_words WHERE list_type = 'forbidden' AND word = 'كلب';
  v_ok := v_cnt = 1 AND v_text = 'high';
  INSERT INTO _results VALUES ('T32', 'word upsert updates not duplicates',
    'count=' || v_cnt || ' severity=' || v_text, v_ok);

  -- ---------------- T33: تحديث الإعدادات بقيمة صحيحة ----------------
  SELECT public.admin_update_moderation_settings(v_b,
    jsonb_build_object('mute_default_minutes', 45)) INTO v_json;
  v_ok := (v_json->>'mute_default_minutes')::int = 45;
  INSERT INTO _results VALUES ('T33', 'settings update valid', 'mute_min=' || (v_json->>'mute_default_minutes'), v_ok);

  -- ---------------- T34: تحديث الإعدادات بقيمة غير صالحة مرفوض ----------------
  BEGIN
    PERFORM public.admin_update_moderation_settings(v_b,
      jsonb_build_object('warnings_before_mute', 'abc'));
    v_ok := false; v_msg := 'allowed invalid';
  EXCEPTION WHEN others THEN
    v_ok := true; GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;
  INSERT INTO _results VALUES ('T34', 'settings invalid value rejected',
    'raised=' || v_ok || ' ' || left(v_msg, 40), v_ok);

  BEGIN
    EXECUTE 'RESET ROLE';
  EXCEPTION WHEN others THEN NULL;
  END;
END;
$do$;

SELECT step, expected, actual, ok FROM _results ORDER BY step;

ROLLBACK;
