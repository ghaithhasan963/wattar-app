import { describe, expect, it } from 'vitest';
import {
  MESSAGING_SETTINGS_RANGE_ERROR,
  validateMessagingSettings,
  type MessagingSettings,
} from './messagingSettings';

/** القيم الافتراضية المعتمدة من المدير: 5 مجانية · 50 Coin · 60% · افتتاحيتان. */
const defaults: MessagingSettings = {
  free_message_limit: 5,
  price_coin: 50,
  host_commission_percent: 60,
  host_intro_daily_limit: 2,
  host_outreach_enabled: true,
};

const withSetting = (patch: Partial<MessagingSettings>): MessagingSettings => ({ ...defaults, ...patch });

describe('التحقق من إعدادات الرسائل', () => {
  it('القيم الافتراضية صالحة', () => {
    expect(validateMessagingSettings(defaults)).toBeNull();
  });

  it('يقبل الحدود الدنيا والعليا المسموحة', () => {
    expect(validateMessagingSettings(withSetting({ free_message_limit: 0 }))).toBeNull();
    expect(validateMessagingSettings(withSetting({ free_message_limit: 100 }))).toBeNull();
    expect(validateMessagingSettings(withSetting({ price_coin: 1 }))).toBeNull();
    expect(validateMessagingSettings(withSetting({ price_coin: 1_000_000 }))).toBeNull();
    expect(validateMessagingSettings(withSetting({ host_commission_percent: 0 }))).toBeNull();
    expect(validateMessagingSettings(withSetting({ host_commission_percent: 100 }))).toBeNull();
    expect(validateMessagingSettings(withSetting({ host_intro_daily_limit: 0 }))).toBeNull();
    expect(validateMessagingSettings(withSetting({ host_intro_daily_limit: 10 }))).toBeNull();
  });

  it('يرفض ما هو خارج حدود قاعدة البيانات', () => {
    expect(validateMessagingSettings(withSetting({ free_message_limit: -1 }))).toBe(MESSAGING_SETTINGS_RANGE_ERROR);
    expect(validateMessagingSettings(withSetting({ free_message_limit: 101 }))).toBe(MESSAGING_SETTINGS_RANGE_ERROR);
    expect(validateMessagingSettings(withSetting({ price_coin: 0 }))).toBe(MESSAGING_SETTINGS_RANGE_ERROR);
    expect(validateMessagingSettings(withSetting({ price_coin: 1_000_001 }))).toBe(MESSAGING_SETTINGS_RANGE_ERROR);
    expect(validateMessagingSettings(withSetting({ host_commission_percent: -1 }))).toBe(MESSAGING_SETTINGS_RANGE_ERROR);
    expect(validateMessagingSettings(withSetting({ host_commission_percent: 101 }))).toBe(MESSAGING_SETTINGS_RANGE_ERROR);
    expect(validateMessagingSettings(withSetting({ host_intro_daily_limit: -1 }))).toBe(MESSAGING_SETTINGS_RANGE_ERROR);
    expect(validateMessagingSettings(withSetting({ host_intro_daily_limit: 11 }))).toBe(MESSAGING_SETTINGS_RANGE_ERROR);
  });

  it('يرفض الأرقام غير الصحيحة (كسرية أو غير رقمية)', () => {
    expect(validateMessagingSettings(withSetting({ price_coin: 49.5 }))).toBe(MESSAGING_SETTINGS_RANGE_ERROR);
    expect(validateMessagingSettings(withSetting({ free_message_limit: Number.NaN }))).toBe(MESSAGING_SETTINGS_RANGE_ERROR);
    expect(validateMessagingSettings(withSetting({ price_coin: Number.POSITIVE_INFINITY }))).toBe(MESSAGING_SETTINGS_RANGE_ERROR);
  });

  it('حالة تفعيل التواصل مع المضيفات لا تؤثر على الصلاحية', () => {
    expect(validateMessagingSettings(withSetting({ host_outreach_enabled: false }))).toBeNull();
  });
});
