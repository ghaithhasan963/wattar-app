-- ============================================================
-- patch_privacy_settings.sql — M1.6 إعدادات الخصوصية الست
-- المرجع: المطلوب تماما .txt §23
-- الأثر: إضافات فقط (أعمدة + دوال + فهارس). لا حذف ولا تعديل بيانات.
-- ============================================================
BEGIN;

-- 1) ستة أعمدة للخصوصية على users
-- القيم: 'public' | 'friends' | 'none'
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS privacy_can_follow text NOT NULL DEFAULT 'public'
    CHECK (privacy_can_follow IN ('public','friends','none')),
  ADD COLUMN IF NOT EXISTS privacy_can_message text NOT NULL DEFAULT 'public'
    CHECK (privacy_can_message IN ('public','friends','none')),
  ADD COLUMN IF NOT EXISTS privacy_can_friend_request text NOT NULL DEFAULT 'public'
    CHECK (privacy_can_friend_request IN ('public','friends','none')),
  ADD COLUMN IF NOT EXISTS privacy_can_view_stories text NOT NULL DEFAULT 'public'
    CHECK (privacy_can_view_stories IN ('public','friends','none')),
  ADD COLUMN IF NOT EXISTS privacy_can_view_info text NOT NULL DEFAULT 'public'
    CHECK (privacy_can_view_info IN ('public','friends','none')),
  ADD COLUMN IF NOT EXISTS privacy_can_enter_rooms text NOT NULL DEFAULT 'public'
    CHECK (privacy_can_enter_rooms IN ('public','friends','none'));

CREATE INDEX IF NOT EXISTS idx_users_privacy_can_follow ON public.users (privacy_can_follow);
CREATE INDEX IF NOT EXISTS idx_users_privacy_can_message ON public.users (privacy_can_message);

-- 2) دالة جلب إعدادات خصوصيتي
CREATE OR REPLACE FUNCTION public.get_my_privacy_settings()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.users%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR auth.role() <> 'authenticated' THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول';
  END IF;
  SELECT * INTO v_row FROM public.users WHERE id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'ملف المستخدم غير موجود'; END IF;
  RETURN jsonb_build_object(
    'can_follow', v_row.privacy_can_follow,
    'can_message', v_row.privacy_can_message,
    'can_friend_request', v_row.privacy_can_friend_request,
    'can_view_stories', v_row.privacy_can_view_stories,
    'can_view_info', v_row.privacy_can_view_info,
    'can_enter_rooms', v_row.privacy_can_enter_rooms
  );
END;
$$;

-- 3) دالة تحديث إعدادات خصوصيتي
CREATE OR REPLACE FUNCTION public.update_my_privacy_settings(
  p_can_follow text DEFAULT NULL,
  p_can_message text DEFAULT NULL,
  p_can_friend_request text DEFAULT NULL,
  p_can_view_stories text DEFAULT NULL,
  p_can_view_info text DEFAULT NULL,
  p_can_enter_rooms text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_allowed constant text[] := ARRAY['public','friends','none'];
BEGIN
  IF v_uid IS NULL OR auth.role() <> 'authenticated' THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول';
  END IF;
  IF p_can_follow IS NOT NULL AND p_can_follow <> ALL(v_allowed) THEN
    RAISE EXCEPTION 'قيمة privacy_can_follow غير صالحة';
  END IF;
  IF p_can_message IS NOT NULL AND p_can_message <> ALL(v_allowed) THEN
    RAISE EXCEPTION 'قيمة privacy_can_message غير صالحة';
  END IF;
  IF p_can_friend_request IS NOT NULL AND p_can_friend_request <> ALL(v_allowed) THEN
    RAISE EXCEPTION 'قيمة privacy_can_friend_request غير صالحة';
  END IF;
  IF p_can_view_stories IS NOT NULL AND p_can_view_stories <> ALL(v_allowed) THEN
    RAISE EXCEPTION 'قيمة privacy_can_view_stories غير صالحة';
  END IF;
  IF p_can_view_info IS NOT NULL AND p_can_view_info <> ALL(v_allowed) THEN
    RAISE EXCEPTION 'قيمة privacy_can_view_info غير صالحة';
  END IF;
  IF p_can_enter_rooms IS NOT NULL AND p_can_enter_rooms <> ALL(v_allowed) THEN
    RAISE EXCEPTION 'قيمة privacy_can_enter_rooms غير صالحة';
  END IF;

  UPDATE public.users
  SET
    privacy_can_follow = COALESCE(p_can_follow, privacy_can_follow),
    privacy_can_message = COALESCE(p_can_message, privacy_can_message),
    privacy_can_friend_request = COALESCE(p_can_friend_request, privacy_can_friend_request),
    privacy_can_view_stories = COALESCE(p_can_view_stories, privacy_can_view_stories),
    privacy_can_view_info = COALESCE(p_can_view_info, privacy_can_view_info),
    privacy_can_enter_rooms = COALESCE(p_can_enter_rooms, privacy_can_enter_rooms)
  WHERE id = v_uid;
END;
$$;

-- 4) دالة مساعدة: هل المستخدم المستهدف يسمح لهذا الإجراء من الفاعل؟
-- تُستخدم داخل دوال المتابعة، المراسلة، طلبات الصداقة، القصص، الغرف
CREATE OR REPLACE FUNCTION public.check_privacy_permission(
  p_target_user_id uuid,
  p_action text, -- 'follow' | 'message' | 'friend_request' | 'view_stories' | 'view_info' | 'enter_rooms'
  p_actor_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_setting text;
  v_is_friend boolean;
BEGIN
  IF p_actor_user_id IS NULL THEN RETURN false; END IF;
  IF p_actor_user_id = p_target_user_id THEN RETURN true; END IF; -- صاحب الملف يفعل ما يشاء بملفه

  SELECT CASE p_action
    WHEN 'follow' THEN privacy_can_follow
    WHEN 'message' THEN privacy_can_message
    WHEN 'friend_request' THEN privacy_can_friend_request
    WHEN 'view_stories' THEN privacy_can_view_stories
    WHEN 'view_info' THEN privacy_can_view_info
    WHEN 'enter_rooms' THEN privacy_can_enter_rooms
    ELSE 'none'
  END INTO v_setting
  FROM public.users
  WHERE id = p_target_user_id;

  IF v_setting IS NULL THEN RETURN false; END IF;

  IF v_setting = 'public' THEN RETURN true; END IF;
  IF v_setting = 'none' THEN RETURN false; END IF;

  -- 'friends' → تحقق من الصداقة المقبولة
  SELECT EXISTS (
    SELECT 1 FROM public.friend_requests f
    WHERE f.status = 'accepted'
      AND ((f.requester_id = p_actor_user_id AND f.recipient_id = p_target_user_id)
        OR (f.requester_id = p_target_user_id AND f.recipient_id = p_actor_user_id))
  ) INTO v_is_friend;

  RETURN v_is_friend;
END;
$$;

-- 5) تعديل follow_wattar_user لتفحص الخصوصية
CREATE OR REPLACE FUNCTION public.follow_wattar_user(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR p_user_id IS NULL OR p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'المتابعة غير صالحة';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_user_id AND u.status = 'active'
      AND (u.profile_visibility = 'public' OR EXISTS (
        SELECT 1 FROM public.friend_requests f
        WHERE f.status = 'accepted'
          AND ((f.requester_id = auth.uid() AND f.recipient_id = u.id)
            OR (f.recipient_id = auth.uid() AND f.requester_id = u.id))
      ))
  ) THEN
    RAISE EXCEPTION 'هذا الملف متاح للأصدقاء فقط';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.status = 'active'
  ) THEN
    RAISE EXCEPTION 'الحساب غير متاح';
  END IF;
  IF public.is_wattar_blocked_between(p_user_id) THEN
    RAISE EXCEPTION 'لا يمكن متابعة هذا المستخدم';
  END IF;
  -- NEW: privacy check
  IF NOT public.check_privacy_permission(p_user_id, 'follow') THEN
    RAISE EXCEPTION 'هذا المستخدم لا يسمح بمتابعته إلا للأصدقاء';
  END IF;
  INSERT INTO public.user_follows (follower_id, followed_id)
  VALUES (auth.uid(), p_user_id)
  ON CONFLICT DO NOTHING;
END;
$$;

-- 6) تعديل send_friend_request لتفحص الخصوصية
CREATE OR REPLACE FUNCTION public.send_friend_request(p_recipient_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_request_id uuid;
BEGIN
  IF auth.uid() IS NULL OR p_recipient_id = auth.uid() THEN
    RAISE EXCEPTION 'طلب الصداقة غير صالح';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_recipient_id AND u.status = 'active') THEN
    RAISE EXCEPTION 'المستخدم غير متاح';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.user_blocks b
    WHERE (b.blocker_id = auth.uid() AND b.blocked_id = p_recipient_id)
       OR (b.blocker_id = p_recipient_id AND b.blocked_id = auth.uid())
  ) THEN
    RAISE EXCEPTION 'لا يمكن إرسال طلب لهذا المستخدم';
  END IF;
  -- NEW: privacy check
  IF NOT public.check_privacy_permission(p_recipient_id, 'friend_request') THEN
    RAISE EXCEPTION 'هذا المستخدم لا يقبل طلبات صداقة إلا من الأصدقاء';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.friend_requests f
    WHERE f.requester_id = p_recipient_id AND f.recipient_id = auth.uid()
      AND f.status = 'pending'
  ) THEN
    RAISE EXCEPTION 'لديك طلب صداقة وارد من هذا المستخدم؛ اقبله من قائمة الطلبات';
  END IF;
  INSERT INTO public.friend_requests (requester_id, recipient_id, status)
  VALUES (auth.uid(), p_recipient_id, 'pending')
  ON CONFLICT (requester_id, recipient_id) DO UPDATE
    SET status = 'pending', updated_at = now()
    WHERE public.friend_requests.status IN ('declined', 'cancelled')
  RETURNING id INTO v_request_id;
  IF v_request_id IS NULL THEN
    RAISE EXCEPTION 'يوجد طلب صداقة أو صداقة قائمة بالفعل';
  END IF;
  RETURN v_request_id;
END;
$$;

-- 7) تعديل create_private_conversation لتفحص خصوصية المراسلة
CREATE OR REPLACE FUNCTION public.create_private_conversation(p_other_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_one uuid;
  v_two uuid;
  v_conversation_id uuid;
BEGIN
  IF auth.uid() IS NULL OR p_other_user_id IS NULL OR p_other_user_id = auth.uid() THEN
    RAISE EXCEPTION 'المحادثة غير صالحة';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = p_other_user_id AND status = 'active' AND adult_confirmed_at IS NOT NULL
      AND onboarding_completed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'هذا الحساب غير مؤهل للمراسلة';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND status = 'active' AND adult_confirmed_at IS NOT NULL
      AND onboarding_completed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'الحساب غير مؤهل للمراسلة';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.user_blocks b
    WHERE (b.blocker_id = auth.uid() AND b.blocked_id = p_other_user_id)
       OR (b.blocker_id = p_other_user_id AND b.blocked_id = auth.uid())
  ) THEN
    RAISE EXCEPTION 'لا يمكن بدء محادثة مع هذا المستخدم';
  END IF;
  -- NEW: privacy check for messaging
  IF NOT public.check_privacy_permission(p_other_user_id, 'message') THEN
    RAISE EXCEPTION 'هذا المستخدم لا يسمح بالمراسلة إلا للأصدقاء';
  END IF;
  v_one := least(auth.uid(), p_other_user_id);
  v_two := greatest(auth.uid(), p_other_user_id);
  INSERT INTO public.private_conversations (user_one_id, user_two_id)
  VALUES (v_one, v_two)
  ON CONFLICT (user_one_id, user_two_id) DO UPDATE
    SET updated_at = public.private_conversations.updated_at
  RETURNING id INTO v_conversation_id;
  RETURN v_conversation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_privacy_settings() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_my_privacy_settings(text,text,text,text,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.check_privacy_permission(uuid,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_privacy_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_my_privacy_settings(text,text,text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_privacy_permission(uuid,text,uuid) TO authenticated;

COMMIT;