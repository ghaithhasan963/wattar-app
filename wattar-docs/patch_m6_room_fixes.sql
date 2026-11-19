-- ============================================================
-- patch_m7_room_realtime_attendees.sql — migration #68 (إصلاحات ما بعد M6)
--
-- 1) بث فوري لطلبات الصعود: إضافة room_seat_requests إلى نشر Realtime
--    (كانت الغرفة لا تستلم الطلبات مباشرة، فلا يعمل قبول/رفض الطلبات).
-- 2) كشف الحضور: دالة list_room_attendees تُرجع الحاضرين فعلياً
--    (المتحدثون على المقاعد + المستمعون حسب آخر نبضة حضور).
-- 3) طلبات الصعود للطاقم: دالة list_room_seat_requests تُرجع الطلبات
--    المعلقة مع بيانات المستخدم (بلا استعلامات إضافية على العميل).
-- 4) تسريع الشات: تبسيط سياسات القراءة على room_messages/room_seats
--    باستخدام دالتين مساعدتين STABLE (تُحسب مرة لكل استعلام بدل كل صف)،
--    وفهارس جديدة لحدود الإرسال.
--
-- لا تغيير في الصلاحيات المنطقية: نفس من يرى المحتوى كما في #67.
-- التراجع: إعادة إنشاء السياسات القديمة من #67 وحذف الدالتين والفهارس.
-- ============================================================
BEGIN;

SELECT set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, false);
SET search_path = public, extensions;

-- ============================================================
-- 1) نشر Realtime لطلبات الصعود
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    RAISE EXCEPTION 'Supabase realtime publication is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'room_seat_requests'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.room_seat_requests';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'room_messages'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.room_messages';
  END IF;
END;
$$;

-- ============================================================
-- 2) فهارس لحدود الإرسال وحساب الحضور
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_room_messages_user_created
  ON public.room_messages (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_room_presence_room_user
  ON public.room_presence (room_id, user_id);

-- ============================================================
-- 3) دالتان مساعدتان للقراءة (STABLE) بدل الاستعلامات المتشعبة لكل صف
-- ============================================================
CREATE OR REPLACE FUNCTION public.room_view_allowed(p_room_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT coalesce((
    SELECT (r.status <> 'closed' OR r.owner_id = p_user_id OR (p_user_id IS NOT NULL AND NOT r.is_private))
       AND (
         NOT r.is_private
         OR r.owner_id = p_user_id
         OR EXISTS (
           SELECT 1 FROM public.room_invitations i
           WHERE i.room_id = r.id AND i.recipient_id = p_user_id AND i.status = 'accepted'
         )
       )
       AND (
         NOT r.has_password
         OR r.owner_id = p_user_id
         OR EXISTS (
           SELECT 1 FROM public.room_password_verifications v
           WHERE v.room_id = r.id AND v.user_id = p_user_id
         )
       )
    FROM public.rooms r
    WHERE r.id = p_room_id
  ), false);
$$;
-- سياسات RLS تُقيَّم بصلاحية المستخدم، لذا يجب منح authenticated تنفيذ الدالتين
-- (وهما تعيدان قيمة منطقية فقط، ولا تكشف بيانات).
REVOKE ALL ON FUNCTION public.room_view_allowed(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.room_view_allowed(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.room_staff_read_allowed(p_room_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT coalesce((
    SELECT TRUE
    FROM public.rooms r
    WHERE r.id = p_room_id
      AND (
        r.second_admin_id = p_user_id
        OR EXISTS (
          SELECT 1 FROM public.room_moderators m
          WHERE m.room_id = r.id AND m.user_id = p_user_id
        )
        OR public.room_agency_role(r.id, p_user_id) IS NOT NULL
      )
  ), false);
$$;
REVOKE ALL ON FUNCTION public.room_staff_read_allowed(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.room_staff_read_allowed(uuid, uuid) TO authenticated;

-- سياسات قراءة مبسّطة: نفس شروط #67 عبر الدوال المساعدة
DROP POLICY IF EXISTS room_messages_room_select ON public.room_messages;
CREATE POLICY room_messages_room_select ON public.room_messages
  FOR SELECT TO authenticated
  USING (public.room_view_allowed(room_id, auth.uid()));

DROP POLICY IF EXISTS room_messages_staff_select ON public.room_messages;
CREATE POLICY room_messages_staff_select ON public.room_messages
  FOR SELECT TO authenticated
  USING (public.room_staff_read_allowed(room_id, auth.uid()));

-- سياسة المدعوين أصبحت مشمولة في room_view_allowed
DROP POLICY IF EXISTS wattar_room_messages_invited_read ON public.room_messages;

DROP POLICY IF EXISTS room_seats_room_select ON public.room_seats;
CREATE POLICY room_seats_room_select ON public.room_seats
  FOR SELECT TO authenticated
  USING (public.room_view_allowed(room_id, auth.uid()));

DROP POLICY IF EXISTS room_seats_staff_select ON public.room_seats;
CREATE POLICY room_seats_staff_select ON public.room_seats
  FOR SELECT TO authenticated
  USING (public.room_staff_read_allowed(room_id, auth.uid()));

DROP POLICY IF EXISTS wattar_room_seats_invited_read ON public.room_seats;

-- ============================================================
-- 4) كشف الحضور الفعلي (متحدثون + مستمعون)
-- ============================================================
CREATE OR REPLACE FUNCTION public.list_room_attendees(p_room_id uuid)
RETURNS TABLE(
  user_id uuid,
  username text,
  display_name text,
  avatar_url text,
  role text,
  is_speaker boolean,
  is_mic_on boolean,
  is_owner boolean,
  joined_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_room public.rooms%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً';
  END IF;

  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الغرفة غير موجودة';
  END IF;

  IF v_room.has_password
     AND public.room_password_gate_open(p_room_id, v_uid) IS NOT TRUE THEN
    RAISE EXCEPTION 'هذه الغرفة محمية بكلمة مرور';
  END IF;

  IF v_room.is_private
     AND v_room.owner_id <> v_uid
     AND public.room_actor_role(p_room_id, v_uid) IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.room_invitations i
       WHERE i.room_id = p_room_id AND i.recipient_id = v_uid AND i.status = 'accepted'
     ) THEN
    RAISE EXCEPTION 'لا تملك صلاحية دخول هذه الغرفة';
  END IF;

  RETURN QUERY
  WITH present AS (
    SELECT s.user_id, TRUE AS on_seat, s.is_mic_on, s.is_owner_seat, s.joined_at
    FROM public.room_seats s
    WHERE s.room_id = p_room_id
      AND s.user_id IS NOT NULL
      AND s.status = 'occupied'
    UNION ALL
    SELECT p.user_id, FALSE AS on_seat, FALSE AS is_mic_on, FALSE AS is_owner_seat,
           max(p.last_seen_at) AS joined_at
    FROM public.room_presence p
    WHERE p.room_id = p_room_id
      AND p.last_seen_at > now() - interval '90 seconds'
    GROUP BY p.user_id
  ),
  merged AS (
    SELECT pr.user_id,
           bool_or(pr.on_seat) AS on_seat,
           bool_or(pr.is_mic_on) AS is_mic_on,
           bool_or(pr.is_owner_seat) AS is_owner_seat,
           min(pr.joined_at) AS joined_at
    FROM present pr
    GROUP BY pr.user_id
  )
  SELECT u.id,
         u.username::text,
         u.display_name::text,
         u.avatar_url::text,
         coalesce(public.room_actor_role(p_room_id, u.id), 'listener') AS role,
         m.on_seat,
         m.is_mic_on,
         m.is_owner_seat,
         m.joined_at
  FROM merged m
  JOIN public.users u ON u.id = m.user_id
  ORDER BY m.is_owner_seat DESC, m.on_seat DESC, m.is_mic_on DESC,
           coalesce(nullif(u.display_name, ''), u.username);
END;
$$;
REVOKE ALL ON FUNCTION public.list_room_attendees(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_room_attendees(uuid) TO authenticated;

-- ============================================================
-- 5) طلبات الصعود المعلقة للطاقم (مع بيانات المستخدم)
-- ============================================================
CREATE OR REPLACE FUNCTION public.list_room_seat_requests(p_room_id uuid)
RETURNS TABLE(
  request_id uuid,
  user_id uuid,
  username text,
  display_name text,
  avatar_url text,
  requested_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً';
  END IF;

  IF NOT (
    EXISTS (SELECT 1 FROM public.rooms r WHERE r.id = p_room_id AND r.owner_id = v_uid)
    OR public.room_actor_role(p_room_id, v_uid) IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'لا تملك صلاحية عرض طلبات الصعود';
  END IF;

  RETURN QUERY
  SELECT q.id, q.user_id, u.username::text, u.display_name::text, u.avatar_url::text, q.requested_at
  FROM public.room_seat_requests q
  JOIN public.users u ON u.id = q.user_id
  WHERE q.room_id = p_room_id
    AND q.status = 'pending'
  ORDER BY q.requested_at
  LIMIT 100;
END;
$$;
REVOKE ALL ON FUNCTION public.list_room_seat_requests(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_room_seat_requests(uuid) TO authenticated;

-- ============================================================
-- 6) المالك يستعيد مقعده (0) بعد تركه — كان claim_room_seat يرفض
--    مقعد المالك مطلقاً فلا يستطيع المالك الجلوس مجدداً
-- ============================================================
CREATE OR REPLACE FUNCTION public.claim_room_seat(p_room_id uuid, p_seat_index smallint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_room public.rooms%ROWTYPE;
  v_seat public.room_seats%ROWTYPE;
  v_status public.user_status;
  v_adult timestamptz;
  v_role text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً';
  END IF;
  IF p_room_id IS NULL OR p_seat_index IS NULL OR p_seat_index < 0 THEN
    RAISE EXCEPTION 'بيانات المقعد غير صالحة';
  END IF;

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

  IF v_room.has_password AND (public.room_password_gate_open(p_room_id, v_uid) IS NOT TRUE) THEN
    RAISE EXCEPTION 'هذه الغرفة محمية بكلمة مرور';
  END IF;

  IF public.is_room_banned(p_room_id, v_uid) THEN
    RAISE EXCEPTION 'أنت محظور من هذه الغرفة';
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

  IF v_room.is_private AND v_room.owner_id <> v_uid THEN
    v_role := public.room_actor_role(p_room_id, v_uid);
    IF v_role IS NULL AND NOT EXISTS (
      SELECT 1 FROM public.room_invitations i
      WHERE i.room_id = p_room_id AND i.recipient_id = v_uid AND i.status = 'accepted'
    ) THEN
      RAISE EXCEPTION 'لا تملك صلاحية دخول هذه الغرفة';
    END IF;
  END IF;

  -- المقاعد مقفلة: الصعود يتطلب موافقة (طلب صعود) أو صلاحية إدارية
  IF v_room.seats_locked THEN
    v_role := coalesce(v_role, public.room_actor_role(p_room_id, v_uid));
    IF coalesce(v_role, '') NOT IN ('owner', 'second_admin', 'moderator', 'admin') THEN
      RAISE EXCEPTION 'المقاعد مقفلة حالياً؛ أرسل طلب صعود وانتظر موافقة الإدارة';
    END IF;
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
     AND (NOT is_owner_seat OR v_room.owner_id = v_uid)
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
REVOKE ALL ON FUNCTION public.claim_room_seat(uuid, smallint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_room_seat(uuid, smallint) TO authenticated;

COMMIT;
