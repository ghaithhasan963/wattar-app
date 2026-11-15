-- ============================================================
-- patch_block_enhancements.sql — M1.7 الحظر + M1.6 الخصوصية (قصص/غرف/مراسلة)
-- المرجع: المطلوب تماما .txt §23
--   «يجب أن يمنع الحظر الشخصي التواصل ودخول الغرف وفق القواعد»
-- الطريقة: تعديل جراحي لتعريف الدوال على الخادم (overlay) بدل إعادة كتابتها،
--          حتى لا يُمس النص العربي ولا التواقيع ولا أنواع الإرجاع.
-- الأثر: لا أعمدة ولا جداول جديدة. تحديث 5 دوال فقط، داخل معاملة واحدة.
-- إذا لم يُعثر على المرساة (anchor) تُلغى المعاملة كلها ولا يُطبّق شيء.
-- ============================================================
BEGIN;

-- أداة مؤقتة: تُدخل نصاً في تعريف دالة موجودة عند مرساة فريدة ثم تعيد إنشاءها
CREATE OR REPLACE FUNCTION pg_temp.wattar_patch_fn(
  p_name text,
  p_args text,
  p_mode text,      -- 'before' | 'after'
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

-- ------------------------------------------------------------
-- 1) list_active_stories: استثناء قصص المحظورين + احترام خصوصية القصص
-- ------------------------------------------------------------
DO $do$
DECLARE v_res text;
BEGIN
  v_res := pg_temp.wattar_patch_fn(
    'list_active_stories',
    '',
    'before',
    '  ORDER BY s.created_at DESC',
    $inj$  AND NOT EXISTS (
    SELECT 1 FROM public.user_blocks b
    WHERE (b.blocker_id = auth.uid() AND b.blocked_id = s.user_id)
       OR (b.blocker_id = s.user_id AND b.blocked_id = auth.uid())
  )
  AND public.check_privacy_permission(s.user_id, 'view_stories')
$inj$
  );
  IF v_res <> 'OK' THEN RAISE EXCEPTION 'list_active_stories: %', v_res; END IF;
END;
$do$;

-- ------------------------------------------------------------
-- 2) wattar_can_read_story_object: لا يُقرأ ملف قصة محظور ولا مخفي خصوصيةً
-- ------------------------------------------------------------
DO $do$
DECLARE v_res text;
BEGIN
  v_res := pg_temp.wattar_patch_fn(
    'wattar_can_read_story_object',
    'p_path text',
    'after',
    '      AND u.adult_confirmed_at IS NOT NULL',
    $inj$
      AND NOT EXISTS (
        SELECT 1 FROM public.user_blocks b
        WHERE (b.blocker_id = auth.uid() AND b.blocked_id = s.user_id)
           OR (b.blocker_id = s.user_id AND b.blocked_id = auth.uid())
      )
      AND public.check_privacy_permission(s.user_id, 'view_stories')
$inj$
  );
  IF v_res <> 'OK' THEN RAISE EXCEPTION 'wattar_can_read_story_object: %', v_res; END IF;
END;
$do$;

-- ------------------------------------------------------------
-- 3) record_wattar_room_presence: منع دخول غرفة صاحبها محظور + احترام خصوصية الغرف
-- ------------------------------------------------------------
DO $do$
DECLARE v_res text;
BEGIN
  v_res := pg_temp.wattar_patch_fn(
    'record_wattar_room_presence',
    'p_room_id uuid, p_user_id uuid, p_session_id text, p_joining boolean',
    'before',
    '    IF v_is_private AND v_owner_id <> p_user_id AND NOT EXISTS (',
    $inj$    IF EXISTS (
      SELECT 1 FROM public.user_blocks b
      WHERE (b.blocker_id = p_user_id AND b.blocked_id = v_owner_id)
         OR (b.blocker_id = v_owner_id AND b.blocked_id = p_user_id)
    ) THEN
      RAISE EXCEPTION 'لا يمكنك دخول غرفة هذا المستخدم';
    END IF;
    IF v_owner_id <> p_user_id
       AND NOT public.check_privacy_permission(v_owner_id, 'enter_rooms', p_user_id) THEN
      RAISE EXCEPTION 'صاحب الغرفة لا يسمح لك بدخول غرفته';
    END IF;
$inj$
  );
  IF v_res <> 'OK' THEN RAISE EXCEPTION 'record_wattar_room_presence: %', v_res; END IF;
END;
$do$;

-- ------------------------------------------------------------
-- 4) get_private_message_quote: احترام خصوصية المراسلة (حتى لو المحادثة قائمة)
-- ------------------------------------------------------------
DO $do$
DECLARE v_res text;
BEGIN
  v_res := pg_temp.wattar_patch_fn(
    'get_private_message_quote',
    'p_conversation_id uuid',
    'before',
    '  SELECT * INTO v_settings FROM public.private_message_settings WHERE id = true;',
    $inj$  IF NOT public.check_privacy_permission(v_other_user, 'message') THEN
    RAISE EXCEPTION 'هذا المستخدم لا يسمح بالمراسلة إلا للأصدقاء';
  END IF;
$inj$
  );
  IF v_res <> 'OK' THEN RAISE EXCEPTION 'get_private_message_quote: %', v_res; END IF;
END;
$do$;

-- ------------------------------------------------------------
-- 5) send_private_message: احترام خصوصية المراسلة عند الإرسال الفعلي
-- ------------------------------------------------------------
DO $do$
DECLARE v_res text;
BEGIN
  v_res := pg_temp.wattar_patch_fn(
    'send_private_message',
    'p_conversation_id uuid, p_body text, p_idempotency_key text, p_confirmed_price_coin bigint',
    'before',
    '  PERFORM 1 FROM public.users',
    $inj$  IF NOT public.check_privacy_permission(v_other_user_id, 'message') THEN
    RAISE EXCEPTION 'هذا المستخدم لا يسمح بالمراسلة إلا للأصدقاء';
  END IF;
$inj$
  );
  IF v_res <> 'OK' THEN RAISE EXCEPTION 'send_private_message: %', v_res; END IF;
END;
$do$;

COMMIT;
