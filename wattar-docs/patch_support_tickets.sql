-- Private support tickets with scoped staff access and an auditable message history.
-- Run after patch_support_role.sql, patch_admin_audit_controls.sql, and the base schema.
BEGIN;

ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'other';
CREATE INDEX IF NOT EXISTS idx_support_tickets_queue
  ON public.support_tickets (status, updated_at DESC);

ALTER TABLE public.user_notifications
  DROP CONSTRAINT IF EXISTS user_notifications_event_type_check;
ALTER TABLE public.user_notifications
  ADD CONSTRAINT user_notifications_event_type_check CHECK (event_type IN (
    'friend_request', 'friend_accepted', 'private_message',
    'room_invitation', 'new_follower', 'gift_received',
    'deposit_update', 'withdrawal_update', 'host_update', 'membership_update',
    'host_earning', 'support_reply'
  ));

CREATE TABLE IF NOT EXISTS public.support_ticket_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  sender_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  sender_role text NOT NULL CHECK (sender_role IN ('user', 'support', 'admin', 'super_admin')),
  body text NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 3000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_support_ticket_messages_ticket_time
  ON public.support_ticket_messages (ticket_id, created_at);

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_ticket_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.support_tickets, public.support_ticket_messages FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_wattar_support_staff()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid()
      AND status = 'active'
      AND role IN ('support', 'admin', 'super_admin')
  );
$$;
REVOKE ALL ON FUNCTION public.is_wattar_support_staff() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_wattar_support_staff() TO authenticated;

CREATE OR REPLACE FUNCTION public.create_support_ticket(
  p_category text,
  p_subject text,
  p_body text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_ticket_id uuid;
  v_body text := nullif(btrim(p_body), '');
  v_subject text := nullif(btrim(p_subject), '');
  v_recent_count integer;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = v_user_id AND status = 'active' AND role = 'user'
  ) THEN
    RAISE EXCEPTION 'الحساب غير مؤهل لفتح طلب دعم';
  END IF;
  IF p_category IS NULL OR p_category NOT IN ('account', 'deposit', 'withdrawal', 'technical', 'report', 'other')
     OR char_length(coalesce(v_subject, '')) NOT BETWEEN 5 AND 120
     OR char_length(coalesce(v_body, '')) NOT BETWEEN 10 AND 3000 THEN
    RAISE EXCEPTION 'تحقق من تصنيف الطلب وعنوانه ووصفه';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('support-ticket-create:' || v_user_id::text));
  SELECT count(*)::integer INTO v_recent_count
  FROM public.support_tickets
  WHERE user_id = v_user_id AND created_at >= now() - interval '24 hours';
  IF v_recent_count >= 5 THEN
    RAISE EXCEPTION 'يمكنك فتح خمسة طلبات دعم كحد أقصى خلال 24 ساعة';
  END IF;

  INSERT INTO public.support_tickets (user_id, category, subject, description, status, priority, updated_at)
  VALUES (v_user_id, p_category, v_subject, v_body, 'open', 'normal', now())
  RETURNING id INTO v_ticket_id;

  INSERT INTO public.support_ticket_messages (ticket_id, sender_id, sender_role, body)
  VALUES (v_ticket_id, v_user_id, 'user', v_body);
  RETURN jsonb_build_object('ticket_id', v_ticket_id, 'status', 'open');
END;
$$;
REVOKE ALL ON FUNCTION public.create_support_ticket(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_support_ticket(text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_my_support_tickets(p_limit integer DEFAULT 30, p_offset integer DEFAULT 0)
RETURNS TABLE (
  ticket_id uuid,
  subject text,
  category text,
  status text,
  priority text,
  created_at timestamptz,
  updated_at timestamptz,
  last_message text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'الحساب غير نشط';
  END IF;
  RETURN QUERY
  SELECT t.id, t.subject::text, t.category, t.status, t.priority,
         t.created_at, t.updated_at,
         coalesce((
           SELECT m.body FROM public.support_ticket_messages m
           WHERE m.ticket_id = t.id
           ORDER BY m.created_at DESC, m.id DESC LIMIT 1
         ), t.description)
  FROM public.support_tickets t
  WHERE t.user_id = auth.uid()
  ORDER BY t.updated_at DESC, t.id DESC
  LIMIT least(greatest(coalesce(p_limit, 30), 1), 50)
  OFFSET greatest(coalesce(p_offset, 0), 0);
END;
$$;
REVOKE ALL ON FUNCTION public.list_my_support_tickets(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_support_tickets(integer, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_support_ticket_messages(p_ticket_id uuid)
RETURNS TABLE (
  message_id uuid,
  sender_id uuid,
  sender_role text,
  sender_name text,
  body text,
  created_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND status = 'active'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.support_tickets t
    WHERE t.id = p_ticket_id
      AND (t.user_id = auth.uid() OR public.is_wattar_support_staff())
  ) THEN
    RAISE EXCEPTION 'طلب الدعم غير متاح';
  END IF;
  RETURN QUERY
  SELECT m.id, m.sender_id, m.sender_role,
         coalesce(u.display_name, u.username, 'فريق الدعم')::text,
         m.body, m.created_at
  FROM public.support_ticket_messages m
  LEFT JOIN public.users u ON u.id = m.sender_id
  WHERE m.ticket_id = p_ticket_id
  ORDER BY m.created_at, m.id;
END;
$$;
REVOKE ALL ON FUNCTION public.list_support_ticket_messages(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_support_ticket_messages(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.send_support_ticket_message(p_ticket_id uuid, p_body text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_user_role text;
  v_user_status text;
  v_ticket public.support_tickets%ROWTYPE;
  v_body text := nullif(btrim(p_body), '');
  v_message_id uuid;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF char_length(coalesce(v_body, '')) NOT BETWEEN 1 AND 3000 THEN
    RAISE EXCEPTION 'يجب أن تكون الرسالة بين حرف و3000 حرف';
  END IF;
  SELECT role::text, status::text INTO v_user_role, v_user_status
  FROM public.users
  WHERE id = v_user_id;
  IF NOT FOUND OR v_user_status <> 'active' THEN
    RAISE EXCEPTION 'الحساب غير نشط';
  END IF;

  SELECT * INTO v_ticket FROM public.support_tickets
  WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND OR (
    v_ticket.user_id <> v_user_id
    AND v_user_role NOT IN ('support', 'admin', 'super_admin')
  ) THEN
    RAISE EXCEPTION 'طلب الدعم غير متاح';
  END IF;
  IF v_user_role <> 'user' AND v_user_role NOT IN ('support', 'admin', 'super_admin') THEN
    RAISE EXCEPTION 'لا تملك صلاحية الرد على طلب الدعم';
  END IF;

  INSERT INTO public.support_ticket_messages (ticket_id, sender_id, sender_role, body)
  VALUES (p_ticket_id, v_user_id, v_user_role, v_body)
  RETURNING id INTO v_message_id;

  IF v_user_role IN ('support', 'admin', 'super_admin') THEN
    INSERT INTO public.user_notifications (
      user_id, actor_id, event_type, reference_id, title, body, route
    ) VALUES (
      v_ticket.user_id,
      CASE WHEN v_ticket.user_id = v_user_id THEN NULL ELSE v_user_id END,
      'support_reply',
      v_message_id,
      'رد جديد من فريق الدعم',
      left(v_body, 240),
      '/support/' || p_ticket_id::text
    );
  END IF;

  UPDATE public.support_tickets
  SET status = CASE
        WHEN v_user_role IN ('support', 'admin', 'super_admin') AND status = 'open' THEN 'in_progress'
        WHEN v_user_role = 'user' THEN 'open'
        ELSE status
      END,
      assigned_to = CASE
        WHEN v_user_role IN ('support', 'admin', 'super_admin') THEN coalesce(assigned_to, v_user_id)
        ELSE assigned_to
      END,
      updated_at = now()
  WHERE id = p_ticket_id;

  RETURN jsonb_build_object('message_id', v_message_id);
END;
$$;
REVOKE ALL ON FUNCTION public.send_support_ticket_message(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_support_ticket_message(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_support_queue(
  p_status text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  ticket_id uuid,
  user_id uuid,
  username text,
  display_name text,
  subject text,
  category text,
  status text,
  priority text,
  assigned_to uuid,
  assigned_name text,
  created_at timestamptz,
  updated_at timestamptz,
  last_message text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_wattar_support_staff() THEN
    RAISE EXCEPTION 'غير مصرح بعرض قائمة الدعم';
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('open', 'in_progress', 'resolved', 'closed') THEN
    RAISE EXCEPTION 'مرشح الحالة غير صالح';
  END IF;
  RETURN QUERY
  SELECT t.id, t.user_id, u.username::text, u.display_name::text, t.subject::text,
         t.category, t.status, t.priority, t.assigned_to,
         coalesce(assigned.display_name, assigned.username)::text,
         t.created_at, t.updated_at,
         coalesce((
           SELECT m.body FROM public.support_ticket_messages m
           WHERE m.ticket_id = t.id
           ORDER BY m.created_at DESC, m.id DESC LIMIT 1
         ), t.description)
  FROM public.support_tickets t
  JOIN public.users u ON u.id = t.user_id
  LEFT JOIN public.users assigned ON assigned.id = t.assigned_to
  WHERE p_status IS NULL OR t.status = p_status
  ORDER BY t.updated_at DESC, t.id DESC
  LIMIT least(greatest(coalesce(p_limit, 50), 1), 100)
  OFFSET greatest(coalesce(p_offset, 0), 0);
END;
$$;
REVOKE ALL ON FUNCTION public.list_support_queue(text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_support_queue(text, integer, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_support_ticket(
  p_ticket_id uuid,
  p_status text,
  p_priority text,
  p_assigned_to uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ticket public.support_tickets%ROWTYPE;
  v_admin_id uuid := auth.uid();
BEGIN
  IF v_admin_id IS NULL OR NOT public.is_wattar_support_staff() THEN
    RAISE EXCEPTION 'غير مصرح بتعديل طلب الدعم';
  END IF;
  IF p_ticket_id IS NULL
     OR p_status IS NULL OR p_status NOT IN ('open', 'in_progress', 'resolved', 'closed')
     OR p_priority IS NULL OR p_priority NOT IN ('low', 'normal', 'high') THEN
    RAISE EXCEPTION 'حالة الطلب أو أولويته غير صالحة';
  END IF;
  IF p_assigned_to IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = p_assigned_to AND status = 'active'
      AND role IN ('support', 'admin', 'super_admin')
  ) THEN
    RAISE EXCEPTION 'الموظف المسند إليه غير نشط أو غير مخول';
  END IF;

  SELECT * INTO v_ticket FROM public.support_tickets
  WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'طلب الدعم غير موجود'; END IF;

  UPDATE public.support_tickets
  SET status = p_status, priority = p_priority, assigned_to = p_assigned_to, updated_at = now()
  WHERE id = p_ticket_id;

  INSERT INTO public.admin_audit_log (
    admin_id, action, target_type, target_id, before, after, metadata
  ) VALUES (
    v_admin_id, 'update'::public.audit_action_type, 'support_ticket', p_ticket_id,
    jsonb_build_object('status', v_ticket.status, 'priority', v_ticket.priority, 'assigned_to', v_ticket.assigned_to),
    jsonb_build_object('status', p_status, 'priority', p_priority, 'assigned_to', p_assigned_to),
    jsonb_build_object('source', 'support_queue')
  );
  RETURN jsonb_build_object('ticket_id', p_ticket_id, 'status', p_status);
END;
$$;
REVOKE ALL ON FUNCTION public.update_support_ticket(uuid, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_support_ticket(uuid, text, text, uuid) TO authenticated;

COMMIT;
