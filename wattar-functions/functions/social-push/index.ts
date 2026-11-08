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

type SocialEvent = 'friend_request' | 'private_message' | 'room_invitation' | 'dice_challenge';
type PushToken = { user_id: string; expo_push_token: string };

interface PushRequest {
  event_type: SocialEvent;
  reference_id: string;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return jsonResponse({}, 200);
  if (req.method !== 'POST') return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);

  try {
    const ctx = await authenticate(req);
    rateLimitByUser(ctx, 'social_push', 20, 60_000);
    const body = validateBody<PushRequest>(
      await parseBody<PushRequest>(req),
      ['event_type', 'reference_id'],
    );
    if (!['friend_request', 'private_message', 'room_invitation', 'dice_challenge'].includes(body.event_type)
      || !uuidPattern.test(body.reference_id)) {
      throw new HttpError(400, 'INVALID_REQUEST', 'Invalid social notification request');
    }

    const supabase = getSupabaseAdmin();
    const { data: sender, error: senderError } = await supabase
      .from('users')
      .select('display_name, username')
      .eq('id', ctx.user_id)
      .single();
    if (senderError || !sender) throw new HttpError(404, 'USER_NOT_FOUND', 'User profile not found');
    const senderName = sender.display_name || sender.username || 'صديقك';

    let recipientIds: string[] = [];
    let route = '/(tabs)/friends';
    let title = 'إشعار جديد';
    let message = 'لديك تحديث جديد في Wattar.';

    if (body.event_type === 'friend_request') {
      const { data, error } = await supabase
        .from('friend_requests')
        .select('recipient_id')
        .eq('id', body.reference_id)
        .eq('requester_id', ctx.user_id)
        .eq('status', 'pending')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new HttpError(404, 'REQUEST_NOT_FOUND', 'Friend request not found');
      recipientIds = [data.recipient_id];
      title = 'طلب صداقة جديد';
      message = `${senderName} أرسل إليك طلب صداقة.`;
    } else if (body.event_type === 'private_message') {
      const { data: sentMessage, error: messageError } = await supabase
        .from('private_messages')
        .select('conversation_id')
        .eq('id', body.reference_id)
        .eq('sender_id', ctx.user_id)
        .maybeSingle();
      if (messageError) throw messageError;
      if (!sentMessage) throw new HttpError(404, 'MESSAGE_NOT_FOUND', 'Message not found');
      const { data: conversation, error: conversationError } = await supabase
        .from('private_conversations')
        .select('user_one_id, user_two_id')
        .eq('id', sentMessage.conversation_id)
        .maybeSingle();
      if (conversationError) throw conversationError;
      if (!conversation || ![conversation.user_one_id, conversation.user_two_id].includes(ctx.user_id)) {
        throw new HttpError(403, 'FORBIDDEN', 'Not a conversation participant');
      }
      recipientIds = [conversation.user_one_id === ctx.user_id
        ? conversation.user_two_id
        : conversation.user_one_id];
      route = `/messages/${sentMessage.conversation_id}`;
      title = `رسالة من ${senderName}`;
      message = 'أرسل إليك رسالة خاصة.';
    } else if (body.event_type === 'room_invitation') {
      const { data, error } = await supabase
        .from('room_invitations')
        .select('recipient_id')
        .eq('id', body.reference_id)
        .eq('sender_id', ctx.user_id)
        .eq('status', 'pending')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new HttpError(404, 'INVITATION_NOT_FOUND', 'Room invitation not found');
      recipientIds = [data.recipient_id];
      title = 'دعوة إلى غرفة صوتية';
      message = `${senderName} دعاك للانضمام إلى غرفة صوتية.`;
    } else {
      const { data: challenge, error: challengeError } = await supabase
        .from('game_challenges')
        .select('id')
        .eq('id', body.reference_id)
        .eq('creator_id', ctx.user_id)
        .eq('status', 'pending')
        .maybeSingle();
      if (challengeError) throw challengeError;
      if (!challenge) throw new HttpError(404, 'CHALLENGE_NOT_FOUND', 'Challenge not found');
      const { data: players, error: playersError } = await supabase
        .from('game_challenge_players')
        .select('user_id')
        .eq('challenge_id', challenge.id)
        .eq('status', 'pending');
      if (playersError) throw playersError;
      recipientIds = (players ?? []).map((player) => player.user_id);
      title = 'تحدي نرد جديد';
      message = `${senderName} دعاك إلى تحدٍ مجاني.`;
    }

    const uniqueRecipientIds = [...new Set(recipientIds)].filter((id) => id !== ctx.user_id);
    if (!uniqueRecipientIds.length) return jsonResponse({ sent: 0, failed: 0 });

    const { data: blocked, error: blockError } = await supabase
      .from('user_blocks')
      .select('blocker_id, blocked_id')
      .or(`and(blocker_id.eq.${ctx.user_id},blocked_id.in.(${uniqueRecipientIds.join(',')})),and(blocked_id.eq.${ctx.user_id},blocker_id.in.(${uniqueRecipientIds.join(',')}))`);
    if (blockError) throw blockError;
    const blockedIds = new Set((blocked ?? []).flatMap((block) =>
      block.blocker_id === ctx.user_id ? [block.blocked_id] : [block.blocker_id]));
    const allowedRecipientIds = uniqueRecipientIds.filter((id) => !blockedIds.has(id));
    if (!allowedRecipientIds.length) return jsonResponse({ sent: 0, failed: 0 });

    const { data: tokens, error: tokenError } = await supabase
      .from('push_tokens')
      .select('user_id, expo_push_token')
      .in('user_id', allowedRecipientIds);
    if (tokenError) throw tokenError;
    const pushTokens = (tokens ?? []) as PushToken[];
    if (!pushTokens.length) return jsonResponse({ sent: 0, failed: 0 });

    let sent = 0;
    let failed = 0;
    for (let offset = 0; offset < pushTokens.length; offset += 100) {
      const batch = pushTokens.slice(offset, offset + 100);
      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(batch.map((token) => ({
          to: token.expo_push_token,
          title,
          body: message,
          sound: 'default',
          channelId: 'social',
          priority: 'high',
          data: { route },
        }))),
      });
      if (!response.ok) throw new HttpError(502, 'PUSH_DELIVERY_FAILED', 'Push notification service failed');
      const result = await response.json();
      const tickets = Array.isArray(result.data) ? result.data : [];
      sent += tickets.filter((ticket: { status?: string }) => ticket.status === 'ok').length;
      const invalidTokens = tickets.flatMap((ticket: {
        status?: string;
        details?: { error?: string };
      }, index: number) => {
        if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
          failed += 1;
          return [batch[index]?.expo_push_token].filter((token): token is string => Boolean(token));
        }
        if (ticket.status === 'error') failed += 1;
        return [];
      });
      if (invalidTokens.length) {
        const { error } = await supabase.from('push_tokens').delete().in('expo_push_token', invalidTokens);
        if (error) throw error;
      }
      if (tickets.length !== batch.length) failed += Math.max(0, batch.length - tickets.length);
    }

    return jsonResponse({ sent, failed });
  } catch (error) {
    return errorResponse(error);
  }
});
