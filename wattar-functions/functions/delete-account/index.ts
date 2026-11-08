import {
  errorResponse,
  getSupabaseAdmin,
  HttpError,
  jsonResponse,
} from '../_shared/supabase.ts';

const STORAGE_CLEANUP_BATCH_SIZE = 100;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return jsonResponse({}, 200);
  if (req.method !== 'POST') return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);

  try {
    const authorization = req.headers.get('Authorization');
    if (!authorization?.startsWith('Bearer ')) {
      throw new HttpError(401, 'UNAUTHORIZED', 'Missing authorization header');
    }

    const supabase = getSupabaseAdmin();
    const { data: { user }, error: authError } = await supabase.auth.getUser(authorization.slice(7));
    if (authError || !user) {
      throw new HttpError(401, 'INVALID_TOKEN', 'Invalid or expired token');
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new HttpError(400, 'INVALID_JSON', 'Request body must be valid JSON');
    }
    if (
      typeof body !== 'object'
      || body === null
      || !('confirmation' in body)
      || body.confirmation !== 'DELETE'
    ) {
      throw new HttpError(400, 'CONFIRMATION_REQUIRED', 'Explicit account deletion confirmation is required');
    }

    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('id, anonymized_at')
      .eq('id', user.id)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile) throw new HttpError(404, 'USER_NOT_FOUND', 'User profile not found');

    if (!profile.anonymized_at) {
      const { error: anonymizeError } = await supabase.rpc('anonymize_my_account', {
        p_user_id: user.id,
      });
      if (anonymizeError) throw anonymizeError;
    }

    while (true) {
      const { data: media, error: mediaError } = await supabase
        .from('account_cleanup_storage')
        .select('bucket_id, object_path')
        .eq('user_id', user.id)
        .order('bucket_id')
        .order('object_path')
        .limit(STORAGE_CLEANUP_BATCH_SIZE);
      if (mediaError) throw mediaError;
      if (!media?.length) break;

      const buckets = new Map<string, string[]>();
      for (const item of media) {
        const paths = buckets.get(item.bucket_id) ?? [];
        paths.push(item.object_path);
        buckets.set(item.bucket_id, paths);
      }

      for (const [bucket, paths] of buckets) {
        const { error: storageError } = await supabase.storage.from(bucket).remove(paths);
        if (storageError) {
          throw new HttpError(502, 'STORAGE_CLEANUP_FAILED', 'Could not remove account media; retry the request');
        }

        const { error: queueError } = await supabase
          .from('account_cleanup_storage')
          .delete()
          .eq('user_id', user.id)
          .eq('bucket_id', bucket)
          .in('object_path', paths);
        if (queueError) throw queueError;
      }
    }

    const { error: deleteError } = await supabase.auth.admin.deleteUser(user.id);
    if (deleteError) throw deleteError;

    return jsonResponse({ success: true });
  } catch (err) {
    return errorResponse(err);
  }
});
