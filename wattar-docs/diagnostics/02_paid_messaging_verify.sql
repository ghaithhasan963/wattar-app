-- ============================================================================
-- Wattar — التحقق البعدي بعد تطبيق patch_paid_messaging.sql
-- ----------------------------------------------------------------------------
-- النوع: READ ONLY. شغّله بعد التطبيق مباشرة.
-- الملف فيه استعلامان:
--   ١) بنيوي كامل — آمن دائماً (لا يلمس جداول قد لا تكون موجودة).
--   ٢) تفاصيل المحتوى — شغّله فقط إذا كان الاستعلام ١ كله true.
-- في Supabase: حدّد نص الاستعلام المطلوب ثم Run.
-- ============================================================================


-- ============================================================================
-- الاستعلام ١ — الوجود والصلاحيات
-- ============================================================================
SELECT jsonb_pretty(jsonb_build_object(
  'tables_exist', jsonb_build_object(
    'host_program_members',      to_regclass('public.host_program_members')      IS NOT NULL,
    'private_message_settings',  to_regclass('public.private_message_settings')  IS NOT NULL,
    'host_intro_templates',      to_regclass('public.host_intro_templates')      IS NOT NULL,
    'host_outreach_deliveries',  to_regclass('public.host_outreach_deliveries')  IS NOT NULL
  ),

  'functions_exist', jsonb_build_object(
    'admin_get_private_message_settings',      to_regprocedure('public.admin_get_private_message_settings()') IS NOT NULL,
    'admin_update_private_message_settings',   to_regprocedure('public.admin_update_private_message_settings(integer,bigint,integer,integer,boolean)') IS NOT NULL,
    'admin_list_host_program_members',         to_regprocedure('public.admin_list_host_program_members()') IS NOT NULL,
    'admin_list_host_intro_templates',         to_regprocedure('public.admin_list_host_intro_templates()') IS NOT NULL,
    'admin_set_host_intro_template',           to_regprocedure('public.admin_set_host_intro_template(bigint,text,boolean)') IS NOT NULL,
    'admin_list_host_message_commissions',     to_regprocedure('public.admin_list_host_message_commissions()') IS NOT NULL,
    'is_wattar_host_program_member',           to_regprocedure('public.is_wattar_host_program_member(uuid)') IS NOT NULL,
    'admin_set_host_program_member',           to_regprocedure('public.admin_set_host_program_member(uuid,boolean,text)') IS NOT NULL,
    'set_my_host_outreach_preference',         to_regprocedure('public.set_my_host_outreach_preference(boolean)') IS NOT NULL,
    'get_my_host_outreach_preference',         to_regprocedure('public.get_my_host_outreach_preference()') IS NOT NULL,
    'get_private_message_quote',               to_regprocedure('public.get_private_message_quote(uuid)') IS NOT NULL,
    'send_host_intro_batch',                   to_regprocedure('public.send_host_intro_batch(integer)') IS NOT NULL,
    'send_private_message_4arg',               to_regprocedure('public.send_private_message(uuid,text,text,bigint)') IS NOT NULL,
    'create_private_conversation',             to_regprocedure('public.create_private_conversation(uuid)') IS NOT NULL,
    'list_private_messages',                   to_regprocedure('public.list_private_messages(uuid)') IS NOT NULL
  ),

  -- يجب أن تكون false: النسخة القديمة (٢ وسائط) يجب أن تختفي
  'old_send_private_message_2arg_still_exists',
    to_regprocedure('public.send_private_message(uuid,text)') IS NOT NULL,
  'old_send_private_message_3arg_still_exists',
    to_regprocedure('public.send_private_message(uuid,text,text)') IS NOT NULL,

  -- RLS مفعّل على الجداول الأربعة الجديدة
  'rls_enabled', COALESCE((
    SELECT jsonb_object_agg(c.relname, c.relrowsecurity)
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('host_program_members', 'private_message_settings',
                        'host_intro_templates', 'host_outreach_deliveries')
  ), '{}'::jsonb),

  -- يجب أن يكون ٠: الجداول الجديدة تُدار عبر RPC فقط
  'policy_count_on_new_tables', (
    SELECT count(*)
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    WHERE c.relname IN ('host_program_members', 'private_message_settings',
                        'host_intro_templates', 'host_outreach_deliveries')
  ),

  -- يجب أن يكون ٠: لا وصول مباشر لـauthenticated على الجداول الجديدة
  'direct_grants_to_authenticated', (
    SELECT count(*)
    FROM information_schema.role_table_grants
    WHERE grantee = 'authenticated'
      AND table_schema = 'public'
      AND table_name IN ('host_program_members', 'private_message_settings',
                         'host_intro_templates', 'host_outreach_deliveries')
  ),

  -- الدوال الجديدة يجب أن تكون SECURITY DEFINER (عدا المذكورة)
  'security_definer', COALESCE((
    SELECT jsonb_object_agg(p.proname, p.prosecdef)
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'admin_get_private_message_settings', 'admin_update_private_message_settings',
        'admin_list_host_program_members', 'admin_list_host_intro_templates',
        'admin_set_host_intro_template', 'admin_list_host_message_commissions',
        'is_wattar_host_program_member', 'admin_set_host_program_member',
        'set_my_host_outreach_preference', 'get_my_host_outreach_preference',
        'get_private_message_quote', 'send_host_intro_batch',
        'send_private_message', 'create_private_conversation', 'list_private_messages'
      )
  ), '{}'::jsonb),

  -- authenticated يجب أن يملك EXECUTE على الـ١٥ دالة
  'execute_grants_to_authenticated', COALESCE((
    SELECT jsonb_object_agg(p.proname, has_function_privilege('authenticated', p.oid, 'EXECUTE'))
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'admin_get_private_message_settings', 'admin_update_private_message_settings',
        'admin_list_host_program_members', 'admin_list_host_intro_templates',
        'admin_set_host_intro_template', 'admin_list_host_message_commissions',
        'is_wattar_host_program_member', 'admin_set_host_program_member',
        'set_my_host_outreach_preference', 'get_my_host_outreach_preference',
        'get_private_message_quote', 'send_host_intro_batch',
        'send_private_message', 'create_private_conversation', 'list_private_messages'
      )
  ), '{}'::jsonb),

  -- يجب أن تحتوي host_earning و support_reply
  'constraint_user_notifications_event_type',
    (SELECT pg_get_constraintdef(c.oid)
     FROM pg_constraint c
     WHERE c.conrelid = 'public.user_notifications'::regclass
       AND c.conname = 'user_notifications_event_type_check'),

  -- الأعمدة المضافة
  'private_messages_new_columns', COALESCE((
    SELECT jsonb_agg(column_name ORDER BY ordinal_position)
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'private_messages'
      AND column_name IN ('charged_coins', 'host_commission_diamonds',
                          'sender_is_host_at_send', 'idempotency_key')
  ), '[]'::jsonb),

  'users_new_column_exists', EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users'
      AND column_name = 'host_message_opt_out'
  ),

  'indexes', COALESCE((
    SELECT jsonb_agg(indexname)
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN ('idx_private_messages_idempotency',
                        'idx_host_program_members_status',
                        'idx_host_outreach_recipient_day')
  ), '[]'::jsonb),

  'seed_templates_count', (SELECT reltuples::bigint FROM pg_class WHERE oid = to_regclass('public.host_intro_templates'))
));


-- ============================================================================
-- الاستعلام ٢ — تفاصيل المحتوى (شغّله فقط إذا كان الاستعلام ١ صحيحاً كاملاً)
-- ============================================================================
-- SELECT jsonb_pretty(jsonb_build_object(
--   'templates_total',      (SELECT count(*) FROM public.host_intro_templates),
--   'templates_active',     (SELECT count(*) FROM public.host_intro_templates WHERE is_active),
--   'settings',             (SELECT to_jsonb(s) FROM public.private_message_settings s WHERE s.id),
--   'row_counts', jsonb_build_object(
--     'private_messages',      (SELECT count(*) FROM public.private_messages),
--     'private_conversations', (SELECT count(*) FROM public.private_conversations),
--     'user_notifications',    (SELECT count(*) FROM public.user_notifications),
--     'host_program_members',  (SELECT count(*) FROM public.host_program_members),
--     'host_outreach',         (SELECT count(*) FROM public.host_outreach_deliveries)
--   )
-- ));
