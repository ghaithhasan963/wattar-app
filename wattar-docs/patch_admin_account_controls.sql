-- Safe account controls for administrative test-account maintenance.
-- Run after patch_admin_audit_controls.sql and all wallet/social schema patches.
BEGIN;

CREATE OR REPLACE FUNCTION public.revoke_inactive_user_sessions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status <> 'active' AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE public.user_sessions
    SET is_active = false
    WHERE user_id = NEW.id AND is_active;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_revoke_inactive_sessions ON public.users;
CREATE TRIGGER users_revoke_inactive_sessions
  AFTER UPDATE OF status ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.revoke_inactive_user_sessions();
REVOKE ALL ON FUNCTION public.revoke_inactive_user_sessions() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_delete_user_profile(
  p_admin_id uuid,
  p_target_user_id uuid,
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
  v_reason text := nullif(btrim(p_reason), '');
  v_fk record;
  v_has_reference boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'غير مصرح بتنفيذ الإجراء الإداري';
  END IF;
  IF p_admin_id IS NULL OR p_target_user_id IS NULL OR p_admin_id = p_target_user_id THEN
    RAISE EXCEPTION 'الحساب المستهدف غير صالح';
  END IF;
  IF v_reason IS NULL OR char_length(v_reason) > 500 THEN
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
  IF v_target.role IN ('admin', 'super_admin')
     AND (SELECT count(*) FROM public.users
          WHERE role IN ('admin', 'super_admin') AND status = 'active') <= 1 THEN
    RAISE EXCEPTION 'لا يمكن حذف آخر مسؤول نشط';
  END IF;
  IF v_target.role NOT IN ('user', 'guest') THEN
    RAISE EXCEPTION 'الحذف متاح لحسابات المستخدمين والضيوف فقط';
  END IF;

  -- Refuse linked rows that deletion would restrict, cascade, or default;
  -- nullable audit references configured with ON DELETE SET NULL are preserved.
  FOR v_fk IN
    SELECT child_ns.nspname AS child_schema,
           child.relname AS child_table,
           child_att.attname AS child_column
    FROM pg_constraint fk
    JOIN pg_class parent ON parent.oid = fk.confrelid
    JOIN pg_namespace parent_ns ON parent_ns.oid = parent.relnamespace
    JOIN LATERAL unnest(fk.conkey) WITH ORDINALITY AS child_key(attnum, ord) ON true
    JOIN LATERAL unnest(fk.confkey) WITH ORDINALITY AS parent_key(attnum, ord)
      ON parent_key.ord = child_key.ord
    JOIN pg_class child ON child.oid = fk.conrelid
    JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
    JOIN pg_attribute child_att
      ON child_att.attrelid = child.oid AND child_att.attnum = child_key.attnum
    JOIN pg_attribute parent_att
      ON parent_att.attrelid = parent.oid AND parent_att.attnum = parent_key.attnum
    WHERE fk.contype = 'f'
      AND fk.confdeltype <> 'n'
      AND parent_ns.nspname = 'public'
      AND parent.relname = 'users'
      AND parent_att.attname = 'id'
      AND child_ns.nspname NOT IN ('pg_catalog', 'information_schema')
      AND child.relkind IN ('r', 'p')
  LOOP
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM %I.%I WHERE %I = $1)',
      v_fk.child_schema,
      v_fk.child_table,
      v_fk.child_column
    ) INTO v_has_reference USING p_target_user_id;
    IF v_has_reference THEN
      RAISE EXCEPTION 'SAFE_DELETE_BLOCKED: linked records exist; archive or disable this account instead';
    END IF;
  END LOOP;

  DELETE FROM public.users WHERE id = p_target_user_id;

  INSERT INTO public.admin_audit_log (
    admin_id, action, target_type, target_id, before, after, metadata
  ) VALUES (
    p_admin_id,
    'delete'::public.audit_action_type,
    'user',
    p_target_user_id,
    jsonb_build_object('role', v_target.role, 'status', v_target.status),
    NULL,
    jsonb_build_object(
      'reason', v_reason,
      'irreversible', true,
      'linked_records_checked', true
    )
  );

  RETURN jsonb_build_object(
    'user_id', p_target_user_id,
    'deleted', true,
    'linked_records_checked', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_user_profile(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_user_profile(uuid, uuid, text)
  TO service_role;

COMMIT;
