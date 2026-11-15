import { describe, expect, it } from 'vitest';
import {
  HOUR_MS,
  RECOVERY_COOLDOWN_MS,
  RECOVERY_MAX_PER_HOUR,
  RECOVERY_SESSION_TTL_MS,
  checkRecoveryAllowance,
  clearSessionMark,
  describeRecoveryWait,
  isRecoverySessionFresh,
  parseAttempts,
  parseSessionMark,
  pruneAttempts,
  readAttempts,
  readSessionMark,
  recordAttempt,
  saveSessionMark,
  validateNewPassword,
  withRecoveryAttempt,
  type KeyValueStorage,
  type RecoverySessionMark,
} from './recovery';

const NOW = 1_800_000_000_000;

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const storage: KeyValueStorage & { data: Map<string, string> } = {
    data,
    getItem: async (key) => data.get(key) ?? null,
    setItem: async (key, value) => {
      data.set(key, value);
    },
    removeItem: async (key) => {
      data.delete(key);
    },
  };
  return storage;
}

describe('recovery attempt limits', () => {
  it('allows the first attempt', () => {
    const result = checkRecoveryAllowance([], NOW);
    expect(result.allowed).toBe(true);
    expect(result.retryAfterMs).toBe(0);
    expect(result.remaining).toBe(RECOVERY_MAX_PER_HOUR);
  });

  it('blocks a second attempt during the cooldown with the remaining seconds', () => {
    const result = checkRecoveryAllowance([NOW - 15_000], NOW);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('cooldown');
    expect(result.retryAfterMs).toBe(RECOVERY_COOLDOWN_MS - 15_000);
  });

  it('allows again once the cooldown has passed', () => {
    expect(checkRecoveryAllowance([NOW - RECOVERY_COOLDOWN_MS], NOW).allowed).toBe(true);
  });

  it(`blocks after ${RECOVERY_MAX_PER_HOUR} attempts in an hour and reports the window`, () => {
    const attempts = [NOW - 3_600_000 + 60_000, NOW - 50_000, NOW - 40_000, NOW - 30_000, NOW - 20_000];
    const result = checkRecoveryAllowance(attempts, NOW);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('hourly_limit');
    expect(result.retryAfterMs).toBe(60_000);
  });

  it('drops attempts older than one hour', () => {
    const attempts = [NOW - HOUR_MS - 1, NOW - HOUR_MS + 1];
    expect(pruneAttempts(attempts, NOW)).toEqual([NOW - HOUR_MS + 1]);
  });

  it('records an attempt and prunes the old ones', () => {
    const next = withRecoveryAttempt([NOW - HOUR_MS - 5], NOW);
    expect(next).toEqual([NOW]);
  });

  it('tolerates nonsense stored values', () => {
    expect(parseAttempts(null)).toEqual([]);
    expect(parseAttempts('not json')).toEqual([]);
    expect(parseAttempts('{"a":1}')).toEqual([]);
    expect(parseAttempts('[1,"2",null,3]')).toEqual([1, 3]);
  });

  it('persists attempts through the storage adapter', async () => {
    const storage = memoryStorage();
    await recordAttempt(storage, NOW);
    const stored = await readAttempts(storage, NOW + 1_000);
    expect(stored).toEqual([NOW]);
  });
});

describe('recovery wait messages', () => {
  it('describes the cooldown in seconds', () => {
    expect(describeRecoveryWait('cooldown', 42_000)).toContain('42');
  });

  it('describes the hourly limit in minutes', () => {
    expect(describeRecoveryWait('hourly_limit', 120_000)).toContain('2');
  });

  it('never shows zero seconds', () => {
    expect(describeRecoveryWait('cooldown', 0)).toContain('1');
  });
});

describe('new password validation', () => {
  it('accepts a valid matching password', () => {
    expect(validateNewPassword('strong-pass', 'strong-pass')).toEqual({ ok: true });
  });

  it('rejects short passwords', () => {
    const result = validateNewPassword('short', 'short');
    expect(result.ok).toBe(false);
  });

  it('rejects mismatched confirmation', () => {
    const result = validateNewPassword('strong-pass', 'strong-pas');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('غير متطابقتين');
  });

  it('rejects a password longer than the maximum', () => {
    const long = 'a'.repeat(129);
    expect(validateNewPassword(long, long).ok).toBe(false);
  });

  it('rejects an all-whitespace password', () => {
    expect(validateNewPassword('        ', '        ').ok).toBe(false);
  });
});

describe('recovery session gate', () => {
  const mark: RecoverySessionMark = { userId: 'user-1', startedAt: NOW };

  it('accepts a fresh mark', () => {
    expect(isRecoverySessionFresh(mark, NOW + 1_000)).toBe(true);
  });

  it('rejects a missing mark', () => {
    expect(isRecoverySessionFresh(null, NOW)).toBe(false);
  });

  it('rejects an expired mark', () => {
    expect(isRecoverySessionFresh(mark, NOW + RECOVERY_SESSION_TTL_MS + 1)).toBe(false);
  });

  it('rejects a mark from the future', () => {
    expect(isRecoverySessionFresh(mark, NOW - 1_000)).toBe(false);
  });

  it('rejects an empty user id', () => {
    expect(isRecoverySessionFresh({ userId: '', startedAt: NOW }, NOW)).toBe(false);
  });

  it('round-trips the mark through storage and clears it', async () => {
    const storage = memoryStorage();
    await saveSessionMark(storage, mark);
    expect(await readSessionMark(storage)).toEqual(mark);
    await clearSessionMark(storage);
    expect(await readSessionMark(storage)).toBeNull();
  });

  it('tolerates corrupt marks', () => {
    expect(parseSessionMark('oops')).toBeNull();
    expect(parseSessionMark('{"userId":1}')).toBeNull();
  });
});
