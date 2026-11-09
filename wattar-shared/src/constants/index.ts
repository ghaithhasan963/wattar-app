/**
 * Wattar — الثوابت المشتركة
 * @version 1.0.0
 */

export const APP_CONFIG = {
  name: 'Wattar',
  version: '1.0.0',
  supportEmail: 'support@wattar.app',
  defaultLanguage: 'ar',
  timezone: 'Asia/Damascus',
} as const;

// عدد المقاعد المدعومة في الغرف
export const ROOM_SEAT_OPTIONS = [4, 8, 16] as const;

// عتبات التصنيف
export const LEADERBOARD_TOP_LIMIT = 100;

// حدود API
export const RATE_LIMITS = {
  // حدود لكل IP / مستخدم
  placeBet: { windowMs: 1000, max: 5 },         // 5 رهانات/ثانية
  createRoom: { windowMs: 60000, max: 5 },       // 5 غرف/دقيقة
  sendMessage: { windowMs: 1000, max: 3 },       // 3 رسائل/ثانية
  sendGift: { windowMs: 1000, max: 2 },          // 2 هدية/ثانية
  requestDeposit: { windowMs: 60000, max: 3 },   // 3 طلبات شحن/دقيقة
  requestWithdrawal: { windowMs: 60000, max: 1 },// 1 طلب سحب/دقيقة
  transfer: { windowMs: 60000, max: 5 },         // 5 تحويلات/دقيقة
} as const;

// مفاتيح التخزين المحلي
export const STORAGE_KEYS = {
  AUTH_TOKEN: 'wattar_auth_token',
  REFRESH_TOKEN: 'wattar_refresh_token',
  USER_DATA: 'wattar_user_data',
  LANGUAGE: 'wattar_language',
  THEME: 'wattar_theme',
  RECENT_ROOMS: 'wattar_recent_rooms',
  FCM_TOKEN: 'wattar_fcm_token',
} as const;

// قنوات Realtime
export const REALTIME_CHANNELS = {
  ROOM_PREFIX: 'room:',
  WALLET_PREFIX: 'wallet:',
  GAME_PREFIX: 'game:',
  GLOBAL: 'wattar_global',
} as const;

// أحداث Realtime
export const REALTIME_EVENTS = {
  ROOM_UPDATED: 'room_updated',
  ROOM_DELETED: 'room_deleted',
  SEAT_UPDATED: 'seat_updated',
  MESSAGE_SENT: 'message_sent',
  GIFT_SENT: 'gift_sent',
  USER_JOINED: 'user_joined',
  USER_LEFT: 'user_left',
  WALLET_UPDATED: 'wallet_updated',
  GAME_ROUND_STARTED: 'game_round_started',
  GAME_ROUND_ENDED: 'game_round_ened',
  GAME_BET_PLACED: 'game_bet_placed',
  GAME_RESULT: 'game_result',
  NOTIFICATION: 'notification',
} as const;

// أنواع الألعاب
export const GAME_TYPES = ['wheel', 'dice', 'aviator', 'plinko', 'slots'] as const;

// أسماء الألعاب بالعربية
export const GAME_NAMES_AR: Record<string, string> = {
  wheel: 'عجلة الحظ',
  dice: 'نرد',
  aviator: 'طيارة المضاعفات',
  plinko: 'بلانغو',
};

// ألوان الواجهة
export const THEME_COLORS = {
  primary: '#7C3AED',          // بنفسجي ملكي
  primaryDark: '#5B21B6',
  primaryLight: '#A78BFA',
  accent: '#F59E0B',           // ذهبي
  success: '#10B981',
  warning: '#F59E0B',
  error: '#EF4444',
  background: '#0F0F1A',        // خلفية داكنة
  surface: '#1A1A2E',
  surfaceLight: '#252540',
  textPrimary: '#F3F4F6',
  textSecondary: '#9CA3AF',
  border: '#2D2D44',
} as const;

// شبكات USDT المدعومة
export const USDT_NETWORKS = [
  { id: 'TRC20', label: 'TRC20 (Tron)', fee: 1 },
  { id: 'ERC20', label: 'ERC20 (Ethereum)', fee: 5 },
  { id: 'BEP20', label: 'BEP20 (BSC)', fee: 0.5 },
] as const;

// تصنيفات الغرف
export const ROOM_CATEGORIES = [
  { id: 'all', label_ar: 'الكل', icon: '🚪' },
  { id: 'chat', label_ar: 'دردشة', icon: '💬' },
  { id: 'music', label_ar: 'موسيقى', icon: '🎵' },
  { id: 'games', label_ar: 'ألعاب', icon: '🎮' },
  { id: 'serious', label_ar: 'جاد', icon: '🧠' },
  { id: 'sleep', label_ar: 'نوم', icon: '😴' },
  { id: 'private', label_ar: 'خاص', icon: '🔒' },
] as const;
