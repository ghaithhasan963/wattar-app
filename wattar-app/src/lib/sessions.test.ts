import { describe, expect, it } from 'vitest';
import {
  formatLastUsed,
  getDeviceSubtitle,
  getPlatformLabel,
  isThisDevice,
  toSessionDevice,
  toSessionDevices,
} from './sessions';

const base = {
  id: '11111111-1111-1111-1111-111111111111',
  device_id: 'dev-abc',
  device_info: { platform: 'android', os_version: '34' },
  user_agent: 'Wattar/android 34',
  ip_address: '203.0.113.7',
  is_active: true,
  created_at: '2026-11-01T10:00:00Z',
  last_used_at: '2026-11-14T10:00:00Z',
};

describe('تحويل صفوف الجلسات', () => {
  it('يحوّل صفّاً صالحاً', () => {
    const session = toSessionDevice(base);
    expect(session).not.toBeNull();
    expect(session?.device_id).toBe('dev-abc');
    expect(session?.is_active).toBe(true);
  });

  it('يرفض الصفوف الناقصة المعرّف', () => {
    expect(toSessionDevice({ ...base, id: '' })).toBeNull();
    expect(toSessionDevice(null)).toBeNull();
    expect(toSessionDevice('نص')).toBeNull();
  });

  it('يتعامل مع حقول ناقصة دون انهيار', () => {
    const session = toSessionDevice({ id: 'x', device_info: null });
    expect(session?.device_info).toBeNull();
    expect(session?.is_active).toBe(false);
    expect(session?.last_used_at).toBeNull();
  });
});

describe('قائمة الجلسات', () => {
  it('ترتّب تنازلياً حسب آخر استخدام', () => {
    const list = toSessionDevices([
      { ...base, id: 'old', last_used_at: '2026-11-01T10:00:00Z' },
      { ...base, id: 'new', last_used_at: '2026-11-14T10:00:00Z' },
      { ...base, id: 'mid', last_used_at: '2026-11-10T10:00:00Z' },
    ]);
    expect(list.map((item) => item.id)).toEqual(['new', 'mid', 'old']);
  });

  it('تتخّى عن الصفوف التالفة وتقبل اللامصفوف', () => {
    expect(toSessionDevices({})).toEqual([]);
    expect(toSessionDevices(undefined)).toEqual([]);
    const list = toSessionDevices([base, { id: '' }, null]);
    expect(list).toHaveLength(1);
  });
});

describe('التعرف على هذا الجهاز', () => {
  it('يطابق Known device_id فقط', () => {
    expect(isThisDevice(toSessionDevice(base)!, 'dev-abc')).toBe(true);
    expect(isThisDevice(toSessionDevice(base)!, 'dev-other')).toBe(false);
    expect(isThisDevice(toSessionDevice(base)!, null)).toBe(false);
  });
});

describe('أسماء الأجهزة', () => {
  it('يعرض المنصة بالعربية مع الإصدار والـIP', () => {
    const session = toSessionDevice(base)!;
    expect(getPlatformLabel(session)).toBe('أندرويد');
    expect(getDeviceSubtitle(session)).toContain('أندرويد');
    expect(getDeviceSubtitle(session)).toContain('34');
    expect(getDeviceSubtitle(session)).toContain('203.0.113.7');
  });

  it('قيمة احتياطية للمنصة غير المعروفة', () => {
    const session = toSessionDevice({ ...base, device_info: { platform: 'harmony' } })!;
    expect(getPlatformLabel(session)).toBe('harmony');
    const missing = toSessionDevice({ ...base, device_info: null })!;
    expect(getPlatformLabel(missing)).toBe('جهاز غير معروف');
  });
});

describe('تنسيق آخر استخدام', () => {
  const now = Date.parse('2026-11-14T12:00:00Z');

  it('الآن ودقيقة ودقيقتين وجمع دقائق', () => {
    expect(formatLastUsed(new Date(now - 30_000).toISOString(), now)).toBe('الآن');
    expect(formatLastUsed(new Date(now - 60_000).toISOString(), now)).toBe('قبل دقيقة');
    expect(formatLastUsed(new Date(now - 120_000).toISOString(), now)).toBe('قبل دقيقتين');
    expect(formatLastUsed(new Date(now - 5 * 60_000).toISOString(), now)).toBe('قبل 5 دقائق');
    expect(formatLastUsed(new Date(now - 45 * 60_000).toISOString(), now)).toBe('قبل 45 دقيقة');
  });

  it('ساعات وأيام وأشهر', () => {
    expect(formatLastUsed(new Date(now - 2 * 3_600_000).toISOString(), now)).toBe('قبل ساعتين');
    expect(formatLastUsed(new Date(now - 3 * 86_400_000).toISOString(), now)).toBe('قبل 3 أيام');
    expect(formatLastUsed(new Date(now - 40 * 86_400_000).toISOString(), now)).toBe('قبل شهر');
  });

  it('يتعامل مع غياب التاريخ أو فساده', () => {
    expect(formatLastUsed(null, now)).toBe('غير مسجّل');
    expect(formatLastUsed('ليس تاريخًا', now)).toBe('غير مسجّل');
  });
});
