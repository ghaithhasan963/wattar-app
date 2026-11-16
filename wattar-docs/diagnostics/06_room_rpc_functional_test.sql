-- ============================================================
-- diagnostics/06_room_rpc_functional_test.sql
-- اختبار وظيفي حقيقي لـ M2.3 (RPC الشات والمقاعد) على قاعدة الإنتاج.
-- لا يغيّر شيئاً في النهاية: كل شيء داخل BEGIN … ROLLBACK.
-- التشغيل: npx supabase db query --remote=vczyjbqixqzositlkfkn -f <هذا الملف> --yes
-- ============================================================
BEGIN;

CREATE TEMP TABLE _results (step text, expected text, actual text, ok boolean) ON COMMIT DROP;

DO $do$
DECLARE
  v_a uuid := '55942a3d-602c-4da1-99a1-05dbd1de82e9';   -- مالك الغرفة
  v_b uuid := '2488de9e-97d9-4fa6-aa0a-856de7189287';   -- مشارك
  v_room uuid;
  v_private_room uuid;
  v_room3 uuid;
  v_msg text;
  v_json jsonb;
  v_ok boolean;
  v_cnt integer;
  v_status text;
  v_user uuid;
  v_idx smallint;
  i integer;
BEGIN
  -- ---------------- إعداد داخل الترانزاكشن فقط ----------------
  UPDATE public.users SET adult_confirmed_at = now(), status = 'active' WHERE id IN (v_a, v_b);
  UPDATE public.users SET privacy_can_enter_rooms = 'public' WHERE id IN (v_a, v_b);

  -- غرفة عامة ملكها A (تُنشأ كمستخدم مصادق لاختبار سياسة rooms_owner_insert)
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_a::text, 'role', 'authenticated')::text, true);
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    INSERT INTO public.rooms (name, owner_id, seat_count, livekit_room_id, is_private)
    VALUES ('M2.3 test room', v_a, 4, 'm23-' || gen_random_uuid()::text, false)
    RETURNING id INTO v_room;
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_b::text, 'role', 'authenticated')::text, true);
    INSERT INTO public.rooms (name, owner_id, seat_count, livekit_room_id, is_private)
    VALUES ('M2.3 private room', v_b, 4, 'm23p-' || gen_random_uuid()::text, true)
    RETURNING id INTO v_private_room;
    EXECUTE 'RESET ROLE';
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
    RAISE EXCEPTION 'setup room insert failed: %', v_msg;
  END;

  -- ---------------- T1: مقعد المالك محجوز تلقائياً ----------------
  SELECT status::text, user_id, is_owner_seat INTO v_status, v_user, v_ok
  FROM public.room_seats WHERE room_id = v_room AND seat_index = 0;
  INSERT INTO _results VALUES ('T1', 'owner seat is occupied by owner',
    'status=' || v_status || ' owner=' || v_user::text, v_ok AND v_status = 'occupied' AND v_user = v_a);

  -- ---------------- T2: احتلال مقعد فارغ ----------------
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_b::text, 'role', 'authenticated')::text, true);
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT public.claim_room_seat(v_room, 1::smallint) INTO v_json;
    EXECUTE 'RESET ROLE';
    v_ok := (v_json->>'seat_index')::smallint = 1 AND (v_json->>'is_owner_seat')::boolean = false;
    INSERT INTO _results VALUES ('T2', 'claim empty seat succeeds', v_json::text, v_ok);
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
    INSERT INTO _results VALUES ('T2', 'claim empty seat succeeds', 'raised: ' || left(v_msg, 60), false);
  END;

  -- ---------------- T3: لا مقعدان لنفس المستخدم ----------------
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_b::text, 'role', 'authenticated')::text, true);
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN
      PERFORM public.claim_room_seat(v_room, 2::smallint);
      v_ok := false; v_msg := 'allowed';
    EXCEPTION WHEN others THEN
      v_ok := true; GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    END;
    EXECUTE 'RESET ROLE';
    INSERT INTO _results VALUES ('T3', 'second seat claim denied', 'denied=' || v_ok || ' ' || left(v_msg, 40), v_ok);
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
    INSERT INTO _results VALUES ('T3', 'second seat claim denied', 'harness: ' || left(v_msg, 60), false);
  END;

  -- ---------------- T4: رقم مقعد خارج النطاق ----------------
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_b::text, 'role', 'authenticated')::text, true);
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN
      PERFORM public.claim_room_seat(v_room, 99::smallint);
      v_ok := false; v_msg := 'allowed';
    EXCEPTION WHEN others THEN
      v_ok := true; GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    END;
    EXECUTE 'RESET ROLE';
    INSERT INTO _results VALUES ('T4', 'out-of-range seat denied', 'denied=' || v_ok || ' ' || left(v_msg, 40), v_ok);
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
    INSERT INTO _results VALUES ('T4', 'out-of-range seat denied', 'harness: ' || left(v_msg, 60), false);
  END;

  -- ---------------- T5: العميل لا يكتب في room_seats مباشرة ----------------
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_b::text, 'role', 'authenticated')::text, true);
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN
      UPDATE public.room_seats SET is_owner_seat = true WHERE room_id = v_room AND seat_index = 1;
      v_ok := false; v_msg := 'updated';
    EXCEPTION WHEN others THEN
      v_ok := true; GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    END;
    EXECUTE 'RESET ROLE';
    INSERT INTO _results VALUES ('T5', 'direct room_seats UPDATE denied', 'denied=' || v_ok || ' ' || left(v_msg, 40), v_ok);
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
    INSERT INTO _results VALUES ('T5', 'direct room_seats UPDATE denied', 'harness: ' || left(v_msg, 60), false);
  END;

  -- ---------------- T6: العميل لا يكتب في room_messages مباشرة ----------------
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_b::text, 'role', 'authenticated')::text, true);
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN
      INSERT INTO public.room_messages (room_id, user_id, message)
      VALUES (v_room, v_b, 'direct client insert');
      v_ok := false; v_msg := 'inserted';
    EXCEPTION WHEN others THEN
      v_ok := true; GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    END;
    EXECUTE 'RESET ROLE';
    INSERT INTO _results VALUES ('T6', 'direct room_messages INSERT denied', 'denied=' || v_ok || ' ' || left(v_msg, 40), v_ok);
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
    INSERT INTO _results VALUES ('T6', 'direct room_messages INSERT denied', 'harness: ' || left(v_msg, 60), false);
  END;

  -- ---------------- T7: إرسال رسالة عبر RPC ----------------
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_b::text, 'role', 'authenticated')::text, true);
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT public.send_room_message(v_room, 'مرحبا من الاختبار') INTO v_json;
    EXECUTE 'RESET ROLE';
    v_ok := (v_json->>'message') = 'مرحبا من الاختبار' AND (v_json->>'user_id')::uuid = v_b;
    INSERT INTO _results VALUES ('T7', 'RPC message send succeeds', v_json::text, v_ok);
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
    INSERT INTO _results VALUES ('T7', 'RPC message send succeeds', 'raised: ' || left(v_msg, 60), false);
  END;

  -- ---------------- T8: الكتم يمنع الإرسال ----------------
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_a::text, 'role', 'authenticated')::text, true);
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM public.room_owner_moderation_action(v_room, v_a, 'mute_chat', v_b, 5);
    EXECUTE 'RESET ROLE';
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
    INSERT INTO _results VALUES ('T8', 'owner mutes participant', 'mute failed: ' || left(v_msg, 60), false);
  END;

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_b::text, 'role', 'authenticated')::text, true);
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN
      PERFORM public.send_room_message(v_room, 'بعد الكتم');
      v_ok := false; v_msg := 'allowed';
    EXCEPTION WHEN others THEN
      v_ok := true; GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    END;
    EXECUTE 'RESET ROLE';
    INSERT INTO _results VALUES ('T8', 'muted user cannot send', 'denied=' || v_ok || ' ' || left(v_msg, 40), v_ok);
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
    INSERT INTO _results VALUES ('T8', 'muted user cannot send', 'harness: ' || left(v_msg, 60), false);
  END;

  -- ---------------- T9: فك الكتم يسمح بالإرسال ----------------
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_a::text, 'role', 'authenticated')::text, true);
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM public.room_owner_moderation_action(v_room, v_a, 'unmute_chat', v_b, NULL);
    EXECUTE 'RESET ROLE';
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
    INSERT INTO _results VALUES ('T9', 'owner unmutes participant', 'unmute failed: ' || left(v_msg, 60), false);
  END;

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_b::text, 'role', 'authenticated')::text, true);
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT public.send_room_message(v_room, 'بعد فك الكتم') INTO v_json;
    EXECUTE 'RESET ROLE';
    v_ok := (v_json->>'message') = 'بعد فك الكتم';
    INSERT INTO _results VALUES ('T9', 'send allowed after unmute', v_json::text, v_ok);
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
    INSERT INTO _results VALUES ('T9', 'send allowed after unmute', 'raised: ' || left(v_msg, 60), false);
  END;

  -- ---------------- T10: حد المعدل (6 رسائل خلال ثوانٍ) ----------------
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_b::text, 'role', 'authenticated')::text, true);
  v_ok := true;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    FOR i IN 1..6 LOOP
      BEGIN
        PERFORM public.send_room_message(v_room, 'سريعة ' || i);
      EXCEPTION WHEN others THEN
        v_ok := false;
        GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
        v_msg := 'rate limited at message ' || i || ': ' || v_msg;
      END;
    END LOOP;
    v_ok := NOT v_ok;
    EXECUTE 'RESET ROLE';
    INSERT INTO _results VALUES ('T10', '6th message in 10s denied', 'denied=' || v_ok || ' ' || left(v_msg, 40), v_ok);
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
    INSERT INTO _results VALUES ('T10', '6th message in 10s denied', 'harness: ' || left(v_msg, 60), false);
  END;

  -- ---------------- T11: ترك المقعد ----------------
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_b::text, 'role', 'authenticated')::text, true);
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT public.leave_room_seat(v_room) INTO v_json;
    EXECUTE 'RESET ROLE';
    SELECT status::text, user_id INTO v_status, v_user
    FROM public.room_seats WHERE room_id = v_room AND seat_index = 1;
    v_ok := (v_json->>'released')::boolean AND v_status = 'empty' AND v_user IS NULL;
    INSERT INTO _results VALUES ('T11', 'leave seat releases it', 'seat=' || v_status || ' json=' || v_json::text, v_ok);
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
    INSERT INTO _results VALUES ('T11', 'leave seat releases it', 'raised: ' || left(v_msg, 60), false);
  END;

  -- ---------------- T12: ترك مقعد غير موجود ----------------
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_b::text, 'role', 'authenticated')::text, true);
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN
      PERFORM public.leave_room_seat(v_room);
      v_ok := false; v_msg := 'allowed';
    EXCEPTION WHEN others THEN
      v_ok := true; GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    END;
    EXECUTE 'RESET ROLE';
    INSERT INTO _results VALUES ('T12', 'leave with no seat denied', 'denied=' || v_ok || ' ' || left(v_msg, 40), v_ok);
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
    INSERT INTO _results VALUES ('T12', 'leave with no seat denied', 'harness: ' || left(v_msg, 60), false);
  END;

  -- ---------------- T13: المالك لا يترك مقعده ----------------
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_a::text, 'role', 'authenticated')::text, true);
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN
      PERFORM public.leave_room_seat(v_room);
      v_ok := false; v_msg := 'allowed';
    EXCEPTION WHEN others THEN
      v_ok := true; GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    END;
    EXECUTE 'RESET ROLE';
    INSERT INTO _results VALUES ('T13', 'owner cannot leave owner seat', 'denied=' || v_ok || ' ' || left(v_msg, 40), v_ok);
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
    INSERT INTO _results VALUES ('T13', 'owner cannot leave owner seat', 'harness: ' || left(v_msg, 60), false);
  END;

  -- ---------------- T14: الميكروفون بلا مقعد ----------------
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_b::text, 'role', 'authenticated')::text, true);
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN
      PERFORM public.set_room_mic(v_room, true);
      v_ok := false; v_msg := 'allowed';
    EXCEPTION WHEN others THEN
      v_ok := true; GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    END;
    EXECUTE 'RESET ROLE';
    INSERT INTO _results VALUES ('T14', 'mic without seat denied', 'denied=' || v_ok || ' ' || left(v_msg, 40), v_ok);
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
    INSERT INTO _results VALUES ('T14', 'mic without seat denied', 'harness: ' || left(v_msg, 60), false);
  END;

  -- ---------------- T15: الميكروفون بعد احتلال مقعد ----------------
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_b::text, 'role', 'authenticated')::text, true);
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM public.claim_room_seat(v_room, 2::smallint);
    SELECT public.set_room_mic(v_room, true) INTO v_json;
    EXECUTE 'RESET ROLE';
    SELECT is_mic_on INTO v_ok FROM public.room_seats WHERE room_id = v_room AND seat_index = 2;
    INSERT INTO _results VALUES ('T15', 'mic toggles for seat holder', v_json::text || ' mic=' || v_ok, v_ok);
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
    INSERT INTO _results VALUES ('T15', 'mic toggles for seat holder', 'raised: ' || left(v_msg, 60), false);
  END;

  -- ---------------- T16: anon لا يستدعي RPC ----------------
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'anon')::text, true);
  BEGIN
    EXECUTE 'SET LOCAL ROLE anon';
    BEGIN
      PERFORM public.claim_room_seat(v_room, 3::smallint);
      v_ok := false; v_msg := 'allowed';
    EXCEPTION WHEN others THEN
      v_ok := true; GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    END;
    EXECUTE 'RESET ROLE';
    INSERT INTO _results VALUES ('T16', 'anon RPC call denied', 'denied=' || v_ok || ' ' || left(v_msg, 40), v_ok);
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
    INSERT INTO _results VALUES ('T16', 'anon RPC call denied', 'harness: ' || left(v_msg, 60), false);
  END;

  -- ---------------- T17: الغرفة المغلقة لا تقبل مقاعد ولا رسائل ----------------
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_a::text, 'role', 'authenticated')::text, true);
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM public.room_owner_moderation_action(v_room, v_a, 'close_room');
    EXECUTE 'RESET ROLE';
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
    INSERT INTO _results VALUES ('T17', 'owner closes room', 'close failed: ' || left(v_msg, 60), false);
  END;

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_b::text, 'role', 'authenticated')::text, true);
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN
      PERFORM public.claim_room_seat(v_room, 3::smallint);
      v_ok := false; v_msg := 'allowed';
    EXCEPTION WHEN others THEN
      v_ok := true; GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    END;
    BEGIN
      PERFORM public.send_room_message(v_room, 'بعد الإغلاق');
      v_ok := v_ok AND false; v_msg := v_msg || ' | send allowed';
    EXCEPTION WHEN others THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
      v_msg := 'seat denied; send denied: ' || v_msg;
    END;
    EXECUTE 'RESET ROLE';
    INSERT INTO _results VALUES ('T17', 'closed room rejects seat and message', left(v_msg, 80), v_ok);
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
    INSERT INTO _results VALUES ('T17', 'closed room rejects seat and message', 'harness: ' || left(v_msg, 60), false);
  END;

  -- ---------------- T18: الحظر يمنع الانضمام ----------------
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_a::text, 'role', 'authenticated')::text, true);
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM public.block_wattar_user(v_b);
    EXECUTE 'RESET ROLE';
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
    INSERT INTO _results VALUES ('T18', 'owner blocks participant', 'block failed: ' || left(v_msg, 60), false);
  END;

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_b::text, 'role', 'authenticated')::text, true);
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN
      PERFORM public.claim_room_seat(v_room, 3::smallint);
      v_ok := false; v_msg := 'allowed';
    EXCEPTION WHEN others THEN
      v_ok := true; GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    END;
    EXECUTE 'RESET ROLE';
    INSERT INTO _results VALUES ('T18', 'blocked user cannot claim seat', 'denied=' || v_ok || ' ' || left(v_msg, 40), v_ok);
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
    INSERT INTO _results VALUES ('T18', 'blocked user cannot claim seat', 'harness: ' || left(v_msg, 60), false);
  END;

  -- ---------------- T19: غرفة خاصة بلا دعوة ----------------
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_a::text, 'role', 'authenticated')::text, true);
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN
      PERFORM public.claim_room_seat(v_private_room, 1::smallint);
      v_ok := false; v_msg := 'allowed';
    EXCEPTION WHEN others THEN
      v_ok := true; GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    END;
    EXECUTE 'RESET ROLE';
    INSERT INTO _results VALUES ('T19', 'private room without invitation denied', 'denied=' || v_ok || ' ' || left(v_msg, 40), v_ok);
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
    INSERT INTO _results VALUES ('T19', 'private room without invitation denied', 'harness: ' || left(v_msg, 60), false);
  END;

  -- ---------------- T20: العميل لا يكتب في users / wallet_transactions ----------------
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_b::text, 'role', 'authenticated')::text, true);
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN
      UPDATE public.users SET total_deposited = 999999 WHERE id = v_b;
      v_ok := false; v_msg := 'users updated';
    EXCEPTION WHEN others THEN
      v_ok := true; GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    END;
    BEGIN
      INSERT INTO public.wallet_transactions (user_id, type, currency, amount, balance_before, balance_after)
      VALUES (v_b, 'deposit', 'coin', 100, 0, 100);
      v_ok := v_ok AND false; v_msg := v_msg || ' | wallet inserted';
    EXCEPTION WHEN others THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
      v_msg := 'wallet denied: ' || v_msg;
    END;
    EXECUTE 'RESET ROLE';
    INSERT INTO _results VALUES ('T20', 'direct financial writes denied', left(v_msg, 90), v_ok);
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
    INSERT INTO _results VALUES ('T20', 'direct financial writes denied', 'harness: ' || left(v_msg, 60), false);
  END;

  -- ---------------- T21: M2.4 — حد احتلال المقاعد 10/دقيقة عبر RPC ----------------
  -- ملاحظة سلوك: المحاولة الفاشلة ترفع استثناءً يتراجع معه كامل الحركة الفرعية
  -- (بما فيها زيادة العدّاد)، لذا العدّاد يعدّ العمليات الناجحة — في الإنتاج أيضاً.
  -- بيئة نظيفة: إزالة حظر T18 + غرفة ثالثة مفتوحة يملكها A (أغلاق T17 حرّر المقاعد)
  DELETE FROM public.user_blocks WHERE blocker_id = v_a AND blocked_id = v_b;
  INSERT INTO public.rooms (name, owner_id, seat_count, livekit_room_id, is_private)
  VALUES ('M2.4 rate limit room', v_a, 4, 'm24-' || gen_random_uuid()::text, false)
  RETURNING id INTO v_room3;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_b::text, 'role', 'authenticated')::text, true);
  -- قراءة العداد كـ postgres قبل دخول دور المستخدم (لا صلاحية له على الجدول)
  SELECT coalesce((SELECT request_count FROM public.rate_limit_buckets
    WHERE bucket_key = 'room_seat_claim:user:' || v_b::text), 0) INTO v_cnt;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    -- ملء الحصة حتى 10 بعمليات ناجحة (claim ثم leave)
    FOR i IN (v_cnt + 1)..10 LOOP
      PERFORM public.claim_room_seat(v_room3, 1::smallint);
      PERFORM public.leave_room_seat(v_room3);
    END LOOP;
    -- المحاولة التالية يجب أن تُرفض بسبب الحد
    BEGIN
      PERFORM public.claim_room_seat(v_room3, 1::smallint);
      v_ok := false; v_msg := 'allowed';
    EXCEPTION WHEN others THEN
      v_ok := true; GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    END;
    EXECUTE 'RESET ROLE';
    v_ok := v_ok AND v_msg LIKE '%انتظر%';
    INSERT INTO _results VALUES ('T21', '11th successful seat claim denied by rate limit',
      'msg=' || left(v_msg, 60), v_ok);
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
    INSERT INTO _results VALUES ('T21', '11th successful seat claim denied by rate limit',
      'harness: ' || left(v_msg, 60), false);
  END;

  BEGIN
    EXECUTE 'RESET ROLE';
  EXCEPTION WHEN others THEN NULL;
  END;
END;
$do$;

SELECT step, expected, actual, ok FROM _results ORDER BY step;

ROLLBACK;
