/**
 * Wattar — قواعد عرض تسعير الرسائل الخاصة.
 *
 * السياسة (ملف المتطلبات §20 + قرار المدير 2026-11-14):
 *   مجاني بلا حد : صديق مقبول، أو متابعة متبادلة، أو المُرسِل مضيف معتمد.
 *   غير ذلك      : عدد محدود من الرسائل المجانية لكل محادثة، ثم سعر Coin لكل رسالة.
 *
 * كل الدوال هنا نقية (بلا React وبلا شبكة) حتى تُختبر مباشرة.
 */

export interface MessageQuote {
  free_limit: number;
  free_used: number;
  free_remaining: number | null;
  price_coin: number;
  host_commission_percent: number;
  recipient_is_host: boolean;
  sender_is_host: boolean;
  is_friend: boolean;
  is_mutual_follow?: boolean;
}

/** هل هذه المحادثة مجانية بلا حد؟ */
export function isUnlimitedMessaging(quote: MessageQuote | null | undefined): boolean {
  if (!quote) return false;
  return quote.is_friend === true || quote.is_mutual_follow === true || quote.sender_is_host === true;
}

/** هل يجب سؤال المستخدم قبل الخصم؟ */
export function requiresPriceConfirmation(quote: MessageQuote | null | undefined): boolean {
  if (!quote) return false;
  if (isUnlimitedMessaging(quote)) return false;
  return quote.price_coin > 0;
}

/** سطر تحت اسم الطرف الآخر في ترويسة المحادثة. */
export function getConversationSubtitle(quote: MessageQuote | null | undefined): string {
  return isUnlimitedMessaging(quote) ? 'محادثة مجانية بلا حد' : 'محادثة خاصة';
}

/** شريط التسعير فوق مربع الكتابة. */
export function getPricingNotice(quote: MessageQuote): string {
  if (isUnlimitedMessaging(quote)) return 'الرسائل مجانية';
  if (quote.free_remaining !== null && quote.free_remaining > 0) {
    return `متبقي ${quote.free_remaining} من الرسائل المجانية في هذه المحادثة`;
  }
  const price = quote.price_coin.toLocaleString();
  const commission = quote.recipient_is_host
    ? ` · حصة المضيفة ${quote.host_commission_percent}% Diamond`
    : '';
  return `سعر الرسالة ${price} Coin${commission}`;
}

/** نص نافذة تأكيد الرسالة المدفوعة. */
export function getPriceConfirmationText(quote: MessageQuote): string {
  const price = quote.price_coin.toLocaleString();
  const commission = quote.recipient_is_host
    ? `\nستحصل المضيفة على ${Math.floor((quote.price_coin * quote.host_commission_percent) / 100).toLocaleString()} Diamond.`
    : '';
  return `سيُخصم ${price} Coin من رصيدك.${commission}`;
}

/**
 * مفتاح منع تكرار الرسالة. الخادم يقبل بين ١٠ و٧٠ حرفاً،
 * فالطول هنا محسوب ليبقى داخل هذا المجال دائماً.
 */
export function createIdempotencyKey(now: number = Date.now(), random: () => number = Math.random): string {
  const a = Math.floor(random() * 1_000_000_000).toString(36);
  const b = Math.floor(random() * 1_000_000_000).toString(36);
  return `${now.toString(36)}-${a}-${b}`;
}
