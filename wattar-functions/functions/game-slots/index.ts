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
  checkForcedOutcome,
  determineRTP,
  GameContext,
  GameResult,
  getGameConfig,
  getUserGameState,
  placeBetAndSettle,
  secureRandom,
  secureRandomInt,
  validateBetAmount,
} from '../_shared/game-engine.ts';

interface SlotsBody {
  bet_amount: number;
}

interface PayoutTier {
  symbol: string;
  multiplier: number;
  probability: number;
}

const payoutTiers: PayoutTier[] = [
  { symbol: '🍒', multiplier: 2, probability: 0.05 },
  { symbol: '🔔', multiplier: 5, probability: 0.02 },
  { symbol: '💎', multiplier: 10, probability: 0.01 },
];

const lossSymbols = ['🍋', '🍀', '⭐', '🍇'];

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
    const config = await getGameConfig(supabase, 'slots');
    const userState = await getUserGameState(supabase, ctx.user_id);
    validateBetAmount(body.bet_amount, config, userState.bet_limit_override);
    if (userState.balance_gold < body.bet_amount) {
      throw new HttpError(400, 'INSUFFICIENT_BALANCE', 'Not enough Coin balance');
    }

    const rtp = determineRTP(userState, config);
    const forced = checkForcedOutcome(userState);
    const tier = forced === 'lose' ? null : pickPayoutTier(rtp, forced === 'win');
    const reels = tier
      ? [tier.symbol, tier.symbol, tier.symbol]
      : createLosingReels();
    const multiplier = tier?.multiplier ?? 0;
    const payout = Math.floor(body.bet_amount * multiplier);

    const gameContext: GameContext = {
      user_id: ctx.user_id,
      game_type: 'slots',
      idempotency_key: idempotencyKey,
      request_data: {},
      bet_amount: body.bet_amount,
      bet_data: { reels },
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

    const { data: updatedUser, error: balanceError } = await supabase
      .from('users')
      .select('balance_gold')
      .eq('id', ctx.user_id)
      .single();
    if (balanceError) {
      console.error('[Wattar] Failed to load Coin balance after slots settlement:', balanceError);
      throw new HttpError(500, 'BALANCE_LOAD_FAILED', 'Could not load Coin balance');
    }

    return jsonResponse({
      success: true,
      round_id: settled.round_id,
      bet_id: settled.bet_id,
      reels: settledReels,
      is_win: settled.is_win,
      multiplier: settled.multiplier,
      payout: settled.payout,
      balance_gold: Number(updatedUser.balance_gold),
    });
  } catch (error) {
    return errorResponse(error);
  }
});

function pickPayoutTier(rtp: number, forceWin: boolean): PayoutTier | null {
  const expectedReturn = payoutTiers.reduce(
    (total, tier) => total + tier.probability * tier.multiplier,
    0,
  );
  const maximumScale = 1 / payoutTiers.reduce((total, tier) => total + tier.probability, 0);
  const scale = forceWin ? 1 : Math.max(0, Math.min(maximumScale, rtp / (expectedReturn * 100)));
  const randomValue = secureRandom();
  let cumulativeProbability = 0;

  for (const tier of payoutTiers) {
    cumulativeProbability += tier.probability * scale;
    if (randomValue < cumulativeProbability) return tier;
  }

  if (forceWin) {
    return payoutTiers[secureRandomInt(0, payoutTiers.length - 1)];
  }
  return null;
}

function createLosingReels(): string[] {
  const first = secureRandomInt(0, lossSymbols.length - 1);
  let second = secureRandomInt(0, lossSymbols.length - 1);
  while (second === first) second = secureRandomInt(0, lossSymbols.length - 1);
  let third = secureRandomInt(0, lossSymbols.length - 1);
  while (third === first || third === second) {
    third = secureRandomInt(0, lossSymbols.length - 1);
  }
  return [lossSymbols[first], lossSymbols[second], lossSymbols[third]];
}
