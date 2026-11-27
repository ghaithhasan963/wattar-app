-- ============================================================
-- diagnostics/20_m9_conversations_test.sql
-- اختبار وظيفي لترحيل #80 (M9.2 — المحادثات) داخل BEGIN … ROLLBACK.
-- يغطي: إصلاح is_wattar_blocked_between(uuid,uuid) الذي كان يعطّل
-- RLS وRealtime وجلب السعر (السبب الجذري لعدم فتح المحادثة)،
-- قراءة الجداول كـauthenticated، تقييم سياسة Realtime، ترقيم
-- الصفحات بمؤشر مركّب، كتالوج الملصقات، إرسال ملصق (مجاني ثم مدفوع
-- خادمياً + منع التكرار)، إرفاق هدية داخل المحادثة بلا حركة مالية
-- مزدوجة، وإدارة الملصقات بصلاحية وسبب وتدقيق.
-- ============================================================
BEGIN;

CREATE TEMP TABLE _results (step text, expected text, actual text, ok boolean) ON COMMIT DROP;

DO $do$
DECLARE
  v_admin uuid := '2488de9e-97d9-4fa6-aa0a-856de7189287';
  v_a uuid;
  v_b uuid;
  v_conv uuid;
  v_conv2 uuid;
  v_sticker uuid;
  v_sticker2 uuid;
  v_pack uuid;
  v_gift uuid;
  v_tx uuid;
  v_res jsonb;
  v_cnt integer;
  v_num bigint;
  v_bal_before bigint;
  v_bal_after bigint;
  v_ok boolean;
  v_actual text;
  v_err text;
  v_key text;
  v_price bigint;
  v_last_time timestamptz;
  v_last_id uuid;
  v_row public.private_messages%ROWTYPE;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);

  -- مستخدمان نشطان بلا صداقة/متابعة/مضيفة (لاختبار الحد المجاني)
  SELECT u.id INTO v_a FROM public.users u
  WHERE u.role = 'user' AND u.status = 'active'
    AND NOT EXISTS (SELECT 1 FROM public.host_program_members h WHERE h.user_id = u.id AND h.status = 'active')
    AND NOT EXISTS (SELECT 1 FROM public.user_follows f WHERE f.follower_id = u.id OR f.followed_id = u.id)
    AND NOT EXISTS (SELECT 1 FROM public.friend_requests fr
                    WHERE (fr.requester_id = u.id OR fr.recipient_id = u.id) AND fr.status = 'accepted')
  ORDER BY u.created_at LIMIT 1;
  SELECT u.id INTO v_b FROM public.users u
  WHERE u.role = 'user' AND u.status = 'active' AND u.id <> v_a
    AND NOT EXISTS (SELECT 1 FROM public.host_program_members h WHERE h.user_id = u.id AND h.status = 'active')
    AND NOT EXISTS (SELECT 1 FROM public.user_follows f
                    WHERE f.follower_id IN (u.id, v_a) OR f.followed_id IN (u.id, v_a))
    AND NOT EXISTS (SELECT 1 FROM public.friend_requests fr
                    WHERE fr.status = 'accepted'
                      AND (fr.requester_id IN (u.id, v_a) OR fr.recipient_id IN (u.id, v_a)))
  ORDER BY u.created_at LIMIT 1;

  IF v_a IS NULL OR v_b IS NULL THEN
    INSERT INTO _results VALUES ('T00', 'وجود مستخدمين اختبار', 'لا يوجد', false);
    RETURN;
  END IF;

  -- تأهيل الحسابين داخل الاختبار فقط (يُلغى بالـrollback)
  UPDATE public.users
  SET adult_confirmed_at = coalesce(adult_confirmed_at, now()),
      onboarding_completed_at = coalesce(onboarding_completed_at, now())
  WHERE id IN (v_a, v_b);
  DELETE FROM public.user_blocks
  WHERE blocker_id IN (v_a, v_b) AND blocked_id IN (v_a, v_b);

  INSERT INTO public.private_conversations (user_one_id, user_two_id)
  VALUES (least(v_a, v_b), greatest(v_a, v_b))
  ON CONFLICT DO NOTHING;
  SELECT c.id INTO v_conv FROM public.private_conversations c
  WHERE c.user_one_id = least(v_a, v_b) AND c.user_two_id = greatest(v_a, v_b);

  -- T01: نسخة المعاملين موجودة وتعمل بالاتجاهين
  v_ok := NOT public.is_wattar_blocked_between(v_a, v_b);
  INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (v_a, v_b);
  v_ok := v_ok
    AND public.is_wattar_blocked_between(v_a, v_b)
    AND public.is_wattar_blocked_between(v_b, v_a)
    AND public.is_wattar_blocked_between(v_a, NULL);
  DELETE FROM public.user_blocks WHERE blocker_id = v_a AND blocked_id = v_b;
  v_ok := v_ok AND NOT public.is_wattar_blocked_between(v_a, v_b);
  v_actual := 'pair_fn_ok=' || v_ok;
  INSERT INTO _results VALUES ('T01', 'is_wattar_blocked_between(uuid,uuid) تعمل', v_actual, v_ok);

  -- T02: قراءة الجداول كـauthenticated لا تفشل (كانت 42883)
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_a::text, 'role', 'authenticated')::text, true);
  v_ok := true;
  v_actual := '';
  BEGIN
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_cnt FROM public.private_conversations WHERE id = v_conv;
    SELECT count(*) INTO v_cnt FROM public.private_messages WHERE conversation_id = v_conv;
    RESET ROLE;
    v_ok := v_cnt IS NOT NULL;
    v_actual := 'rls_reads_ok';
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    v_ok := false;
    v_actual := SQLERRM;
  END;
  INSERT INTO _results VALUES ('T02', 'RLS على المحادثات والرسائل تقرأ بلا خطأ', v_actual, v_ok);

  -- T03: جلب سعر الرسالة يعمل (كان يفشل دائماً فيمنع فتح المحادثة)
  v_ok := true;
  v_actual := '';
  BEGIN
    v_res := public.get_private_message_quote(v_conv);
    v_ok := (v_res ->> 'free_limit') IS NOT NULL AND (v_res ->> 'price_coin') IS NOT NULL;
    v_actual := 'free_limit=' || (v_res ->> 'free_limit') || ' price=' || (v_res ->> 'price_coin');
  EXCEPTION WHEN OTHERS THEN
    v_ok := false;
    v_actual := SQLERRM;
  END;
  INSERT INTO _results VALUES ('T03', 'get_private_message_quote تعمل للمشارك', v_actual, v_ok);

  -- T04: سياسة Realtime تُقيَّم بلا خطأ
  v_ok := true;
  v_actual := '';
  BEGIN
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_cnt FROM realtime.messages;
    RESET ROLE;
    v_actual := 'realtime_policy_ok rows=' || v_cnt;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    v_ok := false;
    v_actual := SQLERRM;
  END;
  INSERT INTO _results VALUES ('T04', 'سياسة Realtime لا تفشل', v_actual, v_ok);

  -- T05: ترقيم الصفحات بمؤشر (created_at, id)
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
  FOR i IN 1..5 LOOP
    INSERT INTO public.private_messages (conversation_id, sender_id, body, created_at)
    VALUES (v_conv, v_a, 'page-' || i, now() - (interval '1 minute' * i));
  END LOOP;
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_a::text, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_cnt FROM public.list_private_messages(v_conv, NULL, NULL, 2);
  SELECT m.created_at, m.message_id INTO v_last_time, v_last_id
  FROM public.list_private_messages(v_conv, NULL, NULL, 2) m
  ORDER BY m.created_at ASC LIMIT 1;
  SELECT count(*) INTO v_num FROM public.list_private_messages(v_conv, v_last_time, v_last_id, 2);
  v_ok := v_cnt = 2 AND v_num = 2;
  v_actual := 'page1=' || v_cnt || ' page2=' || v_num;
  INSERT INTO _results VALUES ('T05', 'ترقيم الرسائل يعمل بمؤشر مركّب', v_actual, v_ok);

  -- T06: كتالوج الملصقات
  v_res := public.get_public_sticker_packs();
  SELECT count(*) INTO v_cnt FROM jsonb_array_elements(v_res) p
    CROSS JOIN jsonb_array_elements(p -> 'stickers') s;
  v_ok := jsonb_array_length(v_res) >= 2 AND v_cnt >= 16;
  v_actual := 'packs=' || jsonb_array_length(v_res) || ' stickers=' || v_cnt;
  INSERT INTO _results VALUES ('T06', 'حزم الملصقات العامة', v_actual, v_ok);

  SELECT (s ->> 'id')::uuid INTO v_sticker
  FROM jsonb_array_elements(v_res) p, jsonb_array_elements(p -> 'stickers') s
  WHERE p ->> 'key' = 'reactions' ORDER BY (s ->> 'sort_order')::int LIMIT 1;
  SELECT (s ->> 'id')::uuid INTO v_sticker2
  FROM jsonb_array_elements(v_res) p, jsonb_array_elements(p -> 'stickers') s
  WHERE p ->> 'key' = 'love' ORDER BY (s ->> 'sort_order')::int LIMIT 1;

  -- T07: إرسال ملصق داخل الحد المجاني (بلا خصم)
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
  UPDATE public.private_message_settings SET free_message_limit = 100 WHERE id = true;
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_a::text, 'role', 'authenticated')::text, true);
  v_res := public.get_private_message_quote(v_conv);
  v_key := 'm9-sticker-' || substr(gen_random_uuid()::text, 1, 12);
  v_res := public.send_sticker_message(v_conv, v_sticker, v_key,
    coalesce((v_res ->> 'price_coin')::bigint, 0));
  SELECT * INTO v_row FROM public.private_messages WHERE id = (v_res ->> 'message_id')::uuid;
  v_ok := v_row.message_kind = 'sticker' AND v_row.sticker_id = v_sticker
    AND v_row.charged_coins = 0 AND v_row.body <> '';
  v_actual := 'kind=' || v_row.message_kind || ' charged=' || v_row.charged_coins || ' body=' || v_row.body;
  INSERT INTO _results VALUES ('T07', 'إرسال ملصق مجاني داخل الحد', v_actual, v_ok);

  -- T08: منع التكرار بنفس المفتاح
  v_res := public.send_sticker_message(v_conv, v_sticker, v_key, 0);
  SELECT count(*) INTO v_cnt FROM public.private_messages WHERE idempotency_key = v_key;
  v_ok := coalesce((v_res ->> 'already_processed')::boolean, false) AND v_cnt = 1;
  v_actual := 'already=' || (v_res ->> 'already_processed') || ' rows=' || v_cnt;
  INSERT INTO _results VALUES ('T08', 'مفتاح الازدواجية يمنع تكرار الملصق', v_actual, v_ok);

  -- T09: بعد نفاد الحد المجاني يصبح الملصق مدفوعاً خادمياً
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
  UPDATE public.private_message_settings SET free_message_limit = 0 WHERE id = true;
  PERFORM public.record_wallet_transaction(v_a, 'deposit'::public.wallet_tx_type, 5000,
    'gold', NULL, NULL, 'test', NULL, '{}'::jsonb, 'm9-conv-test', 'تمويل اختبار المحادثات');
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_a::text, 'role', 'authenticated')::text, true);
  v_res := public.get_private_message_quote(v_conv);
  v_price := (v_res ->> 'price_coin')::bigint;
  v_ok := true;
  v_actual := 'price=' || v_price;
  BEGIN
    PERFORM public.send_sticker_message(v_conv, v_sticker2,
      'm9-sticker-unconfirmed-' || substr(gen_random_uuid()::text, 1, 10), 0);
    v_ok := false;
    v_actual := v_actual || ' | قُبل بلا تأكيد سعر — خطأ';
  EXCEPTION WHEN OTHERS THEN
    v_ok := v_ok AND position('تغيّر سعر الرسالة' in SQLERRM) > 0;
    v_actual := v_actual || ' | ' || SQLERRM;
  END;
  SELECT u.balance_gold INTO v_bal_before FROM public.users u WHERE u.id = v_a;
  v_res := public.send_sticker_message(v_conv, v_sticker2,
    'm9-sticker-paid-' || substr(gen_random_uuid()::text, 1, 12), v_price);
  SELECT u.balance_gold INTO v_bal_after FROM public.users u WHERE u.id = v_a;
  v_ok := v_ok
    AND (v_res ->> 'charged_coins')::bigint = v_price
    AND v_bal_before - v_bal_after = v_price;
  v_actual := v_actual || ' | charged=' || (v_res ->> 'charged_coins')
    || ' wallet_delta=' || (v_bal_before - v_bal_after);
  INSERT INTO _results VALUES ('T09', 'الحد المجاني ثم الدفع خادمياً للملصق', v_actual, v_ok);

  -- T10: هدية داخل المحادثة بلا حركة مالية مزدوجة
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
  SELECT g.id INTO v_gift FROM public.gifts g
  WHERE g.is_active AND g.archived_at IS NULL ORDER BY g.price_gold LIMIT 1;
  v_res := public.settle_gift_send(v_a, v_b, v_gift, 1, NULL, NULL,
    'm9-conv-gift-' || substr(gen_random_uuid()::text, 1, 12), 'gold');
  v_tx := (v_res -> 'gift_transaction' ->> 'id')::uuid;
  SELECT u.balance_gold INTO v_bal_before FROM public.users u WHERE u.id = v_a;
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_a::text, 'role', 'authenticated')::text, true);
  v_res := public.attach_gift_message(v_conv, v_tx);
  SELECT * INTO v_row FROM public.private_messages WHERE id = (v_res ->> 'message_id')::uuid;
  SELECT u.balance_gold INTO v_bal_after FROM public.users u WHERE u.id = v_a;
  v_res := public.attach_gift_message(v_conv, v_tx);
  v_ok := v_row.message_kind = 'gift' AND v_row.gift_transaction_id = v_tx
    AND v_bal_before = v_bal_after
    AND coalesce((v_res ->> 'already_processed')::boolean, false)
    AND (SELECT count(*) FROM public.private_messages WHERE gift_transaction_id = v_tx) = 1;
  v_actual := 'kind=' || v_row.message_kind || ' wallet_delta=' || (v_bal_before - v_bal_after)
    || ' already=' || (v_res ->> 'already_processed');
  INSERT INTO _results VALUES ('T10', 'إرفاق الهدية بلا خصم مزدوج', v_actual, v_ok);

  -- T11: لا يمكن إرفاق هدية أرسلها غيرك
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
  v_res := public.settle_gift_send(v_b, v_a, v_gift, 1, NULL, NULL,
    'm9-conv-gift2-' || substr(gen_random_uuid()::text, 1, 12), 'gold');
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_a::text, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.attach_gift_message(v_conv, (v_res -> 'gift_transaction' ->> 'id')::uuid);
    v_ok := false;
    v_actual := 'قُبلت هدية الغير — خطأ';
  EXCEPTION WHEN OTHERS THEN
    v_ok := position('غيرك' in SQLERRM) > 0;
    v_actual := SQLERRM;
  END;
  INSERT INTO _results VALUES ('T11', 'منع إرفاق هدية مرسلة من غيرك', v_actual, v_ok);

  -- T12: بوابة الإدارة والسبب والتدقيق لحزم الملصقات
  v_ok := true;
  v_actual := '';
  BEGIN
    PERFORM public.admin_upsert_sticker_pack(v_a, NULL, jsonb_build_object(
      'key', 'm9_test_pack', 'name', 'M9 Test Pack'), 'محاولة غير مصرحة');
    v_ok := false;
    v_actual := 'قُبل من مستخدم — خطأ';
  EXCEPTION WHEN OTHERS THEN
    v_ok := position('غير مصرح' in SQLERRM) > 0;
    v_actual := SQLERRM;
  END;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
  BEGIN
    PERFORM public.admin_upsert_sticker_pack(v_admin, NULL, jsonb_build_object(
      'key', 'm9_test_pack', 'name', 'M9 Test Pack'), NULL);
    v_ok := v_ok AND false;
    v_actual := v_actual || ' | بلا سبب قُبل — خطأ';
  EXCEPTION WHEN OTHERS THEN
    v_ok := v_ok AND position('سبب' in SQLERRM) > 0;
    v_actual := v_actual || ' | ' || SQLERRM;
  END;
  v_res := public.admin_upsert_sticker_pack(v_admin, NULL, jsonb_build_object(
    'key', 'm9_test_pack',
    'name', 'M9 Test Pack',
    'name_ar', 'حزمة اختبار',
    'icon_emoji', '🧪',
    'sort_order', 99,
    'is_active', true
  ), 'إنشاء حزمة اختبار M9.2');
  v_pack := (v_res ->> 'id')::uuid;
  SELECT count(*) INTO v_cnt FROM public.admin_audit_log
  WHERE target_type = 'sticker_pack' AND target_id = v_pack AND action = 'create';
  v_ok := v_ok AND v_pack IS NOT NULL AND v_cnt = 1;
  v_actual := v_actual || ' | pack=' || coalesce(v_pack::text, 'NULL') || ' audits=' || v_cnt;
  INSERT INTO _results VALUES ('T12', 'بوابة إدارة الملصقات والسبب والتدقيق', v_actual, v_ok);

  -- T13: إضافة ملصق للحزمة + القائمة الإدارية
  v_res := public.admin_upsert_sticker(v_admin, NULL, jsonb_build_object(
    'pack_id', v_pack,
    'code', 'test_sticker',
    'emoji', '🧪',
    'sort_order', 1,
    'is_active', true
  ), 'إضافة ملصق اختبار');
  v_sticker2 := (v_res ->> 'id')::uuid;
  v_res := public.admin_list_sticker_packs(v_admin);
  v_ok := EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_res) p
    WHERE (p ->> 'id')::uuid = v_pack
      AND (p ->> 'stickers_count')::int = 1
      AND (p -> 'stickers' -> 0 ->> 'code') = 'test_sticker'
  );
  v_actual := 'packs=' || jsonb_array_length(v_res);
  INSERT INTO _results VALUES ('T13', 'القائمة الإدارية تعرض الملصق الجديد', v_actual, v_ok);

  -- T14: الملصق المعطّل لا يُرسل
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
  UPDATE public.stickers SET is_active = false WHERE id = v_sticker2;
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_a::text, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.send_sticker_message(v_conv, v_sticker2,
      'm9-sticker-off-' || substr(gen_random_uuid()::text, 1, 12), 1000);
    v_ok := false;
    v_actual := 'قُبل ملصق معطّل — خطأ';
  EXCEPTION WHEN OTHERS THEN
    v_ok := position('الملصق غير متاح' in SQLERRM) > 0;
    v_actual := SQLERRM;
  END;
  INSERT INTO _results VALUES ('T14', 'الملصق المعطّل لا يُرسل', v_actual, v_ok);
END $do$;

SELECT * FROM _results ORDER BY step;

ROLLBACK;
