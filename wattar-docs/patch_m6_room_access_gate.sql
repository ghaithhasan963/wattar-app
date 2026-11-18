-- ============================================================
-- patch_m6_room_access_gate.sql — migration #67 (M6.6 تتمة)
--
-- سد ثغرة بوابة كلمة المرور على مستوى القاعدة:
--   - نجاح room_password_check يسجّل تحققاً دائماً (room_password_verifications)
--     يُلغى تلقائياً عند تغيير كلمة المرور (زناد على room_passwords).
--   - صف الغرفة نفسه يبقى مرئياً (لاكتشاف الغرفة وإدخال كلمة المرور)،
--     أما المحتوى — المقاعد والرسائل واحتلال المقاعد وطلبات الصعود —
--     فيُخفى/يُرفض لغير المتحققين (عدا المالك والطاقم والوكالة المعنية).
--   - الفحوص عبر الدالة المساعدة room_password_gate_open (SECURITY DEFINER)
--     لتفادي انعكاس سياسات RLS على الجداول المرجعية داخل السياسات.
--
-- التراجع: إعادة patch_m6_room_permissions.sql لا تكفي — تُعاد سياسات
-- patch_room_owner_moderation.sql وتُحذف هذه الجداول/الزنادات يدوياً.
-- ============================================================
BEGIN;

SELECT set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, false);
SET search_path = public, extensions;

-- ============================================================
-- 1) سجل التحقق من كلمة مرور الغرفة
-- ============================================================
CREATE TABLE IF NOT EXISTS public.room_password_verifications (
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  verified_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_room_password_verifications_user
  ON public.room_password_verifications (user_id);
ALTER TABLE public.room_password_verifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.room_password_verifications FROM PUBLIC, anon, authenticated;

-- إلغاء التحقق عند تغيير كلمة المرور أو إزالتها
CREATE OR REPLACE FUNCTION public.clear_room_password_verifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     OR (TG_OP = 'UPDATE' AND OLD.password_hash IS DISTINCT FROM NEW.password_hash) THEN
    DELETE FROM public.room_password_verifications WHERE room_id = OLD.room_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
REVOKE ALL ON FUNCTION public.clear_room_password_verifications() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS clear_room_password_verifications ON public.room_passwords;
CREATE TRIGGER clear_room_password_verifications
  AFTER UPDATE OR DELETE ON public.room_passwords
  FOR EACH ROW EXECUTE FUNCTION public.clear_room_password_verifications();

-- ============================================================
-- 2) room_password_check: تسجيل التحقق عند النجاح
-- ============================================================
CREATE OR REPLACE FUNCTION public.room_password_check(
  p_room_id uuid,
  p_user_id uuid,
  p_password text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_hash text;
  v_att public.room_password_attempts%ROWTYPE;
  v_retry integer := 0;
  v_ok boolean := false;
BEGIN
  SELECT rp.password_hash INTO v_hash
  FROM public.room_passwords rp WHERE rp.room_id = p_room_id;
  IF NOT FOUND OR v_hash IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'locked', false, 'reason', 'no_password');
  END IF;
  IF p_password IS NULL OR btrim(p_password) = '' THEN
    RETURN jsonb_build_object('ok', false, 'locked', false, 'reason', 'empty_password');
  END IF;

  SELECT * INTO v_att
  FROM public.room_password_attempts a
  WHERE a.room_id = p_room_id AND a.user_id = p_user_id
  FOR UPDATE;

  -- نافذة 10 دقائق / 5 محاولات
  IF v_att.window_start < now() - interval '10 minutes' THEN
    v_att.attempts := 0;
    v_att.window_start := now();
  END IF;
  IF v_att.attempts >= 5 THEN
    v_retry := greatest(0, ceil(extract(epoch FROM (v_att.window_start + interval '10 minutes' - now())))::integer);
    RETURN jsonb_build_object(
      'ok', false, 'locked', true, 'retry_after_seconds', v_retry, 'reason', 'too_many_attempts'
    );
  END IF;

  v_ok := crypt(encode(digest(p_password, 'sha256'), 'hex'), v_hash) = v_hash;

  IF v_ok THEN
    DELETE FROM public.room_password_attempts
    WHERE room_id = p_room_id AND user_id = p_user_id;
    INSERT INTO public.room_password_verifications (room_id, user_id, verified_at)
    VALUES (p_room_id, p_user_id, now())
    ON CONFLICT (room_id, user_id) DO UPDATE
      SET verified_at = now();
    RETURN jsonb_build_object('ok', true, 'locked', false);
  END IF;

  INSERT INTO public.room_password_attempts (room_id, user_id, attempts, window_start, last_attempt_at)
  VALUES (p_room_id, p_user_id, 1, now(), now())
  ON CONFLICT (room_id, user_id) DO UPDATE
    SET attempts = public.room_password_attempts.attempts + 1,
        last_attempt_at = now(),
        window_start = CASE
          WHEN public.room_password_attempts.window_start < now() - interval '10 minutes'
          THEN now()
          ELSE public.room_password_attempts.window_start
        END;

  v_att.attempts := coalesce(v_att.attempts, 0) + 1;
  IF v_att.attempts >= 5 THEN
    RETURN jsonb_build_object('ok', false, 'locked', true, 'retry_after_seconds', 600, 'reason', 'too_many_attempts');
  END IF;

  RETURN jsonb_build_object(
    'ok', false, 'locked', false,
    'attempts_left', greatest(0, 5 - v_att.attempts),
    'reason', 'wrong_password'
  );
END;
$$;
REVOKE ALL ON FUNCTION public.room_password_check(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.room_password_check(uuid, uuid, text) TO service_role;

-- ============================================================
-- 3) مساعد: هل المستخدم متحقق/مصرح له بغرفة محمية؟
-- ============================================================
CREATE OR REPLACE FUNCTION public.room_password_gate_open(p_room_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT coalesce(
    NOT coalesce(r.has_password, false)
    OR r.owner_id = p_user_id
    OR r.second_admin_id = p_user_id
    OR EXISTS (
      SELECT 1 FROM public.room_moderators m
      WHERE m.room_id = p_room_id AND m.user_id = p_user_id
    )
    OR public.room_agency_role(p_room_id, p_user_id) IS NOT NULL
    OR EXISTS (
      SELECT 1 FROM public.room_password_verifications v
      WHERE v.room_id = p_room_id AND v.user_id = p_user_id
    ), false)
  FROM public.rooms r
  WHERE r.id = p_room_id;
$$;
REVOKE ALL ON FUNCTION public.room_password_gate_open(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.room_password_gate_open(uuid, uuid) TO authenticated, service_role;

-- ============================================================
-- 4) فرض البوابة على احتلال المقاعد وطلب الصعود والرسائل
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
REVOKE ALL ON FUNCTION public.claim_room_seat(uuid, smallint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_room_seat(uuid, smallint) TO authenticated;

CREATE OR REPLACE FUNCTION public.request_room_seat(p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_room public.rooms%ROWTYPE;
  v_status public.user_status;
  v_adult timestamptz;
  v_request public.room_seat_requests%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول أولاً'; END IF;
  IF p_room_id IS NULL THEN RAISE EXCEPTION 'بيانات غير صالحة'; END IF;

  IF NOT ((public.check_room_rate_limit('seat_claim', v_uid) ->> 'allowed')::boolean) THEN
    RAISE EXCEPTION 'عدد كبير من الطلبات، انتظر قليلاً ثم أعد المحاولة';
  END IF;

  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الغرفة غير موجودة'; END IF;
  IF v_room.status = 'closed' THEN RAISE EXCEPTION 'الغرفة مغلقة'; END IF;

  SELECT u.status, u.adult_confirmed_at INTO v_status, v_adult
  FROM public.users u WHERE u.id = v_uid;
  IF NOT FOUND OR v_status <> 'active' OR v_adult IS NULL THEN
    RAISE EXCEPTION 'الحساب غير مؤهل';
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

  IF v_room.is_private AND public.room_actor_role(p_room_id, v_uid) IS NULL AND NOT EXISTS (
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

  INSERT INTO public.room_seat_requests (room_id, user_id, status)
  VALUES (p_room_id, v_uid, 'pending')
  RETURNING * INTO v_request;

  RETURN jsonb_build_object('request_id', v_request.id, 'status', v_request.status);
END;
$$;
REVOKE ALL ON FUNCTION public.request_room_seat(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_room_seat(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_room_message_moderation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_status text;
  v_audience_muted boolean;
  v_has_password boolean;
BEGIN
  IF NEW.is_system THEN
    RETURN NEW;
  END IF;

  SELECT r.status::text, r.audience_muted, r.has_password INTO v_status, v_audience_muted, v_has_password
  FROM public.rooms r
  WHERE r.id = NEW.room_id
  FOR SHARE;
  IF NOT FOUND OR v_status = 'closed' THEN
    RAISE EXCEPTION 'لا يمكن إرسال رسالة إلى غرفة مغلقة';
  END IF;

  IF v_has_password AND (public.room_password_gate_open(NEW.room_id, NEW.user_id) IS NOT TRUE) THEN
    RAISE EXCEPTION 'هذه الغرفة محمية بكلمة مرور';
  END IF;

  IF public.is_room_banned(NEW.room_id, NEW.user_id) THEN
    RAISE EXCEPTION 'أنت محظور من هذه الغرفة';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.room_chat_mutes m
    WHERE m.room_id = NEW.room_id
      AND m.user_id = NEW.user_id
      AND m.expires_at > now()
  ) THEN
    RAISE EXCEPTION 'تم كتم محادثتك مؤقتًا في هذه الغرفة';
  END IF;

  IF v_audience_muted
     AND NOT EXISTS (
       SELECT 1 FROM public.room_seats s
       WHERE s.room_id = NEW.room_id
         AND s.user_id = NEW.user_id
         AND s.status = 'occupied'
     )
     AND public.room_actor_role(NEW.room_id, NEW.user_id) IS NULL THEN
    RAISE EXCEPTION 'جمهور الغرفة مكتوم مؤقتًا';
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_room_message_moderation() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS enforce_room_message_moderation ON public.room_messages;
CREATE TRIGGER enforce_room_message_moderation
  BEFORE INSERT ON public.room_messages
  FOR EACH ROW EXECUTE FUNCTION public.enforce_room_message_moderation();

-- ============================================================
-- 5) السياسات: محتوى الغرف المحمية للمتحققين فقط
--    (صف الغرفة نفسه يبقى مرئياً كما كان — لاكتشافها وإدخال كلمة المرور)
--    تجنُب استدعاء room_password_gate_open داخل سياسات RLS لمنع
--    التكرار اللانهائي مع سياسات room_moderators؛ تُستدعى الدالة
--    مباشرة من RPCs (claim_room_seat / request_room_seat / enforce...)
--    التي تعمل بـ SECURITY DEFINER وتُجري فحص كلمة المرور بنفسها.
-- ============================================================

-- أي مستخدم مصادق يقرأ تحققه الخاص فقط (لا كشف تحقق الغير)
DROP POLICY IF EXISTS room_password_verifications_own_read ON public.room_password_verifications;
CREATE POLICY room_password_verifications_own_read ON public.room_password_verifications
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());
GRANT SELECT ON public.room_password_verifications TO authenticated;

-- ------------------------------------------------------------
-- كسر حلقة RLS بين الغرف والمشرفين (الحلقة كانت:
-- rooms_staff_select تقرأ room_moderators، وسياسة
-- room_moderators_participant_read تقرأ rooms → تكرار عند
-- إعادة إنشاء سياسات room_seats/room_messages التي تقرأ rooms).
-- ------------------------------------------------------------
DROP POLICY IF EXISTS rooms_staff_select ON public.rooms;
CREATE POLICY rooms_staff_select ON public.rooms
  FOR SELECT TO authenticated
  USING (
    second_admin_id = auth.uid()
    OR public.room_agency_role(id, auth.uid()) IS NOT NULL
  );

DROP POLICY IF EXISTS room_moderators_participant_read ON public.room_moderators;
CREATE POLICY room_moderators_participant_read ON public.room_moderators
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.rooms r
      WHERE r.id = room_moderators.room_id
        AND r.owner_id = auth.uid()
    )
    OR public.room_agency_role(room_moderators.room_id, auth.uid()) IS NOT NULL
  );

DROP POLICY IF EXISTS room_seats_room_select ON public.room_seats;
CREATE POLICY room_seats_room_select ON public.room_seats
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.rooms AS room
            WHERE room.id = room_seats.room_id
              AND (
                NOT room.is_private
                OR room.owner_id = auth.uid()
                OR EXISTS (
                  SELECT 1 FROM public.room_invitations i
                  WHERE i.room_id = room.id
                    AND i.recipient_id = auth.uid()
                    AND i.status = 'accepted'
                )
              )
              AND (
                NOT room.has_password
                OR room.owner_id = auth.uid()
                OR EXISTS (
                  SELECT 1 FROM public.room_password_verifications v
                  WHERE v.room_id = room.id AND v.user_id = auth.uid()
                )
              )
        )
    );

DROP POLICY IF EXISTS room_messages_room_select ON public.room_messages;
CREATE POLICY room_messages_room_select ON public.room_messages
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.rooms AS room
            WHERE room.id = room_messages.room_id
              AND (
                room.status <> 'closed'
                OR room.owner_id = auth.uid()
                OR (auth.uid() IS NOT NULL AND NOT room.is_private)
              )
              AND (
                NOT room.is_private
                OR room.owner_id = auth.uid()
                OR EXISTS (
                  SELECT 1 FROM public.room_invitations i
                  WHERE i.room_id = room.id
                    AND i.recipient_id = auth.uid()
                    AND i.status = 'accepted'
                )
              )
              AND (
                NOT room.has_password
                OR room.owner_id = auth.uid()
                OR EXISTS (
                  SELECT 1 FROM public.room_password_verifications v
                  WHERE v.room_id = room.id AND v.user_id = auth.uid()
                )
              )
        )
    );

-- مسار احتلال المقعد المباشر (UPDATE) يخضع للبوابة عبر التحقق الخاص بالمستخدم
DROP POLICY IF EXISTS room_seats_claim ON public.room_seats;
CREATE POLICY room_seats_claim ON public.room_seats
  FOR UPDATE
  TO authenticated
  USING (
    (user_id IS NULL OR user_id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.rooms r
      WHERE r.id = room_seats.room_id
        AND r.status <> 'closed'
        AND (
          NOT r.is_private
          OR r.owner_id = auth.uid()
          OR r.second_admin_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.room_invitations i
            WHERE i.room_id = r.id
              AND i.recipient_id = auth.uid()
              AND i.status = 'accepted'
          )
        )
        AND (
          NOT r.seats_locked
          OR r.owner_id = auth.uid()
          OR r.second_admin_id = auth.uid()
        )
        AND (
          NOT r.has_password
          OR r.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.room_password_verifications v
            WHERE v.room_id = r.id AND v.user_id = auth.uid()
          )
        )
    )
  )
  WITH CHECK (
    (
      (user_id = auth.uid() AND status = 'occupied')
      OR (user_id IS NULL AND status = 'empty')
    )
    AND EXISTS (
      SELECT 1 FROM public.rooms r
      WHERE r.id = room_seats.room_id
        AND r.status <> 'closed'
        AND (
          NOT r.is_private
          OR r.owner_id = auth.uid()
          OR r.second_admin_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.room_invitations i
            WHERE i.room_id = r.id
              AND i.recipient_id = auth.uid()
              AND i.status = 'accepted'
          )
        )
    )
  );

COMMIT;
