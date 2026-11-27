-- ============================================================
-- diagnostics/22_m9_push_schedule_test.sql
-- اختبار وظيفي لترحيل #82 (M9.3 — جدولة الدفع + تحدي النرد)
-- داخل BEGIN … ROLLBACK: لا يترك أثراً.
-- ============================================================
BEGIN;

CREATE TEMP TABLE _results (step text, expected text, actual text, ok boolean) ON COMMIT DROP;

DO $do$
DECLARE
  v_creator uuid;
  v_player uuid;
  v_challenge uuid;
  v_cnt integer;
  v_types integer;
  v_secret text;
  v_url text;
  v_id bigint;
  v_ok boolean;
  v_actual text;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);

  SELECT u.id INTO v_creator FROM public.users u
  WHERE u.status = 'active' AND u.role = 'user' ORDER BY u.created_at LIMIT 1;
  SELECT u.id INTO v_player FROM public.users u
  WHERE u.status = 'active' AND u.role = 'user' AND u.id <> v_creator ORDER BY u.created_at LIMIT 1;
  IF v_creator IS NULL OR v_player IS NULL THEN
    INSERT INTO _results VALUES ('T00', 'وجود مستخدمي اختبار', 'لا يوجد', false);
    RETURN;
  END IF;

  DELETE FROM public.user_notification_preferences WHERE user_id IN (v_creator, v_player);

  -- T01: النوع الجديد في الكتالوج
  SELECT count(*) INTO v_types FROM public.notification_type_catalog WHERE is_active;
  v_ok := v_types >= 24
    AND EXISTS (SELECT 1 FROM public.notification_type_catalog WHERE event_type = 'dice_challenge');
  INSERT INTO _results VALUES ('T01', 'كتالوج الأنواع يشمل تحدي النرد', 'types=' || v_types, v_ok);

  -- T02: قيد user_notifications يقبل dice_challenge
  v_ok := true;
  v_actual := '';
  BEGIN
    INSERT INTO public.user_notifications (user_id, actor_id, event_type, reference_id, title, body, route)
    VALUES (v_player, v_creator, 'dice_challenge', gen_random_uuid(), 'تحدي', 'تحدي نرد', '/(tabs)/friends');
    v_cnt := (SELECT count(*) FROM public.user_notifications
              WHERE user_id = v_player AND event_type = 'dice_challenge');
    v_actual := 'rows=' || v_cnt;
  EXCEPTION WHEN OTHERS THEN
    v_ok := false;
    v_actual := SQLERRM;
  END;
  INSERT INTO _results VALUES ('T02', 'قيد النوع يقبل تحدي النرد', v_actual, v_ok);

  -- T03: زناد التحدي يُنشئ إشعاراً للاعب المُدعى
  INSERT INTO public.game_challenges (creator_id, game_type, max_players, status)
  VALUES (v_creator, 'dice', 2, 'pending') RETURNING id INTO v_challenge;
  INSERT INTO public.game_challenge_players (challenge_id, user_id, status)
  VALUES (v_challenge, v_player, 'pending');
  SELECT count(*) INTO v_cnt FROM public.user_notifications
  WHERE user_id = v_player AND event_type = 'dice_challenge' AND reference_id = v_challenge;
  v_ok := v_cnt = 1;
  INSERT INTO _results VALUES ('T03', 'زناد التحدي ينشئ إشعاراً واحداً', 'rows=' || v_cnt, v_ok);

  -- T04: والطابور يستقبل الإشعار آلياً
  SELECT count(*) INTO v_cnt FROM public.push_queue
  WHERE user_id = v_player AND event_type = 'dice_challenge' AND reference_id = v_challenge;
  v_ok := v_cnt = 1;
  INSERT INTO _results VALUES ('T04', 'الطابور يستقبل تحدي النرد', 'rows=' || v_cnt, v_ok);

  -- T05: إعدادات العامل موجودة وسليمة
  SELECT value #>> '{}' INTO v_secret FROM public.admin_settings WHERE key = 'push_worker_secret';
  SELECT value #>> '{}' INTO v_url FROM public.admin_settings WHERE key = 'push_worker_url';
  v_ok := v_secret ~ '^[0-9a-f]{64}$'
    AND v_url = 'https://vczyjbqixqzositlkfkn.supabase.co/functions/v1/push-worker';
  INSERT INTO _results VALUES ('T05', 'مفتاح العامل وعنوانه مضبوطان',
    'secret_len=' || coalesce(length(v_secret), 0), v_ok);

  -- T06: استدعاء العامل يُنشئ طلب pg_net
  v_id := public.invoke_push_worker();
  v_ok := v_id IS NOT NULL AND v_id > 0;
  INSERT INTO _results VALUES ('T06', 'استدعاء العامل ينجح عبر pg_net',
    'request_id=' || coalesce(v_id::text, 'NULL'), v_ok);

  -- T07: مهام الكرون مجدولة
  v_ok := EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'wattar-push-worker' AND schedule = '* * * * *' AND active)
    AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'wattar-push-purge' AND active);
  INSERT INTO _results VALUES ('T07', 'مهمتا الكرون مجدولتان ونشطتان',
    'jobs=' || (SELECT count(*) FROM cron.job), v_ok);

  -- T08: تنظيف الطابور يعمل من جلسة الجدولة (postgres)
  v_ok := true;
  v_actual := '';
  BEGIN
    v_cnt := public.purge_push_queue(30);
    v_actual := 'deleted=' || coalesce(v_cnt::text, 'NULL');
  EXCEPTION WHEN OTHERS THEN
    v_ok := false;
    v_actual := SQLERRM;
  END;
  INSERT INTO _results VALUES ('T08', 'تنظيف الطابور يعمل من الجدولة', v_actual, v_ok);

  -- T09: لا يستطيع المستخدم العادي استدعاء العامل
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_player::text, 'role', 'authenticated')::text, true);
  v_ok := true;
  v_actual := '';
  BEGIN
    PERFORM public.invoke_push_worker();
    v_ok := false;
    v_actual := 'قُبل من مستخدم عادي — خطأ';
  EXCEPTION WHEN OTHERS THEN
    v_ok := true;
    v_actual := SQLERRM;
  END;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
  INSERT INTO _results VALUES ('T09', 'استدعاء العامل ممنوع على المستخدمين', v_actual, v_ok);

  PERFORM set_config('request.jwt.claims', '', true);
END $do$;

SELECT * FROM _results ORDER BY step;

ROLLBACK;
