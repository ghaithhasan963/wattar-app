-- ============================================================
-- patch_privacy_view_info.sql — M1.6 (تكملة): فرض «من يستطيع رؤية معلوماتي»
-- المرجع: المطلوب تماما .txt §23
-- الطريقة: تعديل جراحي (overlay) لتعريف دالتين على الخادم.
--   wattar_can_view_profile ← تُضاف إليها بوّابة الخصوصية الجديدة، وهي البوّابة
--   التي يعتمد عليها get_wattar_profile و list_wattar_profile_posts وسياسة قراءة
--   صور الملف، فيسري الفرض على كل المسارات دفعة واحدة.
--   get_wattar_progress ← كانت تكرّر شرط الظهور يدوياً، فأُضيفت بوّابة الخصوصية.
-- الأثر: لا أعمدة ولا جداول. تحديث دالتين. معاملة واحدة؛ أي فشل = لا تطبيق.
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.wattar_patch_fn(
  p_name text,
  p_args text,
  p_mode text,
  p_anchor text,
  p_inject text
)
RETURNS text
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_def text;
  v_pos integer;
  v_count integer;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = p_name
    AND pg_get_function_identity_arguments(p.oid) = p_args;

  IF v_def IS NULL THEN
    RETURN 'ERROR: الدالة غير موجودة → ' || p_name || '(' || p_args || ')';
  END IF;

  v_count := (length(v_def) - length(replace(v_def, p_anchor, ''))) / length(p_anchor);
  IF v_count <> 1 THEN
    RETURN 'ERROR: عدد المراسي = ' || v_count || ' في ' || p_name;
  END IF;

  v_pos := position(p_anchor IN v_def);
  IF p_mode = 'before' THEN
    v_new := overlay(v_def PLACING p_inject FROM v_pos FOR 0);
  ELSIF p_mode = 'after' THEN
    v_new := overlay(v_def PLACING p_inject FROM v_pos + length(p_anchor) FOR 0);
  ELSE
    RETURN 'ERROR: نمط غير معروف';
  END IF;

  EXECUTE v_new;
  RETURN 'OK';
END;
$fn$;

-- ---------- 1) بوّابة عرض معلومات الملف ----------
DO $do$
DECLARE v_res text;
BEGIN
  v_res := pg_temp.wattar_patch_fn(
    'wattar_can_view_profile',
    'p_user_id uuid',
    'after',
    '        AND NOT public.is_wattar_blocked_between(profile.id)',
    $inj$
        AND public.check_privacy_permission(profile.id, 'view_info')
$inj$
  );
  IF v_res <> 'OK' THEN RAISE EXCEPTION 'wattar_can_view_profile: %', v_res; END IF;
END;
$do$;

-- ---------- 2) إحصاءات الملف ----------
DO $do$
DECLARE v_res text;
BEGIN
  v_res := pg_temp.wattar_patch_fn(
    'get_wattar_progress',
    'p_user_id uuid',
    'before',
    '  FROM public.users u',
    $inj$    AND public.wattar_can_view_profile(u.id)
$inj$
  );
  IF v_res <> 'OK' THEN RAISE EXCEPTION 'get_wattar_progress: %', v_res; END IF;
END;
$do$;

COMMIT;
