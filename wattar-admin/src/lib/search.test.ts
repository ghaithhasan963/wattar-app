import { describe, expect, it } from 'vitest';
import { buildIlikeOr, escapePostgrestValue } from './search';

describe('أمان فلاتر البحث (PostgREST)', () => {
  it('يعيد null للبحث الفارغ', () => {
    expect(buildIlikeOr(['username'], '')).toBeNull();
    expect(buildIlikeOr(['username'], '   ')).toBeNull();
  });

  it('يبني فلتر ilike مقتبساً لكل عمود', () => {
    expect(buildIlikeOr(['username', 'display_name'], 'ali')).toBe(
      'username.ilike."%ali%",display_name.ilike."%ali%"',
    );
  });

  it('يمنع حقن فاصل الشروط بفاصلة', () => {
    const filter = buildIlikeOr(['username'], 'x,role.eq.admin');
    expect(filter).toBe('username.ilike."%x,role.eq.admin%"');
    // الفاصلة داخل الاقتباس لا تُنشئ شرطاً ثانياً.
    expect(filter?.split('",').length).toBe(1);
  });

  it('يمنع كسر التعبير بالأقواس والاقتباس', () => {
    const filter = buildIlikeOr(['username'], 'a").or(1.eq.1');
    expect(filter).toBe('username.ilike."%a\\").or(1.eq.1%"');
  });

  it('يهرّب محارف البدل في LIKE', () => {
    expect(escapePostgrestValue('100%_done')).toBe('100\\%\\_done');
  });

  it('يهرّب الشرطة المائلة العكسية', () => {
    expect(escapePostgrestValue('a\\b')).toBe('a\\\\b');
  });
});
