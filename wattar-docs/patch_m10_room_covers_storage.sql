-- M10.1: Room cover customization storage bucket/policies
-- Public read, authenticated owner-scoped write/update/delete.
-- Path convention: {user_id}/room-{room_id}_{timestamp}.{ext}

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'room-covers',
  'room-covers',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS wattar_room_covers_public_read ON storage.objects;
CREATE POLICY wattar_room_covers_public_read
  ON storage.objects FOR SELECT
  USING (bucket_id = 'room-covers');

DROP POLICY IF EXISTS wattar_room_covers_owner_insert ON storage.objects;
CREATE POLICY wattar_room_covers_owner_insert
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'room-covers'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS wattar_room_covers_owner_update ON storage.objects;
CREATE POLICY wattar_room_covers_owner_update
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'room-covers'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'room-covers'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS wattar_room_covers_owner_delete ON storage.objects;
CREATE POLICY wattar_room_covers_owner_delete
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'room-covers'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
