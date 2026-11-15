-- ============================================================
-- diagnostics/03_block_privacy_verify.sql
-- تحقق قراءة فقط بعد تطبيق patch_block_enhancements.sql (M1.6 + M1.7)
-- ============================================================
WITH f AS (
  SELECT p.proname,
         pg_get_function_identity_arguments(p.oid) AS args,
         pg_get_function_result(p.oid) AS result,
         p.prosrc
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'list_active_stories',
      'wattar_can_read_story_object',
      'record_wattar_room_presence',
      'get_private_message_quote',
      'send_private_message',
      'follow_wattar_user',
      'send_friend_request',
      'create_private_conversation',
      'check_privacy_permission'
    )
)
SELECT
  count(*) AS functions_found,
  bool_and(
    CASE proname
      WHEN 'list_active_stories'          THEN prosrc LIKE '%user_blocks%' AND prosrc LIKE '%view_stories%'
      WHEN 'wattar_can_read_story_object' THEN prosrc LIKE '%user_blocks%' AND prosrc LIKE '%view_stories%'
      WHEN 'record_wattar_room_presence'  THEN prosrc LIKE '%user_blocks%' AND prosrc LIKE '%enter_rooms%'
      WHEN 'get_private_message_quote'    THEN prosrc LIKE '%check_privacy_permission%'
      WHEN 'send_private_message'         THEN prosrc LIKE '%check_privacy_permission%'
      WHEN 'follow_wattar_user'           THEN prosrc LIKE '%check_privacy_permission%'
      WHEN 'send_friend_request'          THEN prosrc LIKE '%check_privacy_permission%'
      WHEN 'create_private_conversation'  THEN prosrc LIKE '%check_privacy_permission%'
      WHEN 'check_privacy_permission'     THEN prosrc LIKE '%friend_requests%'
      ELSE true
    END
  ) AS all_guards_present,
  (SELECT bool_or(prosrc LIKE '%user_blocks%') FROM f WHERE proname = 'list_active_stories')   AS stories_block_ok,
  (SELECT bool_or(prosrc LIKE '%view_stories%') FROM f WHERE proname = 'list_active_stories')  AS stories_privacy_ok,
  (SELECT bool_or(prosrc LIKE '%enter_rooms%') FROM f WHERE proname = 'record_wattar_room_presence') AS rooms_privacy_ok,
  (SELECT bool_or(result LIKE 'TABLE(story_id uuid%') FROM f WHERE proname = 'list_active_stories') AS stories_return_type_intact,
  (SELECT bool_or(result = 'integer') FROM f WHERE proname = 'record_wattar_room_presence') AS rooms_return_type_intact,
  (SELECT count(*) FROM f WHERE result = 'jsonb') AS jsonb_functions
FROM f;

-- تحقق M1.6 «من يستطيع رؤية معلوماتي»
SELECT
  (SELECT prosrc LIKE '%check_privacy_permission%' FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='wattar_can_view_profile') AS view_info_guard_ok,
  (SELECT prosrc LIKE '%wattar_can_view_profile%' FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='get_wattar_progress') AS progress_guard_ok,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('get_wattar_profile','list_wattar_profile_posts')) AS profile_paths_count,
  (SELECT array_agg(column_name ORDER BY column_name) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='users' AND column_name LIKE 'privacy_can_%') AS privacy_columns;
