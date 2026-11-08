/**
 * Wattar — الدوال المساعدة المشتركة
 * @version 1.0.0
 */

import type { GameType, TxStatus, UserRole, UserStatus } from '../types';

// ============================================================================
// التنسيق
// ============================================================================
export function formatGold(amount: number): string {
  if (amount >= 1_000_000_000) {
    return `${(amount / 1_000_000_000).toFixed(2)}B`;
  }
  if (amount >= 1_000_000) {
    return `${(amount / 1_000_000).toFixed(2)}M`;
  }
  if (amount >= 1_000) {
    return `${(amount / 1_000).toFixed(1)}K`;
  }
  return amount.toString();
}

export function formatUSD(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(amount);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('ar-EG').format(value);
}

export function formatDate(date: string | Date, locale = 'ar-EG'): string {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date));
}

export function timeAgo(date: string | Date, locale = 'ar'): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  const intervals: Array<[number, string, string]> = [
    [31536000, 'سنة', 'سنوات'],
    [2592000, 'شهر', 'أشهر'],
    [86400, 'يوم', 'أيام'],
    [3600, 'ساعة', 'ساعات'],
    [60, 'دقيقة', 'دقائق'],
  ];
  for (const [secs, singular, plural] of intervals) {
    const count = Math.floor(seconds / secs);
    if (count >= 1) {
      return locale === 'ar' ? `منذ ${count} ${count <= 2 ? singular : plural}` : `${count} ${singular} ago`;
    }
  }
  return locale === 'ar' ? 'الآن' : 'just now';
}

// ============================================================================
// التحقق
// ============================================================================
export function isValidPhone(phone: string): boolean {
  // يدعم أرقام سوريا/السعودية/الإمارات/مصر...
  const phoneRegex = /^(\+?963|\+?966|\+?971|\+?20|\+?962|\+?961|\+?964|\+?965|\+?973|\+?974|\+?968|\+?970|\+?212|\+?213)?\d{8,12}$/;
  return phoneRegex.test(phone.replace(/[\s-]/g, ''));
}

export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function isValidUsername(username: string): boolean {
  return /^[a-zA-Z0-9_\u0600-\u06FF]{3,50}$/.test(username);
}

// ============================================================================
// كلمات الحالة
// ============================================================================
export function getTxStatusLabel(status: TxStatus): string {
  const labels: Record<TxStatus, string> = {
    pending: 'قيد الانتظار',
    reviewing: 'قيد المراجعة',
    approved: 'تمت الموافقة',
    completed: 'مكتمل',
    failed: 'فشل',
    cancelled: 'ملغى',
    rejected: 'مرفوض',
  };
  return labels[status] ?? status;
}

export function getTxStatusColor(status: TxStatus): string {
  const colors: Record<TxStatus, string> = {
    pending: '#F59E0B',
    reviewing: '#3B82F6',
    approved: '#10B981',
    completed: '#059669',
    failed: '#EF4444',
    cancelled: '#6B7280',
    rejected: '#DC2626',
  };
  return colors[status] ?? '#6B7280';
}

export function getUserRoleLabel(role: UserRole): string {
  const labels: Record<UserRole, string> = {
    guest: 'زائر',
    user: 'مستخدم',
    agent: 'وكيل',
    admin: 'أدمن',
    super_admin: 'أدمن عام',
  };
  return labels[role] ?? role;
}

export function getUserStatusLabel(status: UserStatus): string {
  const labels: Record<UserStatus, string> = {
    active: 'نشط',
    suspended: 'موقوف',
    banned: 'محظور',
    blacklisted: 'قائمة سوداء',
  };
  return labels[status] ?? status;
}

export function getGameLabel(gameType: GameType): string {
  const labels: Record<GameType, string> = {
    wheel: 'عجلة الحظ',
    dice: 'نرد',
    aviator: 'طيارة المضاعفات',
    plinko: 'بلانغو',
  };
  return labels[gameType] ?? gameType;
}

// ============================================================================
// التشفير والمساعدات الأمنية
// ============================================================================
export function generateIdempotencyKey(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 12)}`;
}

export function maskPhone(phone: string): string {
  if (phone.length < 4) return phone;
  return phone.slice(0, 3) + '****' + phone.slice(-3);
}

export function maskString(value: string, visibleStart = 4, visibleEnd = 4): string {
  if (value.length <= visibleStart + visibleEnd) return value;
  return value.slice(0, visibleStart) + '****' + value.slice(-visibleEnd);
}

// ============================================================================
// محرك RNG — للتحقق العميلي فقط (السيرفر يستخدم crypto)
// ============================================================================
export function simpleRandomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// محاكاة حركة عجلة (للعرض فقط — النتيجة تأتي من السيرفر)
export function getWheelRotation(winningSegment: number, totalSegments: number): number {
  const segmentAngle = 360 / totalSegments;
  const targetAngle = winningSegment * segmentAngle;
  const fullSpins = 5; // 5 دورات كاملة
  return 360 * fullSpins + (360 - targetAngle);
}
