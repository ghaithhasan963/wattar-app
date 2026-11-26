/**
 * Wattar Admin — صفحة المستخدمين
 * قائمة + بحث + إجراءات (حظر، ضبط RTP، force outcome)
 */
import { useEffect, useState } from 'react';
import { supabase, callFunction } from '@/lib/supabase';
import { buildIlikeOr } from '@/lib/search';
import { Search, Settings, Shield, Archive, KeyRound, Trash2, X, Check, Loader2, AlertTriangle, Filter, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { useSearchParams } from 'react-router-dom';
import { useAuthStore } from '@/store/auth';
import { PageHeader, SelectField } from '@/components/ui';

interface UserRow {
  id: string;
  username: string;
  display_name: string | null;
  phone: string | null;
  balance_gold: number;
  balance_diamond: number;
  status: string;
  role: string;
  gender: string | null;
  profile_visibility: string | null;
  adult_confirmed_at: string | null;
  onboarding_completed_at: string | null;
  rtp_override: number | null;
  is_force_win: boolean;
  is_force_lose: boolean;
  created_at: string;
  last_seen_at: string | null;
}

export function UsersPage() {
  const [searchParams] = useSearchParams();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(() => searchParams.get('search') ?? '');
  const [statusFilter, setStatusFilter] = useState('all');
  const [roleFilter, setRoleFilter] = useState('all');
  const [ageFilter, setAgeFilter] = useState('all');
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null);
  const [statusUser, setStatusUser] = useState<UserRow | null>(null);
  const [statusTarget, setStatusTarget] = useState<'active' | 'suspended' | 'banned'>('suspended');
  const [statusReason, setStatusReason] = useState('');
  const [accountUser, setAccountUser] = useState<UserRow | null>(null);
  const [accountAction, setAccountAction] = useState<'archive' | 'delete' | 'reset'>('archive');
  const [processing, setProcessing] = useState(false);
  const currentAdminId = useAuthStore((state) => state.user?.id);

  useEffect(() => {
    load();
    // Filters are server-side so the admin sees exactly the chosen slice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusFilter, roleFilter, ageFilter]);

  const load = async () => {
    setLoading(true);
    let query = supabase
      .from('users')
      .select('id, username, display_name, phone, balance_gold, balance_diamond, status, role, gender, profile_visibility, adult_confirmed_at, onboarding_completed_at, rtp_override, is_force_win, is_force_lose, created_at, last_seen_at')
      .order('created_at', { ascending: false })
      .limit(100);

    if (statusFilter !== 'all') query = query.eq('status', statusFilter);
    if (roleFilter !== 'all') query = query.eq('role', roleFilter);
    if (ageFilter === 'confirmed') query = query.not('adult_confirmed_at', 'is', null);
    if (ageFilter === 'pending') query = query.is('adult_confirmed_at', null);

    if (search) {
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(search)) {
        query = query.eq('id', search);
      } else {
        const filter = buildIlikeOr(['username', 'display_name', 'phone'], search);
        if (filter) query = query.or(filter);
      }
    }

    try {
      const { data, error } = await query;
      if (error) throw error;
      setUsers(data ?? []);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'تعذر تحميل المستخدمين');
    } finally {
      setLoading(false);
    }
  };

  const handleSetRtp = async (userId: string, rtp: number | null) => {
    setProcessing(true);
    try {
      await callFunction('admin-set-rtp', { user_id: userId, rtp_override: rtp });
      toast.success(rtp === null ? 'تم إلغاء override RTP' : `تم ضبط RTP على ${rtp}%`);
      await load();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleForceOutcome = async (userId: string, outcome: 'win' | 'lose' | 'clear') => {
    setProcessing(true);
    try {
      await callFunction('admin-force-outcome', { user_id: userId, outcome });
      toast.success(outcome === 'clear' ? 'تم إلغاء forced outcome' : `تم ضبط النتيجة: ${outcome === 'win' ? 'فوز' : 'خسارة'}`);
      await load();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleSetUserStatus = async () => {
    if (!statusUser) return;
    setProcessing(true);
    try {
      await callFunction('admin-set-user-status', {
        user_id: statusUser.id,
        status: statusTarget,
        reason: statusReason.trim(),
      });
      toast.success(
        statusTarget === 'banned'
          ? 'تم الحظر الدائم وتسجيل الإجراء'
          : statusTarget === 'suspended'
            ? 'تم الإيقاف المؤقت وتسجيل الإجراء'
            : 'تمت إعادة التفعيل وتسجيل الإجراء',
      );
      setStatusUser(null);
      setStatusReason('');
      setStatusTarget('suspended');
      await load();
    } catch (err: any) {
      toast.error(err instanceof Error ? err.message : 'تعذر تحديث حالة الحساب');
    } finally {
      setProcessing(false);
    }
  };

  const handleAccountAction = async (action: 'archive' | 'delete' | 'reset', user: UserRow, reason: string, confirmation: string) => {
    setProcessing(true);
    try {
      if (action === 'reset') {
        await callFunction('admin-reset-user-password', { user_id: user.id, reason });
        toast.success('تم إرسال رابط استعادة كلمة المرور إلى بريد الحساب');
      } else {
        await callFunction('admin-delete-user', {
          action,
          user_id: user.id,
          reason,
          ...(action === 'delete' ? { confirmation } : {}),
        });
        toast.success(
          action === 'archive'
            ? 'تمت أرشفة الحساب وإيقافه مع الاحتفاظ بالسجلات المالية والتدقيقية'
            : 'تم حذف ملف الحساب ومصادقة الدخول بعد التحقق من خلوه من السجلات المرتبطة',
        );
      }
      setAccountUser(null);
      await load();
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'تعذر تنفيذ إجراء الحساب');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        title="المستخدمون"
        subtitle="إدارة الحسابات — الأرشفة الآمنة، استعادة كلمة المرور، وحذف مشروط بالسجلات المرتبطة."
        actions={(
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-gray-300">
            {loading ? 'جارٍ التحميل…' : `${users.length.toLocaleString()} حساب ظاهر`}
          </span>
        )}
      />

      <div className="rounded-2xl border border-white/[0.07] bg-[#171a2c] p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="relative block min-w-[240px] flex-1">
            <span className="mb-1.5 block text-sm font-medium text-gray-200">بحث بالاسم أو الهاتف أو رقم الحساب</span>
            <Search className="absolute right-3 top-[2.55rem] -translate-y-1/2 text-gray-500" size={17} />
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="اكتب اسم المستخدم أو رقم الهاتف…"
              className="w-full rounded-xl border border-white/[0.08] bg-[#111424] py-2.5 pr-10 pl-3 text-sm text-white outline-none transition placeholder:text-gray-600 focus:border-wattar-400/60"
            />
          </label>
          <div className="w-full sm:w-40">
            <SelectField
              label="الحالة"
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: 'all', label: 'كل الحالات' },
                { value: 'active', label: 'نشط' },
                { value: 'suspended', label: 'موقوف' },
                { value: 'banned', label: 'محظور' },
                { value: 'blacklisted', label: 'قائمة سوداء' },
              ]}
            />
          </div>
          <div className="w-full sm:w-40">
            <SelectField
              label="الدور"
              value={roleFilter}
              onChange={setRoleFilter}
              options={[
                { value: 'all', label: 'كل الأدوار' },
                { value: 'user', label: 'مستخدم' },
                { value: 'guest', label: 'زائر' },
                { value: 'agent', label: 'وكيل' },
                { value: 'support', label: 'دعم' },
                { value: 'admin', label: 'إدارة' },
                { value: 'super_admin', label: 'إدارة عليا' },
              ]}
            />
          </div>
          <div className="w-full sm:w-40">
            <SelectField
              label="تأكيد العمر"
              value={ageFilter}
              onChange={setAgeFilter}
              options={[
                { value: 'all', label: 'الكل' },
                { value: 'confirmed', label: 'مؤكَّد' },
                { value: 'pending', label: 'غير مؤكَّد' },
              ]}
            />
          </div>
          <button
            type="button"
            onClick={() => {
              setSearch('');
              setStatusFilter('all');
              setRoleFilter('all');
              setAgeFilter('all');
            }}
            className="inline-flex h-[42px] items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 text-xs text-gray-300 transition hover:bg-white/[0.06]"
          >
            <RotateCcw size={14} />
            تصفير الفلاتر
          </button>
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-gray-500">
          <Filter size={12} />
          تعرض القائمة أحدث 100 حساب مطابق للاختيارات — استخدم البحث للوصول إلى حساب محدد.
        </p>
      </div>

      <div className="bg-dark-surface rounded-xl border border-wattar-900 overflow-hidden overflow-x-auto">
        <table className="w-full">
          <thead className="bg-dark-elevated border-b border-wattar-900">
            <tr>
              <th className="text-right p-4 text-sm font-medium text-gray-400">المستخدم</th>
              <th className="text-right p-4 text-sm font-medium text-gray-400">الهاتف</th>
              <th className="text-right p-4 text-sm font-medium text-gray-400">العملات</th>
              <th className="text-right p-4 text-sm font-medium text-gray-400">RTP</th>
              <th className="text-right p-4 text-sm font-medium text-gray-400">الحالة</th>
              <th className="text-right p-4 text-sm font-medium text-gray-400">آخر ظهور</th>
              <th className="text-right p-4 text-sm font-medium text-gray-400">إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="text-center p-8 text-gray-400">جاري التحميل...</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={7} className="text-center p-8 text-gray-500">لا يوجد مستخدمون</td></tr>
            ) : users.map(u => (
              <tr key={u.id} className="border-b border-wattar-900/50 hover:bg-dark-elevated/50">
                <td className="p-4">
                  <p className="text-sm font-medium text-white">{u.display_name ?? u.username}</p>
                  <p className="text-xs text-gray-500">@{u.username}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {u.gender && <span className="rounded bg-dark-elevated px-1.5 py-0.5 text-[10px] text-gray-400">{u.gender === 'female' ? 'أنثى' : u.gender === 'male' ? 'ذكر' : 'أخرى'}</span>}
                    <span className="rounded bg-dark-elevated px-1.5 py-0.5 text-[10px] text-gray-400">
                      {u.profile_visibility === 'friends' ? 'الملف للأصدقاء' : 'الملف عام'}
                    </span>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] ${u.adult_confirmed_at ? 'bg-green-500/10 text-green-400' : 'bg-amber-500/10 text-amber-300'}`}>
                      {u.adult_confirmed_at ? 'العمر مؤكد' : 'العمر غير مؤكد'}
                    </span>
                    {!u.onboarding_completed_at && <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">ملف غير مكتمل</span>}
                  </div>
                </td>
                <td className="p-4 text-sm text-gray-300">{u.phone ?? '—'}</td>
                <td className="p-4 text-xs">
                  <div className="space-y-1">
                    <p className="text-gold-400">Coin: {Number(u.balance_gold).toLocaleString('ar')}</p>
                    <p className="text-teal-300">Diamond: {Number(u.balance_diamond).toLocaleString('ar')}</p>
                  </div>
                </td>
                <td className="p-4 text-sm text-gray-300">
                  {u.rtp_override === null ? (
                    <span className="text-gray-500">افتراضي</span>
                  ) : (
                    <span className="text-wattar-400 font-medium">{u.rtp_override}%</span>
                  )}
                  {u.is_force_win && <span className="ml-1 text-green-400 text-xs">فوز قادم</span>}
                  {u.is_force_lose && <span className="ml-1 text-red-400 text-xs">خسارة قادمة</span>}
                </td>
                <td className="p-4">
                  <span className={`inline-flex px-2 py-1 rounded-md text-xs font-medium border ${
                    u.status === 'active' ? 'bg-green-500/10 text-green-400 border-green-500/20' :
                    u.status === 'banned' || u.status === 'blacklisted' ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                    'bg-amber-500/10 text-amber-300 border-amber-500/20'
                  }`}>
                    {u.status === 'active' ? 'نشط' :
                      u.status === 'banned' ? 'محظور' :
                      u.status === 'suspended' ? 'موقوف' :
                      u.status === 'blacklisted' ? 'قائمة سوداء' : u.status}
                  </span>
                </td>
                <td className="p-4 text-sm text-gray-400">
                  {u.last_seen_at ? new Date(u.last_seen_at).toLocaleDateString('ar-EG') : '—'}
                </td>
                <td className="p-4">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setSelectedUser(u)}
                      className="rounded-lg p-2 text-wattar-400 hover:bg-wattar-500/10"
                      title="إعدادات اللعب"
                    >
                      <Settings size={16} />
                    </button>
                    <button
                      onClick={() => {
                        setStatusUser(u);
                        setStatusTarget(u.status === 'active' ? 'suspended' : 'active');
                        setStatusReason('');
                      }}
                      disabled={processing || !['user', 'guest'].includes(u.role)}
                      className={`rounded-lg p-2 ${u.status === 'active' ? 'text-red-400 hover:bg-red-500/10' : 'text-green-400 hover:bg-green-500/10'}`}
                      title={u.status === 'active' ? 'إيقاف مؤقت أو حظر دائم مع تسجيل السبب' : 'إعادة التفعيل مع تسجيل الإجراء'}
                    >
                      <Shield size={16} />
                    </button>
                    <button
                      onClick={() => {
                        setAccountUser(u);
                        setAccountAction('archive');
                      }}
                      disabled={processing || !['user', 'guest'].includes(u.role) || u.status === 'suspended' || u.id === currentAdminId}
                      className="rounded-lg p-2 text-amber-400 hover:bg-amber-500/10 disabled:opacity-40"
                      title="أرشفة/تعطيل الحساب مع الاحتفاظ بسجل المعاملات"
                    >
                      <Archive size={16} />
                    </button>
                    <button
                      onClick={() => {
                        setAccountUser(u);
                        setAccountAction('reset');
                      }}
                      disabled={processing || !['user', 'guest'].includes(u.role) || u.id === currentAdminId}
                      className="rounded-lg p-2 text-sky-400 hover:bg-sky-500/10 disabled:opacity-40"
                      title="إرسال رابط استعادة كلمة المرور"
                    >
                      <KeyRound size={16} />
                    </button>
                    <button
                      onClick={() => {
                        setAccountUser(u);
                        setAccountAction('delete');
                      }}
                      disabled={processing || !['user', 'guest'].includes(u.role) || u.id === currentAdminId}
                      className="rounded-lg p-2 text-red-400 hover:bg-red-500/10 disabled:opacity-40"
                      title="حذف نهائي مشروط بعدم وجود سجلات مرتبطة"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal: إعدادات اللعب */}
      {selectedUser && (
        <UserGameSettingsModal
          key={`game-${selectedUser.id}`}
          user={selectedUser}
          onClose={() => setSelectedUser(null)}
          onSetRtp={(rtp) => handleSetRtp(selectedUser.id, rtp)}
          onForceOutcome={(outcome) => handleForceOutcome(selectedUser.id, outcome)}
          processing={processing}
        />
      )}
      {statusUser && (
        <UserStatusModal
          key={`status-${statusUser.id}-${statusUser.status}`}
          user={statusUser}
          status={statusTarget}
          reason={statusReason}
          processing={processing}
          onStatusChange={setStatusTarget}
          onReasonChange={setStatusReason}
          onClose={() => {
            if (processing) return;
            setStatusUser(null);
            setStatusReason('');
            setStatusTarget('suspended');
          }}
          onSubmit={() => void handleSetUserStatus()}
        />
      )}
      {accountUser && (
        <AccountActionModal
          key={`account-${accountUser.id}-${accountAction}`}
          user={accountUser}
          action={accountAction}
          processing={processing}
          onClose={() => {
            if (!processing) setAccountUser(null);
          }}
          onSubmit={(reason, confirmation) => {
            void handleAccountAction(accountAction, accountUser, reason, confirmation);
          }}
        />
      )}
    </div>
  );
}

function AccountActionModal({
  user,
  action,
  processing,
  onClose,
  onSubmit,
}: {
  user: UserRow;
  action: 'archive' | 'delete' | 'reset';
  processing: boolean;
  onClose: () => void;
  onSubmit: (reason: string, confirmation: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const deleting = action === 'delete';
  const resetting = action === 'reset';
  const title = deleting ? 'حذف الحساب نهائيًا' : resetting ? 'إرسال رابط استعادة' : 'أرشفة الحساب وتعطيله';
  const canSubmit = !processing
    && reason.trim().length > 0
    && reason.length <= 500
    && (!deleting || confirmation === 'DELETE');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-action-title"
        className="w-full max-w-lg rounded-xl border border-wattar-900 bg-dark-surface"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-wattar-900 p-5">
          <div>
            <h2 id="account-action-title" className="text-lg font-semibold text-white">{title}</h2>
            <p className="mt-1 text-sm text-gray-400">@{user.username}</p>
          </div>
          <button onClick={onClose} disabled={processing} className="text-gray-400 disabled:opacity-50" aria-label="إغلاق">
            <X size={20} />
          </button>
        </div>
        <div className="space-y-4 p-5">
          {deleting ? (
            <div className="flex gap-2 rounded-lg border border-red-500/25 bg-red-500/10 p-3 text-sm leading-6 text-red-200">
              <AlertTriangle size={18} className="mt-1 shrink-0" />
              سيُحذف ملف المستخدم ومصادقة الدخول نهائيًا فقط إذا لم توجد أي سجلات مرتبطة. الحذف يُرفض عند وجود روابط بيانات، بما فيها السجلات المالية أو سجل المحاسبة؛ استخدم الأرشفة بدلًا من ذلك.
            </div>
          ) : resetting ? (
            <div className="rounded-lg border border-sky-500/25 bg-sky-500/10 p-3 text-sm leading-6 text-sky-100">
              سيرسل Supabase رابط استعادة آمنًا إلى بريد الحساب؛ لن تظهر كلمة المرور الحالية أو رابط سري في اللوحة. تُنهى جلسات Wattar المسجلة، لكن قد تبقى رموز مصادقة صادرة مسبقًا صالحة حتى انتهاء مدتها. استعادة كلمة المرور لا تعيد تفعيل الحساب الموقوف.
            </div>
          ) : (
            <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-sm leading-6 text-amber-100">
              سيُوقف الحساب ويُمنع من استخدام خدمات Wattar، مع الاحتفاظ بملف البيانات والرصيد والدفاتر وسجلات التدقيق دون حذف. يمكن إعادة تفعيله لاحقًا.
            </div>
          )}

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-300" htmlFor="account-action-reason">
              سبب الإجراء <span className="text-red-400">*</span>
            </label>
            <textarea
              id="account-action-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
              rows={3}
              disabled={processing}
              placeholder="اكتب سببًا واضحًا ليظهر في سجل الإدارة..."
              className="w-full resize-y rounded-lg border border-wattar-900 bg-dark-elevated px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:border-wattar-500 focus:outline-none"
            />
            <p className="mt-1 text-left text-xs text-gray-500">{reason.length}/500</p>
          </div>

          {deleting && (
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-300" htmlFor="account-delete-confirmation">
                اكتب DELETE للتأكيد
              </label>
              <input
                id="account-delete-confirmation"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                disabled={processing}
                className="w-full rounded-lg border border-red-500/30 bg-dark-elevated px-3 py-2.5 text-sm text-white"
                autoComplete="off"
              />
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={onClose}
              disabled={processing}
              className="rounded-lg border border-wattar-900 px-4 py-2 text-sm text-gray-300 hover:bg-dark-elevated disabled:opacity-50"
            >
              إلغاء
            </button>
            <button
              onClick={() => onSubmit(reason.trim(), confirmation)}
              disabled={!canSubmit}
              className={`flex min-w-32 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 ${
                deleting ? 'bg-red-700 hover:bg-red-600' : resetting ? 'bg-sky-700 hover:bg-sky-600' : 'bg-amber-700 hover:bg-amber-600'
              }`}
            >
              {processing ? <Loader2 size={16} className="animate-spin" /> : null}
              {deleting ? 'حذف نهائي' : resetting ? 'إرسال الرابط' : 'أرشفة وتعطيل'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function UserStatusModal({
  user,
  status,
  reason,
  processing,
  onStatusChange,
  onReasonChange,
  onClose,
  onSubmit,
}: {
  user: UserRow;
  status: 'active' | 'suspended' | 'banned';
  reason: string;
  processing: boolean;
  onStatusChange: (status: 'active' | 'suspended' | 'banned') => void;
  onReasonChange: (reason: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const canSubmit = !processing && reason.trim().length > 0 && reason.length <= 500;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-status-title"
        className="w-full max-w-lg rounded-xl border border-wattar-900 bg-dark-surface"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-wattar-900 p-5">
          <div>
            <h2 id="user-status-title" className="text-lg font-semibold text-white">إدارة حالة الحساب</h2>
            <p className="mt-1 text-sm text-gray-400">@{user.username}</p>
          </div>
          <button onClick={onClose} disabled={processing} className="text-gray-400 disabled:opacity-50" aria-label="إغلاق">
            <X size={20} />
          </button>
        </div>
        <div className="space-y-4 p-5">
          <label className="block text-sm font-medium text-gray-300" htmlFor="user-status">
            الإجراء
          </label>
          <select
            id="user-status"
            value={status}
            onChange={(event) => onStatusChange(event.target.value as 'active' | 'suspended' | 'banned')}
            disabled={processing}
            className="w-full rounded-lg border border-wattar-900 bg-dark-elevated px-3 py-2.5 text-sm text-white"
          >
            {user.status !== 'active' && <option value="active">إعادة التفعيل</option>}
            <option value="suspended">إيقاف مؤقت</option>
            <option value="banned">حظر دائم</option>
          </select>

          {status === 'banned' ? (
            <div className="flex gap-2 rounded-lg border border-red-500/25 bg-red-500/10 p-3 text-xs leading-5 text-red-200">
              <AlertTriangle size={17} className="mt-0.5 shrink-0" />
              الحظر دائم ولا يُرفع إلا بقرار إداري. تأكد من مراجعة الحالة والأدلة قبل المتابعة.
            </div>
          ) : null}

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-300" htmlFor="user-status-reason">
              سبب الإجراء <span className="text-red-400">*</span>
            </label>
            <textarea
              id="user-status-reason"
              value={reason}
              onChange={(event) => onReasonChange(event.target.value)}
              maxLength={500}
              rows={4}
              disabled={processing}
              placeholder="اكتب سببًا واضحًا ليظهر في سجل الإدارة..."
              className="w-full resize-y rounded-lg border border-wattar-900 bg-dark-elevated px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:border-wattar-500 focus:outline-none"
            />
            <p className="mt-1 text-left text-xs text-gray-500">{reason.length}/500</p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={onClose}
              disabled={processing}
              className="rounded-lg border border-wattar-900 px-4 py-2 text-sm text-gray-300 hover:bg-dark-elevated disabled:opacity-50"
            >
              إلغاء
            </button>
            <button
              onClick={onSubmit}
              disabled={!canSubmit}
              className={`flex min-w-32 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 ${
                status === 'active' ? 'bg-green-700 hover:bg-green-600' : status === 'banned' ? 'bg-red-700 hover:bg-red-600' : 'bg-amber-700 hover:bg-amber-600'
              }`}
            >
              {processing ? <Loader2 size={16} className="animate-spin" /> : null}
              {status === 'active' ? 'إعادة التفعيل' : status === 'banned' ? 'تأكيد الحظر الدائم' : 'إيقاف الحساب'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function UserGameSettingsModal({
  user,
  onClose,
  onSetRtp,
  onForceOutcome,
  processing,
}: {
  user: UserRow;
  onClose: () => void;
  onSetRtp: (rtp: number | null) => void;
  onForceOutcome: (outcome: 'win' | 'lose' | 'clear') => void;
  processing: boolean;
}) {
  const [rtpValue, setRtpValue] = useState<string>(user.rtp_override?.toString() ?? '');

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-dark-surface rounded-xl border border-wattar-900 max-w-md w-full" onClick={e => e.stopPropagation()}>
        <div className="p-6 border-b border-wattar-900 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">إعدادات اللعب — {user.username}</h2>
          <button onClick={onClose} className="text-gray-400"><X size={20} /></button>
        </div>

        <div className="p-6 space-y-6">
          {/* RTP */}
          <div>
            <label className="block text-sm text-gray-300 mb-2">RTP مخصص (%)</label>
            <p className="text-xs text-gray-500 mb-2">نسبة العائد للاعب. الافتراضي = 30%. اتركه فارغًا للإعداد الافتراضي.</p>
            <div className="flex gap-2">
              <input
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={rtpValue}
                onChange={(e) => setRtpValue(e.target.value)}
                placeholder="30"
                className="flex-1 rounded-lg bg-dark-elevated border border-wattar-900 px-3 py-2 text-white"
              />
              <button
                onClick={() => onSetRtp(rtpValue ? Number(rtpValue) : null)}
                disabled={processing}
                className="rounded-lg bg-wattar-600 hover:bg-wattar-700 px-4 py-2 text-white text-sm"
              >
                حفظ
              </button>
            </div>
          </div>

          {/* Forced Outcomes */}
          <div>
            <label className="block text-sm text-gray-300 mb-2">إجبار نتيجة الجولة القادمة</label>
            <p className="text-xs text-gray-500 mb-2">يؤثر على الجولة القادمة فقط ثم يُصفّر تلقائيًا.</p>
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => onForceOutcome('win')}
                disabled={processing}
                className="rounded-lg bg-green-600 hover:bg-green-700 py-2 text-white text-sm flex items-center justify-center gap-1"
              >
                <Check size={14} /> فوز
              </button>
              <button
                onClick={() => onForceOutcome('lose')}
                disabled={processing}
                className="rounded-lg bg-red-600 hover:bg-red-700 py-2 text-white text-sm flex items-center justify-center gap-1"
              >
                <X size={14} /> خسارة
              </button>
              <button
                onClick={() => onForceOutcome('clear')}
                disabled={processing}
                className="rounded-lg bg-gray-600 hover:bg-gray-700 py-2 text-white text-sm"
              >
                إلغاء
              </button>
            </div>
            {user.is_force_win && <p className="text-xs text-green-400 mt-2">✓ مُفعّل: فوز في الجولة القادمة</p>}
            {user.is_force_lose && <p className="text-xs text-red-400 mt-2">✓ مُفعّل: خسارة في الجولة القادمة</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
