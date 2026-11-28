/**
 * Wattar — نظام التصميم (M10.1)
 * مصدر واحد للألوان والتدرجات والمسافات والحواف والخط والحركة.
 *
 * `colors` تبقى بأسمائها القديمة حفاظاً على الشاشات القائمة (لا كسر)،
 * والجديد يُستهلك من `gradients` و`radius` و`space` و`typeScale` و`motion`.
 * أي لون محلي داخل شاشة يجب أن يُستبدل بأحد هذه الرموز.
 */

export const colors = {
  background: '#0A0712',
  surface: '#171124',
  surfaceMuted: '#211832',
  text: '#F8F4FF',
  textSecondary: '#B3A9C3',
  border: '#34264A',
  primary: '#A947F5',
  primaryPressed: '#8731D2',
  primarySoft: '#2B1740',
  teal: '#58D6C1',
  tealSoft: '#153832',
  success: '#46D49A',
  successSoft: '#15372C',
  danger: '#FF718E',
  dangerSoft: '#3B1A2A',
  gold: '#F4BD55',
  goldSoft: '#3B2A13',
  roomBackground: '#090611',
  roomSurface: '#171124',
  roomElevated: '#241935',
  roomText: '#FBF7FF',
  roomMuted: '#B5A9C5',
  roomPrimary: '#C064FF',
  roomTeal: '#58D6C1',

  /* — إضافات M10.1 — */
  screenTop: '#150C24',
  surfaceElevated: '#1F1731',
  surfaceGlass: 'rgba(255, 255, 255, 0.04)',
  borderSoft: '#261C38',
  borderStrong: '#3E2C58',
  textMuted: '#7D6E93',
  primaryGlow: 'rgba(169, 71, 245, 0.38)',
  tealGlow: 'rgba(88, 214, 193, 0.32)',
  goldGlow: 'rgba(244, 189, 85, 0.34)',
  dangerGlow: 'rgba(255, 113, 142, 0.32)',
  tealDeep: '#1FA98F',
  goldDeep: '#C98A2B',
  overlay: 'rgba(6, 4, 10, 0.72)',
  overlayStrong: 'rgba(4, 3, 8, 0.88)',

  /* — طبقات زجاجية: تُستخدم بدل أي rgba أبيض محلي — */
  glassFaint: 'rgba(255, 255, 255, 0.03)',
  glass: 'rgba(255, 255, 255, 0.05)',
  glassStrong: 'rgba(255, 255, 255, 0.10)',
  glassLine: 'rgba(255, 255, 255, 0.06)',
  borderLight: 'rgba(255, 255, 255, 0.22)',

  /* — أسطح الشاشات — */
  backgroundDeep: '#07050C',
  heroSurface: '#170E27',
  bar: 'rgba(18, 12, 29, 0.88)',
  sheet: '#150E24',
  sheetTop: '#1C1330',
  sheetBottom: '#120C20',

  /* — هالات ملوّنة بدرجات مختلفة — */
  primaryHaze: 'rgba(169, 71, 245, 0.20)',
  goldHaze: 'rgba(244, 189, 85, 0.12)',
  goldLine: 'rgba(244, 189, 85, 0.26)',
  goldEdge: 'rgba(244, 189, 85, 0.55)',
  tealHaze: 'rgba(88, 214, 193, 0.12)',
  tealEdge: 'rgba(88, 214, 193, 0.55)',
  successLine: 'rgba(70, 212, 154, 0.26)',

  /* — أحبار فوق الأسطح الفاتحة — */
  inkDark: '#0B0714',
  inkGold: '#25140A',
  inkTeal: '#062A24',
  inkDanger: '#2A0E18',
  inkShadow: 'rgba(0, 0, 0, 0.25)',
  shadowInk: '#000000',
  primaryLight: '#DDB6FF',

  /* — هالات الغرف (كرات ضوئية متحركة) — */
  primaryOrb: 'rgba(169, 71, 245, 0.16)',
  primaryOrbFaint: 'rgba(169, 71, 245, 0.09)',
  tealOrb: 'rgba(88, 214, 193, 0.10)',
  goldOrb: 'rgba(244, 189, 85, 0.07)',
} as const;

/**
 * ألوان الرسوم التوضيحية (SVG) لمشاهد الهدايا.
 * ليست ألوان واجهة عامة، لكنها تُوحّد هنا كي لا تبقى ألوان محلية داخل المكوّنات.
 */
export const art = {
  sailTop: '#F2FBFF',
  sailMid: '#B6DDF7',
  sailRose: '#F6C9E9',
  sailMint: '#A6EFDD',
  sailShadeHigh: '#C9B6E8',
  sailShadeLow: '#8FB6D8',
  mast: '#EAF1FF',
  mastMain: '#F7FAFF',
  hullHigh: '#AFC3E4',
  hullMid: '#63739F',
  hullLow: '#242C4C',
  deckHigh: '#E0C994',
  deckLow: '#8A6A3A',
  hullHighlight: '#D6E8FF',
  portholes: '#FFE6A6',
  gem: '#FFF6D5',
  waterTop: 'rgba(72, 158, 214, 0.42)',
  waterMid: 'rgba(24, 74, 124, 0.72)',
  waterLow: 'rgba(8, 26, 48, 0.92)',
  waterLine: 'rgba(190, 240, 255, 0.35)',
  waterLineFaint: 'rgba(190, 240, 255, 0.18)',
  starCool: '#BFEFFF',
  starWarm: '#FFFFFF',
  sceneSky: 'rgba(6, 10, 22, 0.55)',
  sceneSkyMid: 'rgba(8, 14, 30, 0.78)',
  sceneSkyLow: 'rgba(4, 8, 18, 0.9)',
  bannerGlass: 'rgba(12, 18, 34, 0.72)',
  outline: '#FFFFFF',
} as const;

/** ألوان العملات — هوية بصرية ثابتة للنقاط/الذهب/الألماس (تُستهلك في CurrencyIcon). */
export const currency = {
  point: { background: '#2A1B50', border: '#8757E8', icon: '#C4A5FF' },
  coin: { background: '#3B2A12', border: '#B9862F', icon: '#FFD36B' },
  diamond: { background: '#123A3D', border: '#3D9D9A', icon: '#78E4D7' },
} as const;

/** تدرجات جاهزة — تُستخدم بدل الألوان المسطحة في العناصر البطلة. */
export const gradients = {
  screen: ['#170D28', '#0B0714', '#07050C'] as const,
  primary: ['#C86BFF', '#8B34E8'] as const,
  primarySoft: ['rgba(169, 71, 245, 0.26)', 'rgba(169, 71, 245, 0.05)'] as const,
  gold: ['#FFD98A', '#E8A93F'] as const,
  teal: ['#6FF0D5', '#1FA98F'] as const,
  danger: ['#FF93A8', '#E24A6B'] as const,
  card: ['rgba(255, 255, 255, 0.065)', 'rgba(255, 255, 255, 0.018)'] as const,
  cardGlow: ['rgba(169, 71, 245, 0.16)', 'rgba(169, 71, 245, 0.02)'] as const,
  cover: ['rgba(10, 7, 18, 0)', 'rgba(10, 7, 18, 0.55)', 'rgba(8, 5, 14, 0.96)'] as const,
  hero: ['rgba(169, 71, 245, 0.34)', 'rgba(88, 214, 193, 0.08)', 'rgba(10, 7, 18, 0)'] as const,
  sheet: ['#1C1330', '#120C20'] as const,
  scrim: ['rgba(6, 4, 10, 0.72)', 'rgba(6, 4, 10, 0.28)', 'rgba(6, 4, 10, 0.55)', 'rgba(6, 4, 10, 0.92)'] as const,
  stageGlow: ['rgba(169, 71, 245, 0.20)', 'rgba(169, 71, 245, 0.04)', 'rgba(10, 7, 18, 0)'] as const,
  spotlight: ['rgba(244, 189, 85, 0.26)', 'rgba(169, 71, 245, 0.10)', 'rgba(0, 0, 0, 0)'] as const,
} as const;

export const radius = {
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 26,
  xxl: 32,
  pill: 999,
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

/** عائلات Cairo — كل وزن ملف مستقل، لذلك لا يُستخدم fontWeight معها على أندرويد. */
export const fonts = {
  regular: 'Cairo_400Regular',
  medium: 'Cairo_500Medium',
  semibold: 'Cairo_600SemiBold',
  bold: 'Cairo_700Bold',
  black: 'Cairo_900Black',
} as const;

/** مقياس الطباعة — lineHeight سخي لأن الحروف العربية تحتاج مساحة نزول. */
export const typeScale = {
  display: { fontFamily: fonts.black, fontSize: 30, lineHeight: 44, letterSpacing: -0.3, color: colors.text, textAlign: 'right' },
  h1: { fontFamily: fonts.black, fontSize: 23, lineHeight: 34, color: colors.text, textAlign: 'right' },
  h2: { fontFamily: fonts.bold, fontSize: 18, lineHeight: 28, color: colors.text, textAlign: 'right' },
  title: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 24, color: colors.text, textAlign: 'right' },
  body: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 23, color: colors.text, textAlign: 'right' },
  bodyStrong: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 23, color: colors.text, textAlign: 'right' },
  label: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 19, color: colors.textSecondary, textAlign: 'right' },
  caption: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 18, color: colors.textSecondary, textAlign: 'right' },
  micro: { fontFamily: fonts.bold, fontSize: 10, lineHeight: 15, color: colors.textSecondary, textAlign: 'right' },
  numeric: { fontFamily: fonts.black, fontSize: 20, lineHeight: 26, color: colors.text, textAlign: 'right' },
} as const;

export type TextVariant = keyof typeof typeScale;

/** إيقاعات الحركة — أرقام موحّدة كي لا تختلف الشاشات. */
export const motion = {
  fast: 140,
  base: 220,
  slow: 380,
  entrance: 460,
  stagger: 55,
  spring: { damping: 18, stiffness: 240, mass: 0.7 },
  springSoft: { damping: 20, stiffness: 140, mass: 0.9 },
  press: 0.965,
} as const;

export const shadow = {
  card: {
    shadowColor: '#000000',
    shadowOpacity: 0.32,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  raised: {
    shadowColor: '#000000',
    shadowOpacity: 0.42,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 16 },
    elevation: 14,
  },
} as const;

/** هالة ملوّنة حول عنصر (تُستخدم للعناصر الحيّة فقط: بث، تحدّث، فوز). */
export function glow(color: string, radiusPx = 16) {
  return {
    shadowColor: color,
    shadowOpacity: 0.5,
    shadowRadius: radiusPx,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  } as const;
}
