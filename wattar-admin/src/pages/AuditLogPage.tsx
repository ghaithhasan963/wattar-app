import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, ChevronDown, ChevronUp, RefreshCw, Search } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface AuditRow {
  id: string;
  admin_id: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  before: unknown;
  after: unknown;
  metadata: Record<string, unknown> | null;
  created_at: string;
  admin: { username: string; display_name: string | null } | null;
}

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

function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      /password|token|secret|authorization|document|proof/i.test(key)
        ? '[محجوب]'
        : redactSensitive(item),
    ]),
  );
}

function formatJson(value: unknown): string {
  if (value === null || value === undefined) return '—';
  return JSON.stringify(redactSensitive(value), null, 2);
}

export function AuditLogPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: queryError } = await supabase
        .from('admin_audit_log')
        .select('id, admin_id, action, target_type, target_id, before, after, metadata, created_at, admin:users!admin_audit_log_admin_id_fkey(username, display_name)')
        .order('created_at', { ascending: false })
        .limit(200);
      if (queryError) throw queryError;
      setRows(((data ?? []) as Array<Omit<AuditRow, 'admin'> & { admin: AuditRow['admin'] | AuditRow['admin'][] }>).map((row) => ({
        ...row,
        admin: Array.isArray(row.admin) ? row.admin[0] ?? null : row.admin,
      })));
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'تعذر تحميل سجل الإدارة.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleRows = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return rows.filter((row) => {
      if (actionFilter && row.action !== actionFilter) return false;
      if (!term) return true;
      const adminName = row.admin?.display_name || row.admin?.username || '';
      return [
        adminName,
        row.admin_id,
        row.action,
        row.target_type,
        row.target_id,
      ].some((value) => value?.toLocaleLowerCase().includes(term));
    });
  }, [actionFilter, rows, search]);

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
              <p className="mt-1 text-sm text-gray-400">آخر 200 إجراء إداري مسجل على المنصة</p>
            </div>
          </div>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg border border-wattar-900 bg-dark-surface px-4 py-2 text-sm text-gray-200 hover:bg-dark-elevated disabled:opacity-50"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          تحديث السجل
        </button>
      </div>

      <div className="grid gap-3 rounded-xl border border-wattar-900 bg-dark-surface p-4 md:grid-cols-[minmax(0,1fr)_220px]">
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500" size={17} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="بحث باسم المسؤول أو معرّف الحساب..."
            className="w-full rounded-lg border border-wattar-900 bg-dark-elevated py-2.5 pr-10 pl-4 text-sm text-white placeholder-gray-500 focus:border-wattar-500 focus:outline-none"
          />
        </div>
        <select
          value={actionFilter}
          onChange={(event) => setActionFilter(event.target.value)}
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
        {loading ? (
          <div className="p-10 text-center text-sm text-gray-400">جاري تحميل سجل الإدارة...</div>
        ) : visibleRows.length === 0 ? (
          <div className="p-10 text-center">
            <Activity size={25} className="mx-auto mb-3 text-gray-500" />
            <p className="font-medium text-gray-300">لا توجد إجراءات مطابقة</p>
            <p className="mt-1 text-sm text-gray-500">ستظهر هنا التغييرات الإدارية المسجلة.</p>
          </div>
        ) : (
          <div className="divide-y divide-wattar-900/70">
            {visibleRows.map((row) => {
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
                          {row.admin?.display_name || row.admin?.username || `مسؤول ${row.admin_id.slice(0, 8)}`}
                        </span>
                      </div>
                      <p className="mt-2 break-all text-xs text-gray-400">
                        {row.target_type ? `الهدف: ${row.target_type}` : 'إجراء عام'}
                        {row.target_id ? ` · ${row.target_id}` : ''}
                      </p>
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
                    <div className="mt-4 grid gap-3 lg:grid-cols-3">
                      <JsonDetail title="قبل التغيير" value={row.before} />
                      <JsonDetail title="بعد التغيير" value={row.after} />
                      <JsonDetail title="تفاصيل الإجراء" value={row.metadata} />
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </div>
      <p className="text-xs leading-5 text-gray-500">
        السجل يعرض أحدث 200 إجراء فقط. الوصول للبيانات يخضع لصلاحيات الإدارة، وتُحجب القيم ذات الأسماء الحساسة عند عرض التفاصيل.
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
