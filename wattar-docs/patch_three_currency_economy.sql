-- Wattar's visible wallet is Point, Coin, and Diamond.
-- Run after patch_wattar_v2_wallet_economy.sql and before admin audit triggers.
BEGIN;

DO $$
DECLARE
  v_user record;
BEGIN
  FOR v_user IN
    SELECT id, balance_converted_coins
    FROM public.users
    WHERE balance_converted_coins > 0
    ORDER BY id
  LOOP
    PERFORM public.record_wallet_transaction(
      v_user.id,
      'admin_adjustment'::public.wallet_tx_type,
      -v_user.balance_converted_coins,
      'conv_gold',
      NULL,
      'currency-v1-retire-converted:' || v_user.id::text,
      'currency_migration',
      NULL,
      jsonb_build_object('reason', 'retired_currency_bucket', 'currency_model', 'point_coin_diamond'),
      'currency-migration'
    );
  END LOOP;

  FOR v_user IN
    SELECT id, balance_diamond_promo
    FROM public.users
    WHERE balance_diamond_promo > 0
    ORDER BY id
  LOOP
    PERFORM public.record_wallet_transaction(
      v_user.id,
      'admin_adjustment'::public.wallet_tx_type,
      -v_user.balance_diamond_promo,
      'promo_dia',
      NULL,
      'currency-v1-retire-promo-diamond:' || v_user.id::text,
      'currency_migration',
      NULL,
      jsonb_build_object('reason', 'retired_currency_bucket', 'currency_model', 'point_coin_diamond'),
      'currency-migration'
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_gift_send(
  p_from_user_id uuid,
  p_to_user_id uuid,
  p_gift_id uuid,
  p_quantity integer,
  p_room_id uuid,
  p_message text,
  p_idempotency_key text,
  p_funding_currency varchar(10)
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing public.gift_transactions%ROWTYPE;
  v_gift public.gifts%ROWTYPE;
  v_total_coins bigint;
  v_received_diamonds bigint;
  v_gift_transaction_id uuid := gen_random_uuid();
  v_gift_transaction public.gift_transactions%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_from_user_id IS NULL OR p_to_user_id IS NULL OR p_from_user_id = p_to_user_id
     OR p_quantity NOT BETWEEN 1 AND 100
     OR p_funding_currency IS DISTINCT FROM 'gold'
     OR length(trim(coalesce(p_idempotency_key, ''))) NOT BETWEEN 10 AND 90
     OR length(coalesce(p_message, '')) > 500 THEN
    RAISE EXCEPTION 'Invalid gift request';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('gift-send:' || p_idempotency_key));
  SELECT * INTO v_existing FROM public.gift_transactions
  WHERE idempotency_key = p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_existing.from_user_id <> p_from_user_id OR v_existing.to_user_id <> p_to_user_id
       OR v_existing.gift_id <> p_gift_id OR v_existing.quantity <> p_quantity
       OR v_existing.room_id IS DISTINCT FROM p_room_id
       OR v_existing.message IS DISTINCT FROM nullif(trim(p_message), '')
       OR v_existing.funding_currency <> p_funding_currency THEN
      RAISE EXCEPTION 'Idempotency key already used with different gift data';
    END IF;
    RETURN jsonb_build_object('success', true, 'already_processed', true,
      'gift_transaction', to_jsonb(v_existing), 'sent_coins', v_existing.total_gold,
      'received_diamonds', v_existing.received_diamond);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_from_user_id AND status = 'active')
     OR NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_to_user_id AND status = 'active') THEN
    RAISE EXCEPTION 'Sender or recipient is unavailable';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.user_blocks b
    WHERE (b.blocker_id = p_from_user_id AND b.blocked_id = p_to_user_id)
       OR (b.blocker_id = p_to_user_id AND b.blocked_id = p_from_user_id)
  ) THEN RAISE EXCEPTION 'Cannot send a gift to this user'; END IF;
  PERFORM 1 FROM public.users WHERE id IN (p_from_user_id, p_to_user_id)
    ORDER BY id FOR UPDATE;
  SELECT * INTO v_gift FROM public.gifts WHERE id = p_gift_id AND is_active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Gift is not available'; END IF;

  v_total_coins := v_gift.price_gold * p_quantity;
  v_received_diamonds := floor(v_total_coins * v_gift.recipient_diamond_ratio / 100)::bigint;
  IF v_total_coins <= 0 OR v_received_diamonds <= 0 THEN RAISE EXCEPTION 'Gift value is invalid'; END IF;

  PERFORM public.record_wallet_transaction(
    p_from_user_id, 'gift_sent'::public.wallet_tx_type, -v_total_coins,
    'gold', NULL, p_idempotency_key || ':out', 'gift',
    v_gift_transaction_id,
    jsonb_build_object('gift_id', p_gift_id, 'to_user_id', p_to_user_id,
      'quantity', p_quantity, 'funding_currency', 'gold'),
    'gift-send'
  );
  PERFORM public.record_wallet_transaction(
    p_to_user_id, 'gift_received'::public.wallet_tx_type, v_received_diamonds,
    'diamond', NULL, p_idempotency_key || ':in', 'gift',
    v_gift_transaction_id,
    jsonb_build_object('gift_id', p_gift_id, 'from_user_id', p_from_user_id,
      'quantity', p_quantity, 'funding_currency', 'gold'),
    'gift-send'
  );

  INSERT INTO public.gift_transactions (
    id, gift_id, from_user_id, to_user_id, room_id, quantity, total_gold,
    received_diamond, message, idempotency_key, funding_currency, received_diamond_currency
  ) VALUES (
    v_gift_transaction_id, p_gift_id, p_from_user_id, p_to_user_id, p_room_id,
    p_quantity, v_total_coins, v_received_diamonds, nullif(trim(p_message), ''),
    p_idempotency_key, 'gold', 'diamond'
  ) RETURNING * INTO v_gift_transaction;
  UPDATE public.users SET total_gifts_sent = total_gifts_sent + v_total_coins WHERE id = p_from_user_id;
  UPDATE public.users SET total_gifts_received = total_gifts_received + v_received_diamonds WHERE id = p_to_user_id;
  PERFORM public.award_user_xp(p_to_user_id, 'gift_received:' || v_gift_transaction_id::text, 'gift_received', 5);

  RETURN jsonb_build_object('success', true, 'gift_transaction', to_jsonb(v_gift_transaction),
    'sent_coins', v_total_coins, 'received_diamonds', v_received_diamonds,
    'gift_name', coalesce(v_gift.name_ar, v_gift.name));
END;
$$;
REVOKE ALL ON FUNCTION public.settle_gift_send(uuid, uuid, uuid, integer, uuid, text, text, varchar)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_gift_send(uuid, uuid, uuid, integer, uuid, text, text, varchar)
  TO service_role;

REVOKE ALL ON FUNCTION public.convert_my_diamonds_to_coins(bigint, text)
  FROM PUBLIC, anon, authenticated;

COMMIT;
