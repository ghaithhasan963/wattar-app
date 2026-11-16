-- ============================================================
-- patch_wire_rate_limit_rpc.sql — migration #49 (M2.4 ربط حد الطلبات بـ RPC الغرف)
--
-- الهدف: توصيل دوال الغرف بنظام حد الطلبات القاعدي (#48):
--   - claim_room_seat:  'seat_claim' — 10 محاولات/دقيقة (لم يكن له حد سابقاً)
--   - send_room_message:'message'    — 30/دقيقة (تكميلي للحد الأدق داخل الدالة)
--   - set_room_mic:     'mic_toggle' — 20/دقيقة (لم يكن له حد سابقاً)
--
-- عند تجاوز الحد: check_room_rate_limit تسجل حدث rate_limit_exceeded
-- في risk_events تلقائياً (تغذية لنظام تقييم المخاطر).
--
-- الأجسام معاد كتابتها كما في #47 مع إضافة فحص الحد فقط.
-- آمن للإعادة: CREATE OR REPLACE.
-- التراجع: إعادة تطبيق patch_room_rpc.sql (#47).
-- ============================================================
BEGIN;

-- ---------- 1) احتلال مقعد (مع حد 10/دقيقة) ----------
CREATE OR REPLACE FUNCTION public.claim_room_seat(p_room_id uuid, p_seat_index smallint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_room public.rooms%ROWTYPE;
  v_seat public.room_seats%ROWTYPE;
  v_status public.user_status;
  v_adult timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً';
  END IF;
  IF p_room_id IS NULL OR p_seat_index IS NULL OR p_seat_index < 0 THEN
    RAISE EXCEPTION 'بيانات المقعد غير صالحة';
  END IF;

  -- M2.4: حد طلبات قاعدي (نافذة منزلقة + تسجيل خطر عند التجاوز)
  IF NOT ((public.check_room_rate_limit('seat_claim', v_uid) ->> 'allowed')::boolean) THEN
    RAISE EXCEPTION 'عدد كبير من محاولات احتلال المقاعد، انتظر قليلاً ثم أعد المحاولة';
  END IF;

  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الغرفة غير موجودة';
  END IF;
  IF v_room.status = 'closed' THEN
    RAISE EXCEPTION 'الغرفة مغلقة';
  END IF;
  IF p_seat_index >= v_room.seat_count THEN
    RAISE EXCEPTION 'رقم المقعد غير صالح';
  END IF;

  SELECT u.status, u.adult_confirmed_at INTO v_status, v_adult
  FROM public.users u WHERE u.id = v_uid;
  IF NOT FOUND OR v_status <> 'active' OR v_adult IS NULL THEN
    RAISE EXCEPTION 'الحساب غير مؤهل للانضمام إلى الغرف';
  END IF;

  IF v_room.owner_id <> v_uid AND EXISTS (
    SELECT 1 FROM public.user_blocks b
    WHERE (b.blocker_id = v_uid AND b.blocked_id = v_room.owner_id)
       OR (b.blocker_id = v_room.owner_id AND b.blocked_id = v_uid)
  ) THEN
    RAISE EXCEPTION 'لا يمكنك الانضمام إلى غرفة هذا المستخدم';
  END IF;

  IF v_room.owner_id <> v_uid
     AND NOT public.check_privacy_permission(v_room.owner_id, 'enter_rooms', v_uid) THEN
    RAISE EXCEPTION 'صاحب الغرفة لا يسمح لك بدخول غرفته';
  END IF;

  IF v_room.is_private AND v_room.owner_id <> v_uid AND NOT EXISTS (
    SELECT 1 FROM public.room_invitations i
    WHERE i.room_id = p_room_id AND i.recipient_id = v_uid AND i.status = 'accepted'
  ) THEN
    RAISE EXCEPTION 'لا تملك صلاحية دخول هذه الغرفة';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.room_seats s
    WHERE s.room_id = p_room_id AND s.user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'لديك مقعد في هذه الغرفة بالفعل';
  END IF;

  UPDATE public.room_seats
     SET user_id = v_uid,
         status = 'occupied',
         is_mic_on = false,
         joined_at = now(),
         updated_at = now()
   WHERE room_id = p_room_id
     AND seat_index = p_seat_index
     AND status = 'empty'
     AND user_id IS NULL
     AND NOT is_owner_seat
  RETURNING * INTO v_seat;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'المقعد مشغول';
  END IF;

  RETURN jsonb_build_object(
    'seat_id', v_seat.id,
    'room_id', v_seat.room_id,
    'seat_index', v_seat.seat_index,
    'is_mic_on', v_seat.is_mic_on,
    'is_owner_seat', v_seat.is_owner_seat,
    'joined_at', v_seat.joined_at
  );
END;
$fn$;

-- ---------- 2) تشغيل/كتم الميكروفون (مع حد 20/دقيقة) ----------
CREATE OR REPLACE FUNCTION public.set_room_mic(p_room_id uuid, p_enabled boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_seat public.room_seats%ROWTYPE;
  v_room_status public.room_status;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً';
  END IF;
  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'حالة الميكروفون غير صالحة';
  END IF;

  -- M2.4: حد طلبات قاعدي
  IF NOT ((public.check_room_rate_limit('mic_toggle', v_uid) ->> 'allowed')::boolean) THEN
    RAISE EXCEPTION 'عدد كبير من محاولات تغيير الميكروفون، انتظر قليلاً';
  END IF;

  SELECT r.status INTO v_room_status
  FROM public.rooms r WHERE r.id = p_room_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الغرفة غير موجودة';
  END IF;
  IF v_room_status = 'closed' THEN
    RAISE EXCEPTION 'الغرفة مغلقة';
  END IF;

  UPDATE public.room_seats
     SET is_mic_on = p_enabled,
         updated_at = now()
   WHERE room_id = p_room_id AND user_id = v_uid AND status = 'occupied'
  RETURNING * INTO v_seat;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'يجب احتلال مقعد قبل استخدام الميكروفون';
  END IF;

  RETURN jsonb_build_object(
    'room_id', v_seat.room_id,
    'seat_index', v_seat.seat_index,
    'is_mic_on', v_seat.is_mic_on
  );
END;
$fn$;

-- ---------- 3) إرسال رسالة (مع حد قاعدي 30/دقيقة تكميلي) ----------
CREATE OR REPLACE FUNCTION public.send_room_message(p_room_id uuid, p_message text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_body text := btrim(coalesce(p_message, ''));
  v_room public.rooms%ROWTYPE;
  v_status public.user_status;
  v_adult timestamptz;
  v_recent integer;
  v_msg public.room_messages%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً';
  END IF;
  IF length(v_body) < 1 OR length(v_body) > 500 THEN
    RAISE EXCEPTION 'الرسالة يجب أن تكون بين 1 و500 حرف';
  END IF;

  -- M2.4: حد قاعدي تكميلي (الأدق 5/10ث و20/دقيقة يبقى أدناه)
  IF NOT ((public.check_room_rate_limit('message', v_uid) ->> 'allowed')::boolean) THEN
    RAISE EXCEPTION 'تجاوزت حد الرسائل المسموح، انتظر قليلاً';
  END IF;

  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الغرفة غير موجودة';
  END IF;
  IF v_room.status = 'closed' THEN
    RAISE EXCEPTION 'لا يمكن إرسال رسائل إلى غرفة مغلقة';
  END IF;

  SELECT u.status, u.adult_confirmed_at INTO v_status, v_adult
  FROM public.users u WHERE u.id = v_uid;
  IF NOT FOUND OR v_status <> 'active' OR v_adult IS NULL THEN
    RAISE EXCEPTION 'الحساب غير مؤهل لإرسال الرسائل';
  END IF;

  IF v_room.owner_id <> v_uid AND EXISTS (
    SELECT 1 FROM public.user_blocks b
    WHERE (b.blocker_id = v_uid AND b.blocked_id = v_room.owner_id)
       OR (b.blocker_id = v_room.owner_id AND b.blocked_id = v_uid)
  ) THEN
    RAISE EXCEPTION 'لا يمكنك إرسال رسائل إلى هذه الغرفة';
  END IF;

  IF v_room.is_private AND v_room.owner_id <> v_uid AND NOT EXISTS (
    SELECT 1 FROM public.room_invitations i
    WHERE i.room_id = p_room_id AND i.recipient_id = v_uid AND i.status = 'accepted'
  ) THEN
    RAISE EXCEPTION 'لا تملك صلاحية الكتابة في هذه الغرفة';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.room_chat_mutes m
    WHERE m.room_id = p_room_id AND m.user_id = v_uid AND m.expires_at > now()
  ) THEN
    RAISE EXCEPTION 'تم كتم محادثتك مؤقتًا في هذه الغرفة';
  END IF;

  -- حدّ معدل أدق: 5 رسائل / 10 ثوانٍ في الغرفة، و20 رسالة / دقيقة إجمالاً.
  SELECT count(*) INTO v_recent
  FROM public.room_messages m
  WHERE m.user_id = v_uid
    AND NOT m.is_system
    AND m.room_id = p_room_id
    AND m.created_at > now() - interval '10 seconds';
  IF v_recent >= 5 THEN
    RAISE EXCEPTION 'أنت ترسل الرسائل بسرعة كبيرة، انتظر قليلًا';
  END IF;

  SELECT count(*) INTO v_recent
  FROM public.room_messages m
  WHERE m.user_id = v_uid
    AND NOT m.is_system
    AND m.created_at > now() - interval '60 seconds';
  IF v_recent >= 20 THEN
    RAISE EXCEPTION 'تجاوزت حد الرسائل المسموح في الدقيقة';
  END IF;

  INSERT INTO public.room_messages (room_id, user_id, message, is_system)
  VALUES (p_room_id, v_uid, v_body, false)
  RETURNING * INTO v_msg;

  RETURN jsonb_build_object(
    'id', v_msg.id,
    'room_id', v_msg.room_id,
    'user_id', v_msg.user_id,
    'message', v_msg.message,
    'is_system', v_msg.is_system,
    'created_at', v_msg.created_at
  );
END;
$fn$;

-- ---------- 4) منح التنفيذ (كما في #47) ----------
REVOKE ALL ON FUNCTION public.claim_room_seat(uuid, smallint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_room_mic(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.send_room_message(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_room_seat(uuid, smallint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_room_mic(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_room_message(uuid, text) TO authenticated;

COMMIT;
