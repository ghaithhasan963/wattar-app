-- ============================================================
-- diagnostics/04_privacy_block_functional_test.sql
-- اختبار وظيفي حقيقي لـ M1.6 (الخصوصية) و M1.7 (الحظر) على قاعدة الإنتاج.
-- ⚠️ لا يغيّر شيئاً: كل شيء داخل BEGIN … ROLLBACK.
-- يُشغّل كامل السيناريو بهوية حسابين تجريبيين، ويطبع جدول نتائج ASCII.
-- التشغيل: npx supabase db query --remote=vczyjbqixqzositlkfkn -f <هذا الملف> --yes
-- ============================================================
BEGIN;

CREATE TEMP TABLE _results (step text, expected text, actual text, ok boolean) ON COMMIT DROP;

DO $do$
DECLARE
  v_a uuid := '2488de9e-97d9-4fa6-aa0a-856de7189287'; -- الشخص المستهدف (صاحب الإعدادات/الغرفة)
  v_b uuid := '55942a3d-602c-4da1-99a1-05dbd1de82e9'; -- الفاعل (المستخدم الآخر)
  v_room uuid;
  v_conv uuid;
  v_req uuid;
  v_msg text;
  v_quote jsonb;
  v_sent jsonb;
  v_ok boolean;
  v_cnt integer;
BEGIN
  -- تنظيف حالة الاختبار داخل المعاملة فقط
  DELETE FROM public.user_blocks WHERE (blocker_id = v_a AND blocked_id = v_b) OR (blocker_id = v_b AND blocked_id = v_a);
  DELETE FROM public.friend_requests WHERE (requester_id = v_a AND recipient_id = v_b) OR (requester_id = v_b AND recipient_id = v_a);
  DELETE FROM public.user_follows WHERE (follower_id = v_a AND followed_id = v_b) OR (follower_id = v_b AND followed_id = v_a);
  DELETE FROM public.stories WHERE user_id = v_a;
  DELETE FROM public.private_conversations WHERE (user_one_id = least(v_a, v_b) AND user_two_id = greatest(v_a, v_b));
  UPDATE public.users SET adult_confirmed_at = coalesce(adult_confirmed_at, now()),
                         onboarding_completed_at = coalesce(onboarding_completed_at, now()),
                         display_name = 'ZZ_FUNCTIONAL_TEST',
                         bio = 'ZZ_FUNCTIONAL_TEST_BIO'
  WHERE id IN (v_a, v_b);
  UPDATE public.users SET privacy_can_follow = 'public', privacy_can_message = 'public',
                         privacy_can_friend_request = 'public', privacy_can_view_stories = 'public',
                         privacy_can_view_info = 'public', privacy_can_enter_rooms = 'public'
  WHERE id = v_a;

  -- التصرف بهوية المستخدم B
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_b::text, 'role', 'authenticated')::text, true);

  -- ---------------- T1: متابعة مسموحة للكل ----------------
  BEGIN
    PERFORM public.follow_wattar_user(v_a);
    v_ok := EXISTS (SELECT 1 FROM public.user_follows WHERE follower_id = v_b AND followed_id = v_a);
    INSERT INTO _results VALUES ('T1', 'follow allowed (public)', 'row=' || v_ok, v_ok);
  EXCEPTION WHEN others THEN
    INSERT INTO _results VALUES ('T1', 'follow allowed (public)', 'raised', false);
  END;

  -- ---------------- T2: متابعة ممنوعة «لا أحد» ----------------
  DELETE FROM public.user_follows WHERE follower_id = v_b AND followed_id = v_a;
  UPDATE public.users SET privacy_can_follow = 'none' WHERE id = v_a;
  BEGIN
    PERFORM public.follow_wattar_user(v_a);
    INSERT INTO _results VALUES ('T2', 'follow blocked (none)', 'no exception', false);
  EXCEPTION WHEN others THEN
    INSERT INTO _results VALUES ('T2', 'follow blocked (none)', 'raised', true);
  END;

  -- ---------------- T3: متابعة «الأصدقاء فقط» بدون صداقة ----------------
  UPDATE public.users SET privacy_can_follow = 'friends' WHERE id = v_a;
  BEGIN
    PERFORM public.follow_wattar_user(v_a);
    INSERT INTO _results VALUES ('T3', 'follow blocked (friends, not friend)', 'no exception', false);
  EXCEPTION WHEN others THEN
    INSERT INTO _results VALUES ('T3', 'follow blocked (friends, not friend)', 'raised', true);
  END;

  -- ---------------- T4: متابعة «الأصدقاء فقط» مع صداقة مقبولة ----------------
  INSERT INTO public.friend_requests (requester_id, recipient_id, status) VALUES (v_a, v_b, 'accepted')
  ON CONFLICT (requester_id, recipient_id) DO UPDATE SET status = 'accepted';
  BEGIN
    PERFORM public.follow_wattar_user(v_a);
    v_ok := EXISTS (SELECT 1 FROM public.user_follows WHERE follower_id = v_b AND followed_id = v_a);
    INSERT INTO _results VALUES ('T4', 'follow allowed (friends)', 'row=' || v_ok, v_ok);
  EXCEPTION WHEN others THEN
    INSERT INTO _results VALUES ('T4', 'follow allowed (friends)', 'raised', false);
  END;

  -- ---------------- T5: طلب صداقة ممنوع «لا أحد» ----------------
  DELETE FROM public.friend_requests WHERE (requester_id = v_a AND recipient_id = v_b) OR (requester_id = v_b AND recipient_id = v_a);
  DELETE FROM public.user_follows WHERE (follower_id = v_a AND followed_id = v_b) OR (follower_id = v_b AND followed_id = v_a);
  UPDATE public.users SET privacy_can_friend_request = 'none' WHERE id = v_a;
  BEGIN
    PERFORM public.send_friend_request(v_a);
    INSERT INTO _results VALUES ('T5', 'friend request blocked (none)', 'no exception', false);
  EXCEPTION WHEN others THEN
    INSERT INTO _results VALUES ('T5', 'friend request blocked (none)', 'raised', true);
  END;

  -- ---------------- T6: رؤية المعلومات «لا أحد» ----------------
  UPDATE public.users SET privacy_can_friend_request = 'public', privacy_can_view_info = 'none' WHERE id = v_a;
  BEGIN
    SELECT count(*) INTO v_cnt FROM public.get_wattar_profile(v_a) p
    WHERE p.is_private = true AND p.display_name IS NULL AND p.bio IS NULL;
    INSERT INTO _results VALUES ('T6', 'profile masked (view_info=none)', 'masked_rows=' || v_cnt, v_cnt = 1);
  EXCEPTION WHEN others THEN
    INSERT INTO _results VALUES ('T6', 'profile masked (view_info=none)', 'raised', false);
  END;

  -- ---------------- T7: صور الملف محجوبة عند view_info=none ----------------
  BEGIN
    SELECT count(*) INTO v_cnt FROM public.list_wattar_profile_posts(v_a);
    INSERT INTO _results VALUES ('T7', 'profile posts hidden (view_info=none)', 'posts=' || v_cnt, v_cnt = 0);
  EXCEPTION WHEN others THEN
    INSERT INTO _results VALUES ('T7', 'profile posts hidden (view_info=none)', 'raised', false);
  END;

  -- ---------------- T8: رؤية المعلومات مسموحة للأصدقاء ----------------
  INSERT INTO public.friend_requests (requester_id, recipient_id, status) VALUES (v_a, v_b, 'accepted')
  ON CONFLICT (requester_id, recipient_id) DO UPDATE SET status = 'accepted';
  UPDATE public.users SET privacy_can_view_info = 'friends' WHERE id = v_a;
  BEGIN
    SELECT count(*) INTO v_cnt FROM public.get_wattar_profile(v_a) p
    WHERE p.is_private = false AND p.display_name = 'ZZ_FUNCTIONAL_TEST' AND p.bio = 'ZZ_FUNCTIONAL_TEST_BIO';
    INSERT INTO _results VALUES ('T8', 'profile visible (view_info=friends, friend)', 'visible_rows=' || v_cnt, v_cnt = 1);
  EXCEPTION WHEN others THEN
    INSERT INTO _results VALUES ('T8', 'profile visible (view_info=friends, friend)', 'raised', false);
  END;

  -- ---------------- T9: القصص: ظاهرة ثم محجوبة ----------------
  UPDATE public.users SET privacy_can_view_stories = 'public', privacy_can_view_info = 'public' WHERE id = v_a;
  INSERT INTO public.stories (user_id, media_path, media_type, caption, expires_at)
  VALUES (v_a, 'test/functional-story.jpg', 'image', 'test', now() + interval '1 hour');
  SELECT count(*) INTO v_cnt FROM public.list_active_stories() s WHERE s.user_id = v_a;
  INSERT INTO _results VALUES ('T9a', 'story visible (view_stories=public)', 'rows=' || v_cnt, v_cnt = 1);
  UPDATE public.users SET privacy_can_view_stories = 'none' WHERE id = v_a;
  SELECT count(*) INTO v_cnt FROM public.list_active_stories() s WHERE s.user_id = v_a;
  INSERT INTO _results VALUES ('T9b', 'story hidden (view_stories=none)', 'rows=' || v_cnt, v_cnt = 0);

  -- ---------------- T10: الحظر ينظّف الصداقة والمتابعة ----------------
  INSERT INTO public.friend_requests (requester_id, recipient_id, status) VALUES (v_a, v_b, 'accepted')
  ON CONFLICT (requester_id, recipient_id) DO UPDATE SET status = 'accepted';
  INSERT INTO public.user_follows (follower_id, followed_id) VALUES (v_b, v_a), (v_a, v_b) ON CONFLICT DO NOTHING;
  BEGIN
    PERFORM public.block_wattar_user(v_a);
    SELECT count(*) INTO v_cnt FROM public.user_follows
    WHERE (follower_id = v_a AND followed_id = v_b) OR (follower_id = v_b AND followed_id = v_a);
    v_ok := EXISTS (SELECT 1 FROM public.user_blocks WHERE blocker_id = v_b AND blocked_id = v_a)
            AND NOT EXISTS (SELECT 1 FROM public.friend_requests
                            WHERE ((requester_id = v_a AND recipient_id = v_b)
                                OR (requester_id = v_b AND recipient_id = v_a))
                              AND status = 'accepted')
            AND v_cnt = 0;
    INSERT INTO _results VALUES ('T10', 'block cancels friendship and follows', 'ok=' || v_ok, v_ok);
  EXCEPTION WHEN others THEN
    INSERT INTO _results VALUES ('T10', 'block cancels friendship and follows', 'raised', false);
  END;

  -- ---------------- T11: الحظر يمنع دخول الغرفة ----------------
  -- إنشاء الغرفة يتم بهوية صاحبها (A) لأنه super_admin، ثم نعود لهوية B.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_a::text, 'role', 'authenticated')::text, true);
  INSERT INTO public.rooms (name, owner_id, livekit_room_id, status)
  VALUES ('test-functional-room', v_a, 'test_functional_room', 'waiting')
  RETURNING id INTO v_room;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_b::text, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.record_wattar_room_presence(v_room, v_b, 'test-session-0001', true);
    INSERT INTO _results VALUES ('T11', 'room join blocked while blocked', 'no exception', false);
  EXCEPTION WHEN others THEN
    INSERT INTO _results VALUES ('T11', 'room join blocked while blocked', 'raised', true);
  END;

  -- ---------------- T12: خصوصية الغرف «لا أحد» ----------------
  PERFORM public.unblock_wattar_user(v_a);
  UPDATE public.users SET privacy_can_enter_rooms = 'none' WHERE id = v_a;
  BEGIN
    PERFORM public.record_wattar_room_presence(v_room, v_b, 'test-session-0002', true);
    INSERT INTO _results VALUES ('T12', 'room join blocked (enter_rooms=none)', 'no exception', false);
  EXCEPTION WHEN others THEN
    INSERT INTO _results VALUES ('T12', 'room join blocked (enter_rooms=none)', 'raised', true);
  END;

  -- ---------------- T13: دخول الغرفة مسموح عند السماح ----------------
  UPDATE public.users SET privacy_can_enter_rooms = 'public' WHERE id = v_a;
  BEGIN
    PERFORM public.record_wattar_room_presence(v_room, v_b, 'test-session-0003', true);
    v_ok := EXISTS (SELECT 1 FROM public.room_presence WHERE room_id = v_room AND user_id = v_b);
    INSERT INTO _results VALUES ('T13', 'room join allowed (enter_rooms=public)', 'presence=' || v_ok, v_ok);
  EXCEPTION WHEN others THEN
    INSERT INTO _results VALUES ('T13', 'room join allowed (enter_rooms=public)', 'raised', false);
  END;

  -- ---------------- T14: خصوصية المراسلة في عرض السعر ----------------
  INSERT INTO public.private_conversations (user_one_id, user_two_id)
  VALUES (least(v_a, v_b), greatest(v_a, v_b))
  ON CONFLICT (user_one_id, user_two_id) DO UPDATE SET updated_at = public.private_conversations.updated_at
  RETURNING id INTO v_conv;
  UPDATE public.users SET privacy_can_message = 'none' WHERE id = v_a;
  BEGIN
    v_quote := public.get_private_message_quote(v_conv);
    INSERT INTO _results VALUES ('T14', 'quote blocked (message=none)', 'no exception', false);
  EXCEPTION WHEN others THEN
    INSERT INTO _results VALUES ('T14', 'quote blocked (message=none)', 'raised', true);
  END;

  -- ---------------- T15: خصوصية المراسلة في الإرسال ----------------
  BEGIN
    v_sent := public.send_private_message(v_conv, 'test body', 'test-idempotency-key-0001', 0);
    INSERT INTO _results VALUES ('T15', 'send blocked (message=none)', 'no exception', false);
  EXCEPTION WHEN others THEN
    INSERT INTO _results VALUES ('T15', 'send blocked (message=none)', 'raised', true);
  END;

  -- ---------------- T16: المراسلة مسموحة للأصدقاء ----------------
  UPDATE public.users SET privacy_can_message = 'friends' WHERE id = v_a;
  INSERT INTO public.friend_requests (requester_id, recipient_id, status) VALUES (v_a, v_b, 'accepted')
  ON CONFLICT (requester_id, recipient_id) DO UPDATE SET status = 'accepted';
  BEGIN
    v_quote := public.get_private_message_quote(v_conv);
    v_ok := v_quote ? 'price_coin' AND (v_quote ->> 'is_friend')::boolean = true;
    INSERT INTO _results VALUES ('T16', 'quote allowed (message=friends, friend)', 'ok=' || v_ok, v_ok);
  EXCEPTION WHEN others THEN
    INSERT INTO _results VALUES ('T16', 'quote allowed (message=friends, friend)', 'raised', false);
  END;

  -- ---------------- T17: الإرسال مسموح للأصدقاء ----------------
  BEGIN
    v_sent := public.send_private_message(v_conv, 'test body', 'test-idempotency-key-0002', 0);
    v_ok := (v_sent ->> 'already_processed')::boolean = false
            AND (v_sent ->> 'charged_coins')::bigint = 0;
    INSERT INTO _results VALUES ('T17', 'send allowed (message=friends, friend)', 'ok=' || v_ok, v_ok);
  EXCEPTION WHEN others THEN
    INSERT INTO _results VALUES ('T17', 'send allowed (message=friends, friend)', 'raised', false);
  END;
  -- ---------------- T18: قبول طلب صداقة (يتطلب سلامة تريغر friend_requests) ----------------
  -- حالة نظيفة: لا حظر ولا طلبات سابقة بين الحسابين
  DELETE FROM public.user_blocks
   WHERE (blocker_id = v_a AND blocked_id = v_b) OR (blocker_id = v_b AND blocked_id = v_a);
  DELETE FROM public.friend_requests
   WHERE (requester_id = v_a AND recipient_id = v_b) OR (requester_id = v_b AND recipient_id = v_a);
  BEGIN
    INSERT INTO public.friend_requests (requester_id, recipient_id, status)
    VALUES (v_b, v_a, 'pending')
    ON CONFLICT (requester_id, recipient_id) DO UPDATE SET status = 'pending'
    RETURNING id INTO v_req;
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_a::text, 'role', 'authenticated')::text, true);
    PERFORM public.respond_friend_request(v_req, true);
    v_ok := EXISTS (
      SELECT 1 FROM public.friend_requests f
      WHERE f.id = v_req AND f.status = 'accepted'
    );
    INSERT INTO _results VALUES ('T18', 'friend request accepted (audit trigger fixed)', 'ok=' || v_ok, v_ok);
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    INSERT INTO _results VALUES ('T18', 'friend request accepted (audit trigger fixed)', 'raised: ' || v_msg, false);
  END;
END;
$do$;

SELECT step, expected, actual, ok FROM _results ORDER BY step;

ROLLBACK;
