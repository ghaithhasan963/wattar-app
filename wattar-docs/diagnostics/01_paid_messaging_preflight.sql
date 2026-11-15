-- ============================================================================
-- Wattar — فحص تمهيدي قبل تطبيق patch_paid_messaging.sql
-- ----------------------------------------------------------------------------
-- النوع: READ ONLY — لا يكتب ولا يعدّل ولا يحذف أي شيء.
-- الاستخدام: Supabase → SQL Editor → الصق الملف كاملاً → Run → أرسل الناتج.
-- الغرض: إثبات أن كل متطلبات الـpatch موجودة فعلاً في قاعدة الإنتاج،
--        حتى لا يفشل التطبيق في منتصفه أو (الأسوأ) ينجح ويسبب سلوكاً غير متوقع.
-- ============================================================================

SELECT jsonb_pretty(jsonb_build_object(
  'checked_at', now(),
  'server_version', current_setting('server_version'),

  -- 1) قيم الـenum التي يحتاجها الـpatch
  'enum_wallet_tx_type',
    COALESCE((
      SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder)
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE n.nspname = 'public' AND t.typname = 'wallet_tx_type'
    ), '[]'::jsonb),

  'enum_audit_action_type',
    COALESCE((
      SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder)
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE n.nspname = 'public' AND t.typname = 'audit_action_type'
    ), '[]'::jsonb),

  -- يجب أن تكون [] — أي قيمة هنا تعني أن patch_paid_messaging_wallet_types.sql لم يُطبّق
  'missing_enum_values',
    COALESCE((
      SELECT jsonb_agg(v)
      FROM unnest(ARRAY['message_sent', 'message_commission']) AS v
      WHERE v NOT IN (
        SELECT e.enumlabel
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE n.nspname = 'public' AND t.typname = 'wallet_tx_type'
      )
    ), '[]'::jsonb),

  -- يجب أن تكون [] — أي جدول هنا يعني أن الـpatch طُبّق جزئياً سابقاً
  'new_tables_that_already_exist',
    COALESCE((
      SELECT jsonb_agg(t)
      FROM unnest(ARRAY[
        'host_program_members', 'private_message_settings',
        'host_intro_templates', 'host_outreach_deliveries'
      ]) AS t
      WHERE to_regclass('public.' || t) IS NOT NULL
    ), '[]'::jsonb),

  -- 2) الأعمدة التي سيضيفها الـpatch (يجب ألا تكون موجودة)
  'private_messages_columns',
    COALESCE((
      SELECT jsonb_agg(column_name ORDER BY ordinal_position)
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'private_messages'
    ), '[]'::jsonb),

  'users_critical_columns',
    COALESCE((
      SELECT jsonb_object_agg(column_name, data_type)
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users'
        AND column_name IN (
          'host_message_opt_out', 'status', 'role',
          'adult_confirmed_at', 'onboarding_completed_at',
          'balance_gold', 'balance_diamond'
        )
    ), '{}'::jsonb),

  -- 3) القيود التي يعتمد عليها الـpatch
  'constraint_user_notifications_event_type',
    (SELECT pg_get_constraintdef(c.oid)
     FROM pg_constraint c
     WHERE c.conrelid = 'public.user_notifications'::regclass
       AND c.conname = 'user_notifications_event_type_check'),

  'constraint_user_notifications_event_unique',
    (SELECT pg_get_constraintdef(c.oid)
     FROM pg_constraint c
     WHERE c.conrelid = 'public.user_notifications'::regclass
       AND c.conname = 'user_notifications_event_unique'),

  'event_types_in_use',
    COALESCE((SELECT jsonb_agg(DISTINCT event_type) FROM public.user_notifications), '[]'::jsonb),

  'constraint_private_conversation_unique_pair',
    (SELECT pg_get_constraintdef(c.oid)
     FROM pg_constraint c
     WHERE c.conrelid = 'public.private_conversations'::regclass
       AND c.conname = 'private_conversation_unique_pair'),

  -- 4) الدوال التي سيحذفها الـpatch ويعيد إنشاءها
  --    dependents > 0 تعني وجود كائن يعتمد عليها → الحذف سيفشل
  'functions_that_will_be_dropped',
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'signature', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
        'dependents', (SELECT count(*) FROM pg_depend d
                       WHERE d.refobjid = p.oid AND d.deptype IN ('n', 'a')),
        'acl', p.proacl::text
      ))
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('create_private_conversation', 'list_private_messages', 'send_private_message')
    ), '[]'::jsonb),

  -- 5) الدوال التي سينشئها الـpatch (يجب أن تكون [] الآن)
  'functions_to_be_created_already_exist',
    COALESCE((
      SELECT jsonb_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')')
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN (
          'admin_get_private_message_settings', 'admin_update_private_message_settings',
          'admin_list_host_program_members', 'admin_list_host_intro_templates',
          'admin_set_host_intro_template', 'admin_list_host_message_commissions',
          'is_wattar_host_program_member', 'admin_set_host_program_member',
          'set_my_host_outreach_preference', 'get_my_host_outreach_preference',
          'get_private_message_quote', 'send_host_intro_batch'
        )
    ), '[]'::jsonb),

  -- 6) تواقيع الدوال المساعدة التي يعتمد عليها الـpatch
  'record_wallet_transaction_signatures',
    COALESCE((
      SELECT jsonb_agg(pg_get_function_identity_arguments(p.oid))
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'record_wallet_transaction'
    ), '[]'::jsonb),

  'is_admin_present', to_regprocedure('public.is_admin()') IS NOT NULL,
  'is_wattar_blocked_between_present',
    to_regprocedure('public.is_wattar_blocked_between(uuid)') IS NOT NULL,
  'gen_random_uuid_present', to_regprocedure('gen_random_uuid()') IS NOT NULL,

  -- 7) حجم البيانات المتأثرة (للقياس قبل/بعد)
  'row_counts', jsonb_build_object(
    'private_messages', (SELECT count(*) FROM public.private_messages),
    'private_conversations', (SELECT count(*) FROM public.private_conversations),
    'user_notifications', (SELECT count(*) FROM public.user_notifications),
    'friend_requests_accepted',
      (SELECT count(*) FROM public.friend_requests WHERE status = 'accepted')
  ),

  -- 8) أعمدة الجداول التي يكتب فيها الـpatch
  'audit_log_columns',
    COALESCE((
      SELECT jsonb_object_agg(column_name, data_type)
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'admin_audit_log'
        AND column_name IN ('admin_id', 'action', 'target_type', 'target_id', 'before', 'after', 'metadata')
    ), '{}'::jsonb),

  'wallet_transactions_columns',
    COALESCE((
      SELECT jsonb_object_agg(column_name, data_type)
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'wallet_transactions'
        AND column_name IN ('type', 'currency', 'amount', 'user_id', 'idempotency_key',
                            'reference_id', 'reference_type', 'metadata', 'created_at')
    ), '{}'::jsonb),

  'user_notifications_columns',
    COALESCE((
      SELECT jsonb_object_agg(column_name, data_type)
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'user_notifications'
        AND column_name IN ('user_id', 'actor_id', 'event_type', 'reference_id',
                            'title', 'body', 'route', 'read_at', 'created_at')
    ), '{}'::jsonb)
));
