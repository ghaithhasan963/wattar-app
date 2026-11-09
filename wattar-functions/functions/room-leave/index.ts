/**
 * Wattar Edge Function — room-leave
 *
 * مغادرة جلسة غرفة: تحرير المقعد وتحديث الحضور وعدد المستمعين.
 *
 * POST /functions/v1/room-leave
 * Body: { "room_id": string, "session_id"?: string }
 *
 * @version 1.0.0
 */
import {
  authenticate,
  errorResponse,
  jsonResponse,
  getSupabaseAdmin,
  HttpError,
  parseBody,
  rateLimitByUser,
  validateBody,
} from '../_shared/supabase.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return jsonResponse({}, 200);
  if (req.method !== 'POST') return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);

  try {
    const ctx = await authenticate(req);
    rateLimitByUser(ctx, 'room_leave', 60, 60_000);
    const body = validateBody<{ room_id: string; session_id?: string }>(
      await parseBody(req),
      ['room_id'],
    );
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.room_id)) {
      throw new HttpError(400, 'INVALID_ROOM_ID', 'Invalid room ID');
    }
    if (body.session_id !== undefined && !/^[A-Za-z0-9._:-]{8,100}$/.test(body.session_id)) {
      throw new HttpError(400, 'INVALID_SESSION_ID', 'Invalid room session ID');
    }

    const { error } = await getSupabaseAdmin().rpc('record_wattar_room_presence', {
      p_room_id: body.room_id,
      p_user_id: ctx.user_id,
      p_session_id: body.session_id ?? null,
      p_joining: false,
    });
    if (error) throw new HttpError(409, 'ROOM_LEAVE_FAILED', error.message);

    return jsonResponse({ success: true });
  } catch (err) {
    return errorResponse(err);
  }
});
