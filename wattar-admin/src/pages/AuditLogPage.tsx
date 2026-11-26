import { useEffect, useState } from 'react';
import {
  Activity,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  FileText,
  Loader2,
  RefreshCw,
  Search,
} from 'lucide-react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { buildIlikeOr } from '@/lib/search';
import { queryErrorMessage, queryKey } from '@/lib/queryClient';
import {
  buildAuditCsv,
  downloadTextFile,
  formatRedactedJson,
  openAuditPrint,
  redactSensitive,
  type AuditExportRow,
} from '@/lib/auditExport';

interface AuditRow {
  id: string;
  admin_id: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  reason: string | null;
  before: unknown;
  after: unknown;
  metadata: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  admin: { username: string; display_name: string | null } | null;
}

const PAGE_SIZE = 50;
/** سقف التصدير لحماية المتصفح والقاعدة من ملفات ضخمة بضغطة واحدة. */
const EXPORT_LIMIT = 5000;
const EXPORT_BATCH = 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const AUDIT_COLUMNS =
  'id, admin_id, action, target_type, target_id, reason, before, after, metadata, ip_address, user_agent, created_at, admin:users!admin_audit_log_admin_id_fkey(username, display_name)';

const actionLabels: Record<string, string> = {
  create: 'إنشاء',
  update: 'تعديل',
  delete: 'حذف',
  approve: 'موافقة',
  reject: 'رفض',
  suspend: 'إيقاف مؤقت',
  ban: 'حظر دائم',
  unban: 'إعادة تفعيل',
  force_win: 'ضبط نتيجة فوز',
  force_lose: 'ضبط نتيجة خسارة',
  adjust_balance: 'تعديل رصيد',
  set_rtp: 'تعديل إعداد لعب',
  create_agent: 'إنشاء وكيل',
  credit_agent: 'شحن مخزون وكيل',
  reset_password: 'إعادة تعيين كلمة مرور',
};

function formatJson(value: unknown): string {
  if (value === null || value === undefined) return '—';
  return JSON.stringify(redactSensitive(value), null, 2);
}

function adminName(row: { admin: AuditRow['admin']; admin_id: string }): string {
  return row.admin?.display_name || row.admin?.username || `مسؤول ${row.admin_id.slice(0, 8)}`;
}

/** يبني شرط OR للبحث، ويحلّ أسماء المسؤولين إلى معرّفات مرة واحدة. */
async function buildAuditOrFilter(search: string): Promise<string | null> {
  const term = search.trim();
  if (!term) return null;

  const clauses: string[] = [];
  const textFilter = buildIlikeOr(['reason', 'target_type'], term);
  if (textFilter) clauses.push(textFilter);
  if (UUID_RE.test(term)) clauses.push(`target_id.eq.${term}`);

  const nameFilter = buildIlikeOr(['username', 'display_name'], term);
  if (nameFilter) {
    const { data: admins } = await supabase.from('users').select('id').or(nameFilter).limit(20);
    const ids = ((admins ?? []) as Array<{ id: string }>).map((admin) => admin.id).filter(Boolean);
    if (ids.length) clauses.push(`admin_id.in.(${ids.join(',')})`);
  }

  return clauses.length ? clauses.join(',') : null;
}

function normalizeRow(row: Omit<AuditRow, 'admin'> & { admin: AuditRow['admin'] | AuditRow['admin'][] }): AuditRow {
  return {
    ...row,
    admin: Array.isArray(row.admin) ? row.admin[0] ?? null : row.admin,
  };
}

interface AuditPage {
  rows: AuditRow[];
  total: number;
}

async function fetchAuditPage(params: { page: number; search: string; actionFilter: string }): Promise<AuditPage> {
  const { page, search, actionFilter } = params;
  const orFilter = await buildAuditOrFilter(search);

  let query = supabase.from('admin_audit_log').select(AUDIT_COLUMNS, { count: 'exact' });
  if (actionFilter) query = query.eq('action', actionFilter);
  if (orFilter) query = query.or(orFilter);

  const from = page * PAGE_SIZE;
  const { data, error: queryError, count } = await query
    .order('created_at', { ascending: false })
    .range(from, from + PAGE_SIZE - 1);
  if (queryError) throw queryError;

  return {
    rows: ((data ?? []) as Array<Omit<AuditRow, 'admin'> & { admin: AuditRow['admin'] | AuditRow['admin'][] }>).map(normalizeRow),
    total: count ?? 0,
  };
}

/** يجلب كل الصفوف المطابقة للفلاتر (حتى السقف) على دفعات للتصدير. */
async function fetchAuditForExport(search: string, actionFilter: string): Promise<{ rows: AuditRow[]; truncated: boolean }> {
  const orFilter = await buildAuditOrFilter(search);
  const all: AuditRow[] = [];

  for (let from = 0; from < EXPORT_LIMIT; from += EXPORT_BATCH) {
    const to = Math.min(from + EXPORT_BATCH, EXPORT_LIMIT) - 1;
    let query = supabase.from('admin_audit_log').select(AUDIT_COLUMNS);
    if (actionFilter) query = query.eq('action', actionFilter);
    if (orFilter) query = query.or(orFilter);

    const { data, error: queryError } = await query
      .order('created_at', { ascending: false })
      .range(from, to);
    if (queryError) throw queryError;

    const batch = ((data ?? []) as Array<Omit<AuditRow, 'admin'> & { admin: AuditRow['admin'] | AuditRow['admin'][] }>).map(normalizeRow);
    all.push(...batch);
    if (batch.length < to - from + 1) {
      return { rows: all, truncated: false };
    }
  }

  return { rows: all, truncated: all.length >= EXPORT_LIMIT };
}

function toExportRows(rows: AuditRow[]): AuditExportRow[] {
  return rows.map((row) => ({
    id: row.id,
    admin_name: adminName(row),
    action: row.action,
    action_label: actionLabels[row.action] ?? row.action,
    target_type: row.target_type,
    target_id: row.target_id,
    reason: row.reason,
    ip_address: row.ip_address,
    user_agent: row.user_agent,
    before: row.before,
    after: row.after,
    metadata: row.metadata,
    created_at: row.created_at,
  }));
}

export function AuditLogPage() {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [page, setPage] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [exporting, setExporting] = useState<'csv' | 'pdf' | null>(null);

  // Debounce typing so pagination is not reset on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
      setPage(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    setExpandedId(null);
  }, [page]);

  const { data, error: queryError, isFetching, refetch } = useQuery({
    queryKey: queryKey('admin-audit-log', page, search, actionFilter),
    queryFn: () => fetchAuditPage({ page, search, actionFilter }),
    // Keep the previous page visible while the next one loads.
    placeholderData: keepPreviousData,
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const loading = isFetching;
  const error = queryError ? queryErrorMessage(queryError, 'تعذر تحميل سجل الإدارة.') : null;
  const load = refetch;

  // If the current page fell past the end (e.g. filters changed), move back.
  useEffect(() => {
    if (data && page > 0 && page * PAGE_SIZE >= data.total) {
      setPage(Math.max(0, Math.ceil(data.total / PAGE_SIZE) - 1));
    }
  }, [data, page]);

  const filterDescription = [
    search.trim() ? `بحث: ${search.trim()}` : 'كل السجلات',
    actionFilter ? `الإجراء: ${actionLabels[actionFilter] ?? actionFilter}` : null,
  ].filter(Boolean).join(' · ');

  const runExport = async (kind: 'csv' | 'pdf') => {
    if (exporting) return;
    setExporting(kind);
    try {
      const { rows: exportRows, truncated } = await fetchAuditForExport(search, actionFilter);
      if (exportRows.length === 0) {
        toast.error('لا توجد سجلات مطابقة للتصدير.');
        return;
      }

      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const payload = toExportRows(exportRows);

      if (kind === 'csv') {
        downloadTextFile(`wattar-audit-${stamp}.csv`, buildAuditCsv(payload), 'text/csv;charset=utf-8');
        toast.success(`تم تصدير ${exportRows.length} سجلاً إلى CSV.`);
      } else {
        const opened = openAuditPrint(payload, { filters: filterDescription, generatedAt: new Date() });
        if (!opened) {
          toast.error('منع المتصفح فتح نافذة الطباعة. اسمح بالنوافذ المنبثقة ثم أعد المحاولة.');
          return;
        }
        toast.success('فُتح مستند الطباعة — اختر «حفظ كـ PDF».');
      }

      if (truncated) {
        toast.warning(`التصدير محدود بأحدث ${EXPORT_LIMIT} سجل. ضيّق البحث لتصدير بقية السجلات.`);
      }
    } catch (caught: unknown) {
      toast.error(queryErrorMessage(caught, 'تعذر تصدير السجل.'));
    } finally {
      setExporting(null);
    }
  };

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const rangeEnd = Math.min((page + 1) * PAGE_SIZE, total);

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-wattar-600/15 p-3 text-wattar-300">
              <Activity size={21} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">سجل الإدارة</h1>
              <p className="mt-1 text-sm text-gray-400">كل الإجراءات الإدارية المسجلة على المنصة — مقسمة إلى صفحات</p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void runExport('csv')}
            disabled={exporting !== null || loading}
            className="flex items-center gap-2 rounded-lg border border-wattar-900 bg-dark-surface px-3 py-2 text-sm text-gray-200 hover:bg-dark-elevated disabled:opacity-50"
          >
            {exporting === 'csv' ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            تصدير CSV
          </button>
          <button
            type="button"
            onClick={() => void runExport('pdf')}
            disabled={exporting !== null || loading}
            className="flex items-center gap-2 rounded-lg border border-wattar-900 bg-dark-surface px-3 py-2 text-sm text-gray-200 hover:bg-dark-elevated disabled:opacity-50"
          >
            {exporting === 'pdf' ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
            تصدير PDF
          </button>
          <button
            onClick={() => void load()}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg border border-wattar-900 bg-dark-surface px-4 py-2 text-sm text-gray-200 hover:bg-dark-elevated disabled:opacity-50"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            تحديث السجل
          </button>
        </div>
      </div>

      <div className="grid gap-3 rounded-xl border border-wattar-900 bg-dark-surface p-4 md:grid-cols-[minmax(0,1fr)_220px]">
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500" size={17} />
          <input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="بحث بالسبب أو نوع الهدف أو اسم المسؤول أو معرّف..."
            className="w-full rounded-lg border border-wattar-900 bg-dark-elevated py-2.5 pr-10 pl-4 text-sm text-white placeholder-gray-500 focus:border-wattar-500 focus:outline-none"
          />
        </div>
        <select
          value={actionFilter}
          onChange={(event) => {
            setActionFilter(event.target.value);
            setPage(0);
          }}
          className="rounded-lg border border-wattar-900 bg-dark-elevated px-3 py-2.5 text-sm text-white focus:border-wattar-500 focus:outline-none"
        >
          <option value="">كل الإجراءات</option>
          {Object.entries(actionLabels).map(([action, label]) => (
            <option key={action} value={action}>{label}</option>
          ))}
        </select>
      </div>

      {error ? (
        <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
          تعذر تحميل السجل: {error}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-wattar-900 bg-dark-surface">
        {loading && rows.length === 0 ? (
          <div className="p-10 text-center text-sm text-gray-400">جاري تحميل سجل الإدارة...</div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center">
            <Activity size={25} className="mx-auto mb-3 text-gray-500" />
            <p className="font-medium text-gray-300">لا توجد إجراءات مطابقة</p>
            <p className="mt-1 text-sm text-gray-500">ستظهر هنا التغييرات الإدارية المسجلة.</p>
          </div>
        ) : (
          <div className={`divide-y divide-wattar-900/70 ${loading ? 'opacity-60' : ''}`}>
            {rows.map((row) => {
              const expanded = expandedId === row.id;
              return (
                <article key={row.id} className="p-4 md:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-wattar-500/25 bg-wattar-500/10 px-2.5 py-1 text-xs font-semibold text-wattar-300">
                          {actionLabels[row.action] ?? row.action}
                        </span>
                        <span className="text-sm font-semibold text-white">
                          {adminName(row)}
                        </span>
                      </div>
                      <p className="mt-2 break-all text-xs text-gray-400">
                        {row.target_type ? `الهدف: ${row.target_type}` : 'إجراء عام'}
                        {row.target_id ? ` · ${row.target_id}` : ''}
                      </p>
                      {row.reason ? (
                        <p className="mt-1 break-all text-xs text-gray-300">
                          <span className="text-gray-500">السبب: </span>
                          {row.reason}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-3">
                      <time className="text-xs text-gray-500" dateTime={row.created_at}>
                        {new Date(row.created_at).toLocaleString('ar')}
                      </time>
                      <button
                        onClick={() => setExpandedId(expanded ? null : row.id)}
                        className="rounded-lg p-2 text-gray-400 hover:bg-dark-elevated hover:text-white"
                        aria-label={expanded ? 'إخفاء التفاصيل' : 'عرض التفاصيل'}
                        aria-expanded={expanded}
                      >
                        {expanded ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
                      </button>
                    </div>
                  </div>
                  {expanded ? (
                    <>
                      <div className="mt-4 grid gap-2 rounded-lg border border-wattar-900 bg-dark-elevated p-3 text-[11px] text-gray-400 sm:grid-cols-3">
                        <p className="break-all">
                          <span className="text-gray-500">IP: </span>
                          <span className="font-mono text-gray-200">{row.ip_address ?? '—'}</span>
                        </p>
                        <p className="break-all sm:col-span-2">
                          <span className="text-gray-500">الجهاز/الجلسة: </span>
                          {row.user_agent ?? '—'}
                        </p>
                      </div>
                      <div className="mt-3 grid gap-3 lg:grid-cols-3">
                        <JsonDetail title="قبل التغيير" value={row.before} />
                        <JsonDetail title="بعد التغيير" value={row.after} />
                        <JsonDetail title="تفاصيل الإجراء" value={row.metadata} />
                      </div>
                    </>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-wattar-900 p-4">
          <p className="text-xs text-gray-500">
            {total === 0 ? 'لا نتائج' : `عرض ${rangeStart}–${rangeEnd} من ${total} إجراء`}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(0, current - 1))}
              disabled={page === 0 || loading}
              className="flex items-center gap-1 rounded-lg border border-wattar-900 px-3 py-1.5 text-xs text-gray-300 hover:bg-dark-elevated disabled:opacity-40"
            >
              <ChevronRight size={14} />
              السابق
            </button>
            <span className="text-xs text-gray-400">
              صفحة {page + 1} / {pageCount}
            </span>
            <button
              type="button"
              onClick={() => setPage((current) => (current + 1 < pageCount ? current + 1 : current))}
              disabled={page + 1 >= pageCount || loading}
              className="flex items-center gap-1 rounded-lg border border-wattar-900 px-3 py-1.5 text-xs text-gray-300 hover:bg-dark-elevated disabled:opacity-40"
            >
              التالي
              <ChevronLeft size={14} />
            </button>
          </div>
        </div>
      </div>
      <p className="text-xs leading-5 text-gray-500">
        تُجلب الصفحة من الخادم مع العدد الإجمالي، ويُسجَّل مع كل إجراء المسؤول والسبب وIP والجهاز. تُحجب القيم ذات الأسماء الحساسة عند العرض والتصدير.
      </p>
    </div>
  );
}

function JsonDetail({ title, value }: { title: string; value: unknown }) {
  return (
    <div className="min-w-0 rounded-lg border border-wattar-900 bg-dark-elevated p-3">
      <h2 className="mb-2 text-xs font-semibold text-gray-300">{title}</h2>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-5 text-gray-400">
        {formatJson(value)}
      </pre>
    </div>
  );
}
