-- ============================================================
-- patch #51-fix1 — M2.6 تصحيح قراءة السبب من ترويسات الطلب
-- المشكلة: PostgreSQL يرفض أسماء GUC المخصصة بشرطة (request.headers.x-audit-reason)
-- والحل الصحيح: PostgREST يعرض كل الترويسات ككائن JSON واحد في request.headers
-- فيقرأ: current_setting('request.headers', true)::jsonb ->> 'x-audit-reason'
-- التاريخ: 2026-11-16 (بعد دقائق من #51 — قبل أي استخدام فعلي)
-- ============================================================

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
  v_reason text;
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

  -- السبب من ترويسات الطلب: PostgREST يعرضها ككائن JSON واحد في request.headers
  BEGIN
    v_reason := nullif(btrim(coalesce(
      (current_setting('request.headers', true)::jsonb) ->> 'x-audit-reason',
      (current_setting('request.headers', true)::jsonb) ->> 'x_audit_reason',
      ''
    ), ' "'), '');
  EXCEPTION WHEN others THEN
    v_reason := NULL;
  END;
  v_reason := nullif(left(coalesce(v_reason, ''), 500), '');

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
    admin_id, action, target_type, target_id, before, after, reason, metadata
  ) VALUES (
    v_admin_id,
    v_action,
    TG_TABLE_NAME,
    v_target_id,
    v_before,
    v_after,
    v_reason,
    jsonb_build_object('target_key', v_target_text, 'operation', TG_OP)
  );
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.audit_admin_row_change() FROM PUBLIC, anon, authenticated;
