/**
 * Wattar Edge Function — game-plinko (بلانغو)
 *
 * POST /functions/v1/game-plinko
 * Body: { "bet_amount": number, "risk_level": "low"|"medium"|"high", "test_mode"?: boolean }
 *
 * M9.4:
 *  - 12 صفاً → 13 خانة (0..12) باحتمال ثنائي دقيق C(12,k)/2^12.
 *  - المضاعفات معلنة من الإعدادات، ولا يوجد أي تعديل RTP محلي.
 *  - المسار والنتيجة يُحسبان على الخادم فقط.
 *
 * @version 2.0.0
 */
import {
  requireNotMaintenance,
  authenticate,
  errorResponse,
  jsonResponse,
  getSupabaseAdmin,
  HttpError,
  parseBody,
  rateLimitByUser,
  requireIdempotencyKey,
} from '../_shared/supabase.ts';
import {
  GameContext,
  GameResult,
  assertGameAvailable,
  binomialDraw,
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

interface PlinkoBody {
  bet_amount: number;
  risk_level: 'low' | 'medium' | 'high';
  test_mode?: boolean;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return jsonResponse({}, 200);
  if (req.method !== 'POST') return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);

  try {
    const ctx = await authenticate(req);
    await requireNotMaintenance(ctx);
    await rateLimitByUser(ctx, 'place_bet', 5, 1000);
    const idempotencyKey = requireIdempotencyKey(req);

    const body = await parseBody<PlinkoBody>(req);
    if (!['low', 'medium', 'high'].includes(body.risk_level)) {
      throw new HttpError(400, 'INVALID_RISK', 'risk_level must be low/medium/high');
    }

    const supabase = getSupabaseAdmin();
    const gate = await assertGameAvailable(supabase, ctx.user_id, 'plinko');
    const config = await getGameConfig(supabase, 'plinko');
    const testMode = readTestMode(body, gate);

    const rows = Number(config.settings?.rows ?? 12);
    const table = config.settings?.multipliers?.[body.risk_level];
    if (!Array.isArray(table) || table.length !== rows + 1) {
      throw new HttpError(500, 'GAME_NOT_CONFIGURED', 'Plinko multipliers are not configured');
    }
    const multipliers: number[] = table.map((value: unknown) => Number(value));

    const userState = await getUserGameState(supabase, ctx.user_id);
    validateBetAmount(body.bet_amount, config, userState.bet_limit_override);
    if (!testMode && userState.balance_gold < body.bet_amount) {
      throw new HttpError(400, 'INSUFFICIENT_BALANCE', 'Not enough Coin balance');
    }

    const rtp = determineRTP(userState, config);
    const forced = checkForcedOutcome(userState);

    let finalSlot: number;
    if (forced === 'win') {
      finalSlot = pickWinningSlot(multipliers);
    } else {
      finalSlot = binomialDraw(rows);
    }

    const multiplier = multipliers[finalSlot];
    const payout = Math.floor(body.bet_amount * multiplier);
    const path = buildPath(rows, finalSlot);

    const gameCtx: GameContext = {
      user_id: ctx.user_id,
      game_type: 'plinko',
      idempotency_key: idempotencyKey,
      request_data: { risk_level: body.risk_level },
      bet_amount: body.bet_amount,
      bet_data: { risk_level: body.risk_level, final_slot: finalSlot, path },
      test_mode: testMode,
    };

    const result: GameResult = {
      round_id: '',
      is_win: payout > 0,
      multiplier,
      payout,
      result: {
        final_slot: finalSlot,
        multiplier,
        risk_level: body.risk_level,
        rows,
        path,
        rtp_target: rtp,
      },
      forced_outcome: forced,
      rtp_applied: rtp,
    };

    const placed = await placeBetAndSettle(supabase, gameCtx, result);

    return jsonResponse({
      success: true,
      test_mode: placed.test_mode,
      round_id: placed.round_id,
      bet_id: placed.bet_id,
      final_slot: Number(placed.result.final_slot),
      path: placed.result.path,
      path_length: rows,
      multiplier: placed.multiplier,
      is_win: placed.is_win,
      payout: placed.payout,
      net: placed.payout - body.bet_amount,
      promo_reward: forced === 'win',
      declared_rtp: rtp,
      odds: {
        slots: multipliers.length,
        multiplier,
        p_land: binomialProbability(rows, finalSlot),
        rtp,
      },
      balance_gold: await getBalanceGold(supabase, ctx.user_id),
    });
  } catch (err) {
    return errorResponse(err);
  }
});

function pickWinningSlot(multipliers: number[]): number {
  const winners = multipliers
    .map((value, index) => ({ value, index }))
    .filter((entry) => entry.value > 1);
  if (winners.length === 0) {
    let best = 0;
    multipliers.forEach((value, index) => { if (value > multipliers[best]) best = index; });
    return best;
  }
  return winners[secureRandomInt(0, winners.length - 1)].index;
}

function buildPath(rows: number, rightCount: number): Array<'L' | 'R'> {
  const path: Array<'L' | 'R'> = [];
  let rights = Math.max(0, Math.min(rows, rightCount));
  for (let i = 0; i < rows; i += 1) {
    const remaining = rows - i;
    if (rights > 0 && secureRandom() < rights / remaining) {
      path.push('R');
      rights -= 1;
    } else {
      path.push('L');
    }
  }
  return path;
}

function binomialProbability(rows: number, k: number): number {
  if (k < 0 || k > rows) return 0;
  let coefficient = 1;
  const smaller = Math.min(k, rows - k);
  for (let i = 1; i <= smaller; i += 1) {
    coefficient = coefficient * (rows - smaller + i) / i;
  }
  return Math.round((coefficient / Math.pow(2, rows)) * 1000000) / 1000000;
}
