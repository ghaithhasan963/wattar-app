-- M10.1: Admin/service grant for symbolic gifts (no coin conversion)
-- Grants add quantity to user_gift_bag; source is recorded for audit/display.

CREATE TABLE IF NOT EXISTS public.symbolic_gift_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  gift_id uuid NOT NULL REFERENCES public.gifts(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity > 0 AND quantity <= 1000),
  source text NOT NULL DEFAULT 'admin',
  granted_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_symbolic_gift_grants_idempotency
  ON public.symbolic_gift_grants (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_symbolic_gift_grants_user_created
  ON public.symbolic_gift_grants (user_id, created_at DESC);

ALTER TABLE public.symbolic_gift_grants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS symbolic_gift_grants_admin_select ON public.symbolic_gift_grants;
CREATE POLICY symbolic_gift_grants_admin_select ON public.symbolic_gift_grants
  FOR SELECT USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.grant_symbolic_gift(
  p_user_id uuid,
  p_gift_id uuid,
  p_quantity integer,
  p_source text DEFAULT 'admin',
  p_granted_by uuid DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_gift public.gifts%rowtype;
  v_existing public.symbolic_gift_grants%rowtype;
  v_grant_id uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_user_id IS NULL OR p_gift_id IS NULL THEN
    RAISE EXCEPTION 'Invalid grant';
  END IF;
  IF p_quantity IS NULL OR p_quantity < 1 OR p_quantity > 1000 THEN
    RAISE EXCEPTION 'Invalid quantity';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.symbolic_gift_grants
    WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', true,
        'already_processed', true,
        'grant_id', v_existing.id,
        'user_id', v_existing.user_id,
        'gift_id', v_existing.gift_id,
        'quantity', v_existing.quantity
      );
    END IF;
  END IF;

  SELECT * INTO v_gift FROM public.gifts WHERE id = p_gift_id FOR SHARE;
  IF NOT FOUND OR NOT v_gift.is_active OR NOT v_gift.is_symbolic THEN
    RAISE EXCEPTION 'Symbolic gift not available';
  END IF;

  PERFORM 1 FROM public.users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  INSERT INTO public.symbolic_gift_grants (user_id, gift_id, quantity, source, granted_by, idempotency_key)
  VALUES (p_user_id, p_gift_id, p_quantity, coalesce(nullif(trim(p_source),''), 'admin'), p_granted_by, p_idempotency_key)
  RETURNING id INTO v_grant_id;

  INSERT INTO public.user_gift_bag (user_id, gift_id, quantity, source)
  VALUES (p_user_id, p_gift_id, p_quantity, coalesce(nullif(trim(p_source),''), 'admin'))
  ON CONFLICT (user_id, gift_id)
  DO UPDATE SET
    quantity = public.user_gift_bag.quantity + EXCLUDED.quantity,
    source = EXCLUDED.source,
    updated_at = now();

  RETURN jsonb_build_object(
    'success', true,
    'already_processed', false,
    'grant_id', v_grant_id,
    'user_id', p_user_id,
    'gift_id', p_gift_id,
    'quantity', p_quantity,
    'source', coalesce(nullif(trim(p_source),''), 'admin')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.grant_symbolic_gift(uuid, uuid, integer, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_symbolic_gift(uuid, uuid, integer, text, uuid, text) TO service_role;
