/**
 * Wattar Edge Function — wallet-balance
 *
 * GET /functions/v1/wallet-balance
 *   يعيد رصيد المستخدم الحالي + آخر المعاملات
 *
 * @version 1.0.0
 */
import {
  authenticate,
  errorResponse,
  jsonResponse,
  getSupabaseAdmin,
} from '../_shared/supabase.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return jsonResponse({}, 200);
  if (req.method !== 'GET') return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);

  try {
    const ctx = await authenticate(req);
    const supabase = getSupabaseAdmin();

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('balance_gold, balance_diamond, total_deposited, total_withdrawn, total_wagered, total_won')
      .eq('id', ctx.user_id)
      .single();

    if (userError) {
      console.error('[Wattar] Failed to load wallet balances:', userError);
      throw new Error('Failed to load wallet balances');
    }
    if (!user) return jsonResponse({ error: 'USER_NOT_FOUND' }, 404);

    const { data: recentTx, error: transactionsError } = await supabase
      .from('wallet_transactions')
      .select('*')
      .eq('user_id', ctx.user_id)
      .order('created_at', { ascending: false })
      .limit(20);
    if (transactionsError) {
      console.error('[Wattar] Failed to load wallet transactions:', transactionsError);
      throw new Error('Failed to load wallet transactions');
    }

    return jsonResponse({
      balance: {
        coin: user.balance_gold,
        diamond: user.balance_diamond,
      },
      totals: {
        deposited: user.total_deposited,
        withdrawn: user.total_withdrawn,
        wagered: user.total_wagered,
        won: user.total_won,
      },
      recent_transactions: recentTx ?? [],
    });
  } catch (err) {
    return errorResponse(err);
  }
});
