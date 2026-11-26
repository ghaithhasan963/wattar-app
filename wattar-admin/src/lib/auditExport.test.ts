import { describe, expect, it } from 'vitest';
import {
  buildAuditCsv,
  buildAuditPrintHtml,
  csvCell,
  formatRedactedJson,
  redactSensitive,
  type AuditExportRow,
} from './auditExport';

const row: AuditExportRow = {
  id: 'tx-1',
  admin_name: 'مدير وتر',
  action: 'adjust_balance',
  action_label: 'تعديل رصيد',
  target_type: 'user',
  target_id: 'u-1',
  reason: 'تصحيح رصيد بعد مراجعة',
  ip_address: '203.0.113.9',
  user_agent: 'Mozilla/5.0',
  before: { balance: 100, phone: '0999999999' },
  after: { balance: 150 },
  metadata: { source: 'admin_panel' },
  created_at: '2026-11-26T10:00:00.000Z',
};

describe('تنقية قيم التدقيق', () => {
  it('يحجب الحقول الحساسة بعمق', () => {
    const redacted = redactSensitive({ phone: '0999', nested: { password: 'x', ok: 1 } }) as any;
    expect(redacted.phone).toBe('[محجوب]');
    expect(redacted.nested.password).toBe('[محجوب]');
    expect(redacted.nested.ok).toBe(1);
  });

  it('يعيد نصاً فارغاً للقيم غير الموجودة', () => {
    expect(formatRedactedJson(null)).toBe('');
    expect(formatRedactedJson(undefined)).toBe('');
  });
});

describe('تهيئة خلايا CSV', () => {
  it('يقتبس القيم ويضاعف علامات التنصيص', () => {
    expect(csvCell('قال "لا"')).toBe('"قال ""لا"""');
  });

  it('يمنع حقن صيغ جداول البيانات', () => {
    expect(csvCell('=1+1')).toBe('"\'=1+1"');
    expect(csvCell('@cmd')).toBe('"\'@cmd"');
    expect(csvCell('-5')).toBe('"\'-5"');
  });

  it('يمثّل القيم الفارغة بخلية فارغة', () => {
    expect(csvCell(null)).toBe('""');
    expect(csvCell(undefined)).toBe('""');
  });
});

describe('ملف CSV للسجل', () => {
  it('يبدأ بـ BOM ويحوي صف الرأس والصفوف', () => {
    const csv = buildAuditCsv([row]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    const lines = csv.slice(1).split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('"الوقت"');
    expect(lines[1]).toContain('"مدير وتر"');
    expect(lines[1]).toContain('"203.0.113.9"');
  });

  it('لا يسرّب الهاتف من before', () => {
    const csv = buildAuditCsv([row]);
    expect(csv).not.toContain('0999999999');
    expect(csv).toContain('[محجوب]');
  });
});

describe('مستند الطباعة', () => {
  it('يهرّب HTML ويحوي عدد السجلات والفلاتر', () => {
    const html = buildAuditPrintHtml(
      [{ ...row, reason: '<script>alert(1)</script>' }],
      { filters: 'كل السجلات', generatedAt: new Date('2026-11-26T10:00:00.000Z') },
    );
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('عدد السجلات: 1');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });
});
