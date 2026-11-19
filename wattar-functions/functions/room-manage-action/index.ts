/**
 * Wattar Edge Function — room-manage-action
 *
 * Unified room management for owners, second admins, moderators, platform
 * admins, and scoped agency staff. Applies the action through the audited
 * DB RPC room_manage_action and mirrors audio-side effects on LiveKit
 * (RemoveParticipant / MuteParticipant) when configured.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import {
  requireNotMaintenance,
  authenticate,
  errorResponse,
  HttpError,
  jsonResponse,
  parseBody,
  rateLimitByUser,
  validateBody,
} from '../_shared/supabase.ts';

type RoomManageAction =
  | 'close_room' | 'reopen_room'
  | 'lower_user' | 'kick_user'
  | 'mute_mic' | 'unmute_mic'
  | 'mute_chat' | 'unmute_chat'
  | 'ban_user' | 'unban_user'
  | 'lock_seats' | 'unlock_seats'
  | 'mute_audience' | 'unmute_audience'
  | 'set_password' | 'clear_password'
  | 'appoint_moderator' | 'remove_moderator'
  | 'appoint_second_admin' | 'remove_second_admin'
  | 'handover_owner'
  | 'accept_seat_request' | 'reject_seat_request';

const ACTIONS: RoomManageAction[] = [
  'close_room', 'reopen_room', 'lower_user', 'kick_user',
  'mute_mic', 'unmute_mic', 'mute_chat', 'unmute_chat',
  'ban_user', 'unban_user', 'lock_seats', 'unlock_seats',
  'mute_audience', 'unmute_audience', 'set_password', 'clear_password',
  'appoint_moderator', 'remove_moderator',
  'appoint_second_admin', 'remove_second_admin', 'handover_owner',
  'accept_seat_request', 'reject_seat_request',
];

const TARGET_ACTIONS: RoomManageAction[] = [
  'lower_user', 'kick_user', 'mute_mic', 'unmute_mic', 'mute_chat', 'unmute_chat',
  'ban_user', 'unban_user', 'appoint_moderator', 'remove_moderator',
  'appoint_second_admin', 'remove_second_admin', 'handover_owner',
  'accept_seat_request', 'reject_seat_request',
];

const KICK_LIVEKIT_ACTIONS: RoomManageAction[] = ['lower_user', 'kick_user', 'ban_user'];
const MUTE_LIVEKIT_ACTIONS: RoomManageAction[] = ['mute_mic', 'unmute_mic'];

interface RoomManageActionBody {
  room_id: string;
  action: RoomManageAction;
  target_user_id?: string;
  duration_minutes?: number;
  password?: string;
  reason?: string;
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

async function livekitRoomService(
  method: 'RemoveParticipant' | 'MuteParticipant',
  roomName: string,
  identity: string,
  muted?: boolean,
): Promise<'applied' | 'not_configured' | 'failed'> {
  const liveKitUrl = Deno.env.get('LIVEKIT_URL');
  const apiKey = Deno.env.get('LIVEKIT_API_KEY');
  const apiSecret = Deno.env.get('LIVEKIT_API_SECRET');
  if (!liveKitUrl || !apiKey || !apiSecret) {
    return 'not_configured';
  }

  const endpoint = new URL(liveKitUrl);
  if (endpoint.protocol === 'wss:') endpoint.protocol = 'https:';
  else if (endpoint.protocol === 'ws:') endpoint.protocol = 'http:';
  if (endpoint.protocol !== 'https:' && endpoint.protocol !== 'http:') {
    return 'failed';
  }
  endpoint.pathname = `${endpoint.pathname.replace(/\/+$/, '')}/twirp/livekit.RoomService/${method}`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await createRoomAdminToken(apiKey, apiSecret, roomName)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(method === 'MuteParticipant' ? { room: roomName, identity, muted } : { room: roomName, identity }),
    });
    return response.ok ? 'applied' : 'failed';
  } catch (error) {
    console.error(`[Wattar] LiveKit ${method} failed:`, error);
    return 'failed';
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return jsonResponse({}, 200);
  if (req.method !== 'POST') return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);

  try {
    const ctx = await authenticate(req);
    await requireNotMaintenance(ctx);
    await rateLimitByUser(ctx, 'room_manage_action', 30, 60_000);
    const body = validateBody<RoomManageActionBody>(
      await parseBody(req),
      ['room_id', 'action'],
    );

    if (!UUID_PATTERN.test(body.room_id)) {
      throw new HttpError(400, 'INVALID_ROOM_ID', 'Invalid room ID');
    }
    if (!ACTIONS.includes(body.action)) {
      throw new HttpError(400, 'INVALID_ACTION', 'Unsupported room action');
    }
    if (TARGET_ACTIONS.includes(body.action)) {
      if (!body.target_user_id || !UUID_PATTERN.test(body.target_user_id)) {
        throw new HttpError(400, 'INVALID_TARGET', 'A valid room member is required');
      }
      if (body.target_user_id === ctx.user_id) {
        throw new HttpError(400, 'INVALID_TARGET', 'You cannot moderate yourself');
      }
    } else if (body.target_user_id) {
      throw new HttpError(400, 'INVALID_TARGET', 'This action does not take a target');
    }
    if (body.action === 'mute_chat'
      && (!Number.isInteger(body.duration_minutes)
        || body.duration_minutes! < 1
        || body.duration_minutes! > 1440)) {
      throw new HttpError(400, 'INVALID_DURATION', 'Chat mute duration must be from 1 to 1440 minutes');
    }
    if (body.action === 'ban_user' && body.duration_minutes !== undefined
      && (!Number.isInteger(body.duration_minutes)
        || body.duration_minutes < 1
        || body.duration_minutes > 10080)) {
      throw new HttpError(400, 'INVALID_DURATION', 'Ban duration must be from 1 to 10080 minutes or permanent');
    }
    if (body.action !== 'mute_chat' && body.action !== 'ban_user' && body.duration_minutes !== undefined) {
      throw new HttpError(400, 'INVALID_DURATION', 'This action does not take a duration');
    }
    if (body.action === 'set_password') {
      const password = (body.password ?? '').trim();
      if (password.length < 4 || password.length > 50) {
        throw new HttpError(400, 'INVALID_PASSWORD', 'Room password must be from 4 to 50 characters');
      }
    } else if (body.password !== undefined) {
      throw new HttpError(400, 'INVALID_PASSWORD', 'This action does not take a password');
    }
    if (body.reason !== undefined && body.reason.trim().length > 200) {
      throw new HttpError(400, 'INVALID_REASON', 'Reason must be at most 200 characters');
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
    const { data, error } = await userClient.rpc('room_manage_action', {
      p_room_id: body.room_id,
      p_actor_id: ctx.user_id,
      p_action: body.action,
      p_target_user_id: body.target_user_id ?? null,
      p_duration_minutes: body.duration_minutes ?? null,
      p_password: body.action === 'set_password' ? body.password!.trim() : null,
      p_reason: body.reason?.trim() || null,
    });
    if (error) {
      console.warn('[Wattar] Room manage action rejected:', error.message);
      throw new HttpError(403, 'ROOM_MANAGE_ACTION_FAILED', error.message);
    }

    const liveKitRoom = `wattar-room-${body.room_id}`;
    let audio_kick: 'applied' | 'not_configured' | 'failed' | null = null;
    let audio_mute: 'applied' | 'not_configured' | 'failed' | null = null;
    if (KICK_LIVEKIT_ACTIONS.includes(body.action) && body.target_user_id) {
      audio_kick = await livekitRoomService('RemoveParticipant', liveKitRoom, body.target_user_id);
    }
    if (MUTE_LIVEKIT_ACTIONS.includes(body.action) && body.target_user_id) {
      audio_mute = await livekitRoomService(
        'MuteParticipant',
        liveKitRoom,
        body.target_user_id,
        body.action === 'mute_mic',
      );
    }

    return jsonResponse({ success: true, result: data, audio_kick, audio_mute });
  } catch (error) {
    return errorResponse(error);
  }
});
