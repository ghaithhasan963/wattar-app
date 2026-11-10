-- Audited administration of agent commission, exchange rate, and capabilities.
-- Run after patch_admin_audit_controls.sql and the agent schema migrations.
BEGIN;

CREATE OR REPLACE FUNCTION public.admin_update_agent_settings(
  p_agent_id uuid,
  p_commission_rate numeric,
  p_exchange_rate_usd_to_gold numeric,
  p_can_create_users boolean,
  p_can_approve_deposits boolean,
  p_can_approve_withdrawals boolean,
  p_can_set_user_rtp boolean,
  p_can_force_outcome boolean,
  p_can_suspend_users boolean,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_before public.agents%ROWTYPE;
  v_after public.agents%ROWTYPE;
  v_reason text := nullif(btrim(p_reason), '');
BEGIN
  IF v_admin_id IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'غير مصرح بتعديل إعدادات الوكيل';
  END IF;
  IF p_agent_id IS NULL
     OR p_commission_rate IS NULL OR p_commission_rate NOT BETWEEN 0 AND 100
     OR p_exchange_rate_usd_to_gold IS NULL OR p_exchange_rate_usd_to_gold NOT BETWEEN 1 AND 1000000
     OR p_can_create_users IS NULL
     OR p_can_approve_deposits IS NULL
     OR p_can_approve_withdrawals IS NULL
     OR p_can_set_user_rtp IS NULL
     OR p_can_force_outcome IS NULL
     OR p_can_suspend_users IS NULL
     OR char_length(coalesce(v_reason, '')) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'بيانات إعدادات الوكيل غير صالحة';
  END IF;

  SELECT * INTO v_before
  FROM public.agents
  WHERE id = p_agent_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الوكيل غير موجود'; END IF;

  UPDATE public.agents
  SET commission_rate = p_commission_rate,
      exchange_rate_usd_to_gold = p_exchange_rate_usd_to_gold,
      can_create_users = p_can_create_users,
      can_approve_deposits = p_can_approve_deposits,
      can_approve_withdrawals = p_can_approve_withdrawals,
      can_set_user_rtp = p_can_set_user_rtp,
      can_force_outcome = p_can_force_outcome,
      can_suspend_users = p_can_suspend_users,
      updated_at = now()
  WHERE id = p_agent_id
  RETURNING * INTO v_after;

  INSERT INTO public.admin_audit_log (
    admin_id, action, target_type, target_id, before, after, metadata
  ) VALUES (
    v_admin_id, 'update'::public.audit_action_type, 'agent',
    p_agent_id,
    jsonb_build_object(
      'commission_rate', v_before.commission_rate,
      'exchange_rate_usd_to_gold', v_before.exchange_rate_usd_to_gold,
      'can_create_users', v_before.can_create_users,
      'can_approve_deposits', v_before.can_approve_deposits,
      'can_approve_withdrawals', v_before.can_approve_withdrawals,
      'can_set_user_rtp', v_before.can_set_user_rtp,
      'can_force_outcome', v_before.can_force_outcome,
      'can_suspend_users', v_before.can_suspend_users
    ),
    jsonb_build_object(
      'commission_rate', v_after.commission_rate,
      'exchange_rate_usd_to_gold', v_after.exchange_rate_usd_to_gold,
      'can_create_users', v_after.can_create_users,
      'can_approve_deposits', v_after.can_approve_deposits,
      'can_approve_withdrawals', v_after.can_approve_withdrawals,
      'can_set_user_rtp', v_after.can_set_user_rtp,
      'can_force_outcome', v_after.can_force_outcome,
      'can_suspend_users', v_after.can_suspend_users
    ),
    jsonb_build_object('reason', v_reason)
  );

  RETURN jsonb_build_object('agent_id', p_agent_id, 'updated', true);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_agent_settings(
  uuid, numeric, numeric, boolean, boolean, boolean, boolean, boolean, boolean, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_agent_settings(
  uuid, numeric, numeric, boolean, boolean, boolean, boolean, boolean, boolean, text
) TO authenticated;

COMMIT;
