-- Public profiles and permanent photo posts.
-- Run after patch_wattar_v2_social.sql and patch_user_onboarding_privacy.sql.

CREATE OR REPLACE FUNCTION public.wattar_can_view_profile(p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.users viewer
      JOIN public.users profile ON profile.id = p_user_id
      WHERE viewer.id = auth.uid()
        AND viewer.status = 'active'
        AND viewer.adult_confirmed_at IS NOT NULL
        AND profile.status = 'active'
        AND profile.adult_confirmed_at IS NOT NULL
        AND NOT public.is_wattar_blocked_between(profile.id)
        AND (
          profile.id = auth.uid()
          OR profile.profile_visibility = 'public'
          OR EXISTS (
            SELECT 1 FROM public.friend_requests f
            WHERE f.status = 'accepted'
              AND ((f.requester_id = auth.uid() AND f.recipient_id = profile.id)
                OR (f.recipient_id = auth.uid() AND f.requester_id = profile.id))
          )
        )
    );
$$;
REVOKE ALL ON FUNCTION public.wattar_can_view_profile(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wattar_can_view_profile(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_wattar_profile(p_user_id uuid)
RETURNS TABLE (
  user_id uuid,
  username text,
  display_name text,
  avatar_url text,
  bio text,
  is_private boolean,
  is_friend boolean,
  is_following boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.id,
         u.username::text,
         CASE WHEN public.wattar_can_view_profile(u.id) THEN u.display_name::text ELSE NULL END,
         CASE WHEN public.wattar_can_view_profile(u.id) THEN u.avatar_url ELSE NULL END,
         CASE WHEN public.wattar_can_view_profile(u.id) THEN u.bio::text ELSE NULL END,
         NOT public.wattar_can_view_profile(u.id),
         EXISTS (
           SELECT 1 FROM public.friend_requests f
           WHERE f.status = 'accepted'
             AND ((f.requester_id = auth.uid() AND f.recipient_id = u.id)
               OR (f.recipient_id = auth.uid() AND f.requester_id = u.id))
         ),
         EXISTS (
           SELECT 1 FROM public.user_follows f
           WHERE f.follower_id = auth.uid() AND f.followed_id = u.id
         )
  FROM public.users u
  WHERE auth.uid() IS NOT NULL
    AND u.id = p_user_id
    AND u.status = 'active'
    AND NOT public.is_wattar_blocked_between(u.id);
$$;
REVOKE ALL ON FUNCTION public.get_wattar_profile(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_wattar_profile(uuid) TO authenticated;

CREATE TABLE IF NOT EXISTS public.user_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  media_path text NOT NULL UNIQUE,
  caption varchar(500) NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_posts_profile_time
  ON public.user_posts (user_id, created_at DESC);
ALTER TABLE public.user_posts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_posts FROM anon, authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'wattar-posts',
  'wattar-posts',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE OR REPLACE FUNCTION public.wattar_can_manage_post_object(p_path text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL
    AND split_part(p_path, '/', 1) = auth.uid()::text
    AND EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND u.status = 'active'
        AND u.adult_confirmed_at IS NOT NULL
    );
$$;
REVOKE ALL ON FUNCTION public.wattar_can_manage_post_object(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wattar_can_manage_post_object(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.wattar_can_upload_post_object(p_path text)
RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.wattar_can_manage_post_object(p_path)
    AND (
      SELECT count(*) < 10
      FROM storage.objects o
      WHERE o.bucket_id = 'wattar-posts'
        AND split_part(o.name, '/', 1) = auth.uid()::text
        AND o.created_at > now() - interval '24 hours'
    );
$$;
REVOKE ALL ON FUNCTION public.wattar_can_upload_post_object(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wattar_can_upload_post_object(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.wattar_can_read_post_object(p_path text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_posts p
    WHERE p.media_path = p_path
      AND public.wattar_can_view_profile(p.user_id)
  );
$$;
REVOKE ALL ON FUNCTION public.wattar_can_read_post_object(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wattar_can_read_post_object(text) TO authenticated;

DROP POLICY IF EXISTS wattar_post_media_insert ON storage.objects;
CREATE POLICY wattar_post_media_insert
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'wattar-posts'
    AND public.wattar_can_upload_post_object(name)
  );
DROP POLICY IF EXISTS wattar_post_media_read ON storage.objects;
CREATE POLICY wattar_post_media_read
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'wattar-posts'
    AND public.wattar_can_read_post_object(name)
  );
DROP POLICY IF EXISTS wattar_post_media_delete ON storage.objects;
CREATE POLICY wattar_post_media_delete
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'wattar-posts'
    AND public.wattar_can_manage_post_object(name)
  );

CREATE OR REPLACE FUNCTION public.create_my_post(
  p_media_path text,
  p_caption text DEFAULT ''
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_post_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.wattar_can_manage_post_object(p_media_path) THEN
    RAISE EXCEPTION 'غير مصرح بإنشاء المنشور';
  END IF;
  IF p_caption IS NULL OR length(p_caption) > 500 OR NOT EXISTS (
    SELECT 1 FROM storage.objects o
    WHERE o.bucket_id = 'wattar-posts' AND o.name = p_media_path
  ) THEN
    RAISE EXCEPTION 'بيانات المنشور أو صورته غير صالحة';
  END IF;
  IF (
    SELECT count(*) FROM public.user_posts p
    WHERE p.user_id = auth.uid() AND p.created_at > now() - interval '24 hours'
  ) >= 10 THEN
    RAISE EXCEPTION 'وصلت إلى الحد اليومي للمنشورات';
  END IF;

  INSERT INTO public.user_posts (user_id, media_path, caption)
  VALUES (auth.uid(), p_media_path, trim(p_caption))
  RETURNING id INTO v_post_id;
  RETURN v_post_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_my_post(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_my_post(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_wattar_profile_posts(p_user_id uuid)
RETURNS TABLE (
  post_id uuid,
  user_id uuid,
  caption text,
  media_path text,
  created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.id, p.user_id, p.caption::text, p.media_path, p.created_at
  FROM public.user_posts p
  WHERE p.user_id = p_user_id
    AND public.wattar_can_view_profile(p.user_id)
  ORDER BY p.created_at DESC
  LIMIT 100;
$$;
REVOKE ALL ON FUNCTION public.list_wattar_profile_posts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_wattar_profile_posts(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_my_post(p_post_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_media_path text;
BEGIN
  DELETE FROM public.user_posts
  WHERE id = p_post_id AND user_id = auth.uid()
  RETURNING media_path INTO v_media_path;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'المنشور غير موجود أو لا تملك صلاحية حذفه';
  END IF;
  RETURN v_media_path;
END;
$$;
REVOKE ALL ON FUNCTION public.delete_my_post(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_my_post(uuid) TO authenticated;
