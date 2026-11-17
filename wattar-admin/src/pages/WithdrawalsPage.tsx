/**
 * Wattar Admin — صفحة طلبات السحب
 * نفس بنية صفحة الشحن لكن للسحب — مع تأكيد الدفع خارجيًا
 */
import { useEffect, useMemo, useState } from 'react';
import { supabase, callFunction } from '@/lib/supabase';
import { Check, X, Eye, Loader2, Search, MessageCircleQuestion, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader, SelectField } from '@/components/ui';

const rejectReasons = [
  'بيانات المحفظة أو العنوان غير صحيحة',
  'الحساب غير مؤهل للسحب النقدي',
  'تم تجاوز الحد اليومي المسموح',
  'طلب مكرر أو مشبوه',
  'تعذر التحقق من هوية المستخدم',
];

const infoRequests = [
  'أرسل عنوان محفظة USDT صحيحًا مع تحديد الشبكة',
  'أرسل رقم هاتف صحيحًا لاستلام المبلغ',
  'أرسل صورة عن هويتك للتحقق',
  'أرسل تفاصيل طريقة الاستلام عبر الوكيل',
];

const failReasons = [
  'تعذر إرسال التحويل من المحفظة',
  'عنوان المحفظة رفض الاستلام',
  'خطأ في شبكة التحويل',
  'المبلغ لم يصل خلال المدة المحددة',
];

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
  const [filter, setFilter] = useState<string>('pending');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Withdrawal | null>(null);
  const [reasonModal, setReasonModal] = useState<{ withdrawal: Withdrawal; mode: 'reject' | 'request_info' | 'fail' } | null>(null);
  const [processing, setProcessing] = useState<string | null>(null);
  const [proofUrl, setProofUrl] = useState('');
  const [externalRef, setExternalRef] = useState('');

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const visibleWithdrawals = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return withdrawals;
    return withdrawals.filter((item) => {
      const haystack = [
        item.user?.display_name ?? '',
        item.user?.username ?? '',
        item.payout_details?.address ?? '',
        item.payout_details?.phone ?? '',
        String((item as any).external_ref ?? ''),
        item.id,
      ].join(' ').toLowerCase();
      return haystack.includes(query);
    });
  }, [search, withdrawals]);

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
      <PageHeader
        title="طلبات السحب"
        subtitle="معالجة طلبات السحب — تحويل خارجي ثم تأكيد الدفع. السحب متاح للمضيفات الموثقات والوكلاء فقط."
        actions={(
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-gray-300">
            {loading ? 'جارٍ التحميل…' : `${visibleWithdrawals.length.toLocaleString()} طلب ظاهر`}
          </span>
        )}
      />

      <div className="rounded-2xl border border-white/[0.07] bg-[#171a2c] p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-52">
            <SelectField
              label="حالة الطلب"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'pending', label: 'معلّقة (تحتاج إجراء)' },
                { value: 'reviewing', label: 'قيد المراجعة' },
                { value: 'processing', label: 'قيد التنفيذ' },
                { value: 'completed', label: 'مكتملة' },
                { value: 'rejected', label: 'مرفوضة' },
                { value: 'failed', label: 'فاشلة' },
                { value: 'all', label: 'كل الطلبات' },
              ]}
            />
          </div>
          <label className="relative block min-w-[240px] flex-1">
            <span className="mb-1.5 block text-sm font-medium text-gray-200">بحث</span>
            <Search className="absolute right-3 top-[2.55rem] -translate-y-1/2 text-gray-500" size={17} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="اسم المستخدم أو عنوان المحفظة أو الهاتف…"
              className="w-full rounded-xl border border-white/[0.08] bg-[#111424] py-2.5 pr-10 pl-3 text-sm text-white outline-none transition placeholder:text-gray-600 focus:border-wattar-400/60"
            />
          </label>
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
            ) : visibleWithdrawals.length === 0 ? (
              <tr><td colSpan={7} className="text-center p-8 text-gray-500">لا نتائج مطابقة للبحث</td></tr>
            ) : visibleWithdrawals.map(wd => (
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
                          onClick={() => setReasonModal({ withdrawal: wd, mode: 'request_info' })}
                          disabled={processing === wd.id}
                          className="rounded-lg p-2 text-amber-400 hover:bg-amber-500/10 disabled:opacity-50"
                          title="طلب معلومات إضافية"
                        >
                          <MessageCircleQuestion size={16} />
                        </button>
                        <button
                          onClick={() => setReasonModal({ withdrawal: wd, mode: 'reject' })}
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
                    const withdrawal = selected;
                    setSelected(null);
                    setReasonModal({ withdrawal, mode: 'reject' });
                  }}
                  disabled={processing === selected.id}
                  className="flex-1 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 py-2.5 font-medium text-white"
                >
                  رفض
                </button>
              </div>
              <button
                onClick={() => {
                  const withdrawal = selected;
                  setSelected(null);
                  setReasonModal({ withdrawal, mode: 'fail' });
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

      {reasonModal && (
        <WithdrawalReasonModal
          mode={reasonModal.mode}
          withdrawal={reasonModal.withdrawal}
          processing={processing === reasonModal.withdrawal.id}
          onClose={() => {
            if (processing) return;
            setReasonModal(null);
          }}
          onSubmit={(reason) => {
            const { withdrawal, mode } = reasonModal;
            setReasonModal(null);
            if (mode === 'reject') void handleAction(withdrawal.id, 'reject', reason);
            else if (mode === 'fail') void handleAction(withdrawal.id, 'fail', reason);
            else void handleAction(withdrawal.id, 'request_info', reason);
          }}
        />
      )}
    </div>
  );
}

function WithdrawalReasonModal({
  mode,
  withdrawal,
  processing,
  onClose,
  onSubmit,
}: {
  mode: 'reject' | 'request_info' | 'fail';
  withdrawal: Withdrawal;
  processing: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => void;
}) {
  const options = mode === 'reject' ? rejectReasons : mode === 'fail' ? failReasons : infoRequests;
  const [choice, setChoice] = useState(options[0]);
  const [custom, setCustom] = useState('');
  const [useCustom, setUseCustom] = useState(false);
  const reason = useCustom ? custom.trim() : choice;
  const canSubmit = Boolean(reason) && reason.length <= 500 && !processing;
  const title = mode === 'reject' ? 'رفض طلب السحب' : mode === 'fail' ? 'تسجيل فشل الدفع' : 'طلب معلومات إضافية';
  const tone = mode === 'request_info'
    ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
    : 'border-red-500/30 bg-red-500/10 text-red-200';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-lg rounded-2xl border border-white/[0.08] bg-[#171a2c]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/[0.07] p-5">
          <div>
            <h2 className="text-lg font-semibold text-white">{title}</h2>
            <p className="mt-1 text-xs text-gray-400">
              {withdrawal.user?.display_name ?? withdrawal.user?.username ?? 'مستخدم'} · صافي ${Number(withdrawal.net_usd).toFixed(2)} · {getMethodLabel(withdrawal.method)}
            </p>
          </div>
          <button onClick={onClose} disabled={processing} className="text-gray-400 hover:text-white disabled:opacity-50" aria-label="إغلاق">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div className={`flex items-start gap-2 rounded-xl border p-3 text-xs leading-6 ${tone}`}>
            <AlertTriangle size={16} className="mt-1 shrink-0" />
            {mode === 'fail'
              ? 'سيُعاد كامل الرصيد إلى المستخدم. اختر سببًا واضحًا ليظهر في إشعاره.'
              : mode === 'reject'
                ? 'سيُعاد الرصيد إلى المستخدم عند الرفض. اختر سببًا جاهزًا أو اكتب سببًا مخصصًا.'
                : 'اختر الرسالة الجاهزة — سيصل المستخدم إشعار يوضح ما ينقص طلبه.'}
          </div>

          <div className="max-h-64 space-y-2 overflow-y-auto pl-1">
            {options.map((option) => {
              const active = !useCustom && choice === option;
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    setChoice(option);
                    setUseCustom(false);
                  }}
                  className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-right text-sm transition ${
                    active
                      ? 'border-wattar-400/50 bg-wattar-600/20 font-semibold text-white'
                      : 'border-white/[0.07] bg-white/[0.02] text-gray-300 hover:border-white/15'
                  }`}
                >
                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${active ? 'border-wattar-300 bg-wattar-500' : 'border-gray-600'}`}>
                    {active ? <Check size={10} className="text-white" /> : null}
                  </span>
                  {option}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setUseCustom(true)}
              className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-right text-sm transition ${
                useCustom
                  ? 'border-wattar-400/50 bg-wattar-600/20 font-semibold text-white'
                  : 'border-dashed border-white/[0.12] bg-transparent text-gray-400 hover:border-white/20'
              }`}
            >
              <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${useCustom ? 'border-wattar-300 bg-wattar-500' : 'border-gray-600'}`}>
                {useCustom ? <Check size={10} className="text-white" /> : null}
              </span>
              سبب آخر (كتابة يدوية)
            </button>
          </div>

          {useCustom ? (
            <textarea
              value={custom}
              onChange={(event) => setCustom(event.target.value)}
              rows={3}
              maxLength={500}
              placeholder="اكتب السبب…"
              className="w-full resize-y rounded-xl border border-white/[0.08] bg-[#111424] px-3 py-2.5 text-sm text-white placeholder:text-gray-600 focus:border-wattar-400/60 focus:outline-none"
            />
          ) : null}

          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={onClose}
              disabled={processing}
              className="rounded-xl border border-white/[0.08] px-4 py-2 text-sm text-gray-300 hover:bg-white/[0.04] disabled:opacity-50"
            >
              إلغاء
            </button>
            <button
              onClick={() => onSubmit(reason)}
              disabled={!canSubmit}
              className={`flex min-w-32 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 ${
                mode === 'request_info' ? 'bg-amber-700 hover:bg-amber-600' : 'bg-red-700 hover:bg-red-600'
              }`}
            >
              {processing ? <Loader2 size={16} className="animate-spin" /> : null}
              {mode === 'request_info' ? 'إرسال الطلب' : mode === 'fail' ? 'تأكيد الفشل' : 'تأكيد الرفض'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function getMethodLabel(m: string): string {
  return ({ usdt: 'USDT', sham_cash: 'شام كاش', syriatel_cash: 'سيرياتيل كاش', agent: 'وكيل' } as Record<string, string>)[m] ?? m;
}
function getStatusLabels(s: string): string {
  return ({ pending: 'معلّق', reviewing: 'قيد المراجعة', approved: 'موافق', processing: 'قيد التنفيذ', completed: 'مكتمل', rejected: 'مرفوض', cancelled: 'ملغى', failed: 'فشل' } as Record<string, string>)[s] ?? s;
}
