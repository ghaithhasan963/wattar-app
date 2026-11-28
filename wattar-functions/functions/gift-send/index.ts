import {
  requireNotMaintenance,
  authenticate,
  errorResponse,
  jsonResponse,
  getSupabaseAdmin,
  HttpError,
  parseBody,
  rateLimitByUser,
  validateBody,
} from '../_shared/supabase.ts';

interface GiftSendBody {
  to_user_id: string;
  gift_id: string;
  quantity?: number;
  room_id?: string;
  message?: string;
  funding_currency?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return jsonResponse({}, 200);
  if (req.method !== 'POST') return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);

  try {
    const ctx = await authenticate(req);
    await requireNotMaintenance(ctx);
    await rateLimitByUser(ctx, 'send_gift', 2, 1000);

    const body = await parseBody<GiftSendBody>(req);
    validateBody(body, ['to_user_id', 'gift_id']);

    const quantity = body.quantity ?? 1;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
      throw new HttpError(400, 'INVALID_QUANTITY', 'Quantity must be an integer from 1 to 100');
    }
    if (body.message !== undefined && body.message.length > 500) {
      throw new HttpError(400, 'MESSAGE_TOO_LONG', 'Gift message cannot exceed 500 characters');
    }
    if (body.funding_currency !== undefined && body.funding_currency !== 'gold') {
      throw new HttpError(400, 'INVALID_FUNDING_CURRENCY', 'Gifts can only be funded with Coin');
    }
    const fundingCurrency = 'gold';

    const idempotencyKey = req.headers.get('X-Idempotency-Key')?.trim();
    if (!idempotencyKey || !/^[A-Za-z0-9._:-]{10,90}$/.test(idempotencyKey)) {
      throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'A valid X-Idempotency-Key header is required');
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.rpc('settle_gift_send', {
      p_from_user_id: ctx.user_id,
      p_to_user_id: body.to_user_id,
      p_gift_id: body.gift_id,
      p_quantity: quantity,
      p_room_id: body.room_id ?? null,
      p_message: body.message ?? null,
      p_idempotency_key: idempotencyKey,
      p_funding_currency: fundingCurrency,
    });

    if (error) {
      if (error.code === 'P0001') {
        throw new HttpError(400, 'GIFT_REJECTED', error.message);
      }
      console.error('[Wattar] Atomic gift settlement failed:', error);
      throw new HttpError(500, 'GIFT_SETTLEMENT_FAILED', 'Failed to send gift');
    }
    if (!data || typeof data !== 'object') {
      throw new HttpError(500, 'GIFT_SETTLEMENT_FAILED', 'Gift settlement was not returned');
    }

    const result = data as Record<string, unknown>;

    // إدراج حدث الهدية في شات الغرفة حتى يراه الجميع ويظهر في سجل المحادثة.
    // نتخطى التكرار إذا كانت العملية مُعادَة (idempotent replay).
    if (body.room_id && !result.already_processed) {
      try {
        const giftName = String(result.gift_name ?? 'هدية');
        const [senderProfile, receiverProfile] = await Promise.all([
          supabase.from('users').select('username, display_name').eq('id', ctx.user_id).maybeSingle(),
          supabase.from('users').select('username, display_name').eq('id', body.to_user_id).maybeSingle(),
        ]);
        const senderName = senderProfile.data?.display_name ?? senderProfile.data?.username ?? 'عضو';
        const receiverName = receiverProfile.data?.display_name ?? receiverProfile.data?.username ?? 'عضو';
        const giftLabel = quantity > 1 ? `${quantity}x ${giftName}` : giftName;
        await supabase.from('room_messages').insert({
          room_id: body.room_id,
          user_id: ctx.user_id,
          message: `🎁 ${senderName} أهدى ${giftLabel} إلى ${receiverName}`,
          is_system: true,
          gift_id: body.gift_id,
        });
      } catch (chatErr) {
        console.error('[Wattar] Gift room message insert failed:', chatErr);
      }
    }

    return jsonResponse({
      success: true,
      gift_transaction: result.gift_transaction,
      message: `تم إرسال ${quantity}x ${String(result.gift_name ?? 'هدية')}`,
      sent_coins: result.sent_coins,
      received_diamonds: result.received_diamonds,
      already_processed: Boolean(result.already_processed),
    });
  } catch (err) {
    return errorResponse(err);
  }
});
