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

type DepositMethod = 'usdt' | 'sham_cash' | 'syriatel_cash' | 'agent';

interface DepositRequestBody {
  method: DepositMethod;
  amount_usd: number;
  external_ref: string;
  proof_url: string;
  sender_phone?: string;
  sender_name?: string;
  usdt_network?: string;
  usdt_tx_hash?: string;
  usdt_from_address?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return jsonResponse({}, 200);
  if (req.method !== 'POST') return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);

  try {
    const ctx = await authenticate(req);
    await requireNotMaintenance(ctx);
    await rateLimitByUser(ctx, 'deposit_request', 3, 60_000);

    const body = await parseBody<DepositRequestBody>(req);
    validateBody(body, ['method', 'amount_usd', 'external_ref', 'proof_url']);
    if (!['usdt', 'sham_cash', 'syriatel_cash', 'agent'].includes(body.method)) {
      throw new HttpError(400, 'INVALID_METHOD', 'Deposit method is not supported');
    }
    if (!Number.isFinite(body.amount_usd) || body.amount_usd <= 0) {
      throw new HttpError(400, 'INVALID_AMOUNT', 'Deposit amount must be positive');
    }
    if (body.method === 'usdt') {
      if (body.usdt_network !== 'trc20' && body.usdt_network !== 'bep20') {
        throw new HttpError(400, 'INVALID_NETWORK', 'USDT deposits require network trc20 or bep20');
      }
      const txHash = body.usdt_tx_hash?.trim() ?? '';
      if (body.usdt_network === 'trc20' && !/^[0-9a-fA-F]{64}$/.test(txHash)) {
        throw new HttpError(400, 'INVALID_TX_HASH', 'A valid TRC20 transaction hash is required');
      }
      if (body.usdt_network === 'bep20' && !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
        throw new HttpError(400, 'INVALID_TX_HASH', 'A valid BEP20 transaction hash is required');
      }
      const fromAddress = body.usdt_from_address?.trim() ?? '';
      if (body.usdt_network === 'trc20' && fromAddress && !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(fromAddress)) {
        throw new HttpError(400, 'INVALID_FROM_ADDRESS', 'Invalid TRC20 sender address');
      }
      if (body.usdt_network === 'bep20' && fromAddress && !/^0x[0-9a-fA-F]{40}$/.test(fromAddress)) {
        throw new HttpError(400, 'INVALID_FROM_ADDRESS', 'Invalid BEP20 sender address');
      }
    }

    const idempotencyKey = req.headers.get('X-Idempotency-Key')?.trim();
    if (!idempotencyKey || !/^[A-Za-z0-9._:-]{10,100}$/.test(idempotencyKey)) {
      throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'A valid X-Idempotency-Key header is required');
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.rpc('create_deposit_request', {
      p_user_id: ctx.user_id,
      p_method: body.method,
      p_amount_usd: body.amount_usd,
      p_external_ref: body.external_ref,
      p_proof_url: body.proof_url,
      p_idempotency_key: idempotencyKey,
      p_sender_phone: body.sender_phone ?? null,
      p_sender_name: body.sender_name ?? null,
      p_usdt_network: body.usdt_network ?? null,
      p_usdt_tx_hash: body.usdt_tx_hash ?? null,
      p_usdt_from_address: body.usdt_from_address ?? null,
    });

    if (error) {
      if (error.code === 'P0001') {
        throw new HttpError(400, 'DEPOSIT_REJECTED', error.message);
      }
      console.error('[Wattar] Deposit creation RPC failed:', error);
      throw new HttpError(500, 'DEPOSIT_FAILED', 'Failed to create deposit request');
    }

    const deposit = Array.isArray(data) ? data[0] : data;
    if (!deposit || typeof deposit !== 'object') {
      throw new HttpError(500, 'DEPOSIT_FAILED', 'Deposit request was not returned');
    }

    return jsonResponse({
      success: true,
      deposit,
      message: 'تم استلام طلب الشحن، وسيظهر الرصيد بعد مراجعة الطلب.',
    });
  } catch (err) {
    return errorResponse(err);
  }
});
