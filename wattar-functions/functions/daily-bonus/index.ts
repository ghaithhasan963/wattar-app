import {
  authenticate,
  errorResponse,
  jsonResponse,
  getSupabaseAdmin,
  HttpError,
  rateLimitByUser,
} from '../_shared/supabase.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return jsonResponse({}, 200);
  if (req.method !== 'POST') return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);

  try {
    const ctx = await authenticate(req);
    rateLimitByUser(ctx, 'daily_bonus', 1, 60_000);
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.rpc('claim_daily_game_points_for_user', {
      p_user_id: ctx.user_id,
    });
    if (error) {
      if (error.code === 'P0001') throw new HttpError(400, 'BONUS_REJECTED', error.message);
      console.error('[Wattar] Free daily Coins claim failed:', error);
      throw new HttpError(500, 'BONUS_CLAIM_FAILED', 'Failed to claim free game Coins');
    }
    if (!data || typeof data !== 'object') {
      throw new HttpError(500, 'BONUS_CLAIM_FAILED', 'Daily reward result was not returned');
    }

    const result = data as Record<string, unknown>;
    return jsonResponse({
      success: true,
      claimed: result.claimed === true,
      amount: result.granted ?? 0,
      balance: result.balance,
      currency: 'free_game_coins',
      message: result.claimed === true
        ? 'تمت إضافة Coins مجانية إلى رصيد الألعاب.'
        : 'لا يمكن المطالبة بالمكافأة الآن.',
    });
  } catch (err) {
    return errorResponse(err);
  }
});
