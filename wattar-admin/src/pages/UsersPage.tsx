/**
 * Wattar Admin — صفحة المستخدمين
 * قائمة + بحث + إجراءات (حظر، ضبط RTP، force outcome)
 */
import { useEffect, useState } from 'react';
import { supabase, callFunction } from '@/lib/supabase';
import { Search, Settings, Shield, X, Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface UserRow {
  id: string;
  username: string;
  display_name: string | null;
  phone: string | null;
  balance_gold: number;
  status: string;
  role: string;
  rtp_override: number | null;
  is_force_win: boolean;
  is_force_lose: boolean;
  created_at: string;
  last_seen_at: string | null;
}

export function UsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    load();
  }, [search]);

  const load = async () => {
    setLoading(true);
    let query = supabase
      .from('users')
      .select('id, username, display_name, phone, balance_gold, status, role, rtp_override, is_force_win, is_force_lose, created_at, last_seen_at')
      .order('created_at', { ascending: false })
      .limit(100);

    if (search) {
      query = query.or(`username.ilike.%${search}%,display_name.ilike.%${search}%,phone.ilike.%${search}%`);
    }

    const { data } = await query;
    setUsers(data ?? []);
    setLoading(false);
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

  const handleToggleStatus = async (userId: string, currentStatus: string) => {
    setProcessing(true);
    try {
      const newStatus = currentStatus === 'active' ? 'banned' : 'active';
      await supabase.from('users').update({ status: newStatus }).eq('id', userId);
      toast.success(newStatus === 'banned' ? 'تم حظر المستخدم' : 'تم تفعيل المستخدم');
      await load();
    } catch (err: any) {
      toast.error(err.message);
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
                      onClick={() => handleToggleStatus(u.id, u.status)}
                      disabled={processing}
                      className={`rounded-lg p-2 ${u.status === 'active' ? 'text-red-400 hover:bg-red-500/10' : 'text-green-400 hover:bg-green-500/10'}`}
                      title={u.status === 'active' ? 'حظر' : 'تفعيل'}
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
