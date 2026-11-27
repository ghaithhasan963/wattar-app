-- ============================================================
-- patch_m9_push_schedule.sql  (Migration #82)
-- M9.3 — جدولة عامل الدفع + إشعار تحدي النرد من الخادم
--
-- يكمل #81: كان الطابور يُغذّى تلقائياً لكن لا شيء يستدعيه دورياً،
-- لذا لا يصل أي دفع للجهاز. هنا نُثبّت pg_cron + pg_net ونشغّل
-- push-worker كل دقيقة بمفتاح عامل سرّي مُخزَّن في القاعدة (لا في الكود)،
-- ونضيف نوع «تحدي النرد» إلى الكتالوج مع زناد إنشاء إشعاره.
-- ============================================================
BEGIN;

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- ============================================================
-- 1) نوع «تحدي النرد» — إشعار خادمي بدل دفع من جهاز اللاعب
-- ============================================================
INSERT INTO public.notification_type_catalog
  (event_type, category, label_ar, description_ar, push_default, in_app_default, can_disable_in_app, sort_order)
VALUES
  ('dice_challenge', 'social', 'تحديات النرد', 'دعوة إلى تحدٍ مجاني بالنرد', true, true, true, 55)
ON CONFLICT (event_type) DO UPDATE
  SET label_ar = EXCLUDED.label_ar,
      description_ar = EXCLUDED.description_ar,
      sort_order = EXCLUDED.sort_order,
      updated_at = now();

ALTER TABLE public.user_notifications DROP CONSTRAINT IF EXISTS user_notifications_event_type_check;
ALTER TABLE public.user_notifications ADD CONSTRAINT user_notifications_event_type_check CHECK (
  event_type = ANY (ARRAY[
    'friend_request','friend_accepted','private_message','room_invitation','new_follower',
    'gift_received','deposit_update','withdrawal_update','host_update','membership_update',
    'host_earning','support_reply','moderation_penalty','moderation_appeal','host_application',
    'host_status','host_target','host_contract','vip_purchase','protection_purchase',
    'level_up','loyalty_streak','broadcast','dice_challenge'
  ])
);

-- إشعار لكل لاعب مُدعى عند إنشاء التحدي (المرجع = معرف التحدي، فلا تكرار)
CREATE OR REPLACE FUNCTION public.create_dice_challenge_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_creator uuid;
  v_name text;
BEGIN
  IF NEW.status <> 'pending' THEN RETURN NEW; END IF;

  SELECT c.creator_id INTO v_creator
  FROM public.game_challenges c WHERE c.id = NEW.challenge_id;
  IF v_creator IS NULL OR v_creator = NEW.user_id THEN RETURN NEW; END IF;

  IF EXISTS (
    SELECT 1 FROM public.user_blocks b
    WHERE (b.blocker_id = v_creator AND b.blocked_id = NEW.user_id)
       OR (b.blocker_id = NEW.user_id AND b.blocked_id = v_creator)
  ) THEN
    RETURN NEW;
  END IF;

  SELECT coalesce(nullif(trim(u.display_name), ''), nullif(trim(u.username), ''), 'صديقك')
  INTO v_name FROM public.users u WHERE u.id = v_creator;

  INSERT INTO public.user_notifications (user_id, actor_id, event_type, reference_id, title, body, route)
  VALUES (
    NEW.user_id,
    v_creator,
    'dice_challenge',
    NEW.challenge_id,
    'تحدي نرد من ' || coalesce(v_name, 'صديقك'),
    coalesce(v_name, 'صديقك') || ' دعاك إلى تحدٍ مجاني بالنرد.',
    '/(tabs)/friends'
  )
  ON CONFLICT (user_id, event_type, reference_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS wattar_notification_dice_challenge ON public.game_challenge_players;
CREATE TRIGGER wattar_notification_dice_challenge
  AFTER INSERT ON public.game_challenge_players
  FOR EACH ROW EXECUTE FUNCTION public.create_dice_challenge_notification();

-- ============================================================
-- 2) مفتاح عامل الدفع + عنوان الدالة (قابلان للتغيير بلا كود)
-- ============================================================
INSERT INTO public.admin_settings (key, value, description, is_public)
VALUES
  ('push_worker_secret', to_jsonb(encode(gen_random_bytes(32), 'hex')),
   'مفتاح سرّي لاستدعاء عامل الدفع من الجدولة', false),
  ('push_worker_url',
   to_jsonb('https://vczyjbqixqzositlkfkn.supabase.co/functions/v1/push-worker'::text),
   'عنوان دالة عامل الدفع', false)
ON CONFLICT (key) DO NOTHING;

-- استدعاء العامل عبر pg_net (يعمل من cron بصفة postgres)
CREATE OR REPLACE FUNCTION public.invoke_push_worker()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net, pg_temp
AS $$
DECLARE
  v_secret text;
  v_url text;
  v_request bigint;
BEGIN
  SELECT value #>> '{}' INTO v_secret FROM public.admin_settings WHERE key = 'push_worker_secret';
  SELECT value #>> '{}' INTO v_url FROM public.admin_settings WHERE key = 'push_worker_url';
  IF v_secret IS NULL OR v_secret = '' OR v_url IS NULL OR v_url = '' THEN
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url := v_url,
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-worker-key', v_secret
    ),
    timeout_milliseconds := 20000
  ) INTO v_request;

  RETURN v_request;
END;
$$;
REVOKE ALL ON FUNCTION public.invoke_push_worker() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_push_worker() TO service_role;

-- تنظيف الطابور من الجدولة: يُسمح كذلك لجلسة postgres (مهمة الكرون)
CREATE OR REPLACE FUNCTION public.purge_push_queue(p_days integer DEFAULT 30)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND session_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'غير مصرح بتنظيف طابور الدفع';
  END IF;
  DELETE FROM public.push_queue
  WHERE status IN ('sent', 'skipped')
    AND coalesce(sent_at, created_at) < now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 365));
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;
REVOKE ALL ON FUNCTION public.purge_push_queue(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_push_queue(integer) TO service_role;

-- ============================================================
-- 3) الجدولة: العامل كل دقيقة، والتنظيف يومياً
-- ============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'wattar-push-worker') THEN
    PERFORM cron.unschedule('wattar-push-worker');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'wattar-push-purge') THEN
    PERFORM cron.unschedule('wattar-push-purge');
  END IF;
END $$;

SELECT cron.schedule('wattar-push-worker', '* * * * *', 'SELECT public.invoke_push_worker();');
SELECT cron.schedule('wattar-push-purge', '15 3 * * *', 'SELECT public.purge_push_queue(30);');

SELECT set_config('request.jwt.claims', '', true);

COMMIT;
