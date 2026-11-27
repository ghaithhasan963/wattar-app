/**
 * Wattar Edge Function — game-wheel (عجلة الحظ)
 *
 * POST /functions/v1/game-wheel
 * Body: { "bet_amount": number, "segment_choice": number, "test_mode"?: boolean }
 *
 * M9.4:
 *  - المستخدم يختار خانة (رهان)، والسيرفر يختار الخانة الفائزة وفق الأوزان المعلنة.
 *  - العائد = قيمة الخانة المختارة عند وقوع العجلة عليها، وإلا صفر.
 *  - كل خانة لها احتمال معلن وعائد معلن، وRTP الخانة = الاحتمال × العائد.
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
  pickWeightedIndex,
  placeBetAndSettle,
  readTestMode,
  validateBetAmount,
} from '../_shared/game-engine.ts';

interface WheelSegment {
  value: number;
  probability: number;
  color: string;
  label: string;
}

interface WheelBody {
  bet_amount: number;
  segment_choice: number;
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

    const body = await parseBody<WheelBody>(req);
    if (!Number.isInteger(body.segment_choice) || body.segment_choice < 0) {
      throw new HttpError(400, 'INVALID_SEGMENT', 'segment_choice must be a non-negative integer');
    }

    const supabase = getSupabaseAdmin();
    const gate = await assertGameAvailable(supabase, ctx.user_id, 'wheel');
    const config = await getGameConfig(supabase, 'wheel');
    const testMode = readTestMode(body, gate);

    const segments: WheelSegment[] = config.settings?.segments;
    if (!Array.isArray(segments) || segments.length < 2) {
      throw new HttpError(500, 'GAME_NOT_CONFIGURED', 'Wheel segments are not configured');
    }
    if (body.segment_choice >= segments.length) {
      throw new HttpError(400, 'INVALID_SEGMENT', `Choose segment 0..${segments.length - 1}`);
    }

    const userState = await getUserGameState(supabase, ctx.user_id);
    validateBetAmount(body.bet_amount, config, userState.bet_limit_override);
    if (!testMode && userState.balance_gold < body.bet_amount) {
      throw new HttpError(400, 'INSUFFICIENT_BALANCE', 'Not enough Coin balance');
    }

    const rtp = determineRTP(userState, config);
    const forced = checkForcedOutcome(userState);
    const chosenSegment = segments[body.segment_choice];
    const chosenValue = Number(chosenSegment.value);

    let winningSegment: number;
    if (forced === 'win') {
      winningSegment = body.segment_choice;
    } else {
      winningSegment = pickWeightedIndex(segments.map((segment) => Number(segment.probability)));
    }

    const isWin = winningSegment === body.segment_choice;
    const multiplier = isWin ? chosenValue : 0;
    const payout = isWin ? Math.floor(body.bet_amount * multiplier) : 0;

    const gameCtx: GameContext = {
      user_id: ctx.user_id,
      game_type: 'wheel',
      idempotency_key: idempotencyKey,
      request_data: { segment_choice: body.segment_choice },
      bet_amount: body.bet_amount,
      bet_data: { segment_choice: body.segment_choice, segment_value: chosenValue },
      test_mode: testMode,
    };

    const result: GameResult = {
      round_id: '',
      is_win: isWin,
      multiplier,
      payout,
      result: {
        winning_segment: winningSegment,
        winning_value: Number(segments[winningSegment].value),
        winning_color: segments[winningSegment].color,
        winning_label: segments[winningSegment].label,
        chosen_segment: body.segment_choice,
        chosen_value: chosenValue,
        rtp_target: rtp,
      },
      forced_outcome: forced,
      rtp_applied: rtp,
    };

    const placed = await placeBetAndSettle(supabase, gameCtx, result);
    const winning = Number(placed.result.winning_segment);

    return jsonResponse({
      success: true,
      test_mode: placed.test_mode,
      round_id: placed.round_id,
      bet_id: placed.bet_id,
      winning_segment: winning,
      winning_color: String(placed.result.winning_color),
      winning_label: String(placed.result.winning_label),
      chosen_segment: body.segment_choice,
      is_win: placed.is_win,
      multiplier: placed.multiplier,
      payout: placed.payout,
      net: placed.payout - body.bet_amount,
      promo_reward: forced === 'win',
      declared_rtp: Number(config.default_rtp),
      odds: {
        p_win: Number(chosenSegment.probability),
        multiplier: chosenValue,
        rtp: Math.round(Number(chosenSegment.probability) * chosenValue * 10000) / 100,
      },
      balance_gold: await getBalanceGold(supabase, ctx.user_id),
    });
  } catch (err) {
    return errorResponse(err);
  }
});
