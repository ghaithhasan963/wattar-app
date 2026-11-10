-- Privacy-preserving activity history for account, social, room, and transaction events.
-- Run after the social, wallet-economy, host-program, room-access,
-- room-owner-moderation, and admin-audit patches.
BEGIN;

CREATE TABLE IF NOT EXISTS public.platform_activity_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_type text NOT NULL CHECK (event_type IN (
    'phone_otp_requested', 'phone_otp_rate_limited', 'phone_otp_rejected',
    'email_signup_succeeded', 'email_signup_rate_limited', 'email_signup_rejected',
    'session_started', 'account_created', 'admin_action_recorded',
    'room_created', 'room_closed', 'room_moderation_action',
    'room_member_joined', 'room_member_left', 'room_message_sent',
    'private_message_sent', 'friend_request_sent', 'friend_request_accepted',
    'user_followed', 'gift_sent', 'wallet_transaction_recorded',
    'game_played', 'deposit_requested', 'deposit_status_changed',
    'withdrawal_requested', 'withdrawal_status_changed', 'host_application_submitted',
    'host_application_reviewed', 'host_assigned', 'host_status_changed'
  )),
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  subject_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  resource_type text,
  resource_id uuid,
  source text NOT NULL CHECK (source IN ('auth', 'social', 'room', 'wallet', 'host', 'account')),
  ip_hash text CHECK (ip_hash IS NULL OR ip_hash ~ '^[0-9a-f]{64}$'),
  identity_hash text CHECK (identity_hash IS NULL OR identity_hash ~ '^[0-9a-f]{64}$'),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (pg_column_size(metadata) <= 2048),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS platform_activity_created
  ON public.platform_activity_log (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS platform_activity_actor
  ON public.platform_activity_log (actor_user_id, created_at DESC)
  WHERE actor_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS platform_activity_event
  ON public.platform_activity_log (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS platform_activity_ip_hash
  ON public.platform_activity_log (ip_hash, created_at DESC)
  WHERE ip_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS platform_activity_identity_hash
  ON public.platform_activity_log (identity_hash, created_at DESC)
  WHERE identity_hash IS NOT NULL;

ALTER TABLE public.platform_activity_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_activity_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.platform_activity_log TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.platform_activity_log_id_seq TO service_role;

DROP POLICY IF EXISTS platform_activity_admin_read ON public.platform_activity_log;
CREATE POLICY platform_activity_admin_read
  ON public.platform_activity_log FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.record_public_auth_activity(
  p_event_type text,
  p_ip_hash text,
  p_identity_hash text,
  p_actor_user_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_source text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;
  IF p_event_type NOT IN (
    'phone_otp_requested', 'phone_otp_rate_limited', 'phone_otp_rejected',
    'email_signup_succeeded', 'email_signup_rate_limited', 'email_signup_rejected'
  ) OR p_ip_hash !~ '^[0-9a-f]{64}$'
    OR p_identity_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'بيانات سجل النشاط غير صالحة';
  END IF;

  INSERT INTO public.platform_activity_log (
    event_type, actor_user_id, resource_type, source, ip_hash, identity_hash
  ) VALUES (
    p_event_type, p_actor_user_id, 'authentication', 'auth', p_ip_hash, p_identity_hash
  );
END;
$$;
REVOKE ALL ON FUNCTION public.record_public_auth_activity(text, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_public_auth_activity(text, text, text, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.record_my_session_started()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.role() <> 'authenticated' THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول';
  END IF;
  INSERT INTO public.platform_activity_log (event_type, actor_user_id, source)
  SELECT 'session_started', u.id, 'account'
  FROM public.users u
  WHERE u.id = auth.uid() AND u.status = 'active';
END;
$$;
REVOKE ALL ON FUNCTION public.record_my_session_started() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_my_session_started() TO authenticated;

CREATE OR REPLACE FUNCTION public.log_platform_activity_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_subject uuid;
  v_event text;
  v_resource text := TG_TABLE_NAME;
  v_resource_id uuid;
  v_source text;
  v_metadata jsonb := '{}'::jsonb;
BEGIN
  IF TG_TABLE_NAME = 'users' AND TG_OP = 'INSERT' THEN
    v_event := 'account_created';
    v_actor := NEW.id;
    v_subject := NEW.id;
    v_resource_id := NEW.id;
    v_source := 'account';
    v_metadata := jsonb_build_object('role', NEW.role::text);
  ELSIF TG_TABLE_NAME = 'admin_audit_log' AND TG_OP = 'INSERT' THEN
    v_event := 'admin_action_recorded';
    v_actor := NEW.admin_id;
    v_subject := CASE
      WHEN NEW.target_type IN ('user', 'verified_host')
        AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = NEW.target_id)
      THEN NEW.target_id
      ELSE NULL
    END;
    v_resource := NEW.target_type;
    v_resource_id := NEW.target_id;
    v_source := CASE
      WHEN NEW.target_type IN ('room', 'room_owner') THEN 'room'
      WHEN NEW.target_type IN ('host_application', 'verified_host') THEN 'host'
      WHEN NEW.target_type IN ('wallet', 'deposit', 'withdrawal') THEN 'wallet'
      ELSE 'account'
    END;
    v_metadata := jsonb_build_object(
      'action', NEW.action::text,
      'target_type', NEW.target_type
    );
  ELSIF TG_TABLE_NAME = 'rooms' THEN
    v_resource_id := CASE WHEN TG_OP = 'INSERT' THEN NEW.id ELSE NEW.id END;
    v_subject := NEW.owner_id;
    v_source := 'room';
    IF TG_OP = 'INSERT' THEN
      v_event := 'room_created';
    ELSIF OLD.status IS DISTINCT FROM NEW.status AND NEW.status::text = 'closed' THEN
      v_event := 'room_closed';
    ELSE
      RETURN NEW;
    END IF;
    v_metadata := jsonb_build_object('status', NEW.status::text);
  ELSIF TG_TABLE_NAME = 'room_seats' AND TG_OP = 'UPDATE'
      AND OLD.user_id IS DISTINCT FROM NEW.user_id THEN
    v_resource_id := NEW.room_id;
    v_source := 'room';
    IF NEW.user_id IS NOT NULL THEN
      v_event := 'room_member_joined';
      v_subject := NEW.user_id;
    ELSIF OLD.user_id IS NOT NULL THEN
      v_event := 'room_member_left';
      v_subject := OLD.user_id;
    ELSE
      RETURN NEW;
    END IF;
    v_metadata := jsonb_build_object('seat_index', NEW.seat_index);
  ELSIF TG_TABLE_NAME = 'room_messages' AND TG_OP = 'INSERT' THEN
    v_event := 'room_message_sent';
    v_actor := NEW.user_id;
    v_resource_id := NEW.room_id;
    v_source := 'room';
  ELSIF TG_TABLE_NAME = 'room_moderation_audit' AND TG_OP = 'INSERT' THEN
    v_event := 'room_moderation_action';
    v_actor := NEW.actor_id;
    v_subject := NEW.target_user_id;
    v_resource_id := NEW.room_id;
    v_source := 'room';
    v_metadata := jsonb_build_object(
      'action', NEW.action,
      'duration_minutes', NEW.duration_minutes
    );
  ELSIF TG_TABLE_NAME = 'private_messages' AND TG_OP = 'INSERT' THEN
    v_event := 'private_message_sent';
    v_actor := NEW.sender_id;
    v_resource_id := NEW.conversation_id;
    v_source := 'social';
  ELSIF TG_TABLE_NAME = 'friend_requests' THEN
    v_resource_id := NEW.id;
    v_source := 'social';
    IF TG_OP = 'INSERT' AND NEW.status = 'pending' THEN
      v_event := 'friend_request_sent';
      v_actor := NEW.requester_id;
      v_subject := NEW.recipient_id;
    ELSIF TG_OP = 'UPDATE' AND OLD.status = 'pending' AND NEW.status = 'accepted' THEN
      v_event := 'friend_request_accepted';
      v_actor := NEW.recipient_id;
      v_subject := NEW.requester_id;
    ELSE
      RETURN NEW;
    END IF;
    v_metadata := jsonb_build_object('status', NEW.status);
  ELSIF TG_TABLE_NAME = 'user_follows' AND TG_OP = 'INSERT' THEN
    v_event := 'user_followed';
    v_actor := NEW.follower_id;
    v_subject := NEW.followed_id;
    v_resource_id := NEW.followed_id;
    v_source := 'social';
  ELSIF TG_TABLE_NAME = 'gift_transactions' AND TG_OP = 'INSERT' THEN
    v_event := 'gift_sent';
    v_actor := NEW.from_user_id;
    v_subject := NEW.to_user_id;
    v_resource_id := NEW.id;
    v_source := 'wallet';
  ELSIF TG_TABLE_NAME = 'wallet_transactions' AND TG_OP = 'INSERT' THEN
    v_event := 'wallet_transaction_recorded';
    v_actor := NEW.user_id;
    v_resource_id := NEW.id;
    v_source := 'wallet';
    v_metadata := jsonb_build_object(
      'transaction_type', NEW.type::text,
      'amount', NEW.amount,
      'currency', NEW.currency,
      'reference_type', NEW.reference_type
    );
  ELSIF TG_TABLE_NAME = 'game_bets' AND TG_OP = 'INSERT' THEN
    v_event := 'game_played';
    v_actor := NEW.user_id;
    v_resource_id := NEW.id;
    v_source := 'wallet';
    v_metadata := jsonb_build_object(
      'game_type', NEW.game_type::text,
      'bet_amount', NEW.bet_amount,
      'payout', NEW.payout,
      'multiplier', NEW.multiplier,
      'is_win', NEW.is_win
    );
  ELSIF TG_TABLE_NAME = 'deposits' THEN
    v_subject := NEW.user_id;
    v_resource_id := NEW.id;
    v_source := 'wallet';
    IF TG_OP = 'INSERT' THEN
      v_event := 'deposit_requested';
      v_actor := NEW.user_id;
      v_metadata := jsonb_build_object('status', NEW.status::text, 'method', NEW.method::text);
    ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
      v_event := 'deposit_status_changed';
      v_metadata := jsonb_build_object('status', NEW.status::text);
    ELSE
      RETURN NEW;
    END IF;
  ELSIF TG_TABLE_NAME = 'diamond_withdrawals' THEN
    v_subject := NEW.user_id;
    v_resource_id := NEW.id;
    v_source := 'wallet';
    IF TG_OP = 'INSERT' THEN
      v_event := 'withdrawal_requested';
      v_actor := NEW.user_id;
      v_metadata := jsonb_build_object('status', NEW.status::text, 'method', NEW.method::text);
    ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
      v_event := 'withdrawal_status_changed';
      v_metadata := jsonb_build_object('status', NEW.status::text);
    ELSE
      RETURN NEW;
    END IF;
  ELSIF TG_TABLE_NAME = 'host_applications' THEN
    v_resource_id := NEW.id;
    v_subject := NEW.user_id;
    v_source := 'host';
    IF TG_OP = 'INSERT' THEN
      v_event := 'host_application_submitted';
    ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
      v_event := 'host_application_reviewed';
      v_metadata := jsonb_build_object('status', NEW.status);
    ELSE
      RETURN NEW;
    END IF;
  ELSIF TG_TABLE_NAME = 'verified_hosts' THEN
    v_resource_id := NEW.user_id;
    v_subject := NEW.user_id;
    v_source := 'host';
    IF TG_OP = 'INSERT' THEN
      v_event := 'host_assigned';
    ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
      v_event := 'host_status_changed';
      v_metadata := jsonb_build_object('status', NEW.status);
    ELSE
      RETURN NEW;
    END IF;
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.platform_activity_log (
    event_type, actor_user_id, subject_user_id, resource_type,
    resource_id, source, metadata
  ) VALUES (
    v_event, v_actor, v_subject, v_resource, v_resource_id,
    v_source, v_metadata
  );
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.log_platform_activity_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS platform_activity_rooms ON public.rooms;
CREATE TRIGGER platform_activity_rooms
  AFTER INSERT OR UPDATE OF status ON public.rooms
  FOR EACH ROW EXECUTE FUNCTION public.log_platform_activity_change();
DROP TRIGGER IF EXISTS platform_activity_users ON public.users;
CREATE TRIGGER platform_activity_users
  AFTER INSERT ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.log_platform_activity_change();
DROP TRIGGER IF EXISTS platform_activity_admin_audit ON public.admin_audit_log;
CREATE TRIGGER platform_activity_admin_audit
  AFTER INSERT ON public.admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.log_platform_activity_change();
DROP TRIGGER IF EXISTS platform_activity_room_seats ON public.room_seats;
CREATE TRIGGER platform_activity_room_seats
  AFTER UPDATE OF user_id ON public.room_seats
  FOR EACH ROW EXECUTE FUNCTION public.log_platform_activity_change();
DROP TRIGGER IF EXISTS platform_activity_room_messages ON public.room_messages;
CREATE TRIGGER platform_activity_room_messages
  AFTER INSERT ON public.room_messages
  FOR EACH ROW EXECUTE FUNCTION public.log_platform_activity_change();
DROP TRIGGER IF EXISTS platform_activity_room_moderation ON public.room_moderation_audit;
CREATE TRIGGER platform_activity_room_moderation
  AFTER INSERT ON public.room_moderation_audit
  FOR EACH ROW EXECUTE FUNCTION public.log_platform_activity_change();
DROP TRIGGER IF EXISTS platform_activity_private_messages ON public.private_messages;
CREATE TRIGGER platform_activity_private_messages
  AFTER INSERT ON public.private_messages
  FOR EACH ROW EXECUTE FUNCTION public.log_platform_activity_change();
DROP TRIGGER IF EXISTS platform_activity_friend_requests ON public.friend_requests;
CREATE TRIGGER platform_activity_friend_requests
  AFTER INSERT OR UPDATE OF status ON public.friend_requests
  FOR EACH ROW EXECUTE FUNCTION public.log_platform_activity_change();
DROP TRIGGER IF EXISTS platform_activity_user_follows ON public.user_follows;
CREATE TRIGGER platform_activity_user_follows
  AFTER INSERT ON public.user_follows
  FOR EACH ROW EXECUTE FUNCTION public.log_platform_activity_change();
DROP TRIGGER IF EXISTS platform_activity_gifts ON public.gift_transactions;
CREATE TRIGGER platform_activity_gifts
  AFTER INSERT ON public.gift_transactions
  FOR EACH ROW EXECUTE FUNCTION public.log_platform_activity_change();
DROP TRIGGER IF EXISTS platform_activity_wallet_transactions ON public.wallet_transactions;
CREATE TRIGGER platform_activity_wallet_transactions
  AFTER INSERT ON public.wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION public.log_platform_activity_change();
DROP TRIGGER IF EXISTS platform_activity_game_bets ON public.game_bets;
CREATE TRIGGER platform_activity_game_bets
  AFTER INSERT ON public.game_bets
  FOR EACH ROW EXECUTE FUNCTION public.log_platform_activity_change();
DROP TRIGGER IF EXISTS platform_activity_deposits ON public.deposits;
CREATE TRIGGER platform_activity_deposits
  AFTER INSERT OR UPDATE OF status ON public.deposits
  FOR EACH ROW EXECUTE FUNCTION public.log_platform_activity_change();
DROP TRIGGER IF EXISTS platform_activity_withdrawals ON public.diamond_withdrawals;
CREATE TRIGGER platform_activity_withdrawals
  AFTER INSERT OR UPDATE OF status ON public.diamond_withdrawals
  FOR EACH ROW EXECUTE FUNCTION public.log_platform_activity_change();
DROP TRIGGER IF EXISTS platform_activity_host_applications ON public.host_applications;
CREATE TRIGGER platform_activity_host_applications
  AFTER INSERT OR UPDATE OF status ON public.host_applications
  FOR EACH ROW EXECUTE FUNCTION public.log_platform_activity_change();
DROP TRIGGER IF EXISTS platform_activity_verified_hosts ON public.verified_hosts;
CREATE TRIGGER platform_activity_verified_hosts
  AFTER INSERT OR UPDATE OF status ON public.verified_hosts
  FOR EACH ROW EXECUTE FUNCTION public.log_platform_activity_change();

COMMIT;
