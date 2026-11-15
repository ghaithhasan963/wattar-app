-- ============================================================
-- patch_block_cleanup.sql — M1.7: تنظيف العلاقات عند الحظر
-- المرجع: المطلوب تماما .txt §23 («أنشئ قائمة حظر واضحة» + «يمنع الحظر التواصل»)
-- المشكلة قبل الإصلاح: block_wattar_user كان يلغي الطلبات المعلّقة والدعوات فقط،
--   فيبقى المحظور ظاهراً في «أصدقائي» ويبقى التابع/المتابَع متبادلاً.
-- الإصلاح: إلغاء الصداقة المقبولة أيضاً + حذف المتابعة في الاتجاهين.
--   (إلغاء الحظر لا يعيد الصداقة ولا المتابعة — سلوك متعارف عليه.)
-- الأثر: تحديث دالة واحدة. لا أعمدة ولا جداول.
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.wattar_patch_fn(
  p_name text,
  p_args text,
  p_mode text,      -- 'before' | 'after' | 'replace'
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
    RETURN 'ERROR: الدالة غير موجودة → ' || p_name;
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
  ELSIF p_mode = 'replace' THEN
    v_new := overlay(v_def PLACING p_inject FROM v_pos FOR length(p_anchor));
  ELSE
    RETURN 'ERROR: نمط غير معروف';
  END IF;

  EXECUTE v_new;
  RETURN 'OK';
END;
$fn$;

-- 1) إلغاء الصداقة المقبولة أيضاً، لا الطلبات المعلّقة فقط
DO $do$
DECLARE v_res text;
BEGIN
  v_res := pg_temp.wattar_patch_fn(
    'block_wattar_user',
    'p_user_id uuid',
    'replace',
    'WHERE status = ''pending''',
    'WHERE status IN (''pending'', ''accepted'')'
  );
  IF v_res <> 'OK' THEN RAISE EXCEPTION 'block_wattar_user (status): %', v_res; END IF;
END;
$do$;

-- 2) حذف المتابعة في الاتجاهين عند الحظر
DO $do$
DECLARE v_res text;
BEGIN
  v_res := pg_temp.wattar_patch_fn(
    'block_wattar_user',
    'p_user_id uuid',
    'before',
    'END;',
    $inj$  DELETE FROM public.user_follows
  WHERE (follower_id = auth.uid() AND followed_id = p_user_id)
     OR (follower_id = p_user_id AND followed_id = auth.uid());
$inj$
  );
  IF v_res <> 'OK' THEN RAISE EXCEPTION 'block_wattar_user (follows): %', v_res; END IF;
END;
$do$;

COMMIT;
