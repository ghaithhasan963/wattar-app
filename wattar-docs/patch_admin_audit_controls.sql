-- Audited administrative user-status changes.
-- Run after all schema patches, including patch_wattar_v2_wallet_economy.sql.

REVOKE ALL ON public.admin_audit_log FROM anon, authenticated;
GRANT SELECT ON public.admin_audit_log TO authenticated;
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid()
      AND role IN ('admin', 'super_admin')
      AND status = 'active'
  );
$$;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

DROP POLICY IF EXISTS admin_audit_log_admin_select ON public.admin_audit_log;
CREATE POLICY admin_audit_log_admin_select
  ON public.admin_audit_log FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS users_admin_update ON public.users;

CREATE OR REPLACE FUNCTION public.admin_set_user_status(
  p_admin_id uuid,
  p_target_user_id uuid,
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
  v_target public.users%ROWTYPE;
  v_action public.audit_action_type;
  v_reason text := nullif(btrim(p_reason), '');
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'غير مصرح بتنفيذ الإجراء الإداري';
  END IF;
  IF p_admin_id IS NULL OR p_target_user_id IS NULL OR p_admin_id = p_target_user_id THEN
    RAISE EXCEPTION 'الحساب المستهدف غير صالح';
  END IF;
  IF p_new_status IS NULL OR p_new_status NOT IN ('active', 'suspended', 'banned') THEN
    RAISE EXCEPTION 'حالة الحساب غير صالحة';
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

  SELECT * INTO v_target
  FROM public.users
  WHERE id = p_target_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الحساب المستهدف غير موجود';
  END IF;
  IF v_target.role NOT IN ('user', 'guest') THEN
    RAISE EXCEPTION 'إجراء الحالة متاح لحسابات المستخدمين فقط';
  END IF;
  IF v_target.status::text = p_new_status THEN
    RAISE EXCEPTION 'الحساب موجود بالفعل بهذه الحالة';
  END IF;

  v_action := CASE p_new_status
    WHEN 'suspended' THEN 'suspend'::public.audit_action_type
    WHEN 'banned' THEN 'ban'::public.audit_action_type
    ELSE 'unban'::public.audit_action_type
  END;

  UPDATE public.users
  SET status = p_new_status::public.user_status,
      banned_reason = CASE WHEN p_new_status = 'active' THEN NULL ELSE v_reason END,
      banned_until = NULL,
      updated_at = now()
  WHERE id = p_target_user_id;

  INSERT INTO public.admin_audit_log (
    admin_id, action, target_type, target_id, before, after, metadata
  ) VALUES (
    p_admin_id,
    v_action,
    'user',
    p_target_user_id,
    jsonb_build_object(
      'status', v_target.status,
      'banned_reason', v_target.banned_reason,
      'banned_until', v_target.banned_until
    ),
    jsonb_build_object(
      'status', p_new_status,
      'banned_reason', CASE WHEN p_new_status = 'active' THEN NULL ELSE v_reason END,
      'banned_until', NULL
    ),
    jsonb_build_object(
      'reason', v_reason,
      'permanent', p_new_status = 'banned'
    )
  );

  RETURN jsonb_build_object(
    'user_id', p_target_user_id,
    'status', p_new_status,
    'permanent', p_new_status = 'banned'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_user_status(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_user_status(uuid, uuid, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.audit_admin_row_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_admin public.users%ROWTYPE;
  v_before jsonb;
  v_after jsonb;
  v_target_text text;
  v_target_id uuid;
  v_action public.audit_action_type;
  v_owner_id uuid;
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NULL;
  END IF;
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'يجب تنفيذ التعديل من جلسة مسؤول مصادق عليها';
  END IF;

  SELECT * INTO v_admin
  FROM public.users
  WHERE id = v_admin_id;
  IF NOT FOUND OR v_admin.status <> 'active'
     OR v_admin.role NOT IN ('admin', 'super_admin') THEN
    IF FOUND AND v_admin.status = 'active' AND TG_TABLE_NAME = 'rooms' THEN
      IF TG_OP = 'DELETE' THEN
        v_owner_id := OLD.owner_id;
      ELSE
        v_owner_id := NEW.owner_id;
      END IF;
      IF v_owner_id = v_admin_id THEN
        RETURN NULL;
      END IF;
    END IF;
    RAISE EXCEPTION 'لا تملك صلاحية تعديل إعدادات المنصة';
  END IF;

  IF TG_OP <> 'INSERT' THEN
    v_before := to_jsonb(OLD) - ARRAY['password', 'livekit_token'];
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_after := to_jsonb(NEW) - ARRAY['password', 'livekit_token'];
  END IF;
  IF v_before IS NOT DISTINCT FROM v_after THEN
    RETURN NULL;
  END IF;

  v_target_text := coalesce(
    v_after->>'id',
    v_after->>'key',
    v_after->>'method',
    v_after->>'game_type',
    v_before->>'id',
    v_before->>'key',
    v_before->>'method',
    v_before->>'game_type'
  );
  IF v_target_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_target_id := v_target_text::uuid;
  END IF;

  v_action := CASE TG_OP
    WHEN 'INSERT' THEN 'create'::public.audit_action_type
    WHEN 'DELETE' THEN 'delete'::public.audit_action_type
    ELSE 'update'::public.audit_action_type
  END;

  INSERT INTO public.admin_audit_log (
    admin_id, action, target_type, target_id, before, after, metadata
  ) VALUES (
    v_admin_id,
    v_action,
    TG_TABLE_NAME,
    v_target_id,
    v_before,
    v_after,
    jsonb_build_object('target_key', v_target_text, 'operation', TG_OP)
  );
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.audit_admin_row_change() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'admin_settings',
    'deposit_methods',
    'daily_missions',
    'gifts',
    'game_configs',
    'rooms'
  ] LOOP
    IF to_regclass(format('public.%I', v_table)) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS audit_admin_update ON public.%I', v_table);
      EXECUTE format('DROP TRIGGER IF EXISTS audit_admin_row_change ON public.%I', v_table);
      EXECUTE format(
        'CREATE TRIGGER audit_admin_row_change
         AFTER INSERT OR UPDATE OR DELETE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.audit_admin_row_change()',
        v_table
      );
    END IF;
  END LOOP;
END;
$$;
