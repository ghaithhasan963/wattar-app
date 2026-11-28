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

interface SymbolicGiftSendBody {
  to_user_id: string;
  gift_id: string;
  quantity?: number;
  room_id?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return jsonResponse({}, 200);
  if (req.method !== 'POST') return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);

  try {
    const ctx = await authenticate(req);
    await requireNotMaintenance(ctx);
    await rateLimitByUser(ctx, 'send_symbolic_gift', 2, 60);

    const body = await parseBody<SymbolicGiftSendBody>(req);
    validateBody(body, ['to_user_id', 'gift_id']);

    const quantity = body.quantity ?? 1;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
      throw new HttpError(400, 'INVALID_QUANTITY', 'Quantity must be an integer from 1 to 100');
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.rpc('transfer_symbolic_gift', {
      p_from_user_id: ctx.user_id,
      p_to_user_id: body.to_user_id,
      p_gift_id: body.gift_id,
      p_quantity: quantity,
      p_room_id: body.room_id ?? null,
      p_idempotency_key: null,
    });

    if (error) {
      console.error('[Wattar] transfer_symbolic_gift RPC error:', error);
      const message = typeof error.message === 'string' ? error.message : 'تعذر إرسال الهدية الرمزية';
      throw new HttpError(400, 'SYMBOLIC_GIFT_FAILED', message);
    }

    return jsonResponse({
      success: true,
      symbolic: true,
      result: data,
    });
  } catch (err) {
    return errorResponse(err);
  }
});
