/**
 * Wattar — عرض الجلسات والأجهزة (M1.5).
 *
 * كل الدوال هنا نقية: تستقبل الصف الخام من الخادم وتعيد نصاً عربياً جاهزاً للشاشة،
 * حتى يُختبر العرض والتنسيق مباشرة بلا شبكة.
 */

export interface SessionDevice {
  id: string;
  device_id: string | null;
  device_info: { platform?: string; os_version?: string } | null;
  user_agent: string | null;
  ip_address: string | null;
  is_active: boolean;
  created_at: string;
  last_used_at: string | null;
}

const PLATFORM_LABELS: Record<string, string> = {
  android: 'أندرويد',
  ios: 'آيفون',
  ipados: 'آيباد',
  web: 'متصفح',
  windows: 'ويندوز',
  macos: 'ماك',
};

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** يحوّل صفّ JSON خام إلى جلسة، أو null если الصف غير صالح. */
export function toSessionDevice(row: unknown): SessionDevice | null {
  if (typeof row !== 'object' || row === null) return null;
  const record = row as Record<string, unknown>;
  const id = asString(record.id);
  if (!id) return null;

  const info = typeof record.device_info === 'object' && record.device_info !== null
    ? (record.device_info as { platform?: unknown; os_version?: unknown })
    : null;

  return {
    id,
    device_id: asString(record.device_id),
    device_info: info && typeof info.platform === 'string'
      ? { platform: info.platform, os_version: typeof info.os_version === 'string' ? info.os_version : undefined }
      : null,
    user_agent: asString(record.user_agent),
    ip_address: asString(record.ip_address),
    is_active: record.is_active === true,
    created_at: asString(record.created_at) ?? '',
    last_used_at: asString(record.last_used_at),
  };
}

/** يحوّل الرد الكلي إلى قائمة جلسات مرتّبة، ويتخلّى عن الصفوف التالفة. */
export function toSessionDevices(raw: unknown): SessionDevice[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(toSessionDevice)
    .filter((item): item is SessionDevice => item !== null)
    .sort((a, b) => (b.last_used_at ?? '').localeCompare(a.last_used_at ?? ''));
}

/** هل هذه الجلسة تخص الجهاز الحالي؟ */
export function isThisDevice(session: SessionDevice, deviceId: string | null): boolean {
  return deviceId !== null && session.device_id === deviceId;
}

/** اسم المنصة بالعربية، مع قيمة احتياطية للأجهزة غير المعروفة. */
export function getPlatformLabel(session: SessionDevice): string {
  const platform = session.device_info?.platform;
  if (!platform) return 'جهاز غير معروف';
  return PLATFORM_LABELS[platform] ?? platform;
}

/** سطر وصف الجهاز يظهر تحت اسمه. */
export function getDeviceSubtitle(session: SessionDevice): string {
  const osVersion = session.device_info?.os_version;
  const platform = getPlatformLabel(session);
  const version = osVersion ? ` · الإصدار ${osVersion}` : '';
  const ip = session.ip_address ? ` · ${session.ip_address}` : '';
  return `${platform}${version}${ip}`;
}

function unit(value: number, one: string, two: string, few: string, many: string): string {
  if (value === 1) return one;
  if (value === 2) return two;
  if (value >= 3 && value <= 10) return `${value} ${few}`;
  return `${value} ${many}`;
}

/**
 * وقت آخر استخدام بصيغة عربية نسبية.
 * `nowMs` معامل حتى يُختبر الزمن بلا ساعة حقيقية.
 */
export function formatLastUsed(iso: string | null, nowMs: number = Date.now()): string {
  if (!iso) return 'غير مسجّل';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 'غير مسجّل';

  const diff = Math.max(0, nowMs - then);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'الآن';
  if (minutes < 60) return `قبل ${unit(minutes, 'دقيقة', 'دقيقتين', 'دقائق', 'دقيقة')}`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `قبل ${unit(hours, 'ساعة', 'ساعتين', 'ساعات', 'ساعة')}`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `قبل ${unit(days, 'يوم', 'يومين', 'أيام', 'يومًا')}`;

  const months = Math.floor(days / 30);
  return `قبل ${unit(months, 'شهر', 'شهرين', 'أشهر', 'شهرًا')}`;
}
