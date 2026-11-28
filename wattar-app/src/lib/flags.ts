/**
 * أدوات العرض المرتبطة بالدول: تحويل رمز الدولة (ISO 3166-1 alpha-2) إلى علم إيموجي.
 */
export function flagEmoji(countryCode?: string | null): string {
  if (!countryCode) return '';
  const code = countryCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return '';
  const base = 0x1f1e6;
  return String.fromCodePoint(
    base + (code.charCodeAt(0) - 65),
    base + (code.charCodeAt(1) - 65),
  );
}
