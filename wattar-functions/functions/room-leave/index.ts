/**
 * Wattar Edge Function — room-leave
 *
 * مغادرة غرفة: تحديث المقاعد + عدد المستمعين
 *
 * POST /functions/v1/room-leave
 * Body: { "room_id": string }
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
  validateBody,
} from '../_shared/supabase.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return jsonResponse({}, 200);
  if (req.method !== 'POST') return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);

  try {
    const ctx = await authenticate(req);
    const body = await parseBody<{ room_id: string }>(req);
    validateBody(body, ['room_id']);

    const supabase = getSupabaseAdmin();

    // 1) إخلاء المقعد إن كان يشغل واحدًا
    const { data: seat } = await supabase
      .from('room_seats')
      .select('id')
      .eq('room_id', body.room_id)
      .eq('user_id', ctx.user_id)
      .maybeSingle();

    if (seat) {
      await supabase
        .from('room_seats')
        .update({
          user_id: null,
          status: 'empty',
          is_mic_on: false,
          joined_at: null,
        })
        .eq('id', seat.id);
    }

    // 2) تحديث عدد المستمعين
    const { data: room } = await supabase
      .from('rooms')
      .select('listeners_count')
      .eq('id', body.room_id)
      .single();

    if (room) {
      await supabase
        .from('rooms')
        .update({ listeners_count: Math.max(0, room.listeners_count - 1) })
        .eq('id', body.room_id);
    }

    return jsonResponse({ success: true });
  } catch (err) {
    return errorResponse(err);
  }
});
