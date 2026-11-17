/**
 * Wattar Edge Function — game-wheel (عجلة الحظ)
 *
 * POST /functions/v1/game-wheel
 * Body: { "bet_amount": number, "segment_choice": number }
 *
 * منطق اللعبة:
 *   6 خانات: x0, x2, x5, x10, x20, x50
 *   احتمالاتها في game_configs.settings.segments
 *   نطبّق RTP: لكل رهان، العائد المتوقع = bet_amount * RTP
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
  secureRandom,
  validateBetAmount,
} from '../_shared/game-engine.ts';

interface WheelSegment {
  value: number;          // المضاعف (0 = خسارة)
  probability: number;    // احتمال الوقوع
  color: string;
  label: string;
}

interface WheelBody {
  bet_amount: number;
  segment_choice: number;  // 0..5
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return jsonResponse({}, 200);
  if (req.method !== 'POST') return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);

  try {
    const ctx = await authenticate(req);
    await rateLimitByUser(ctx, 'place_bet', 5, 1000);
    const idempotencyKey = requireIdempotencyKey(req);

    const body = await parseBody<WheelBody>(req);
    if (!Number.isInteger(body.segment_choice) || body.segment_choice < 0) {
      throw new HttpError(400, 'INVALID_SEGMENT', 'segment_choice must be a non-negative integer');
    }

    const supabase = getSupabaseAdmin();

    // 1) إعدادات اللعبة
    const config = await getGameConfig(supabase, 'wheel');
    const segments: WheelSegment[] = config.settings.segments;
    if (body.segment_choice >= segments.length) {
      throw new HttpError(400, 'INVALID_SEGMENT', `Choose segment 0..${segments.length - 1}`);
    }

    // 2) حالة المستخدم
    const userState = await getUserGameState(supabase, ctx.user_id);

    // 3) التحقق من الرصيد وحدود الرهان
    if (userState.balance_gold < body.bet_amount) {
      throw new HttpError(400, 'INSUFFICIENT_BALANCE', 'Not enough Coin balance');
    }
    validateBetAmount(body.bet_amount, config, userState.bet_limit_override);

    // 4) تحديد النتيجة
    const rtp = determineRTP(userState, config);
    const forced = checkForcedOutcome(userState);

    let winningSegment: number;
    let chosenSegment = segments[body.segment_choice];

    if (forced === 'win') {
      // اختر خانة فائزة عشوائيًا (ليس x0) مع مراعاة RTP
      winningSegment = pickWinningSegment(segments, rtp, body.segment_choice);
    } else if (forced === 'lose') {
      winningSegment = 0; // x0 = خسارة
    } else {
      // اختيار عشوائي وفق RTP
      winningSegment = pickSegmentByRTP(segments, rtp);
    }

    const isWin = winningSegment === body.segment_choice;
    const multiplier = isWin ? chosenSegment.value : 0;
    const payout = isWin ? Math.floor(body.bet_amount * multiplier) : 0;

    // 5) تنفيذ المعاملة
    const gameCtx: GameContext = {
      user_id: ctx.user_id,
      game_type: 'wheel',
      idempotency_key: idempotencyKey,
      request_data: { segment_choice: body.segment_choice },
      bet_amount: body.bet_amount,
      bet_data: { segment_choice: body.segment_choice, segment_value: chosenSegment.value },
    };

    const result: GameResult = {
      round_id: '',
      is_win: isWin,
      multiplier,
      payout,
      result: {
        winning_segment: winningSegment,
        winning_value: segments[winningSegment].value,
        winning_color: segments[winningSegment].color,
        winning_label: segments[winningSegment].label,
        chosen_segment: body.segment_choice,
        rtp_target: rtp,
      },
      forced_outcome: forced,
      rtp_applied: rtp,
    };

    const placed = await placeBetAndSettle(supabase, gameCtx, result);
    winningSegment = Number(placed.result.winning_segment);

    return jsonResponse({
      success: true,
      round_id: placed.round_id,
      bet_id: placed.bet_id,
      winning_segment: winningSegment,
      winning_color: String(placed.result.winning_color),
      winning_label: String(placed.result.winning_label),
      is_win: placed.is_win,
      multiplier: placed.multiplier,
      payout: placed.payout,
      balance_gold: await getNewBalance(supabase, ctx.user_id),
    });
  } catch (err) {
    return errorResponse(err);
  }
});

// اختيار خانة فائزة (مع مراعاة RTP)
function pickSegmentByRTP(segments: WheelSegment[], rtp: number): number {
  // احتمالات معدّلة بحيث RTP النظري = rtp
  // النموذج البسيط: تعديل احتمال الخسارة (segment 0) لإبقاء RTP عند المطلوب
  const winningSegments = segments.filter(s => s.value > 0);
  let totalWinProb = winningSegments.reduce((s, seg) => s + seg.probability, 0);

  // العائد المتوقع = sum(prob_i * value_i)
  // نريد أن يكون = rtp/100
  // نُعدّل احتمالات الخانات الفائزة بنسبة (rtp / (currentExpected * 100))
  const currentExpected = winningSegments.reduce((s, seg) => s + seg.probability * seg.value, 0);
  const targetExpected = rtp / 100;
  const adjustment = currentExpected > 0 ? targetExpected / currentExpected : 1;

  // احتمالات معدّلة
  const adjustedProbs = segments.map((seg, idx) => {
    if (seg.value > 0) {
      return Math.min(0.99, seg.probability * adjustment);
    } else {
      // باقي احتمال الخسارة
      return Math.max(0.01, 1 - winningSegments.reduce((s, w) => s + Math.min(0.99, w.probability * adjustment), 0));
    }
  });

  // اختيار عشوائي
  const rand = secureRandom();
  let cumul = 0;
  for (let i = 0; i < segments.length; i++) {
    cumul += adjustedProbs[i];
    if (rand < cumul) return i;
  }
  return segments.length - 1;
}

function pickWinningSegment(segments: WheelSegment[], rtp: number, chosenSegment: number): number {
  // اختيار خانة فائزة من بين الخانات (وليس بالضرورة الخانة المختارة)
  // الأبسط: إرجاع الخانة المختارة إذا كانت فائزة، وإلا خانة فائزة منخفضة القيمة
  if (segments[chosenSegment].value > 0) {
    return chosenSegment;
  }
  // اختر أصغر خانة فائزة
  for (let i = 0; i < segments.length; i++) {
    if (segments[i].value > 0) return i;
  }
  return 0;
}

async function getNewBalance(supabase: any, userId: string): Promise<number> {
  const { data, error } = await supabase.from('users').select('balance_gold').eq('id', userId).single();
  if (error) throw new HttpError(500, 'BALANCE_LOAD_FAILED', 'Could not load Coin balance');
  return Number(data.balance_gold);
}
