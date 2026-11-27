/**
 * Wattar Edge Function — vip-purchase (M8.4 — شراء/ترقية/تجديد VIP)
 *
 * POST /functions/v1/vip-purchase
 * Body: { "tier": number }        // 1..10
 * Headers: Authorization Bearer JWT + X-Idempotency-Key (10..100)
 *
 * المسار المالي كله داخل settle_vip_purchase (service_role RPC):
 *   خصم Coin → قيد محفظة → إيراد على platform:main → إشعار → صف اشتراك.
 * الدالة هنا بوابة فقط: مصادقة + صيانة + rate limit + مفتاح ازدواجية.
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

interface VipBody {
  tier: number;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return jsonResponse({}, 200);
  if (req.method !== 'POST') return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);

  try {
    const ctx = await authenticate(req);
    await requireNotMaintenance(ctx);
    await rateLimitByUser(ctx, 'vip_purchase', 5, 60_000);
    const idempotencyKey = requireIdempotencyKey(req);

    const body = await parseBody<VipBody>(req);
    if (!Number.isInteger(body?.tier) || body.tier < 1 || body.tier > 10) {
      throw new HttpError(400, 'INVALID_TIER', 'tier must be an integer 1..10');
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.rpc('settle_vip_purchase', {
      p_user_id: ctx.user_id,
      p_tier: body.tier,
      p_idempotency_key: idempotencyKey,
    });
    if (error) {
      // أخطاء العمل (رصيد/تعطيل/تنزيل/درجة معطلة) تُمرَّر برسالتها
      throw new HttpError(400, 'VIP_PURCHASE_REJECTED', error.message);
    }

    const sub = data as Record<string, unknown>;
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
      subscription: {
        id: sub.id,
        tier: sub.tier,
        purchase_kind: sub.purchase_kind,
        price_coins_paid: sub.price_coins_paid,
        discount_percent: sub.discount_percent,
        paid_coins: sub.paid_coins,
        upgrade_credit_coins: sub.upgrade_credit_coins,
        starts_at: sub.starts_at,
        expires_at: sub.expires_at,
      },
      balance_gold: Number(balanceRow.balance_gold),
    });
  } catch (err) {
    return errorResponse(err);
  }
});
