/**
 * Wattar Admin — صفحة طلبات الشحن
 * عرض الطلبات + الموافقة/الرفض + عرض صورة الإثبات
 */
import { useEffect, useState } from 'react';
import { supabase, callFunction } from '@/lib/supabase';
import { Check, X, Eye, Loader2, Search, MessageCircleQuestion, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader, SelectField } from '@/components/ui';

const rejectReasons = [
  'لم تصل الحوالة إلى حسابنا',
  'المبلغ المُحوَّل لا يطابق المبلغ المطلوب',
  'صورة الإثبات غير واضحة أو غير مقروءة',
  'رقم العملية مستخدم سابقًا في طلب آخر',
  'بيانات المرسل غير مطابقة',
  'وسيلة الدفع غير مدعومة',
];

const infoRequests = [
  'أرسل صورة إثبات أوضح تتضمن رقم العملية والمبلغ',
  'أرسل رقم العملية الصحيح من تطبيق الدفع',
  'أرسل اسم المرسل ورقم هاتفه كما في الحوالة',
  'أرسل لقطة شاشة لتفاصيل الحوالة من المحفظة',
  'أرسل المبلغ المتبقي لإكمال قيمة الطلب',
];

interface Deposit {
  id: string;
  amount_usd: number;
  amount_gold: number;
  fee_usd: number;
  method: string;
  external_ref: string;
  proof_url: string;
  sender_phone: string | null;
  sender_name: string | null;
  usdt_network: string | null;
  usdt_tx_hash: string | null;
  usdt_from_address: string | null;
  status: string;
  created_at: string;
  user: { username: string; display_name: string | null } | null;
  agent: { id: string; user_id: string } | null;
}

type DepositAction = 'approve' | 'reject' | 'review' | 'request_info' | 'fail';

export function DepositsPage() {
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('pending');
  const [search, setSearch] = useState('');
  const [selectedDeposit, setSelectedDeposit] = useState<Deposit | null>(null);
  const [reasonModal, setReasonModal] = useState<{ deposit: Deposit; mode: 'reject' | 'request_info' } | null>(null);
  const [processing, setProcessing] = useState<string | null>(null);

  useEffect(() => {
    loadDeposits();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, search]);

  const loadDeposits = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('deposits')
        .select(`
          id, amount_usd, amount_gold, fee_usd, method, external_ref, proof_url,
          sender_phone, sender_name, usdt_network, usdt_tx_hash, usdt_from_address, status, created_at,
          user:users!deposits_user_id_fkey(username, display_name),
          agent:agents(id, user_id)
        `)
        .order('created_at', { ascending: false })
        .limit(50);

      if (filter !== 'all') query = query.eq('status', filter);
      const trimmed = search.trim();
      if (trimmed) {
        query = query.or(`external_ref.ilike.%${trimmed}%,sender_phone.ilike.%${trimmed}%,sender_name.ilike.%${trimmed}%`);
      }
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

  const handleAction = async (depositId: string, action: DepositAction, reason?: string, notes?: string) => {
    setProcessing(depositId);
    try {
      await callFunction('deposit-approve', { deposit_id: depositId, action, reason, notes });
      toast.success(
        action === 'approve' ? 'تمت الموافقة على الشحن'
          : action === 'reject' ? 'تم رفض الشحن'
          : action === 'fail' ? 'تم تسجيل فشل الشحن'
          : action === 'request_info' ? 'طُلبت معلومات إضافية وأُشعر المستخدم'
          : 'نُقل الطلب إلى المراجعة',
      );
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
      <PageHeader
        title="طلبات الشحن"
        subtitle="مراجعة وموافقة على طلبات شحن المستخدمين — اختر الحالة أو ابحث برقم العملية."
        actions={(
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-gray-300">
            {loading ? 'جارٍ التحميل…' : `${deposits.length.toLocaleString()} طلب ظاهر`}
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
              placeholder="رقم العملية أو هاتف المرسل أو الاسم…"
              className="w-full rounded-xl border border-white/[0.08] bg-[#111424] py-2.5 pr-10 pl-3 text-sm text-white outline-none transition placeholder:text-gray-600 focus:border-wattar-400/60"
            />
          </label>
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
                    {(dep.status === 'pending' || dep.status === 'reviewing') && (
                      <>
                        {dep.status === 'pending' && (
                          <button
                            onClick={() => handleAction(dep.id, 'review')}
                            disabled={processing === dep.id}
                            className="rounded-lg p-2 text-blue-400 hover:bg-blue-500/10 disabled:opacity-50"
                            title="نقل إلى المراجعة"
                          >
                            <Search size={16} />
                          </button>
                        )}
                        <button
                          onClick={() => handleAction(dep.id, 'approve')}
                          disabled={processing === dep.id}
                          className="rounded-lg p-2 text-green-400 hover:bg-green-500/10 disabled:opacity-50"
                          title="موافقة"
                        >
                          {processing === dep.id ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                        </button>
                        <button
                          onClick={() => setReasonModal({ deposit: dep, mode: 'request_info' })}
                          disabled={processing === dep.id}
                          className="rounded-lg p-2 text-amber-400 hover:bg-amber-500/10 disabled:opacity-50"
                          title="طلب معلومات إضافية"
                        >
                          <MessageCircleQuestion size={16} />
                        </button>
                        <button
                          onClick={() => setReasonModal({ deposit: dep, mode: 'reject' })}
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
          onReject={() => {
            const deposit = selectedDeposit;
            setSelectedDeposit(null);
            setReasonModal({ deposit, mode: 'reject' });
          }}
          onInfoRequest={() => {
            const deposit = selectedDeposit;
            setSelectedDeposit(null);
            setReasonModal({ deposit, mode: 'request_info' });
          }}
          processing={processing === selectedDeposit.id}
        />
      )}

      {reasonModal && (
        <ActionReasonModal
          mode={reasonModal.mode}
          deposit={reasonModal.deposit}
          processing={processing === reasonModal.deposit.id}
          onClose={() => {
            if (processing) return;
            setReasonModal(null);
          }}
          onSubmit={(reason, note) => {
            const { deposit, mode } = reasonModal;
            setReasonModal(null);
            if (mode === 'reject') void handleAction(deposit.id, 'reject', reason, note);
            else void handleAction(deposit.id, 'request_info', undefined, note || reason);
          }}
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
  onInfoRequest,
  processing,
}: {
  deposit: Deposit;
  onClose: () => void;
  onApprove: () => void;
  onReject: () => void;
  onInfoRequest: () => void;
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
            {deposit.method === 'usdt' && (
              <>
                <div>
                  <p className="text-xs text-gray-500 mb-1">الشبكة</p>
                  <p className="text-sm text-white uppercase">{deposit.usdt_network ?? '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">رقم عملية USDT</p>
                  <p className="text-sm text-white font-mono break-all" dir="ltr">{deposit.usdt_tx_hash ?? '—'}</p>
                </div>
                {deposit.usdt_from_address && (
                  <div>
                    <p className="text-xs text-gray-500 mb-1">عنوان المرسل</p>
                    <p className="text-sm text-white font-mono break-all" dir="ltr">{deposit.usdt_from_address}</p>
                  </div>
                )}
              </>
            )}
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

          {(deposit.status === 'pending' || deposit.status === 'reviewing') && (
            <div className="space-y-3 pt-4">
              <button
                onClick={onApprove}
                disabled={processing}
                className="w-full rounded-lg bg-green-600 hover:bg-green-700 disabled:opacity-50 py-2.5 font-medium text-white"
              >
                {processing ? 'جاري المعالجة...' : 'موافقة وإضافة الرصيد'}
              </button>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={onInfoRequest}
                  disabled={processing}
                  className="rounded-lg border border-amber-500/30 bg-amber-500/10 py-2.5 font-medium text-amber-200 hover:bg-amber-500/15 disabled:opacity-50"
                >
                  طلب معلومات إضافية
                </button>
                <button
                  onClick={onReject}
                  disabled={processing}
                  className="rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 py-2.5 font-medium text-white"
                >
                  رفض الطلب
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ActionReasonModal({
  mode,
  deposit,
  processing,
  onClose,
  onSubmit,
}: {
  mode: 'reject' | 'request_info';
  deposit: Deposit;
  processing: boolean;
  onClose: () => void;
  onSubmit: (reason: string, note: string) => void;
}) {
  const options = mode === 'reject' ? rejectReasons : infoRequests;
  const [choice, setChoice] = useState(options[0]);
  const [custom, setCustom] = useState('');
  const [useCustom, setUseCustom] = useState(false);
  const [note, setNote] = useState('');
  const reason = useCustom ? custom.trim() : choice;
  const canSubmit = Boolean(reason) && reason.length <= 500 && note.length <= 500 && !processing;
  const title = mode === 'reject' ? 'رفض طلب الشحن' : 'طلب معلومات إضافية';
  const tone = mode === 'reject'
    ? 'border-red-500/30 bg-red-500/10 text-red-200'
    : 'border-amber-500/30 bg-amber-500/10 text-amber-200';

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
              {deposit.user?.display_name ?? deposit.user?.username ?? 'مستخدم'} · ${Number(deposit.amount_usd).toFixed(2)} · {getMethodLabel(deposit.method)}
            </p>
          </div>
          <button onClick={onClose} disabled={processing} className="text-gray-400 hover:text-white disabled:opacity-50" aria-label="إغلاق">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div className={`flex items-start gap-2 rounded-xl border p-3 text-xs leading-6 ${tone}`}>
            <ShieldAlert size={16} className="mt-1 shrink-0" />
            {mode === 'reject'
              ? 'اختر سببًا جاهزًا — سيظهر للمستخدم في إشعاره ويُسجَّل في سجل الإدارة.'
              : 'اختر الرسالة الجاهزة — سيصل المستخدم إشعار يوضح ما ينقص طلبه.'}
          </div>

          <div className="space-y-2">
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
              placeholder={mode === 'reject' ? 'اكتب سبب الرفض…' : 'اكتب المطلوب من المستخدم…'}
              className="w-full resize-y rounded-xl border border-white/[0.08] bg-[#111424] px-3 py-2.5 text-sm text-white placeholder:text-gray-600 focus:border-wattar-400/60 focus:outline-none"
            />
          ) : null}

          <label className="block">
            <span className="mb-1.5 block text-xs text-gray-400">ملاحظة إضافية داخلية (اختياري)</span>
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={500}
              placeholder="تظهر في سجل الإدارة فقط"
              className="w-full rounded-xl border border-white/[0.08] bg-[#111424] px-3 py-2.5 text-sm text-white placeholder:text-gray-600 focus:border-wattar-400/60 focus:outline-none"
            />
          </label>

          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={onClose}
              disabled={processing}
              className="rounded-xl border border-white/[0.08] px-4 py-2 text-sm text-gray-300 hover:bg-white/[0.04] disabled:opacity-50"
            >
              إلغاء
            </button>
            <button
              onClick={() => onSubmit(reason, note.trim())}
              disabled={!canSubmit}
              className={`flex min-w-32 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 ${
                mode === 'reject' ? 'bg-red-700 hover:bg-red-600' : 'bg-amber-700 hover:bg-amber-600'
              }`}
            >
              {processing ? <Loader2 size={16} className="animate-spin" /> : null}
              {mode === 'reject' ? 'تأكيد الرفض' : 'إرسال الطلب'}
            </button>
          </div>
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
    processing: 'قيد التنفيذ',
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
