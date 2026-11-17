import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Search, ShieldAlert, X, XCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase, callFunction } from '@/lib/supabase';
import { Segmented } from '@/components/ui';

const durationChoices = [
  { label: 'ساعة', value: 60 },
  { label: 'يوم', value: 1440 },
  { label: 'أسبوع', value: 10080 },
  { label: 'شهر', value: 43200 },
];

interface UserReport {
  id: string;
  reason: string;
  created_at: string;
  status: 'pending' | 'actioned' | 'dismissed';
  decision_note: string | null;
  reporter: { id: string; username: string; display_name: string | null } | null;
  reported: { id: string; username: string; display_name: string | null } | null;
}

const STATUS_LABELS: Record<UserReport['status'], string> = {
  pending: 'قيد المراجعة',
  actioned: 'تم اتخاذ إجراء',
  dismissed: 'مرفوض',
};

const PENALTY_OPTIONS: Array<{ value: string; label: string; needsDuration?: boolean }> = [
  { value: 'none', label: 'تسجيل مخالفة فقط (بدون عقوبة)' },
  { value: 'warning', label: 'تحذير' },
  { value: 'mute', label: 'كتم', needsDuration: true },
  { value: 'temp_ban', label: 'حظر مؤقت', needsDuration: true },
  { value: 'permanent_ban', label: 'حظر دائم' },
];

function displayUser(user: UserReport['reporter']) {
  return user?.display_name || (user?.username ? `@${user.username}` : 'مستخدم غير متاح');
}

export function UserReportsPage() {
  const [reports, setReports] = useState<UserReport[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | UserReport['status']>('pending');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reportModal, setReportModal] = useState<{ report: UserReport; decision: 'actioned' | 'dismissed' } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: queryError } = await supabase
        .from('user_reports')
        .select('id, reason, created_at, status, decision_note, reporter:users!user_reports_reporter_id_fkey(id, username, display_name), reported:users!user_reports_reported_id_fkey(id, username, display_name)')
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
    return reports
      .filter((report) => (statusFilter === 'all' ? true : report.status === statusFilter))
      .filter((report) => {
        if (!term) return true;
        return [
          report.reason,
          report.reporter?.username,
          report.reporter?.display_name,
          report.reported?.username,
          report.reported?.display_name,
        ].some((value) => value?.toLocaleLowerCase().includes(term));
      });
  }, [reports, search, statusFilter]);

  const reviewReport = useCallback(
    async (
      report: UserReport,
      decision: 'actioned' | 'dismissed',
      penalty: string | null,
      durationMinutes: number | null,
      note: string,
    ) => {
      setBusy(true);
      try {
        await callFunction('admin-moderation', {
          action: 'review_report',
          report_id: report.id,
          decision,
          note: note.trim() || undefined,
          penalty_type: penalty ?? undefined,
          duration_minutes: durationMinutes ?? undefined,
        });
        toast.success(decision === 'actioned' ? 'تم تأكيد البلاغ وتنفيذ الإجراء' : 'تم رفض البلاغ');
        await load();
        return true;
      } catch (caught: unknown) {
        toast.error(caught instanceof Error ? caught.message : 'فشلت المراجعة');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

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

      <div className="flex flex-wrap gap-2">
        {([
          { key: 'pending', label: 'قيد المراجعة' },
          { key: 'actioned', label: 'تم اتخاذ إجراء' },
          { key: 'dismissed', label: 'مرفوضة' },
          { key: 'all', label: 'الكل' },
        ] as const).map((filter) => (
          <button
            key={filter.key}
            type="button"
            onClick={() => setStatusFilter(filter.key)}
            className={`rounded-xl px-3.5 py-1.5 text-xs font-medium transition ${
              statusFilter === filter.key
                ? 'border border-wattar-500/40 bg-wattar-500/20 text-wattar-200'
                : 'border border-white/10 bg-dark-surface text-gray-300 hover:bg-dark-elevated'
            }`}
          >
            {filter.label}
          </button>
        ))}
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
                    <span
                      className={`rounded-lg px-2 py-0.5 text-[11px] font-bold ${
                        report.status === 'pending'
                          ? 'bg-amber-400/10 text-amber-300'
                          : report.status === 'actioned'
                            ? 'bg-emerald-400/10 text-emerald-300'
                            : 'bg-gray-400/10 text-gray-400'
                      }`}
                    >
                      {STATUS_LABELS[report.status]}
                    </span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-gray-400">{report.reason}</p>
                  {report.decision_note && (
                    <p className="mt-1 text-xs text-gray-500">ملاحظة المراجعة: {report.decision_note}</p>
                  )}
                  <p className="mt-2 text-[11px] text-gray-600">رقم البلاغ: {report.id}</p>
                </div>
                <div className="flex items-center justify-between gap-4 md:flex-col md:items-end">
                  <time className="text-xs text-gray-500" dateTime={report.created_at}>
                    {new Date(report.created_at).toLocaleString('ar', { dateStyle: 'medium', timeStyle: 'short' })}
                  </time>
                  <div className="flex items-center gap-2">
                    {report.reported && (
                      <Link
                        to={`/users?search=${encodeURIComponent(report.reported.id)}`}
                        className="rounded-lg border border-wattar-700/50 bg-wattar-500/10 px-3 py-1.5 text-xs font-medium text-wattar-200 transition hover:bg-wattar-500/20"
                      >
                        مراجعة الحساب
                      </Link>
                    )}
                    {report.status === 'pending' && report.reported && (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setReportModal({ report, decision: 'actioned' })}
                          className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-50"
                        >
                          <CheckCircle2 size={13} /> تأكيد وإجراء
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setReportModal({ report, decision: 'dismissed' })}
                          className="inline-flex items-center gap-1 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-bold text-red-300 transition hover:bg-red-500/20 disabled:opacity-50"
                        >
                          <XCircle size={13} /> رفض
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {reportModal && (
        <ReportDecisionModal
          report={reportModal.report}
          decision={reportModal.decision}
          busy={busy}
          onClose={() => {
            if (busy) return;
            setReportModal(null);
          }}
          onSubmit={async (penalty, duration, note) => {
            const ok = await reviewReport(reportModal.report, reportModal.decision, penalty, duration, note);
            if (ok) setReportModal(null);
          }}
        />
      )}
    </div>
  );
}

function ReportDecisionModal({
  report,
  decision,
  busy,
  onClose,
  onSubmit,
}: {
  report: UserReport;
  decision: 'actioned' | 'dismissed';
  busy: boolean;
  onClose: () => void;
  onSubmit: (penalty: string | null, durationMinutes: number | null, note: string) => Promise<void>;
}) {
  const [penaltyValue, setPenaltyValue] = useState('warning');
  const [duration, setDuration] = useState(1440);
  const [customDuration, setCustomDuration] = useState('');
  const [note, setNote] = useState('');
  const [useCustomDuration, setUseCustomDuration] = useState(false);
  const selectedPenalty = PENALTY_OPTIONS.find((option) => option.value === penaltyValue);
  const needsDuration = selectedPenalty?.needsDuration === true;
  const numericDuration = useCustomDuration ? Number(customDuration) : duration;
  const resolvedDuration = needsDuration ? numericDuration : null;
  const durationValid = !needsDuration
    || (Number.isFinite(numericDuration) && numericDuration >= 1 && numericDuration <= 43200);
  const canSubmit = !busy && durationValid && note.length <= 500;
  const actioning = decision === 'actioned';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-lg rounded-2xl border border-white/[0.08] bg-[#171a2c]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/[0.07] p-5">
          <div>
            <h2 className="text-lg font-semibold text-white">
              {actioning ? 'تأكيد البلاغ واتخاذ إجراء' : 'رفض البلاغ'}
            </h2>
            <p className="mt-1 text-xs text-gray-400">
              المُبلَّغ عنه: {displayUser(report.reported)} · السبب: {report.reason}
            </p>
          </div>
          <button onClick={onClose} disabled={busy} className="text-gray-400 hover:text-white disabled:opacity-50" aria-label="إغلاق">
            <X size={20} />
          </button>
        </div>

        <div className="max-h-[75vh] space-y-4 overflow-y-auto p-5">
          {actioning ? (
            <>
              <div>
                <p className="mb-2 text-sm font-medium text-gray-200">الإجراء على الحساب</p>
                <div className="space-y-2">
                  {PENALTY_OPTIONS.map((option) => {
                    const active = penaltyValue === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        disabled={busy}
                        onClick={() => setPenaltyValue(option.value)}
                        className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-right text-sm transition ${
                          active
                            ? 'border-wattar-400/50 bg-wattar-600/20 font-semibold text-white'
                            : 'border-white/[0.07] bg-white/[0.02] text-gray-300 hover:border-white/15'
                        }`}
                      >
                        <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${active ? 'border-wattar-300 bg-wattar-500' : 'border-gray-600'}`}>
                          {active ? <CheckCircle2 size={10} className="text-white" /> : null}
                        </span>
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {needsDuration ? (
                <div>
                  <p className="mb-2 text-sm font-medium text-gray-200">مدة العقوبة</p>
                  <Segmented
                    options={durationChoices}
                    value={useCustomDuration ? -1 : duration}
                    onChange={(value) => {
                      if (value === -1) {
                        setUseCustomDuration(true);
                        return;
                      }
                      setUseCustomDuration(false);
                      setDuration(Number(value));
                    }}
                    columns={5}
                  />
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setUseCustomDuration(true)}
                      className={`rounded-xl border px-3 py-2 text-xs transition ${
                        useCustomDuration
                          ? 'border-wattar-400/50 bg-wattar-600/20 text-white'
                          : 'border-white/[0.07] bg-white/[0.02] text-gray-400'
                      }`}
                    >
                      مدة مخصصة
                    </button>
                    <input
                      type="number"
                      min={1}
                      max={43200}
                      value={customDuration}
                      disabled={busy || !useCustomDuration}
                      onChange={(event) => setCustomDuration(event.target.value)}
                      placeholder="بالدقائق"
                      className="w-full rounded-xl border border-white/[0.08] bg-[#111424] px-3 py-2 text-sm text-white placeholder:text-gray-600 disabled:opacity-40"
                    />
                  </div>
                  {!durationValid ? (
                    <p className="mt-1 text-[11px] text-red-300">أدخل مدة بين 1 و43200 دقيقة.</p>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : (
            <div className="flex items-start gap-2 rounded-xl border border-red-500/25 bg-red-500/10 p-3 text-xs leading-6 text-red-200">
              <AlertTriangle size={16} className="mt-1 shrink-0" />
              سيُغلق البلاغ دون اتخاذ إجراء على الحساب. يمكنك إضافة ملاحظة توضّح سبب الرفض.
            </div>
          )}

          <label className="block">
            <span className="mb-1.5 block text-xs text-gray-400">{actioning ? 'ملاحظة المراجعة (اختياري)' : 'سبب الرفض (اختياري)'}</span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              maxLength={500}
              disabled={busy}
              placeholder="تظهر في سجل الإدارة"
              className="w-full resize-y rounded-xl border border-white/[0.08] bg-[#111424] px-3 py-2.5 text-sm text-white placeholder:text-gray-600 focus:border-wattar-400/60 focus:outline-none"
            />
          </label>

          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={onClose}
              disabled={busy}
              className="rounded-xl border border-white/[0.08] px-4 py-2 text-sm text-gray-300 hover:bg-white/[0.04] disabled:opacity-50"
            >
              إلغاء
            </button>
            <button
              onClick={() => {
                const penalty = actioning
                  ? (penaltyValue === 'none' ? null : penaltyValue)
                  : null;
                void onSubmit(penalty, resolvedDuration, note);
              }}
              disabled={!canSubmit}
              className={`flex min-w-32 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 ${
                actioning ? 'bg-emerald-700 hover:bg-emerald-600' : 'bg-red-700 hover:bg-red-600'
              }`}
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : actioning ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
              {actioning ? 'تأكيد الإجراء' : 'تأكيد الرفض'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
