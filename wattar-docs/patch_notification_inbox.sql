-- Persistent in-app notifications for core social and financial events.
-- Run after patch_social_foundation.sql, patch_wattar_v2_wallet_economy.sql,
-- the latest deposit/withdrawal schema updates, patch_host_program.sql, and
-- patch_memberships_xp_acceleration.sql.
BEGIN;

CREATE TABLE IF NOT EXISTS public.user_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'friend_request', 'friend_accepted', 'private_message',
    'room_invitation', 'new_follower', 'gift_received',
    'deposit_update', 'withdrawal_update', 'host_update', 'membership_update'
  )),
  reference_id uuid,
  title varchar(100) NOT NULL,
  body varchar(240) NOT NULL,
  route text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_notifications_not_self CHECK (actor_id IS NULL OR actor_id <> user_id),
  CONSTRAINT user_notifications_event_unique UNIQUE (user_id, event_type, reference_id)
);

CREATE INDEX IF NOT EXISTS user_notifications_user_unread
  ON public.user_notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS user_notifications_user_created
  ON public.user_notifications (user_id, created_at DESC);

ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_notifications FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.user_notifications TO authenticated;
GRANT UPDATE (read_at) ON public.user_notifications TO authenticated;

DROP POLICY IF EXISTS user_notifications_owner_select ON public.user_notifications;
CREATE POLICY user_notifications_owner_select
  ON public.user_notifications FOR SELECT TO authenticated
  USING (user_id = auth.uid());
DROP POLICY IF EXISTS user_notifications_owner_update ON public.user_notifications;
CREATE POLICY user_notifications_owner_update
  ON public.user_notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.create_wattar_event_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_recipient_id uuid;
  v_actor_id uuid;
  v_reference_id uuid;
  v_event_type text;
  v_title text;
  v_body text;
  v_route text;
  v_conversation public.private_conversations%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'friend_requests' THEN
    IF TG_OP = 'INSERT' AND NEW.status = 'pending' THEN
      v_recipient_id := NEW.recipient_id;
      v_actor_id := NEW.requester_id;
      v_reference_id := NEW.id;
      v_event_type := 'friend_request';
      v_title := 'طلب صداقة جديد';
      v_body := 'أرسل إليك شخص طلب صداقة.';
      v_route := '/(tabs)/friends';
    ELSIF TG_OP = 'UPDATE' AND OLD.status = 'pending' AND NEW.status = 'accepted' THEN
      v_recipient_id := NEW.requester_id;
      v_actor_id := NEW.recipient_id;
      v_reference_id := NEW.id;
      v_event_type := 'friend_accepted';
      v_title := 'تم قبول طلب الصداقة';
      v_body := 'أصبح بإمكانكما التواصل في Wattar.';
      v_route := '/(tabs)/friends';
    END IF;
  ELSIF TG_TABLE_NAME = 'private_messages' AND TG_OP = 'INSERT' THEN
    SELECT * INTO v_conversation
    FROM public.private_conversations
    WHERE id = NEW.conversation_id;
    IF NOT FOUND THEN RETURN NEW; END IF;
    v_recipient_id := CASE
      WHEN NEW.sender_id = v_conversation.user_one_id THEN v_conversation.user_two_id
      ELSE v_conversation.user_one_id
    END;
    v_actor_id := NEW.sender_id;
    v_reference_id := NEW.id;
    v_event_type := 'private_message';
    v_title := 'رسالة جديدة';
    v_body := 'أرسل إليك شخص رسالة خاصة.';
    v_route := '/messages/' || NEW.conversation_id::text;
  ELSIF TG_TABLE_NAME = 'room_invitations' AND TG_OP = 'INSERT'
      AND NEW.status = 'pending' THEN
    v_recipient_id := NEW.recipient_id;
    v_actor_id := NEW.sender_id;
    v_reference_id := NEW.id;
    v_event_type := 'room_invitation';
    v_title := 'دعوة إلى غرفة صوتية';
    v_body := 'دعاك شخص للانضمام إلى غرفة.';
    v_route := '/room/' || NEW.room_id::text;
  ELSIF TG_TABLE_NAME = 'user_follows' AND TG_OP = 'INSERT' THEN
    v_recipient_id := NEW.followed_id;
    v_actor_id := NEW.follower_id;
    v_reference_id := NEW.follower_id;
    v_event_type := 'new_follower';
    v_title := 'متابع جديد';
    v_body := 'بدأ شخص بمتابعتك.';
    v_route := '/(tabs)/friends';
  ELSIF TG_TABLE_NAME = 'gift_transactions' AND TG_OP = 'INSERT' THEN
    v_recipient_id := NEW.to_user_id;
    v_actor_id := NEW.from_user_id;
    v_reference_id := NEW.id;
    v_event_type := 'gift_received';
    v_title := 'وصلتك هدية';
    v_body := 'أرسل إليك شخص هدية جديدة.';
    v_route := '/(tabs)/wallet';
  ELSIF TG_TABLE_NAME = 'deposits' AND TG_OP = 'UPDATE'
      AND OLD.status IS DISTINCT FROM NEW.status THEN
    v_recipient_id := NEW.user_id;
    v_actor_id := NEW.reviewed_by;
    v_reference_id := NEW.id;
    v_event_type := 'deposit_update';
    v_title := 'تحديث طلب الشحن';
    v_body := CASE NEW.status::text
      WHEN 'completed' THEN 'تم إكمال طلب الشحن.'
      WHEN 'rejected' THEN 'تم رفض طلب الشحن. راجع تفاصيله.'
      ELSE 'تغيرت حالة طلب الشحن.'
    END;
    v_route := '/(tabs)/wallet';
  ELSIF TG_TABLE_NAME = 'diamond_withdrawals' AND TG_OP = 'UPDATE'
      AND OLD.status IS DISTINCT FROM NEW.status THEN
    v_recipient_id := NEW.user_id;
    v_actor_id := NEW.reviewed_by;
    v_reference_id := NEW.id;
    v_event_type := 'withdrawal_update';
    v_title := 'تحديث طلب السحب';
    v_body := CASE NEW.status::text
      WHEN 'completed' THEN 'تم إكمال طلب السحب.'
      WHEN 'rejected' THEN 'تم رفض طلب السحب. راجع تفاصيله.'
      ELSE 'تغيرت حالة طلب السحب.'
    END;
    v_route := '/(tabs)/wallet';
  ELSIF TG_TABLE_NAME = 'host_applications' AND TG_OP = 'UPDATE'
      AND OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'rejected' THEN
    v_recipient_id := NEW.user_id;
    v_actor_id := NEW.reviewed_by;
    v_reference_id := NEW.id;
    v_event_type := 'host_update';
    v_title := 'تحديث طلب المضيفة';
    v_body := CASE NEW.status
      WHEN 'approved' THEN 'تمت الموافقة على طلبك.'
      WHEN 'rejected' THEN 'تم تحديث طلبك. راجعي ملاحظة الإدارة.'
      ELSE 'تغيرت حالة طلبك.'
    END;
    v_route := '/host-application';
  ELSIF TG_TABLE_NAME = 'verified_hosts' THEN
    v_recipient_id := NEW.user_id;
    v_actor_id := CASE
      WHEN TG_OP = 'INSERT' OR OLD.approved_by IS DISTINCT FROM NEW.approved_by
      THEN NEW.approved_by
      ELSE NULL
    END;
    v_reference_id := gen_random_uuid();
    v_event_type := 'host_update';
    v_title := 'تحديث حالة المضيفة';
    v_body := CASE NEW.status
      WHEN 'active' THEN 'تم تفعيل حسابك كمضيفة موثقة.'
      ELSE 'تم تعليق حالة التوثيق. تواصلي مع الإدارة للمراجعة.'
    END;
    v_route := '/(tabs)/profile';
  ELSIF TG_TABLE_NAME = 'membership_purchases' AND TG_OP = 'INSERT' THEN
    v_recipient_id := NEW.user_id;
    v_reference_id := NEW.id;
    v_event_type := 'membership_update';
    v_title := 'تم تفعيل عضويتك';
    v_body := 'تم تسجيل شراء العضوية بنجاح.';
    v_route := '/membership';
  ELSE
    RETURN NEW;
  END IF;

  IF v_recipient_id IS NULL OR v_recipient_id = v_actor_id THEN
    RETURN NEW;
  END IF;
  IF v_actor_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_blocks b
    WHERE (b.blocker_id = v_actor_id AND b.blocked_id = v_recipient_id)
       OR (b.blocker_id = v_recipient_id AND b.blocked_id = v_actor_id)
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.user_notifications (
    user_id, actor_id, event_type, reference_id, title, body, route
  ) VALUES (
    v_recipient_id, v_actor_id, v_event_type, v_reference_id, v_title, v_body, v_route
  )
  ON CONFLICT (user_id, event_type, reference_id)
  DO NOTHING;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.create_wattar_event_notification() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS wattar_notification_friend_request ON public.friend_requests;
CREATE TRIGGER wattar_notification_friend_request
  AFTER INSERT OR UPDATE OF status ON public.friend_requests
  FOR EACH ROW EXECUTE FUNCTION public.create_wattar_event_notification();
DROP TRIGGER IF EXISTS wattar_notification_private_message ON public.private_messages;
CREATE TRIGGER wattar_notification_private_message
  AFTER INSERT ON public.private_messages
  FOR EACH ROW EXECUTE FUNCTION public.create_wattar_event_notification();
DROP TRIGGER IF EXISTS wattar_notification_room_invitation ON public.room_invitations;
CREATE TRIGGER wattar_notification_room_invitation
  AFTER INSERT ON public.room_invitations
  FOR EACH ROW EXECUTE FUNCTION public.create_wattar_event_notification();
DROP TRIGGER IF EXISTS wattar_notification_new_follower ON public.user_follows;
CREATE TRIGGER wattar_notification_new_follower
  AFTER INSERT ON public.user_follows
  FOR EACH ROW EXECUTE FUNCTION public.create_wattar_event_notification();
DROP TRIGGER IF EXISTS wattar_notification_gift_received ON public.gift_transactions;
CREATE TRIGGER wattar_notification_gift_received
  AFTER INSERT ON public.gift_transactions
  FOR EACH ROW EXECUTE FUNCTION public.create_wattar_event_notification();
DROP TRIGGER IF EXISTS wattar_notification_deposit_update ON public.deposits;
CREATE TRIGGER wattar_notification_deposit_update
  AFTER UPDATE OF status ON public.deposits
  FOR EACH ROW EXECUTE FUNCTION public.create_wattar_event_notification();
DROP TRIGGER IF EXISTS wattar_notification_withdrawal_update ON public.diamond_withdrawals;
CREATE TRIGGER wattar_notification_withdrawal_update
  AFTER UPDATE OF status ON public.diamond_withdrawals
  FOR EACH ROW EXECUTE FUNCTION public.create_wattar_event_notification();
DROP TRIGGER IF EXISTS wattar_notification_host_application ON public.host_applications;
CREATE TRIGGER wattar_notification_host_application
  AFTER UPDATE OF status ON public.host_applications
  FOR EACH ROW EXECUTE FUNCTION public.create_wattar_event_notification();
DROP TRIGGER IF EXISTS wattar_notification_verified_host ON public.verified_hosts;
CREATE TRIGGER wattar_notification_verified_host
  AFTER INSERT OR UPDATE OF status ON public.verified_hosts
  FOR EACH ROW EXECUTE FUNCTION public.create_wattar_event_notification();
DROP TRIGGER IF EXISTS wattar_notification_membership_purchase ON public.membership_purchases;
CREATE TRIGGER wattar_notification_membership_purchase
  AFTER INSERT ON public.membership_purchases
  FOR EACH ROW EXECUTE FUNCTION public.create_wattar_event_notification();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'user_notifications'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_notifications;
  END IF;
END;
$$;

COMMIT;
