/**
 * Wattar — أنواع إعدادات الخصوصية (M1.6).
 * القيم مطابقة لقيود CHECK في قاعدة البيانات.
 */

export type PrivacyLevel = 'public' | 'friends' | 'none';

export const PRIVACY_LEVELS: PrivacyLevel[] = ['public', 'friends', 'none'];

export const PRIVACY_LABELS: Record<PrivacyLevel, string> = {
  public: 'الكل',
  friends: 'الأصدقاء فقط',
  none: 'لا أحد',
};

export const PRIVACY_DESCRIPTIONS: Record<PrivacyLevel, string> = {
  public: 'يمكن للجميع تنفيذ هذا الإجراء',
  friends: 'الأصدقاء المقبولون فقط',
  none: 'لا يستطيع أحد تنفيذ هذا الإجراء',
};

export interface PrivacySettings {
  can_follow: PrivacyLevel;
  can_message: PrivacyLevel;
  can_friend_request: PrivacyLevel;
  can_view_stories: PrivacyLevel;
  can_view_info: PrivacyLevel;
  can_enter_rooms: PrivacyLevel;
}

export const DEFAULT_PRIVACY_SETTINGS: PrivacySettings = {
  can_follow: 'public',
  can_message: 'public',
  can_friend_request: 'public',
  can_view_stories: 'public',
  can_view_info: 'public',
  can_enter_rooms: 'public',
};

export const PRIVACY_ACTIONS: Array<{ key: keyof PrivacySettings; label: string; description: string }> = [
  { key: 'can_follow', label: 'من يستطيع متابعتي', description: 'التحكم بمن يضيفك لقائمة المتابعين' },
  { key: 'can_message', label: 'من يستطيع مراسلتي', description: 'فتح محادثة خاصة معك' },
  { key: 'can_friend_request', label: 'من يستطيع إرسال طلب صداقة', description: 'استقبال طلبات الصداقة' },
  { key: 'can_view_stories', label: 'من يستطيع مشاهدة قصصي', description: 'رؤية القصص التي تنشرها' },
  { key: 'can_view_info', label: 'من يستطيع رؤية معلوماتي', description: 'الملف الشخصي، النبذة، الإحصائيات' },
  { key: 'can_enter_rooms', label: 'من يستطيع دخول غرفتي', description: 'الانضمام لغرفك الصوتية' },
];

/** يتحقق أن القيمة إحدى المستويات المعروفة، وإلا يعيد البديل. */
export function asPrivacyLevel(value: unknown, fallback: PrivacyLevel = 'public'): PrivacyLevel {
  return typeof value === 'string' && (PRIVACY_LEVELS as readonly string[]).includes(value)
    ? (value as PrivacyLevel)
    : fallback;
}

/** تحويل إعدادات قاعدة البيانات لكائن Typed، مع تجاهل أي قيمة غير معروفة. */
export function toPrivacySettings(raw: Record<string, unknown> | null): PrivacySettings {
  if (!raw) return DEFAULT_PRIVACY_SETTINGS;
  const get = (k: keyof PrivacySettings): PrivacyLevel =>
    asPrivacyLevel(raw[k], DEFAULT_PRIVACY_SETTINGS[k]);
  return {
    can_follow: get('can_follow'),
    can_message: get('can_message'),
    can_friend_request: get('can_friend_request'),
    can_view_stories: get('can_view_stories'),
    can_view_info: get('can_view_info'),
    can_enter_rooms: get('can_enter_rooms'),
  };
}