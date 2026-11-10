-- Track authenticated room listeners and persist real join/leave notices in room chat.
-- Run after patch_social_foundation.sql, patch_room_access.sql, and patch_room_realtime.sql.
BEGIN;

CREATE TABLE IF NOT EXISTS public.room_presence (
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  session_id text NOT NULL CHECK (length(session_id) BETWEEN 8 AND 100),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, user_id, session_id)
);
CREATE INDEX IF NOT EXISTS idx_room_presence_room_last_seen
  ON public.room_presence (room_id, last_seen_at DESC);
ALTER TABLE public.room_presence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.room_presence FROM anon, authenticated;

DROP FUNCTION IF EXISTS public.record_wattar_room_presence(uuid, uuid, text, boolean);
CREATE FUNCTION public.record_wattar_room_presence(
  p_room_id uuid,
  p_user_id uuid,
  p_session_id text,
  p_joining boolean
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner_id uuid;
  v_is_private boolean;
  v_room_status text;
  v_user_name text;
  v_was_present boolean;
  v_stale_users uuid[];
  v_stale_user_id uuid;
  v_active_count integer;
  v_rows integer;
BEGIN
  IF p_user_id IS NULL OR p_joining IS NULL
     OR (p_joining AND (p_session_id IS NULL OR p_session_id !~ '^[A-Za-z0-9._:-]{8,100}$'))
     OR (p_session_id IS NOT NULL AND p_session_id !~ '^[A-Za-z0-9._:-]{8,100}$') THEN
    RAISE EXCEPTION 'بيانات حضور الغرفة غير صالحة';
  END IF;

  SELECT r.owner_id, r.is_private, r.status::text
  INTO v_owner_id, v_is_private, v_room_status
  FROM public.rooms r
  WHERE r.id = p_room_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الغرفة غير موجودة'; END IF;

  IF p_joining THEN
    IF v_room_status = 'closed' THEN RAISE EXCEPTION 'الغرفة مغلقة'; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = p_user_id AND u.status = 'active' AND u.adult_confirmed_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'الحساب غير متاح';
    END IF;
    IF v_is_private AND v_owner_id <> p_user_id AND NOT EXISTS (
      SELECT 1 FROM public.room_invitations i
      WHERE i.room_id = p_room_id
        AND i.recipient_id = p_user_id
        AND i.status = 'accepted'
    ) THEN
      RAISE EXCEPTION 'لا تملك صلاحية دخول هذه الغرفة';
    END IF;
  END IF;

  SELECT array_agg(DISTINCT p.user_id)
  INTO v_stale_users
  FROM public.room_presence p
  WHERE p.room_id = p_room_id
    AND p.last_seen_at <= now() - interval '90 seconds';

  DELETE FROM public.room_presence p
  WHERE p.room_id = p_room_id
    AND p.last_seen_at <= now() - interval '90 seconds';

  FOREACH v_stale_user_id IN ARRAY coalesce(v_stale_users, ARRAY[]::uuid[])
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.room_presence p WHERE p.room_id = p_room_id AND p.user_id = v_stale_user_id
    ) THEN
      UPDATE public.room_seats
      SET user_id = NULL, status = 'empty', is_mic_on = false, joined_at = NULL
      WHERE room_id = p_room_id AND user_id = v_stale_user_id;

      SELECT coalesce(nullif(u.display_name, ''), u.username)::text
      INTO v_user_name
      FROM public.users u WHERE u.id = v_stale_user_id;
      IF FOUND THEN
        INSERT INTO public.room_messages (room_id, user_id, message, is_system)
        VALUES (p_room_id, v_stale_user_id, v_user_name || ' غادر الغرفة.', true);
      END IF;
    END IF;
  END LOOP;

  IF p_joining THEN
    SELECT EXISTS (
      SELECT 1 FROM public.room_presence p
      WHERE p.room_id = p_room_id AND p.user_id = p_user_id
        AND p.last_seen_at > now() - interval '90 seconds'
    ) INTO v_was_present;

    INSERT INTO public.room_presence (room_id, user_id, session_id, last_seen_at)
    VALUES (p_room_id, p_user_id, p_session_id, now())
    ON CONFLICT (room_id, user_id, session_id)
    DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at;

    IF NOT v_was_present THEN
      SELECT coalesce(nullif(u.display_name, ''), u.username)::text
      INTO v_user_name
      FROM public.users u WHERE u.id = p_user_id;
      INSERT INTO public.room_messages (room_id, user_id, message, is_system)
      VALUES (p_room_id, p_user_id, v_user_name || ' دخل الغرفة.', true);
    END IF;
  ELSE
    IF p_session_id IS NOT NULL THEN
      DELETE FROM public.room_presence p
      WHERE p.room_id = p_room_id AND p.user_id = p_user_id AND p.session_id = p_session_id;
    ELSE
      DELETE FROM public.room_presence p
      WHERE p.room_id = p_room_id AND p.user_id = p_user_id;
    END IF;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF NOT EXISTS (
      SELECT 1 FROM public.room_presence p
      WHERE p.room_id = p_room_id AND p.user_id = p_user_id
        AND p.last_seen_at > now() - interval '90 seconds'
    ) THEN
      IF v_rows > 0 THEN
        SELECT coalesce(nullif(u.display_name, ''), u.username)::text
        INTO v_user_name
        FROM public.users u WHERE u.id = p_user_id;
        IF FOUND THEN
          INSERT INTO public.room_messages (room_id, user_id, message, is_system)
          VALUES (p_room_id, p_user_id, v_user_name || ' غادر الغرفة.', true);
        END IF;
      END IF;

      UPDATE public.room_seats
      SET user_id = NULL, status = 'empty', is_mic_on = false, joined_at = NULL
      WHERE room_id = p_room_id AND user_id = p_user_id;
    END IF;
  END IF;

  SELECT count(DISTINCT p.user_id)::integer
  INTO v_active_count
  FROM public.room_presence p
  WHERE p.room_id = p_room_id
    AND p.last_seen_at > now() - interval '90 seconds'
    AND NOT EXISTS (
      SELECT 1 FROM public.room_seats s
      WHERE s.room_id = p_room_id
        AND s.user_id = p.user_id
        AND s.status = 'occupied'
    );

  RETURN v_active_count;
END;
$$;
REVOKE ALL ON FUNCTION public.record_wattar_room_presence(uuid, uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_wattar_room_presence(uuid, uuid, text, boolean) TO service_role;
COMMIT;
