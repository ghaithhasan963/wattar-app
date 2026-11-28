/**
 * تصنيف الهدايا حسب القيمة — يحدد شدة المشهد السينمائي وتأثيراته.
 * كل الهدايا تشترك بنفس السلوك: مشهد ~5s، ثم انكماش/تحرك نحو المستلم، ثم ظهور بالشات.
 * الاختلاف يكون في شكل المشهد، كثافة الجسيمات، الألوان، وحجم الأثر.
 */

export type GiftTier = 'common' | 'special' | 'rare' | 'epic' | 'legendary';

export interface GiftTierConfig {
  tier: GiftTier;
  label: string;
  /** الحد الأدنى للسعر (coins) */
  minPrice: number;
  /** الحد الأعلى للسعر (coins)، Infinity للأعلى */
  maxPrice: number;
  /** مدة المشهد بالمللي ثانية */
  durationMs: number;
  /** ألوان المشهد الأساسية */
  colors: [string, string, string];
  /** كثافة الجسيمات */
  particleCount: number;
  /** حجم التأثير 0..1 */
  intensity: number;
}

export const GIFT_TIER_CONFIGS: GiftTierConfig[] = [
  {
    tier: 'common',
    label: 'عادي',
    minPrice: 0,
    maxPrice: 499,
    durationMs: 5000,
    colors: ['#C9B8E0', '#A78BFA', '#7C3AED'],
    particleCount: 10,
    intensity: 0.35,
  },
  {
    tier: 'special',
    label: 'مميز',
    minPrice: 500,
    maxPrice: 1999,
    durationMs: 5000,
    colors: ['#67E8F9', '#22D3EE', '#06B6D4'],
    particleCount: 16,
    intensity: 0.5,
  },
  {
    tier: 'rare',
    label: 'نادر',
    minPrice: 2000,
    maxPrice: 4999,
    durationMs: 5000,
    colors: ['#F9A8D4', '#EC4899', '#A855F7'],
    particleCount: 22,
    intensity: 0.68,
  },
  {
    tier: 'epic',
    label: 'ملحمي',
    minPrice: 5000,
    maxPrice: 9999,
    durationMs: 5000,
    colors: ['#FDE68A', '#F59E0B', '#F97316'],
    particleCount: 28,
    intensity: 0.85,
  },
  {
    tier: 'legendary',
    label: 'أسطوري',
    minPrice: 10000,
    maxPrice: Infinity,
    durationMs: 5000,
    colors: ['#FDE68A', '#F4BD55', '#FFF1C1'],
    particleCount: 34,
    intensity: 1,
  },
];

export function getGiftTier(priceGold: number, isPremium = false): GiftTierConfig {
  const price = Math.max(0, Number(priceGold) || 0);
  // is_premium يرفع الهدية إلى ملحمي على الأقل إذا كان سعرها منخفضًا (توافق خلفي)
  const effective = isPremium && price < 5000 ? 5000 : price;
  for (let i = GIFT_TIER_CONFIGS.length - 1; i >= 0; i -= 1) {
    const cfg = GIFT_TIER_CONFIGS[i];
    if (effective >= cfg.minPrice) return cfg;
  }
  return GIFT_TIER_CONFIGS[0];
}

export function isCinematicGift(priceGold: number, isPremium = false): boolean {
  // كل الهدايا لها مشهد سينمائي موحّد السلوك؛ نُبقي الدالة للتوافق ونُرجع true.
  void priceGold;
  void isPremium;
  return true;
}
