/**
 * Wattar Edge Function — livekit-token
 *
 * توليد توكن انضمام لغرفة صوتية LiveKit (HMAC-SHA256 يدويًا — بلا مكتبات خارجية)
 *
 * المتغيرات المطلوبة (supabase secrets set):
 *   LIVEKIT_URL        مثل: wss://wattar-xxxx.livekit.cloud
 *   LIVEKIT_API_KEY    مفتاح API من لوحة LiveKit
 *   LIVEKIT_API_SECRET السر المقابل
 *
 * POST /functions/v1/livekit-token
 * Body: { "room_id": string }
 *
 * الاستجابة:
 *   200 → { url, token, room, identity }
 *   501 → { error: "LIVEKIT_NOT_CONFIGURED" } إن لم تُضبط الأسرار (يعمل التطبيق بلا صوت)
 *
 * @version 1.0.1
 */
import {
  authenticate,
  getSupabaseAdmin,
  jsonResponse,
  HttpError,
  parseBody,
  rateLimitByUser,
  validateBody,
} from '../_shared/supabase.ts';

const enc = new TextEncoder();

function b64url(bytes: Uint8Array | string): string {
  const bin = typeof bytes === 'string' ? bytes : String.fromCharCode(...bytes);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmacSha256(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return new Uint8Array(sig);
}

interface LiveKitClaims {
  exp: number;
  iss: string;
  nbf: number;
  sub: string;
  name: string;
  video: {
    roomJoin: boolean;
    room: string;
    canPublish: boolean;
    canSubscribe: boolean;
    canPublishData: boolean;
  };
}

async function createLiveKitToken(
  apiKey: string,
  apiSecret: string,
  identity: string,
  roomName: string,
  displayName: string,
  ttlSeconds: number,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: LiveKitClaims = {
    exp: now + ttlSeconds,
    iss: apiKey,
    nbf: now - 10,
    sub: identity,
    name: displayName,
    video: {
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    },
  };

  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const signingInput = `${header}.${body}`;
  const signature = await hmacSha256(apiSecret, signingInput);
  return `${signingInput}.${b64url(signature)}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return jsonResponse({}, 200);
  if (req.method !== 'POST') return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);

  try {
    const ctx = await authenticate(req);
    rateLimitByUser(ctx, 'livekit_token', 10, 60_000);

    const body = await parseBody<{ room_id: string }>(req);
    validateBody(body, ['room_id']);

    const LIVEKIT_URL = Deno.env.get('LIVEKIT_URL');
    const LIVEKIT_API_KEY = Deno.env.get('LIVEKIT_API_KEY');
    const LIVEKIT_API_SECRET = Deno.env.get('LIVEKIT_API_SECRET');

    // الصوت غير مفعّل — التطبيق يستمر بدون صوت مع رسالة واضحة
    if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
      return jsonResponse({ error: 'LIVEKIT_NOT_CONFIGURED' }, 501);
    }

    const supabase = getSupabaseAdmin();

    // الغرفة يجب أن تكون موجودة ومفتوحة
    const { data: room, error: roomErr } = await supabase
      .from('rooms')
      .select('id, status, is_private, owner_id')
      .eq('id', body.room_id)
      .single();
    if (roomErr || !room) throw new HttpError(404, 'ROOM_NOT_FOUND', 'الغرفة غير موجودة');
    if (room.status !== 'waiting' && room.status !== 'live') {
      throw new HttpError(403, 'ROOM_CLOSED', 'الغرفة مغلقة');
    }
    if (room.is_private && room.owner_id !== ctx.user_id) {
      const { data: invitation, error: invitationErr } = await supabase
        .from('room_invitations')
        .select('id')
        .eq('room_id', room.id)
        .eq('recipient_id', ctx.user_id)
        .eq('status', 'accepted')
        .maybeSingle();
      if (invitationErr) throw invitationErr;
      if (!invitation) throw new HttpError(403, 'PRIVATE_ROOM', 'الغرفة خاصة');
    }

    // M1.7 + M1.6: الحظر وخصوصية الغرف تُفحص قبل إصدار التوكن،
    // لأن التوكن يُصدر مباشرة ولا يمرّ إلزاماً بدالة room-join.
    if (room.owner_id !== ctx.user_id) {
      const [
        { data: blockedByOwner, error: blockedByOwnerErr },
        { data: ownerBlockedByMe, error: ownerBlockedByMeErr },
      ] = await Promise.all([
        supabase
          .from('user_blocks')
          .select('blocker_id')
          .eq('blocker_id', room.owner_id)
          .eq('blocked_id', ctx.user_id)
          .limit(1),
        supabase
          .from('user_blocks')
          .select('blocked_id')
          .eq('blocker_id', ctx.user_id)
          .eq('blocked_id', room.owner_id)
          .limit(1),
      ]);
      if (blockedByOwnerErr) throw blockedByOwnerErr;
      if (ownerBlockedByMeErr) throw ownerBlockedByMeErr;
      if ((blockedByOwner?.length ?? 0) > 0 || (ownerBlockedByMe?.length ?? 0) > 0) {
        throw new HttpError(403, 'USER_BLOCKED', 'لا يمكنك دخول غرفة هذا المستخدم');
      }

      const { data: canEnter, error: privacyErr } = await supabase.rpc('check_privacy_permission', {
        p_target_user_id: room.owner_id,
        p_action: 'enter_rooms',
        p_actor_user_id: ctx.user_id,
      });
      if (privacyErr) throw privacyErr;
      if (canEnter !== true) {
        throw new HttpError(403, 'ROOM_PRIVACY_RESTRICTED', 'صاحب الغرفة لا يسمح لك بدخول غرفته');
      }
    }

    const roomName = `wattar-room-${room.id}`;
    const identity = ctx.user_id;

    // اسم العرض من جدول المستخدمين
    const { data: profile } = await supabase
      .from('users')
      .select('display_name, username')
      .eq('id', identity)
      .single();
    const displayName = profile?.display_name || profile?.username || 'user';

    const token = await createLiveKitToken(
      LIVEKIT_API_KEY,
      LIVEKIT_API_SECRET,
      identity,
      roomName,
      displayName,
      60 * 60 * 6, // صلاحية 6 ساعات
    );

    return jsonResponse({
      url: LIVEKIT_URL,
      token,
      room: roomName,
      identity,
    });
  } catch (e) {
    if (e instanceof HttpError) {
      return jsonResponse({ error: e.code, message: e.message }, e.status);
    }
    console.error('livekit-token error:', e);
    return jsonResponse({ error: 'INTERNAL_ERROR', message: 'خطأ غير متوقع' }, 500);
  }
});
