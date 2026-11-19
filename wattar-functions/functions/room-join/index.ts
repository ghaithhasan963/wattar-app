/**
 * Wattar Edge Function — room-join
 *
 * Records a room listener session and publishes its real join event.
 */
import {
  requireNotMaintenance,
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
    await requireNotMaintenance(ctx);
    await rateLimitByUser(ctx, 'room_join', 60, 60_000);
    const body = validateBody<{ room_id: string; session_id: string; password?: string }>(
      await parseBody(req),
      ['room_id', 'session_id'],
    );
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.room_id)) {
      throw new HttpError(400, 'INVALID_ROOM_ID', 'Invalid room ID');
    }
    if (!/^[A-Za-z0-9._:-]{8,100}$/.test(body.session_id)) {
      throw new HttpError(400, 'INVALID_SESSION_ID', 'Invalid room session ID');
    }

    const admin = getSupabaseAdmin();
    const { data: room, error: roomErr } = await admin
      .from('rooms')
      .select('id, status, has_password, owner_id, second_admin_id')
      .eq('id', body.room_id)
      .maybeSingle();
    if (roomErr) throw roomErr;
    if (!room) throw new HttpError(404, 'ROOM_NOT_FOUND', 'الغرفة غير موجودة');
    if (room.status !== 'waiting' && room.status !== 'live') {
      throw new HttpError(403, 'ROOM_CLOSED', 'الغرفة مغلقة');
    }

    let actorRole: string | null = null;
    const { data: roleResult, error: roleErr } = await admin.rpc('room_actor_role', {
      p_room_id: room.id,
      p_user_id: ctx.user_id,
    });
    if (roleErr) throw roleErr;
    actorRole = (roleResult as string | null) ?? null;

    const { data: banRows, error: banErr } = await admin
      .from('room_bans')
      .select('expires_at')
      .eq('room_id', room.id)
      .eq('user_id', ctx.user_id)
      .limit(1);
    if (banErr) throw banErr;
    const activeBan = (banRows ?? []).find(
      (row: { expires_at: string | null }) => !row.expires_at || new Date(row.expires_at) > new Date(),
    );
    if (activeBan) {
      throw new HttpError(403, 'ROOM_BANNED', 'أنت محظور من هذه الغرفة');
    }

    // كلمة المرور قبل تسجيل الحضور (D4)
    if (room.has_password && !actorRole && room.owner_id !== ctx.user_id) {
      const supplied = (body.password ?? '').trim();
      if (!supplied) {
        throw new HttpError(401, 'ROOM_PASSWORD_REQUIRED', 'هذه الغرفة محمية بكلمة مرور');
      }
      const { data: check, error: checkErr } = await admin.rpc('room_password_check', {
        p_room_id: room.id,
        p_user_id: ctx.user_id,
        p_password: supplied,
      });
      if (checkErr) throw checkErr;
      const result = (check ?? {}) as { ok?: boolean; locked?: boolean; retry_after_seconds?: number };
      if (result.locked) {
        return jsonResponse({
          error: 'ROOM_PASSWORD_LOCKED',
          message: 'محاولات كثيرة خاطئة؛ انتظر قبل إعادة المحاولة',
          retry_after_seconds: result.retry_after_seconds ?? 600,
        }, 429);
      }
      if (!result.ok) {
        throw new HttpError(403, 'WRONG_ROOM_PASSWORD', 'كلمة مرور الغرفة غير صحيحة');
      }
    }

    const { data: listenerCount, error } = await admin.rpc('record_wattar_room_presence', {
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
