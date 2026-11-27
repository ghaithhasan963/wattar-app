/**
 * Wattar Edge Function — game-slots (Slots)
 *
 * POST /functions/v1/game-slots
 * Body: { "bet_amount": number, "test_mode"?: boolean }
 *
 * M9.4:
 *  - جدول الجوائز (الرمز + المضاعف + الاحتمال) يأتي من game_configs.settings.tiers.
 *  - لا مضاعفات أو احتمالات ثابتة في الكود.
 *
 * @version 2.0.0
 */
import {
  requireNotMaintenance,
  authenticate,
  errorResponse,
  getSupabaseAdmin,
  HttpError,
  jsonResponse,
  parseBody,
  rateLimitByUser,
  requireIdempotencyKey,
} from '../_shared/supabase.ts';
import {
  GameContext,
  GameResult,
  assertGameAvailable,
  checkForcedOutcome,
  determineRTP,
  getBalanceGold,
  getGameConfig,
  getUserGameState,
  placeBetAndSettle,
  readTestMode,
  secureRandom,
  secureRandomInt,
  validateBetAmount,
} from '../_shared/game-engine.ts';

interface SlotsBody {
  bet_amount: number;
  test_mode?: boolean;
}

interface PayoutTier {
  symbol: string;
  multiplier: number;
  probability: number;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return jsonResponse({}, 200);
  if (req.method !== 'POST') return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);

  try {
    const ctx = await authenticate(req);
    await requireNotMaintenance(ctx);
    await rateLimitByUser(ctx, 'place_bet', 5, 1000);
    const idempotencyKey = requireIdempotencyKey(req);
    const body = await parseBody<SlotsBody>(req);

    const supabase = getSupabaseAdmin();
    const gate = await assertGameAvailable(supabase, ctx.user_id, 'slots');
    const config = await getGameConfig(supabase, 'slots');
    const testMode = readTestMode(body, gate);

    const rawTiers = config.settings?.tiers;
    if (!Array.isArray(rawTiers) || rawTiers.length === 0) {
      throw new HttpError(500, 'GAME_NOT_CONFIGURED', 'Slots payouts are not configured');
    }
    const tiers: PayoutTier[] = rawTiers.map((tier: Record<string, unknown>) => ({
      symbol: String(tier.symbol),
      multiplier: Number(tier.multiplier),
      probability: Number(tier.probability),
    }));
    const lossSymbols: string[] = Array.isArray(config.settings?.loss_symbols)
      ? config.settings.loss_symbols.map((symbol: unknown) => String(symbol))
      : ['🍋', '🍀', '⭐', '🍇'];

    const userState = await getUserGameState(supabase, ctx.user_id);
    validateBetAmount(body.bet_amount, config, userState.bet_limit_override);
    if (!testMode && userState.balance_gold < body.bet_amount) {
      throw new HttpError(400, 'INSUFFICIENT_BALANCE', 'Not enough Coin balance');
    }

    const rtp = determineRTP(userState, config);
    const forced = checkForcedOutcome(userState);

    let tier: PayoutTier | null = null;
    if (forced === 'win') {
      tier = pickTierByWeight(tiers);
    } else {
      tier = drawTier(tiers);
    }

    const reels = tier ? [tier.symbol, tier.symbol, tier.symbol] : createLosingReels(lossSymbols);
    const multiplier = tier ? Number(tier.multiplier) : 0;
    const payout = Math.floor(body.bet_amount * multiplier);

    const gameContext: GameContext = {
      user_id: ctx.user_id,
      game_type: 'slots',
      idempotency_key: idempotencyKey,
      request_data: {},
      bet_amount: body.bet_amount,
      bet_data: { reels },
      test_mode: testMode,
    };
    const result: GameResult = {
      round_id: '',
      is_win: multiplier > 0,
      multiplier,
      payout,
      result: { reels, symbol: tier?.symbol ?? null, rtp_target: rtp },
      forced_outcome: forced,
      rtp_applied: rtp,
    };

    const settled = await placeBetAndSettle(supabase, gameContext, result);
    const settledReels = Array.isArray(settled.result.reels)
      ? settled.result.reels.filter((symbol): symbol is string => typeof symbol === 'string')
      : [];
    if (settledReels.length !== 3) {
      throw new HttpError(500, 'INVALID_GAME_RESULT', 'The slot result was not returned correctly');
    }

    return jsonResponse({
      success: true,
      test_mode: settled.test_mode,
      round_id: settled.round_id,
      bet_id: settled.bet_id,
      reels: settledReels,
      is_win: settled.is_win,
      multiplier: settled.multiplier,
      payout: settled.payout,
      net: settled.payout - body.bet_amount,
      promo_reward: forced === 'win',
      declared_rtp: rtp,
      odds: {
        hit_rate: Math.round(tiers.reduce((sum, item) => sum + item.probability, 0) * 10000) / 10000,
        tiers: tiers.map((item) => ({
          symbol: item.symbol,
          multiplier: item.multiplier,
          probability: item.probability,
        })),
        rtp,
      },
      balance_gold: await getBalanceGold(supabase, ctx.user_id),
    });
  } catch (error) {
    return errorResponse(error);
  }
});

/** اختيار جائزة وفق احتمالها المعلن؛ وإذا خرجت القرعة خارج مجموع الاحتمالات → خسارة. */
function drawTier(tiers: PayoutTier[]): PayoutTier | null {
  const roll = secureRandom();
  let cumulative = 0;
  for (const tier of tiers) {
    cumulative += Math.max(0, Number(tier.probability));
    if (roll < cumulative) return tier;
  }
  return null;
}

function pickTierByWeight(tiers: PayoutTier[]): PayoutTier {
  const total = tiers.reduce((sum, tier) => sum + Math.max(0, Number(tier.probability)), 0);
  if (total <= 0) return tiers[secureRandomInt(0, tiers.length - 1)];
  let ticket = secureRandom() * total;
  for (const tier of tiers) {
    ticket -= Math.max(0, Number(tier.probability));
    if (ticket <= 0) return tier;
  }
  return tiers[tiers.length - 1];
}

function createLosingReels(symbols: string[]): string[] {
  const pool = symbols.length >= 3 ? symbols : ['🍋', '🍀', '⭐'];
  const first = secureRandomInt(0, pool.length - 1);
  let second = secureRandomInt(0, pool.length - 1);
  while (second === first) second = secureRandomInt(0, pool.length - 1);
  let third = secureRandomInt(0, pool.length - 1);
  while (third === first || third === second) third = secureRandomInt(0, pool.length - 1);
  return [pool[first], pool[second], pool[third]];
}
