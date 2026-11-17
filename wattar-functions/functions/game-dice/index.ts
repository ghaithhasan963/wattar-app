/**
 * Wattar Edge Function — game-dice (نرد)
 *
 * POST /functions/v1/game-dice
 * Body:
 *   {
 *     "bet_amount": number,
 *     "target": number,            // 1..99
 *     "direction": "over" | "under"
 *   }
 *
 * منطق اللعبة:
 *   - السيرفر يولّد رقمًا 1..100
 *   - إذا اختار "over" والرقم > target → فوز
 *   - إذا اختار "under" والرقم < target → فوز
 *   - المضاعف = 100 / (احتمال الفوز) × RTP_factor
 *
 * معادلة RTP:
 *   - احتمال الفوز عند "over target" = (100 - target) / 100
 *   - احتمال الفوز عند "under target" = (target - 1) / 100
 *   - مضاعف عادل = 1 / p_win
 *   - مضاعف مُطبّق = مضاعف_عادل × RTP
 *
 * @version 1.0.0
 */
import {
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
  getGameConfig,
  getUserGameState,
  determineRTP,
  checkForcedOutcome,
  placeBetAndSettle,
  secureRandomInt,
  validateBetAmount,
} from '../_shared/game-engine.ts';

interface DiceBody {
  bet_amount: number;
  target: number;       // 1..99
  direction: 'over' | 'under';
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return jsonResponse({}, 200);
  if (req.method !== 'POST') return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);

  try {
    const ctx = await authenticate(req);
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
    const config = await getGameConfig(supabase, 'dice');
    const userState = await getUserGameState(supabase, ctx.user_id);

    if (userState.balance_gold < body.bet_amount) {
      throw new HttpError(400, 'INSUFFICIENT_BALANCE', 'Not enough Coin balance');
    }
    validateBetAmount(body.bet_amount, config, userState.bet_limit_override);

    const rtp = determineRTP(userState, config);
    const forced = checkForcedOutcome(userState);

    // توليد النتيجة
    let roll: number;
    if (forced === 'win') {
      // إجبار رقم يفوز
      if (body.direction === 'over') {
        roll = secureRandomInt(Math.min(body.target + 1, 100), 100);
      } else {
        roll = secureRandomInt(1, Math.max(body.target - 1, 1));
      }
    } else if (forced === 'lose') {
      if (body.direction === 'over') {
        roll = secureRandomInt(1, body.target);
      } else {
        roll = secureRandomInt(body.target, 100);
      }
    } else {
      roll = secureRandomInt(1, 100);
    }

    // تحديد الفوز
    const isWin = body.direction === 'over'
      ? roll > body.target
      : roll < body.target;

    // احتمال الفوز العادل
    const pWin = body.direction === 'over'
      ? (100 - body.target) / 100
      : (body.target - 1) / 100;

    // المضاعف المطبّق = (1/pWin) × (rtp/100)
    const fairMult = 1 / Math.max(pWin, 0.01);
    const multiplier = isWin ? Math.floor((fairMult * rtp / 100) * 100) / 100 : 0;

    const payout = isWin ? Math.floor(body.bet_amount * multiplier) : 0;

    const gameCtx: GameContext = {
      user_id: ctx.user_id,
      game_type: 'dice',
      idempotency_key: idempotencyKey,
      request_data: { target: body.target, direction: body.direction },
      bet_amount: body.bet_amount,
      bet_data: { target: body.target, direction: body.direction, roll: roll },
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
      round_id: placed.round_id,
      bet_id: placed.bet_id,
      roll: Number(placed.result.roll),
      is_win: placed.is_win,
      multiplier: placed.multiplier,
      payout: placed.payout,
      balance_gold: await getNewBalance(supabase, ctx.user_id),
    });
  } catch (err) {
    return errorResponse(err);
  }
});

async function getNewBalance(supabase: any, userId: string): Promise<number> {
  const { data, error } = await supabase.from('users').select('balance_gold').eq('id', userId).single();
  if (error) throw new HttpError(500, 'BALANCE_LOAD_FAILED', 'Could not load Coin balance');
  return Number(data.balance_gold);
}
