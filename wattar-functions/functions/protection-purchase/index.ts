/**
 * Wattar Edge Function — protection-purchase (M8.6 — أدوات الحماية المدفوعة)
 *
 * POST /functions/v1/protection-purchase
 * Body: { "product_id": uuid }
 * Headers: Authorization Bearer JWT + X-Idempotency-Key (10..100)
 *
 * المسار المالي كله داخل settle_protection_purchase (service_role RPC):
 *   خصم Coin → قيد محفظة → إيراد زوجي على platform:main → إشعار → حماية.
 * الدالة هنا بوابة فقط: مصادقة + صيانة + rate limit + مفتاز ازدواجية.
 *
 * @version 1.0.0
 */
import {
  authenticate,
  requireNotMaintenance,
  rateLimitByUser,
  requireIdempotencyKey,
  parseBody,
  getSupabaseAdmin,
  jsonResponse,
  errorResponse,
  HttpError,
} from '../_shared/supabase.ts';

interface ProtectionBody {
  product_id: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return jsonResponse({}, 200);
  if (req.method !== 'POST') return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);

  try {
    const ctx = await authenticate(req);
    await requireNotMaintenance(ctx);
    await rateLimitByUser(ctx, 'protection_purchase', 5, 60_000);
    const idempotencyKey = requireIdempotencyKey(req);

    const body = await parseBody<ProtectionBody>(req);
    if (!body?.product_id || !UUID_RE.test(String(body.product_id))) {
      throw new HttpError(400, 'INVALID_PRODUCT', 'product_id must be a valid uuid');
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.rpc('settle_protection_purchase', {
      p_user_id: ctx.user_id,
      p_product_id: body.product_id,
      p_idempotency_key: idempotencyKey,
    });
    if (error) {
      throw new HttpError(400, 'PROTECTION_PURCHASE_REJECTED', error.message);
    }

    const protection = data as Record<string, unknown>;
    const { data: balanceRow, error: balErr } = await supabase
      .from('users')
      .select('balance_gold')
      .eq('id', ctx.user_id)
      .single();
    if (balErr) {
      throw new HttpError(500, 'BALANCE_LOAD_FAILED', 'Could not load Coin balance');
    }

    return jsonResponse({
      success: true,
      protection: {
        kind: protection.kind,
        expires_at: protection.expires_at,
        permanent: protection.expires_at == null,
      },
      balance_gold: Number(balanceRow.balance_gold),
    });
  } catch (err) {
    return errorResponse(err);
  }
});
