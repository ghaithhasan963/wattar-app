-- Audited agent activation, suspension, and blocking.
-- Run after patch_admin_audit_controls.sql.

CREATE OR REPLACE FUNCTION public.admin_set_agent_status(
  p_admin_id uuid,
  p_agent_id uuid,
  p_new_status text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin public.users%ROWTYPE;
  v_agent public.agents%ROWTYPE;
  v_user public.users%ROWTYPE;
  v_reason text := nullif(btrim(p_reason), '');
  v_action public.audit_action_type;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'غير مصرح بتنفيذ الإجراء الإداري';
  END IF;
  IF p_admin_id IS NULL OR p_agent_id IS NULL THEN
    RAISE EXCEPTION 'الوكيل المستهدف غير صالح';
  END IF;
  IF p_new_status IS NULL OR p_new_status NOT IN ('active', 'suspended', 'banned') THEN
    RAISE EXCEPTION 'حالة الوكيل غير صالحة';
  END IF;
  IF (p_new_status <> 'active' AND v_reason IS NULL)
     OR (v_reason IS NOT NULL AND char_length(v_reason) > 500) THEN
    RAISE EXCEPTION 'أدخل سببًا واضحًا لا يتجاوز 500 حرف';
  END IF;

  SELECT * INTO v_admin
  FROM public.users
  WHERE id = p_admin_id
  FOR UPDATE;
  IF NOT FOUND OR v_admin.status <> 'active'
     OR v_admin.role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'لا تملك صلاحية تنفيذ هذا الإجراء';
  END IF;

  SELECT * INTO v_agent
  FROM public.agents
  WHERE id = p_agent_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الوكيل غير موجود';
  END IF;

  SELECT * INTO v_user
  FROM public.users
  WHERE id = v_agent.user_id
  FOR UPDATE;
  IF NOT FOUND OR v_user.role <> 'agent' THEN
    RAISE EXCEPTION 'ملف حساب الوكيل غير صالح';
  END IF;
  IF v_agent.status::text = p_new_status AND v_user.status::text = p_new_status THEN
    RAISE EXCEPTION 'الوكيل موجود بالفعل بهذه الحالة';
  END IF;

  v_action := CASE p_new_status
    WHEN 'suspended' THEN 'suspend'::public.audit_action_type
    WHEN 'banned' THEN 'ban'::public.audit_action_type
    ELSE 'unban'::public.audit_action_type
  END;

  UPDATE public.agents
  SET status = p_new_status::public.user_status,
      updated_at = now()
  WHERE id = p_agent_id;

  UPDATE public.users
  SET status = p_new_status::public.user_status,
      banned_reason = CASE WHEN p_new_status = 'active' THEN NULL ELSE v_reason END,
      banned_until = NULL,
      updated_at = now()
  WHERE id = v_user.id;

  INSERT INTO public.admin_audit_log (
    admin_id, action, target_type, target_id, before, after, metadata
  ) VALUES (
    p_admin_id,
    v_action,
    'agent',
    p_agent_id,
    jsonb_build_object(
      'agent_status', v_agent.status,
      'user_status', v_user.status,
      'user_banned_reason', v_user.banned_reason
    ),
    jsonb_build_object(
      'agent_status', p_new_status,
      'user_status', p_new_status,
      'user_banned_reason', CASE WHEN p_new_status = 'active' THEN NULL ELSE v_reason END
    ),
    jsonb_build_object('reason', v_reason, 'permanent', p_new_status = 'banned')
  );

  RETURN jsonb_build_object(
    'agent_id', p_agent_id,
    'user_id', v_user.id,
    'status', p_new_status,
    'permanent', p_new_status = 'banned'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_agent_status(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_agent_status(uuid, uuid, text, text)
  TO service_role;
