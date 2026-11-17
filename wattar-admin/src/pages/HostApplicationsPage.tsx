import { useCallback, useEffect, useState } from 'react';
import { BadgeCheck, Check, Loader2, RefreshCw, Search, ShieldOff, UserPlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { callFunction, supabase } from '@/lib/supabase';
import { ReasonPickerModal } from '@/components/ReasonPicker';

const approveNotes = [
  'بدون ملاحظة',
  'تم التحقق من الشروط واكتمال الملف.',
  'اعتماد بعد المقابلة وتقييم الأداء.',
  'توثيق استثنائي بقرار الإدارة.',
];

const rejectReasons = [
  'لم يكتمل تأكيد العمر أو الملف الشخصي',
  'معلومات الطلب غير واضحة أو ناقصة',
  'عدم استيفاء شروط برنامج المضيفات',
  'سابقة مخالفة لقواعد المجتمع',
  'طلب مكرر أو غير جدي',
];

const suspendHostReasons = [
  'مخالفة قواعد المحتوى داخل الغرف',
  'شكاوى متكررة من المستخدمين',
  'عدم الالتزام بجدول النشاط',
  'مراجعة إدارية مؤقتة',
];

const activateHostReasons = [
  'اكتمال التحقق المطلوب',
  'إعادة تفعيل بعد مراجعة الإدارة',
  'تسوية المخالفة السابقة',
];

interface HostApplication {
  id: string;
  user_id: string;
  application_text: string;
  status: string;
  created_at: string;
  user: { username: string; display_name: string | null; phone: string | null } | null;
}

interface HostAccount {
  id: string;
  username: string;
  display_name: string | null;
  status: string;
  approved_at: string | null;
  adult_confirmed_at: string | null;
  onboarding_completed_at: string | null;
}

interface HostCandidate {
  id: string;
  username: string;
  display_name: string | null;
  adult_confirmed_at: string | null;
  onboarding_completed_at: string | null;
}

export function HostApplicationsPage() {
  const [applications, setApplications] = useState<HostApplication[]>([]);
  const [hosts, setHosts] = useState<HostAccount[]>([]);
  const [newHost, setNewHost] = useState({
    username: '',
    display_name: '',
    email: '',
    phone: '',
    password: '',
  });
  const [creatingHost, setCreatingHost] = useState(false);
  const [usernameSearch, setUsernameSearch] = useState('');
  const [candidate, setCandidate] = useState<HostCandidate | null>(null);
  const [assignmentReason, setAssignmentReason] = useState('');
  const [hostActionId, setHostActionId] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hostPicker, setHostPicker] = useState<
    | { kind: 'approve'; application: HostApplication }
    | { kind: 'reject'; application: HostApplication }
    | { kind: 'host'; host: HostAccount; action: 'activate' | 'suspend' | 'assign' }
    | null
  >(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: queryError } = await supabase
        .from('host_applications')
        .select('id, user_id, application_text, status, created_at, user:users!host_applications_user_id_fkey(username, display_name, phone)')
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(200);
      if (queryError) throw queryError;
      const rows = (data ?? []) as Array<HostApplication & {
        user: HostApplication['user'] | HostApplication['user'][];
      }>;
      setApplications(rows.map((row) => ({
        ...row,
        user: Array.isArray(row.user) ? row.user[0] ?? null : row.user,
      })));
    } catch (caught: unknown) {
      const message = caught instanceof Error ? caught.message : 'تعذر تحميل طلبات التوثيق.';
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadHosts = useCallback(async () => {
    try {
      const { data, error: queryError } = await supabase
        .from('verified_hosts')
        .select('user_id, status, approved_at, user:users!verified_hosts_user_id_fkey(username, display_name, adult_confirmed_at, onboarding_completed_at)')
        .order('approved_at', { ascending: false })
        .limit(200);
      if (queryError) throw queryError;
      const rows = (data ?? []) as Array<{
        user_id: string;
        status: string;
        approved_at: string | null;
        user: {
          username: string;
          display_name: string | null;
          adult_confirmed_at: string | null;
          onboarding_completed_at: string | null;
        } | {
          username: string;
          display_name: string | null;
          adult_confirmed_at: string | null;
          onboarding_completed_at: string | null;
        }[] | null;
      }>;
      setHosts(rows.map((row) => {
        const user = Array.isArray(row.user) ? row.user[0] ?? null : row.user;
        return {
          id: row.user_id,
          username: user?.username ?? '—',
          display_name: user?.display_name ?? null,
          status: row.status,
          approved_at: row.approved_at,
          adult_confirmed_at: user?.adult_confirmed_at ?? null,
          onboarding_completed_at: user?.onboarding_completed_at ?? null,
        };
      }));
    } catch (caught: unknown) {
      toast.error(caught instanceof Error ? caught.message : 'تعذر تحميل الحسابات الموثقة.');
    }
  }, []);

  useEffect(() => {
    void load();
    void loadHosts();
  }, [load, loadHosts]);

  const findCandidate = async () => {
    const username = usernameSearch.trim();
    if (!/^[a-zA-Z0-9._-]{3,50}$/.test(username)) {
      toast.error('أدخل اسم مستخدم صحيحًا للبحث.');
      return;
    }
    setSearching(true);
    setCandidate(null);
    try {
      const { data, error: queryError } = await supabase
        .from('users')
        .select('id, username, display_name, adult_confirmed_at, onboarding_completed_at')
        .eq('username', username)
        .eq('role', 'user')
        .eq('status', 'active')
        .maybeSingle();
      if (queryError) throw queryError;
      if (!data) {
        toast.error('لم يُعثر على مستخدمة نشطة بهذا الاسم.');
        return;
      }
      setCandidate(data as HostCandidate);
    } catch (caught: unknown) {
      toast.error(caught instanceof Error ? caught.message : 'تعذر البحث عن الحساب.');
    } finally {
      setSearching(false);
    }
  };

  const createHostAccount = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (newHost.password.length < 8 || newHost.password.length > 128) {
      toast.error('كلمة المرور الأولية يجب أن تتكون من 8 إلى 128 حرفًا.');
      return;
    }

    setCreatingHost(true);
    try {
      await callFunction('admin-create-host', newHost);
      setNewHost({ username: '', display_name: '', email: '', phone: '', password: '' });
      toast.success('أُنشئ الحساب بحالة توثيق معلّقة. بعد إكمال الملف وتأكيد العمر يمكنك مراجعة توثيقه.');
      await loadHosts();
    } catch (caught: unknown) {
      toast.error(caught instanceof Error ? caught.message : 'تعذر إنشاء حساب التوثيق.');
    } finally {
      setCreatingHost(false);
    }
  };

  const manageHost = async (userId: string, action: 'assign' | 'suspend' | 'activate', reason: string) => {
    if (reason.trim().length < 3) {
      toast.error('اكتب سببًا واضحًا من 3 أحرف على الأقل.');
      return;
    }
    setHostActionId(userId);
    try {
      await callFunction('admin-manage-host', {
        user_id: userId,
        action,
        reason: reason.trim(),
      });
      toast.success(
        action === 'assign' ? 'تم توثيق الحساب.' :
          action === 'activate' ? 'تمت إعادة تفعيل التوثيق.' : 'تم إيقاف التوثيق.',
      );
      setCandidate(null);
      setUsernameSearch('');
      setAssignmentReason('');
      await Promise.all([load(), loadHosts()]);
    } catch (caught: unknown) {
      toast.error(caught instanceof Error ? caught.message : 'تعذر تنفيذ إجراء التوثيق.');
    } finally {
      setHostActionId(null);
    }
  };

  const review = async (application: HostApplication, approve: boolean, providedNote?: string) => {
    if (providedNote === undefined) {
      setHostPicker({ kind: approve ? 'approve' : 'reject', application });
      return;
    }
    const reviewNote = providedNote.trim();
    if (!approve && !reviewNote) return;

    setProcessingId(application.id);
    try {
      await callFunction('host-application-review', {
        application_id: application.id,
        approve,
        review_note: reviewNote.trim() || undefined,
      });
      toast.success(approve ? 'تم توثيق الحساب.' : 'تم رفض الطلب وتسجيل سبب المراجعة.');
      await load();
    } catch (caught: unknown) {
      toast.error(caught instanceof Error ? caught.message : 'تعذرت مراجعة الطلب.');
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div className="space-y-6" dir="rtl">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="rounded-xl bg-fuchsia-400/10 p-3 text-fuchsia-300"><BadgeCheck size={22} /></span>
          <div>
            <h1 className="text-2xl font-bold text-white">طلبات توثيق الحسابات</h1>
            <p className="mt-1 text-sm text-gray-400">إدارة التوثيق مستقلة عن برنامج المضيفات والرسائل المدفوعة.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-dark-surface px-4 py-2.5 text-sm text-gray-200 transition hover:bg-dark-elevated disabled:opacity-50"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          تحديث
        </button>
      </header>

      {error && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          <span>تعذر تحميل الطلبات: {error}</span>
          <button onClick={() => void load()} className="rounded-lg bg-red-500/15 px-3 py-2 font-medium hover:bg-red-500/25">إعادة المحاولة</button>
        </div>
      )}

      <section className="grid gap-5 xl:grid-cols-2">
        <form onSubmit={(event) => void createHostAccount(event)} className="rounded-2xl border border-white/[0.07] bg-dark-surface p-5">
          <div className="flex items-start gap-3">
            <span className="rounded-xl bg-fuchsia-400/10 p-2.5 text-fuchsia-300"><UserPlus size={19} /></span>
            <div>
              <h2 className="font-semibold text-white">إنشاء حساب لمراجعة التوثيق</h2>
              <p className="mt-1 text-xs leading-5 text-gray-400">
                يُنشأ حساب مستخدمة عادي؛ البريد للدخول بكلمة المرور والهاتف للدخول بعد تأكيده برمز SMS. على صاحبته إكمال الملف وتأكيد العمر قبل مراجعة التوثيق. هذا لا يضيفها لبرنامج المضيفات.
              </p>
            </div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <input
              value={newHost.username}
              onChange={(event) => setNewHost((current) => ({ ...current, username: event.target.value }))}
              placeholder="اسم المستخدم"
              minLength={3}
              maxLength={50}
              required
              autoComplete="off"
              className="rounded-lg border border-wattar-900 bg-dark-elevated px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:border-wattar-500 focus:outline-none"
            />
            <input
              value={newHost.display_name}
              onChange={(event) => setNewHost((current) => ({ ...current, display_name: event.target.value }))}
              placeholder="الاسم الظاهر"
              minLength={2}
              maxLength={80}
              required
              autoComplete="name"
              className="rounded-lg border border-wattar-900 bg-dark-elevated px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:border-wattar-500 focus:outline-none"
            />
            <input
              type="email"
              value={newHost.email}
              onChange={(event) => setNewHost((current) => ({ ...current, email: event.target.value }))}
              placeholder="البريد الإلكتروني (لتسجيل الدخول)"
              maxLength={254}
              required
              autoComplete="off"
              className="rounded-lg border border-wattar-900 bg-dark-elevated px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:border-wattar-500 focus:outline-none"
            />
            <input
              type="tel"
              value={newHost.phone}
              onChange={(event) => setNewHost((current) => ({ ...current, phone: event.target.value }))}
              placeholder="الهاتف الدولي لتأكيده برمز SMS"
              maxLength={20}
              required
              autoComplete="off"
              dir="ltr"
              className="rounded-lg border border-wattar-900 bg-dark-elevated px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:border-wattar-500 focus:outline-none"
            />
            <input
              type="password"
              value={newHost.password}
              onChange={(event) => setNewHost((current) => ({ ...current, password: event.target.value }))}
              placeholder="كلمة مرور أولية (8 أحرف على الأقل)"
              minLength={8}
              maxLength={128}
              required
              autoComplete="new-password"
              className="rounded-lg border border-wattar-900 bg-dark-elevated px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:border-wattar-500 focus:outline-none sm:col-span-2"
            />
          </div>
          <p className="mt-2 text-xs leading-5 text-gray-500">
            سلّم كلمة المرور الأولية عبر قناة آمنة؛ يمكن تغييرها لاحقًا من استعادة كلمة المرور.
          </p>
          <button
            type="submit"
            disabled={creatingHost}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-fuchsia-700 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {creatingHost ? <Loader2 size={15} className="animate-spin" /> : <UserPlus size={15} />}
            إنشاء الحساب
          </button>
        </form>

        <div className="rounded-2xl border border-white/[0.07] bg-dark-surface p-5">
          <div className="flex items-start gap-3">
            <span className="rounded-xl bg-fuchsia-400/10 p-2.5 text-fuchsia-300"><UserPlus size={19} /></span>
            <div>
              <h2 className="font-semibold text-white">مراجعة توثيق حساب موجود</h2>
              <p className="mt-1 text-xs leading-5 text-gray-400">
                ابحث عن حساب مستخدمة حقيقي؛ يجب أن يكون نشطًا ومكتمل الملف والتحقق العمري.
              </p>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <input
              value={usernameSearch}
              onChange={(event) => setUsernameSearch(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') void findCandidate(); }}
              placeholder="اسم المستخدم"
              maxLength={50}
              className="min-w-0 flex-1 rounded-lg border border-wattar-900 bg-dark-elevated px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:border-wattar-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void findCandidate()}
              disabled={searching}
              className="inline-flex items-center gap-2 rounded-lg bg-wattar-600 px-3 py-2.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {searching ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
              بحث
            </button>
          </div>
          {candidate && (
            <div className="mt-4 rounded-xl border border-wattar-500/25 bg-wattar-500/5 p-4">
              <p className="font-medium text-white">{candidate.display_name || candidate.username}</p>
              <p className="mt-1 text-xs text-gray-400">@{candidate.username}</p>
              <p className="mt-2 text-xs text-gray-400">
                {candidate.onboarding_completed_at ? 'الملف مكتمل' : 'الملف غير مكتمل'}
                {' · '}
                {candidate.adult_confirmed_at ? 'العمر مؤكد' : 'العمر غير مؤكد'}
              </p>
              <textarea
                value={assignmentReason}
                onChange={(event) => setAssignmentReason(event.target.value)}
                maxLength={500}
                rows={2}
                placeholder="سبب توثيق الحساب (إلزامي)"
                className="mt-3 w-full resize-y rounded-lg border border-wattar-900 bg-dark-elevated px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-wattar-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void manageHost(candidate.id, 'assign', assignmentReason)}
                disabled={hostActionId === candidate.id}
                className="mt-3 inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {hostActionId === candidate.id ? <Loader2 size={15} className="animate-spin" /> : <BadgeCheck size={15} />}
                توثيق الحساب وتسجيل السبب
              </button>
            </div>
          )}
        </div>

        <div className="overflow-hidden rounded-2xl border border-white/[0.07] bg-dark-surface">
          <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
            <div>
              <h2 className="font-semibold text-white">الحسابات الموثقة</h2>
              <p className="mt-1 text-xs text-gray-500">إيقاف التوثيق لا يحذف الحساب أو سجلاته.</p>
            </div>
            <button type="button" onClick={() => void loadHosts()} className="text-xs text-wattar-300 hover:text-white">تحديث</button>
          </div>
          <div className="max-h-80 divide-y divide-white/[0.06] overflow-y-auto">
            {hosts.length === 0 ? (
              <p className="p-8 text-center text-sm text-gray-500">لا توجد حسابات موثقة.</p>
            ) : hosts.map((host) => (
              <div key={host.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div>
                  <p className="text-sm font-medium text-white">{host.display_name || host.username}</p>
                  <p className="mt-1 text-xs text-gray-500">
                    @{host.username} · {
                      host.status === 'active'
                        ? 'نشطة'
                        : host.status === 'pending'
                          ? 'بانتظار إكمال الملف وتأكيد العمر'
                          : 'موقوفة'
                    }
                  </p>
                </div>
                <button
                  type="button"
                  disabled={
                    hostActionId === host.id
                    || (host.status === 'pending' && (!host.adult_confirmed_at || !host.onboarding_completed_at))
                  }
                  onClick={() => {
                    const action = host.status === 'active'
                      ? 'suspend'
                      : host.status === 'pending'
                        ? 'assign'
                        : 'activate';
                    if (action === 'assign') {
                      setHostPicker({ kind: 'host', host, action: 'assign' });
                      return;
                    }
                    setHostPicker({ kind: 'host', host, action });
                  }}
                  className={`inline-flex items-center gap-1 rounded-lg px-3 py-2 text-xs disabled:opacity-50 ${host.status === 'active' ? 'bg-amber-500/10 text-amber-300' : 'bg-green-500/10 text-green-300'}`}
                >
                  {hostActionId === host.id ? <Loader2 size={14} className="animate-spin" /> : <ShieldOff size={14} />}
                  {host.status === 'active' ? 'إيقاف' : host.status === 'pending' ? 'اعتماد' : 'تفعيل'}
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-white/[0.07] bg-dark-surface">
        {loading && applications.length === 0 ? (
          <p className="p-10 text-center text-sm text-gray-400">جاري تحميل الطلبات...</p>
        ) : applications.length === 0 ? (
          <p className="p-12 text-center text-sm text-gray-500">لا توجد طلبات معلّقة.</p>
        ) : (
          <div className="divide-y divide-white/[0.06]">
            {applications.map((application) => (
              <article key={application.id} className="space-y-4 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-white">{application.user?.display_name || application.user?.username || 'مستخدمة'}</p>
                    <p className="mt-1 text-xs text-gray-500">
                      @{application.user?.username ?? '—'} · {application.user?.phone ?? 'لا يوجد هاتف'}
                    </p>
                  </div>
                  <time className="text-xs text-gray-500" dateTime={application.created_at}>
                    {new Date(application.created_at).toLocaleString('ar')}
                  </time>
                </div>
                <p className="whitespace-pre-wrap break-words rounded-xl bg-dark-elevated p-4 text-sm leading-7 text-gray-300">
                  {application.application_text}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void review(application, true)}
                    disabled={processingId === application.id}
                    className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm text-white disabled:opacity-50"
                  >
                    {processingId === application.id ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                    توثيق الحساب
                  </button>
                  <button
                    type="button"
                    onClick={() => void review(application, false)}
                    disabled={processingId === application.id}
                    className="inline-flex items-center gap-2 rounded-lg bg-red-500/10 px-4 py-2 text-sm text-red-300 disabled:opacity-50"
                  >
                    <X size={16} />
                    رفض مع توضيح السبب
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {hostPicker && (
        <ReasonPickerModal
          title={
            hostPicker.kind === 'approve' ? 'اعتماد طلب التوثيق'
              : hostPicker.kind === 'reject' ? 'رفض طلب التوثيق'
                : hostPicker.action === 'suspend' ? 'إيقاف توثيق الحساب'
                  : hostPicker.action === 'assign' ? 'اعتماد التوثيق'
                    : 'إعادة تفعيل التوثيق'
          }
          subtitle={
            hostPicker.kind === 'host'
              ? `@${hostPicker.host.username}`
              : `@${hostPicker.application.user?.username ?? ''}`
          }
          description={
            hostPicker.kind === 'reject'
              ? 'سيُسجَّل السبب ويظهر للمتقدمة في إشعارها.'
              : hostPicker.kind === 'approve'
                ? 'اختر ملاحظة جاهزة أو اكتب واحدة — يمكنك أيضًا تركها بدون ملاحظة.'
                : 'اختر سببًا جاهزًا ليُسجَّل في سجل الإدارة.'
          }
          options={
            hostPicker.kind === 'approve' ? approveNotes
              : hostPicker.kind === 'reject' ? rejectReasons
                : hostPicker.action === 'suspend' ? suspendHostReasons
                  : activateHostReasons
          }
          confirmLabel={
            hostPicker.kind === 'approve' ? 'اعتماد التوثيق'
              : hostPicker.kind === 'reject' ? 'تأكيد الرفض'
                : hostPicker.action === 'suspend' ? 'تأكيد الإيقاف' : 'تأكيد التفعيل'
          }
          tone={hostPicker.kind === 'reject' || (hostPicker.kind === 'host' && hostPicker.action === 'suspend') ? 'danger' : 'info'}
          processing={processingId === (hostPicker.kind === 'host' ? hostPicker.host.id : hostPicker.application.id)}
          onClose={() => {
            if (processingId) return;
            setHostPicker(null);
          }}
          onSubmit={(reason) => {
            const picker = hostPicker;
            setHostPicker(null);
            if (picker.kind === 'approve') {
              void review(picker.application, true, reason === 'بدون ملاحظة' ? '' : reason);
            } else if (picker.kind === 'reject') {
              void review(picker.application, false, reason);
            } else {
              void manageHost(picker.host.id, picker.action, reason);
            }
          }}
        />
      )}
    </div>
  );
}
