import { describe, expect, it } from 'vitest';
import {
  createDeviceIdentity,
  defaultGenerateDeviceId,
  DEVICE_ID_KEY,
} from './deviceId';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: async (key: string) => data.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

describe('هوية الجهاز', () => {
  it('يعيد المعرّف المخزّن دون توليد واحد جديد', async () => {
    const storage = memoryStorage({ [DEVICE_ID_KEY]: 'dev-stored' });
    const identity = createDeviceIdentity(storage);
    await expect(identity.getId()).resolves.toBe('dev-stored');
    expect(storage.data.size).toBe(1);
  });

  it('يولّد معرّفاً ويخزّنه عند أول تشغيل', async () => {
    const storage = memoryStorage();
    const identity = createDeviceIdentity(storage, () => 'dev-new');
    await expect(identity.getId()).resolves.toBe('dev-new');
    expect(storage.data.get(DEVICE_ID_KEY)).toBe('dev-new');
  });

  it('يخزّن النتيجة في الذاكرة فلا يعيد القراءة من المخزن', async () => {
    const storage = memoryStorage();
    const identity = createDeviceIdentity(storage, () => 'dev-cached');
    await identity.getId();
    storage.data.delete(DEVICE_ID_KEY);
    await expect(identity.getId()).resolves.toBe('dev-cached');
    expect(identity.snapshot).toBe('dev-cached');
  });

  it('معرّف مولّد افتراضي يبدأ بـdev- ويحتوي طابعاً زمنياً وعشوائية', () => {
    const a = defaultGenerateDeviceId(1_700_000_000_000, () => 0.5);
    const b = defaultGenerateDeviceId(1_700_000_000_000, () => 0.9);
    expect(a.startsWith('dev-')).toBe(true);
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(8);
  });
});
