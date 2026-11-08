/**
 * Wattar Admin — صفحة طلبات الشحن
 * عرض الطلبات + الموافقة/الرفض + عرض صورة الإثبات
 */
import { useEffect, useState } from 'react';
import { supabase, callFunction } from '@/lib/supabase';
import { Check, X, Eye, Loader2, Filter } from 'lucide-react';
import { toast } from 'sonner';

interface Deposit {
  id: string;
  amount_usd: number;
  amount_gold: number;
  method: string;
  external_ref: string;
  proof_url: string;
  sender_phone: string | null;
  sender_name: string | null;
  status: string;
  created_at: string;
  user: { username: string; display_name: string | null } | null;
  agent: { id: string; user_id: string } | null;
}

export function DepositsPage() {
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'pending' | 'all' | 'completed'>('pending');
  const [selectedDeposit, setSelectedDeposit] = useState<Deposit | null>(null);
  const [processing, setProcessing] = useState<string | null>(null);

  useEffect(() => {
    loadDeposits();
  }, [filter]);

  const loadDeposits = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('deposits')
        .select(`
          id, amount_usd, amount_gold, method, external_ref, proof_url,
          sender_phone, sender_name, status, created_at,
          user:users!deposits_user_id_fkey(username, display_name),
          agent:agents(id, user_id)
        `)
        .order('created_at', { ascending: false })
        .limit(50);

      if (filter !== 'all') query = query.eq('status', filter);
      const { data, error } = await query;
      if (error) throw error;

      const normalized = await Promise.all(((data ?? []) as any[]).map(async (deposit) => {
        const path = getDepositProofPath(deposit.proof_url);
        let proofUrl = deposit.proof_url;
        if (path) {
          const { data: signed, error: signingError } = await supabase.storage
            .from('deposit-proofs')
            .createSignedUrl(path, 10 * 60);
          if (signingError) throw signingError;
          proofUrl = signed.signedUrl;
        }
        return {
          ...deposit,
          proof_url: proofUrl,
          user: Array.isArray(deposit.user) ? deposit.user[0] ?? null : deposit.user,
          agent: Array.isArray(deposit.agent) ? deposit.agent[0] ?? null : deposit.agent,
        };
      }));
      setDeposits(normalized as Deposit[]);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'تعذر تحميل طلبات الشحن');
      setDeposits([]);
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async (depositId: string, action: 'approve' | 'reject', reason?: string) => {
    setProcessing(depositId);
    try {
      await callFunction('deposit-approve', { deposit_id: depositId, action, reason });
      toast.success(action === 'approve' ? 'تمت الموافقة على الشحن' : 'تم رفض الشحن');
      await loadDeposits();
      setSelectedDeposit(null);
    } catch (err: any) {
      toast.error(err.message ?? 'فشل تنفيذ العملية');
    } finally {
      setProcessing(null);
    }
  };

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">طلبات الشحن</h1>
          <p className="text-gray-400 mt-1">مراجعة وموافقة على طلبات شحن المستخدمين</p>
        </div>
        <div className="flex items-center gap-2 bg-dark-surface rounded-lg p-1 border border-wattar-900">
          {(['pending', 'all', 'completed'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                filter === f ? 'bg-wattar-600 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              {f === 'pending' ? 'معلّقة' : f === 'completed' ? 'مكتملة' : 'الكل'}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-dark-surface rounded-xl border border-wattar-900 overflow-hidden">
        <table className="w-full">
          <thead className="bg-dark-elevated border-b border-wattar-900">
            <tr>
              <th className="text-right p-4 text-sm font-medium text-gray-400">المستخدم</th>
              <th className="text-right p-4 text-sm font-medium text-gray-400">الطريقة</th>
              <th className="text-right p-4 text-sm font-medium text-gray-400">المبلغ</th>
              <th className="text-right p-4 text-sm font-medium text-gray-400">رقم العملية</th>
              <th className="text-right p-4 text-sm font-medium text-gray-400">الحالة</th>
              <th className="text-right p-4 text-sm font-medium text-gray-400">التاريخ</th>
              <th className="text-right p-4 text-sm font-medium text-gray-400">إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="text-center p-8 text-gray-400">جاري التحميل...</td></tr>
            ) : deposits.length === 0 ? (
              <tr><td colSpan={7} className="text-center p-8 text-gray-500">لا توجد طلبات</td></tr>
            ) : deposits.map(dep => (
              <tr key={dep.id} className="border-b border-wattar-900/50 hover:bg-dark-elevated/50">
                <td className="p-4">
                  <p className="text-sm font-medium text-white">{dep.user?.display_name ?? dep.user?.username}</p>
                </td>
                <td className="p-4 text-sm text-gray-300">{getMethodLabel(dep.method)}</td>
                <td className="p-4">
                  <p className="text-sm font-semibold text-gold-500">${dep.amount_usd}</p>
                  <p className="text-xs text-gray-500">{dep.amount_gold} Coins</p>
                </td>
                <td className="p-4 text-sm text-gray-300 font-mono">{dep.external_ref}</td>
                <td className="p-4">
                  <StatusBadge status={dep.status} />
                </td>
                <td className="p-4 text-sm text-gray-400">{new Date(dep.created_at).toLocaleString('ar-EG')}</td>
                <td className="p-4">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setSelectedDeposit(dep)}
                      className="rounded-lg p-2 text-blue-400 hover:bg-blue-500/10"
                      title="عرض التفاصيل"
                    >
                      <Eye size={16} />
                    </button>
                    {dep.status === 'pending' && (
                      <>
                        <button
                          onClick={() => handleAction(dep.id, 'approve')}
                          disabled={processing === dep.id}
                          className="rounded-lg p-2 text-green-400 hover:bg-green-500/10 disabled:opacity-50"
                          title="موافقة"
                        >
                          {processing === dep.id ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                        </button>
                        <button
                          onClick={() => {
                            const reason = prompt('سبب الرفض:');
                            if (reason) handleAction(dep.id, 'reject', reason);
                          }}
                          disabled={processing === dep.id}
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

      {/* Modal: تفاصيل الشحن */}
      {selectedDeposit && (
        <DepositModal
          deposit={selectedDeposit}
          onClose={() => setSelectedDeposit(null)}
          onApprove={() => handleAction(selectedDeposit.id, 'approve')}
          onReject={(reason) => handleAction(selectedDeposit.id, 'reject', reason)}
          processing={processing === selectedDeposit.id}
        />
      )}
    </div>
  );
}

function DepositModal({
  deposit,
  onClose,
  onApprove,
  onReject,
  processing,
}: {
  deposit: Deposit;
  onClose: () => void;
  onApprove: () => void;
  onReject: (reason: string) => void;
  processing: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-dark-surface rounded-xl border border-wattar-900 max-w-lg w-full max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-6 border-b border-wattar-900 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">تفاصيل طلب الشحن</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-gray-500 mb-1">المستخدم</p>
              <p className="text-sm text-white">{deposit.user?.display_name ?? deposit.user?.username}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">الطريقة</p>
              <p className="text-sm text-white">{getMethodLabel(deposit.method)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">المبلغ بالدولار</p>
              <p className="text-sm font-semibold text-gold-500">${deposit.amount_usd}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Coins المُقابلة</p>
              <p className="text-sm font-semibold text-white">{deposit.amount_gold}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">رقم العملية</p>
              <p className="text-sm text-white font-mono">{deposit.external_ref}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">هاتف المرسل</p>
              <p className="text-sm text-white">{deposit.sender_phone ?? '—'}</p>
            </div>
          </div>

          <div>
            <p className="text-xs text-gray-500 mb-2">صورة الإثبات</p>
            <div className="rounded-lg overflow-hidden border border-wattar-900 bg-dark-elevated">
              <img
                src={deposit.proof_url}
                alt="إثبات الشحن"
                className="w-full max-h-80 object-contain"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
            </div>
          </div>

          {deposit.status === 'pending' && (
            <div className="flex gap-3 pt-4">
              <button
                onClick={onApprove}
                disabled={processing}
                className="flex-1 rounded-lg bg-green-600 hover:bg-green-700 disabled:opacity-50 py-2.5 font-medium text-white"
              >
                {processing ? 'جاري المعالجة...' : 'موافقة وإضافة الرصيد'}
              </button>
              <button
                onClick={() => {
                  const reason = prompt('سبب الرفض:');
                  if (reason) onReject(reason);
                }}
                disabled={processing}
                className="flex-1 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 py-2.5 font-medium text-white"
              >
                رفض
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function getDepositProofPath(proofUrl: string | null): string | null {
  if (!proofUrl) return null;
  if (!/^https?:\/\//i.test(proofUrl)) return proofUrl;
  try {
    const url = new URL(proofUrl);
    const match = url.pathname.match(/\/storage\/v1\/object\/(?:public|sign)\/deposit-proofs\/(.+)$/);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

function getMethodLabel(method: string): string {
  const labels: Record<string, string> = {
    usdt: 'USDT',
    sham_cash: 'شام كاش',
    syriatel_cash: 'سيرياتيل كاش',
    agent: 'وكيل',
  };
  return labels[method] ?? method;
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    reviewing: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    approved: 'bg-green-500/10 text-green-400 border-green-500/20',
    completed: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    failed: 'bg-red-500/10 text-red-400 border-red-500/20',
    cancelled: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
    rejected: 'bg-red-500/10 text-red-400 border-red-500/20',
  };
  const labels: Record<string, string> = {
    pending: 'معلّق',
    reviewing: 'قيد المراجعة',
    approved: 'موافق عليه',
    completed: 'مكتمل',
    failed: 'فشل',
    cancelled: 'ملغى',
    rejected: 'مرفوض',
  };
  return (
    <span className={`inline-flex px-2 py-1 rounded-md text-xs font-medium border ${colors[status] ?? colors.pending}`}>
      {labels[status] ?? status}
    </span>
  );
}
