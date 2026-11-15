-- ============================================================
-- patch_fix_event_notification_trigger.sql — إصلاح عطل إنتاجي ثانٍ
-- العَرَض: أي INSERT على public.user_follows يفشل بـ
--         ERROR 42703: record "new" has no field "status"
--         (CONTEXT: create_wattar_event_notification line 12)
-- السبب: سلسلة ELSIF تفحص الجدول وشروطاً على NEW/OLD في نفس الشرط،
--        مثل:  ELSIF TG_TABLE_NAME = 'room_invitations' AND TG_OP='INSERT'
--                  AND NEW.status = 'pending' THEN
--        وPostgreSQL لا يضمن ترتيب تقييم شروط AND، فيُقيَّم NEW.status
--        على صفوف user_follows التي لا تملك عمود status.
--        نفس الخطر في فروع deposits / diamond_withdrawals / host_applications
--        (OLD.status)، وفي فرع verified_hosts (OLD.approved_by داخل CASE).
-- الأثر على المستخدم: تعذّر المتابعة، وتتبّع الإشعارات.
-- الإصلاح: كل فرع يُفحص أولاً بالجدول فقط، ثم يُفحص شرط العملية والحقول
--        داخل بلوك متداخل، فلا يُقرأ NEW/OLD إلا من الجدول الصحيح.
-- الأثر: تحديث دالة تريغر واحدة. لا بيانات ولا أعمدة ولا تواقيع.
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

-- ملاحظة: جسم الدالة مخزّن بـ CRLF، لذا تُبنى المراسي عبر chr(13)||chr(10)
DO $do$
DECLARE
  v_res text;
  v_old text;
  v_new text;
  c text := chr(13) || chr(10);
BEGIN
  -- ---------- 1) room_invitations ----------
  v_old := '  ELSIF TG_TABLE_NAME = ''room_invitations'' AND TG_OP = ''INSERT''' || c
        || '      AND NEW.status = ''pending'' THEN';
  v_new := '  ELSIF TG_TABLE_NAME = ''room_invitations'' THEN' || c
        || '    IF NOT (TG_OP = ''INSERT'' AND NEW.status = ''pending'') THEN' || c
        || '      RETURN NEW;' || c
        || '    END IF;';
  v_res := pg_temp.wattar_patch_fn('create_wattar_event_notification', '', 'replace', v_old, v_new);
  IF v_res <> 'OK' THEN RAISE EXCEPTION 'room_invitations: %', v_res; END IF;

  -- ---------- 2) deposits ----------
  v_old := '  ELSIF TG_TABLE_NAME = ''deposits'' AND TG_OP = ''UPDATE''' || c
        || '      AND OLD.status IS DISTINCT FROM NEW.status THEN';
  v_new := '  ELSIF TG_TABLE_NAME = ''deposits'' THEN' || c
        || '    IF NOT (TG_OP = ''UPDATE'' AND OLD.status IS DISTINCT FROM NEW.status) THEN' || c
        || '      RETURN NEW;' || c
        || '    END IF;';
  v_res := pg_temp.wattar_patch_fn('create_wattar_event_notification', '', 'replace', v_old, v_new);
  IF v_res <> 'OK' THEN RAISE EXCEPTION 'deposits: %', v_res; END IF;

  -- ---------- 3) diamond_withdrawals ----------
  v_old := '  ELSIF TG_TABLE_NAME = ''diamond_withdrawals'' AND TG_OP = ''UPDATE''' || c
        || '      AND OLD.status IS DISTINCT FROM NEW.status THEN';
  v_new := '  ELSIF TG_TABLE_NAME = ''diamond_withdrawals'' THEN' || c
        || '    IF NOT (TG_OP = ''UPDATE'' AND OLD.status IS DISTINCT FROM NEW.status) THEN' || c
        || '      RETURN NEW;' || c
        || '    END IF;';
  v_res := pg_temp.wattar_patch_fn('create_wattar_event_notification', '', 'replace', v_old, v_new);
  IF v_res <> 'OK' THEN RAISE EXCEPTION 'diamond_withdrawals: %', v_res; END IF;

  -- ---------- 4) host_applications ----------
  v_old := '  ELSIF TG_TABLE_NAME = ''host_applications'' AND TG_OP = ''UPDATE''' || c
        || '      AND OLD.status IS DISTINCT FROM NEW.status AND NEW.status = ''rejected'' THEN';
  v_new := '  ELSIF TG_TABLE_NAME = ''host_applications'' THEN' || c
        || '    IF NOT (TG_OP = ''UPDATE'' AND OLD.status IS DISTINCT FROM NEW.status' || c
        || '            AND NEW.status = ''rejected'') THEN' || c
        || '      RETURN NEW;' || c
        || '    END IF;';
  v_res := pg_temp.wattar_patch_fn('create_wattar_event_notification', '', 'replace', v_old, v_new);
  IF v_res <> 'OK' THEN RAISE EXCEPTION 'host_applications: %', v_res; END IF;

  -- ---------- 5) verified_hosts: OLD.approved_by داخل CASE ----------
  v_old := '    v_actor_id := CASE' || c
        || '      WHEN TG_OP = ''INSERT'' OR OLD.approved_by IS DISTINCT FROM NEW.approved_by' || c
        || '      THEN NEW.approved_by' || c
        || '      ELSE NULL' || c
        || '    END;';
  v_new := '    IF TG_OP = ''INSERT'' THEN' || c
        || '      v_actor_id := NEW.approved_by;' || c
        || '    ELSIF TG_OP = ''UPDATE'' THEN' || c
        || '      IF OLD.approved_by IS DISTINCT FROM NEW.approved_by THEN' || c
        || '        v_actor_id := NEW.approved_by;' || c
        || '      ELSE' || c
        || '        v_actor_id := NULL;' || c
        || '      END IF;' || c
        || '    ELSE' || c
        || '      v_actor_id := NULL;' || c
        || '    END IF;';
  v_res := pg_temp.wattar_patch_fn('create_wattar_event_notification', '', 'replace', v_old, v_new);
  IF v_res <> 'OK' THEN RAISE EXCEPTION 'verified_hosts: %', v_res; END IF;
END;
$do$;

COMMIT;
