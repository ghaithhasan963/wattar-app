/**
 * Wattar Admin — عميل TanStack Query (M7.5)
 *
 * توحيد التحميل والكاش والأخطاء:
 * - كل استعلام يُخزَّن مفتاحاً واحداً لكل شاشة/فلتر، فالتنقّل بين الصفحات
 *   يعرض آخر بيانات معروفة فوراً بدل شاشة تحميل فارغة.
 * - لا إعادة جلب تلقائية عند مجرد العودة إلى النافذة (البيانات المالية
 *   تُقرأ عند الطلب أو بعد إجراء)، مع إعادة محاولة واحدة عند فشل الشبكة.
 * - الأخطاء تُعرض داخل الصفحة نفسها عبر `queryErrorMessage` بنص عربي موحّد.
 */
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
    mutations: {
      retry: 0,
    },
  },
});

/** مفتاح استعلام موحّد: [المجال, ...المعاملات] */
export function queryKey(scope: string, ...params: unknown[]) {
  return [scope, ...params] as const;
}

/** استخراج رسالة خطأ عربية قابلة للعرض من أي شكل خطأ. */
export function queryErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return fallback;
}
