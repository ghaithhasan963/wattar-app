import {
  authenticate,
  errorResponse,
  jsonResponse,
  getSupabaseAdmin,
  HttpError,
  parseBody,
  rateLimitByUser,
  requireIdempotencyKey,
  requireNotMaintenance,
  validateBody,
} from '../_shared/supabase.ts';

type WithdrawalMethod = 'usdt' | 'sham_cash' | 'syriatel_cash' | 'agent';

interface WithdrawalRequestBody {
  amount_diamond: number;
  method: WithdrawalMethod;
  payout_details?: Record<string, string>;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return jsonResponse({}, 200);
  if (req.method !== 'POST') return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);

  try {
    const ctx = await authenticate(req);
    await requireNotMaintenance(ctx);
    await rateLimitByUser(ctx, 'diamond_withdrawal_request', 5, 60_000);
    const body = await parseBody<WithdrawalRequestBody>(req);
    validateBody(body, ['amount_diamond', 'method']);

    if (!Number.isSafeInteger(body.amount_diamond) || body.amount_diamond <= 0) {
      throw new HttpError(400, 'INVALID_AMOUNT', 'amount_diamond must be a positive whole number');
    }
    if (!['usdt', 'sham_cash', 'syriatel_cash', 'agent'].includes(body.method)) {
      throw new HttpError(400, 'INVALID_METHOD', 'Unsupported withdrawal method');
    }
    if (body.payout_details !== undefined
      && (!body.payout_details || typeof body.payout_details !== 'object' || Array.isArray(body.payout_details))) {
      throw new HttpError(400, 'INVALID_PAYOUT_DETAILS', 'Payout details must be an object');
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.rpc('create_my_diamond_withdrawal', {
      p_user_id: ctx.user_id,
      p_amount_diamond: body.amount_diamond,
      p_method: body.method,
      p_payout_details: body.payout_details ?? {},
      p_idempotency_key: requireIdempotencyKey(req),
    });
    if (error) {
      if (error.code === 'P0001') {
        throw new HttpError(400, 'WITHDRAWAL_REJECTED', error.message);
      }
      console.error('[Wattar] Failed to create atomic Diamond withdrawal:', error);
      throw new HttpError(500, 'WITHDRAWAL_REQUEST_FAILED', 'Failed to create withdrawal request');
    }
    if (!data || typeof data !== 'object') {
      throw new HttpError(500, 'WITHDRAWAL_REQUEST_FAILED', 'Withdrawal request was not returned');
    }

    const withdrawal = data as Record<string, unknown>;
    return jsonResponse({
      success: true,
      withdrawal_id: withdrawal.id,
      amount_diamond: withdrawal.amount_diamond,
      amount_usd: withdrawal.amount_usd,
      fee_usd: withdrawal.fee_usd,
      net_usd: withdrawal.net_usd,
      status: withdrawal.status,
    });
  } catch (err) {
    return errorResponse(err);
  }
});
