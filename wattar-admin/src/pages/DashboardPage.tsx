import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  ClipboardList,
  Clock3,
  Mic,
  RefreshCw,
  ShieldAlert,
  Users,
  UserCheck,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';

interface DashboardStats {
  totalUsers: number;
  activeUsers: number;
  activeAgents: number;
  pendingDeposits: number;
  pendingWithdrawals: number;
  liveRooms: number;
  reportCount: number;
}

interface ActivityRow {
  id: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  created_at: string;
  admin: { username: string; display_name: string | null } | null;
}

interface ReportRow {
  id: string;
  reason: string;
  created_at: string;
  reporter: { username: string; display_name: string | null } | null;
  reported: { username: string; display_name: string | null } | null;
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
  force_win: 'ضبط نتيجة لعبة',
  force_lose: 'ضبط نتيجة لعبة',
  adjust_balance: 'تعديل رصيد',
  set_rtp: 'تعديل إعداد لعبة',
  create_agent: 'إنشاء وكيل',
  credit_agent: 'تعديل مخزون وكيل',
};

function assertQuery<T>(result: { data: T | null; error: { message: string } | null }): T | null {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('ar', { dateStyle: 'medium', timeStyle: 'short' });
}

export function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    const activeSince = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    try {
      const results = await Promise.all([
        supabase.from('users').select('id', { count: 'exact', head: true }).eq('role', 'user'),
        supabase.from('users').select('id', { count: 'exact', head: true }).eq('role', 'user').gte('last_seen_at', activeSince),
        supabase.from('agents').select('id', { count: 'exact', head: true }).eq('status', 'active'),
        supabase.from('deposits').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('withdrawals').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('rooms').select('id', { count: 'exact', head: true }).eq('status', 'live'),
        supabase.from('user_reports').select('id', { count: 'exact', head: true }),
        supabase.from('admin_audit_log')
          .select('id, action, target_type, target_id, created_at, admin:users!admin_audit_log_admin_id_fkey(username, display_name)')
          .order('created_at', { ascending: false })
          .limit(6),
        supabase.from('user_reports')
          .select('id, reason, created_at, reporter:users!user_reports_reporter_id_fkey(username, display_name), reported:users!user_reports_reported_id_fkey(username, display_name)')
          .order('created_at', { ascending: false })
          .limit(5),
      ]);

      const [users, activeUsers, agents, deposits, withdrawals, rooms, reportsCount, auditRows, reportRows] = results;
      assertQuery(users);
      assertQuery(activeUsers);
      assertQuery(agents);
      assertQuery(deposits);
      assertQuery(withdrawals);
      assertQuery(rooms);
      assertQuery(reportsCount);

      const auditData = assertQuery(auditRows) ?? [];
      const reportData = assertQuery(reportRows) ?? [];
      setStats({
        totalUsers: users.count ?? 0,
        activeUsers: activeUsers.count ?? 0,
        activeAgents: agents.count ?? 0,
        pendingDeposits: deposits.count ?? 0,
        pendingWithdrawals: withdrawals.count ?? 0,
        liveRooms: rooms.count ?? 0,
        reportCount: reportsCount.count ?? 0,
      });
      setActivity((auditData as Array<ActivityRow & { admin: ActivityRow['admin'] | ActivityRow['admin'][] }>).map((row) => ({
        ...row,
        admin: Array.isArray(row.admin) ? row.admin[0] ?? null : row.admin,
      })));
      setReports((reportData as Array<ReportRow & {
        reporter: ReportRow['reporter'] | ReportRow['reporter'][];
        reported: ReportRow['reported'] | ReportRow['reported'][];
      }>).map((row) => ({
        ...row,
        reporter: Array.isArray(row.reporter) ? row.reporter[0] ?? null : row.reporter,
        reported: Array.isArray(row.reported) ? row.reported[0] ?? null : row.reported,
      })));
      setUpdatedAt(new Date());
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'تعذر تحميل بيانات لوحة الإدارة.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const metricCards = [
    { label: 'المستخدمون', value: stats?.totalUsers, detail: `${stats ? stats.activeUsers.toLocaleString('ar') : '—'} نشط خلال 24 ساعة`, icon: Users, tone: 'violet', to: '/users' },
    { label: 'شحن بانتظار المراجعة', value: stats?.pendingDeposits, detail: 'طلبات تحتاج إلى مراجعة', icon: ArrowDownToLine, tone: 'emerald', to: '/deposits' },
    { label: 'سحب بانتظار المراجعة', value: stats?.pendingWithdrawals, detail: 'طلبات تحتاج إلى مراجعة', icon: ArrowUpFromLine, tone: 'amber', to: '/withdrawals' },
    { label: 'الغرف المباشرة', value: stats?.liveRooms, detail: 'غرف مفتوحة الآن', icon: Mic, tone: 'blue', to: '/rooms' },
    { label: 'الوكلاء النشطون', value: stats?.activeAgents, detail: 'حسابات الوكلاء الفعّالة', icon: UserCheck, tone: 'blue', to: '/agents' },
    { label: 'بلاغات المستخدمين', value: stats?.reportCount, detail: 'إجمالي البلاغات الواردة', icon: ShieldAlert, tone: 'rose', to: '/reports' },
  ];

  return (
    <div className="space-y-7" dir="rtl">
      <section className="relative overflow-hidden rounded-2xl border border-wattar-800/70 bg-gradient-to-l from-[#25204a] via-[#1c2038] to-[#171a2d] p-6 sm:p-8">
        <div className="pointer-events-none absolute -left-12 -top-20 h-56 w-56 rounded-full bg-wattar-500/10 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="mb-2 text-sm font-medium text-wattar-300">مركز إدارة وتر</p>
            <h1 className="text-2xl font-bold text-white sm:text-3xl">مرحبًا بك في لوحة المتابعة</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-300">
              راقب الحسابات والعمليات المالية والغرف والبلاغات، وتابع سجل إجراءات فريق الإدارة من مكان واحد.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {updatedAt && (
              <span className="hidden text-xs text-gray-400 sm:inline">
                آخر تحديث {updatedAt.toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            <button
              type="button"
              onClick={() => void loadDashboard()}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-white/10 disabled:opacity-50"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              تحديث البيانات
            </button>
          </div>
        </div>
      </section>

      {error && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          <span>تعذر تحميل بيانات المتابعة: {error}</span>
          <button onClick={() => void loadDashboard()} className="rounded-lg bg-red-500/15 px-3 py-2 font-medium hover:bg-red-500/25">
            إعادة المحاولة
          </button>
        </div>
      )}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-white">مؤشرات التشغيل</h2>
            <p className="mt-1 text-xs text-gray-500">أرقام مباشرة لمتابعة المنصة بسرعة</p>
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs text-gray-400">
            <span className={`h-2 w-2 rounded-full ${error ? 'bg-red-400' : 'bg-emerald-400'}`} />
            {error ? 'تعذر الاتصال بالبيانات' : 'بيانات مباشرة'}
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {metricCards.map((card) => {
            const Icon = card.icon;
            const content = (
              <div className="h-full rounded-2xl border border-white/[0.07] bg-dark-surface p-5 transition hover:border-wattar-700/70 hover:bg-dark-elevated">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm text-gray-400">{card.label}</p>
                    <p className="mt-3 text-3xl font-bold tabular-nums text-white">
                      {stats === null ? '—' : (card.value ?? 0).toLocaleString('ar')}
                    </p>
                    <p className="mt-2 text-xs text-gray-500">{card.detail}</p>
                  </div>
                  <span className={`rounded-xl p-3 ${
                    card.tone === 'emerald' ? 'bg-emerald-400/10 text-emerald-300' :
                    card.tone === 'amber' ? 'bg-amber-400/10 text-amber-300' :
                    card.tone === 'rose' ? 'bg-rose-400/10 text-rose-300' :
                    card.tone === 'blue' ? 'bg-sky-400/10 text-sky-300' :
                    'bg-violet-400/10 text-violet-300'
                  }`}>
                    <Icon size={20} />
                  </span>
                </div>
              </div>
            );
            return card.to ? <Link key={card.label} to={card.to}>{content}</Link> : <div key={card.label}>{content}</div>;
          })}
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <div className="overflow-hidden rounded-2xl border border-white/[0.07] bg-dark-surface">
          <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
            <div className="flex items-center gap-2">
              <ShieldAlert size={18} className="text-rose-300" />
              <h2 className="font-semibold text-white">أحدث بلاغات المستخدمين</h2>
            </div>
            <Link to="/reports" className="text-xs font-medium text-wattar-300 hover:text-wattar-200">عرض الكل</Link>
          </div>
          <div className="divide-y divide-white/[0.05]">
            {loading && reports.length === 0 ? (
              <p className="p-6 text-center text-sm text-gray-500">جاري تحميل البلاغات...</p>
            ) : reports.length === 0 ? (
              <div className="p-8 text-center">
                <ShieldAlert size={22} className="mx-auto mb-2 text-gray-600" />
                <p className="text-sm text-gray-400">لا توجد بلاغات مسجّلة</p>
              </div>
            ) : reports.map((report) => (
              <div key={report.id} className="px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-gray-300">
                    <span className="text-gray-500">من</span> {report.reporter?.display_name || report.reporter?.username || 'مستخدم'}
                    <span className="mx-2 text-gray-600">←</span>
                    <span className="text-gray-500">ضد</span> {report.reported?.display_name || report.reported?.username || 'مستخدم'}
                  </p>
                  <span className="text-[11px] text-gray-500">{formatDate(report.created_at)}</span>
                </div>
                <p className="mt-2 line-clamp-2 text-sm leading-6 text-gray-400">{report.reason}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-white/[0.07] bg-dark-surface">
          <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
            <div className="flex items-center gap-2">
              <ClipboardList size={18} className="text-wattar-300" />
              <h2 className="font-semibold text-white">سجل إجراءات الإدارة</h2>
            </div>
            <Link to="/audit" className="text-xs font-medium text-wattar-300 hover:text-wattar-200">السجل الكامل</Link>
          </div>
          <div className="divide-y divide-white/[0.05]">
            {loading && activity.length === 0 ? (
              <p className="p-6 text-center text-sm text-gray-500">جاري تحميل السجل...</p>
            ) : activity.length === 0 ? (
              <div className="p-8 text-center">
                <Clock3 size={22} className="mx-auto mb-2 text-gray-600" />
                <p className="text-sm text-gray-400">لا توجد إجراءات مسجّلة بعد</p>
              </div>
            ) : activity.map((row) => (
              <div key={row.id} className="flex items-start justify-between gap-4 px-5 py-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-200">{actionLabels[row.action] ?? row.action}</p>
                  <p className="mt-1 truncate text-xs text-gray-500">
                    {row.admin?.display_name || row.admin?.username || 'مسؤول'} · {row.target_type || 'إجراء عام'}
                    {row.target_id ? ` · ${row.target_id.slice(0, 8)}` : ''}
                  </p>
                </div>
                <span className="shrink-0 text-[11px] text-gray-500">{formatDate(row.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="rounded-xl border border-amber-400/15 bg-amber-400/[0.04] px-4 py-3 text-xs leading-5 text-amber-100/70">
        ملاحظة مهمة: توثيق الهوية بصورة الوثيقة يحتاج ربط مزوّد KYC وحسابًا مفعّلًا؛ لذلك لا تعرض اللوحة حالة تحقق هوية غير موجودة في النظام.
      </div>
    </div>
  );
}
