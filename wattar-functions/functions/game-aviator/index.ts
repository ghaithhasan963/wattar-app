/**
 * Wattar Edge Function — game-aviator (طيارة المضاعفات)
 *
 * POST /functions/v1/game-aviator
 * Body:
 *   {
 *     "bet_amount": number,
 *     "auto_cashout_multiplier"?: number  // إذا أراد السحب التلقائي عند مضاعف معين
 *   }
 *
 * منطق اللعبة:
 *   - الطيارة تُقلع ومضاعفها ينمو أُسّيًا
 *   - في أي لحظة قد "تنهار"
 *   - المستخدم يلعب بأسلوبين:
 *     أ) يلعب مع السيرفر: يراهن → ينتظر → يضغط "cashout" قبل الانهيار
 *     ب) يلعب تلقائيًا: يحدد مضاعف السحب التلقائي
 *   - هنا ننفّذ الأسلوب (ب): المستخدم يحدد مضاعف السحب، السيرفر يحدد نقطة الانهيار
 *
 * معادلة RTP:
 *   عند RTP = r (كسر، أي 25% = 0.25):
 *   - احتمال الانهيار الفوري (crash@1.0) ≈ (1 - r)
 *   - عند عدم الانهيار الفوري، crash_point ~ 1 / (1 - U)^(1/r) مع حد أقصى max_multiplier
 *
 * @version 1.0.0
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
  getGameConfig,
  getUserGameState,
  determineRTP,
  checkForcedOutcome,
  placeBetAndSettle,
  secureRandom,
  validateBetAmount,
} from '../_shared/game-engine.ts';

interface AviatorBody {
  bet_amount: number;
  auto_cashout_multiplier?: number;  // مثلاً 2.5 = السحب عند x2.5
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
    if (!body.bet_amount || body.bet_amount <= 0) {
      throw new HttpError(400, 'INVALID_BET', 'Bet amount must be positive');
    }
    if (!body.auto_cashout_multiplier || body.auto_cashout_multiplier < 1.01) {
      throw new HttpError(400, 'INVALID_CASHOUT', 'auto_cashout_multiplier must be >= 1.01');
    }

    const supabase = getSupabaseAdmin();

    // 1) إعدادات اللعبة
    const config = await getGameConfig(supabase, 'aviator');
    const maxMult = Number(config.max_multiplier);
    if (body.auto_cashout_multiplier > maxMult) {
      throw new HttpError(400, 'CASHOUT_TOO_HIGH', `Max multiplier is ${maxMult}`);
    }

    // 2) حالة المستخدم
    const userState = await getUserGameState(supabase, ctx.user_id);

    if (userState.balance_gold < body.bet_amount) {
      throw new HttpError(400, 'INSUFFICIENT_BALANCE', 'Not enough Coin balance');
    }
    validateBetAmount(body.bet_amount, config, userState.bet_limit_override);

    // 3) تحديد RTP و forced outcome
    const rtp = determineRTP(userState, config);
    const forced = checkForcedOutcome(userState);

    // 4) حساب نقطة الانهيار
    let crashPoint: number;
    if (forced === 'lose') {
      crashPoint = 1.0; // انهيار فوري
    } else if (forced === 'win') {
      // نقطة انهيار أعلى من auto_cashout
      crashPoint = Math.max(body.auto_cashout_multiplier * 1.5, 3.0);
    } else {
      crashPoint = computeCrashPoint(rtp, maxMult, config.settings);
    }

    // 5) تحديد الفوز
    const isWin = body.auto_cashout_multiplier < crashPoint;
    const multiplier = isWin ? body.auto_cashout_multiplier : 0;
    const payout = isWin ? Math.floor(body.bet_amount * multiplier) : 0;

    // 6) تنفيذ المعاملة
    const gameCtx: GameContext = {
      user_id: ctx.user_id,
      game_type: 'aviator',
      idempotency_key: idempotencyKey,
      request_data: { auto_cashout_multiplier: body.auto_cashout_multiplier },
      bet_amount: body.bet_amount,
      bet_data: { auto_cashout: body.auto_cashout_multiplier, crash_point: crashPoint },
    };

    const result: GameResult = {
      round_id: '',
      is_win: isWin,
      multiplier,
      payout,
      result: {
        crash_point: crashPoint,
        auto_cashout: body.auto_cashout_multiplier,
        rtp_target: rtp,
        max_multiplier: maxMult,
      },
      forced_outcome: forced,
      rtp_applied: rtp,
    };

    const placed = await placeBetAndSettle(supabase, gameCtx, result);

    return jsonResponse({
      success: true,
      round_id: placed.round_id,
      bet_id: placed.bet_id,
      crash_point: Number(placed.result.crash_point),
      auto_cashout: Number(placed.result.auto_cashout),
      is_win: placed.is_win,
      multiplier: placed.multiplier,
      payout: placed.payout,
      balance_gold: await getNewBalance(supabase, ctx.user_id),
    });
  } catch (err) {
    return errorResponse(err);
  }
});

/**
 * حساب نقطة الانهيار وفق RTP
 * نموذج: تكامل معكوس لدالة التوزيع
 *
 * عند RTP = r (0..1):
 *   - احتمال crash @ 1.0 = (1 - r)
 *   - للأرقام > 1.0: P(crash <= x) = 1 - r/x  =>  P(crash > x) = r/x
 *
 * ولذلك:
 *   crash_point = r / U  حيث U ~ Uniform(0, 1)
 *   مع clip إلى [1.0, maxMultiplier]
 *
 * تحقق: E[payout عند مراهنة بـ 1 بـ cashout @ x] = x * P(crash > x) = x * r/x = r ✓
 */
function computeCrashPoint(rtp: number, maxMult: number, settings: any): number {
  const r = rtp / 100;
  const u = secureRandom();

  // احتمال الانهيار الفوري
  const instantCrashProb = settings?.instant_crash_probability ?? 0.03;
  if (secureRandom() < instantCrashProb) {
    return 1.0;
  }

  // نموذج: crash = max(1, r / u)
  let crash = r / Math.max(u, 0.001);
  // الحد الأقصى
  crash = Math.min(crash, maxMult);
  // تقريب لمنزلتين
  crash = Math.max(1.0, Math.floor(crash * 100) / 100);

  return crash;
}

async function getNewBalance(supabase: any, userId: string): Promise<number> {
  const { data, error } = await supabase.from('users').select('balance_gold').eq('id', userId).single();
  if (error) throw new HttpError(500, 'BALANCE_LOAD_FAILED', 'Could not load Coin balance');
  return Number(data.balance_gold);
}
