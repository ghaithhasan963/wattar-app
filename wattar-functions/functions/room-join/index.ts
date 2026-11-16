/**
 * Wattar Edge Function — room-join
 *
 * Records a room listener session and publishes its real join event.
 */
import {
  authenticate,
  errorResponse,
  getSupabaseAdmin,
  HttpError,
  jsonResponse,
  parseBody,
  rateLimitByUser,
  validateBody,
} from '../_shared/supabase.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return jsonResponse({}, 200);
  if (req.method !== 'POST') return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);

  try {
    const ctx = await authenticate(req);
    await rateLimitByUser(ctx, 'room_join', 60, 60_000);
    const body = validateBody<{ room_id: string; session_id: string }>(
      await parseBody(req),
      ['room_id', 'session_id'],
    );
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.room_id)) {
      throw new HttpError(400, 'INVALID_ROOM_ID', 'Invalid room ID');
    }
    if (!/^[A-Za-z0-9._:-]{8,100}$/.test(body.session_id)) {
      throw new HttpError(400, 'INVALID_SESSION_ID', 'Invalid room session ID');
    }

    const { data: listenerCount, error } = await getSupabaseAdmin().rpc('record_wattar_room_presence', {
      p_room_id: body.room_id,
      p_user_id: ctx.user_id,
      p_session_id: body.session_id,
      p_joining: true,
    });
    if (error) throw new HttpError(403, 'ROOM_JOIN_FAILED', error.message);

    return jsonResponse({ success: true, listener_count: listenerCount });
  } catch (error) {
    return errorResponse(error);
  }
});
