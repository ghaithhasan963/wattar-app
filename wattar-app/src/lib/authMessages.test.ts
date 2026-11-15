import { describe, expect, it } from 'vitest';
import {
  GENERIC_AUTH_ERROR,
  RECOVERY_EMAIL_FAILED_MESSAGE,
  RECOVERY_EMAIL_SENT_MESSAGE,
  describeAuthError,
  describeRecoveryRequestError,
} from './authMessages';

describe('describeAuthError', () => {
  it('translates wrong credentials', () => {
    expect(describeAuthError(new Error('Invalid login credentials'))).toContain('غير صحيحة');
  });

  it('translates an unconfirmed email', () => {
    expect(describeAuthError({ message: 'Email not confirmed' })).toContain('تأكيد');
  });

  it('translates an existing account without leaking the raw text', () => {
    const message = describeAuthError(new Error('User already registered'));
    expect(message).toContain('مسجّل');
    expect(message).not.toContain('already');
  });

  it('translates rate limits including the numeric status', () => {
    expect(describeAuthError({ message: 'Request failed', code: '429' })).toContain('طلبات كثيرة');
  });

  it('translates expired recovery tokens', () => {
    expect(describeAuthError(new Error('Auth session missing!'))).toContain('انتهت صلاحية');
  });

  it('translates network failures', () => {
    expect(describeAuthError(new Error('Network request failed'))).toContain('الاتصال');
  });

  it('falls back to Arabic for unknown English errors', () => {
    const message = describeAuthError(new Error('Something odd happened'));
    expect(message).toBe(GENERIC_AUTH_ERROR);
    expect(/[a-z]/i.test(message)).toBe(false);
  });

  it('passes through Arabic messages coming from our own functions', () => {
    expect(describeAuthError(new Error('تعذر إنشاء الحساب. حاول مرة أخرى.'))).toBe('تعذر إنشاء الحساب. حاول مرة أخرى.');
  });

  it('supports string errors and custom fallbacks', () => {
    expect(describeAuthError('invalid login credentials')).toContain('غير صحيحة');
    expect(describeAuthError(undefined, 'بديل')).toBe('بديل');
  });
});

describe('recovery request messages', () => {
  it('always offers the same neutral success copy', () => {
    expect(RECOVERY_EMAIL_SENT_MESSAGE).toContain('إذا كان البريد مسجّلاً');
  });

  it('does not reveal unknown accounts on failure', () => {
    const message = describeRecoveryRequestError(new Error('User not found'));
    expect(message).toBe(RECOVERY_EMAIL_FAILED_MESSAGE);
    expect(message).not.toContain('not found');
  });

  it('still reports real network and rate-limit problems', () => {
    expect(describeRecoveryRequestError(new Error('fetch failed'))).toContain('الاتصال');
    expect(describeRecoveryRequestError(new Error('email rate limit exceeded'))).toContain('طلبات كثيرة');
  });
});
