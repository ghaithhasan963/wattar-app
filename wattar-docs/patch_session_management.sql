-- ============================================================
-- patch_session_management.sql — M1.5 إدارة الأجهزة والجلسات
-- القرار: المدير 2026-11-14 — الحسابات تجريبية، ولا نسخة احتياطية مطلوبة.
-- الأثر: إضافات فقط (عمود + دوال). لا حذف ولا تعديل بيانات.
-- المرجع: المطلوب تماما .txt §7 (إدارة الأجهزة والجلسات)
-- ============================================================
BEGIN;

-- 1) عمود معرّف الجهاز (يولّده التطبيق ويخزنه محلياً ليبقى ثابتاً لكل تثبيت)
ALTER TABLE public.user_sessions
  ADD COLUMN IF NOT EXISTS device_id varchar(64);

CREATE UNIQUE INDEX IF NOT EXISTS user_sessions_user_device_unique
  ON public.user_sessions (user_id, device_id)
  WHERE device_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_active
  ON public.user_sessions (user_id, is_active, last_used_at DESC);

-- 2) تسجيل الجلسة عند الدخول: يحفظ الجهاز فعلياً (كان يكتفي بسجل النشاط)
DROP FUNCTION IF EXISTS public.record_my_session_started();

CREATE OR REPLACE FUNCTION public.record_my_session_started(
  p_device_id text DEFAULT NULL,
  p_device_info jsonb DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_info jsonb := coalesce(p_device_info, '{}'::jsonb);
  v_ua text := p_user_agent;
  v_ip inet := NULL;
BEGIN
  IF v_uid IS NULL OR auth.role() <> 'authenticated' THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول';
  END IF;

  BEGIN
    v_ip := nullif(auth.jwt() ->> 'ip_address', '')::inet;
  EXCEPTION WHEN others THEN
    v_ip := NULL;
  END;

  INSERT INTO public.platform_activity_log (event_type, actor_user_id, source)
  SELECT 'session_started', u.id, 'account'
  FROM public.users u
  WHERE u.id = v_uid AND u.status = 'active';

  INSERT INTO public.user_sessions
    (user_id, device_id, device_info, user_agent, ip_address, is_active, last_used_at)
  VALUES
    (v_uid, p_device_id, v_info, v_ua, v_ip, true, now())
  ON CONFLICT (user_id, device_id) WHERE device_id IS NOT NULL
  DO UPDATE SET
    device_info = excluded.device_info,
    user_agent = excluded.user_agent,
    ip_address = excluded.ip_address,
    is_active = true,
    last_used_at = now();
END;
$$;

-- 3) عرض جلسات المستخدم الحالية
CREATE OR REPLACE FUNCTION public.list_my_sessions()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR auth.role() <> 'authenticated' THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول';
  END IF;

  RETURN coalesce((
    SELECT jsonb_agg(row_to_json(t) ORDER BY t.last_used_at DESC NULLS LAST)
    FROM (
      SELECT id, device_id, device_info, user_agent, ip_address,
             is_active, created_at, last_used_at
      FROM public.user_sessions
      WHERE user_id = v_uid
    ) t
  ), '[]'::jsonb);
END;
$$;

-- 4) إنهاء كل الجلسات المسجلة عدا هذا الجهاز
--    القراءة الحقيقية للجلسات تمر من GoTrue عبر signOut({scope:'others'})؛
--    هذه الدالة تُبقي سجلنا المحلي متطابقاً معه.
CREATE OR REPLACE FUNCTION public.revoke_all_my_sessions(p_keep_device_id text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_count integer := 0;
BEGIN
  IF v_uid IS NULL OR auth.role() <> 'authenticated' THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول';
  END IF;

  UPDATE public.user_sessions
  SET is_active = false
  WHERE user_id = v_uid
    AND is_active
    AND (p_keep_device_id IS NULL OR device_id IS DISTINCT FROM p_keep_device_id);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.record_my_session_started(text, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_my_sessions() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_all_my_sessions(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_my_session_started(text, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_sessions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_all_my_sessions(text) TO authenticated;

COMMIT;
