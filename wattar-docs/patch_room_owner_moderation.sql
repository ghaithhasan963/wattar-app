-- Owner-scoped room controls, auditable moderation, and database-enforced chat mutes.
-- Apply after wattar_schema.sql, then patch_social_foundation.sql,
-- patch_room_access.sql, patch_room_realtime.sql, and patch_room_presence.sql.
BEGIN;

CREATE TABLE IF NOT EXISTS public.room_chat_mutes (
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  muted_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, user_id)
);
ALTER TABLE public.room_chat_mutes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.room_chat_mutes FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.room_moderation_audit (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  target_user_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('close_room', 'remove_seat', 'mute_chat', 'unmute_chat')),
  duration_minutes integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_room_moderation_audit_room_time
  ON public.room_moderation_audit (room_id, created_at DESC);
ALTER TABLE public.room_moderation_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.room_moderation_audit FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.enforce_room_message_moderation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status text;
BEGIN
  IF NEW.is_system THEN
    RETURN NEW;
  END IF;

  SELECT r.status::text INTO v_status
  FROM public.rooms r
  WHERE r.id = NEW.room_id
  FOR SHARE;
  IF NOT FOUND OR v_status = 'closed' THEN
    RAISE EXCEPTION 'لا يمكن إرسال رسالة إلى غرفة مغلقة';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.room_chat_mutes m
    WHERE m.room_id = NEW.room_id
      AND m.user_id = NEW.user_id
      AND m.expires_at > now()
  ) THEN
    RAISE EXCEPTION 'تم كتم محادثتك مؤقتًا في هذه الغرفة';
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_room_message_moderation() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS enforce_room_message_moderation ON public.room_messages;
CREATE TRIGGER enforce_room_message_moderation
  BEFORE INSERT ON public.room_messages
  FOR EACH ROW EXECUTE FUNCTION public.enforce_room_message_moderation();

CREATE OR REPLACE FUNCTION public.prevent_closed_room_seat_claim()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status text;
BEGIN
  IF NEW.user_id IS NOT NULL AND NEW.status = 'occupied' THEN
    SELECT r.status::text INTO v_status
    FROM public.rooms r
    WHERE r.id = NEW.room_id
    FOR SHARE;
    IF NOT FOUND OR v_status = 'closed' THEN
      RAISE EXCEPTION 'لا يمكن الانضمام إلى منصة غرفة مغلقة';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.prevent_closed_room_seat_claim() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS prevent_closed_room_seat_claim ON public.room_seats;
CREATE TRIGGER prevent_closed_room_seat_claim
  BEFORE INSERT OR UPDATE ON public.room_seats
  FOR EACH ROW EXECUTE FUNCTION public.prevent_closed_room_seat_claim();

-- Preserve closed rooms and let authenticated users receive closure realtime events/history
-- for public rooms; private-room visibility remains owner/invitation scoped.
DROP POLICY IF EXISTS rooms_owner_delete ON public.rooms;
REVOKE DELETE ON public.rooms FROM PUBLIC, anon, authenticated;
REVOKE UPDATE ON public.rooms FROM PUBLIC, anon, authenticated;
GRANT UPDATE (
  name, description, cover_url, seat_count, is_private, password, livekit_room_id,
  livekit_token, listeners_count, speakers_count, category, tags, is_recorded,
  started_at, ended_at, updated_at
) ON public.rooms TO authenticated;

DROP POLICY IF EXISTS rooms_public_select ON public.rooms;
CREATE POLICY rooms_public_select ON public.rooms
  FOR SELECT USING (
    (NOT is_private AND (status <> 'closed' OR auth.uid() IS NOT NULL))
    OR auth.uid() = owner_id
    OR EXISTS (
      SELECT 1 FROM public.room_invitations i
      WHERE i.room_id = rooms.id
        AND i.recipient_id = auth.uid()
        AND i.status = 'accepted'
    )
  );

DROP POLICY IF EXISTS room_seats_room_select ON public.room_seats;
CREATE POLICY room_seats_room_select ON public.room_seats
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.rooms r
      WHERE r.id = room_seats.room_id
        AND (
          NOT r.is_private
          OR r.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.room_invitations i
            WHERE i.room_id = r.id
              AND i.recipient_id = auth.uid()
              AND i.status = 'accepted'
          )
        )
    )
  );

DROP POLICY IF EXISTS room_seats_claim ON public.room_seats;
CREATE POLICY room_seats_claim ON public.room_seats
  FOR UPDATE
  USING (
    (user_id IS NULL OR user_id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.rooms r
      WHERE r.id = room_seats.room_id
        AND r.status <> 'closed'
        AND (
          NOT r.is_private
          OR r.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.room_invitations i
            WHERE i.room_id = r.id
              AND i.recipient_id = auth.uid()
              AND i.status = 'accepted'
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
          OR EXISTS (
            SELECT 1 FROM public.room_invitations i
            WHERE i.room_id = r.id
              AND i.recipient_id = auth.uid()
              AND i.status = 'accepted'
          )
        )
    )
  );

DROP POLICY IF EXISTS room_messages_room_select ON public.room_messages;
CREATE POLICY room_messages_room_select ON public.room_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.rooms r
      WHERE r.id = room_messages.room_id
        AND (
          r.status <> 'closed'
          OR r.owner_id = auth.uid()
          OR (auth.uid() IS NOT NULL AND NOT r.is_private)
        )
      AND (
        NOT r.is_private
        OR r.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.room_invitations i
          WHERE i.room_id = r.id
            AND i.recipient_id = auth.uid()
            AND i.status = 'accepted'
        )
      )
    )
  );

CREATE OR REPLACE FUNCTION public.room_owner_moderation_action(
  p_room_id uuid,
  p_actor_id uuid,
  p_action text,
  p_target_user_id uuid DEFAULT NULL,
  p_duration_minutes integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_owner_id uuid;
  v_room_status text;
  v_target_name text;
  v_expires_at timestamptz;
  v_rows integer;
BEGIN
  IF v_actor_id IS NULL OR p_actor_id IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'يجب تنفيذ الإجراء بهوية المستخدم المصادق عليها';
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('close_room', 'remove_seat', 'mute_chat', 'unmute_chat') THEN
    RAISE EXCEPTION 'إجراء الغرفة غير صالح';
  END IF;
  IF (p_action = 'close_room' AND p_target_user_id IS NOT NULL)
     OR (p_action <> 'close_room' AND (p_target_user_id IS NULL OR p_target_user_id = v_actor_id)) THEN
    RAISE EXCEPTION 'المستخدم المستهدف غير صالح';
  END IF;
  IF p_action = 'mute_chat'
     AND (p_duration_minutes IS NULL OR p_duration_minutes < 1 OR p_duration_minutes > 1440) THEN
    RAISE EXCEPTION 'مدة كتم المحادثة يجب أن تكون من دقيقة إلى 24 ساعة';
  END IF;
  IF p_action <> 'mute_chat' AND p_duration_minutes IS NOT NULL THEN
    RAISE EXCEPTION 'لا تقبل هذه العملية مدة كتم';
  END IF;

  SELECT r.owner_id, r.status::text
  INTO v_owner_id, v_room_status
  FROM public.rooms r
  WHERE r.id = p_room_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الغرفة غير موجودة'; END IF;
  IF v_owner_id IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'إجراءات إدارة الغرفة متاحة لمالكها فقط';
  END IF;
  IF v_room_status = 'closed' THEN
    RAISE EXCEPTION 'الغرفة مغلقة بالفعل';
  END IF;

  IF p_action <> 'close_room' THEN
    SELECT coalesce(nullif(u.display_name, ''), u.username)::text
    INTO v_target_name
    FROM public.room_seats s
    JOIN public.users u ON u.id = s.user_id
    WHERE s.room_id = p_room_id
      AND s.user_id = p_target_user_id
      AND s.status = 'occupied'
    FOR UPDATE OF s;
    IF NOT FOUND THEN RAISE EXCEPTION 'المستخدم ليس على مقعد في هذه الغرفة'; END IF;
  END IF;

  IF p_action = 'remove_seat' THEN
    UPDATE public.room_seats
    SET user_id = NULL, status = 'empty', is_mic_on = false, joined_at = NULL
    WHERE room_id = p_room_id AND user_id = p_target_user_id;
    DELETE FROM public.room_presence
    WHERE room_id = p_room_id AND user_id = p_target_user_id;
    INSERT INTO public.room_messages (room_id, user_id, message, is_system)
    VALUES (p_room_id, v_actor_id, 'أُخلي مقعد ' || v_target_name || ' بواسطة مالك الغرفة.', true);
  ELSIF p_action = 'mute_chat' THEN
    v_expires_at := now() + make_interval(mins => p_duration_minutes);
    INSERT INTO public.room_chat_mutes (room_id, user_id, muted_by, expires_at)
    VALUES (p_room_id, p_target_user_id, v_actor_id, v_expires_at)
    ON CONFLICT (room_id, user_id) DO UPDATE
      SET muted_by = EXCLUDED.muted_by,
          expires_at = EXCLUDED.expires_at,
          created_at = now();
    INSERT INTO public.room_messages (room_id, user_id, message, is_system)
    VALUES (p_room_id, v_actor_id, 'كتم مالك الغرفة محادثة ' || v_target_name
      || ' لمدة ' || p_duration_minutes::text || ' دقيقة.', true);
  ELSIF p_action = 'unmute_chat' THEN
    DELETE FROM public.room_chat_mutes
    WHERE room_id = p_room_id AND user_id = p_target_user_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN RAISE EXCEPTION 'محادثة هذا المستخدم غير مكتومة'; END IF;
    INSERT INTO public.room_messages (room_id, user_id, message, is_system)
    VALUES (p_room_id, v_actor_id, 'ألغى مالك الغرفة كتم محادثة ' || v_target_name || '.', true);
  ELSE
    INSERT INTO public.room_messages (room_id, user_id, message, is_system)
    VALUES (p_room_id, v_actor_id, 'أغلق مالك الغرفة هذه الغرفة.', true);
    UPDATE public.room_seats
    SET user_id = NULL, status = 'empty', is_mic_on = false, joined_at = NULL
    WHERE room_id = p_room_id;
    DELETE FROM public.room_presence WHERE room_id = p_room_id;
    UPDATE public.rooms
    SET status = 'closed', ended_at = coalesce(ended_at, now()), updated_at = now()
    WHERE id = p_room_id;
  END IF;

  INSERT INTO public.room_moderation_audit (
    room_id, actor_id, target_user_id, action, duration_minutes
  ) VALUES (
    p_room_id, v_actor_id, p_target_user_id, p_action,
    CASE WHEN p_action = 'mute_chat' THEN p_duration_minutes ELSE NULL END
  );

  RETURN jsonb_build_object(
    'room_id', p_room_id,
    'action', p_action,
    'target_user_id', p_target_user_id,
    'expires_at', v_expires_at
  );
END;
$$;
REVOKE ALL ON FUNCTION public.room_owner_moderation_action(uuid, uuid, text, uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.room_owner_moderation_action(uuid, uuid, text, uuid, integer)
  TO authenticated;

COMMIT;
