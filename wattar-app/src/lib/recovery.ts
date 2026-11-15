/**
 * Wattar — تقوية استعادة كلمة المرور (M1.2).
 *
 * المنطق هنا نقي (بلا React وبلا تخزين فعلي) حتى يُختبر مباشرة:
 *  - حدّ محاولات: فترة تهدئة دقيقة واحدة + ٥ محاولات كحد أقصى في الساعة.
 *  - تحقّق من قوة كلمة المرور الجديدة.
 *  - بوابة «جلسة استعادة»: لا تُقبل إعادة التعيين إلا إذا وصل المستخدم من
 *    رابط الاستعادة نفسه وخلال مدة صلاحية قصيرة.
 *
 * القاعدة الأمنية: أي رسالة للمستخدم لا تكشف إن كان البريد مسجّلاً أم لا.
 */

/** مهلة الانتظار بين طلب وآخر. */
export const RECOVERY_COOLDOWN_MS = 60_000;

/** أقصى عدد طلبات مسموح بها في الساعة الواحدة. */
export const RECOVERY_MAX_PER_HOUR = 5;

export const HOUR_MS = 60 * 60 * 1000;

/** عمر جلسة الاستعادة قبل اعتبارها منتهية. */
export const RECOVERY_SESSION_TTL_MS = 30 * 60 * 1000;

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export const RECOVERY_ATTEMPTS_KEY = 'wattar-recovery-attempts';
export const RECOVERY_SESSION_KEY = 'wattar-recovery-session';

export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem?(key: string): Promise<void>;
}

export type RecoveryBlockReason = 'cooldown' | 'hourly_limit';

export interface RecoveryAllowance {
  allowed: boolean;
  reason?: RecoveryBlockReason;
  /** كم بقي بالمللي ثانية قبل المحاولة التالية. */
  retryAfterMs: number;
  /** كم محاولة بقي له في الساعة الحالية. */
  remaining: number;
}

/** يُبقي المحاولات التي وقعت خلال الساعة الأخيرة فقط. */
export function pruneAttempts(attempts: readonly number[], now: number): number[] {
  const cutoff = now - HOUR_MS;
  return attempts.filter((at) => Number.isFinite(at) && at > cutoff && at <= now).sort((a, b) => a - b);
}

/** هل يُسمح بمحاولة جديدة الآن؟ */
export function checkRecoveryAllowance(
  attempts: readonly number[],
  now: number,
): RecoveryAllowance {
  const fresh = pruneAttempts(attempts, now);
  const remaining = Math.max(0, RECOVERY_MAX_PER_HOUR - fresh.length);

  if (fresh.length >= RECOVERY_MAX_PER_HOUR) {
    const oldest = fresh[fresh.length - RECOVERY_MAX_PER_HOUR];
    const retryAfterMs = Math.max(0, oldest + HOUR_MS - now);
    return { allowed: false, reason: 'hourly_limit', retryAfterMs, remaining: 0 };
  }

  const last = fresh[fresh.length - 1];
  if (last !== undefined && now - last < RECOVERY_COOLDOWN_MS) {
    return {
      allowed: false,
      reason: 'cooldown',
      retryAfterMs: RECOVERY_COOLDOWN_MS - (now - last),
      remaining,
    };
  }

  return { allowed: true, retryAfterMs: 0, remaining };
}

/** يضيف محاولة جديدة ويعيد القائمة المقصوصة. */
export function withRecoveryAttempt(attempts: readonly number[], now: number): number[] {
  return pruneAttempts([...attempts, now], now);
}

/** رسالة عربية لمهلة الانتظار، بثوانٍ مقرّبة للأعلى. */
export function describeRecoveryWait(reason: RecoveryBlockReason, retryAfterMs: number): string {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  if (reason === 'hourly_limit') {
    const minutes = Math.max(1, Math.ceil(seconds / 60));
    return `تجاوزت عدد طلبات إعادة التعيين المسموح بها. حاول بعد ${minutes} دقيقة.`;
  }
  return `انتظر ${seconds} ثانية قبل طلب رابط جديد.`;
}

export type PasswordValidation =
  | { ok: true }
  | { ok: false; message: string };

/** تحقّق موحّد لكلمة المرور الجديدة (نفس قواعد شاشة الاستعادة). */
export function validateNewPassword(password: string, confirmation: string): PasswordValidation {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, message: `كلمة المرور يجب أن تكون ${PASSWORD_MIN_LENGTH} أحرف على الأقل.` };
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return { ok: false, message: `كلمة المرور طويلة جداً (الحد ${PASSWORD_MAX_LENGTH} حرفاً).` };
  }
  if (password.trim().length === 0) {
    return { ok: false, message: 'كلمة المرور لا يمكن أن تكون مسافات فقط.' };
  }
  if (password !== confirmation) {
    return { ok: false, message: 'كلمتا المرور غير متطابقتين.' };
  }
  return { ok: true };
}

export interface RecoverySessionMark {
  userId: string;
  startedAt: number;
}

/** هل جلسة الاستعادة ما زالت صالحة؟ */
export function isRecoverySessionFresh(
  mark: RecoverySessionMark | null,
  now: number,
): mark is RecoverySessionMark {
  if (!mark) return false;
  if (typeof mark.userId !== 'string' || mark.userId.length === 0) return false;
  if (!Number.isFinite(mark.startedAt)) return false;
  return now >= mark.startedAt && now - mark.startedAt <= RECOVERY_SESSION_TTL_MS;
}

/** قراءة محاولات محفوظة بأمان (أي تلف يعيد قائمة فارغة). */
export function parseAttempts(raw: string | null): number[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  } catch {
    return [];
  }
}

/** قراءة علامة جلسة الاستعادة بأمان. */
export function parseSessionMark(raw: string | null): RecoverySessionMark | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<RecoverySessionMark>;
    if (typeof parsed?.userId !== 'string' || typeof parsed?.startedAt !== 'number') return null;
    return { userId: parsed.userId, startedAt: parsed.startedAt };
  } catch {
    return null;
  }
}

export async function readAttempts(
  storage: KeyValueStorage,
  now: number,
): Promise<number[]> {
  return pruneAttempts(parseAttempts(await storage.getItem(RECOVERY_ATTEMPTS_KEY)), now);
}

export async function recordAttempt(
  storage: KeyValueStorage,
  now: number,
): Promise<number[]> {
  const next = withRecoveryAttempt(await readAttempts(storage, now), now);
  await storage.setItem(RECOVERY_ATTEMPTS_KEY, JSON.stringify(next));
  return next;
}

export async function saveSessionMark(
  storage: KeyValueStorage,
  mark: RecoverySessionMark,
): Promise<void> {
  await storage.setItem(RECOVERY_SESSION_KEY, JSON.stringify(mark));
}

export async function readSessionMark(
  storage: KeyValueStorage,
): Promise<RecoverySessionMark | null> {
  return parseSessionMark(await storage.getItem(RECOVERY_SESSION_KEY));
}

export async function clearSessionMark(storage: KeyValueStorage): Promise<void> {
  if (storage.removeItem) {
    await storage.removeItem(RECOVERY_SESSION_KEY);
    return;
  }
  await storage.setItem(RECOVERY_SESSION_KEY, '');
}
