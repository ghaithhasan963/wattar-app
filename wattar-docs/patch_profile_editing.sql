-- Enables safe self-service profile updates and public avatar images.
-- Run in the Supabase SQL Editor after checking the username-duplicate preflight.

DO $$
BEGIN
  IF EXISTS (
    SELECT lower(username)
    FROM public.users
    GROUP BY lower(username)
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Profile patch stopped: duplicate usernames exist (case-insensitive). Resolve duplicates before applying.';
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower_unique
  ON public.users (lower(username));

CREATE OR REPLACE FUNCTION public.update_my_profile(
  p_username text,
  p_display_name text,
  p_bio text,
  p_avatar_url text
)
RETURNS SETOF public.users
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_username text := lower(trim(coalesce(p_username, '')));
  v_display_name text := nullif(trim(coalesce(p_display_name, '')), '');
  v_bio text := nullif(trim(coalesce(p_bio, '')), '');
  v_profile public.users%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول لتعديل الملف الشخصي';
  END IF;

  IF v_username !~ '^[a-z0-9_]{3,30}$' THEN
    RAISE EXCEPTION 'اسم المستخدم يجب أن يتكون من 3 إلى 30 حرفًا أو رقمًا أو شرطة سفلية';
  END IF;
  IF length(v_display_name) > 80 THEN
    RAISE EXCEPTION 'الاسم الظاهر لا يمكن أن يتجاوز 80 حرفًا';
  END IF;
  IF length(v_bio) > 160 THEN
    RAISE EXCEPTION 'النبذة لا يمكن أن تتجاوز 160 حرفًا';
  END IF;
  IF p_avatar_url IS NOT NULL
     AND p_avatar_url !~ ('/storage/v1/object/public/avatars/' || v_user_id::text || '/[^/]+$') THEN
    RAISE EXCEPTION 'رابط الصورة غير صالح';
  END IF;

  UPDATE public.users
  SET username = v_username,
      display_name = v_display_name,
      bio = v_bio,
      avatar_url = p_avatar_url
  WHERE id = v_user_id
  RETURNING * INTO v_profile;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'تعذر العثور على ملف المستخدم';
  END IF;

  RETURN NEXT v_profile;
END;
$$;

REVOKE ALL ON FUNCTION public.update_my_profile(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_my_profile(text, text, text, text) TO authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatars', 'avatars', true, 5242880, ARRAY['image/jpeg', 'image/png'])
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS wattar_avatars_public_read ON storage.objects;
CREATE POLICY wattar_avatars_public_read
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS wattar_avatars_owner_insert ON storage.objects;
CREATE POLICY wattar_avatars_owner_insert
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS wattar_avatars_owner_update ON storage.objects;
CREATE POLICY wattar_avatars_owner_update
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS wattar_avatars_owner_delete ON storage.objects;
CREATE POLICY wattar_avatars_owner_delete
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
