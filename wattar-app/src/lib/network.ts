/**
 * Wattar — طبقة الشبكة الآمنة (M1.3).
 *
 * مسؤوليتها:
 *   ١) مهلة لكل طلب، حتى لا تعلق الشاشة بانتظار الخادم.
 *   ٢) إلغاء الطلب عبر AbortController.
 *   ٣) تصنيف الخطأ إلى: مهلة / إلغاء / شبكة / خادم / صلاحية، مع رسالة عربية واحدة للشاشة.
 *
 * كل الدوال  here نقية ما عدا `runWithTimeout` الذي يستخدم مؤقتاً حقيقياً بسيطاً،
 * حتى يمكن اختبارها مباشرة بلا React ولا شبكة.
 */

export type NetworkErrorKind =
  | 'timeout'
  | 'aborted'
  | 'network'
  | 'server'
  | 'permission'
  | 'unknown';

const KIND_MESSAGE: Record<NetworkErrorKind, string> = {
  timeout: 'انتهت مهلة الطلب. تحقّق من اتصال الإنترنت وحاول مجددًا.',
  aborted: 'أُلغي الطلب قبل اكتماله.',
  network: 'تعذّر الاتصال بالخادم. تحقّق من الإنترنت وحاول مجددًا.',
  server: 'حدث خطأ في الخادم. حاول بعد قليل.',
  permission: 'ليس لديك صلاحية تنفيذ هذا الإجراء.',
  unknown: 'فشل الطلب. حاول مرة أخرى.',
};

const STATUS_MESSAGE: Record<number, string> = {
  400: 'الطلب غير صالح. حدّث الصفحة وحاول مجددًا.',
  401: 'انتهت الجلسة. سجّل الدخول من جديد.',
  403: 'ليس لديك صلاحية تنفيذ هذا الإجراء.',
  404: 'الخدمة المطلوبة غير متاحة حاليًا.',
  409: 'تعذّر تنفيذ الطلب لأن الحالة تغيّرت. حدّث الصفحة.',
  422: 'البيانات المُدخلة غير صالحة.',
  429: 'تم تجاوز الحد المسموح من المحاولات. انتظر قليلًا ثم حاول.',
  500: 'حدث خطأ في الخادم. حاول بعد قليل.',
  502: 'الخادم غير متاح حاليًا. حاول بعد قليل.',
  503: 'الخدمة غير متاحة حاليًا. حاول بعد قليل.',
  504: 'انتهت مهلة الاتصال بالخادم. حاول مجددًا.',
};

export interface WattarNetworkError extends Error {
  readonly kind: NetworkErrorKind;
  readonly status: number | null;
  readonly cause: unknown;
}

export function createNetworkError(
  kind: NetworkErrorKind,
  options: { message?: string; status?: number | null; cause?: unknown } = {},
): WattarNetworkError {
  const error = Object.assign(new Error(options.message ?? KIND_MESSAGE[kind]), {
    name: 'WattarNetworkError',
    kind,
    status: options.status ?? null,
    cause: options.cause,
  }) as WattarNetworkError;
  return error;
}

/** تصنيف حالة HTTP: الصلاحية وحدها لها تصنيف مستقل لأن الشاشات تعاملها بشكل مختلف. */
export function statusToErrorKind(status: number): NetworkErrorKind {
  if (status === 401 || status === 403) return 'permission';
  if (status >= 500) return 'server';
  if (status === 429) return 'server';
  if (status >= 400) return 'server';
  return 'unknown';
}

/** تحويل أي خطأ (شبكة، مهلة، HTTP) إلى خطأ واحد مفهوم من الشاشة. */
export function toNetworkError(error: unknown, status: number | null = null): WattarNetworkError {
  if (error instanceof Error && (error as WattarNetworkError).kind) {
    const known = error as WattarNetworkError;
    if (status !== null && known.status === null) {
      return createNetworkError(statusToErrorKind(status), {
        message: STATUS_MESSAGE[status] ?? known.message,
        status,
        cause: known,
      });
    }
    return known;
  }

  if (status !== null && status >= 400) {
    return createNetworkError(statusToErrorKind(status), {
      message: STATUS_MESSAGE[status] ?? KIND_MESSAGE.server,
      status,
      cause: error,
    });
  }

  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'WattarTimeoutError') {
      return createNetworkError('timeout', { cause: error });
    }
    if (error.name === 'AbortError') {
      return createNetworkError('aborted', { cause: error });
    }
    // الرسائل العربية القادمة من الخادم تصل كـError عادي عبر callFunction،
    // فنُبقيها كما هي حتى لا نخفي سبب الفشل الحقيقي.
    return createNetworkError('unknown', { message: error.message, cause: error });
  }

  return createNetworkError('unknown', { cause: error });
}

/**
 * تنفيذ مهمة مع مهلة. عند انتهاء المهلة تُلغى المهمة ويُعاد خطأ من نوع `timeout`.
 * المهمة تستلم `signal` حتى توقف طلباتها الداخلية.
 */
export async function runWithTimeout<T>(
  timeoutMs: number,
  task: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw createNetworkError('timeout', { message: 'مهلة الطلب غير صالحة' });
  }

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const timeoutError = createNetworkError('timeout');
      controller.abort(timeoutError);
      reject(timeoutError);
    }, timeoutMs);
  });

  try {
    return await Promise.race([task(controller.signal), timeoutPromise]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** مهلة الطلبات الافتراضية: ٢٠ ثانية. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
