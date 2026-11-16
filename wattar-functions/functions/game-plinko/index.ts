/**
 * Wattar Edge Function — game-plinko (بلانغو)
 *
 * POST /functions/v1/game-plinko
 * Body: { "bet_amount": number, "risk_level": "low" | "medium" | "high" }
 *
 * منطق اللعبة:
 *   - كرة تسقط عبر صف من الأوتاد، تنحرف يمينًا/يسارًا عشوائيًا
 *   - تنتهي في خانة مع مضاعف معين
 *   - 12 صف + 11 خانة نهاية
 *   - 3 مستويات مخاطرة: low / medium / high
 *
 * توزيع الخانات:
 *   - منخفض: توزيع متوازن حول الوسط
 *   - مرتفع: خانات الأطراف لها مضاعفات عالية جدًا
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

interface PlinkoBody {
  bet_amount: number;
  risk_level: 'low' | 'medium' | 'high';
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return jsonResponse({}, 200);
  if (req.method !== 'POST') return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);

  try {
    const ctx = await authenticate(req);
    await rateLimitByUser(ctx, 'place_bet', 5, 1000);
    const idempotencyKey = requireIdempotencyKey(req);

    const body = await parseBody<PlinkoBody>(req);
    if (!body.bet_amount || body.bet_amount <= 0) {
      throw new HttpError(400, 'INVALID_BET', 'Bet amount must be positive');
    }
    if (!['low', 'medium', 'high'].includes(body.risk_level)) {
      throw new HttpError(400, 'INVALID_RISK', 'risk_level must be low/medium/high');
    }

    const supabase = getSupabaseAdmin();
    const config = await getGameConfig(supabase, 'plinko');
    const userState = await getUserGameState(supabase, ctx.user_id);

    if (userState.game_points < body.bet_amount) {
      throw new HttpError(400, 'INSUFFICIENT_BALANCE', 'Not enough free game points');
    }
    validateBetAmount(body.bet_amount, config, userState.bet_limit_override);

    const rtp = determineRTP(userState, config);
    const forced = checkForcedOutcome(userState);

    // المضاعفات من الإعدادات
    const multipliers: number[] = config.settings.multipliers[body.risk_level];
    const rows = Number(config.settings.rows ?? 12);
    const slots = multipliers.length; // عادة 11

    // محاكاة المسار: لكل صف، انحراف يمين/يسار عشوائي
    // عدد الانحرافات لليمين يتبع توزيع Binomial(rows, 0.5)
    // الخانة النهائية = rightCount (0..rows)
    let rightCount: number;
    if (forced === 'lose') {
      // اختر خانة بمضاعف صفر أو منخفض جدًا
      rightCount = pickLoseSlot(multipliers);
    } else if (forced === 'win') {
      // اختر خانة فائزة
      rightCount = pickWinSlot(multipliers);
    } else {
      // محاكاة عشوائية مع تعديل بسيط لـ RTP
      rightCount = simulatePlinkoPath(rows, rtp, multipliers);
    }

    const finalSlot = Math.min(rightCount, slots - 1);
    const path = simulatePath(rows, rightCount);
    const multiplier = multipliers[finalSlot];
    const isWin = multiplier >= 1;
    const payout = Math.floor(body.bet_amount * multiplier);

    const gameCtx: GameContext = {
      user_id: ctx.user_id,
      game_type: 'plinko',
      idempotency_key: idempotencyKey,
      request_data: { risk_level: body.risk_level },
      bet_amount: body.bet_amount,
      bet_data: { risk_level: body.risk_level, final_slot: finalSlot, path },
    };

    const result: GameResult = {
      round_id: '',
      is_win: isWin,
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
      round_id: placed.round_id,
      bet_id: placed.bet_id,
      final_slot: Number(placed.result.final_slot),
      path: placed.result.path,
      multiplier: placed.multiplier,
      is_win: placed.is_win,
      payout: placed.payout,
      path_length: Number(placed.result.rows),
      game_points: await getNewBalance(supabase, ctx.user_id),
    });
  } catch (err) {
    return errorResponse(err);
  }
});

function simulatePlinkoPath(rows: number, rtp: number, multipliers: number[]): number {
  // لكل خانة k (0..rows): احتمال = C(rows, k) * 0.5^rows
  // نعدّل الاحتمالات بحيث RTP المتوقع = rtp
  const slots = multipliers.length;
  const baseProbs = Array.from({ length: slots }, (_, k) => binomialProb(rows, k, slots));

  // العائد المتوقع الحالي
  const currentExpected = baseProbs.reduce((s, p, k) => s + p * multipliers[k], 0);
  const targetExpected = rtp / 100;

  // تعديل بسيط: زيادة احتمال خانة الصفر وإلا زيادة الفائزين
  // الطريقة الأبسط: clip الـexpected إلى target عبر تحريك الاحتمال نحو الخسارة
  if (currentExpected > targetExpected) {
    // زيادة احتمال الخسارة (الخانات بمضاعف < 1)
    const lossIndices = multipliers.map((m, i) => m < 1 ? i : -1).filter(i => i >= 0);
    if (lossIndices.length > 0) {
      // نقل 5% من الفائزين للخاسرين
      const shift = Math.min(0.05, (currentExpected - targetExpected));
      const adjusted = [...baseProbs];
      // إعادة التوزيع
      adjusted[lossIndices[0]] += shift;
      // خصم من الفائزين بالتناسب
      const winIdx = multipliers.map((m, i) => m >= 1 ? i : -1).filter(i => i >= 0);
      const totalWin = winIdx.reduce((s, i) => s + adjusted[i], 0);
      for (const i of winIdx) {
        adjusted[i] *= (1 - shift / totalWin);
      }
      // إعادة التطبيع
      const sum = adjusted.reduce((a, b) => a + b, 0);
      const norm = adjusted.map(p => p / sum);
      // اختيار عشوائي
      return pickFromDist(norm);
    }
  }

  return pickFromDist(baseProbs);
}

function binomialProb(rows: number, k: number, slots: number): number {
  // تقريب: توزيع binomial مع مركز في النصف
  // للـ12 صف و11 خانة: k=0..10 → خانون الوسط هما 5,6
  // E[Binomial(12, 0.5)] = 6
  // C(12, k) * 0.5^12
  const n = rows;
  const p = 0.5;
  const c = binomialCoefficient(n, Math.min(k, n));
  return c * Math.pow(p, n);
}

function binomialCoefficient(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  let result = 1;
  for (let i = 0; i < k; i++) {
    result = (result * (n - i)) / (i + 1);
  }
  return Math.round(result);
}

function pickFromDist(probs: number[]): number {
  const sum = probs.reduce((a, b) => a + b, 0);
  const norm = probs.map(p => p / sum);
  let u = secureRandom();
  for (let i = 0; i < norm.length; i++) {
    u -= norm[i];
    if (u <= 0) return i;
  }
  return norm.length - 1;
}

function pickLoseSlot(multipliers: number[]): number {
  // اختر خانة بمضاعف < 1
  const lossIdx = multipliers.map((m, i) => m < 1 ? i : -1).filter(i => i >= 0);
  if (lossIdx.length === 0) return 0;
  return lossIdx[Math.floor(secureRandom() * lossIdx.length)];
}

function pickWinSlot(multipliers: number[]): number {
  // اختر خانة بمضاعف >= 2
  const winIdx = multipliers.map((m, i) => m >= 2 ? i : -1).filter(i => i >= 0);
  if (winIdx.length === 0) {
    // اختر أعلى خانة
    let max = 0, maxIdx = 0;
    multipliers.forEach((m, i) => { if (m > max) { max = m; maxIdx = i; } });
    return maxIdx;
  }
  return winIdx[Math.floor(secureRandom() * winIdx.length)];
}

function simulatePath(rows: number, rightCount: number): Array<'L' | 'R'> {
  const path: Array<'L' | 'R'> = [];
  let rights = rightCount;
  for (let i = 0; i < rows; i++) {
    if (rights > 0 && secureRandom() < rights / (rows - i)) {
      path.push('R');
      rights--;
    } else {
      path.push('L');
    }
  }
  return path;
}

async function getNewBalance(supabase: any, userId: string): Promise<number> {
  const { data, error } = await supabase.from('users').select('game_points').eq('id', userId).single();
  if (error) throw new HttpError(500, 'BALANCE_LOAD_FAILED', 'Could not load game points');
  return Number(data.game_points);
}
