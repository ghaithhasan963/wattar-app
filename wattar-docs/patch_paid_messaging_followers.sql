-- Extends paid private messaging so that MUTUAL FOLLOWERS get unlimited free
-- messages exactly like accepted friends. Director decision 2026-11-14.
-- Run AFTER patch_paid_messaging.sql (it replaces two of its functions).
--
-- Policy implemented:
--   free & unlimited : accepted friends  OR  mutual followers  OR  the sender is a host
--   free quota       : everyone else, `free_message_limit` messages per conversation
--   paid             : after the quota, `price_coin` per message (Coin)
--
-- Nothing else is touched. No table, no column, no data change.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_private_message_quote(p_conversation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conversation public.private_conversations%ROWTYPE;
  v_settings public.private_message_settings%ROWTYPE;
  v_other_user uuid;
  v_free_used integer;
  v_friends boolean;
  v_mutual_follows boolean;
  v_sender_host boolean;
  v_other_host boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  SELECT * INTO v_conversation
  FROM public.private_conversations
  WHERE id = p_conversation_id
    AND auth.uid() IN (user_one_id, user_two_id);
  IF NOT FOUND OR public.is_wattar_blocked_between(
    CASE WHEN auth.uid() = v_conversation.user_one_id THEN v_conversation.user_two_id ELSE v_conversation.user_one_id END
  ) THEN
    RAISE EXCEPTION 'المحادثة غير متاحة';
  END IF;

  v_other_user := CASE WHEN auth.uid() = v_conversation.user_one_id
    THEN v_conversation.user_two_id ELSE v_conversation.user_one_id END;
  SELECT * INTO v_settings FROM public.private_message_settings WHERE id = true;
  SELECT EXISTS (
    SELECT 1 FROM public.friend_requests f
    WHERE f.status = 'accepted'
      AND ((f.requester_id = auth.uid() AND f.recipient_id = v_other_user)
        OR (f.requester_id = v_other_user AND f.recipient_id = auth.uid()))
  ) INTO v_friends;
  SELECT
    EXISTS (
      SELECT 1 FROM public.user_follows
      WHERE follower_id = auth.uid() AND followed_id = v_other_user
    )
    AND EXISTS (
      SELECT 1 FROM public.user_follows
      WHERE follower_id = v_other_user AND followed_id = auth.uid()
    )
  INTO v_mutual_follows;
  SELECT EXISTS (SELECT 1 FROM public.host_program_members WHERE user_id = auth.uid() AND status = 'active')
    INTO v_sender_host;
  SELECT EXISTS (SELECT 1 FROM public.host_program_members WHERE user_id = v_other_user AND status = 'active')
    INTO v_other_host;
  SELECT count(*)::integer INTO v_free_used
  FROM public.private_messages m
  WHERE m.conversation_id = p_conversation_id
    AND m.sender_is_host_at_send = false;

  RETURN jsonb_build_object(
    'free_limit', v_settings.free_message_limit,
    'free_used', v_free_used,
    'free_remaining', CASE
      WHEN v_friends OR v_mutual_follows OR v_sender_host THEN NULL
      ELSE greatest(0, v_settings.free_message_limit - v_free_used)
    END,
    'price_coin', CASE
      WHEN v_friends OR v_mutual_follows OR v_sender_host
        OR v_free_used < v_settings.free_message_limit THEN 0
      ELSE v_settings.price_coin
    END,
    'host_commission_percent', v_settings.host_commission_percent,
    'recipient_is_host', v_other_host,
    'sender_is_host', v_sender_host,
    'is_friend', v_friends,
    'is_mutual_follow', v_mutual_follows
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_private_message_quote(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_private_message_quote(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.send_private_message(
  p_conversation_id uuid,
  p_body text,
  p_idempotency_key text,
  p_confirmed_price_coin bigint
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sender_id uuid := auth.uid();
  v_message_id uuid := gen_random_uuid();
  v_conversation public.private_conversations%ROWTYPE;
  v_settings public.private_message_settings%ROWTYPE;
  v_other_user_id uuid;
  v_free_used integer;
  v_charge bigint := 0;
  v_commission bigint := 0;
  v_friends boolean;
  v_mutual_follows boolean;
  v_sender_host boolean;
  v_other_host boolean;
  v_existing public.private_messages%ROWTYPE;
BEGIN
  IF v_sender_id IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF length(trim(coalesce(p_body, ''))) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'يجب أن تكون الرسالة بين حرف واحد و2000 حرف';
  END IF;
  IF length(trim(coalesce(p_idempotency_key, ''))) NOT BETWEEN 10 AND 70 THEN
    RAISE EXCEPTION 'مفتاح إرسال الرسالة غير صالح';
  END IF;
  IF p_confirmed_price_coin IS NULL OR p_confirmed_price_coin < 0 THEN
    RAISE EXCEPTION 'تأكيد سعر الرسالة غير صالح';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('private-message:' || p_idempotency_key));
  SELECT * INTO v_existing FROM public.private_messages
  WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.sender_id <> v_sender_id
       OR v_existing.conversation_id <> p_conversation_id
       OR v_existing.body <> trim(p_body) THEN
      RAISE EXCEPTION 'مفتاح الإرسال مستخدم لرسالة أخرى';
    END IF;
    RETURN jsonb_build_object(
      'message_id', v_existing.id, 'charged_coins', v_existing.charged_coins,
      'host_commission_diamonds', v_existing.host_commission_diamonds,
      'already_processed', true
    );
  END IF;

  SELECT * INTO v_conversation
  FROM public.private_conversations
  WHERE id = p_conversation_id
    AND v_sender_id IN (user_one_id, user_two_id)
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المحادثة غير متاحة'; END IF;
  v_other_user_id := CASE WHEN v_sender_id = v_conversation.user_one_id
    THEN v_conversation.user_two_id ELSE v_conversation.user_one_id END;
  IF public.is_wattar_blocked_between(v_other_user_id) THEN
    RAISE EXCEPTION 'المحادثة غير متاحة';
  END IF;
  PERFORM 1 FROM public.users
  WHERE id IN (v_sender_id, v_other_user_id)
  ORDER BY id
  FOR UPDATE;
  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = v_sender_id AND status = 'active' AND adult_confirmed_at IS NOT NULL
      AND onboarding_completed_at IS NOT NULL
  ) OR NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = v_other_user_id AND status = 'active' AND adult_confirmed_at IS NOT NULL
      AND onboarding_completed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'أحد الحسابين غير مؤهل للمراسلة';
  END IF;

  SELECT * INTO v_settings FROM public.private_message_settings WHERE id = true FOR SHARE;
  PERFORM 1 FROM public.host_program_members
  WHERE user_id IN (v_sender_id, v_other_user_id)
  ORDER BY user_id
  FOR SHARE;
  SELECT EXISTS (
    SELECT 1 FROM public.friend_requests f
    WHERE f.status = 'accepted'
      AND ((f.requester_id = v_sender_id AND f.recipient_id = v_other_user_id)
        OR (f.requester_id = v_other_user_id AND f.recipient_id = v_sender_id))
  ) INTO v_friends;
  SELECT
    EXISTS (
      SELECT 1 FROM public.user_follows
      WHERE follower_id = v_sender_id AND followed_id = v_other_user_id
    )
    AND EXISTS (
      SELECT 1 FROM public.user_follows
      WHERE follower_id = v_other_user_id AND followed_id = v_sender_id
    )
  INTO v_mutual_follows;
  SELECT EXISTS (SELECT 1 FROM public.host_program_members WHERE user_id = v_sender_id AND status = 'active')
    INTO v_sender_host;
  SELECT EXISTS (SELECT 1 FROM public.host_program_members WHERE user_id = v_other_user_id AND status = 'active')
    INTO v_other_host;

  SELECT count(*)::integer INTO v_free_used
  FROM public.private_messages m
  WHERE m.conversation_id = p_conversation_id
    AND m.sender_is_host_at_send = false;
  IF NOT v_friends AND NOT v_mutual_follows AND NOT v_sender_host
     AND v_free_used >= v_settings.free_message_limit THEN
    v_charge := v_settings.price_coin;
    IF v_other_host THEN
      v_commission := floor(v_charge * v_settings.host_commission_percent / 100.0)::bigint;
    END IF;
  END IF;
  IF v_charge > p_confirmed_price_coin THEN
    RAISE EXCEPTION 'تغير سعر الرسالة أو انتهت الرسائل المجانية. حدّث السعر وأكد الإرسال من جديد.';
  END IF;

  IF v_charge > 0 THEN
    PERFORM public.record_wallet_transaction(
      v_sender_id, 'message_sent'::public.wallet_tx_type, -v_charge,
      'gold', NULL, 'private-message:' || p_idempotency_key || ':coin',
      'private_message', v_message_id,
      jsonb_build_object('conversation_id', p_conversation_id, 'recipient_id', v_other_user_id),
      'private-message-send'
    );
  END IF;
  IF v_commission > 0 THEN
    PERFORM public.record_wallet_transaction(
      v_other_user_id, 'message_commission'::public.wallet_tx_type, v_commission,
      'diamond', NULL, 'private-message:' || p_idempotency_key || ':host',
      'private_message', v_message_id,
      jsonb_build_object('conversation_id', p_conversation_id, 'sender_id', v_sender_id,
        'charged_coins', v_charge, 'commission_percent', v_settings.host_commission_percent),
      'private-message-send'
    );
    INSERT INTO public.user_notifications (
      user_id, actor_id, event_type, reference_id, title, body, route
    ) VALUES (
      v_other_user_id, v_sender_id, 'host_earning', v_message_id,
      'عمولة رسالة جديدة',
      format('أُضيفت %s Diamond إلى رصيدك من رسالة مدفوعة.', v_commission),
      '/(tabs)/wallet'
    )
    ON CONFLICT (user_id, event_type, reference_id) DO NOTHING;
  END IF;

  INSERT INTO public.private_messages (
    id, conversation_id, sender_id, body, charged_coins,
    host_commission_diamonds, sender_is_host_at_send, idempotency_key
  ) VALUES (
    v_message_id, p_conversation_id, v_sender_id, trim(p_body),
    v_charge, v_commission, v_sender_host, p_idempotency_key
  );
  UPDATE public.private_conversations SET updated_at = now()
  WHERE id = p_conversation_id;
  RETURN jsonb_build_object(
    'message_id', v_message_id, 'charged_coins', v_charge,
    'host_commission_diamonds', v_commission, 'free_remaining',
    CASE WHEN v_friends OR v_mutual_follows OR v_sender_host THEN NULL
      ELSE greatest(0, v_settings.free_message_limit - v_free_used - 1) END,
    'already_processed', false
  );
END;
$$;
REVOKE ALL ON FUNCTION public.send_private_message(uuid, text, text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_private_message(uuid, text, text, bigint) TO authenticated;

COMMIT;
