import { describe, expect, it } from 'vitest';
import {
  createIdempotencyKey,
  getConversationSubtitle,
  getPriceConfirmationText,
  getPricingNotice,
  isUnlimitedMessaging,
  requiresPriceConfirmation,
  type MessageQuote,
} from './messagePricing';

/** بعض البيئات تعرض الأرقام بأرقام عربية-هندية؛ نوحّدها للمقارنة فقط. */
const latin = (value: string): string =>
  value.replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));

/** حالة أساسية: غريب، أول رسالة، مجانية. */
const strangerFree: MessageQuote = {
  free_limit: 5,
  free_used: 0,
  free_remaining: 5,
  price_coin: 0,
  host_commission_percent: 60,
  recipient_is_host: false,
  sender_is_host: false,
  is_friend: false,
  is_mutual_follow: false,
};

/** حالة غريب استنفد الرسائل المجانية. */
const strangerPaid: MessageQuote = {
  ...strangerFree,
  free_used: 5,
  free_remaining: 0,
  price_coin: 50,
};

describe('من يستحق الرسائل المجانية بلا حد', () => {
  it('الصديق المقبول مجاني بلا حد', () => {
    const quote = { ...strangerPaid, is_friend: true };
    expect(isUnlimitedMessaging(quote)).toBe(true);
    expect(getPricingNotice(quote)).toBe('الرسائل مجانية');
    expect(getConversationSubtitle(quote)).toBe('محادثة مجانية بلا حد');
    expect(requiresPriceConfirmation(quote)).toBe(false);
  });

  it('المتابع المتبادل مجاني بلا حد حتى لو ما في صداقة', () => {
    const quote = { ...strangerPaid, is_friend: false, is_mutual_follow: true };
    expect(isUnlimitedMessaging(quote)).toBe(true);
    expect(getPricingNotice(quote)).toBe('الرسائل مجانية');
    expect(getConversationSubtitle(quote)).toBe('محادثة مجانية بلا حد');
  });

  it('المضيف المُرسِل مجاني بلا حد', () => {
    const quote = { ...strangerPaid, sender_is_host: true };
    expect(isUnlimitedMessaging(quote)).toBe(true);
    expect(getPricingNotice(quote)).toBe('الرسائل مجانية');
  });

  it('كون الطرف الآخر مضيفاً لا يجعل رسائلي مجانية', () => {
    const quote = { ...strangerPaid, recipient_is_host: true };
    expect(isUnlimitedMessaging(quote)).toBe(false);
    expect(requiresPriceConfirmation(quote)).toBe(true);
  });

  it('الغريب ليس مجانياً بلا حد', () => {
    expect(isUnlimitedMessaging(strangerFree)).toBe(false);
    expect(getConversationSubtitle(strangerFree)).toBe('محادثة خاصة');
  });

  it('غياب حقل المتابعة المتبادلة يُعامل كـ«لا»', () => {
    const quote = { ...strangerPaid };
    delete (quote as Partial<MessageQuote>).is_mutual_follow;
    expect(isUnlimitedMessaging(quote)).toBe(false);
  });
});

describe('شريط التسعير', () => {
  it('يعرض العداد المتبقي للغريب', () => {
    expect(getPricingNotice(strangerFree)).toBe('متبقي 5 من الرسائل المجانية في هذه المحادثة');
  });

  it('يعرض السعر بعد استنفاد المجاني', () => {
    expect(latin(getPricingNotice(strangerPaid))).toBe('سعر الرسالة 50 Coin');
  });

  it('يضيف حصة المضيفة عندما يكون المستلم مضيفاً', () => {
    const quote = { ...strangerPaid, recipient_is_host: true };
    expect(latin(getPricingNotice(quote))).toBe('سعر الرسالة 50 Coin · حصة المضيفة 60% Diamond');
  });

  it('لا يعرض سعراً سالباً أو عداداً سالباً', () => {
    const quote = { ...strangerFree, free_remaining: 0, price_coin: 50 };
    expect(latin(getPricingNotice(quote))).toBe('سعر الرسالة 50 Coin');
  });
});

describe('نافذة تأكيد الدفع', () => {
  it('تذكر المبلغ بالعملة', () => {
    expect(latin(getPriceConfirmationText(strangerPaid))).toContain('50 Coin');
    expect(getPriceConfirmationText(strangerPaid)).not.toContain('Diamond');
  });

  it('تذكر حصة المضيفة عند وجودها', () => {
    const quote = { ...strangerPaid, recipient_is_host: true };
    expect(latin(getPriceConfirmationText(quote))).toContain('ستحصل المضيفة على 30 Diamond.');
  });
});

describe('مفتاح منع تكرار الرسالة', () => {
  it('طوله داخل المجال الذي يقبله الخادم (10–70)', () => {
    const now = 1763133600000;
    for (const value of [0, 0.000001, 0.5, 0.999999]) {
      const key = createIdempotencyKey(now, () => value);
      expect(key.length).toBeGreaterThanOrEqual(10);
      expect(key.length).toBeLessThanOrEqual(70);
    }
  });

  it('مفتاحان بنفس اللحظة يختلفان', () => {
    const now = 1763133600000;
    let calls = 0;
    const sequence = [0.1, 0.2, 0.8, 0.9];
    const keyOne = createIdempotencyKey(now, () => sequence[calls++ % sequence.length]);
    const keyTwo = createIdempotencyKey(now, () => sequence[calls++ % sequence.length]);
    expect(keyOne).not.toBe(keyTwo);
  });
});
