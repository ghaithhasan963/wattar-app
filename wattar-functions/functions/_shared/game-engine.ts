/**
 * Wattar Game Engine — محرك الألعاب المشترك
 *
 * المبادئ (M9.4):
 *  1) Server-Authoritative: كل النتائج تُحسب على السيرفر فقط
 *  2) RTP configurable: من game_configs.default_rtp أو users.rtp_override (لا يُخفَّض تحت الافتراضي)
 *  3) Promo Wins معلنة: is_force_win يُعاد للمستخدم كـpromo_reward صريح، ولا تُطبَّق خسارة مضمونة
 *  4) Seed لكل جولة للتحقق
 *  5) Atomic: الرهان + التسوية في معاملة واحدة
 *  6) Test mode: نفس محرك النتائج لكن بلا أرصدة حقيقية
 *
 * @version 2.0.0
 */
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { HttpError } from './supabase.ts';

export type GameType = 'wheel' | 'dice' | 'aviator' | 'plinko' | 'slots';

export interface GameContext {
  user_id: string;
  game_type: GameType;
  idempotency_key: string;
  request_data: Record<string, unknown>;
  bet_amount: number;
  bet_data: Record<string, unknown>;
  room_id?: string | null;
  test_mode?: boolean;
}

export interface GameResult {
  round_id: string;
  is_win: boolean;
  multiplier: number;
  payout: number;
  result: Record<string, unknown>;
  forced_outcome: 'win' | null;
  rtp_applied: number;
}

// ============================================================================
// 1) جلب إعدادات اللعبة
// ============================================================================
export async function getGameConfig(supabase: SupabaseClient, gameType: GameType) {
  const { data, error } = await supabase
    .from('game_configs')
    .select('*')
    .eq('game_type', gameType)
    .single();

  if (error || !data) {
    throw new HttpError(404, 'GAME_NOT_CONFIGURED', `Game ${gameType} is not configured`);
  }
  if (data.archived_at) {
    throw new HttpError(404, 'GAME_NOT_CONFIGURED', `Game ${gameType} is not available`);
  }
  if (!data.is_enabled) {
    throw new HttpError(403, 'GAME_DISABLED', `Game ${gameType} is currently disabled`);
  }
  return data;
}

// ============================================================================
// 2) بوابة اللعب (تشغيل/جغرافيا/عمر/حالة الحساب) — مصدر واحد على الخادم
// ============================================================================
export interface GameGate {
  allowed: boolean;
  reason: string | null;
  test_mode_enabled: boolean;
  min_bet: number;
  max_bet: number;
  max_multiplier: number;
  rtp: number;
}

export async function assertGameAvailable(
  supabase: SupabaseClient,
  userId: string,
  gameType: GameType,
): Promise<GameGate> {
  const { data, error } = await supabase.rpc('game_play_gate', {
    p_user_id: userId,
    p_game_type: gameType,
  });
  if (error) {
    throw new HttpError(500, 'GAME_GATE_FAILED', 'Could not verify game availability');
  }
  const gate = data as GameGate | null;
  if (!gate || gate.allowed !== true) {
    const reasons: Record<string, string> = {
      disabled: 'هذه اللعبة متوقفة حالياً',
      region: 'هذه اللعبة غير متاحة في منطقتك',
      age: 'هذه اللعبة تتطلب تأكيد العمر',
      inactive: 'الحساب غير نشط',
      not_found: 'اللعبة غير متاحة',
      invalid: 'طلب غير صالح',
    };
    throw new HttpError(403, 'GAME_UNAVAILABLE', reasons[gate?.reason ?? 'not_found'] ?? 'اللعبة غير متاحة');
  }
  return gate;
}

// ============================================================================
// 3) جلب حالة المستخدم للعبة (RTP, promo flags, balance, bet limits)
// ============================================================================
export interface UserGameState {
  balance_gold: number;
  rtp_override: number | null;
  is_force_win: boolean;
  is_force_lose: boolean;
  force_outcome_count: number;
  bet_limit_override: { min: number; max: number } | null;
  status: string;
}

export async function getUserGameState(supabase: SupabaseClient, userId: string): Promise<UserGameState> {
  const { data, error } = await supabase
    .from('users')
    .select('balance_gold, rtp_override, is_force_win, is_force_lose, force_outcome_count, bet_limit_override, status')
    .eq('id', userId)
    .single();

  if (error || !data) {
    throw new HttpError(404, 'USER_NOT_FOUND', 'User not found');
  }
  return data;
}

// ============================================================================
// 4) RNG آمن — يستخدم crypto.getRandomValues
// ============================================================================
export function secureRandom(): number {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return arr[0] / 0x100000000;
}

export function secureRandomInt(min: number, max: number): number {
  return Math.floor(secureRandom() * (max - min + 1)) + min;
}

export function generateSeed(): string {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** اختيار فهرس وفق أوزان معلنة (تُطبَّع داخلياً). */
export function pickWeightedIndex(weights: number[]): number {
  const total = weights.reduce((sum, w) => sum + (Number.isFinite(w) && w > 0 ? w : 0), 0);
  if (total <= 0) return 0;
  let ticket = secureRandom() * total;
  for (let i = 0; i < weights.length; i += 1) {
    const w = Number.isFinite(weights[i]) && weights[i] > 0 ? weights[i] : 0;
    if (ticket < w) return i;
    ticket -= w;
  }
  return weights.length - 1;
}

/** توزيع ثنائي دقيق (احتمال 0.5) — عدد النجاحات من p_trials محاولة. */
export function binomialDraw(trials: number): number {
  let rights = 0;
  for (let i = 0; i < trials; i += 1) {
    if (secureRandom() < 0.5) rights += 1;
  }
  return rights;
}

// ============================================================================
// 5) تحديد RTP المطبّق + promo outcome
// ============================================================================
export function determineRTP(userState: UserGameState, gameConfig: { default_rtp: number }): number {
  const base = Number(gameConfig.default_rtp);
  const override = userState.rtp_override === null || userState.rtp_override === undefined
    ? null
    : Number(userState.rtp_override);
  // لا يُسمح بتخفيض فرص المستخدم سراً تحت الافتراضي المعلن
  if (override === null || !Number.isFinite(override)) return base;
  return Math.max(base, Math.min(100, override));
}

export function checkForcedOutcome(userState: UserGameState): 'win' | null {
  // المكافأة الترويجية المضمونة فقط، وتُعلن للمستخدم في الاستجابة.
  // لا تُطبَّق أي خسارة مضمونة (قسم 19: منع التلاعب السري).
  return userState.is_force_win ? 'win' : null;
}

// ============================================================================
// 6) خصم الرهان + تسجيل الجولة + تسوية الدفع (أو محاكاة بلا أرصدة)
// ============================================================================
export async function placeBetAndSettle(
  supabase: SupabaseClient,
  ctx: GameContext,
  result: GameResult,
): Promise<{
  round_id: string;
  bet_id: string;
  is_win: boolean;
  multiplier: number;
  payout: number;
  result: Record<string, unknown>;
  test_mode: boolean;
}> {
  const fn = ctx.test_mode ? 'play_game_simulation' : 'play_game_with_points';
  const params: Record<string, unknown> = {
    p_user_id: ctx.user_id,
    p_game_type: ctx.game_type,
    p_idempotency_key: ctx.idempotency_key,
    p_request_data: ctx.request_data,
    p_bet_amount: ctx.bet_amount,
    p_bet_data: ctx.bet_data,
    p_result: result.result,
    p_payout: result.payout,
    p_multiplier: result.multiplier,
    p_is_win: result.is_win,
    p_forced_outcome: result.forced_outcome,
    p_rtp: result.rtp_applied,
    p_seed: generateSeed(),
  };
  if (!ctx.test_mode) {
    params.p_room_id = ctx.room_id ?? null;
  }

  const { data, error } = await supabase.rpc(fn, params);
  if (
    error || !data || typeof data.round_id !== 'string' || typeof data.bet_id !== 'string'
    || typeof data.is_win !== 'boolean' || typeof data.multiplier !== 'number'
    || typeof data.payout !== 'number' || typeof data.result !== 'object' || data.result === null
  ) {
    throw new HttpError(400, 'GAME_SETTLEMENT_FAILED', error?.message ?? 'Could not settle the game');
  }
  return {
    round_id: data.round_id,
    bet_id: data.bet_id,
    is_win: data.is_win,
    multiplier: data.multiplier,
    payout: data.payout,
    result: data.result as Record<string, unknown>,
    test_mode: data.test_mode === true,
  };
}

// ============================================================================
// 7) التحقق من حدود الرهان
// ============================================================================
export function validateBetAmount(
  betAmount: number,
  gameConfig: { min_bet_gold: number; max_bet_gold: number },
  userOverride: { min: number; max: number } | null,
): void {
  if (!Number.isSafeInteger(betAmount) || betAmount <= 0) {
    throw new HttpError(400, 'INVALID_BET', 'Bet amount must be a positive whole number');
  }
  const min = userOverride?.min ?? Number(gameConfig.min_bet_gold);
  const max = userOverride?.max ?? Number(gameConfig.max_bet_gold);

  if (betAmount < min) {
    throw new HttpError(400, 'BET_TOO_LOW', `Minimum bet is ${min}`);
  }
  if (betAmount > max) {
    throw new HttpError(400, 'BET_TOO_HIGH', `Maximum bet is ${max}`);
  }
}

// ============================================================================
// 8) رصيد Coin الحالي
// ============================================================================
export async function getBalanceGold(supabase: SupabaseClient, userId: string): Promise<number> {
  const { data, error } = await supabase.from('users').select('balance_gold').eq('id', userId).single();
  if (error) throw new HttpError(500, 'BALANCE_LOAD_FAILED', 'Could not load Coin balance');
  return Number(data.balance_gold);
}

// ============================================================================
// 9) قراءة test_mode من الطلب مع التحقق من التفعيل
// ============================================================================
export function readTestMode(body: { test_mode?: unknown }, gate: GameGate): boolean {
  const requested = body.test_mode === true;
  if (requested && !gate.test_mode_enabled) {
    throw new HttpError(403, 'TEST_MODE_DISABLED', 'وضع المحاكاة غير مفعّل لهذه اللعبة');
  }
  return requested;
}

/** يقرأ قيمة رقمية من إعدادات اللعبة مع قيمة افتراضية. */
export function settingNumber(settings: Record<string, unknown>, key: string, fallback: number): number {
  const raw = settings?.[key];
  const value = typeof raw === 'string' ? Number(raw) : raw;
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
