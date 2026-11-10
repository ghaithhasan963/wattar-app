-- Direct, audited assignment and suspension of real host accounts by admins.
-- Run after patch_host_program.sql and patch_admin_audit_controls.sql.
BEGIN;

CREATE OR REPLACE FUNCTION public.admin_manage_verified_host(
  p_admin_id uuid,
  p_user_id uuid,
  p_action text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin public.users%ROWTYPE;
  v_user public.users%ROWTYPE;
  v_before text;
  v_after text;
  v_action public.audit_action_type;
  v_reason text := nullif(btrim(p_reason), '');
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'غير مصرح بتنفيذ الإجراء الإداري';
  END IF;
  IF p_admin_id IS NULL OR p_user_id IS NULL OR p_admin_id = p_user_id THEN
    RAISE EXCEPTION 'الحساب المستهدف غير صالح';
  END IF;
  IF p_action NOT IN ('assign', 'suspend', 'activate')
     OR v_reason IS NULL OR char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'حدد إجراءً وسببًا لا يتجاوز 500 حرف';
  END IF;

  SELECT * INTO v_admin
  FROM public.users
  WHERE id = p_admin_id
  FOR UPDATE;
  IF NOT FOUND OR v_admin.status <> 'active'
     OR v_admin.role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'لا تملك صلاحية إدارة المضيفات';
  END IF;

  SELECT * INTO v_user
  FROM public.users
  WHERE id = p_user_id
  FOR UPDATE;
  IF NOT FOUND OR v_user.status <> 'active'
     OR v_user.role <> 'user'
     OR v_user.adult_confirmed_at IS NULL
     OR v_user.onboarding_completed_at IS NULL THEN
    RAISE EXCEPTION 'لا يمكن تعيين هذا الحساب كمضيفة؛ يجب أن يكون حساب مستخدمة نشطًا ومكتمل التحقق';
  END IF;

  SELECT status INTO v_before
  FROM public.verified_hosts
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF p_action = 'assign' THEN
    IF v_before = 'active' THEN
      RAISE EXCEPTION 'هذا الحساب مضيفة نشطة بالفعل';
    END IF;
    INSERT INTO public.verified_hosts (user_id, status, approved_by, approved_at)
    VALUES (p_user_id, 'active', p_admin_id, now())
    ON CONFLICT (user_id) DO UPDATE
      SET status = 'active', approved_by = p_admin_id, approved_at = now();
    v_after := 'active';
    v_action := 'approve'::public.audit_action_type;
  ELSIF p_action = 'activate' THEN
    IF v_before IS DISTINCT FROM 'suspended' THEN
      RAISE EXCEPTION 'لا توجد مضيفة موقوفة لإعادة تفعيلها';
    END IF;
    UPDATE public.verified_hosts
    SET status = 'active', approved_by = p_admin_id, approved_at = now()
    WHERE user_id = p_user_id;
    v_after := 'active';
    v_action := 'approve'::public.audit_action_type;
  ELSE
    IF v_before IS DISTINCT FROM 'active' THEN
      RAISE EXCEPTION 'لا توجد مضيفة نشطة لإيقافها';
    END IF;
    UPDATE public.verified_hosts SET status = 'suspended' WHERE user_id = p_user_id;
    v_after := 'suspended';
    v_action := 'suspend'::public.audit_action_type;
  END IF;

  INSERT INTO public.admin_audit_log (
    admin_id, action, target_type, target_id, before, after, metadata
  ) VALUES (
    p_admin_id, v_action, 'verified_host', p_user_id,
    jsonb_build_object('status', v_before),
    jsonb_build_object('status', v_after),
    jsonb_build_object('reason', v_reason, 'operation', p_action)
  );

  RETURN jsonb_build_object('user_id', p_user_id, 'status', v_after);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_manage_verified_host(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_manage_verified_host(uuid, uuid, text, text)
  TO service_role;

DROP POLICY IF EXISTS verified_hosts_admin_select ON public.verified_hosts;
CREATE POLICY verified_hosts_admin_select
  ON public.verified_hosts FOR SELECT TO authenticated
  USING (public.is_admin());

COMMIT;
