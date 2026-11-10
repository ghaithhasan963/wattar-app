-- Verified human-host applications.
-- Run after patch_admin_audit_controls.sql and patch_social_profiles_posts.sql.

CREATE TABLE IF NOT EXISTS public.host_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  application_text varchar(2000) NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  review_note varchar(500),
  reviewed_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  CONSTRAINT host_application_text_length
    CHECK (char_length(btrim(application_text)) BETWEEN 20 AND 2000)
);

CREATE UNIQUE INDEX IF NOT EXISTS host_applications_one_pending_per_user
  ON public.host_applications (user_id)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS host_applications_status_created
  ON public.host_applications (status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.verified_hosts (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended')),
  approved_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  approved_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.host_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verified_hosts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.host_applications, public.verified_hosts FROM anon, authenticated;
GRANT SELECT ON public.host_applications TO authenticated;
GRANT SELECT (user_id, status) ON public.verified_hosts TO authenticated;

DROP POLICY IF EXISTS host_applications_owner_or_admin_select ON public.host_applications;
CREATE POLICY host_applications_owner_or_admin_select
  ON public.host_applications FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS verified_hosts_public_select ON public.verified_hosts;
CREATE POLICY verified_hosts_public_select
  ON public.verified_hosts FOR SELECT TO authenticated
  USING (status = 'active');

CREATE OR REPLACE FUNCTION public.submit_host_application(p_application_text text)
RETURNS public.host_applications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user public.users%ROWTYPE;
  v_application public.host_applications%ROWTYPE;
  v_text text := btrim(coalesce(p_application_text, ''));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول قبل تقديم الطلب';
  END IF;
  IF char_length(v_text) < 20 OR char_length(v_text) > 2000 THEN
    RAISE EXCEPTION 'اكتب نبذة من 20 إلى 2000 حرف';
  END IF;

  SELECT * INTO v_user
  FROM public.users
  WHERE id = auth.uid()
  FOR UPDATE;
  IF NOT FOUND OR v_user.status <> 'active'
     OR v_user.role <> 'user'
     OR v_user.adult_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'هذا الحساب غير مؤهل لتقديم طلب مضيفة';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.verified_hosts h
    WHERE h.user_id = v_user.id AND h.status = 'active'
  ) THEN
    RAISE EXCEPTION 'هذا الحساب مضيفة موثقة بالفعل';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.host_applications a
    WHERE a.user_id = v_user.id AND a.status = 'pending'
  ) THEN
    RAISE EXCEPTION 'لديك طلب قيد المراجعة بالفعل';
  END IF;

  INSERT INTO public.host_applications (user_id, application_text)
  VALUES (v_user.id, v_text)
  RETURNING * INTO v_application;

  RETURN v_application;
END;
$$;
REVOKE ALL ON FUNCTION public.submit_host_application(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_host_application(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_review_host_application(
  p_admin_id uuid,
  p_application_id uuid,
  p_approve boolean,
  p_review_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin public.users%ROWTYPE;
  v_application public.host_applications%ROWTYPE;
  v_user public.users%ROWTYPE;
  v_note text := nullif(btrim(p_review_note), '');
  v_status text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'غير مصرح بتنفيذ الإجراء الإداري';
  END IF;
  IF p_admin_id IS NULL OR p_application_id IS NULL OR p_approve IS NULL THEN
    RAISE EXCEPTION 'بيانات مراجعة الطلب غير مكتملة';
  END IF;
  IF (NOT p_approve AND v_note IS NULL)
     OR (v_note IS NOT NULL AND char_length(v_note) > 500) THEN
    RAISE EXCEPTION 'أدخل سببًا للرفض لا يتجاوز 500 حرف';
  END IF;

  SELECT * INTO v_admin
  FROM public.users
  WHERE id = p_admin_id
  FOR UPDATE;
  IF NOT FOUND OR v_admin.status <> 'active'
     OR v_admin.role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'لا تملك صلاحية مراجعة الطلبات';
  END IF;

  SELECT * INTO v_application
  FROM public.host_applications
  WHERE id = p_application_id
  FOR UPDATE;
  IF NOT FOUND OR v_application.status <> 'pending' THEN
    RAISE EXCEPTION 'الطلب غير موجود أو تمت مراجعته مسبقًا';
  END IF;

  SELECT * INTO v_user
  FROM public.users
  WHERE id = v_application.user_id
  FOR UPDATE;
  IF NOT FOUND OR v_user.status <> 'active' OR v_user.role <> 'user' THEN
    RAISE EXCEPTION 'حساب المتقدمة غير نشط';
  END IF;

  v_status := CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END;
  UPDATE public.host_applications
  SET status = v_status,
      review_note = v_note,
      reviewed_by = p_admin_id,
      reviewed_at = now()
  WHERE id = p_application_id;

  IF p_approve THEN
    INSERT INTO public.verified_hosts (user_id, status, approved_by, approved_at)
    VALUES (v_user.id, 'active', p_admin_id, now())
    ON CONFLICT (user_id) DO UPDATE
      SET status = 'active',
          approved_by = EXCLUDED.approved_by,
          approved_at = EXCLUDED.approved_at;
  END IF;

  INSERT INTO public.admin_audit_log (
    admin_id, action, target_type, target_id, before, after, metadata
  ) VALUES (
    p_admin_id,
    CASE WHEN p_approve THEN 'approve'::public.audit_action_type
      ELSE 'reject'::public.audit_action_type END,
    'host_application',
    p_application_id,
    jsonb_build_object('status', v_application.status),
    jsonb_build_object('status', v_status, 'user_id', v_user.id),
    jsonb_build_object('review_note', v_note)
  );

  RETURN jsonb_build_object(
    'application_id', p_application_id,
    'user_id', v_user.id,
    'status', v_status
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_review_host_application(uuid, uuid, boolean, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_review_host_application(uuid, uuid, boolean, text)
  TO service_role;
