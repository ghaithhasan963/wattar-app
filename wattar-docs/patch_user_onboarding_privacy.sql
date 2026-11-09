-- Required onboarding fields and friend-only profile visibility.
-- Run after patch_wattar_v2_social.sql.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS gender text,
  ADD COLUMN IF NOT EXISTS profile_visibility text NOT NULL DEFAULT 'public',
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_gender_valid'
      AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_gender_valid
      CHECK (gender IS NULL OR gender IN ('female', 'male', 'other'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_profile_visibility_valid'
      AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_profile_visibility_valid
      CHECK (profile_visibility IN ('public', 'friends'));
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_my_onboarding(
  p_gender text,
  p_birth_date date,
  p_profile_visibility text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول';
  END IF;
  IF p_gender IS NULL OR p_gender NOT IN ('female', 'male', 'other') THEN
    RAISE EXCEPTION 'اختر الجنس للمتابعة';
  END IF;
  IF p_birth_date IS NULL OR p_birth_date > (current_date - interval '18 years')::date THEN
    RAISE EXCEPTION 'يتطلب استخدام Wattar أن يكون العمر 18 عامًا أو أكثر';
  END IF;
  IF p_birth_date < (current_date - interval '120 years')::date THEN
    RAISE EXCEPTION 'تاريخ الميلاد غير صالح';
  END IF;
  IF p_profile_visibility IS NULL OR p_profile_visibility NOT IN ('public', 'friends') THEN
    RAISE EXCEPTION 'إعداد خصوصية الملف غير صالح';
  END IF;

  UPDATE public.users
  SET gender = p_gender,
      profile_visibility = p_profile_visibility,
      onboarding_completed_at = coalesce(onboarding_completed_at, now()),
      adult_confirmed_at = coalesce(adult_confirmed_at, now())
  WHERE id = auth.uid()
    AND status = 'active';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'الحساب غير متاح';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.complete_my_onboarding(text, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_my_onboarding(text, date, text) TO authenticated;

REVOKE ALL ON FUNCTION public.confirm_my_adult_status(boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.update_my_profile_visibility(p_profile_visibility text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول';
  END IF;
  IF p_profile_visibility IS NULL OR p_profile_visibility NOT IN ('public', 'friends') THEN
    RAISE EXCEPTION 'إعداد خصوصية الملف غير صالح';
  END IF;

  UPDATE public.users
  SET profile_visibility = p_profile_visibility
  WHERE id = auth.uid()
    AND status = 'active'
    AND onboarding_completed_at IS NOT NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'أكمل إعداد ملفك قبل تغيير الخصوصية';
  END IF;

  IF p_profile_visibility = 'friends' THEN
    DELETE FROM public.user_follows f
    WHERE f.followed_id = auth.uid()
      AND NOT EXISTS (
        SELECT 1 FROM public.friend_requests r
        WHERE r.status = 'accepted'
          AND ((r.requester_id = auth.uid() AND r.recipient_id = f.follower_id)
            OR (r.recipient_id = auth.uid() AND r.requester_id = f.follower_id))
      );
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.update_my_profile_visibility(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_my_profile_visibility(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.search_wattar_users(p_query text)
RETURNS TABLE (
  user_id uuid,
  username text,
  display_name text,
  avatar_url text,
  bio text,
  is_online boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.id,
         u.username::text,
         CASE WHEN u.profile_visibility = 'public' OR EXISTS (
           SELECT 1 FROM public.friend_requests f
           WHERE f.status = 'accepted'
             AND ((f.requester_id = auth.uid() AND f.recipient_id = u.id)
               OR (f.recipient_id = auth.uid() AND f.requester_id = u.id))
         ) THEN u.display_name::text ELSE NULL END,
         CASE WHEN u.profile_visibility = 'public' OR EXISTS (
           SELECT 1 FROM public.friend_requests f
           WHERE f.status = 'accepted'
             AND ((f.requester_id = auth.uid() AND f.recipient_id = u.id)
               OR (f.recipient_id = auth.uid() AND f.requester_id = u.id))
         ) THEN u.avatar_url ELSE NULL END,
         CASE WHEN u.profile_visibility = 'public' OR EXISTS (
           SELECT 1 FROM public.friend_requests f
           WHERE f.status = 'accepted'
             AND ((f.requester_id = auth.uid() AND f.recipient_id = u.id)
               OR (f.recipient_id = auth.uid() AND f.requester_id = u.id))
         ) THEN u.bio::text ELSE NULL END,
         CASE WHEN u.profile_visibility = 'public' OR EXISTS (
           SELECT 1 FROM public.friend_requests f
           WHERE f.status = 'accepted'
             AND ((f.requester_id = auth.uid() AND f.recipient_id = u.id)
               OR (f.recipient_id = auth.uid() AND f.requester_id = u.id))
         ) THEN coalesce(u.last_seen_at > now() - interval '5 minutes', false)
         ELSE false END
  FROM public.users u
  WHERE auth.uid() IS NOT NULL
    AND u.id <> auth.uid()
    AND u.status = 'active'
    AND length(trim(coalesce(p_query, ''))) >= 2
    AND (u.username ILIKE '%' || trim(p_query) || '%'
         OR coalesce(u.display_name, '') ILIKE '%' || trim(p_query) || '%')
    AND NOT public.is_wattar_blocked_between(u.id)
  ORDER BY (u.username ILIKE trim(p_query) || '%') DESC, u.username
  LIMIT 30;
$$;
REVOKE ALL ON FUNCTION public.search_wattar_users(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_wattar_users(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_my_friend_requests()
RETURNS TABLE (
  request_id uuid,
  direction text,
  status text,
  user_id uuid,
  username text,
  display_name text,
  avatar_url text,
  is_online boolean,
  created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT f.id,
         CASE WHEN f.recipient_id = auth.uid() THEN 'incoming' ELSE 'outgoing' END,
         f.status,
         u.id,
         u.username::text,
         CASE WHEN u.profile_visibility = 'public' THEN u.display_name::text ELSE NULL END,
         CASE WHEN u.profile_visibility = 'public' THEN u.avatar_url ELSE NULL END,
         CASE WHEN u.profile_visibility = 'public'
              THEN coalesce(u.last_seen_at > now() - interval '5 minutes', false)
              ELSE false END,
         f.created_at
  FROM public.friend_requests f
  JOIN public.users u ON u.id = CASE
    WHEN f.recipient_id = auth.uid() THEN f.requester_id ELSE f.recipient_id END
  WHERE auth.uid() IN (f.requester_id, f.recipient_id)
    AND f.status = 'pending'
  ORDER BY f.created_at DESC
  LIMIT 100;
$$;
REVOKE ALL ON FUNCTION public.list_my_friend_requests() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_my_friend_requests() TO authenticated;

CREATE OR REPLACE FUNCTION public.follow_wattar_user(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
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
  INSERT INTO public.user_follows (follower_id, followed_id)
  VALUES (auth.uid(), p_user_id)
  ON CONFLICT DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION public.follow_wattar_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.follow_wattar_user(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_my_following()
RETURNS TABLE (
  user_id uuid,
  username text,
  display_name text,
  avatar_url text,
  is_online boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.id, u.username::text,
         CASE WHEN u.profile_visibility = 'public' OR EXISTS (
           SELECT 1 FROM public.friend_requests f
           WHERE f.status = 'accepted'
             AND ((f.requester_id = auth.uid() AND f.recipient_id = u.id)
               OR (f.recipient_id = auth.uid() AND f.requester_id = u.id))
         ) THEN u.display_name::text ELSE NULL END,
         CASE WHEN u.profile_visibility = 'public' OR EXISTS (
           SELECT 1 FROM public.friend_requests f
           WHERE f.status = 'accepted'
             AND ((f.requester_id = auth.uid() AND f.recipient_id = u.id)
               OR (f.recipient_id = auth.uid() AND f.requester_id = u.id))
         ) THEN u.avatar_url ELSE NULL END,
         CASE WHEN u.profile_visibility = 'public' OR EXISTS (
           SELECT 1 FROM public.friend_requests f
           WHERE f.status = 'accepted'
             AND ((f.requester_id = auth.uid() AND f.recipient_id = u.id)
               OR (f.recipient_id = auth.uid() AND f.requester_id = u.id))
         ) THEN coalesce(u.last_seen_at > now() - interval '5 minutes', false)
         ELSE false END
  FROM public.user_follows f
  JOIN public.users u ON u.id = f.followed_id
  WHERE f.follower_id = auth.uid()
    AND u.status = 'active'
    AND NOT public.is_wattar_blocked_between(u.id)
  ORDER BY f.created_at DESC
  LIMIT 500;
$$;
REVOKE ALL ON FUNCTION public.list_my_following() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_my_following() TO authenticated;

CREATE OR REPLACE FUNCTION public.list_my_followers()
RETURNS TABLE (
  user_id uuid,
  username text,
  display_name text,
  avatar_url text,
  is_online boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.id, u.username::text,
         CASE WHEN u.profile_visibility = 'public' OR EXISTS (
           SELECT 1 FROM public.friend_requests f
           WHERE f.status = 'accepted'
             AND ((f.requester_id = auth.uid() AND f.recipient_id = u.id)
               OR (f.recipient_id = auth.uid() AND f.requester_id = u.id))
         ) THEN u.display_name::text ELSE NULL END,
         CASE WHEN u.profile_visibility = 'public' OR EXISTS (
           SELECT 1 FROM public.friend_requests f
           WHERE f.status = 'accepted'
             AND ((f.requester_id = auth.uid() AND f.recipient_id = u.id)
               OR (f.recipient_id = auth.uid() AND f.requester_id = u.id))
         ) THEN u.avatar_url ELSE NULL END,
         CASE WHEN u.profile_visibility = 'public' OR EXISTS (
           SELECT 1 FROM public.friend_requests f
           WHERE f.status = 'accepted'
             AND ((f.requester_id = auth.uid() AND f.recipient_id = u.id)
               OR (f.recipient_id = auth.uid() AND f.requester_id = u.id))
         ) THEN coalesce(u.last_seen_at > now() - interval '5 minutes', false)
         ELSE false END
  FROM public.user_follows f
  JOIN public.users u ON u.id = f.follower_id
  WHERE f.followed_id = auth.uid()
    AND u.status = 'active'
    AND NOT public.is_wattar_blocked_between(u.id)
  ORDER BY f.created_at DESC
  LIMIT 500;
$$;
REVOKE ALL ON FUNCTION public.list_my_followers() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_my_followers() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_wattar_progress(p_user_id uuid DEFAULT NULL)
RETURNS TABLE (
  level integer,
  experience_points bigint,
  follower_count bigint,
  following_count bigint,
  is_following boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.level, u.experience_points,
         (SELECT count(*) FROM public.user_follows f
          JOIN public.users follower ON follower.id = f.follower_id AND follower.status = 'active'
          WHERE f.followed_id = u.id),
         (SELECT count(*) FROM public.user_follows f
          JOIN public.users followed ON followed.id = f.followed_id AND followed.status = 'active'
          WHERE f.follower_id = u.id),
         EXISTS (
           SELECT 1 FROM public.user_follows f
           WHERE f.follower_id = auth.uid() AND f.followed_id = u.id
         )
  FROM public.users u
  WHERE u.id = coalesce(p_user_id, auth.uid())
    AND u.status = 'active'
    AND auth.uid() IS NOT NULL
    AND (
      u.id = auth.uid()
      OR u.profile_visibility = 'public'
      OR EXISTS (
        SELECT 1 FROM public.friend_requests f
        WHERE f.status = 'accepted'
          AND ((f.requester_id = auth.uid() AND f.recipient_id = u.id)
            OR (f.recipient_id = auth.uid() AND f.requester_id = u.id))
      )
    );
$$;
REVOKE ALL ON FUNCTION public.get_wattar_progress(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_wattar_progress(uuid) TO authenticated;
