/**
 * Wattar Admin — تصدير سجل الإدارة (M7.6)
 *
 * CSV: ملف UTF-8 مع BOM حتى تظهر العربية صحيحة في Excel، مع حماية من
 *      حقن الصيغ في جداول البيانات (قيمة تبدأ بـ = + - @ تُسبق بفاصلة عليا).
 * PDF: مستند طباعة مستقل منسّق RTL يُفتح في نافذة جديدة ثم «حفظ كـ PDF»
 *      من متصفح المدير — بلا مكتبة إضافية وبلا أي تكلفة.
 *
 * before/after يُنقَّحان قبل التصدير بنفس قاعدة العرض على الشاشة، فلا تخرج
 * كلمات مرور أو توكنات أو وثائق أو أرقام هواتف في ملف يُشارَك خارج اللوحة.
 */

export interface AuditExportRow {
  id: string;
  admin_name: string;
  action: string;
  action_label: string;
  target_type: string | null;
  target_id: string | null;
  reason: string | null;
  ip_address: string | null;
  user_agent: string | null;
  before: unknown;
  after: unknown;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

const SENSITIVE_KEY = /password|token|secret|authorization|document|proof|phone|email|address|payout/i;

export function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      SENSITIVE_KEY.test(key) ? '[محجوب]' : redactSensitive(item),
    ]),
  );
}

export function formatRedactedJson(value: unknown): string {
  if (value === null || value === undefined) return '';
  return JSON.stringify(redactSensitive(value), null, 2);
}

/** تهيئة خلية CSV: اقتباس + مضاعفة علامات التنصيص + منع حقن الصيغ. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

const CSV_HEADERS = [
  'الوقت',
  'المسؤول',
  'الإجراء',
  'نوع العنصر',
  'معرّف العنصر',
  'السبب',
  'IP',
  'المتصفح/الجلسة',
  'قبل',
  'بعد',
  'تفاصيل',
  'معرّف السجل',
];

/** بناء ملف CSV كامل (بـ BOM) من صفوف السجل. */
export function buildAuditCsv(rows: AuditExportRow[]): string {
  const lines = [CSV_HEADERS.map(csvCell).join(',')];
  for (const row of rows) {
    lines.push([
      new Date(row.created_at).toISOString(),
      row.admin_name,
      row.action_label,
      row.target_type ?? '',
      row.target_id ?? '',
      row.reason ?? '',
      row.ip_address ?? '',
      row.user_agent ?? '',
      formatRedactedJson(row.before),
      formatRedactedJson(row.after),
      formatRedactedJson(row.metadata),
      row.id,
    ].map(csvCell).join(','));
  }
  return `\uFEFF${lines.join('\r\n')}`;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface AuditPrintMeta {
  /** وصف الفلاتر المطبّقة، يُطبع أعلى المستند للتوثيق. */
  filters: string;
  generatedAt: Date;
}

/** بناء مستند الطباعة (يُستخدم في النافذة الجديدة وفي الاختبارات). */
export function buildAuditPrintHtml(rows: AuditExportRow[], meta: AuditPrintMeta): string {
  const body = rows.map((row) => `
    <tr>
      <td>${escapeHtml(new Date(row.created_at).toLocaleString('ar'))}</td>
      <td>${escapeHtml(row.admin_name)}</td>
      <td>${escapeHtml(row.action_label)}</td>
      <td>${escapeHtml(row.target_type ?? '—')}${row.target_id ? `<br><span class="mono">${escapeHtml(row.target_id)}</span>` : ''}</td>
      <td>${escapeHtml(row.reason ?? '—')}</td>
      <td class="mono">${escapeHtml(row.ip_address ?? '—')}</td>
      <td class="mono">${escapeHtml(row.user_agent ?? '—')}</td>
      <td><pre>${escapeHtml(formatRedactedJson(row.before) || '—')}</pre></td>
      <td><pre>${escapeHtml(formatRedactedJson(row.after) || '—')}</pre></td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<title>سجل الإدارة — وتر</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  body { font-family: "Segoe UI", Tahoma, sans-serif; color: #111; font-size: 10px; }
  h1 { font-size: 16px; margin: 0 0 4px; }
  .meta { color: #555; font-size: 10px; margin-bottom: 10px; line-height: 1.7; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #bbb; padding: 4px 5px; text-align: right; vertical-align: top; }
  th { background: #eee; font-size: 10px; }
  tr { page-break-inside: avoid; }
  pre { margin: 0; white-space: pre-wrap; word-break: break-all; font-size: 9px; max-width: 220px; }
  .mono { font-family: Consolas, monospace; font-size: 9px; word-break: break-all; }
  footer { margin-top: 8px; color: #666; font-size: 9px; }
</style>
</head>
<body>
  <h1>سجل الإدارة — منصة وتر</h1>
  <div class="meta">
    الفلاتر: ${escapeHtml(meta.filters)}<br>
    عدد السجلات: ${rows.length}<br>
    أُنشئ في: ${escapeHtml(meta.generatedAt.toLocaleString('ar'))}<br>
    القيم ذات الأسماء الحساسة (كلمات مرور/توكنات/وثائق/هواتف) محجوبة في هذا الملف.
  </div>
  <table>
    <thead>
      <tr>
        <th>الوقت</th><th>المسؤول</th><th>الإجراء</th><th>العنصر</th>
        <th>السبب</th><th>IP</th><th>المتصفح/الجلسة</th><th>قبل</th><th>بعد</th>
      </tr>
    </thead>
    <tbody>${body}</tbody>
  </table>
  <footer>ملف تدقيق داخلي — لا يُعدّل. كل سطر يمثّل إجراءً إدارياً مسجّلاً في قاعدة البيانات.</footer>
</body>
</html>`;
}

/** فتح نافذة الطباعة (اختيار «حفظ كـ PDF» من المتصفح). */
export function openAuditPrint(rows: AuditExportRow[], meta: AuditPrintMeta): boolean {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return false;
  printWindow.document.write(buildAuditPrintHtml(rows, meta));
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
  return true;
}

/** تنزيل نص كملف عبر رابط مؤقت. */
export function downloadTextFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
