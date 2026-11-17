/**
 * Wattar Game Engine — محرك الألعاب المشترك
 *
 * المبادئ:
 *  1) Server-Authoritative: كل النتائج تُحسب على السيرفر فقط
 *  2) RTP configurable: من game_configs.default_rtp أو users.rtp_override
 *  3) Forced Outcomes: is_force_win / is_force_lose للمستخدم
 *  4) Seed لكل جولة للتحقق
 *  5) Atomic: الرهان + التسوية في معاملة واحدة
 *
 * @version 1.0.1
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
}

export interface GameResult {
  round_id: string;
  is_win: boolean;
  multiplier: number;
  payout: number;
  result: Record<string, unknown>;
  forced_outcome: 'win' | 'lose' | null;
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
  if (!data.is_enabled) {
    throw new HttpError(403, 'GAME_DISABLED', `Game ${gameType} is currently disabled`);
  }
  return data;
}

// ============================================================================
// 2) جلب حالة المستخدم للعبة (RTP, force flags, balance, bet limits)
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
// 3) RNG آمن — يستخدم crypto.getRandomValues
// ============================================================================
export function secureRandom(): number {
  // يولّد رقم [0, 1) عشوائي آمن
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

// ============================================================================
// 4) تحديد RTP المطبّق + forced outcome
// ============================================================================
export function determineRTP(userState: UserGameState, gameConfig: { default_rtp: number }): number {
  // RTP المستخدم > إعداد اللعبة الافتراضي
  return userState.rtp_override ?? Number(gameConfig.default_rtp);
}

export function checkForcedOutcome(userState: UserGameState): 'win' | 'lose' | null {
  if (userState.is_force_win) return 'win';
  if (userState.is_force_lose) return 'lose';
  return null;
}

// ============================================================================
// 5) خصم الرهان + تسجيل الجولة + تسوية الدفع
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
}> {
  const { data, error } = await supabase.rpc('play_game_with_points', {
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
    p_room_id: ctx.room_id ?? null,
    p_seed: generateSeed(),
  });
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
  };
}

// ============================================================================
// 6) التحقق من حدود الرهان
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
