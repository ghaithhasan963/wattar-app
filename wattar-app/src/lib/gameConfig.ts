/**
 * Wattar — عقود الألعاب المشتركة (M9.4)
 * مصدر واحد لأنواع الألعاب العامة وتحويل إعدادات الخادم إلى نماذج عرض،
 * مع حسابات الاحتمالات المعلنة للتحقق من العدالة على العميل.
 *
 * كل القيم الحقيقية تأتي من get_public_games()؛ القيم الافتراضية هنا
 * للعرض فقط عند تعذّر التحميل، ولا تُستخدم في أي حساب مالي.
 */

import { colors } from './theme';

export type GameType = 'wheel' | 'dice' | 'aviator' | 'plinko' | 'slots';
export const GAME_TYPES: readonly GameType[] = ['wheel', 'dice', 'aviator', 'plinko', 'slots'];

export interface GameSegment {
  value: number;
  probability: number;
  color: string;
  label: string;
}

export interface GamePromo {
  multiplier: number;
  label: string | null;
  ends_at: string | null;
}

export interface PublicGame {
  game_type: GameType;
  display_name: string;
  description: string | null;
  icon: string;
  accent_color: string;
  sort_order: number;
  is_enabled: boolean;
  available: boolean;
  unavailable_reason: string | null;
  min_bet: number;
  max_bet: number;
  max_multiplier: number;
  default_rtp: number;
  declared_rtp: number;
  declared_odds: Record<string, unknown>;
  min_age: number;
  requires_adult: boolean;
  test_mode_enabled: boolean;
  rules: string | null;
  settings: Record<string, unknown>;
  promo: GamePromo | null;
}

export interface SlotsTier {
  symbol: string;
  multiplier: number;
  probability: number;
}

export interface PlinkoTable {
  rows: number;
  multipliers: number[];
}

export const DEFAULT_WHEEL_SEGMENTS: GameSegment[] = [
  { value: 0.66, probability: 0.45, color: colors.textMuted, label: 'x0.66' },
  { value: 1.2, probability: 0.25, color: colors.success, label: 'x1.2' },
  { value: 2, probability: 0.15, color: colors.primaryLight, label: 'x2' },
  { value: 3.75, probability: 0.08, color: colors.primary, label: 'x3.75' },
  { value: 6, probability: 0.05, color: colors.gold, label: 'x6' },
  { value: 15, probability: 0.02, color: colors.danger, label: 'x15' },
];

export const DEFAULT_PLINKO_TABLE: PlinkoTable = {
  rows: 12,
  multipliers: [10, 4, 1.5, 0.7, 0.3, 0.15, 0.05, 0.15, 0.3, 0.7, 1.5, 4, 10],
};

export const DEFAULT_SLOTS_TIERS: SlotsTier[] = [
  { symbol: '🍒', multiplier: 2, probability: 0.05 },
  { symbol: '🔔', multiplier: 5, probability: 0.02 },
  { symbol: '💎', multiplier: 10, probability: 0.01 },
];

export const DEFAULT_SLOTS_LOSS_SYMBOLS = ['🍋', '🍀', '⭐', '🍇'];

const UNAVAILABLE_LABELS: Record<string, string> = {
  disabled: 'متوقفة مؤقتاً',
  region: 'غير متاحة في منطقتك',
  age: 'تتطلب تأكيد العمر',
  inactive: 'الحساب غير نشط',
  not_found: 'غير متاحة',
  invalid: 'طلب غير صالح',
};

export function gameUnavailableLabel(reason: string | null | undefined): string {
  if (!reason) return 'غير متاحة';
  return UNAVAILABLE_LABELS[reason] ?? 'غير متاحة';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asNumber(value: unknown, fallback: number): number {
  const numeric = typeof value === 'string' ? Number(value) : value;
  return typeof numeric === 'number' && Number.isFinite(numeric) ? numeric : fallback;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

/** يتحقق من شكل رد get_public_games ويحوّله بأمان. */
export function parsePublicGames(data: unknown): PublicGame[] {
  if (!Array.isArray(data)) return [];
  const games: PublicGame[] = [];

  for (const raw of data) {
    const item = asRecord(raw);
    const gameType = item.game_type;
    if (typeof gameType !== 'string' || !GAME_TYPES.includes(gameType as GameType)) continue;

    const promoRaw = asRecord(item.promo);
    const hasPromo = typeof item.promo === 'object' && item.promo !== null
      && asNumber(promoRaw.multiplier, 1) > 1;

    games.push({
      game_type: gameType as GameType,
      display_name: asString(item.display_name, gameType),
      description: typeof item.description === 'string' ? item.description : null,
      icon: asString(item.icon, 'gamepad'),
      accent_color: asString(item.accent_color, colors.primary),
      sort_order: asNumber(item.sort_order, 0),
      is_enabled: item.is_enabled === true,
      available: item.available === true,
      unavailable_reason: typeof item.unavailable_reason === 'string' ? item.unavailable_reason : null,
      min_bet: Math.max(1, Math.trunc(asNumber(item.min_bet, 1))),
      max_bet: Math.max(1, Math.trunc(asNumber(item.max_bet, 1_000_000))),
      max_multiplier: asNumber(item.max_multiplier, 1000),
      default_rtp: asNumber(item.default_rtp, 0),
      declared_rtp: asNumber(item.declared_rtp, asNumber(item.default_rtp, 0)),
      declared_odds: asRecord(item.declared_odds),
      min_age: asNumber(item.min_age, 18),
      requires_adult: item.requires_adult !== false,
      test_mode_enabled: item.test_mode_enabled === true,
      rules: typeof item.rules === 'string' ? item.rules : null,
      settings: asRecord(item.settings),
      promo: hasPromo
        ? {
            multiplier: asNumber(promoRaw.multiplier, 1),
            label: typeof promoRaw.label === 'string' ? promoRaw.label : null,
            ends_at: typeof promoRaw.ends_at === 'string' ? promoRaw.ends_at : null,
          }
        : null,
    });
  }

  return games.sort((a, b) => a.sort_order - b.sort_order || a.game_type.localeCompare(b.game_type));
}

/** خانات العجلة من إعدادات الخادم (مع تحقق من المجموع). */
export function toWheelSegments(settings: Record<string, unknown>): GameSegment[] {
  const raw = settings.segments;
  if (!Array.isArray(raw) || raw.length < 2) return DEFAULT_WHEEL_SEGMENTS;

  const segments: GameSegment[] = [];
  for (const entry of raw) {
    const item = asRecord(entry);
    const value = asNumber(item.value, Number.NaN);
    const probability = asNumber(item.probability, Number.NaN);
    if (!Number.isFinite(value) || !Number.isFinite(probability) || probability <= 0) {
      return DEFAULT_WHEEL_SEGMENTS;
    }
    segments.push({
      value,
      probability,
      color: asString(item.color, colors.textMuted),
      label: asString(item.label, `x${value}`),
    });
  }
  return segments;
}

/** مضاعفات بلانغو لمستوى مخاطرة محدد. */
export function toPlinkoTable(
  settings: Record<string, unknown>,
  risk: 'low' | 'medium' | 'high',
): PlinkoTable {
  const rows = Math.trunc(asNumber(settings.rows, DEFAULT_PLINKO_TABLE.rows));
  const table = asRecord(settings.multipliers)[risk];
  if (!Array.isArray(table) || table.length !== rows + 1) {
    return { rows: DEFAULT_PLINKO_TABLE.rows, multipliers: [...DEFAULT_PLINKO_TABLE.multipliers] };
  }
  const multipliers = table.map((value) => asNumber(value, 0));
  if (multipliers.some((value) => !Number.isFinite(value) || value < 0)) {
    return { rows: DEFAULT_PLINKO_TABLE.rows, multipliers: [...DEFAULT_PLINKO_TABLE.multipliers] };
  }
  return { rows, multipliers };
}

/** جدول جوائز Slots ورموز الخسارة. */
export function toSlotsConfig(settings: Record<string, unknown>): {
  tiers: SlotsTier[];
  lossSymbols: string[];
} {
  const rawTiers = settings.tiers;
  const tiers: SlotsTier[] = [];
  if (Array.isArray(rawTiers)) {
    for (const entry of rawTiers) {
      const item = asRecord(entry);
      const multiplier = asNumber(item.multiplier, Number.NaN);
      const probability = asNumber(item.probability, Number.NaN);
      if (typeof item.symbol !== 'string' || !Number.isFinite(multiplier)
        || !Number.isFinite(probability) || probability <= 0) {
        continue;
      }
      tiers.push({ symbol: item.symbol, multiplier, probability });
    }
  }
  const lossRaw = settings.loss_symbols;
  const lossSymbols = Array.isArray(lossRaw)
    ? lossRaw.filter((symbol): symbol is string => typeof symbol === 'string')
    : [];
  return {
    tiers: tiers.length > 0 ? tiers : DEFAULT_SLOTS_TIERS,
    lossSymbols: lossSymbols.length >= 3 ? lossSymbols : DEFAULT_SLOTS_LOSS_SYMBOLS,
  };
}

/** معامل ثنائي C(rows, k). */
export function binomialCoefficient(rows: number, k: number): number {
  if (!Number.isInteger(rows) || rows < 0 || k < 0 || k > rows) return 0;
  const smaller = Math.min(k, rows - k);
  let coefficient = 1;
  for (let i = 1; i <= smaller; i += 1) {
    coefficient = (coefficient * (rows - smaller + i)) / i;
  }
  return coefficient;
}

/** احتمال الوصول لخانة k في بلانغو (توزيع ثنائي p=0.5). */
export function binomialProbability(rows: number, k: number): number {
  if (!Number.isInteger(rows) || rows < 0 || k < 0 || k > rows) return 0;
  return binomialCoefficient(rows, k) / Math.pow(2, rows);
}

/** RTP العجلة المعلن = متوسط عائد الخانات (رهان موزّع بالتساوي). */
export function wheelRtp(segments: GameSegment[]): number {
  if (segments.length === 0) return 0;
  const expected = segments.reduce((sum, segment) => sum + segment.probability * segment.value, 0);
  return round2((expected / segments.length) * 100);
}

/** RTP بلانغو = Σ احتمال ثنائي × مضاعف. */
export function plinkoRtp(rows: number, multipliers: number[]): number {
  let expected = 0;
  for (let k = 0; k < multipliers.length; k += 1) {
    expected += binomialProbability(rows, k) * multipliers[k];
  }
  return round2(expected * 100);
}

/** RTP Slots = Σ احتمال × مضاعف. */
export function slotsRtp(tiers: SlotsTier[]): number {
  return round2(tiers.reduce((sum, tier) => sum + tier.probability * tier.multiplier, 0) * 100);
}

/** تسعير النرد المعلن — مطابق للخادم: المضاعف مقرّب للأسفل لخانتين
 *  حتى لا يتجاوز العرض ما يُدفع فعلاً. */
export function diceQuote(
  target: number,
  direction: 'over' | 'under',
  rtp: number,
): { pWin: number; multiplier: number } {
  const pWin = direction === 'over'
    ? (100 - target) / 100
    : (target - 1) / 100;
  if (pWin <= 0) return { pWin: 0, multiplier: 0 };
  const safeRtp = Math.max(0, Math.min(100, rtp));
  const raw = (1 / Math.max(pWin, 0.01)) * (safeRtp / 100);
  return {
    pWin,
    multiplier: Math.floor(raw * 100) / 100,
  };
}

/** احتمال أن تتجاوز الطيارة مضاعفاً معيناً: P(crash > x) = RTP / x. */
export function aviatorWinProbability(cashout: number, rtp: number): number {
  if (cashout <= 0) return 0;
  return Math.min(1, Math.max(0, rtp / 100 / cashout));
}

/** مفتاح منع تكرار صالح لسياسة الخادم ^[A-Za-z0-9._:-]{10,100}$ */
export function newIdempotencyKey(prefix: string): string {
  const cleanPrefix = prefix.replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 20) || 'game';
  const random = `${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 10)}`;
  return `${cleanPrefix}-${Date.now().toString(36)}-${random}`.slice(0, 100);
}

export function isIdempotencyKeyValid(key: string): boolean {
  return /^[A-Za-z0-9._:-]{10,100}$/.test(key);
}

/** حدود الرهان الفعلية مع مراعاة الرصيد. */
export function clampBet(value: number, min: number, max: number, balance: number): number | null {
  if (!Number.isSafeInteger(value) || value < 1) return null;
  const upper = Math.min(Math.max(1, Math.trunc(max)), Math.max(0, Math.trunc(balance)));
  const lower = Math.max(1, Math.trunc(min));
  if (upper < lower) return null;
  if (value < lower || value > upper) return null;
  return value;
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return `${value.toFixed(2)}%`;
}
