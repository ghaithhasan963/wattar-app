import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, RefreshCw, Search, ShieldAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';

interface UserReport {
  id: string;
  reason: string;
  created_at: string;
  reporter: { id: string; username: string; display_name: string | null } | null;
  reported: { id: string; username: string; display_name: string | null } | null;
}

function displayUser(user: UserReport['reporter']) {
  return user?.display_name || (user?.username ? `@${user.username}` : 'مستخدم غير متاح');
}

export function UserReportsPage() {
  const [reports, setReports] = useState<UserReport[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: queryError } = await supabase
        .from('user_reports')
        .select('id, reason, created_at, reporter:users!user_reports_reporter_id_fkey(id, username, display_name), reported:users!user_reports_reported_id_fkey(id, username, display_name)')
        .order('created_at', { ascending: false })
        .limit(200);
      if (queryError) throw queryError;

      const normalized = ((data ?? []) as Array<UserReport & {
        reporter: UserReport['reporter'] | UserReport['reporter'][];
        reported: UserReport['reported'] | UserReport['reported'][];
      }>).map((report) => ({
        ...report,
        reporter: Array.isArray(report.reporter) ? report.reporter[0] ?? null : report.reporter,
        reported: Array.isArray(report.reported) ? report.reported[0] ?? null : report.reported,
      }));
      setReports(normalized);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'تعذر تحميل البلاغات.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleReports = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    if (!term) return reports;
    return reports.filter((report) => [
      report.reason,
      report.reporter?.username,
      report.reporter?.display_name,
      report.reported?.username,
      report.reported?.display_name,
    ].some((value) => value?.toLocaleLowerCase().includes(term)));
  }, [reports, search]);

  return (
    <div className="space-y-6" dir="rtl">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="rounded-xl bg-rose-400/10 p-3 text-rose-300"><ShieldAlert size={22} /></span>
          <div>
            <h1 className="text-2xl font-bold text-white">بلاغات المستخدمين</h1>
            <p className="mt-1 text-sm text-gray-400">مراجعة البلاغات الواردة ومعلومات الأطراف والسبب</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-dark-surface px-4 py-2.5 text-sm text-gray-200 transition hover:bg-dark-elevated disabled:opacity-50"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          تحديث البلاغات
        </button>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/[0.07] bg-dark-surface p-4">
        <label className="relative min-w-[min(100%,20rem)] flex-1">
          <Search size={17} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="ابحث بالاسم أو سبب البلاغ..."
            className="w-full rounded-xl border border-white/10 bg-dark-elevated py-2.5 pl-4 pr-10 text-sm text-white placeholder:text-gray-500 focus:border-wattar-500 focus:outline-none"
          />
        </label>
        <span className="text-xs text-gray-500">
          {loading ? 'جاري التحميل...' : `${visibleReports.length.toLocaleString('ar')} بلاغ معروض من آخر 200`}
        </span>
      </div>

      {error && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          <span>تعذر تحميل البلاغات: {error}</span>
          <button onClick={() => void load()} className="rounded-lg bg-red-500/15 px-3 py-2 font-medium hover:bg-red-500/25">إعادة المحاولة</button>
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-white/[0.07] bg-dark-surface">
        {loading && reports.length === 0 ? (
          <p className="p-10 text-center text-sm text-gray-400">جاري تحميل البلاغات...</p>
        ) : visibleReports.length === 0 ? (
          <div className="p-12 text-center">
            <AlertTriangle size={25} className="mx-auto mb-3 text-gray-600" />
            <p className="font-medium text-gray-300">{search ? 'لا توجد نتائج مطابقة' : 'لا توجد بلاغات مسجّلة'}</p>
            <p className="mt-1 text-sm text-gray-500">ستظهر البلاغات الجديدة هنا عند ورودها.</p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.06]">
            {visibleReports.map((report) => (
              <article key={report.id} className="grid gap-3 p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                    <span className="text-gray-500">المبلّغ</span>
                    <span className="font-medium text-gray-200">{displayUser(report.reporter)}</span>
                    <span className="text-gray-600">←</span>
                    <span className="text-gray-500">الحساب المُبلّغ عنه</span>
                    <span className="font-semibold text-rose-200">{displayUser(report.reported)}</span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-gray-400">{report.reason}</p>
                  <p className="mt-2 text-[11px] text-gray-600">رقم البلاغ: {report.id}</p>
                </div>
                <div className="flex items-center justify-between gap-4 md:flex-col md:items-end">
                  <time className="text-xs text-gray-500" dateTime={report.created_at}>
                    {new Date(report.created_at).toLocaleString('ar', { dateStyle: 'medium', timeStyle: 'short' })}
                  </time>
                  {report.reported && (
                    <Link
                      to={`/users?search=${encodeURIComponent(report.reported.id)}`}
                      className="rounded-lg border border-wattar-700/50 bg-wattar-500/10 px-3 py-1.5 text-xs font-medium text-wattar-200 transition hover:bg-wattar-500/20"
                    >
                      مراجعة الحساب
                    </Link>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
