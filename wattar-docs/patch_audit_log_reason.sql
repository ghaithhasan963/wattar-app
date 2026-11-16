-- ============================================================
-- patch #51 — M2.6 سجل التدقيق: سبب التغيير + إلحاق فقط (§24)
-- التاريخ: 2026-11-16
-- المتطلبات (المطلوب تماما .txt §24 سطر 1161–1174):
--   كل تغيير إداري يسجّل: المسؤول، نوع العملية، العنصر، القيمة قبل/بعد،
--   الوقت، سبب التغيير، IP/جلسة — ولا حذف للسجل من الواجهة العادية.
-- المكوّنات:
--   51.1 عمود reason في admin_audit_log
--   51.2 تعبئة رجعية من metadata التاريخية (قبل تفعيل الإلحاق فقط)
--   51.3 زناد BEFORE INSERT يستخرج السبب من metadata (يغطي كل دوال RPC الموجودة)
--   51.4 منع التعديل/الحذف/التفريغ: زناد + REVOKE من anon/authenticated/service_role
--   51.5 audit_admin_row_change v2: يلتقط سبب التعديلات المباشرة من ترويسة x-audit-reason
--   51.6 ست دوال إدارية تفتقر لباراميتر السبب: DROP+CREATE بـ p_reason ذيلي افتراضي
--        (متوافق مع كل المستدعين الحاليين — الاستدعاء بدونه يعمل كما هو)
-- ============================================================

-- ------------------------------------------------------------
-- 51.1) عمود السبب
-- ------------------------------------------------------------
ALTER TABLE public.admin_audit_log
  ADD COLUMN IF NOT EXISTS reason text;

COMMENT ON COLUMN public.admin_audit_log.reason IS
  'سبب التغيير الإداري (§24): من باراميتر p_reason أو ترويسة x-audit-reason أو metadata التاريخية';

-- ------------------------------------------------------------
-- 51.2) تعبئة رجعية من metadata (يجب أن تسبق تفعيل الإلحاق فقط)
-- ------------------------------------------------------------
UPDATE public.admin_audit_log
SET reason = left(
  coalesce(
    btrim(coalesce(metadata->>'reason', '')),
    btrim(coalesce(metadata->>'review_note', '')),
    btrim(coalesce(metadata->>'note', '')),
    btrim(coalesce(metadata->>'notes', ''))
  ),
  500
)
WHERE reason IS NULL
  AND metadata IS NOT NULL
  AND metadata ?| array['reason', 'review_note', 'note', 'notes'];

-- ------------------------------------------------------------
-- 51.3) زناد استخراج السبب من metadata عند الإدراج
-- يغطي تلقائياً كل دوال RPC الإدارية الـ17 التي تكتب reason/note داخل
-- metadata دون الحاجة لإعادة كتابة أجسامها، وأي إدراج مستقبلي مشابه.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_audit_reason_from_metadata()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $function$
DECLARE
  v_reason text;
BEGIN
  IF NEW.reason IS NULL THEN
    v_reason := coalesce(
      coalesce(NEW.metadata, '{}'::jsonb) ->> 'reason',
      coalesce(NEW.metadata, '{}'::jsonb) ->> 'review_note',
      coalesce(NEW.metadata, '{}'::jsonb) ->> 'note',
      coalesce(NEW.metadata, '{}'::jsonb) ->> 'notes'
    );
    NEW.reason := nullif(left(btrim(coalesce(v_reason, '')), 500), '');
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_audit_reason_from_metadata()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS audit_reason_extract ON public.admin_audit_log;
CREATE TRIGGER audit_reason_extract
  BEFORE INSERT ON public.admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.set_audit_reason_from_metadata();

-- ------------------------------------------------------------
-- 51.4) السجل للإضافة فقط: لا تعديل ولا حذف ولا تفريغ
-- §24: "لا تسمح بحذف سجل التدقيق من الواجهة العادية".
-- الطوارئ الموثقة فقط: ALTER TABLE ... DISABLE TRIGGER بواسطة مالك الجدول.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reject_audit_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION
    'AUDIT_LOG_APPEND_ONLY: سجل التدقيق للإضافة فقط — لا يجوز التعديل أو الحذف (§24)';
END;
$function$;

REVOKE ALL ON FUNCTION public.reject_audit_log_mutation()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS admin_audit_log_append_only ON public.admin_audit_log;
CREATE TRIGGER admin_audit_log_append_only
  BEFORE UPDATE OR DELETE ON public.admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.reject_audit_log_mutation();

DROP TRIGGER IF EXISTS admin_audit_log_no_truncate ON public.admin_audit_log;
CREATE TRIGGER admin_audit_log_no_truncate
  BEFORE TRUNCATE ON public.admin_audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION public.reject_audit_log_mutation();

-- سحب صلاحيات التعديل/الحذف/التفريغ صراحةً (حتى مع مفتاح service_role)
REVOKE UPDATE, DELETE, TRUNCATE ON public.admin_audit_log
  FROM anon, authenticated, service_role;

-- ------------------------------------------------------------
-- 51.5) audit_admin_row_change v2 — التقاط سبب التعديلات المباشرة
-- مسار التعديل المباشر على الجداول الستة (admin_settings/daily_missions/
-- deposit_methods/game_configs/gifts/rooms) يقرأ السبب من ترويسة الطلب
-- x-audit-reason كما يعرضها PostgREST عبر current_setting (قيمة JSON
-- مقتبسة)؛ دعم بديل بترويسة x_audit_reason.
-- ------------------------------------------------------------
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
  -- (أسماء GUC المخصصة لا تقبل الشرطة — طُبّع في patch_audit_log_reason_fix.sql)
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

-- ------------------------------------------------------------
-- 51.6) الدوال الإدارية الست التي بلا باراميتر سبب:
-- إضافة p_reason text DEFAULT NULL (باراميتر ذيلي افتراضي — كل المستدعين
-- الحاليين يعملون دون تغيير) + تسجيله في metadata ليستخرجه زناد 51.3.
-- DROP ثم CREATE لتفادي تعدد التحميلات (signature جديد).
-- ------------------------------------------------------------

-- أ) إضافة/تحديث كلمة في قوائم الإشراف
DROP FUNCTION IF EXISTS public.admin_upsert_moderation_word(uuid, text, text, text, uuid, boolean);

CREATE OR REPLACE FUNCTION public.admin_upsert_moderation_word(
  p_admin_id uuid,
  p_list_type text,
  p_word text,
  p_severity text DEFAULT 'medium',
  p_room_id uuid DEFAULT NULL,
  p_is_active boolean DEFAULT true,
  p_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $function$
DECLARE
  v_admin public.users%ROWTYPE;
  v_word text := btrim(coalesce(p_word, ''));
  v_severity text := coalesce(NULLIF(btrim(p_severity), ''), 'medium');
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 500), '');
  v_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'غير مصرح بتنفيذ الإجراء الإداري';
  END IF;
  IF p_list_type NOT IN ('forbidden', 'allowed') THEN
    RAISE EXCEPTION 'نوع القائمة غير صالح';
  END IF;
  IF length(v_word) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'الكلمة يجب أن تكون بين 1 و120 حرف';
  END IF;
  IF v_severity NOT IN ('low', 'medium', 'high') THEN
    RAISE EXCEPTION 'الخطورة غير صالحة';
  END IF;
  IF p_room_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.rooms WHERE id = p_room_id) THEN
    RAISE EXCEPTION 'الغرفة غير موجودة';
  END IF;
  IF p_list_type = 'allowed' THEN
    v_severity := 'low';
  END IF;

  SELECT * INTO v_admin FROM public.users WHERE id = p_admin_id FOR SHARE;
  IF NOT FOUND OR v_admin.status <> 'active'
     OR v_admin.role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'لا تملك صلاحية تنفيذ هذا الإجراء';
  END IF;

  INSERT INTO public.moderation_words (list_type, word, severity, room_id, is_active, created_by)
  VALUES (p_list_type, v_word, v_severity, p_room_id, p_is_active, p_admin_id)
  ON CONFLICT (list_type, word, scope_key) DO UPDATE
    SET severity = EXCLUDED.severity,
        is_active = EXCLUDED.is_active
  RETURNING id INTO v_id;

  INSERT INTO public.admin_audit_log (
    admin_id, action, target_type, target_id, before, after, metadata
  ) VALUES (
    p_admin_id, 'update'::public.audit_action_type, 'moderation_word', v_id,
    NULL,
    jsonb_build_object('list_type', p_list_type, 'word', v_word,
      'severity', v_severity, 'room_id', p_room_id, 'is_active', p_is_active),
    jsonb_build_object('upsert', true, 'reason', v_reason)
  );

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_upsert_moderation_word(uuid, text, text, text, uuid, boolean, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_upsert_moderation_word(uuid, text, text, text, uuid, boolean, text)
  TO service_role;

-- ب) حذف كلمة من القوائم
DROP FUNCTION IF EXISTS public.admin_delete_moderation_word(uuid, uuid);

CREATE OR REPLACE FUNCTION public.admin_delete_moderation_word(
  p_admin_id uuid,
  p_word_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $function$
DECLARE
  v_admin public.users%ROWTYPE;
  v_word public.moderation_words%ROWTYPE;
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 500), '');
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'غير مصرح بتنفيذ الإجراء الإداري';
  END IF;

  SELECT * INTO v_admin FROM public.users WHERE id = p_admin_id FOR SHARE;
  IF NOT FOUND OR v_admin.status <> 'active'
     OR v_admin.role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'لا تملك صلاحية تنفيذ هذا الإجراء';
  END IF;

  SELECT * INTO v_word FROM public.moderation_words WHERE id = p_word_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الكلمة غير موجودة';
  END IF;

  DELETE FROM public.moderation_words WHERE id = p_word_id;

  INSERT INTO public.admin_audit_log (
    admin_id, action, target_type, target_id, before, after, metadata
  ) VALUES (
    p_admin_id, 'delete'::public.audit_action_type, 'moderation_word', p_word_id,
    jsonb_build_object('list_type', v_word.list_type, 'word', v_word.word, 'room_id', v_word.room_id),
    NULL,
    jsonb_build_object('deleted', true, 'reason', v_reason)
  );

  RETURN jsonb_build_object('deleted', true, 'word_id', p_word_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_delete_moderation_word(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_moderation_word(uuid, uuid, text)
  TO service_role;

-- ج) تحديث إعدادات الإشراف
DROP FUNCTION IF EXISTS public.admin_update_moderation_settings(uuid, jsonb);

CREATE OR REPLACE FUNCTION public.admin_update_moderation_settings(
  p_admin_id uuid,
  p_settings jsonb,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $function$
DECLARE
  v_admin public.users%ROWTYPE;
  v_current public.moderation_settings%ROWTYPE;
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 500), '');
  v_keys text[] := array[
    'filter_enabled', 'warnings_before_mute', 'mute_default_minutes',
    'violations_before_temp_ban', 'temp_ban_default_hours',
    'violations_before_permanent_ban', 'violation_counting_window_days'
  ];
  v_key text;
  v_value jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'غير مصرح بتنفيذ الإجراء الإداري';
  END IF;
  IF p_settings IS NULL OR p_settings = '{}'::jsonb THEN
    RAISE EXCEPTION 'لا توجد إعدادات للتحديث';
  END IF;

  SELECT * INTO v_admin FROM public.users WHERE id = p_admin_id FOR SHARE;
  IF NOT FOUND OR v_admin.status <> 'active'
     OR v_admin.role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'لا تملك صلاحية تنفيذ هذا الإجراء';
  END IF;

  FOREACH v_key IN ARRAY v_keys LOOP
    v_value := p_settings -> v_key;
    CONTINUE WHEN v_value IS NULL;
    IF v_key = 'filter_enabled' THEN
      IF jsonb_typeof(v_value) <> 'boolean' THEN
        RAISE EXCEPTION 'قيمة filter_enabled يجب أن تكون منطقية';
      END IF;
    ELSE
      IF jsonb_typeof(v_value) <> 'number' OR (v_value ->> 0) !~ '^[0-9]+$' THEN
        RAISE EXCEPTION 'قيمة % يجب أن تكون عدداً صحيحاً موجباً', v_key;
      END IF;
    END IF;
  END LOOP;

  SELECT * INTO v_current FROM public.moderation_settings WHERE id FOR UPDATE;

  UPDATE public.moderation_settings
  SET filter_enabled = coalesce((p_settings ->> 'filter_enabled')::boolean, filter_enabled),
      warnings_before_mute = coalesce((p_settings ->> 'warnings_before_mute')::integer, warnings_before_mute),
      mute_default_minutes = coalesce((p_settings ->> 'mute_default_minutes')::integer, mute_default_minutes),
      violations_before_temp_ban = coalesce((p_settings ->> 'violations_before_temp_ban')::integer, violations_before_temp_ban),
      temp_ban_default_hours = coalesce((p_settings ->> 'temp_ban_default_hours')::integer, temp_ban_default_hours),
      violations_before_permanent_ban = coalesce((p_settings ->> 'violations_before_permanent_ban')::integer, violations_before_permanent_ban),
      violation_counting_window_days = coalesce((p_settings ->> 'violation_counting_window_days')::integer, violation_counting_window_days),
      updated_by = p_admin_id,
      updated_at = now()
  WHERE id;

  INSERT INTO public.admin_audit_log (
    admin_id, action, target_type, target_id, before, after, metadata
  ) VALUES (
    p_admin_id, 'update'::public.audit_action_type, 'moderation_settings', NULL,
    to_jsonb(v_current) - 'id',
    p_settings,
    jsonb_build_object('settings_update', true, 'reason', v_reason)
  );

  RETURN (SELECT to_jsonb(s) - 'id' FROM public.moderation_settings s WHERE s.id);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_update_moderation_settings(uuid, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_moderation_settings(uuid, jsonb, text)
  TO service_role;

-- د) إعدادات الرسائل المدفوعة (تستدعى مباشرة من لوحة الإدارة بجلسة authenticated)
DROP FUNCTION IF EXISTS public.admin_update_private_message_settings(integer, bigint, integer, integer, boolean);

CREATE OR REPLACE FUNCTION public.admin_update_private_message_settings(
  p_free_message_limit integer,
  p_price_coin bigint,
  p_host_commission_percent integer,
  p_host_intro_daily_limit integer,
  p_host_outreach_enabled boolean,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_before public.private_message_settings%ROWTYPE;
  v_after public.private_message_settings%ROWTYPE;
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 500), '');
BEGIN
  IF v_admin_id IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'غير مصرح بتعديل إعدادات الرسائل';
  END IF;
  IF p_free_message_limit IS NULL OR p_free_message_limit NOT BETWEEN 0 AND 100
     OR p_price_coin IS NULL OR p_price_coin NOT BETWEEN 1 AND 1000000
     OR p_host_commission_percent IS NULL OR p_host_commission_percent NOT BETWEEN 0 AND 100
     OR p_host_intro_daily_limit IS NULL OR p_host_intro_daily_limit NOT BETWEEN 0 AND 10
     OR p_host_outreach_enabled IS NULL THEN
    RAISE EXCEPTION 'إعدادات الرسائل خارج الحدود المسموحة';
  END IF;

  SELECT * INTO v_before
  FROM public.private_message_settings
  WHERE id = true
  FOR UPDATE;

  UPDATE public.private_message_settings
  SET free_message_limit = p_free_message_limit,
      price_coin = p_price_coin,
      host_commission_percent = p_host_commission_percent,
      host_intro_daily_limit = p_host_intro_daily_limit,
      host_outreach_enabled = p_host_outreach_enabled,
      updated_by = v_admin_id,
      updated_at = now()
  WHERE id = true
  RETURNING * INTO v_after;

  INSERT INTO public.admin_audit_log (
    admin_id, action, target_type, target_id, before, after, metadata
  ) VALUES (
    v_admin_id, 'update'::public.audit_action_type, 'private_message_settings',
    NULL, to_jsonb(v_before), to_jsonb(v_after),
    jsonb_build_object('source', 'messaging_admin', 'reason', v_reason)
  );
  RETURN to_jsonb(v_after);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_private_message_settings(integer, bigint, integer, integer, boolean, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_private_message_settings(integer, bigint, integer, integer, boolean, text)
  TO authenticated, service_role;

-- هـ) مكتبة افتتاحيات المضيفات (تستدعى مباشرة من لوحة الإدارة)
DROP FUNCTION IF EXISTS public.admin_set_host_intro_template(bigint, text, boolean);

CREATE OR REPLACE FUNCTION public.admin_set_host_intro_template(
  p_template_id bigint,
  p_body text,
  p_is_active boolean,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_before public.host_intro_templates%ROWTYPE;
  v_after public.host_intro_templates%ROWTYPE;
  v_body text := nullif(btrim(p_body), '');
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 500), '');
BEGIN
  IF v_admin_id IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'غير مصرح بإدارة مكتبة الافتتاحيات';
  END IF;
  IF char_length(coalesce(v_body, '')) NOT BETWEEN 1 AND 500 OR p_is_active IS NULL THEN
    RAISE EXCEPTION 'نص الافتتاحية أو حالتها غير صالح';
  END IF;

  IF p_template_id IS NULL THEN
    INSERT INTO public.host_intro_templates (body, is_active)
    VALUES (v_body, p_is_active)
    RETURNING * INTO v_after;
  ELSE
    SELECT * INTO v_before FROM public.host_intro_templates
    WHERE id = p_template_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'الافتتاحية غير موجودة'; END IF;
    UPDATE public.host_intro_templates
    SET body = v_body, is_active = p_is_active
    WHERE id = p_template_id
    RETURNING * INTO v_after;
  END IF;

  INSERT INTO public.admin_audit_log (
    admin_id, action, target_type, before, after, metadata
  ) VALUES (
    v_admin_id,
    CASE WHEN p_template_id IS NULL THEN 'create'::public.audit_action_type
      ELSE 'update'::public.audit_action_type END,
    'host_intro_template',
    CASE WHEN p_template_id IS NULL THEN NULL ELSE to_jsonb(v_before) END,
    to_jsonb(v_after),
    jsonb_build_object('template_id', v_after.id, 'reason', v_reason)
  );
  RETURN to_jsonb(v_after);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_host_intro_template(bigint, text, boolean, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_host_intro_template(bigint, text, boolean, text)
  TO authenticated, service_role;

-- و) خطط العضويات (تستدعى مباشرة من لوحة الإدارة)
DROP FUNCTION IF EXISTS public.admin_upsert_membership_plan(uuid, text, text, integer, bigint, integer, boolean);

CREATE OR REPLACE FUNCTION public.admin_upsert_membership_plan(
  p_plan_id uuid,
  p_name text,
  p_name_ar text,
  p_duration_days integer,
  p_price_coins bigint,
  p_xp_boost integer,
  p_is_active boolean,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_before public.membership_plans%ROWTYPE;
  v_plan public.membership_plans%ROWTYPE;
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 500), '');
BEGIN
  IF v_admin_id IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 2 AND 80
     OR p_name_ar IS NULL OR char_length(btrim(p_name_ar)) NOT BETWEEN 2 AND 80
     OR p_duration_days NOT BETWEEN 1 AND 365
     OR p_price_coins NOT BETWEEN 1 AND 10000000
     OR p_xp_boost NOT BETWEEN 0 AND 250
     OR p_is_active IS NULL THEN
    RAISE EXCEPTION 'Invalid membership plan';
  END IF;

  IF p_plan_id IS NULL THEN
    INSERT INTO public.membership_plans (
      name, name_ar, duration_days, price_coins, xp_boost, is_active
    ) VALUES (
      btrim(p_name), btrim(p_name_ar), p_duration_days, p_price_coins, p_xp_boost, p_is_active
    ) RETURNING * INTO v_plan;
  ELSE
    SELECT * INTO v_before
    FROM public.membership_plans
    WHERE id = p_plan_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Membership plan not found'; END IF;

    UPDATE public.membership_plans
    SET name = btrim(p_name),
        name_ar = btrim(p_name_ar),
        duration_days = p_duration_days,
        price_coins = p_price_coins,
        xp_boost = p_xp_boost,
        is_active = p_is_active,
        updated_at = now()
    WHERE id = p_plan_id
    RETURNING * INTO v_plan;
  END IF;

  INSERT INTO public.admin_audit_log (
    admin_id, action, target_type, target_id, before, after, metadata
  ) VALUES (
    v_admin_id,
    CASE WHEN p_plan_id IS NULL THEN 'create'::public.audit_action_type
         ELSE 'update'::public.audit_action_type END,
    'membership_plan',
    v_plan.id,
    CASE WHEN p_plan_id IS NULL THEN NULL ELSE to_jsonb(v_before) END,
    to_jsonb(v_plan),
    jsonb_build_object('source', 'membership_admin', 'reason', v_reason)
  );

  RETURN to_jsonb(v_plan);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_upsert_membership_plan(uuid, text, text, integer, bigint, integer, boolean, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_upsert_membership_plan(uuid, text, text, integer, bigint, integer, boolean, text)
  TO authenticated, service_role;
