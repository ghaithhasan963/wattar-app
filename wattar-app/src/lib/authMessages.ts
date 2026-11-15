/**
 * Wattar — رسائل مصادقة عربية موحّدة (M1.2).
 *
 * الهدف: لا يرى المستخدم نصاً إنجليزياً من Supabase، ولا نكشف إن كان البريد
 * مسجّلاً أم لا (منع تعداد الحسابات).
 */

const RULES: ReadonlyArray<{ pattern: RegExp; message: string }> = [
  { pattern: /invalid login credentials/i, message: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.' },
  { pattern: /email not confirmed/i, message: 'لم يتم تأكيد بريدك بعد. افتح رابط التأكيد الذي أرسلناه ثم حاول مجدداً.' },
  { pattern: /already registered|already been registered|user already exists/i, message: 'هذا البريد مسجّل مسبقاً. سجّل الدخول أو استخدم «نسيت كلمة المرور».' },
  { pattern: /password should be at least|weak.?password|password.*(too short|characters)/i, message: 'كلمة المرور ضعيفة. استخدم 8 أحرف على الأقل.' },
  { pattern: /rate limit|too many requests|over_email_send_rate_limit|over_request_rate_limit|\b429\b/i, message: 'طلبات كثيرة خلال وقت قصير. انتظر دقيقة ثم حاول مرة أخرى.' },
  { pattern: /auth session missing|session.*(expired|missing)|invalid.*token|token.*(expired|invalid)|otp_expired/i, message: 'انتهت صلاحية رابط إعادة التعيين. اطلب رابطاً جديداً.' },
  { pattern: /network|fetch failed|timeout|offline|connection/i, message: 'تعذر الاتصال بالخادم. تحقّق من الإنترنت وحاول مرة أخرى.' },
];

export const GENERIC_AUTH_ERROR = 'تعذّر إكمال العملية. حاول مرة أخرى.';

/** رسالة موحّدة تُعرض دائماً عند طلب إعادة تعيين كلمة المرور (لا تكشف وجود الحساب). */
export const RECOVERY_EMAIL_SENT_MESSAGE =
  'إذا كان البريد مسجّلاً لدينا، ستصلك رسالة لإعادة تعيين كلمة المرور خلال دقائق. تحقّق من صندوق الوارد والمهملات.';

/** رسالة موحّدة عند فشل إرسال رابط الاستعادة بخطأ غير معروف. */
export const RECOVERY_EMAIL_FAILED_MESSAGE =
  'تعذّر إرسال رابط إعادة التعيين الآن. حاول بعد قليل.';

function messageOf(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const candidate = error as { message?: unknown; error_description?: unknown; code?: unknown };
    // نضمّ الرمز إلى النص لأن Supabase يضع أحياناً التفصيل في `code` (مثل 429).
    const parts = [candidate.message, candidate.error_description, candidate.code]
      .filter((value): value is string => typeof value === 'string' && value.length > 0);
    return parts.join(' ');
  }
  return '';
}

/** يحوّل أي خطأ مصادقة إلى رسالة عربية واحدة مفهومة. */
export function describeAuthError(error: unknown, fallback: string = GENERIC_AUTH_ERROR): string {
  const raw = messageOf(error);
  if (!raw) return fallback;
  // لو كان الخادم أرسل نصاً عربياً أصلاً (دوالنا السحابية) نمرّره كما هو.
  if (/[\u0600-\u06FF]/.test(raw)) return raw;
  for (const rule of RULES) {
    if (rule.pattern.test(raw)) return rule.message;
  }
  // لا نمرّر نصاً إنجليزياً للمستخدم؛ نستخدم البديل العربي.
  return fallback;
}

/**
 * هل يصلح إظهار مخطط الخطأ للمستخدم؟ (يُستخدم فقط لرسائل الاستعادة)
 * نُظهر رسالة عامة لأي خطأ لا يتعلق بالشبكة أو الحدّ، حتى لا يُستدلّ على وجود الحساب.
 */
export function describeRecoveryRequestError(error: unknown): string {
  const raw = messageOf(error);
  if (/rate limit|too many requests|over_email_send_rate_limit|over_request_rate_limit|\b429\b/i.test(raw)) {
    return 'طلبات كثيرة خلال وقت قصير. انتظر دقيقة ثم حاول مرة أخرى.';
  }
  if (/network|fetch failed|timeout|offline|connection/i.test(raw)) {
    return 'تعذر الاتصال بالخادم. تحقّق من الإنترنت وحاول مرة أخرى.';
  }
  return RECOVERY_EMAIL_FAILED_MESSAGE;
}
