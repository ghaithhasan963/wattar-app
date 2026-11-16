/**
 * Wattar Edge Function — room-owner-action
 *
 * Applies an owner-scoped room moderation action through the authenticated DB RPC.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import {
  authenticate,
  errorResponse,
  HttpError,
  jsonResponse,
  parseBody,
  rateLimitByUser,
  validateBody,
} from '../_shared/supabase.ts';

type RoomOwnerAction = 'close_room' | 'remove_seat' | 'mute_chat' | 'unmute_chat';
interface RoomOwnerActionBody {
  room_id: string;
  action: RoomOwnerAction;
  target_user_id?: string;
  duration_minutes?: number;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const encoder = new TextEncoder();

function base64Url(value: Uint8Array | string): string {
  const binary = typeof value === 'string' ? value : String.fromCharCode(...value);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function createRoomAdminToken(
  apiKey: string,
  apiSecret: string,
  roomName: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64Url(JSON.stringify({
    iss: apiKey,
    sub: 'wattar-room-moderator',
    nbf: now - 5,
    exp: now + 60,
    video: { roomAdmin: true, room: roomName },
  }));
  const signingInput = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(apiSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(signingInput));
  return `${signingInput}.${base64Url(new Uint8Array(signature))}`;
}

async function removeLiveKitParticipant(roomName: string, identity: string): Promise<void> {
  const liveKitUrl = Deno.env.get('LIVEKIT_URL');
  const apiKey = Deno.env.get('LIVEKIT_API_KEY');
  const apiSecret = Deno.env.get('LIVEKIT_API_SECRET');
  if (!liveKitUrl || !apiKey || !apiSecret) {
    throw new Error('LIVEKIT_NOT_CONFIGURED');
  }

  const endpoint = new URL(liveKitUrl);
  if (endpoint.protocol === 'wss:') endpoint.protocol = 'https:';
  else if (endpoint.protocol === 'ws:') endpoint.protocol = 'http:';
  if (endpoint.protocol !== 'https:' && endpoint.protocol !== 'http:') {
    throw new Error('INVALID_LIVEKIT_URL');
  }
  endpoint.pathname = `${endpoint.pathname.replace(/\/+$/, '')}/twirp/livekit.RoomService/RemoveParticipant`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await createRoomAdminToken(apiKey, apiSecret, roomName)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ room: roomName, identity }),
  });
  if (!response.ok) {
    throw new Error(`LIVEKIT_REMOVE_FAILED_${response.status}`);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return jsonResponse({}, 200);
  if (req.method !== 'POST') return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);

  try {
    const ctx = await authenticate(req);
    await rateLimitByUser(ctx, 'room_owner_action', 20, 60_000);
    const body = validateBody<RoomOwnerActionBody>(
      await parseBody(req),
      ['room_id', 'action'],
    );

    if (!UUID_PATTERN.test(body.room_id)) {
      throw new HttpError(400, 'INVALID_ROOM_ID', 'Invalid room ID');
    }
    if (!['close_room', 'remove_seat', 'mute_chat', 'unmute_chat'].includes(body.action)) {
      throw new HttpError(400, 'INVALID_ACTION', 'Unsupported room action');
    }
    if (body.action !== 'close_room') {
      if (!body.target_user_id || !UUID_PATTERN.test(body.target_user_id)) {
        throw new HttpError(400, 'INVALID_TARGET', 'A valid room member is required');
      }
      if (body.target_user_id === ctx.user_id) {
        throw new HttpError(400, 'INVALID_TARGET', 'You cannot moderate yourself');
      }
    }
    if (body.action === 'mute_chat'
      && (!Number.isInteger(body.duration_minutes)
        || body.duration_minutes! < 1
        || body.duration_minutes! > 1440)) {
      throw new HttpError(400, 'INVALID_DURATION', 'Chat mute duration must be from 1 to 1440 minutes');
    }

    const authorization = req.headers.get('Authorization');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    if (!authorization || !supabaseUrl || !anonKey) {
      throw new HttpError(500, 'ROOM_ACTION_UNAVAILABLE', 'Room controls are not configured');
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authorization } },
    });
    const { data, error } = await userClient.rpc('room_owner_moderation_action', {
      p_room_id: body.room_id,
      p_actor_id: ctx.user_id,
      p_action: body.action,
      p_target_user_id: body.target_user_id ?? null,
      p_duration_minutes: body.duration_minutes ?? null,
    });
    if (error) {
      console.warn('[Wattar] Room owner action rejected:', error.message);
      throw new HttpError(403, 'ROOM_OWNER_ACTION_FAILED', error.message);
    }

    let audioKick: 'removed' | 'not_configured' | 'failed' | null = null;
    if (body.action === 'remove_seat' && body.target_user_id) {
      try {
        await removeLiveKitParticipant(`wattar-room-${body.room_id}`, body.target_user_id);
        audioKick = 'removed';
      } catch (kickError) {
        if (kickError instanceof Error && kickError.message === 'LIVEKIT_NOT_CONFIGURED') {
          audioKick = 'not_configured';
        } else {
          audioKick = 'failed';
          console.error('[Wattar] Failed to remove room participant from LiveKit:', kickError);
        }
      }
    }

    return jsonResponse({ success: true, result: data, audio_kick: audioKick });
  } catch (error) {
    return errorResponse(error);
  }
});
