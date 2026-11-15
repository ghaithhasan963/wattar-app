-- ============================================================
-- patch_fix_audit_trigger_room_seats.sql — إصلاح عطل إنتاجي حقيقي
-- العَرَض: أي UPDATE على public.friend_requests يفشل بـ
--         ERROR 42703: record "old" has no field "user_id"
--         (CONTEXT: log_platform_activity_change line 11)
-- السبب: شرط فرع room_seats داخل سلسلة ELSIF يقرأ OLD.user_id قبل التأكد
--        أن الجدول هو room_seats. PostgreSQL لا يضمن ترتيب تقييم شروط AND،
--        فيُقيَّم OLD.user_id على صفوف friend_requests التي لا تملك هذا العمود.
-- الأثر على المستخدم: تعذّر قبول/رفض طلبات الصداقة، وتعذّر الحظر
--        (لأن block_wattar_user يُحدّث friend_requests).
-- الإصلاح: فصل الشرط إلى فحصين متتاليين مضمونَي الترتيب.
-- الأثر: تحديث دالة تريغر واحدة. لا بيانات ولا أعمدة.
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

-- جسم الدالة مخزّن بنهايات أسطر CRLF، لذا نبني المرساة بدقة عبر chr(13)||chr(10)
DO $do$
DECLARE
  v_res text;
  v_old text;
  v_new text;
  v_crlf text := chr(13) || chr(10);
BEGIN
  v_old := '  ELSIF TG_TABLE_NAME = ''room_seats'' AND TG_OP = ''UPDATE''' || v_crlf
        || '      AND OLD.user_id IS DISTINCT FROM NEW.user_id THEN';

  v_new := '  ELSIF TG_TABLE_NAME = ''room_seats'' THEN' || v_crlf
        || '    IF TG_OP <> ''UPDATE'' THEN' || v_crlf
        || '      RETURN NEW;' || v_crlf
        || '    END IF;' || v_crlf
        || '    IF OLD.user_id IS NOT DISTINCT FROM NEW.user_id THEN' || v_crlf
        || '      RETURN NEW;' || v_crlf
        || '    END IF;';

  v_res := pg_temp.wattar_patch_fn(
    'log_platform_activity_change',
    '',
    'replace',
    v_old,
    v_new
  );
  IF v_res <> 'OK' THEN RAISE EXCEPTION 'log_platform_activity_change: %', v_res; END IF;
END;
$do$;

COMMIT;
