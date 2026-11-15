/**
 * إعدادات الرسائل الخاصة في لوحة الإدارة.
 *
 * الحدود هنا مطابقة حرفياً لقيود جدول `private_message_settings` في قاعدة البيانات،
 * حتى لا يرسل الأدمن قيمة يرفضها الخادم بعد ضغطة «حفظ».
 */

export interface MessagingSettings {
  free_message_limit: number;
  price_coin: number;
  host_commission_percent: number;
  host_intro_daily_limit: number;
  host_outreach_enabled: boolean;
}

export const MESSAGING_SETTINGS_LIMITS = {
  freeMessageLimit: { min: 0, max: 100 },
  priceCoin: { min: 1, max: 1_000_000 },
  hostCommissionPercent: { min: 0, max: 100 },
  hostIntroDailyLimit: { min: 0, max: 10 },
} as const;

export const MESSAGING_SETTINGS_RANGE_ERROR = 'تحقق من حدود السعر والرسائل المجانية ونسبة المضيفة.';

/** يعيد رسالة الخطأ، أو `null` إذا كانت الإعدادات صالحة للحفظ. */
export function validateMessagingSettings(settings: MessagingSettings): string | null {
  const values = [
    settings.free_message_limit,
    settings.price_coin,
    settings.host_commission_percent,
    settings.host_intro_daily_limit,
  ];
  const invalidNumber = values.some((value) => !Number.isSafeInteger(value));
  const outOfRange =
    settings.free_message_limit < MESSAGING_SETTINGS_LIMITS.freeMessageLimit.min ||
    settings.free_message_limit > MESSAGING_SETTINGS_LIMITS.freeMessageLimit.max ||
    settings.price_coin < MESSAGING_SETTINGS_LIMITS.priceCoin.min ||
    settings.price_coin > MESSAGING_SETTINGS_LIMITS.priceCoin.max ||
    settings.host_commission_percent < MESSAGING_SETTINGS_LIMITS.hostCommissionPercent.min ||
    settings.host_commission_percent > MESSAGING_SETTINGS_LIMITS.hostCommissionPercent.max ||
    settings.host_intro_daily_limit < MESSAGING_SETTINGS_LIMITS.hostIntroDailyLimit.min ||
    settings.host_intro_daily_limit > MESSAGING_SETTINGS_LIMITS.hostIntroDailyLimit.max;

  return invalidNumber || outOfRange ? MESSAGING_SETTINGS_RANGE_ERROR : null;
}
