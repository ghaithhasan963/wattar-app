import { describe, expect, it } from 'vitest';
import {
  createNetworkError,
  DEFAULT_REQUEST_TIMEOUT_MS,
  runWithTimeout,
  statusToErrorKind,
  toNetworkError,
} from './network';

describe('تصنيف حالة HTTP', () => {
  it('401 و403 صلاحية', () => {
    expect(statusToErrorKind(401)).toBe('permission');
    expect(statusToErrorKind(403)).toBe('permission');
  });

  it('429 والخمسينات خادم', () => {
    expect(statusToErrorKind(429)).toBe('server');
    expect(statusToErrorKind(500)).toBe('server');
    expect(statusToErrorKind(503)).toBe('server');
  });

  it('الأربعينات الأخرى خادم أيضاً لأن الشاشة تعرض نفس الصنف', () => {
    expect(statusToErrorKind(400)).toBe('server');
    expect(statusToErrorKind(404)).toBe('server');
  });
});

describe('toNetworkError', () =>  {
  it('يمرّر خطأ WattarNetworkError كما هو', () => {
    const original = createNetworkError('permission', { status: 403 });
    expect(toNetworkError(original)).toBe(original);
  });

  it('يضيف الحالة والرسالة لخطأ معروف بلا حالة', () => {
    const original = createNetworkError('server', { message: 'خدمة' });
    const mapped = toNetworkError(original, 503);
    expect(mapped.kind).toBe('server');
    expect(mapped.status).toBe(503);
    expect(mapped.message).toContain('غير متاحة');
  });

  it('يحوّل حالة HTTP إلى خطأ مصنّف', () => {
    const mapped = toNetworkError(new Error('boom'), 401);
    expect(mapped.kind).toBe('permission');
    expect(mapped.status).toBe(401);
    expect(mapped.message).toContain('سجّل الدخول');
  });

  it(' TimeoutError و AbortError يتعرف عليهما', () => {
    const timeout = new Error('timed out');
    timeout.name = 'TimeoutError';
    expect(toNetworkError(timeout).kind).toBe('timeout');

    const abort = new Error('aborted');
    abort.name = 'AbortError';
    expect(toNetworkError(abort).kind).toBe('aborted');
  });

  it('يبقي رسالة الخادم العربية عند غياب الحالة', () => {
    const mapped = toNetworkError(new Error('المحادثة غير متاحة'));
    expect(mapped.kind).toBe('unknown');
    expect(mapped.message).toBe('المحادثة غير متاحة');
  });

  it('القيم غير الخطأ تتحول إلى مجهول', () => {
    expect(toNetworkError('نص بدل خطأ').kind).toBe('unknown');
    expect(toNetworkError(null).kind).toBe('unknown');
  });
});

describe('runWithTimeout', () => {
  it('تعيد نتيجة المهمة السريعة', async () => {
    await expect(runWithTimeout(1000, async () => 'ok')).resolves.toBe('ok');
  });

  it('تنهي المهمة البطيئة بخطأ مهلة', async () => {
    await expect(
      runWithTimeout(10, () => new Promise(() => undefined)),
    ).rejects.toMatchObject({ kind: 'timeout', status: null });
  });

  it('تمرر إشارة إلغاء للمهمة', async () => {
    let seen: AbortSignal | null = null;
    await runWithTimeout(1000, async (signal) => {
      seen = signal;
      return true;
    });
    expect(seen).not.toBeNull();
    expect((seen as unknown as AbortSignal).aborted).toBe(false);
  });

  it('ترفض مهلة غير صالحة', async () => {
    await expect(runWithTimeout(0, async () => true)).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('المهلة الافتراضية ٢٠ ثانية', () => {
    expect(DEFAULT_REQUEST_TIMEOUT_MS).toBe(20_000);
  });
});
