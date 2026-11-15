/**
 * Wattar — هوية الجهاز الثابتة (M1.5).
 *
 * الفكرة: كل تثبيت للتطبيق يحصل على معرّف واحد يُخزَّن محلياً، فيستطيع الخادم
 * تجميع الجلسات على أساس «هذا الجهاز» بدل إنشاء سجل جديد عند كل تسجيل دخول.
 *
 * المنطق هنا نقي (لا React ولا تخزين فعلي) حتى يُختبر مباشرة.
 */

export const DEVICE_ID_KEY = 'wattar-device-id';

/** واجهة تخزين بسيطة: تكفي AsyncStorage وأي مخزن آخر. */
export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/** مولّد معرّف افتراضي: بصيغة قصيرة مستقرة الطول. */
export function defaultGenerateDeviceId(
  now: number = Date.now(),
  random: () => number = Math.random,
): string {
  const stamp = Math.floor(now / 1000).toString(36);
  const noise = Math.floor(random() * 0xffff_ffff).toString(36);
  return `dev-${stamp}-${noise}`;
}

export interface DeviceIdentity {
  /** المعرّف الحالي، أو null قبل أول قراءة. */
  readonly snapshot: string | null;
  /** يجلب المعرّف أو يولّده ويخزّنه. */
  getId: () => Promise<string>;
}

/**
 * ينشئ هوية جهاز فوق أي مخزن مفتاح/قيمة.
 * تمرّ التخزين ومولّد المعرّف كمعاملات لتبقى الدالة قابلة للاختبار.
 */
export function createDeviceIdentity(
  storage: KeyValueStorage,
  generateId: () => string = defaultGenerateDeviceId,
  key: string = DEVICE_ID_KEY,
): DeviceIdentity {
  let cached: string | null = null;

  return {
    get snapshot() {
      return cached;
    },
    getId: async () => {
      if (cached) return cached;
      const stored = await storage.getItem(key);
      if (stored) {
        cached = stored;
        return stored;
      }
      const created = generateId();
      await storage.setItem(key, created);
      cached = created;
      return created;
    },
  };
}
