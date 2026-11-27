/**
 * Wattar Edge Function — game-aviator (طيارة المضاعفات)
 *
 * POST /functions/v1/game-aviator
 * Body: { "bet_amount": number, "auto_cashout_multiplier": number, "test_mode"?: boolean }
 *
 * M9.4 — تصحيح نموذج الاحتمال:
 *   نريد E[ payout عند السحب على x ] = RTP لكل x ≥ 1.
 *   نختار U ~ Uniform(0,1) و crash = r / (1 - U)  حيث r = RTP/100.
 *   إذن P(crash > x) = r / x، و E[x · 1(crash>x)] = r. ✅
 *   (النموذج القديم r/U كان يعطي عائداً أكبر من 1 لكل x < r.)
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
  secureRandom,
  validateBetAmount,
} from '../_shared/game-engine.ts';

interface AviatorBody {
  bet_amount: number;
  auto_cashout_multiplier?: number;
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

    const body = await parseBody<AviatorBody>(req);
    const cashout = Number(body.auto_cashout_multiplier);
    if (!Number.isFinite(cashout) || cashout < 1.01) {
      throw new HttpError(400, 'INVALID_CASHOUT', 'auto_cashout_multiplier must be >= 1.01');
    }

    const supabase = getSupabaseAdmin();
    const gate = await assertGameAvailable(supabase, ctx.user_id, 'aviator');
    const config = await getGameConfig(supabase, 'aviator');
    const testMode = readTestMode(body, gate);

    const maxMultiplier = Number(config.max_multiplier);
    if (cashout > maxMultiplier) {
      throw new HttpError(400, 'CASHOUT_TOO_HIGH', `Max multiplier is ${maxMultiplier}`);
    }

    const userState = await getUserGameState(supabase, ctx.user_id);
    validateBetAmount(body.bet_amount, config, userState.bet_limit_override);
    if (!testMode && userState.balance_gold < body.bet_amount) {
      throw new HttpError(400, 'INSUFFICIENT_BALANCE', 'Not enough Coin balance');
    }

    const rtp = determineRTP(userState, config);
    const forced = checkForcedOutcome(userState);

    let crashPoint: number;
    if (forced === 'win') {
      crashPoint = Math.min(maxMultiplier, Math.max(cashout * 1.5, cashout + 0.5));
      crashPoint = Math.floor(crashPoint * 100) / 100;
    } else {
      crashPoint = computeCrashPoint(rtp, maxMultiplier);
    }

    const isWin = cashout < crashPoint;
    const multiplier = isWin ? cashout : 0;
    const payout = isWin ? Math.floor(body.bet_amount * multiplier) : 0;

    const gameCtx: GameContext = {
      user_id: ctx.user_id,
      game_type: 'aviator',
      idempotency_key: idempotencyKey,
      request_data: { auto_cashout_multiplier: cashout },
      bet_amount: body.bet_amount,
      bet_data: { auto_cashout: cashout, crash_point: crashPoint },
      test_mode: testMode,
    };

    const result: GameResult = {
      round_id: '',
      is_win: isWin,
      multiplier,
      payout,
      result: {
        crash_point: crashPoint,
        auto_cashout: cashout,
        rtp_target: rtp,
        max_multiplier: maxMultiplier,
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
      crash_point: Number(placed.result.crash_point),
      auto_cashout: Number(placed.result.auto_cashout),
      is_win: placed.is_win,
      multiplier: placed.multiplier,
      payout: placed.payout,
      net: placed.payout - body.bet_amount,
      promo_reward: forced === 'win',
      declared_rtp: rtp,
      odds: {
        p_win: Math.min(1, Math.round((rtp / 100 / cashout) * 10000) / 10000),
        multiplier: cashout,
        rtp,
      },
      balance_gold: await getBalanceGold(supabase, ctx.user_id),
    });
  } catch (err) {
    return errorResponse(err);
  }
});

/**
 * crash = r / (1 - U) مع سقف maxMultiplier.
 * P(crash > x) = r / x لكل 1 ≤ x ≤ maxMultiplier، لذا RTP المعلن = r.
 */
function computeCrashPoint(rtp: number, maxMultiplier: number): number {
  const r = Math.max(0.01, Math.min(0.99, rtp / 100));
  const u = secureRandom();
  let crash = r / Math.max(1 - u, 1e-9);
  crash = Math.min(crash, maxMultiplier);
  crash = Math.max(1, Math.floor(crash * 100) / 100);
  return crash;
}
