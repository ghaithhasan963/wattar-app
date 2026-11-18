-- ============================================================
-- patch_m6_room_permissions.sql — migration #66 (M6.2–M6.6)
--
-- الغرف الصوتية: صلاحيات خادمية كاملة (خطة M6، القسم 9):
--   M6.2 مقاعد مرنة: خيارات عدد مقاعد تضبطها الإدارة (admin_settings.room_seat_options)،
--        قيد 2..16، ومزامنة صفوف المقاعد عند التغيير.
--   M6.3 إدارة الغرفة: طلبات صعود (قبول/رفض)، إنزال من المايك، طرد، حظر/رفع حظر،
--        كتم مايك، كتم/فتح المقاعد، كتم الجمهور، مشرفون (F1) بصلاحيات كاملة،
--        إغلاق/إعادة فتح، إدارة موحدة عبر room_manage_action.
--   M6.4 المدير الثاني: rooms.second_admin_id بكل الصلاحيات عدا نقل الملكية،
--        مع تسجيل كل تغيير في room_moderation_audit.
--   M6.5 تدخل الوكالة: مدير الوكالة/الوكيل يدخل غرف مضيفات وكالته فقط
--        (سلسلة users.referred_by_agent_id → agents.agency_id → agencies)،
--        بنطاق أفعال محدود، وكل فعل مسجّل.
--   M6.6 كلمة المرور (قرار D4): bcrypt على sha256 لكلمة المرور في جدول منفصل
--        room_passwords (بلا أي وصول عميل)، إسقاط عمود النص الصريح نهائياً،
--        وحد محاولات 5/10 دقائق لكل مستخدم/غرفة (room_password_check).
--
-- ملاحظات:
--   - إنشاء الغرف ينتقل إلى RPC خادمي create_wattar_room (لا إدراج مباشر بكلمة مرور).
--   - استُبدلت room_owner_moderation_action بـ room_manage_action (المعتمدة من الحافة).
--   - P8: REVOKE من PUBLIC/anon/authenticated على كل الدوال الجديدة، والمنح انتقائي.
--
-- التراجع: إعادة patch_room_owner_moderation.sql + patch_wire_rate_limit_rpc.sql
--          + patch_room_access.sql (لا تراجع زمني لعمود rooms.password بعد إسقاطه).
-- ============================================================
BEGIN;

-- جلسة الترحيل تُعامل كخدمة موثوقة (زناد audit_admin_row_change يسمح لـ service_role)
SELECT set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, false);
-- pgcrypto على Supabase في مخطط extensions
SET search_path = public, extensions;

-- ============================================================
-- 0) pgcrypto لـ crypt/gen_salt/digest (متاح على Supabase)
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- 1) M6.2 — خيارات المقاعد المرنة
-- ============================================================
INSERT INTO public.admin_settings (key, value, description, is_public) VALUES
  ('room_seat_options', '[4,8,12,16]'::jsonb, 'خيارات عدد مقاعد الغرف المتاحة عند الإنشاء', true)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.rooms DROP CONSTRAINT IF EXISTS valid_seat_count;
ALTER TABLE public.rooms ADD CONSTRAINT valid_seat_count
  CHECK (seat_count BETWEEN 2 AND 16);

ALTER TABLE public.room_seats DROP CONSTRAINT IF EXISTS valid_seat_index;
ALTER TABLE public.room_seats ADD CONSTRAINT valid_seat_index
  CHECK (seat_index >= 0 AND seat_index < 32);

-- التحقق من صحة قيمة الإعداد عند تعديلها إدارياً
CREATE OR REPLACE FUNCTION public.validate_room_seat_options_setting()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_count integer;
  v_bad integer;
BEGIN
  IF NEW.key <> 'room_seat_options' THEN RETURN NEW; END IF;
  IF jsonb_typeof(NEW.value) <> 'array' THEN
    RAISE EXCEPTION 'room_seat_options يجب أن تكون مصفوفة أرقام';
  END IF;
  v_count := jsonb_array_length(NEW.value);
  IF v_count IS NULL OR v_count = 0 THEN
    RAISE EXCEPTION 'room_seat_options لا يمكن أن تكون فارغة';
  END IF;
  SELECT count(*) INTO v_bad
  FROM jsonb_array_elements(NEW.value) el
  WHERE jsonb_typeof(el) <> 'number'
     OR el.value::text !~ '^[0-9]+(\.[0-9]+)?$'
     OR (el.value::text)::numeric <> floor((el.value::text)::numeric)
     OR (el.value::text)::numeric < 2
     OR (el.value::text)::numeric > 16;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'كل خيار مقاعد يجب أن يكون عدداً صحيحاً بين 2 و16';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_room_seat_options_setting() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS validate_room_seat_options_setting ON public.admin_settings;
CREATE TRIGGER validate_room_seat_options_setting
  BEFORE INSERT OR UPDATE ON public.admin_settings
  FOR EACH ROW EXECUTE FUNCTION public.validate_room_seat_options_setting();

-- فرض أن seat_count ضمن الخيارات المفعلة
CREATE OR REPLACE FUNCTION public.enforce_room_seat_options()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_options jsonb;
BEGIN
  SELECT s.value INTO v_options
  FROM public.admin_settings s
  WHERE s.key = 'room_seat_options';
  IF v_options IS NULL OR jsonb_typeof(v_options) <> 'array' THEN
    RETURN NEW; -- بدون إعداد: يبقى قيد 2..16 فقط
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_options) el
    WHERE jsonb_typeof(el) = 'number' AND (el.value::text)::numeric = NEW.seat_count
  ) THEN
    RAISE EXCEPTION 'عدد المقاعد المختار غير متاح؛ اختر من الخيارات المعتمدة';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_room_seat_options() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS enforce_room_seat_options ON public.rooms;
CREATE TRIGGER enforce_room_seat_options
  BEFORE INSERT OR UPDATE OF seat_count ON public.rooms
  FOR EACH ROW EXECUTE FUNCTION public.enforce_room_seat_options();

-- مزامنة صفوف المقاعد: إنشاء عند الإدراج + تعديل عند تغيير العدد
-- (يحل محل create_room_seats_after_insert)
CREATE OR REPLACE FUNCTION public.sync_room_seats()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  -- إضافة المقاعد الناقصة (المقعد 0 للمالك عند الإنشاء فقط)
  INSERT INTO public.room_seats (room_id, seat_index, user_id, status, is_owner_seat, joined_at)
  SELECT
    NEW.id,
    n,
    CASE WHEN n = 0 AND NOT EXISTS (
      SELECT 1 FROM public.room_seats s WHERE s.room_id = NEW.id AND s.seat_index = 0
    ) THEN NEW.owner_id ELSE NULL END,
    CASE WHEN n = 0 AND NOT EXISTS (
      SELECT 1 FROM public.room_seats s WHERE s.room_id = NEW.id AND s.seat_index = 0
    ) THEN 'occupied'::public.seat_status ELSE 'empty'::public.seat_status END,
    n = 0,
    CASE WHEN n = 0 AND NOT EXISTS (
      SELECT 1 FROM public.room_seats s WHERE s.room_id = NEW.id AND s.seat_index = 0
    ) THEN now() ELSE NULL END
  FROM generate_series(0, NEW.seat_count - 1) AS n
  WHERE NOT EXISTS (
    SELECT 1 FROM public.room_seats s WHERE s.room_id = NEW.id AND s.seat_index = n
  );

  -- عند التصغير: رفض وجود مقعد مشغول خارج النطاق، وحذف الفارغة الزائدة
  IF TG_OP = 'UPDATE' AND OLD.seat_count > NEW.seat_count THEN
    IF EXISTS (
      SELECT 1 FROM public.room_seats s
      WHERE s.room_id = NEW.id
        AND s.seat_index >= NEW.seat_count
        AND (s.user_id IS NOT NULL OR s.status <> 'empty')
    ) THEN
      RAISE EXCEPTION 'لا يمكن تصغير المقاعد وما زال هناك متحدثون خارج النطاق الجديد';
    END IF;
    DELETE FROM public.room_seats
    WHERE room_id = NEW.id AND seat_index >= NEW.seat_count AND status = 'empty' AND user_id IS NULL;
  END IF;

  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_room_seats() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS create_room_seats_after_insert ON public.rooms;
DROP TRIGGER IF EXISTS sync_room_seats_after_change ON public.rooms;
CREATE TRIGGER sync_room_seats_after_change
  AFTER INSERT OR UPDATE OF seat_count ON public.rooms
  FOR EACH ROW EXECUTE FUNCTION public.sync_room_seats();
DROP FUNCTION IF EXISTS public.create_room_seats();

-- ============================================================
-- 2) M6.6 — كلمة مرور الغرفة (D4: hash + حد محاولات، لا نص صريح)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.room_passwords (
  room_id uuid PRIMARY KEY REFERENCES public.rooms(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT
);
ALTER TABLE public.room_passwords ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.room_passwords FROM PUBLIC, anon, authenticated;

ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS has_password boolean NOT NULL DEFAULT false;

-- ترحيل أي كلمات مرور صريحة قديمة إلى bcrypt ثم إسقاط العمود نهائياً
INSERT INTO public.room_passwords (room_id, password_hash, updated_at, updated_by)
SELECT
  r.id,
  crypt(encode(digest(r.password, 'sha256'), 'hex'), gen_salt('bf', 10)),
  now(),
  r.owner_id
FROM public.rooms r
WHERE r.password IS NOT NULL
ON CONFLICT (room_id) DO NOTHING;
UPDATE public.rooms SET has_password = true WHERE password IS NOT NULL;
ALTER TABLE public.rooms DROP COLUMN IF EXISTS password;

-- سجل محاولات الدخول (خدمي فقط؛ تُدار عبر room_password_check)
CREATE TABLE IF NOT EXISTS public.room_password_attempts (
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  attempts integer NOT NULL DEFAULT 0,
  window_start timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, user_id)
);
ALTER TABLE public.room_password_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.room_password_attempts FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 3) M6.3/M6.4 — أعمدة إدارة جديدة على الغرف
-- ============================================================
ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS second_admin_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS second_admin_at timestamptz,
  ADD COLUMN IF NOT EXISTS seats_locked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT exists audience_muted boolean NOT NULL DEFAULT false;

-- ============================================================
-- 4) M6.3 — المشرفون (F1) والحظر وطلبات الصعود
-- ============================================================
CREATE TABLE IF NOT EXISTS public.room_moderators (
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  granted_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_room_moderators_user ON public.room_moderators (user_id);
ALTER TABLE public.room_moderators ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.room_moderators FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.room_moderators TO authenticated;

CREATE TABLE IF NOT EXISTS public.room_bans (
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  banned_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  reason text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, user_id),
  CONSTRAINT room_bans_not_self CHECK (user_id <> banned_by)
);
CREATE INDEX IF NOT EXISTS idx_room_bans_user ON public.room_bans (user_id);
ALTER TABLE public.room_bans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.room_bans FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.room_bans TO authenticated;

CREATE TABLE IF NOT EXISTS public.room_seat_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  decided_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_room_seat_request_pending
  ON public.room_seat_requests (room_id, user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_room_seat_requests_room_pending
  ON public.room_seat_requests (room_id, requested_at DESC) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_room_seat_requests_user
  ON public.room_seat_requests (user_id, requested_at DESC);
ALTER TABLE public.room_seat_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.room_seat_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.room_seat_requests TO authenticated;

-- ============================================================
-- 5) مساعدات الأدوار: الوكالة، الدور العام، الحظر النشط
-- ============================================================
CREATE OR REPLACE FUNCTION public.room_agency_role(p_room_id uuid, p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT CASE
    WHEN g.owner_user_id = p_user_id AND g.status = 'active' AND a.status = 'active'
      THEN 'agency_manager'::text
    WHEN a.user_id = p_user_id AND g.status = 'active' AND a.status = 'active'
      THEN 'agency_agent'::text
  END
  FROM public.agents a
  JOIN public.agencies g ON g.id = a.agency_id
  WHERE p_user_id IN (g.owner_user_id, a.user_id)
    AND a.id = (
      SELECT u.referred_by_agent_id
      FROM public.users u
      WHERE u.id = (SELECT r.owner_id FROM public.rooms r WHERE r.id = p_room_id)
    );
$$;
REVOKE ALL ON FUNCTION public.room_agency_role(uuid, uuid) FROM PUBLIC, anon, authenticated;
-- تُستدعى من سياسات RLS بصفة المستخدم المصادق، والنتيجة نص دور فقط (لا تسريب)
GRANT EXECUTE ON FUNCTION public.room_agency_role(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.room_actor_role(
  p_room_id uuid,
  p_user_id uuid DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid uuid := coalesce(p_user_id, auth.uid());
  v_owner uuid;
  v_second uuid;
BEGIN
  IF v_uid IS NULL OR p_room_id IS NULL THEN RETURN NULL; END IF;
  SELECT r.owner_id, r.second_admin_id INTO v_owner, v_second
  FROM public.rooms r WHERE r.id = p_room_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_owner = v_uid THEN RETURN 'owner'; END IF;
  IF v_second = v_uid THEN RETURN 'second_admin'; END IF;
  IF v_uid = auth.uid() AND public.is_admin() THEN RETURN 'admin'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.room_moderators m
    WHERE m.room_id = p_room_id AND m.user_id = v_uid
  ) THEN RETURN 'moderator'; END IF;
  RETURN public.room_agency_role(p_room_id, v_uid);
END;
$$;
REVOKE ALL ON FUNCTION public.room_actor_role(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.room_actor_role(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.is_room_banned(p_room_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.room_bans b
    WHERE b.room_id = p_room_id
      AND b.user_id = p_user_id
      AND (b.expires_at IS NULL OR b.expires_at > now())
  );
$$;
REVOKE ALL ON FUNCTION public.is_room_banned(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_room_banned(uuid, uuid) TO authenticated, service_role;

-- ============================================================
-- 6) M6.3 — احتلال المقعد: منع المحظور + احترام قفل المقاعد
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

-- تعزيز سياسة التحديث المباشر للمقاعد بقيد القفل (المسار الثاني لاحتلال المقعد)
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
          OR public.room_actor_role(r.id, auth.uid()) IN ('owner', 'second_admin', 'moderator', 'admin')
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

-- ============================================================
-- 7) M6.3 — طلبات الصعود (طلب/إلغاء من المستخدم)
-- ============================================================
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

CREATE OR REPLACE FUNCTION public.cancel_room_seat_request(p_room_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_rows integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول أولاً'; END IF;
  UPDATE public.room_seat_requests
     SET status = 'cancelled', decided_at = now()
   WHERE room_id = p_room_id AND user_id = v_uid AND status = 'pending';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN RAISE EXCEPTION 'لا يوجد طلب صعود قائم'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_room_seat_request(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_room_seat_request(uuid) TO authenticated;

-- ============================================================
-- 8) M6.6 — فحص كلمة المرور مع حد المحاولات (خدمي، تستدعيه livekit-token)
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
-- 9) M6.3 — رسائل الغرفة: منع المحظور وكتم الجمهور
-- ============================================================
CREATE OR REPLACE FUNCTION public.enforce_room_message_moderation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_status text;
  v_audience_muted boolean;
BEGIN
  IF NEW.is_system THEN
    RETURN NEW;
  END IF;

  SELECT r.status::text, r.audience_muted INTO v_status, v_audience_muted
  FROM public.rooms r
  WHERE r.id = NEW.room_id
  FOR SHARE;
  IF NOT FOUND OR v_status = 'closed' THEN
    RAISE EXCEPTION 'لا يمكن إرسال رسالة إلى غرفة مغلقة';
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
-- 10) M6.6 — إنشاء الغرفة عبر RPC (كلمة المرور تُحفظ hash من أول لحظة)
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_wattar_room(
  p_name text,
  p_description text DEFAULT NULL,
  p_seat_count integer DEFAULT NULL,
  p_is_private boolean DEFAULT false,
  p_password text DEFAULT NULL,
  p_category text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_desc text;
  v_seat integer;
  v_pass text;
  v_options jsonb;
  v_status public.user_status;
  v_adult timestamptz;
  v_room_id uuid;
  v_livekit_id text;
  v_default jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول أولاً'; END IF;
  IF char_length(v_name) < 1 OR char_length(v_name) > 100 THEN
    RAISE EXCEPTION 'اسم الغرفة يجب أن يكون من 1 إلى 100 حرف';
  END IF;
  v_desc := NULLIF(btrim(coalesce(p_description, '')), '');
  IF v_desc IS NOT NULL AND char_length(v_desc) > 200 THEN
    RAISE EXCEPTION 'وصف الغرفة يجب ألا يتجاوز 200 حرف';
  END IF;
  IF p_category IS NOT NULL AND char_length(p_category) > 50 THEN
    RAISE EXCEPTION 'تصنيف غير صالح';
  END IF;

  SELECT u.status, u.adult_confirmed_at INTO v_status, v_adult
  FROM public.users u WHERE u.id = v_uid;
  IF NOT FOUND OR v_status <> 'active' OR v_adult IS NULL THEN
    RAISE EXCEPTION 'الحساب غير مؤهل لإنشاء الغرف';
  END IF;

  SELECT s.value INTO v_options FROM public.admin_settings s WHERE s.key = 'room_seat_options';
  SELECT s.value INTO v_default FROM public.admin_settings s WHERE s.key = 'default_room_seat_count';
  v_seat := coalesce(p_seat_count, CASE WHEN jsonb_typeof(v_default) = 'number' THEN (v_default #>> '{}')::int END, 8);
  IF v_seat < 2 OR v_seat > 16 THEN
    RAISE EXCEPTION 'عدد المقاعد غير صالح';
  END IF;
  IF v_options IS NOT NULL AND jsonb_typeof(v_options) = 'array' AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_options) el
    WHERE jsonb_typeof(el) = 'number' AND (el.value::text)::numeric = v_seat
  ) THEN
    RAISE EXCEPTION 'عدد المقاعد المختار غير متاح؛ اختر من الخيارات المعتمدة';
  END IF;

  v_pass := NULLIF(btrim(coalesce(p_password, '')), '');
  IF v_pass IS NOT NULL AND (char_length(v_pass) < 4 OR char_length(v_pass) > 50) THEN
    RAISE EXCEPTION 'كلمة مرور الغرفة يجب أن تكون من 4 إلى 50 حرفًا';
  END IF;

  v_livekit_id := 'wattar_' || (extract(epoch FROM now()) * 1000)::bigint::text
    || '_' || substr(md5(random()::text || clock_timestamp()::text), 1, 6);
  INSERT INTO public.rooms (
    name, description, owner_id, seat_count, is_private, has_password,
    livekit_room_id, status, category
  ) VALUES (
    v_name, v_desc, v_uid, v_seat, coalesce(p_is_private, false), v_pass IS NOT NULL,
    v_livekit_id, 'waiting', p_category
  )
  RETURNING id INTO v_room_id;

  IF v_pass IS NOT NULL THEN
    INSERT INTO public.room_passwords (room_id, password_hash, updated_by)
    VALUES (
      v_room_id,
      crypt(encode(digest(v_pass, 'sha256'), 'hex'), gen_salt('bf', 10)),
      v_uid
    );
  END IF;

  RETURN v_room_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_wattar_room(text, text, integer, boolean, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_wattar_room(text, text, integer, boolean, text, text)
  TO authenticated;

-- منع الإدراج المباشر للغرف من العميل (المسار الموحد create_wattar_room)
DROP POLICY IF EXISTS rooms_owner_insert ON public.rooms;

-- ============================================================
-- 11) M6.3/M6.4/M6.5 — الدالة الموحدة لإدارة الغرفة
-- ============================================================
ALTER TABLE public.room_moderation_audit
  ADD COLUMN IF NOT EXISTS actor_role text,
  ADD COLUMN IF NOT EXISTS reason text;

ALTER TABLE public.room_moderation_audit DROP CONSTRAINT IF EXISTS room_moderation_audit_action_check;
ALTER TABLE public.room_moderation_audit ADD CONSTRAINT room_moderation_audit_action_check CHECK (
  action IN (
    'close_room', 'reopen_room', 'remove_seat', 'lower_user', 'kick_user',
    'mute_mic', 'unmute_mic', 'mute_chat', 'unmute_chat',
    'ban_user', 'unban_user', 'lock_seats', 'unlock_seats',
    'mute_audience', 'unmute_audience', 'set_password', 'clear_password',
    'appoint_moderator', 'remove_moderator',
    'appoint_second_admin', 'remove_second_admin', 'handover_owner',
    'accept_seat_request', 'reject_seat_request'
  )
);
UPDATE public.room_moderation_audit SET actor_role = 'owner' WHERE actor_role IS NULL;
ALTER TABLE public.room_moderation_audit ALTER COLUMN actor_role SET NOT NULL;

GRANT SELECT ON public.room_moderation_audit TO authenticated;
DROP POLICY IF EXISTS room_moderation_audit_staff_read ON public.room_moderation_audit;
CREATE POLICY room_moderation_audit_staff_read ON public.room_moderation_audit
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.rooms r
      WHERE r.id = room_moderation_audit.room_id
        AND (r.owner_id = auth.uid() OR r.second_admin_id = auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM public.room_moderators m
      WHERE m.room_id = room_moderation_audit.room_id AND m.user_id = auth.uid()
    )
    OR public.is_admin()
  );

CREATE OR REPLACE FUNCTION public.room_manage_action(
  p_room_id uuid,
  p_actor_id uuid,
  p_action text,
  p_target_user_id uuid DEFAULT NULL,
  p_duration_minutes integer DEFAULT NULL,
  p_password text DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_role text;
  v_room public.rooms%ROWTYPE;
  v_target uuid;
  v_target_name text;
  v_actor_name text;
  v_expires timestamptz;
  v_rows integer;
  v_seat_id uuid;
  v_request room_seat_requests%ROWTYPE;
  v_reason text := NULLIF(btrim(coalesce(p_reason, '')), '');
  v_password text;
  v_new_owner uuid;
  v_claims text;
BEGIN
  IF v_actor_id IS NULL OR p_actor_id IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'يجب تنفيذ الإجراء بهوية المستخدم المصادق عليها';
  END IF;
  IF v_reason IS NOT NULL AND char_length(v_reason) > 200 THEN
    RAISE EXCEPTION 'سبب الإجراء يجب ألا يتجاوز 200 حرف';
  END IF;

  IF p_action IS NULL OR p_action NOT IN (
    'close_room', 'reopen_room', 'lower_user', 'kick_user',
    'mute_mic', 'unmute_mic', 'mute_chat', 'unmute_chat',
    'ban_user', 'unban_user', 'lock_seats', 'unlock_seats',
    'mute_audience', 'unmute_audience', 'set_password', 'clear_password',
    'appoint_moderator', 'remove_moderator',
    'appoint_second_admin', 'remove_second_admin', 'handover_owner',
    'accept_seat_request', 'reject_seat_request'
  ) THEN
    RAISE EXCEPTION 'إجراء الغرفة غير صالح';
  END IF;

  IF p_action IN (
    'lower_user', 'kick_user', 'mute_mic', 'unmute_mic', 'mute_chat', 'unmute_chat',
    'ban_user', 'unban_user', 'appoint_moderator', 'remove_moderator',
    'appoint_second_admin', 'remove_second_admin', 'handover_owner',
    'accept_seat_request', 'reject_seat_request'
  ) THEN
    IF p_target_user_id IS NULL OR p_target_user_id = v_actor_id THEN
      RAISE EXCEPTION 'المستخدم المستهدف غير صالح';
    END IF;
  ELSE
    IF p_target_user_id IS NOT NULL THEN
      RAISE EXCEPTION 'هذا الإجراء لا يستهدف مستخدمًا';
    END IF;
  END IF;

  IF p_action = 'mute_chat'
     AND (p_duration_minutes IS NULL OR p_duration_minutes < 1 OR p_duration_minutes > 1440) THEN
    RAISE EXCEPTION 'مدة كتم المحادثة يجب أن تكون من دقيقة إلى 24 ساعة';
  END IF;
  IF p_action = 'ban_user'
     AND (p_duration_minutes IS NOT NULL AND (p_duration_minutes < 1 OR p_duration_minutes > 10080)) THEN
    RAISE EXCEPTION 'مدة الحظر يجب أن تكون من دقيقة إلى أسبوع أو دائمة';
  END IF;
  IF p_action NOT IN ('mute_chat', 'ban_user') AND p_duration_minutes IS NOT NULL THEN
    RAISE EXCEPTION 'لا تقبل هذه العملية مدة زمنية';
  END IF;
  IF p_action <> 'set_password' AND p_password IS NOT NULL THEN
    RAISE EXCEPTION 'لا تقبل هذه العملية كلمة مرور';
  END IF;

  SELECT * INTO v_room FROM public.rooms r WHERE r.id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الغرفة غير موجودة'; END IF;

  v_role := public.room_actor_role(p_room_id, v_actor_id);
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'لا تملك صلاحية إدارة هذه الغرفة';
  END IF;

  -- مالك الغرفة (ونادراً إدارة المنصة) فقط: المدير الثاني والنقل
  IF p_action IN ('appoint_second_admin', 'remove_second_admin', 'handover_owner')
     AND v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'تعيين المدير الثاني ونقل الإدارة متاحان لمالك الغرفة فقط';
  END IF;
  -- تعيين المشرفين: المالك أو المدير الثاني (أو إدارة المنصة)
  IF p_action IN ('appoint_moderator', 'remove_moderator')
     AND v_role NOT IN ('owner', 'second_admin', 'admin') THEN
    RAISE EXCEPTION 'إدارة المشرفين متاحة لمالك الغرفة أو المدير الثاني فقط';
  END IF;
  -- تدخل الوكالة: نطاق محدود بأفعال المتابعة فقط (القسم 9)
  IF v_role IN ('agency_manager', 'agency_agent') AND p_action NOT IN (
    'close_room', 'reopen_room', 'lower_user', 'kick_user',
    'mute_chat', 'unmute_chat', 'ban_user', 'unban_user'
  ) THEN
    RAISE EXCEPTION 'تدخل الوكالة يقتصر على إدارة الجلسة وضبط الأعضاء';
  END IF;

  SELECT coalesce(nullif(u.display_name, ''), u.username)::text INTO v_actor_name
  FROM public.users u WHERE u.id = v_actor_id;

  -- تنفيذ الإجراء بصلاحية الخدمة: زناد audit_admin_row_change على rooms يرفض
  -- تحديثات غير المالك، بينما صلاحية الفاعل حُققت أعلاه ويوثَّق سجلُّه أدناه.
  v_claims := current_setting('request.jwt.claims', true);
  IF v_claims IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
  END IF;

  ------------------------------------------------------------------
  -- أفعال على مستوى الغرفة (بلا هدف)
  ------------------------------------------------------------------
  IF p_action = 'close_room' THEN
    IF v_room.status = 'closed' THEN RAISE EXCEPTION 'الغرفة مغلقة بالفعل'; END IF;
    INSERT INTO public.room_messages (room_id, user_id, message, is_system)
    VALUES (p_room_id, v_actor_id, 'أغلق مالك الغرفة هذه الغرفة.', true);
    UPDATE public.room_seats
       SET user_id = NULL, status = 'empty', is_mic_on = false, joined_at = NULL, updated_at = now()
     WHERE room_id = p_room_id;
    DELETE FROM public.room_presence WHERE room_id = p_room_id;
    UPDATE public.room_seat_requests
       SET status = 'cancelled', decided_at = now()
     WHERE room_id = p_room_id AND status = 'pending';
    UPDATE public.rooms
       SET status = 'closed', ended_at = coalesce(ended_at, now()), updated_at = now()
     WHERE id = p_room_id;

  ELSIF p_action = 'reopen_room' THEN
    IF v_room.status <> 'closed' THEN RAISE EXCEPTION 'الغرفة مفتوحة بالفعل'; END IF;
    -- فتح الغرفة أولاً ثم إعادة مقعد المالك (زناد منع الجلوس في غرفة مغلقة)
    UPDATE public.rooms
       SET status = 'live', ended_at = NULL,
           started_at = coalesce(started_at, now()), updated_at = now()
     WHERE id = p_room_id;
    UPDATE public.room_seats
       SET user_id = v_room.owner_id, status = 'occupied', is_mic_on = false,
           joined_at = now(), updated_at = now()
     WHERE room_id = p_room_id AND seat_index = 0
       AND user_id IS NULL AND status = 'empty';
    INSERT INTO public.room_messages (room_id, user_id, message, is_system)
    VALUES (p_room_id, v_actor_id, 'أُعيد فتح الغرفة من جديد.', true);

  ELSIF p_action = 'lock_seats' THEN
    IF v_room.seats_locked THEN RAISE EXCEPTION 'المقاعد مقفلة بالفعل'; END IF;
    UPDATE public.rooms SET seats_locked = true, updated_at = now() WHERE id = p_room_id;
    INSERT INTO public.room_messages (room_id, user_id, message, is_system)
    VALUES (p_room_id, v_actor_id, 'قُفلت مقاعد الغرفة؛ الصعود يحتاج موافقة.', true);

  ELSIF p_action = 'unlock_seats' THEN
    IF NOT v_room.seats_locked THEN RAISE EXCEPTION 'المقاعد مفتوحة بالفعل'; END IF;
    UPDATE public.rooms SET seats_locked = false, updated_at = now() WHERE id = p_room_id;
    INSERT INTO public.room_messages (room_id, user_id, message, is_system)
    VALUES (p_room_id, v_actor_id, 'فُتحت مقاعد الغرفة للجميع.', true);

  ELSIF p_action = 'mute_audience' THEN
    IF v_room.audience_muted THEN RAISE EXCEPTION 'الجمهور مكتوم بالفعل'; END IF;
    UPDATE public.rooms SET audience_muted = true, updated_at = now() WHERE id = p_room_id;
    INSERT INTO public.room_messages (room_id, user_id, message, is_system)
    VALUES (p_room_id, v_actor_id, 'كُتمت محادثة الجمهور مؤقتًا.', true);

  ELSIF p_action = 'unmute_audience' THEN
    IF NOT v_room.audience_muted THEN RAISE EXCEPTION 'جمهور الغرفة غير مكتوم'; END IF;
    UPDATE public.rooms SET audience_muted = false, updated_at = now() WHERE id = p_room_id;
    INSERT INTO public.room_messages (room_id, user_id, message, is_system)
    VALUES (p_room_id, v_actor_id, 'فُتحت محادثة الجمهور.', true);

  ELSIF p_action = 'set_password' THEN
    v_password := NULLIF(btrim(coalesce(p_password, '')), '');
    IF v_password IS NULL OR char_length(v_password) < 4 OR char_length(v_password) > 50 THEN
      RAISE EXCEPTION 'كلمة مرور الغرفة يجب أن تكون من 4 إلى 50 حرفًا';
    END IF;
    INSERT INTO public.room_passwords (room_id, password_hash, updated_at, updated_by)
    VALUES (
      p_room_id,
      crypt(encode(digest(v_password, 'sha256'), 'hex'), gen_salt('bf', 10)),
      now(),
      v_actor_id
    )
    ON CONFLICT (room_id) DO UPDATE
      SET password_hash = EXCLUDED.password_hash,
          updated_at = now(),
          updated_by = EXCLUDED.updated_by;
    UPDATE public.rooms SET has_password = true, updated_at = now() WHERE id = p_room_id;
    INSERT INTO public.room_messages (room_id, user_id, message, is_system)
    VALUES (p_room_id, v_actor_id, 'حُدّثت كلمة مرور الغرفة.', true);

  ELSIF p_action = 'clear_password' THEN
    DELETE FROM public.room_passwords WHERE room_id = p_room_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN RAISE EXCEPTION 'لا توجد كلمة مرور على الغرفة'; END IF;
    UPDATE public.rooms SET has_password = false, updated_at = now() WHERE id = p_room_id;
    INSERT INTO public.room_messages (room_id, user_id, message, is_system)
    VALUES (p_room_id, v_actor_id, 'أُزيلت كلمة مرور الغرفة.', true);

  ------------------------------------------------------------------
  -- أفعال تستهدف مستخدمًا
  ------------------------------------------------------------------
  ELSE
    v_target := p_target_user_id;
    IF v_target = v_room.owner_id THEN
      RAISE EXCEPTION 'لا يمكن استهداف مالك الغرفة';
    END IF;
    IF v_target = v_room.second_admin_id
       AND p_action NOT IN ('handover_owner', 'remove_second_admin') THEN
      RAISE EXCEPTION 'لا يمكن استهداف المدير الثاني';
    END IF;
    IF v_role = 'moderator' AND EXISTS (
      SELECT 1 FROM public.room_moderators m
      WHERE m.room_id = p_room_id AND m.user_id = v_target
    ) THEN
      RAISE EXCEPTION 'لا يمكن لمشرف استهداف مشرف آخر';
    END IF;

    SELECT coalesce(nullif(u.display_name, ''), u.username)::text INTO v_target_name
    FROM public.users u WHERE u.id = v_target;
    IF NOT FOUND THEN RAISE EXCEPTION 'المستخدم المستهدف غير موجود'; END IF;

    IF p_action IN ('lower_user', 'kick_user', 'mute_mic', 'unmute_mic',
                    'ban_user', 'appoint_moderator', 'appoint_second_admin', 'handover_owner') THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.room_seats s
        WHERE s.room_id = p_room_id AND s.user_id = v_target AND s.status = 'occupied'
      ) AND NOT EXISTS (
        SELECT 1 FROM public.room_presence p
        WHERE p.room_id = p_room_id AND p.user_id = v_target
      ) AND NOT EXISTS (
        SELECT 1 FROM public.room_seat_requests q
        WHERE q.room_id = p_room_id AND q.user_id = v_target AND q.status = 'pending'
      ) THEN
        RAISE EXCEPTION 'المستخدم ليس في هذه الغرفة';
      END IF;
    END IF;

    IF p_action = 'lower_user' THEN
      UPDATE public.room_seats
         SET user_id = NULL, status = 'empty', is_mic_on = false, joined_at = NULL, updated_at = now()
       WHERE room_id = p_room_id AND user_id = v_target;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows = 0 THEN RAISE EXCEPTION 'المستخدم ليس على مقعد في هذه الغرفة'; END IF;
      INSERT INTO public.room_messages (room_id, user_id, message, is_system)
      VALUES (p_room_id, v_actor_id, 'أنزل ' || v_target_name || ' من المايك.', true);

    ELSIF p_action = 'kick_user' THEN
      UPDATE public.room_seats
         SET user_id = NULL, status = 'empty', is_mic_on = false, joined_at = NULL, updated_at = now()
       WHERE room_id = p_room_id AND user_id = v_target;
      DELETE FROM public.room_presence WHERE room_id = p_room_id AND user_id = v_target;
      UPDATE public.room_seat_requests
         SET status = 'cancelled', decided_at = now()
       WHERE room_id = p_room_id AND user_id = v_target AND status = 'pending';
      INSERT INTO public.room_messages (room_id, user_id, message, is_system)
      VALUES (p_room_id, v_actor_id, 'طُرد ' || v_target_name || ' من الغرفة.', true);

    ELSIF p_action = 'mute_mic' THEN
      UPDATE public.room_seats SET is_mic_on = false, updated_at = now()
       WHERE room_id = p_room_id AND user_id = v_target;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows = 0 THEN RAISE EXCEPTION 'المستخدم ليس على مقعد في هذه الغرفة'; END IF;
      INSERT INTO public.room_messages (room_id, user_id, message, is_system)
      VALUES (p_room_id, v_actor_id, 'كُتم مايك ' || v_target_name || '.', true);

    ELSIF p_action = 'unmute_mic' THEN
      UPDATE public.room_seats SET is_mic_on = true, updated_at = now()
       WHERE room_id = p_room_id AND user_id = v_target;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows = 0 THEN RAISE EXCEPTION 'المستخدم ليس على مقعد في هذه الغرفة'; END IF;
      INSERT INTO public.room_messages (room_id, user_id, message, is_system)
      VALUES (p_room_id, v_actor_id, 'فُتح مايك ' || v_target_name || '.', true);

    ELSIF p_action = 'mute_chat' THEN
      v_expires := now() + make_interval(mins => p_duration_minutes);
      INSERT INTO public.room_chat_mutes (room_id, user_id, muted_by, expires_at)
      VALUES (p_room_id, v_target, v_actor_id, v_expires)
      ON CONFLICT (room_id, user_id) DO UPDATE
        SET muted_by = EXCLUDED.muted_by,
            expires_at = EXCLUDED.expires_at,
            created_at = now();
      INSERT INTO public.room_messages (room_id, user_id, message, is_system)
      VALUES (p_room_id, v_actor_id, 'كُتمت محادثة ' || v_target_name
        || ' لمدة ' || p_duration_minutes::text || ' دقيقة.', true);

    ELSIF p_action = 'unmute_chat' THEN
      DELETE FROM public.room_chat_mutes
       WHERE room_id = p_room_id AND user_id = v_target;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows = 0 THEN RAISE EXCEPTION 'محادثة هذا المستخدم غير مكتومة'; END IF;
      INSERT INTO public.room_messages (room_id, user_id, message, is_system)
      VALUES (p_room_id, v_actor_id, 'أُلغي كتم محادثة ' || v_target_name || '.', true);

    ELSIF p_action = 'ban_user' THEN
      v_expires := CASE WHEN p_duration_minutes IS NULL
        THEN NULL ELSE now() + make_interval(mins => p_duration_minutes) END;
      UPDATE public.room_seats
         SET user_id = NULL, status = 'empty', is_mic_on = false, joined_at = NULL, updated_at = now()
       WHERE room_id = p_room_id AND user_id = v_target;
      DELETE FROM public.room_presence WHERE room_id = p_room_id AND user_id = v_target;
      UPDATE public.room_seat_requests
         SET status = 'cancelled', decided_at = now()
       WHERE room_id = p_room_id AND user_id = v_target AND status = 'pending';
      INSERT INTO public.room_bans (room_id, user_id, banned_by, reason, expires_at)
      VALUES (p_room_id, v_target, v_actor_id, v_reason, v_expires)
      ON CONFLICT (room_id, user_id) DO UPDATE
        SET banned_by = EXCLUDED.banned_by,
            reason = EXCLUDED.reason,
            expires_at = EXCLUDED.expires_at,
            created_at = now();
      INSERT INTO public.room_messages (room_id, user_id, message, is_system)
      VALUES (p_room_id, v_actor_id, 'حُظر ' || v_target_name || ' من الغرفة'
        || CASE WHEN v_expires IS NULL THEN '' ELSE ' مؤقتًا' END || '.', true);

    ELSIF p_action = 'unban_user' THEN
      DELETE FROM public.room_bans WHERE room_id = p_room_id AND user_id = v_target;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows = 0 THEN RAISE EXCEPTION 'هذا المستخدم غير محظور من الغرفة'; END IF;
      INSERT INTO public.room_messages (room_id, user_id, message, is_system)
      VALUES (p_room_id, v_actor_id, 'رُفع الحظر عن ' || v_target_name || '.', true);

    ELSIF p_action = 'appoint_moderator' THEN
      INSERT INTO public.room_moderators (room_id, user_id, granted_by)
      VALUES (p_room_id, v_target, v_actor_id)
      ON CONFLICT (room_id, user_id) DO NOTHING;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows = 0 THEN RAISE EXCEPTION 'هذا المستخدم مشرف بالفعل'; END IF;
      INSERT INTO public.room_messages (room_id, user_id, message, is_system)
      VALUES (p_room_id, v_actor_id, 'عُيّن ' || v_target_name || ' مشرفًا على الغرفة.', true);

    ELSIF p_action = 'remove_moderator' THEN
      DELETE FROM public.room_moderators WHERE room_id = p_room_id AND user_id = v_target;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows = 0 THEN RAISE EXCEPTION 'هذا المستخدم ليس مشرفًا على الغرفة'; END IF;
      INSERT INTO public.room_messages (room_id, user_id, message, is_system)
      VALUES (p_room_id, v_actor_id, 'أُزيل ' || v_target_name || ' من إشراف الغرفة.', true);

    ELSIF p_action = 'appoint_second_admin' THEN
      DELETE FROM public.room_moderators WHERE room_id = p_room_id AND user_id = v_target;
      UPDATE public.rooms
         SET second_admin_id = v_target, second_admin_at = now(), updated_at = now()
       WHERE id = p_room_id;
      INSERT INTO public.room_messages (room_id, user_id, message, is_system)
      VALUES (p_room_id, v_actor_id, 'عُيّن ' || v_target_name || ' مديرًا ثانيًا للغرفة.', true);

    ELSIF p_action = 'remove_second_admin' THEN
      IF v_room.second_admin_id IS NULL OR v_room.second_admin_id <> v_target THEN
        RAISE EXCEPTION 'هذا المستخدم ليس المدير الثاني';
      END IF;
      UPDATE public.rooms
         SET second_admin_id = NULL, second_admin_at = NULL, updated_at = now()
       WHERE id = p_room_id;
      INSERT INTO public.room_messages (room_id, user_id, message, is_system)
      VALUES (p_room_id, v_actor_id, 'أُلغيت صلاحيات المدير الثاني ' || v_target_name || '.', true);

    ELSIF p_action = 'handover_owner' THEN
      SELECT id INTO v_seat_id FROM public.users WHERE id = v_target AND status = 'active';
      IF NOT FOUND THEN RAISE EXCEPTION 'المستخدم المستهدف غير صالح'; END IF;
      v_new_owner := v_target;
      UPDATE public.room_seats
         SET user_id = NULL, status = 'empty', is_mic_on = false, joined_at = NULL, updated_at = now()
       WHERE room_id = p_room_id AND user_id = v_new_owner AND NOT is_owner_seat;
      UPDATE public.room_seats
         SET user_id = v_new_owner, status = 'occupied', is_mic_on = false,
             joined_at = now(), updated_at = now()
       WHERE room_id = p_room_id AND seat_index = 0;
      UPDATE public.rooms
         SET owner_id = v_new_owner,
             second_admin_id = CASE WHEN second_admin_id = v_new_owner THEN NULL ELSE second_admin_id END,
             second_admin_at = CASE WHEN second_admin_id = v_new_owner THEN NULL ELSE second_admin_at END,
             updated_at = now()
       WHERE id = p_room_id;
      DELETE FROM public.room_moderators WHERE room_id = p_room_id AND user_id = v_new_owner;
      INSERT INTO public.room_messages (room_id, user_id, message, is_system)
      VALUES (p_room_id, v_actor_id,
        'سلّم ' || coalesce(v_actor_name, 'المالك السابق') || ' إدارة الغرفة إلى ' || v_target_name || '.', true);

    ELSIF p_action = 'accept_seat_request' THEN
      SELECT * INTO v_request FROM public.room_seat_requests
      WHERE room_id = p_room_id AND user_id = v_target AND status = 'pending'
      FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'لا يوجد طلب صعود قائم لهذا المستخدم'; END IF;
      UPDATE public.room_seats
         SET user_id = v_target, status = 'occupied', is_mic_on = false,
             joined_at = now(), updated_at = now()
       WHERE id = (
         SELECT s.id FROM public.room_seats s
         WHERE s.room_id = p_room_id AND s.status = 'empty'
           AND s.user_id IS NULL AND NOT s.is_owner_seat
         ORDER BY s.seat_index
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       );
      IF NOT FOUND THEN RAISE EXCEPTION 'لا توجد مقاعد شاغرة'; END IF;
      UPDATE public.room_seat_requests
         SET status = 'accepted', decided_by = v_actor_id, decided_at = now()
       WHERE id = v_request.id;
      INSERT INTO public.room_messages (room_id, user_id, message, is_system)
      VALUES (p_room_id, v_actor_id, 'صعد ' || v_target_name || ' إلى المايك.', true);

    ELSIF p_action = 'reject_seat_request' THEN
      UPDATE public.room_seat_requests
         SET status = 'rejected', decided_by = v_actor_id, decided_at = now()
       WHERE room_id = p_room_id AND user_id = v_target AND status = 'pending';
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows = 0 THEN RAISE EXCEPTION 'لا يوجد طلب صعود قائم لهذا المستخدم'; END IF;
      INSERT INTO public.room_messages (room_id, user_id, message, is_system)
      VALUES (p_room_id, v_actor_id, 'رُفض طلب ' || v_target_name || ' للصعود.', true);
    END IF;
  END IF;

  -- استعادة هوية الجلسة الأصلية قبل التوثيق النهائي
  IF v_claims IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', v_claims, true);
  END IF;

  INSERT INTO public.room_moderation_audit (
    room_id, actor_id, target_user_id, action, duration_minutes, actor_role, reason
  ) VALUES (
    p_room_id, v_actor_id, p_target_user_id, p_action,
    CASE WHEN p_action IN ('mute_chat', 'ban_user') THEN p_duration_minutes ELSE NULL END,
    v_role, v_reason
  );

  RETURN jsonb_build_object(
    'room_id', p_room_id,
    'action', p_action,
    'target_user_id', p_target_user_id,
    'expires_at', v_expires,
    'actor_role', v_role
  );
END;
$$;
REVOKE ALL ON FUNCTION public.room_manage_action(uuid, uuid, text, uuid, integer, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.room_manage_action(uuid, uuid, text, uuid, integer, text, text)
  TO authenticated;

-- الدالة القديمة استُبدلت بـ room_manage_action (الحافة والتطبيق محدّثان معها)
DROP FUNCTION IF EXISTS public.room_owner_moderation_action(uuid, uuid, text, uuid, integer);

-- ============================================================
-- 12) أدوات الإدارة العليا على الغرف (تُستدعى من لوحة الإدارة)
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_room_action(
  p_admin_id uuid,
  p_room_id uuid,
  p_action text,
  p_target_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_admin uuid := auth.uid();
  v_room public.rooms%ROWTYPE;
  v_rows integer;
BEGIN
  IF v_admin IS NULL OR p_admin_id IS DISTINCT FROM v_admin OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'هذه العملية متاحة للإدارة العليا فقط';
  END IF;
  IF p_action NOT IN ('clear_password', 'unban_user', 'reopen_room', 'force_close') THEN
    RAISE EXCEPTION 'إجراء إداري غير صالح';
  END IF;

  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الغرفة غير موجودة'; END IF;

  IF p_action = 'clear_password' THEN
    DELETE FROM public.room_passwords WHERE room_id = p_room_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN RAISE EXCEPTION 'لا توجد كلمة مرور على الغرفة'; END IF;
    UPDATE public.rooms SET has_password = false, updated_at = now() WHERE id = p_room_id;

  ELSIF p_action = 'unban_user' THEN
    IF p_target_user_id IS NULL THEN RAISE EXCEPTION 'حدد المستخدم المطلوب رفع حظره'; END IF;
    DELETE FROM public.room_bans WHERE room_id = p_room_id AND user_id = p_target_user_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN RAISE EXCEPTION 'هذا المستخدم غير محظور من الغرفة'; END IF;

  ELSIF p_action = 'reopen_room' THEN
    IF v_room.status <> 'closed' THEN RAISE EXCEPTION 'الغرفة مفتوحة بالفعل'; END IF;
    UPDATE public.rooms
       SET status = 'live', ended_at = NULL,
           started_at = coalesce(started_at, now()), updated_at = now()
     WHERE id = p_room_id;
    UPDATE public.room_seats
       SET user_id = v_room.owner_id, status = 'occupied', is_mic_on = false,
           joined_at = now(), updated_at = now()
     WHERE room_id = p_room_id AND seat_index = 0
       AND user_id IS NULL AND status = 'empty';

  ELSIF p_action = 'force_close' THEN
    IF v_room.status = 'closed' THEN RAISE EXCEPTION 'الغرفة مغلقة بالفعل'; END IF;
    UPDATE public.room_seats
       SET user_id = NULL, status = 'empty', is_mic_on = false, joined_at = NULL, updated_at = now()
     WHERE room_id = p_room_id;
    DELETE FROM public.room_presence WHERE room_id = p_room_id;
    UPDATE public.room_seat_requests
       SET status = 'cancelled', decided_at = now()
     WHERE room_id = p_room_id AND status = 'pending';
    UPDATE public.rooms
       SET status = 'closed', ended_at = coalesce(ended_at, now()), updated_at = now()
     WHERE id = p_room_id;
  END IF;

  INSERT INTO public.room_moderation_audit (
    room_id, actor_id, target_user_id, action, actor_role, reason
  ) VALUES (
    p_room_id, v_admin, p_target_user_id,
    CASE p_action WHEN 'force_close' THEN 'close_room' ELSE p_action END,
    'admin', 'إجراء إداري أعلى'
  );

  RETURN jsonb_build_object('room_id', p_room_id, 'action', p_action);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_room_action(uuid, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_room_action(uuid, uuid, text, uuid) TO authenticated;

-- ============================================================
-- 13) سياسات القراءة: الطاقم (المدير الثاني/المشرفون) والوكالة
-- ============================================================
DROP POLICY IF EXISTS rooms_staff_select ON public.rooms;
CREATE POLICY rooms_staff_select ON public.rooms
  FOR SELECT TO authenticated
  USING (
    second_admin_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.room_moderators m
      WHERE m.room_id = rooms.id AND m.user_id = auth.uid()
    )
    OR public.room_agency_role(rooms.id, auth.uid()) IS NOT NULL
  );

DROP POLICY IF EXISTS room_seats_staff_select ON public.room_seats;
CREATE POLICY room_seats_staff_select ON public.room_seats
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.rooms r
      WHERE r.id = room_seats.room_id
        AND (
          r.second_admin_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.room_moderators m
            WHERE m.room_id = r.id AND m.user_id = auth.uid()
          )
          OR public.room_agency_role(r.id, auth.uid()) IS NOT NULL
        )
    )
  );

DROP POLICY IF EXISTS room_messages_staff_select ON public.room_messages;
CREATE POLICY room_messages_staff_select ON public.room_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.rooms r
      WHERE r.id = room_messages.room_id
        AND (
          r.second_admin_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.room_moderators m
            WHERE m.room_id = r.id AND m.user_id = auth.uid()
          )
          OR public.room_agency_role(r.id, auth.uid()) IS NOT NULL
        )
    )
  );

DROP POLICY IF EXISTS room_moderators_participant_read ON public.room_moderators;
CREATE POLICY room_moderators_participant_read ON public.room_moderators
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.rooms r
      WHERE r.id = room_moderators.room_id
        AND (
          NOT r.is_private
          OR r.owner_id = auth.uid()
          OR r.second_admin_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.room_invitations i
            WHERE i.room_id = r.id AND i.recipient_id = auth.uid() AND i.status = 'accepted'
          )
          OR EXISTS (
            SELECT 1 FROM public.room_moderators m2
            WHERE m2.room_id = r.id AND m2.user_id = auth.uid()
          )
          OR public.room_agency_role(r.id, auth.uid()) IS NOT NULL
        )
    )
  );

DROP POLICY IF EXISTS room_bans_staff_read ON public.room_bans;
CREATE POLICY room_bans_staff_read ON public.room_bans
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.rooms r
      WHERE r.id = room_bans.room_id
        AND (
          r.owner_id = auth.uid()
          OR r.second_admin_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.room_moderators m
            WHERE m.room_id = r.id AND m.user_id = auth.uid()
          )
          OR public.room_agency_role(r.id, auth.uid()) IS NOT NULL
        )
    )
  );

DROP POLICY IF EXISTS room_seat_requests_read ON public.room_seat_requests;
CREATE POLICY room_seat_requests_read ON public.room_seat_requests
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.rooms r
      WHERE r.id = room_seat_requests.room_id
        AND (
          r.owner_id = auth.uid()
          OR r.second_admin_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.room_moderators m
            WHERE m.room_id = r.id AND m.user_id = auth.uid()
          )
          OR public.room_agency_role(r.id, auth.uid()) IS NOT NULL
        )
    )
  );

-- ============================================================
-- 14) عمود منح التحديث المباشر بعد إسقاط عمود كلمة المرور
-- ============================================================
REVOKE UPDATE ON public.rooms FROM PUBLIC, anon, authenticated;
GRANT UPDATE (
  name, description, cover_url, seat_count, is_private, livekit_room_id,
  livekit_token, listeners_count, speakers_count, category, tags, is_recorded,
  started_at, ended_at, updated_at
) ON public.rooms TO authenticated;

COMMIT;
