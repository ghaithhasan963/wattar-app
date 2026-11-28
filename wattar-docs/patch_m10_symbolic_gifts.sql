-- M10: الهدايا الرمزية (الحقيبة) — أساس مخطط
-- الهدايا الرمزية: لا تُشترى، تُكتسب بطرق مختلفة، عند الإهداء تنتقل لحقيبة المستلم، ولا تتحول لعملات.

ALTER TABLE public.gifts
  ADD COLUMN IF NOT EXISTS is_symbolic boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS earn_source text; -- وصف/مفتاح طريقة الاكتساب (event, level, mission, admin...)

COMMENT ON COLUMN public.gifts.is_symbolic IS 'هدية رمزية: لا تُشترى بالذهب ولا تولّد عملات؛ تُكتسب وتُنقل بين الحقائب.';
COMMENT ON COLUMN public.gifts.earn_source IS 'مصدر اكتساب الهدية الرمزية (للعرض/القواعد).';

-- مخزون حقيبة الهدايا الرمزية لكل مستخدم
CREATE TABLE IF NOT EXISTS public.user_gift_bag (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  gift_id uuid NOT NULL REFERENCES public.gifts(id) ON DELETE CASCADE,
  quantity integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  source text, -- كيف اكتسبها
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, gift_id)
);

CREATE INDEX IF NOT EXISTS idx_user_gift_bag_user ON public.user_gift_bag(user_id) WHERE quantity > 0;

ALTER TABLE public.user_gift_bag ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_gift_bag_self_select ON public.user_gift_bag;
CREATE POLICY user_gift_bag_self_select ON public.user_gift_bag
  FOR SELECT USING (auth.uid() = user_id);

-- تحويل/إهداء رمزي: ينقص من حقيبة المرسل ويزيد في حقيبة المستلم، بدون أي حركة عملات.
CREATE OR REPLACE FUNCTION public.transfer_symbolic_gift(
  p_from_user_id uuid,
  p_to_user_id uuid,
  p_gift_id uuid,
  p_quantity integer,
  p_room_id uuid DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_gift public.gifts%rowtype;
  v_from_qty integer;
  v_transfer_id uuid := gen_random_uuid();
  v_sender_name text;
  v_receiver_name text;
  v_gift_name text;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_from_user_id IS NULL OR p_to_user_id IS NULL OR p_from_user_id = p_to_user_id THEN
    RAISE EXCEPTION 'Invalid transfer';
  END IF;
  IF p_quantity IS NULL OR p_quantity < 1 OR p_quantity > 100 THEN
    RAISE EXCEPTION 'Invalid quantity';
  END IF;

  SELECT * INTO v_gift FROM public.gifts WHERE id = p_gift_id FOR SHARE;
  IF NOT FOUND OR NOT v_gift.is_active OR NOT v_gift.is_symbolic THEN
    RAISE EXCEPTION 'Symbolic gift not available';
  END IF;

  PERFORM 1 FROM public.users WHERE id IN (p_from_user_id, p_to_user_id) ORDER BY id FOR UPDATE;

  INSERT INTO public.user_gift_bag (user_id, gift_id, quantity)
  VALUES (p_from_user_id, p_gift_id, 0)
  ON CONFLICT (user_id, gift_id) DO NOTHING;

  SELECT quantity INTO v_from_qty
  FROM public.user_gift_bag
  WHERE user_id = p_from_user_id AND gift_id = p_gift_id
  FOR UPDATE;

  IF coalesce(v_from_qty, 0) < p_quantity THEN
    RAISE EXCEPTION 'Insufficient symbolic gift quantity';
  END IF;

  UPDATE public.user_gift_bag
  SET quantity = quantity - p_quantity, updated_at = now()
  WHERE user_id = p_from_user_id AND gift_id = p_gift_id;

  INSERT INTO public.user_gift_bag (user_id, gift_id, quantity, source)
  VALUES (p_to_user_id, p_gift_id, p_quantity, 'gift_received')
  ON CONFLICT (user_id, gift_id)
  DO UPDATE SET quantity = public.user_gift_bag.quantity + EXCLUDED.quantity, updated_at = now();

  -- سجل حدث اختياري في شات الغرفة (نفس نمط رسالة الهدية النظامية)
  IF p_room_id IS NOT NULL THEN
    SELECT coalesce(nullif(display_name,''), username, 'عضو') INTO v_sender_name
    FROM public.users WHERE id = p_from_user_id;
    SELECT coalesce(nullif(display_name,''), username, 'عضو') INTO v_receiver_name
    FROM public.users WHERE id = p_to_user_id;
    v_gift_name := coalesce(nullif(v_gift.name_ar,''), nullif(v_gift.name,''), 'هدية رمزية');
    INSERT INTO public.room_messages (room_id, user_id, message, is_system, gift_id)
    VALUES (
      p_room_id,
      p_from_user_id,
      '🎁 ' || v_sender_name || ' أهدى ' || CASE WHEN p_quantity > 1 THEN p_quantity::text || 'x ' ELSE '' END || v_gift_name || ' إلى ' || v_receiver_name || ' (رمزية)',
      true,
      p_gift_id
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'symbolic', true,
    'transfer_id', v_transfer_id,
    'gift_id', p_gift_id,
    'quantity', p_quantity,
    'from_user_id', p_from_user_id,
    'to_user_id', p_to_user_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_symbolic_gift(uuid, uuid, uuid, integer, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_symbolic_gift(uuid, uuid, uuid, integer, uuid, text) TO service_role;
