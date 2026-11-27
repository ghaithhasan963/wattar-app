/**
 * Wattar Edge Function — game-dice (نرد)
 *
 * POST /functions/v1/game-dice
 * Body: { "bet_amount": number, "target": 1..99, "direction": "over"|"under", "test_mode"?: boolean }
 *
 * M9.4: RTP من إعدادات اللعبة (لا ثابت في الكود)، والمضاعف يُحسب ويُعلن على الخادم.
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
  checkForcedOutcome,
  determineRTP,
  getBalanceGold,
  getGameConfig,
  getUserGameState,
  placeBetAndSettle,
  readTestMode,
  secureRandomInt,
  validateBetAmount,
} from '../_shared/game-engine.ts';

interface DiceBody {
  bet_amount: number;
  target: number;
  direction: 'over' | 'under';
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

    const body = await parseBody<DiceBody>(req);
    if (!Number.isInteger(body.target) || body.target < 1 || body.target > 99) {
      throw new HttpError(400, 'INVALID_TARGET', 'Target must be 1..99');
    }
    if (!['over', 'under'].includes(body.direction)) {
      throw new HttpError(400, 'INVALID_DIRECTION', 'direction must be over/under');
    }

    const supabase = getSupabaseAdmin();
    const gate = await assertGameAvailable(supabase, ctx.user_id, 'dice');
    const config = await getGameConfig(supabase, 'dice');
    const testMode = readTestMode(body, gate);

    const userState = await getUserGameState(supabase, ctx.user_id);
    validateBetAmount(body.bet_amount, config, userState.bet_limit_override);
    if (!testMode && userState.balance_gold < body.bet_amount) {
      throw new HttpError(400, 'INSUFFICIENT_BALANCE', 'Not enough Coin balance');
    }

    const rtp = determineRTP(userState, config);
    const forced = checkForcedOutcome(userState);

    let roll: number;
    if (forced === 'win') {
      roll = body.direction === 'over'
        ? secureRandomInt(Math.min(body.target + 1, 100), 100)
        : secureRandomInt(1, Math.max(body.target - 1, 1));
    } else {
      roll = secureRandomInt(1, 100);
    }

    const isWin = body.direction === 'over' ? roll > body.target : roll < body.target;
    const pWin = body.direction === 'over'
      ? (100 - body.target) / 100
      : (body.target - 1) / 100;

    // المضاعف المعلن = (1 / احتمال الفوز) × (RTP / 100)
    const fairMultiplier = 1 / Math.max(pWin, 0.01);
    const multiplier = isWin ? Math.floor(fairMultiplier * rtp / 100 * 100) / 100 : 0;
    const payout = isWin ? Math.floor(body.bet_amount * multiplier) : 0;

    const gameCtx: GameContext = {
      user_id: ctx.user_id,
      game_type: 'dice',
      idempotency_key: idempotencyKey,
      request_data: { target: body.target, direction: body.direction },
      bet_amount: body.bet_amount,
      bet_data: { target: body.target, direction: body.direction, roll },
      test_mode: testMode,
    };

    const result: GameResult = {
      round_id: '',
      is_win: isWin,
      multiplier,
      payout,
      result: {
        roll,
        target: body.target,
        direction: body.direction,
        p_win: pWin,
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
      roll: Number(placed.result.roll),
      is_win: placed.is_win,
      multiplier: placed.multiplier,
      payout: placed.payout,
      net: placed.payout - body.bet_amount,
      promo_reward: forced === 'win',
      declared_rtp: rtp,
      odds: {
        p_win: Math.round(pWin * 10000) / 10000,
        multiplier: Math.floor(fairMultiplier * rtp / 100 * 100) / 100,
        rtp,
      },
      balance_gold: await getBalanceGold(supabase, ctx.user_id),
    });
  } catch (err) {
    return errorResponse(err);
  }
});
