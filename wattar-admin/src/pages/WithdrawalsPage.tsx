/**
 * Wattar Admin — صفحة طلبات السحب
 * نفس بنية صفحة الشحن لكن للسحب — مع تأكيد الدفع خارجيًا
 */
import { useEffect, useState } from 'react';
import { supabase, callFunction } from '@/lib/supabase';
import { Check, X, Eye, Loader2, Search, MessageCircleQuestion, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

interface Withdrawal {
  id: string;
  amount_usd: number;
  amount_diamond: number;
  net_usd: number;
  fee_usd: number;
  method: string;
  payout_details: Record<string, string>;
  status: string;
  created_at: string;
  user: { username: string; display_name: string | null } | null;
}

export function WithdrawalsPage() {
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'pending' | 'reviewing' | 'all' | 'completed'>('pending');
  const [selected, setSelected] = useState<Withdrawal | null>(null);
  const [processing, setProcessing] = useState<string | null>(null);
  const [proofUrl, setProofUrl] = useState('');
  const [externalRef, setExternalRef] = useState('');

  useEffect(() => {
    load();
  }, [filter]);

  const load = async () => {
    setLoading(true);
    let query = supabase
      .from('diamond_withdrawals')
      .select(`
        id, amount_usd, amount_diamond, net_usd, fee_usd, method,
        payout_details, status, created_at,
        user:users!diamond_withdrawals_user_id_fkey(username, display_name)
      `)
      .order('created_at', { ascending: false })
      .limit(50);
    if (filter !== 'all') query = query.eq('status', filter);
    const { data } = await query;
    setWithdrawals(((data ?? []) as any[]).map(w => ({
      ...w,
      user: Array.isArray(w.user) ? w.user[0] ?? null : w.user,
    })));
    setLoading(false);
  };

  const handleAction = async (id: string, action: 'approve' | 'reject' | 'review' | 'request_info' | 'processing' | 'fail', reason?: string) => {
    if (action === 'approve' && (!proofUrl || !externalRef)) {
      toast.error('يجب رفع صورة الإثبات وإدخال رقم العملية');
      return;
    }
    setProcessing(id);
    try {
      await callFunction('withdrawal-approve', {
        withdrawal_id: id,
        action,
        ...(action === 'approve' ? { proof_url: proofUrl, external_ref: externalRef } : {}),
        ...(reason ? { reason } : {}),
      });
      toast.success(
        action === 'approve' ? 'تم تنفيذ السحب'
          : action === 'reject' ? 'تم رفض السحب وإعادة الرصيد'
          : action === 'fail' ? 'تم تسجيل فشل الدفع وإعادة الرصيد'
          : action === 'request_info' ? 'طُلبت معلومات إضافية وأُشعر المستخدم'
          : action === 'processing' ? 'نُقل الطلب إلى قيد التنفيذ'
          : 'نُقل الطلب إلى المراجعة',
      );
      if (action === 'approve') {
        setProofUrl('');
        setExternalRef('');
      }
      setSelected(null);
      await load();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setProcessing(null);
    }
  };

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">طلبات السحب</h1>
          <p className="text-gray-400 mt-1">معالجة طلبات السحب — تحويل خارجي + تأكيد</p>
        </div>
        <div className="flex items-center gap-2 bg-dark-surface rounded-lg p-1 border border-wattar-900">
          {(['pending', 'reviewing', 'all', 'completed'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-md text-sm ${filter === f ? 'bg-wattar-600 text-white' : 'text-gray-400'}`}
            >
              {f === 'pending' ? 'معلّقة' : f === 'reviewing' ? 'قيد المراجعة' : f === 'completed' ? 'مكتملة' : 'الكل'}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-dark-surface rounded-xl border border-wattar-900 overflow-hidden overflow-x-auto">
        <table className="w-full">
          <thead className="bg-dark-elevated border-b border-wattar-900">
            <tr>
              <th className="text-right p-4 text-sm font-medium text-gray-400">المستخدم</th>
              <th className="text-right p-4 text-sm font-medium text-gray-400">الطريقة</th>
              <th className="text-right p-4 text-sm font-medium text-gray-400">المبلغ</th>
              <th className="text-right p-4 text-sm font-medium text-gray-400">الصافي</th>
              <th className="text-right p-4 text-sm font-medium text-gray-400">الحالة</th>
              <th className="text-right p-4 text-sm font-medium text-gray-400">التاريخ</th>
              <th className="text-right p-4 text-sm font-medium text-gray-400">إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="text-center p-8 text-gray-400">جاري التحميل...</td></tr>
            ) : withdrawals.length === 0 ? (
              <tr><td colSpan={7} className="text-center p-8 text-gray-500">لا توجد طلبات</td></tr>
            ) : withdrawals.map(wd => (
              <tr key={wd.id} className="border-b border-wattar-900/50 hover:bg-dark-elevated/50">
                <td className="p-4 text-sm font-medium text-white">{wd.user?.display_name ?? wd.user?.username}</td>
                <td className="p-4 text-sm text-gray-300">{getMethodLabel(wd.method)}</td>
                <td className="p-4">
                  <p className="text-sm text-white">${wd.amount_usd}</p>
                  <p className="text-xs text-gray-500">{Number(wd.amount_diamond).toLocaleString()} Diamonds</p>
                </td>
                <td className="p-4 text-sm font-semibold text-green-400">${wd.net_usd}</td>
                <td className="p-4">
                  <span className={`inline-flex px-2 py-1 rounded-md text-xs font-medium border ${
                    wd.status === 'completed' ? 'bg-green-500/10 text-green-400 border-green-500/20' :
                    wd.status === 'processing' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' :
                    wd.status === 'reviewing' ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20' :
                    wd.status === 'rejected' || wd.status === 'failed' ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                    'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
                  }`}>
                    {getStatusLabels(wd.status)}
                  </span>
                </td>
                <td className="p-4 text-sm text-gray-400">{new Date(wd.created_at).toLocaleString('ar-EG')}</td>
                <td className="p-4">
                  <div className="flex items-center gap-2">
                    {['pending', 'reviewing', 'processing'].includes(wd.status) && (
                      <>
                        {wd.status === 'pending' && (
                          <button
                            onClick={() => handleAction(wd.id, 'review')}
                            disabled={processing === wd.id}
                            className="rounded-lg p-2 text-blue-400 hover:bg-blue-500/10 disabled:opacity-50"
                            title="نقل إلى المراجعة"
                          >
                            <Search size={16} />
                          </button>
                        )}
                        <button
                          onClick={() => setSelected(wd)}
                          className="rounded-lg p-2 text-blue-400 hover:bg-blue-500/10"
                          title="معالجة"
                        >
                          <Eye size={16} />
                        </button>
                        <button
                          onClick={() => {
                            const r = prompt('ما المعلومات المطلوبة من المستخدم؟');
                            if (r) handleAction(wd.id, 'request_info', r);
                          }}
                          disabled={processing === wd.id}
                          className="rounded-lg p-2 text-amber-400 hover:bg-amber-500/10 disabled:opacity-50"
                          title="طلب معلومات إضافية"
                        >
                          <MessageCircleQuestion size={16} />
                        </button>
                        <button
                          onClick={() => {
                            const r = prompt('سبب الرفض:');
                            if (r) handleAction(wd.id, 'reject', r);
                          }}
                          disabled={processing === wd.id}
                          className="rounded-lg p-2 text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                          title="رفض"
                        >
                          <X size={16} />
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal: معالجة السحب */}
      {selected && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setSelected(null)}>
          <div className="bg-dark-surface rounded-xl border border-wattar-900 max-w-lg w-full" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-wattar-900">
              <h2 className="text-lg font-semibold text-white">معالجة طلب السحب</h2>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-xs text-gray-500">المستخدم</p>
                  <p className="text-white">{selected.user?.display_name ?? selected.user?.username}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">الطريقة</p>
                  <p className="text-white">{getMethodLabel(selected.method)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">المبلغ الصافي للمستخدم</p>
                  <p className="text-green-400 font-semibold">${selected.net_usd}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">الرسوم</p>
                  <p className="text-white">${selected.fee_usd}</p>
                </div>
                {selected.payout_details?.address && (
                  <div className="col-span-2">
                    <p className="text-xs text-gray-500">عنوان USDT</p>
                    <p className="text-white font-mono text-xs break-all">{selected.payout_details.address}</p>
                  </div>
                )}
                {selected.payout_details?.network && (
                  <div>
                    <p className="text-xs text-gray-500">الشبكة</p>
                    <p className="text-white">{selected.payout_details.network}</p>
                  </div>
                )}
                {selected.payout_details?.phone && (
                  <div>
                    <p className="text-xs text-gray-500">رقم الاستلام</p>
                    <p className="text-white font-mono">{selected.payout_details.phone}</p>
                  </div>
                )}
              </div>

              <div className="border-t border-wattar-900 pt-4 space-y-3">
                <p className="text-sm text-gray-300">بعد دفع المبلغ للمستخدم خارجيًا، أدخل مرجع العملية ورابط الإثبات:</p>
                <input
                  type="text"
                  value={externalRef}
                  onChange={e => setExternalRef(e.target.value)}
                  placeholder="رقم العملية الخارجية"
                  className="w-full rounded-lg bg-dark-elevated border border-wattar-900 px-3 py-2 text-white text-sm"
                />
                <input
                  type="text"
                  value={proofUrl}
                  onChange={e => setProofUrl(e.target.value)}
                  placeholder="رابط صورة الإثبات (URL)"
                  className="w-full rounded-lg bg-dark-elevated border border-wattar-900 px-3 py-2 text-white text-sm"
                />
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => handleAction(selected.id, 'approve')}
                  disabled={processing === selected.id}
                  className="flex-1 rounded-lg bg-green-600 hover:bg-green-700 disabled:opacity-50 py-2.5 font-medium text-white"
                >
                  {processing === selected.id ? 'جاري...' : 'تأكيد الدفع'}
                </button>
                {selected.status !== 'processing' && (
                  <button
                    onClick={() => handleAction(selected.id, 'processing')}
                    disabled={processing === selected.id}
                    className="flex-1 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 py-2.5 font-medium text-white"
                  >
                    بدء التنفيذ
                  </button>
                )}
                <button
                  onClick={() => {
                    const r = prompt('سبب الرفض:');
                    if (r) handleAction(selected.id, 'reject', r);
                  }}
                  disabled={processing === selected.id}
                  className="flex-1 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 py-2.5 font-medium text-white"
                >
                  رفض
                </button>
              </div>
              <button
                onClick={() => {
                  const r = prompt('سبب فشل الدفع (سيُعاد الرصيد للمستخدم):');
                  if (r) handleAction(selected.id, 'fail', r);
                }}
                disabled={processing === selected.id}
                className="w-full rounded-lg border border-red-500/30 text-red-300 hover:bg-red-500/10 disabled:opacity-50 py-2.5 text-sm font-medium flex items-center justify-center gap-2"
              >
                <AlertTriangle size={16} />
                فشل الدفع (إعادة الرصيد)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function getMethodLabel(m: string): string {
  return ({ usdt: 'USDT', sham_cash: 'شام كاش', syriatel_cash: 'سيرياتيل كاش', agent: 'وكيل' } as Record<string, string>)[m] ?? m;
}
function getStatusLabels(s: string): string {
  return ({ pending: 'معلّق', reviewing: 'قيد المراجعة', approved: 'موافق', processing: 'قيد التنفيذ', completed: 'مكتمل', rejected: 'مرفوض', cancelled: 'ملغى', failed: 'فشل' } as Record<string, string>)[s] ?? s;
}
