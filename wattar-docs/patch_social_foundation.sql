-- Social foundation: friend requests, blocking/reporting, private chat,
-- presence, and room invitations. Run after wattar_schema.sql.

CREATE TABLE IF NOT EXISTS public.friend_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT friend_request_not_self CHECK (requester_id <> recipient_id),
  CONSTRAINT friend_request_unique_pair UNIQUE (requester_id, recipient_id)
);
CREATE INDEX IF NOT EXISTS idx_friend_requests_recipient_pending
  ON public.friend_requests (recipient_id, created_at DESC) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_friend_requests_requester_pending
  ON public.friend_requests (requester_id, created_at DESC) WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS idx_friend_requests_accepted_pair
  ON public.friend_requests (
    least(requester_id, recipient_id),
    greatest(requester_id, recipient_id)
  ) WHERE status = 'accepted';
ALTER TABLE public.friend_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.friend_requests FROM anon, authenticated;
GRANT SELECT ON public.friend_requests TO authenticated;

DROP POLICY IF EXISTS wattar_friend_requests_participant_read ON public.friend_requests;
CREATE POLICY wattar_friend_requests_participant_read
  ON public.friend_requests FOR SELECT TO authenticated
  USING (auth.uid() IN (requester_id, recipient_id));

CREATE TABLE IF NOT EXISTS public.user_blocks (
  blocker_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT user_block_not_self CHECK (blocker_id <> blocked_id)
);
ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_blocks FROM anon, authenticated;
GRANT SELECT ON public.user_blocks TO authenticated;

DROP POLICY IF EXISTS wattar_user_blocks_owner_read ON public.user_blocks;
CREATE POLICY wattar_user_blocks_owner_read
  ON public.user_blocks FOR SELECT TO authenticated
  USING (auth.uid() = blocker_id);

CREATE OR REPLACE FUNCTION public.is_wattar_blocked_between(p_other_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NULL OR EXISTS (
    SELECT 1 FROM public.user_blocks b
    WHERE (b.blocker_id = auth.uid() AND b.blocked_id = p_other_user_id)
       OR (b.blocker_id = p_other_user_id AND b.blocked_id = auth.uid())
  );
$$;
REVOKE ALL ON FUNCTION public.is_wattar_blocked_between(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_wattar_blocked_between(uuid) TO authenticated;

CREATE TABLE IF NOT EXISTS public.user_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  reported_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_report_not_self CHECK (reporter_id <> reported_id)
);
CREATE INDEX IF NOT EXISTS idx_user_reports_created_at
  ON public.user_reports (created_at DESC);
ALTER TABLE public.user_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_reports FROM anon, authenticated;
GRANT SELECT ON public.user_reports TO authenticated;

DROP POLICY IF EXISTS wattar_user_reports_admin_read ON public.user_reports;
CREATE POLICY wattar_user_reports_admin_read
  ON public.user_reports FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE TABLE IF NOT EXISTS public.private_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_one_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  user_two_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT private_conversation_distinct_users CHECK (user_one_id < user_two_id),
  CONSTRAINT private_conversation_unique_pair UNIQUE (user_one_id, user_two_id)
);
ALTER TABLE public.private_conversations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.private_conversations FROM anon, authenticated;
GRANT SELECT ON public.private_conversations TO authenticated;

DROP POLICY IF EXISTS wattar_private_conversation_member_read ON public.private_conversations;
CREATE POLICY wattar_private_conversation_member_read
  ON public.private_conversations FOR SELECT TO authenticated
  USING (
    auth.uid() IN (user_one_id, user_two_id)
    AND NOT public.is_wattar_blocked_between(
      CASE WHEN auth.uid() = user_one_id THEN user_two_id ELSE user_one_id END
    )
  );

CREATE TABLE IF NOT EXISTS public.private_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.private_conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 2000),
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_private_messages_conversation_time
  ON public.private_messages (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_private_messages_unread
  ON public.private_messages (conversation_id, created_at DESC) WHERE read_at IS NULL;
ALTER TABLE public.private_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.private_messages FROM anon, authenticated;
GRANT SELECT ON public.private_messages TO authenticated;

DROP POLICY IF EXISTS wattar_private_messages_member_read ON public.private_messages;
CREATE POLICY wattar_private_messages_member_read
  ON public.private_messages FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.private_conversations c
      WHERE c.id = conversation_id
        AND auth.uid() IN (c.user_one_id, c.user_two_id)
        AND NOT public.is_wattar_blocked_between(
          CASE WHEN auth.uid() = c.user_one_id THEN c.user_two_id ELSE c.user_one_id END
        )
    )
  );

DROP POLICY IF EXISTS wattar_private_dm_realtime_read ON realtime.messages;
CREATE POLICY wattar_private_dm_realtime_read
  ON realtime.messages FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.private_conversations c
      WHERE c.id::text = split_part(realtime.topic(), ':', 2)
        AND auth.uid() IN (c.user_one_id, c.user_two_id)
        AND NOT public.is_wattar_blocked_between(
          CASE WHEN auth.uid() = c.user_one_id THEN c.user_two_id ELSE c.user_one_id END
        )
    )
  );

DROP POLICY IF EXISTS wattar_private_dm_realtime_write ON realtime.messages;
CREATE POLICY wattar_private_dm_realtime_write
  ON realtime.messages FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.private_conversations c
      WHERE c.id::text = split_part(realtime.topic(), ':', 2)
        AND auth.uid() IN (c.user_one_id, c.user_two_id)
        AND NOT public.is_wattar_blocked_between(
          CASE WHEN auth.uid() = c.user_one_id THEN c.user_two_id ELSE c.user_one_id END
        )
    )
  );

CREATE TABLE IF NOT EXISTS public.room_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT room_invitation_not_self CHECK (sender_id <> recipient_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_room_invitation_pending_pair
  ON public.room_invitations (room_id, sender_id, recipient_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_room_invitations_recipient_pending
  ON public.room_invitations (recipient_id, created_at DESC) WHERE status = 'pending';
ALTER TABLE public.room_invitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.room_invitations FROM anon, authenticated;
GRANT SELECT ON public.room_invitations TO authenticated;

DROP POLICY IF EXISTS wattar_room_invitations_participant_read ON public.room_invitations;
CREATE POLICY wattar_room_invitations_participant_read
  ON public.room_invitations FOR SELECT TO authenticated
  USING (auth.uid() IN (sender_id, recipient_id));

DROP POLICY IF EXISTS wattar_rooms_invited_read ON public.rooms;
CREATE POLICY wattar_rooms_invited_read
  ON public.rooms FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.room_invitations i
      WHERE i.room_id = id
        AND i.recipient_id = auth.uid()
        AND i.status = 'accepted'
    )
  );

DROP POLICY IF EXISTS wattar_room_seats_invited_read ON public.room_seats;
CREATE POLICY wattar_room_seats_invited_read
  ON public.room_seats FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.room_invitations i
      WHERE i.room_id = room_seats.room_id
        AND i.recipient_id = auth.uid()
        AND i.status = 'accepted'
    )
  );

DROP POLICY IF EXISTS wattar_room_messages_invited_read ON public.room_messages;
CREATE POLICY wattar_room_messages_invited_read
  ON public.room_messages FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.room_invitations i
      WHERE i.room_id = room_messages.room_id
        AND i.recipient_id = auth.uid()
        AND i.status = 'accepted'
    )
  );

DROP POLICY IF EXISTS wattar_room_messages_invited_insert ON public.room_messages;
CREATE POLICY wattar_room_messages_invited_insert
  ON public.room_messages FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND NOT is_system
    AND EXISTS (
      SELECT 1 FROM public.room_invitations i
      JOIN public.rooms r ON r.id = i.room_id
      WHERE i.room_id = room_messages.room_id
        AND i.recipient_id = auth.uid()
        AND i.status = 'accepted'
        AND r.status <> 'closed'
    )
  );

CREATE OR REPLACE FUNCTION public.search_wattar_users(p_query text)
RETURNS TABLE (
  user_id uuid,
  username text,
  display_name text,
  avatar_url text,
  bio text,
  is_online boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.id, u.username::text, u.display_name::text, u.avatar_url,
         u.bio, coalesce(u.last_seen_at > now() - interval '5 minutes', false)
  FROM public.users u
  WHERE auth.uid() IS NOT NULL
    AND u.id <> auth.uid()
    AND u.status = 'active'
    AND length(trim(coalesce(p_query, ''))) >= 2
    AND (u.username ILIKE '%' || trim(p_query) || '%'
         OR coalesce(u.display_name, '') ILIKE '%' || trim(p_query) || '%')
    AND NOT EXISTS (
      SELECT 1 FROM public.user_blocks b
      WHERE (b.blocker_id = auth.uid() AND b.blocked_id = u.id)
         OR (b.blocker_id = u.id AND b.blocked_id = auth.uid())
    )
  ORDER BY (u.username ILIKE trim(p_query) || '%') DESC, u.username
  LIMIT 30;
$$;
REVOKE ALL ON FUNCTION public.search_wattar_users(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_wattar_users(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_my_friend_requests()
RETURNS TABLE (
  request_id uuid,
  direction text,
  status text,
  user_id uuid,
  username text,
  display_name text,
  avatar_url text,
  is_online boolean,
  created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT f.id,
         CASE WHEN f.recipient_id = auth.uid() THEN 'incoming' ELSE 'outgoing' END,
         f.status,
         u.id, u.username::text, u.display_name::text, u.avatar_url,
         coalesce(u.last_seen_at > now() - interval '5 minutes', false),
         f.created_at
  FROM public.friend_requests f
  JOIN public.users u ON u.id = CASE
    WHEN f.recipient_id = auth.uid() THEN f.requester_id ELSE f.recipient_id END
  WHERE auth.uid() IN (f.requester_id, f.recipient_id)
    AND f.status = 'pending'
  ORDER BY f.created_at DESC
  LIMIT 100;
$$;
REVOKE ALL ON FUNCTION public.list_my_friend_requests() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_my_friend_requests() TO authenticated;

CREATE OR REPLACE FUNCTION public.list_my_friends()
RETURNS TABLE (
  user_id uuid,
  username text,
  display_name text,
  avatar_url text,
  bio text,
  is_online boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.id, u.username::text, u.display_name::text, u.avatar_url,
         u.bio, coalesce(u.last_seen_at > now() - interval '5 minutes', false)
  FROM public.friend_requests f
  JOIN public.users u ON u.id = CASE
    WHEN f.requester_id = auth.uid() THEN f.recipient_id ELSE f.requester_id END
  WHERE auth.uid() IN (f.requester_id, f.recipient_id)
    AND f.status = 'accepted'
    AND NOT EXISTS (
      SELECT 1 FROM public.user_blocks b
      WHERE (b.blocker_id = auth.uid() AND b.blocked_id = u.id)
         OR (b.blocker_id = u.id AND b.blocked_id = auth.uid())
    )
  ORDER BY u.username
  LIMIT 500;
$$;
REVOKE ALL ON FUNCTION public.list_my_friends() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_my_friends() TO authenticated;

CREATE OR REPLACE FUNCTION public.send_friend_request(p_recipient_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_request_id uuid;
BEGIN
  IF auth.uid() IS NULL OR p_recipient_id = auth.uid() THEN
    RAISE EXCEPTION 'طلب الصداقة غير صالح';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_recipient_id AND u.status = 'active') THEN
    RAISE EXCEPTION 'المستخدم غير متاح';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.user_blocks b
    WHERE (b.blocker_id = auth.uid() AND b.blocked_id = p_recipient_id)
       OR (b.blocker_id = p_recipient_id AND b.blocked_id = auth.uid())
  ) THEN
    RAISE EXCEPTION 'لا يمكن إرسال طلب لهذا المستخدم';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.friend_requests f
    WHERE f.requester_id = p_recipient_id AND f.recipient_id = auth.uid()
      AND f.status = 'pending'
  ) THEN
    RAISE EXCEPTION 'لديك طلب صداقة وارد من هذا المستخدم؛ اقبله من قائمة الطلبات';
  END IF;
  INSERT INTO public.friend_requests (requester_id, recipient_id, status)
  VALUES (auth.uid(), p_recipient_id, 'pending')
  ON CONFLICT (requester_id, recipient_id) DO UPDATE
    SET status = 'pending', updated_at = now()
    WHERE public.friend_requests.status IN ('declined', 'cancelled')
  RETURNING id INTO v_request_id;
  IF v_request_id IS NULL THEN
    RAISE EXCEPTION 'يوجد طلب صداقة أو صداقة قائمة بالفعل';
  END IF;
  RETURN v_request_id;
END;
$$;
REVOKE ALL ON FUNCTION public.send_friend_request(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_friend_request(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.respond_friend_request(p_request_id uuid, p_accept boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_request public.friend_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_request FROM public.friend_requests
  WHERE id = p_request_id AND recipient_id = auth.uid() AND status = 'pending'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'طلب الصداقة غير موجود أو تمت معالجته'; END IF;
  IF p_accept AND EXISTS (
    SELECT 1 FROM public.user_blocks b
    WHERE (b.blocker_id = auth.uid() AND b.blocked_id = v_request.requester_id)
       OR (b.blocker_id = v_request.requester_id AND b.blocked_id = auth.uid())
  ) THEN
    RAISE EXCEPTION 'أزل الحظر أولًا لقبول طلب الصداقة';
  END IF;
  UPDATE public.friend_requests
  SET status = CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END,
      updated_at = now()
  WHERE id = p_request_id;
END;
$$;
REVOKE ALL ON FUNCTION public.respond_friend_request(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.respond_friend_request(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_private_conversation(p_other_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_one uuid;
  v_two uuid;
  v_conversation_id uuid;
BEGIN
  IF auth.uid() IS NULL OR p_other_user_id = auth.uid() THEN
    RAISE EXCEPTION 'المحادثة غير صالحة';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.friend_requests f
    WHERE f.status = 'accepted'
      AND ((f.requester_id = auth.uid() AND f.recipient_id = p_other_user_id)
        OR (f.requester_id = p_other_user_id AND f.recipient_id = auth.uid()))
  ) THEN
    RAISE EXCEPTION 'يمكنك مراسلة أصدقائك فقط';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.user_blocks b
    WHERE (b.blocker_id = auth.uid() AND b.blocked_id = p_other_user_id)
       OR (b.blocker_id = p_other_user_id AND b.blocked_id = auth.uid())
  ) THEN
    RAISE EXCEPTION 'لا يمكن بدء محادثة مع هذا المستخدم';
  END IF;
  v_one := least(auth.uid(), p_other_user_id);
  v_two := greatest(auth.uid(), p_other_user_id);
  INSERT INTO public.private_conversations (user_one_id, user_two_id)
  VALUES (v_one, v_two)
  ON CONFLICT (user_one_id, user_two_id) DO UPDATE
    SET updated_at = public.private_conversations.updated_at
  RETURNING id INTO v_conversation_id;
  RETURN v_conversation_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_private_conversation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_private_conversation(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_my_private_conversations()
RETURNS TABLE (
  conversation_id uuid,
  user_id uuid,
  username text,
  display_name text,
  avatar_url text,
  is_online boolean,
  last_message text,
  last_message_at timestamptz,
  unread_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT c.id, u.id, u.username::text, u.display_name::text, u.avatar_url,
         coalesce(u.last_seen_at > now() - interval '5 minutes', false),
         m.body, m.created_at,
         (SELECT count(*) FROM public.private_messages unread
          WHERE unread.conversation_id = c.id
            AND unread.sender_id <> auth.uid()
            AND unread.read_at IS NULL)
  FROM public.private_conversations c
  JOIN public.users u ON u.id = CASE
    WHEN c.user_one_id = auth.uid() THEN c.user_two_id ELSE c.user_one_id END
  LEFT JOIN LATERAL (
    SELECT pm.body, pm.created_at
    FROM public.private_messages pm
    WHERE pm.conversation_id = c.id
    ORDER BY pm.created_at DESC
    LIMIT 1
  ) m ON true
  WHERE auth.uid() IN (c.user_one_id, c.user_two_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.user_blocks b
      WHERE (b.blocker_id = c.user_one_id AND b.blocked_id = c.user_two_id)
         OR (b.blocker_id = c.user_two_id AND b.blocked_id = c.user_one_id)
    )
  ORDER BY coalesce(m.created_at, c.created_at) DESC
  LIMIT 200;
$$;
REVOKE ALL ON FUNCTION public.list_my_private_conversations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_my_private_conversations() TO authenticated;

CREATE OR REPLACE FUNCTION public.list_private_messages(p_conversation_id uuid)
RETURNS TABLE (
  message_id uuid,
  sender_id uuid,
  body text,
  created_at timestamptz,
  read_at timestamptz,
  username text,
  display_name text,
  avatar_url text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT m.id, m.sender_id, m.body, m.created_at, m.read_at,
         u.username::text, u.display_name::text, u.avatar_url
  FROM public.private_messages m
  JOIN public.private_conversations c ON c.id = m.conversation_id
  JOIN public.users u ON u.id = m.sender_id
  WHERE c.id = p_conversation_id
    AND auth.uid() IN (c.user_one_id, c.user_two_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.user_blocks b
      WHERE (b.blocker_id = c.user_one_id AND b.blocked_id = c.user_two_id)
         OR (b.blocker_id = c.user_two_id AND b.blocked_id = c.user_one_id)
    )
  ORDER BY m.created_at DESC
  LIMIT 200;
$$;
REVOKE ALL ON FUNCTION public.list_private_messages(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_private_messages(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.send_private_message(p_conversation_id uuid, p_body text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_message_id uuid;
BEGIN
  IF length(trim(coalesce(p_body, ''))) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'يجب أن تكون الرسالة بين حرف واحد و2000 حرف';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.private_conversations c
    WHERE c.id = p_conversation_id
      AND auth.uid() IN (c.user_one_id, c.user_two_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.user_blocks b
        WHERE (b.blocker_id = c.user_one_id AND b.blocked_id = c.user_two_id)
           OR (b.blocker_id = c.user_two_id AND b.blocked_id = c.user_one_id)
      )
  ) THEN
    RAISE EXCEPTION 'المحادثة غير متاحة';
  END IF;
  INSERT INTO public.private_messages (conversation_id, sender_id, body)
  VALUES (p_conversation_id, auth.uid(), trim(p_body))
  RETURNING id INTO v_message_id;
  UPDATE public.private_conversations SET updated_at = now()
  WHERE id = p_conversation_id;
  RETURN v_message_id;
END;
$$;
REVOKE ALL ON FUNCTION public.send_private_message(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_private_message(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_private_messages_read(p_conversation_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.private_messages m SET read_at = now()
  FROM public.private_conversations c
  WHERE c.id = p_conversation_id
    AND m.conversation_id = c.id
    AND m.sender_id <> auth.uid()
    AND m.read_at IS NULL
    AND auth.uid() IN (c.user_one_id, c.user_two_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.user_blocks b
      WHERE (b.blocker_id = c.user_one_id AND b.blocked_id = c.user_two_id)
         OR (b.blocker_id = c.user_two_id AND b.blocked_id = c.user_one_id)
    );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_private_messages_read(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_private_messages_read(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_my_presence()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  UPDATE public.users SET last_seen_at = now() WHERE id = auth.uid();
END;
$$;
REVOKE ALL ON FUNCTION public.set_my_presence() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_my_presence() TO authenticated;

CREATE OR REPLACE FUNCTION public.block_wattar_user(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR p_user_id = auth.uid() THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  INSERT INTO public.user_blocks (blocker_id, blocked_id)
  VALUES (auth.uid(), p_user_id) ON CONFLICT DO NOTHING;
  UPDATE public.friend_requests
  SET status = 'cancelled', updated_at = now()
  WHERE status = 'pending'
    AND ((requester_id = auth.uid() AND recipient_id = p_user_id)
      OR (requester_id = p_user_id AND recipient_id = auth.uid()));
  UPDATE public.room_invitations
  SET status = 'cancelled', updated_at = now()
  WHERE status IN ('pending', 'accepted')
    AND ((sender_id = auth.uid() AND recipient_id = p_user_id)
      OR (sender_id = p_user_id AND recipient_id = auth.uid()));
END;
$$;
REVOKE ALL ON FUNCTION public.block_wattar_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.block_wattar_user(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_my_blocked_users()
RETURNS TABLE (user_id uuid, username text, display_name text, avatar_url text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.id, u.username::text, u.display_name::text, u.avatar_url
  FROM public.user_blocks b
  JOIN public.users u ON u.id = b.blocked_id
  WHERE b.blocker_id = auth.uid()
  ORDER BY u.username
  LIMIT 500;
$$;
REVOKE ALL ON FUNCTION public.list_my_blocked_users() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_my_blocked_users() TO authenticated;

CREATE OR REPLACE FUNCTION public.unblock_wattar_user(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  DELETE FROM public.user_blocks
  WHERE blocker_id = auth.uid() AND blocked_id = p_user_id;
END;
$$;
REVOKE ALL ON FUNCTION public.unblock_wattar_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unblock_wattar_user(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.report_wattar_user(p_user_id uuid, p_reason text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_report_id uuid;
BEGIN
  IF auth.uid() IS NULL OR p_user_id = auth.uid() THEN RAISE EXCEPTION 'الإبلاغ غير صالح'; END IF;
  IF length(trim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'اكتب سببًا للإبلاغ بين 3 و500 حرف';
  END IF;
  INSERT INTO public.user_reports (reporter_id, reported_id, reason)
  VALUES (auth.uid(), p_user_id, trim(p_reason))
  RETURNING id INTO v_report_id;
  RETURN v_report_id;
END;
$$;
REVOKE ALL ON FUNCTION public.report_wattar_user(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.report_wattar_user(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_my_room_invitations()
RETURNS TABLE (
  invitation_id uuid,
  room_id uuid,
  room_name text,
  sender_id uuid,
  sender_name text,
  sender_avatar text,
  created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT i.id, r.id, r.name::text, u.id,
         coalesce(u.display_name, u.username)::text, u.avatar_url, i.created_at
  FROM public.room_invitations i
  JOIN public.rooms r ON r.id = i.room_id
  JOIN public.users u ON u.id = i.sender_id
  WHERE i.recipient_id = auth.uid()
    AND i.status = 'pending'
    AND r.status <> 'closed'
  ORDER BY i.created_at DESC
  LIMIT 100;
$$;
REVOKE ALL ON FUNCTION public.list_my_room_invitations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_my_room_invitations() TO authenticated;

CREATE OR REPLACE FUNCTION public.send_room_invitation(p_room_id uuid, p_recipient_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_invitation_id uuid;
BEGIN
  IF auth.uid() IS NULL OR p_recipient_id = auth.uid() THEN RAISE EXCEPTION 'الدعوة غير صالحة'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.rooms r
    WHERE r.id = p_room_id AND r.status <> 'closed'
      AND (r.owner_id = auth.uid() OR EXISTS (
        SELECT 1 FROM public.room_seats s
        WHERE s.room_id = r.id AND s.user_id = auth.uid() AND s.status = 'occupied'
      ))
  ) THEN RAISE EXCEPTION 'لا تملك صلاحية دعوة مستخدم لهذه الغرفة'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.friend_requests f
    WHERE f.status = 'accepted'
      AND ((f.requester_id = auth.uid() AND f.recipient_id = p_recipient_id)
        OR (f.requester_id = p_recipient_id AND f.recipient_id = auth.uid()))
  ) THEN RAISE EXCEPTION 'يمكنك دعوة أصدقائك فقط'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.user_blocks b
    WHERE (b.blocker_id = auth.uid() AND b.blocked_id = p_recipient_id)
       OR (b.blocker_id = p_recipient_id AND b.blocked_id = auth.uid())
  ) THEN RAISE EXCEPTION 'لا يمكن إرسال دعوة لهذا المستخدم'; END IF;
  INSERT INTO public.room_invitations (room_id, sender_id, recipient_id)
  VALUES (p_room_id, auth.uid(), p_recipient_id)
  ON CONFLICT (room_id, sender_id, recipient_id) WHERE status = 'pending'
  DO UPDATE SET updated_at = now()
  RETURNING id INTO v_invitation_id;
  RETURN v_invitation_id;
END;
$$;
REVOKE ALL ON FUNCTION public.send_room_invitation(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_room_invitation(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.respond_room_invitation(p_invitation_id uuid, p_accept boolean)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_room_id uuid;
BEGIN
  UPDATE public.room_invitations
  SET status = CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END,
      updated_at = now()
  WHERE id = p_invitation_id
    AND recipient_id = auth.uid()
    AND status = 'pending'
  RETURNING room_id INTO v_room_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'الدعوة غير موجودة أو تمت معالجتها'; END IF;
  IF p_accept AND NOT EXISTS (
    SELECT 1 FROM public.rooms r WHERE r.id = v_room_id AND r.status <> 'closed'
  ) THEN RAISE EXCEPTION 'الغرفة لم تعد متاحة'; END IF;
  RETURN CASE WHEN p_accept THEN v_room_id ELSE NULL END;
END;
$$;
REVOKE ALL ON FUNCTION public.respond_room_invitation(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.respond_room_invitation(uuid, boolean) TO authenticated;

CREATE TABLE IF NOT EXISTS public.game_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  game_type text NOT NULL DEFAULT 'dice' CHECK (game_type = 'dice'),
  max_players smallint NOT NULL CHECK (max_players IN (2, 4)),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'ready', 'playing', 'completed', 'cancelled')),
  winner_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_game_challenges_creator_time
  ON public.game_challenges (creator_id, created_at DESC);
ALTER TABLE public.game_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.game_challenges FROM anon, authenticated;
GRANT SELECT ON public.game_challenges TO authenticated;

CREATE TABLE IF NOT EXISTS public.game_challenge_players (
  challenge_id uuid NOT NULL REFERENCES public.game_challenges(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined')),
  dice_roll smallint CHECK (dice_roll BETWEEN 1 AND 6),
  joined_at timestamptz NOT NULL DEFAULT now(),
  rolled_at timestamptz,
  PRIMARY KEY (challenge_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_game_challenge_players_user_time
  ON public.game_challenge_players (user_id, joined_at DESC);
ALTER TABLE public.game_challenge_players ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.game_challenge_players FROM anon, authenticated;
GRANT SELECT ON public.game_challenge_players TO authenticated;

CREATE OR REPLACE FUNCTION public.is_game_challenge_player(p_challenge_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.game_challenge_players p
    WHERE p.challenge_id = p_challenge_id AND p.user_id = auth.uid()
  );
$$;
REVOKE ALL ON FUNCTION public.is_game_challenge_player(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_game_challenge_player(uuid) TO authenticated;

DROP POLICY IF EXISTS wattar_game_challenges_participant_read ON public.game_challenges;
CREATE POLICY wattar_game_challenges_participant_read
  ON public.game_challenges FOR SELECT TO authenticated
  USING (public.is_game_challenge_player(id));

DROP POLICY IF EXISTS wattar_game_challenge_players_participant_read ON public.game_challenge_players;
CREATE POLICY wattar_game_challenge_players_participant_read
  ON public.game_challenge_players FOR SELECT TO authenticated
  USING (public.is_game_challenge_player(challenge_id));

CREATE OR REPLACE FUNCTION public.create_dice_challenge(
  p_opponent_ids uuid[],
  p_max_players smallint
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_challenge_id uuid;
  v_opponent_id uuid;
BEGIN
  IF auth.uid() IS NULL OR p_opponent_ids IS NULL OR p_max_players NOT IN (2, 4)
     OR cardinality(p_opponent_ids) <> p_max_players - 1
     OR (SELECT count(DISTINCT opponent_id) FROM unnest(p_opponent_ids) AS opponent(opponent_id)) <> cardinality(p_opponent_ids)
     OR auth.uid() = ANY(p_opponent_ids) THEN
    RAISE EXCEPTION 'اختر صديقًا واحدًا لتحدٍ ثنائي أو ثلاثة أصدقاء لتحدٍ رباعي';
  END IF;
  FOREACH v_opponent_id IN ARRAY p_opponent_ids LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.friend_requests f
      WHERE f.status = 'accepted'
        AND ((f.requester_id = auth.uid() AND f.recipient_id = v_opponent_id)
          OR (f.requester_id = v_opponent_id AND f.recipient_id = auth.uid()))
    ) THEN RAISE EXCEPTION 'التحديات متاحة للأصدقاء فقط'; END IF;
    IF public.is_wattar_blocked_between(v_opponent_id) THEN
      RAISE EXCEPTION 'أزل الحظر قبل إرسال التحدي';
    END IF;
  END LOOP;

  INSERT INTO public.game_challenges (creator_id, max_players)
  VALUES (auth.uid(), p_max_players)
  RETURNING id INTO v_challenge_id;

  INSERT INTO public.game_challenge_players (challenge_id, user_id, status)
  VALUES (v_challenge_id, auth.uid(), 'accepted');
  INSERT INTO public.game_challenge_players (challenge_id, user_id, status)
  SELECT v_challenge_id, opponent.opponent_id, 'pending'
  FROM unnest(p_opponent_ids) AS opponent(opponent_id);
  RETURN v_challenge_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_dice_challenge(uuid[], smallint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_dice_challenge(uuid[], smallint) TO authenticated;

CREATE OR REPLACE FUNCTION public.respond_dice_challenge(
  p_challenge_id uuid,
  p_accept boolean
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM public.game_challenges
  WHERE id = p_challenge_id FOR UPDATE;
  IF NOT FOUND OR v_status <> 'pending' THEN RAISE EXCEPTION 'التحدي غير متاح'; END IF;
  UPDATE public.game_challenge_players
  SET status = CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END
  WHERE challenge_id = p_challenge_id AND user_id = auth.uid() AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'لا يوجد طلب تحدٍ بانتظارك'; END IF;
  IF NOT p_accept THEN
    UPDATE public.game_challenges SET status = 'cancelled' WHERE id = p_challenge_id;
  ELSIF NOT EXISTS (
    SELECT 1 FROM public.game_challenge_players
    WHERE challenge_id = p_challenge_id AND status = 'pending'
  ) THEN
    UPDATE public.game_challenges
    SET status = 'ready', started_at = now()
    WHERE id = p_challenge_id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.respond_dice_challenge(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.respond_dice_challenge(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.roll_dice_challenge(p_challenge_id uuid)
RETURNS smallint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status text;
  v_roll_byte integer;
  v_roll smallint;
  v_unrolled integer;
  v_winner_id uuid;
  v_top_score smallint;
  v_top_count integer;
BEGIN
  SELECT status INTO v_status FROM public.game_challenges
  WHERE id = p_challenge_id FOR UPDATE;
  IF NOT FOUND OR v_status NOT IN ('ready', 'playing') THEN
    RAISE EXCEPTION 'التحدي لم يبدأ أو انتهى بالفعل';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.game_challenge_players
    WHERE challenge_id = p_challenge_id AND user_id = auth.uid() AND status = 'accepted'
  ) THEN RAISE EXCEPTION 'لست مشاركًا مقبولًا في هذا التحدي'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.game_challenge_players
    WHERE challenge_id = p_challenge_id AND user_id = auth.uid() AND dice_roll IS NOT NULL
  ) THEN RAISE EXCEPTION 'لقد رميت النرد بالفعل'; END IF;

  LOOP
    v_roll_byte := get_byte(gen_random_bytes(1), 0);
    EXIT WHEN v_roll_byte < 252;
  END LOOP;
  v_roll := (v_roll_byte % 6) + 1;
  UPDATE public.game_challenge_players
  SET dice_roll = v_roll, rolled_at = now()
  WHERE challenge_id = p_challenge_id AND user_id = auth.uid();
  UPDATE public.game_challenges
  SET status = 'playing'
  WHERE id = p_challenge_id AND status = 'ready';

  SELECT count(*) INTO v_unrolled
  FROM public.game_challenge_players
  WHERE challenge_id = p_challenge_id AND status = 'accepted' AND dice_roll IS NULL;
  IF v_unrolled = 0 THEN
    SELECT max(dice_roll), count(*) FILTER (
      WHERE dice_roll = (SELECT max(dice_roll) FROM public.game_challenge_players
                         WHERE challenge_id = p_challenge_id AND status = 'accepted')
    )
    INTO v_top_score, v_top_count
    FROM public.game_challenge_players
    WHERE challenge_id = p_challenge_id AND status = 'accepted';
    IF v_top_count = 1 THEN
      SELECT user_id INTO v_winner_id
      FROM public.game_challenge_players
      WHERE challenge_id = p_challenge_id AND status = 'accepted' AND dice_roll = v_top_score;
    END IF;
    UPDATE public.game_challenges
    SET status = 'completed', winner_id = v_winner_id, completed_at = now()
    WHERE id = p_challenge_id;
  END IF;
  RETURN v_roll;
END;
$$;
REVOKE ALL ON FUNCTION public.roll_dice_challenge(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.roll_dice_challenge(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_my_dice_challenges()
RETURNS TABLE (
  challenge_id uuid,
  game_type text,
  max_players smallint,
  challenge_status text,
  my_status text,
  my_roll smallint,
  winner_id uuid,
  created_at timestamptz,
  participants jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT c.id, c.game_type, c.max_players, c.status, mine.status, mine.dice_roll,
         c.winner_id, c.created_at,
         (SELECT jsonb_agg(jsonb_build_object(
            'user_id', p.user_id,
            'display_name', coalesce(u.display_name, u.username),
            'status', p.status,
            'dice_roll', CASE WHEN c.status = 'completed' THEN p.dice_roll ELSE NULL END
          ) ORDER BY p.joined_at)
          FROM public.game_challenge_players p
          JOIN public.users u ON u.id = p.user_id
          WHERE p.challenge_id = c.id)
  FROM public.game_challenges c
  JOIN public.game_challenge_players mine
    ON mine.challenge_id = c.id AND mine.user_id = auth.uid()
  ORDER BY c.created_at DESC
  LIMIT 100;
$$;
REVOKE ALL ON FUNCTION public.list_my_dice_challenges() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_my_dice_challenges() TO authenticated;

-- Messages are consumed by client subscriptions, so publish them for Realtime.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.private_messages;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.friend_requests;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.room_invitations;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.game_challenges;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.game_challenge_players;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

-- Push tokens are per-device and can only be managed by their owner.
CREATE TABLE IF NOT EXISTS public.push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  expo_push_token text NOT NULL UNIQUE,
  platform text NOT NULL CHECK (platform IN ('android', 'ios')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON public.push_tokens (user_id);
ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_tokens FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.register_my_push_token(p_token text, p_platform text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL
     OR p_token IS NULL
     OR length(p_token) > 200
     OR p_token !~ '^Expo(nent)?PushToken\[[^]]+\]$'
     OR p_platform NOT IN ('android', 'ios') THEN
    RAISE EXCEPTION 'بيانات الإشعارات غير صالحة';
  END IF;

  INSERT INTO public.push_tokens (user_id, expo_push_token, platform, updated_at)
  VALUES (auth.uid(), p_token, p_platform, now())
  ON CONFLICT (expo_push_token) DO UPDATE
    SET user_id = EXCLUDED.user_id,
        platform = EXCLUDED.platform,
        updated_at = now()
    WHERE public.push_tokens.user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'رمز الإشعارات مرتبط بحساب آخر'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.register_my_push_token(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_my_push_token(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.remove_my_push_token(p_token text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM public.push_tokens
  WHERE user_id = auth.uid() AND expo_push_token = p_token;
END;
$$;
REVOKE ALL ON FUNCTION public.remove_my_push_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remove_my_push_token(text) TO authenticated;
