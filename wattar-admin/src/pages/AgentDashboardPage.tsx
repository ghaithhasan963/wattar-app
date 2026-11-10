import { useCallback, useEffect, useState } from 'react';
import { Check, ExternalLink, Loader2, RefreshCw, Upload, Users, Wallet, X } from 'lucide-react';
import { toast } from 'sonner';
import { callFunction, supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';

interface AgentAccess {
  id: string;
  status: string;
  can_approve_deposits: boolean;
  can_approve_withdrawals: boolean;
  wallet_usd: number;
  coin_inventory: number;
  commission_rate: number;
  total_users: number;
  total_commission_usd: number;
}

interface AgentCustomer {
  user_id: string;
  username: string;
  display_name: string | null;
  status: string;
  created_at: string;
}

interface DepositRequest {
  id: string;
  user_id: string;
  amount_usd: number;
  amount_gold: number;
  method: string;
  external_ref: string;
  proof_url: string;
  sender_phone: string | null;
  status: string;
  created_at: string;
  proof_signed_url?: string;
}

interface WithdrawalRequest {
  id: string;
  user_id: string;
  amount_usd: number;
  amount_diamond: number;
  net_usd: number;
  fee_usd: number;
  method: string;
  payout_details: Record<string, string> | null;
  status: string;
  created_at: string;
}

const proofBucket = 'deposit-proofs';
const maxProofSize = 5 * 1024 * 1024;
const requestPageSize = 50;
const customerPageSize = 100;

export function AgentDashboardPage() {
  const profile = useAuthStore((state) => state.profile);
  const [agent, setAgent] = useState<AgentAccess | null>(null);
  const [customers, setCustomers] = useState<AgentCustomer[]>([]);
  const [deposits, setDeposits] = useState<DepositRequest[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [depositCount, setDepositCount] = useState(0);
  const [withdrawalCount, setWithdrawalCount] = useState(0);
  const [proofFiles, setProofFiles] = useState<Record<string, File>>({});
  const [externalRefs, setExternalRefs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadingMoreCustomers, setLoadingMoreCustomers] = useState(false);
  const [loadingMoreDeposits, setLoadingMoreDeposits] = useState(false);
  const [loadingMoreWithdrawals, setLoadingMoreWithdrawals] = useState(false);
  const [hasMoreCustomers, setHasMoreCustomers] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setDashboardError(null);
    try {
      if (!profile?.id) throw new Error('تعذر التحقق من حساب الوكيل. سجّل الدخول مجددًا.');
      const { data: agentData, error: agentError } = await supabase
        .from('agents')
        .select('id, status, can_approve_deposits, can_approve_withdrawals, wallet_usd, coin_inventory, commission_rate, total_users, total_commission_usd')
        .eq('user_id', profile.id)
        .maybeSingle();
      if (agentError) throw agentError;
      if (!agentData || agentData.status !== 'active') {
        setAgent(null);
        setCustomers([]);
        setHasMoreCustomers(false);
        setDeposits([]);
        setWithdrawals([]);
        throw new Error('لا يوجد ملف وكيل نشط مرتبط بهذا الحساب.');
      }

      const [customersResult, depositsResult, withdrawalsResult] = await Promise.all([
        supabase.rpc('list_my_agent_customers', { p_limit: customerPageSize, p_offset: 0 }),
        agentData.can_approve_deposits
          ? supabase
              .from('deposits')
              .select('id, user_id, amount_usd, amount_gold, method, external_ref, proof_url, sender_phone, status, created_at', { count: 'exact' })
              .eq('agent_id', agentData.id)
              .in('status', ['pending', 'reviewing'])
              .order('created_at', { ascending: false })
              .order('id', { ascending: false })
              .range(0, requestPageSize - 1)
          : Promise.resolve({ data: [], error: null }),
        agentData.can_approve_withdrawals
          ? supabase
              .from('diamond_withdrawals')
              .select('id, user_id, amount_usd, amount_diamond, net_usd, fee_usd, method, payout_details, status, created_at', { count: 'exact' })
              .eq('agent_id', agentData.id)
              .in('status', ['pending', 'reviewing'])
              .order('created_at', { ascending: false })
              .order('id', { ascending: false })
              .range(0, requestPageSize - 1)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (customersResult.error) throw customersResult.error;
      if (depositsResult.error) throw depositsResult.error;
      if (withdrawalsResult.error) throw withdrawalsResult.error;

      const depositRows = (depositsResult.data ?? []) as DepositRequest[];
      let failedProofCount = 0;
      const depositsWithProofs = await Promise.all(depositRows.map(async (deposit) => {
        const path = getStoragePath(deposit.proof_url);
        if (!path) return deposit;
        try {
          const { data, error } = await supabase.storage.from(proofBucket).createSignedUrl(path, 10 * 60);
          if (error) throw error;
          return { ...deposit, proof_signed_url: data.signedUrl };
        } catch (error: unknown) {
          failedProofCount += 1;
          console.error(`Failed to load deposit proof ${deposit.id}:`, error);
          return deposit;
        }
      }));
      if (failedProofCount > 0) {
        toast.error(`تعذر فتح إثبات ${failedProofCount.toLocaleString('ar')} من طلبات الشحن. حدّث الصفحة أو أبلغ الإدارة.`);
      }

      setAgent(agentData as AgentAccess);
      const customerRows = (customersResult.data ?? []) as AgentCustomer[];
      setCustomers(customerRows);
      setHasMoreCustomers(customerRows.length === customerPageSize);
      setDeposits(depositsWithProofs);
      setWithdrawals((withdrawalsResult.data ?? []) as WithdrawalRequest[]);
      setDepositCount('count' in depositsResult ? depositsResult.count ?? depositRows.length : 0);
      setWithdrawalCount('count' in withdrawalsResult ? withdrawalsResult.count ?? withdrawalsResult.data?.length ?? 0 : 0);
      setLastUpdatedAt(new Date());
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'تعذر تحميل لوحة الوكيل.';
      setDashboardError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [profile?.id]);

  const loadMoreCustomers = async () => {
    if (loadingMoreCustomers || !hasMoreCustomers) return;
    setLoadingMoreCustomers(true);
    try {
      const { data, error } = await supabase.rpc('list_my_agent_customers', {
        p_limit: customerPageSize,
        p_offset: customers.length,
      });
      if (error) throw error;
      const page = (data ?? []) as AgentCustomer[];
      setCustomers((current) => [...current, ...page]);
      setHasMoreCustomers(page.length === customerPageSize);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'تعذر تحميل بقية العملاء.');
    } finally {
      setLoadingMoreCustomers(false);
    }
  };

  const loadMoreDeposits = async () => {
    if (!agent || loadingMoreDeposits || deposits.length >= depositCount) return;
    setLoadingMoreDeposits(true);
    try {
      const { data, error } = await supabase
        .from('deposits')
        .select('id, user_id, amount_usd, amount_gold, method, external_ref, proof_url, sender_phone, status, created_at')
        .eq('agent_id', agent.id)
        .in('status', ['pending', 'reviewing'])
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(deposits.length, deposits.length + requestPageSize - 1);
      if (error) throw error;
      const nextPage = (data ?? []) as DepositRequest[];
      let failedProofCount = 0;
      const pageWithProofs = await Promise.all(nextPage.map(async (deposit) => {
        const path = getStoragePath(deposit.proof_url);
        if (!path) return deposit;
        try {
          const { data: proof, error: proofError } = await supabase.storage
            .from(proofBucket)
            .createSignedUrl(path, 10 * 60);
          if (proofError) throw proofError;
          return { ...deposit, proof_signed_url: proof.signedUrl };
        } catch (proofError: unknown) {
          failedProofCount += 1;
          console.error(`Failed to load deposit proof ${deposit.id}:`, proofError);
          return deposit;
        }
      }));
      if (failedProofCount > 0) {
        toast.error(`تعذر فتح إثبات ${failedProofCount.toLocaleString('ar')} من طلبات الشحن.`);
      }
      setDeposits((current) => [...current, ...pageWithProofs]);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'تعذر تحميل طلبات الشحن الأقدم.');
    } finally {
      setLoadingMoreDeposits(false);
    }
  };

  const loadMoreWithdrawals = async () => {
    if (!agent || loadingMoreWithdrawals || withdrawals.length >= withdrawalCount) return;
    setLoadingMoreWithdrawals(true);
    try {
      const { data, error } = await supabase
        .from('diamond_withdrawals')
        .select('id, user_id, amount_usd, amount_diamond, net_usd, fee_usd, method, payout_details, status, created_at')
        .eq('agent_id', agent.id)
        .in('status', ['pending', 'reviewing'])
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(withdrawals.length, withdrawals.length + requestPageSize - 1);
      if (error) throw error;
      setWithdrawals((current) => [...current, ...((data ?? []) as WithdrawalRequest[])]);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'تعذر تحميل طلبات السحب الأقدم.');
    } finally {
      setLoadingMoreWithdrawals(false);
    }
  };

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const reviewDeposit = async (deposit: DepositRequest, action: 'approve' | 'reject') => {
    const reason = action === 'reject' ? window.prompt('اكتب سبب رفض طلب الشحن:') : undefined;
    if (action === 'reject' && !reason?.trim()) return;
    if (action === 'approve' && !window.confirm('هل تأكدت من استلام المبلغ؟')) return;

    setProcessingId(deposit.id);
    try {
      await callFunction('deposit-approve', {
        deposit_id: deposit.id,
        action,
        ...(reason ? { reason: reason.trim() } : {}),
      });
      toast.success(action === 'approve' ? 'تم اعتماد طلب الشحن.' : 'تم رفض طلب الشحن.');
      await loadDashboard();
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'تعذر معالجة طلب الشحن.');
    } finally {
      setProcessingId(null);
    }
  };

  const reviewWithdrawal = async (withdrawal: WithdrawalRequest, action: 'approve' | 'reject') => {
    const reason = action === 'reject' ? window.prompt('اكتب سبب رفض طلب السحب:') : undefined;
    if (action === 'reject' && !reason?.trim()) return;

    let uploadedPath: string | null = null;
    setProcessingId(withdrawal.id);
    try {
      if (action === 'approve') {
        const proof = proofFiles[withdrawal.id];
        const externalRef = externalRefs[withdrawal.id]?.trim();
        if (!proof || !externalRef) {
          throw new Error('ارفع صورة إثبات الدفع وأدخل رقم العملية قبل تأكيد السحب.');
        }
        if (!['image/jpeg', 'image/png'].includes(proof.type) || proof.size > maxProofSize) {
          throw new Error('الإثبات يجب أن يكون صورة JPEG أو PNG بحجم لا يتجاوز 5MB.');
        }

        uploadedPath = `wd_${profile?.id}_${Date.now()}.${proof.type === 'image/png' ? 'png' : 'jpg'}`;
        const { error: uploadError } = await supabase.storage
          .from(proofBucket)
          .upload(uploadedPath, proof, { contentType: proof.type, upsert: false });
        if (uploadError) throw uploadError;

        await callFunction('withdrawal-approve', {
          withdrawal_id: withdrawal.id,
          action,
          proof_url: uploadedPath,
          external_ref: externalRef,
        });
      } else {
        await callFunction('withdrawal-approve', {
          withdrawal_id: withdrawal.id,
          action,
          reason: reason?.trim(),
        });
      }

      toast.success(action === 'approve' ? 'تم تأكيد دفع طلب السحب.' : 'تم رفض طلب السحب.');
      setProofFiles((current) => {
        const next = { ...current };
        delete next[withdrawal.id];
        return next;
      });
      setExternalRefs((current) => {
        const next = { ...current };
        delete next[withdrawal.id];
        return next;
      });
      await loadDashboard();
    } catch (error: unknown) {
      if (uploadedPath) {
        const { error: cleanupError } = await supabase.storage.from(proofBucket).remove([uploadedPath]);
        if (cleanupError) {
          console.error('Failed to remove an unused withdrawal proof:', cleanupError);
          toast.error('تعذرت إزالة صورة الإثبات غير المرتبطة بالطلب؛ يرجى إبلاغ الإدارة.');
        }
      }
      toast.error(error instanceof Error ? error.message : 'تعذر معالجة طلب السحب.');
    } finally {
      setProcessingId(null);
    }
  };

  const customerById = new Map(customers.map((customer) => [customer.user_id, customer]));
  const customerName = (userId: string) => {
    const customer = customerById.get(userId);
    return customer?.display_name || customer?.username || `مستخدم ${userId.slice(0, 8)}`;
  };
  const isProcessing = processingId !== null;

  if (loading && !agent) {
    return <div className="flex items-center justify-center p-12 text-gray-400"><Loader2 className="ml-2 animate-spin" />جاري تحميل لوحة الوكيل...</div>;
  }

  if (!agent) {
    return (
      <div className="flex items-center justify-between gap-4 rounded-xl border border-red-500/20 bg-red-500/10 p-6 text-red-300" dir="rtl">
        <p>{dashboardError ?? 'لا يمكن تحميل بيانات الوكيل.'}</p>
        <button onClick={() => void loadDashboard()} className="rounded-lg border border-red-400/30 px-3 py-2 text-sm hover:bg-red-500/10">إعادة المحاولة</button>
      </div>
    );
  }

  return (
    <div className="space-y-6" dir="rtl">
      <header>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white">لوحة الوكيل</h1>
            <p className="mt-1 text-gray-400">مرحبًا {profile?.display_name ?? profile?.username}، هذه بيانات العملاء والطلبات المسندة إلى حسابك فقط.</p>
            {lastUpdatedAt && (
              <p className="mt-1 text-xs text-gray-500" aria-live="polite">
                آخر تحديث: {lastUpdatedAt.toLocaleString('ar')}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => void loadDashboard()}
            disabled={loading || isProcessing || loadingMoreCustomers || loadingMoreDeposits || loadingMoreWithdrawals}
            className="inline-flex items-center gap-2 rounded-lg border border-wattar-900 px-3 py-2 text-sm text-gray-200 transition hover:bg-dark-elevated disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="تحديث لوحة الوكيل"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            {loading ? 'جاري التحديث...' : 'تحديث البيانات'}
          </button>
        </div>
      </header>

      {dashboardError && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <span>تعذر تحديث بعض البيانات؛ ما زالت البيانات السابقة ظاهرة. {dashboardError}</span>
          <button type="button" onClick={() => void loadDashboard()} disabled={loading || isProcessing || loadingMoreCustomers || loadingMoreDeposits || loadingMoreWithdrawals} className="rounded-md border border-amber-400/30 px-3 py-1.5 hover:bg-amber-500/10 disabled:opacity-50">
            إعادة المحاولة
          </button>
        </div>
      )}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <SummaryCard icon={<Users size={20} />} label="إجمالي عملائك" value={Number(agent.total_users).toLocaleString('ar')} />
        <SummaryCard icon={<Wallet size={20} />} label="سيولة السحب المتاحة" value={formatUsd(agent.wallet_usd)} />
        <SummaryCard icon={<Wallet size={20} />} label="مخزون Coin لدى الوكيل" value={Number(agent.coin_inventory).toLocaleString('ar')} />
        <SummaryCard icon={<Wallet size={20} />} label="عمولاتك المتراكمة" value={formatUsd(agent.total_commission_usd)} />
        <SummaryCard icon={<Wallet size={20} />} label="نسبة العمولة" value={`${Number(agent.commission_rate).toLocaleString('ar')}%`} />
        {agent.can_approve_deposits && (
          <SummaryCard icon={<Wallet size={20} />} label="طلبات الشحن المعلّقة" value={depositCount.toLocaleString('ar')} />
        )}
        {agent.can_approve_withdrawals && (
          <SummaryCard icon={<Wallet size={20} />} label="طلبات السحب المعلّقة" value={withdrawalCount.toLocaleString('ar')} />
        )}
      </section>

      <section className="rounded-xl border border-wattar-900 bg-dark-surface p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-white">عملاؤك</h2>
          <span className="text-xs text-gray-500">المعروض {customers.length.toLocaleString('ar')} من أصل {Number(agent.total_users).toLocaleString('ar')}</span>
        </div>
        {customers.length === 0 ? <p className="text-sm text-gray-500">لا يوجد عملاء مسندون إليك حاليًا.</p> : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {customers.map((customer) => (
                <article key={customer.user_id} className="rounded-lg border border-wattar-900/70 bg-dark-elevated p-3">
                  <p className="font-medium text-white">{customer.display_name || customer.username}</p>
                  <p className="mt-1 text-xs text-gray-500">@{customer.username}</p>
                  <p className="mt-2 text-xs text-gray-400">تاريخ الانضمام: {new Date(customer.created_at).toLocaleDateString('ar')}</p>
                </article>
              ))}
            </div>
            {hasMoreCustomers && (
              <button onClick={() => void loadMoreCustomers()} disabled={loadingMoreCustomers} className="mt-4 rounded-lg border border-wattar-900 px-4 py-2 text-sm text-gray-300 disabled:opacity-50">
                {loadingMoreCustomers ? 'جاري تحميل بقية العملاء...' : 'تحميل المزيد من العملاء'}
              </button>
            )}
          </>
        )}
      </section>

      {agent.can_approve_deposits && (
        <section className="rounded-xl border border-wattar-900 bg-dark-surface p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-white">طلبات الشحن</h2>
            <span className="text-xs text-gray-500">المعروض {deposits.length.toLocaleString('ar')} من {depositCount.toLocaleString('ar')} طلب معلّق</span>
          </div>
          {deposits.length === 0 ? <p className="text-sm text-gray-500">لا توجد طلبات شحن معلّقة.</p> : (
            <div className="space-y-4">
              {deposits.map((deposit) => (
                <article key={deposit.id} className="rounded-lg border border-wattar-900/70 bg-dark-elevated p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-white">{customerName(deposit.user_id)}</p>
                      <p className="mt-1 text-sm text-gray-400">{methodLabel(deposit.method)} · ${Number(deposit.amount_usd).toFixed(2)} · {Number(deposit.amount_gold).toLocaleString('ar')} Coin</p>
                      <p className="mt-1 text-xs text-gray-500">رقم العملية: {deposit.external_ref || '—'}{deposit.sender_phone ? ` · هاتف المرسل: ${deposit.sender_phone}` : ''}</p>
                    </div>
                    <p className="text-xs text-gray-500">{new Date(deposit.created_at).toLocaleString('ar')}</p>
                  </div>
                  {deposit.proof_signed_url && (
                    <a href={deposit.proof_signed_url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-2 text-sm text-blue-300 hover:text-blue-200">
                      <ExternalLink size={15} />عرض إثبات الشحن
                    </a>
                  )}
                  <div className="mt-4 flex gap-2">
                    <button onClick={() => void reviewDeposit(deposit, 'approve')} disabled={isProcessing} className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-3 py-2 text-sm text-white disabled:opacity-50">
                      {processingId === deposit.id ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}اعتماد
                    </button>
                    <button onClick={() => void reviewDeposit(deposit, 'reject')} disabled={isProcessing} className="inline-flex items-center gap-2 rounded-lg bg-red-600/20 px-3 py-2 text-sm text-red-300 disabled:opacity-50">
                      <X size={16} />رفض
                    </button>
                  </div>
                </article>
              ))}
              {deposits.length < depositCount && (
                <button type="button" onClick={() => void loadMoreDeposits()} disabled={loadingMoreDeposits || isProcessing} className="w-full rounded-lg border border-wattar-900 px-4 py-3 text-sm text-gray-300 transition hover:bg-dark-elevated disabled:opacity-50">
                  {loadingMoreDeposits ? 'جاري تحميل الطلبات الأقدم...' : 'تحميل طلبات شحن أقدم'}
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {agent.can_approve_withdrawals && (
        <section className="rounded-xl border border-wattar-900 bg-dark-surface p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-white">طلبات سحب Diamond</h2>
            <span className="text-xs text-gray-500">المعروض {withdrawals.length.toLocaleString('ar')} من {withdrawalCount.toLocaleString('ar')} طلب معلّق</span>
          </div>
          {withdrawals.length === 0 ? <p className="text-sm text-gray-500">لا توجد طلبات سحب معلّقة.</p> : (
            <div className="space-y-4">
              {withdrawals.map((withdrawal) => (
                <article key={withdrawal.id} className="rounded-lg border border-wattar-900/70 bg-dark-elevated p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-white">{customerName(withdrawal.user_id)}</p>
                      <p className="mt-1 text-sm text-gray-400">{methodLabel(withdrawal.method)} · {Number(withdrawal.amount_diamond).toLocaleString('ar')} Diamond · صافي ${Number(withdrawal.net_usd).toFixed(2)}</p>
                      <p className="mt-1 text-xs text-gray-500">{formatPayoutDetails(withdrawal.payout_details)}</p>
                    </div>
                    <p className="text-xs text-gray-500">{new Date(withdrawal.created_at).toLocaleString('ar')}</p>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <label className="block text-xs text-gray-400">
                      رقم عملية الدفع
                      <input value={externalRefs[withdrawal.id] ?? ''} onChange={(event) => setExternalRefs((current) => ({ ...current, [withdrawal.id]: event.target.value }))} disabled={isProcessing} className="mt-1 w-full rounded-lg border border-wattar-900 bg-dark-surface px-3 py-2 text-sm text-white disabled:opacity-50" />
                    </label>
                    <label className="block text-xs text-gray-400">
                      صورة إثبات الدفع (JPEG/PNG، حتى 5MB)
                      <span className="mt-1 flex items-center gap-2 rounded-lg border border-wattar-900 bg-dark-surface px-3 py-2 text-sm text-gray-300">
                        <Upload size={15} />
                        <input type="file" accept="image/jpeg,image/png" disabled={isProcessing} onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) setProofFiles((current) => ({ ...current, [withdrawal.id]: file }));
                        }} className="min-w-0 flex-1 text-xs" />
                      </span>
                      {proofFiles[withdrawal.id] && <span className="mt-1 block text-green-300">{proofFiles[withdrawal.id].name}</span>}
                    </label>
                  </div>
                  <div className="mt-4 flex gap-2">
                    <button onClick={() => void reviewWithdrawal(withdrawal, 'approve')} disabled={isProcessing} className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-3 py-2 text-sm text-white disabled:opacity-50">
                      {processingId === withdrawal.id ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}تأكيد الدفع
                    </button>
                    <button onClick={() => void reviewWithdrawal(withdrawal, 'reject')} disabled={isProcessing} className="inline-flex items-center gap-2 rounded-lg bg-red-600/20 px-3 py-2 text-sm text-red-300 disabled:opacity-50">
                      <X size={16} />رفض
                    </button>
                  </div>
                </article>
              ))}
              {withdrawals.length < withdrawalCount && (
                <button type="button" onClick={() => void loadMoreWithdrawals()} disabled={loadingMoreWithdrawals || isProcessing} className="w-full rounded-lg border border-wattar-900 px-4 py-3 text-sm text-gray-300 transition hover:bg-dark-elevated disabled:opacity-50">
                  {loadingMoreWithdrawals ? 'جاري تحميل الطلبات الأقدم...' : 'تحميل طلبات سحب أقدم'}
                </button>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function SummaryCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-wattar-900 bg-dark-surface p-4">
      <span className="rounded-lg bg-wattar-600/20 p-2 text-wattar-300">{icon}</span>
      <div><p className="text-sm text-gray-400">{label}</p><p className="text-xl font-semibold text-white">{value}</p></div>
    </div>
  );
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat('ar', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);
}

function getStoragePath(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) return value;
  try {
    const url = new URL(value);
    const match = url.pathname.match(/\/storage\/v1\/object\/(?:public|sign)\/deposit-proofs\/(.+)$/);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

function methodLabel(method: string): string {
  return ({ usdt: 'USDT', sham_cash: 'شام كاش', syriatel_cash: 'سيرياتيل كاش', agent: 'وكيل' } as Record<string, string>)[method] ?? method;
}

function formatPayoutDetails(details: Record<string, string> | null): string {
  if (!details) return 'لا توجد تفاصيل دفع';
  return Object.entries(details).map(([key, value]) => `${key}: ${value}`).join(' · ');
}
