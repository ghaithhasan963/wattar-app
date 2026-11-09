/**
 * Wattar Admin — صفحة المستخدمين
 * قائمة + بحث + إجراءات (حظر، ضبط RTP، force outcome)
 */
import { useEffect, useState } from 'react';
import { supabase, callFunction } from '@/lib/supabase';
import { Search, Settings, Shield, X, Check, Loader2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { useSearchParams } from 'react-router-dom';

interface UserRow {
  id: string;
  username: string;
  display_name: string | null;
  phone: string | null;
  balance_gold: number;
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
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null);
  const [statusUser, setStatusUser] = useState<UserRow | null>(null);
  const [statusTarget, setStatusTarget] = useState<'active' | 'suspended' | 'banned'>('suspended');
  const [statusReason, setStatusReason] = useState('');
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    load();
  }, [search]);

  const load = async () => {
    setLoading(true);
    let query = supabase
      .from('users')
      .select('id, username, display_name, phone, balance_gold, status, role, gender, profile_visibility, adult_confirmed_at, onboarding_completed_at, rtp_override, is_force_win, is_force_lose, created_at, last_seen_at')
      .order('created_at', { ascending: false })
      .limit(100);

    if (search) {
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(search)) {
        query = query.eq('id', search);
      } else {
        query = query.or(`username.ilike.%${search}%,display_name.ilike.%${search}%,phone.ilike.%${search}%`);
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
        reason: statusReason.trim() || undefined,
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
      await load();
    } catch (err: any) {
      toast.error(err instanceof Error ? err.message : 'تعذر تحديث حالة الحساب');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="space-y-6" dir="rtl">
      <div>
        <h1 className="text-2xl font-bold text-white">المستخدمون</h1>
        <p className="text-gray-400 mt-1">إدارة حسابات المستخدمين — RTP، forced outcomes، حظر</p>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="بحث باسم المستخدم أو الهاتف..."
          className="w-full rounded-lg bg-dark-surface border border-wattar-900 py-2.5 pr-10 pl-4 text-white placeholder-gray-500"
        />
      </div>

      <div className="bg-dark-surface rounded-xl border border-wattar-900 overflow-hidden overflow-x-auto">
        <table className="w-full">
          <thead className="bg-dark-elevated border-b border-wattar-900">
            <tr>
              <th className="text-right p-4 text-sm font-medium text-gray-400">المستخدم</th>
              <th className="text-right p-4 text-sm font-medium text-gray-400">الهاتف</th>
              <th className="text-right p-4 text-sm font-medium text-gray-400">الرصيد</th>
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
                <td className="p-4 text-sm font-semibold text-gold-500">{u.balance_gold}</td>
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
                    u.status === 'banned' ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                    'bg-gray-500/10 text-gray-400 border-gray-500/20'
                  }`}>
                    {u.status === 'active' ? 'نشط' : u.status === 'banned' ? 'محظور' : u.status}
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
                      title={u.status === 'active' ? 'إيقاف أو حظر مع تسجيل السبب' : 'إعادة التفعيل مع تسجيل الإجراء'}
                    >
                      <Shield size={16} />
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
          user={selectedUser}
          onClose={() => setSelectedUser(null)}
          onSetRtp={(rtp) => handleSetRtp(selectedUser.id, rtp)}
          onForceOutcome={(outcome) => handleForceOutcome(selectedUser.id, outcome)}
          processing={processing}
        />
      )}
      {statusUser && (
        <UserStatusModal
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
          }}
          onSubmit={() => void handleSetUserStatus()}
        />
      )}
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
  const needsReason = status !== 'active';
  const canSubmit = !processing && (!needsReason || reason.trim().length > 0) && reason.length <= 500;

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

          {needsReason ? (
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
          ) : (
            <p className="text-sm leading-6 text-gray-400">
              سيُعاد تفعيل الحساب، وسيُسجّل الإجراء وبيانات الحالة السابقة في سجل الإدارة.
            </p>
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
