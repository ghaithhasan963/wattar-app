import { describe, expect, it } from 'vitest';
import { queryErrorMessage, queryKey } from './queryClient';

describe('مساعدات TanStack Query', () => {
  it('يبني مفتاحاً موحّداً من المجال والمعاملات', () => {
    expect(queryKey('admin-users', 'ali', 'all')).toEqual(['admin-users', 'ali', 'all']);
  });

  it('يعيد رسالة الخطأ العربية كما هي', () => {
    expect(queryErrorMessage(new Error('تعذر التحميل'), 'بديل')).toBe('تعذر التحميل');
  });

  it('يستخدم البديل عند خطأ بلا رسالة', () => {
    expect(queryErrorMessage(null, 'بديل')).toBe('بديل');
    expect(queryErrorMessage(new Error(''), 'بديل')).toBe('بديل');
  });
});
