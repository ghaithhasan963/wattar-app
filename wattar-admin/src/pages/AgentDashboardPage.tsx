/**
 * Wattar Admin — لوحة الوكيل / مدير الوكالة (M5)
 *
 * الحساب نفسه يخدم حالتين:
 *  - وكيل: تشغيل الشحن والسحب، المحفظة والدفتر، طلبات التمويل، العملاء، التقارير.
 *  - مدير وكالة: كل ما سبق (إن كان وكيلاً أيضاً) + لوحة الوكالة ووكلاؤها.
 *
 * كل الأرقام تُقرأ من دوال قاعدة البيانات المحمية بهوية المستخدم،
 * وكل عملية كتابية تمرّ عبر Edge Function مسجّلة في سجل التدقيق.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Building2,
  Check,
  CircleDollarSign,
  ExternalLink,
  FileText,
  Landmark,
  Loader2,
  RefreshCw,
  Snowflake,
  Upload,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { callFunction, supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { Badge, EmptyState, NumberField, Segmented, TextField } from '@/components/ui';
import { ReasonPickerModal } from '@/components/ReasonPicker';

const depositRejectReasons = [
  'لم يصل المبلغ إلى محفظة الوكيل',
  'صورة الإثبات غير واضحة',
  'رقم العملية غير صحيح أو مكرر',
  'المبلغ لا يطابق المطلوب',
  'بيانات المرسل غير مطابقة',
];

const withdrawalRejectReasons = [
  'بيانات الاستلام غير صحيحة',
  'المستخدم غير مؤهل للسحب النقدي',
  'تجاوز الحد اليومي',
  'طلب مكرر أو مشبوه',
];

const fundingReasons = [
  'نقص رصيد تشغيلي لتغطية طلبات الشحن',
  'تغطية طلبات سحب المستخدمين',
  'توسيع قاعدة العملاء',
  'تسوية رصيد بعد مراجعة مالية',
];

interface AgentWalletPayload {
  is_agent: boolean;
  agent?: {
    id: string;
    status: string;
    wallet_usd: number;
    coin_inventory: number;
    commission_rate: number;
    credit_limit_usd: number;
    daily_deposit_limit_usd: number;
    daily_withdrawal_limit_usd: number;
    min_operation_usd: number;
    max_operation_usd: number;
    exchange_rate_usd_to_gold: number;
    can_approve_deposits: boolean;
    can_approve_withdrawals: boolean;
    wallet_frozen_at: string | null;
    wallet_frozen_reason: string | null;
    total_users: number;
    max_users: number;
  };
  agency?: { id: string; name: string; status: string; commission_rate: number; wallet_usd: number } | null;
  today?: { deposits_count: number; deposit_usd: number; withdrawals_count: number; withdrawal_usd: number };
  pending_funding?: { count: number; amount_usd: number };
  recent_ledger?: LedgerRow[];
}

interface LedgerRow {
  id: string;
  event_type: string;
  amount_usd: number;
  balance_after: number;
  notes: string | null;
  created_at: string;
}

interface AgencyDashboard {
  is_manager: boolean;
  agency?: {
    id: string;
    name: string;
    status: string;
    wallet_usd: number;
    commission_rate: number;
    agent_commission_rate: number;
    daily_deposit_limit_usd: number;
    daily_withdrawal_limit_usd: number;
    max_agents: number;
    wallet_frozen_at: string | null;
    wallet_frozen_reason: string | null;
  };
  totals?: {
    agents: number;
    active_agents: number;
    wallets_usd: number;
    deposit_usd: number;
    withdrawal_usd: number;
    customers: number;
  };
  agents?: Array<{
    id: string;
    username: string;
    display_name: string | null;
    status: string;
    wallet_usd: number;
    coin_inventory: number;
    commission_rate: number;
    total_users: number;
    total_deposit_usd: number;
    total_withdrawal_usd: number;
    wallet_frozen_at: string | null;
  }>;
  pending_funding?: Array<{ id: string; amount_usd: number; reason: string; created_at: string }>;
  recent_ledger?: LedgerRow[];
}

interface FundingRequest {
  id: string;
  requester_kind: string;
  amount_usd: number;
  reason: string;
  status: string;
  decision_note: string | null;
  created_at: string;
  decided_at: string | null;
}

interface AgentReport {
  days: number;
  from: string;
  totals: {
    deposits_count: number;
    deposit_usd: number;
    withdrawals_count: number;
    withdrawal_usd: number;
    customers: number;
  };
  daily: Array<{
    day: string;
    deposits_count: number;
    deposit_usd: number;
    withdrawals_count: number;
    withdrawal_usd: number;
  }>;
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

type TabKey = 'overview' | 'deposits' | 'withdrawals' | 'customers' | 'wallet' | 'funding' | 'reports' | 'agency';

const proofBucket = 'deposit-proofs';
const maxProofSize = 5 * 1024 * 1024;
const requestPageSize = 50;
const customerPageSize = 100;

export function AgentDashboardPage() {
  const profile = useAuthStore((state) => state.profile);
  const [wallet, setWallet] = useState<AgentWalletPayload | null>(null);
  const [agencyDash, setAgencyDash] = useState<AgencyDashboard | null>(null);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [ledgerTotal, setLedgerTotal] = useState(0);
  const [funding, setFunding] = useState<FundingRequest[]>([]);
  const [report, setReport] = useState<AgentReport | null>(null);
  const [reportDays, setReportDays] = useState(30);
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
  const [loadingMoreLedger, setLoadingMoreLedger] = useState(false);
  const [hasMoreCustomers, setHasMoreCustomers] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [tab, setTab] = useState<TabKey>('overview');
  const [rejectPicker, setRejectPicker] = useState<{ kind: 'deposit' | 'withdrawal'; id: string; subtitle: string } | null>(null);
  const [fundingAmount, setFundingAmount] = useState('');
  const [fundingReason, setFundingReason] = useState(fundingReasons[0]);

  const agent = wallet?.is_agent ? wallet.agent ?? null : null;
  const isManager = agencyDash?.is_manager === true;
  const agency = isManager ? agencyDash?.agency ?? null : null;
  const frozen = Boolean(agent?.wallet_frozen_at) || Boolean(agency?.wallet_frozen_at);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setDashboardError(null);
    try {
      if (!profile?.id) throw new Error('تعذر التحقق من حساب الوكيل. سجّل الدخول مجددًا.');

      const [walletResult, agencyResult] = await Promise.all([
        supabase.rpc('get_my_agent_wallet'),
        supabase.rpc('get_my_agency_dashboard'),
      ]);
      if (walletResult.error) throw walletResult.error;
      if (agencyResult.error) throw agencyResult.error;

      const walletPayload = (walletResult.data ?? { is_agent: false }) as AgentWalletPayload;
      const agencyPayload = (agencyResult.data ?? { is_manager: false }) as AgencyDashboard;

      if (!walletPayload.is_agent && !agencyPayload.is_manager) {
        setWallet(null);
        setAgencyDash(null);
        throw new Error('لا يوجد ملف وكيل أو وكالة نشطة مرتبط بهذا الحساب.');
      }
      if (walletPayload.is_agent && walletPayload.agent?.status !== 'active') {
        setWallet(null);
        setAgencyDash(null);
        throw new Error('حساب الوكيل موقوف. تواصل مع الإدارة.');
      }

      setWallet(walletPayload);
      setAgencyDash(agencyPayload);

      const agentRow = walletPayload.is_agent ? walletPayload.agent : null;
      const canDeposits = Boolean(agentRow?.can_approve_deposits);
      const canWithdrawals = Boolean(agentRow?.can_approve_withdrawals);

      const [customersResult, depositsResult, withdrawalsResult, ledgerResult, fundingResult, reportResult] = await Promise.all([
        agentRow
          ? supabase.rpc('list_my_agent_customers', { p_limit: customerPageSize, p_offset: 0 })
          : Promise.resolve({ data: [], error: null }),
        agentRow && canDeposits
          ? supabase
              .from('deposits')
              .select('id, user_id, amount_usd, amount_gold, method, external_ref, proof_url, sender_phone, status, created_at', { count: 'exact' })
              .eq('agent_id', agentRow.id)
              .in('status', ['pending', 'reviewing'])
              .order('created_at', { ascending: false })
              .order('id', { ascending: false })
              .range(0, requestPageSize - 1)
          : Promise.resolve({ data: [], error: null }),
        agentRow && canWithdrawals
          ? supabase
              .from('diamond_withdrawals')
              .select('id, user_id, amount_usd, amount_diamond, net_usd, fee_usd, method, payout_details, status, created_at', { count: 'exact' })
              .eq('agent_id', agentRow.id)
              .in('status', ['pending', 'reviewing'])
              .order('created_at', { ascending: false })
              .order('id', { ascending: false })
              .range(0, requestPageSize - 1)
          : Promise.resolve({ data: [], error: null }),
        agentRow
          ? supabase.rpc('list_my_agent_ledger', { p_limit: requestPageSize, p_offset: 0 })
          : Promise.resolve({ data: null, error: null }),
        supabase.rpc('list_my_funding_requests'),
        agentRow
          ? supabase.rpc('get_my_agent_report', { p_days: reportDays })
          : Promise.resolve({ data: null, error: null }),
      ]);

      if (customersResult.error) throw customersResult.error;
      if (depositsResult.error) throw depositsResult.error;
      if (withdrawalsResult.error) throw withdrawalsResult.error;
      if (fundingResult.error) throw fundingResult.error;
      if (ledgerResult.error) throw ledgerResult.error;
      if (reportResult.error) throw reportResult.error;

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

      const customerRows = (customersResult.data ?? []) as AgentCustomer[];
      const ledgerPayload = (ledgerResult.data ?? null) as { rows?: LedgerRow[]; total?: number } | null;
      setCustomers(customerRows);
      setHasMoreCustomers(customerRows.length === customerPageSize);
      setDeposits(depositsWithProofs);
      setWithdrawals((withdrawalsResult.data ?? []) as WithdrawalRequest[]);
      setDepositCount('count' in depositsResult ? depositsResult.count ?? depositRows.length : 0);
      setWithdrawalCount('count' in withdrawalsResult ? withdrawalsResult.count ?? withdrawalsResult.data?.length ?? 0 : 0);
      setLedger(ledgerPayload?.rows ?? []);
      setLedgerTotal(ledgerPayload?.total ?? 0);
      setFunding((fundingResult.data ?? []) as FundingRequest[]);
      setReport((reportResult.data ?? null) as AgentReport | null);
      setLastUpdatedAt(new Date());
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'تعذر تحميل لوحة الوكيل.';
      setDashboardError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [profile?.id, reportDays]);

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

  const loadMoreLedger = async () => {
    if (!agent || loadingMoreLedger || ledger.length >= ledgerTotal) return;
    setLoadingMoreLedger(true);
    try {
      const { data, error } = await supabase.rpc('list_my_agent_ledger', {
        p_limit: requestPageSize,
        p_offset: ledger.length,
      });
      if (error) throw error;
      const payload = (data ?? null) as { rows?: LedgerRow[]; total?: number } | null;
      setLedger((current) => [...current, ...(payload?.rows ?? [])]);
      setLedgerTotal(payload?.total ?? ledgerTotal);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'تعذر تحميل بقية الدفتر.');
    } finally {
      setLoadingMoreLedger(false);
    }
  };

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const changeReportDays = (days: number) => {
    if (days === reportDays) return;
    setReportDays(days);
  };

  const submitFunding = async () => {
    const amount = Number(fundingAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('أدخل مبلغ تمويل صحيحاً.');
      return;
    }
    const reason = fundingReason.trim();
    if (reason.length < 5) {
      toast.error('اكتب سبباً واضحاً لطلب التمويل.');
      return;
    }
    const idempotencyKey = `fund-${profile?.id}-${amount}-${reason}-${Date.now()}`;
    setProcessingId('funding');
    try {
      const { data, error } = await supabase.rpc('request_my_funding', {
        p_amount_usd: amount,
        p_reason: reason,
        p_idempotency_key: idempotencyKey,
      });
      if (error) throw error;
      toast.success(`أُرسل طلب التمويل بمبلغ $${amount.toFixed(2)}. الإدارة ستراجعه.`);
      setFundingAmount('');
      if (data && typeof data === 'object' && 'request_id' in data) {
        // تحديث القائمة بعد إضافة الطلب الجديد
        const { data: list, error: listError } = await supabase.rpc('list_my_funding_requests');
        if (!listError) setFunding((list ?? []) as FundingRequest[]);
      }
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'تعذر إرسال طلب التمويل.');
    } finally {
      setProcessingId(null);
    }
  };

  const cancelFunding = async (requestId: string) => {
    setProcessingId(requestId);
    try {
      const { error } = await supabase.rpc('cancel_my_funding_request', { p_request_id: requestId });
      if (error) throw error;
      toast.success('أُلغي طلب التمويل.');
      const { data: list, error: listError } = await supabase.rpc('list_my_funding_requests');
      if (!listError) setFunding((list ?? []) as FundingRequest[]);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'تعذر إلغاء طلب التمويل.');
    } finally {
      setProcessingId(null);
    }
  };

  const reviewDeposit = async (deposit: DepositRequest, action: 'approve' | 'reject', providedReason?: string) => {
    if (action === 'reject' && !providedReason) {
      setRejectPicker({
        kind: 'deposit',
        id: deposit.id,
        subtitle: `طلب شحن $${Number(deposit.amount_usd).toFixed(2)} · ${deposit.external_ref}`,
      });
      return;
    }
    const reason = action === 'reject' ? providedReason : undefined;
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

  const reviewWithdrawal = async (withdrawal: WithdrawalRequest, action: 'approve' | 'reject', providedReason?: string) => {
    if (action === 'reject' && !providedReason) {
      setRejectPicker({
        kind: 'withdrawal',
        id: withdrawal.id,
        subtitle: `طلب سحب صافي $${Number(withdrawal.net_usd).toFixed(2)} · ${methodLabel(withdrawal.method)}`,
      });
      return;
    }
    const reason = action === 'reject' ? providedReason : undefined;

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

const customerById = useMemo(
    () => new Map(customers.map((customer) => [customer.user_id, customer])),
    [customers],
  );
  const customerName = (userId: string) => {
    const customer = customerById.get(userId);
    return customer?.display_name || customer?.username || `مستخدم ${userId.slice(0, 8)}`;
  };
  const isProcessing = processingId !== null;

  const tabs = useMemo(() => {
    const list: Array<{ key: TabKey; label: string }> = [{ key: 'overview', label: 'نظرة عامة' }];
    if (agent?.can_approve_deposits) list.push({ key: 'deposits', label: 'طلبات الشحن' });
    if (agent?.can_approve_withdrawals) list.push({ key: 'withdrawals', label: 'طلبات السحب' });
    if (agent) {
      list.push({ key: 'wallet', label: 'المحفظة والدفتر' });
      list.push({ key: 'customers', label: 'العملاء' });
    }
    list.push({ key: 'funding', label: 'طلبات التمويل' });
    if (agent) list.push({ key: 'reports', label: 'التقارير' });
    if (isManager) list.push({ key: 'agency', label: 'وكالتي' });
    return list;
  }, [agent, isManager]);
  const activeTab: TabKey = tabs.some((entry) => entry.key === tab) ? tab : 'overview';

  const dailyLimitLabel = (value: number) => (Number(value) > 0 ? `$${Number(value).toFixed(2)}` : 'بلا حد');

  if (loading && !wallet && !agencyDash) {
    return <div className="flex items-center justify-center p-12 text-gray-400"><Loader2 className="ml-2 animate-spin" />جاري تحميل لوحة الوكيل...</div>;
  }

  if (!agent && !isManager) {
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
            <h1 className="text-2xl font-bold text-white">
              {agent ? 'لوحة الوكيل' : 'لوحة وكالتي'}
            </h1>
            <p className="mt-1 text-gray-400">
              مرحبًا {profile?.display_name ?? profile?.username}
              {wallet?.agency ? ` — عضو في ${wallet?.agency.name}` : agency ? ` — مدير ${agency.name}` : ''}
              ، كل البيانات المعروضة تخصّك فقط.
            </p>
            {lastUpdatedAt && (
              <p className="mt-1 text-xs text-gray-500" aria-live="polite">
                آخر تحديث: {lastUpdatedAt.toLocaleString('ar')}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => void loadDashboard()}
            disabled={loading || isProcessing}
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
          <button type="button" onClick={() => void loadDashboard()} disabled={loading || isProcessing} className="rounded-md border border-amber-400/30 px-3 py-1.5 hover:bg-amber-500/10 disabled:opacity-50">
            إعادة المحاولة
          </button>
        </div>
      )}

      {frozen && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <Snowflake size={18} />
          <span>
            محفظتك مجمّدة إدارياً، لذلك لا يمكن تنفيذ أي حركة مالية الآن.
            {agent?.wallet_frozen_reason ?? agency?.wallet_frozen_reason
              ? ` السبب: ${agent?.wallet_frozen_reason ?? agency?.wallet_frozen_reason}`
              : ''}
          </span>
        </div>
      )}

      <div className="rounded-2xl border border-wattar-900 bg-dark-surface p-2">
        <div className="flex flex-wrap gap-1.5">
          {tabs.map((entry) => (
            <button
              key={entry.key}
              type="button"
              onClick={() => setTab(entry.key)}
              className={`rounded-xl px-3.5 py-2 text-sm transition ${
                activeTab === entry.key
                  ? 'bg-wattar-600 font-semibold text-white shadow'
                  : 'text-gray-400 hover:bg-white/[0.04] hover:text-gray-100'
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'overview' && (
        <section className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {agent && (
              <>
                <StatCard icon={<Users size={18} />} label="عملاؤك" value={Number(agent.total_users).toLocaleString('ar')} />
                <StatCard icon={<Wallet size={18} />} label="محفظتك التشغيلية" value={formatUsd(agent.wallet_usd)} hint="سيولة السحب المتاحة" />
                <StatCard icon={<Landmark size={18} />} label="مخزون Coin" value={Number(agent.coin_inventory).toLocaleString('ar')} hint="يُخصم عند اعتماد الشحن" />
                <StatCard icon={<CircleDollarSign size={18} />} label="عمولتك" value={`${Number(agent.commission_rate).toLocaleString('ar')}%`} />
              </>
            )}
            {isManager && agencyDash?.totals && (
              <>
                <StatCard icon={<Building2 size={18} />} label="وكلاء الوكالة" value={`${Number(agencyDash.totals.active_agents).toLocaleString('ar')} / ${Number(agencyDash.totals.agents).toLocaleString('ar')}`} hint="النشطون / الإجمالي" />
                <StatCard icon={<Wallet size={18} />} label="محفظة الوكالة" value={formatUsd(agencyDash.totals.wallets_usd)} hint="مجموع محافظ الوكلاء" />
                <StatCard icon={<Users size={18} />} label="عملاء الوكالة" value={Number(agencyDash.totals.customers).toLocaleString('ar')} />
                <StatCard icon={<CircleDollarSign size={18} />} label="إجمالي الشحن" value={formatUsd(agencyDash.totals.deposit_usd)} />
              </>
            )}
          </div>

          {wallet?.today && (
            <Panel title="حركة اليوم" icon={<FileText size={17} />}>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <MiniStat label="طلبات شحن مكتملة" value={Number(wallet?.today.deposits_count).toLocaleString('ar')} />
                <MiniStat label="قيمة الشحن" value={formatUsd(wallet?.today.deposit_usd)} />
                <MiniStat label="طلبات سحب مدفوعة" value={Number(wallet?.today.withdrawals_count).toLocaleString('ar')} />
                <MiniStat label="قيمة السحب" value={formatUsd(wallet?.today.withdrawal_usd)} />
              </div>
            </Panel>
          )}

          {agent && (
            <Panel title="حدودك التشغيلية" icon={<Landmark size={17} />}>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <MiniStat label="حد الشحن اليومي" value={dailyLimitLabel(agent.daily_deposit_limit_usd)} />
                <MiniStat label="حد السحب اليومي" value={dailyLimitLabel(agent.daily_withdrawal_limit_usd)} />
                <MiniStat label="أقل عملية" value={Number(agent.min_operation_usd) > 0 ? formatUsd(agent.min_operation_usd) : 'بلا حد'} />
                <MiniStat label="أعلى عملية" value={Number(agent.max_operation_usd) > 0 ? formatUsd(agent.max_operation_usd) : 'بلا حد'} />
              </div>
            </Panel>
          )}

          {agent && (
            <Panel title="آخر حركات المحفظة" icon={<Wallet size={17} />} actions={
              <button type="button" onClick={() => setTab('wallet')} className="text-xs text-wattar-300 hover:text-wattar-200">كل الحركات</button>
            }>
              {ledger.length === 0
                ? <p className="text-sm text-gray-500">لا توجد حركات مالية بعد.</p>
                : <LedgerList rows={ledger.slice(0, 6)} />}
            </Panel>
          )}

          {pendingFundingCount(funding) > 0 && (
            <Panel title="طلبات تمويل بانتظار الإدارة" icon={<CircleDollarSign size={17} />}>
              <p className="text-sm text-gray-300">
                لديك {pendingFundingCount(funding).toLocaleString('ar')} طلب تمويل معلّق بقيمة{' '}
                {formatUsd(pendingFundingAmount(funding))}. ستُشحن محفظتك تلقائياً عند الاعتماد.
              </p>
            </Panel>
          )}
        </section>
      )}

      {activeTab === 'deposits' && agent?.can_approve_deposits && (
        <Panel title="طلبات الشحن المعلّقة" icon={<CircleDollarSign size={17} />} actions={
          <span className="text-xs text-gray-500">المعروض {deposits.length.toLocaleString('ar')} من {depositCount.toLocaleString('ar')}</span>
        }>
          {frozen && <p className="mb-3 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-200">المحفظة مجمّدة — لا يمكن اعتماد أو رفض الطلبات حتى تُرفع الإدارة التجميد.</p>}
          {deposits.length === 0 ? <p className="text-sm text-gray-500">لا توجد طلبات شحن معلّقة.</p> : (
            <div className="space-y-4">
              {deposits.map((deposit) => (
                <article key={deposit.id} className="rounded-xl border border-wattar-900/70 bg-dark-elevated p-4">
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
                    <button onClick={() => void reviewDeposit(deposit, 'approve')} disabled={isProcessing || frozen} className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-3 py-2 text-sm text-white disabled:opacity-50">
                      {processingId === deposit.id ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}اعتماد
                    </button>
                    <button onClick={() => void reviewDeposit(deposit, 'reject')} disabled={isProcessing || frozen} className="inline-flex items-center gap-2 rounded-lg bg-red-600/20 px-3 py-2 text-sm text-red-300 disabled:opacity-50">
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
        </Panel>
      )}

      {activeTab === 'withdrawals' && agent?.can_approve_withdrawals && (
        <Panel title="طلبات سحب Diamond" icon={<Wallet size={17} />} actions={
          <span className="text-xs text-gray-500">المعروض {withdrawals.length.toLocaleString('ar')} من {withdrawalCount.toLocaleString('ar')}</span>
        }>
          {frozen && <p className="mb-3 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-200">المحفظة مجمّدة — لا يمكن دفع أو رفض الطلبات حتى تُرفع الإدارة التجميد.</p>}
          {withdrawals.length === 0 ? <p className="text-sm text-gray-500">لا توجد طلبات سحب معلّقة.</p> : (
            <div className="space-y-4">
              {withdrawals.map((withdrawal) => (
                <article key={withdrawal.id} className="rounded-xl border border-wattar-900/70 bg-dark-elevated p-4">
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
                      <input value={externalRefs[withdrawal.id] ?? ''} onChange={(event) => setExternalRefs((current) => ({ ...current, [withdrawal.id]: event.target.value }))} disabled={isProcessing || frozen} className="mt-1 w-full rounded-lg border border-wattar-900 bg-dark-surface px-3 py-2 text-sm text-white disabled:opacity-50" />
                    </label>
                    <label className="block text-xs text-gray-400">
                      صورة إثبات الدفع (JPEG/PNG، حتى 5MB)
                      <span className="mt-1 flex items-center gap-2 rounded-lg border border-wattar-900 bg-dark-surface px-3 py-2 text-sm text-gray-300">
                        <Upload size={15} />
                        <input type="file" accept="image/jpeg,image/png" disabled={isProcessing || frozen} onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) setProofFiles((current) => ({ ...current, [withdrawal.id]: file }));
                        }} className="min-w-0 flex-1 text-xs" />
                      </span>
                      {proofFiles[withdrawal.id] && <span className="mt-1 block text-green-300">{proofFiles[withdrawal.id].name}</span>}
                    </label>
                  </div>
                  <div className="mt-4 flex gap-2">
                    <button onClick={() => void reviewWithdrawal(withdrawal, 'approve')} disabled={isProcessing || frozen} className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-3 py-2 text-sm text-white disabled:opacity-50">
                      {processingId === withdrawal.id ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}تأكيد الدفع
                    </button>
                    <button onClick={() => void reviewWithdrawal(withdrawal, 'reject')} disabled={isProcessing || frozen} className="inline-flex items-center gap-2 rounded-lg bg-red-600/20 px-3 py-2 text-sm text-red-300 disabled:opacity-50">
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
        </Panel>
      )}

      {activeTab === 'customers' && agent && (
        <Panel title="عملاؤك" icon={<Users size={17} />} actions={
          <span className="text-xs text-gray-500">المعروض {customers.length.toLocaleString('ar')} من أصل {Number(agent.total_users).toLocaleString('ar')}</span>
        }>
          {customers.length === 0 ? <p className="text-sm text-gray-500">لا يوجد عملاء مسندون إليك حاليًا.</p> : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {customers.map((customer) => (
                  <article key={customer.user_id} className="rounded-xl border border-wattar-900/70 bg-dark-elevated p-3">
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
        </Panel>
      )}

      {activeTab === 'wallet' && agent && (
        <section className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard icon={<Wallet size={18} />} label="الرصيد الحالي" value={formatUsd(agent.wallet_usd)} />
            <StatCard icon={<Landmark size={18} />} label="مخزون Coin" value={Number(agent.coin_inventory).toLocaleString('ar')} />
            <StatCard icon={<CircleDollarSign size={18} />} label="سعر الصرف" value={`1$ = ${Number(agent.exchange_rate_usd_to_gold).toLocaleString('ar')} Coin`} />
            <StatCard icon={<Building2 size={18} />} label="الوكالة" value={wallet?.agency?.name ?? 'مستقل'} hint={wallet?.agency ? `رصيدها ${formatUsd(wallet?.agency.wallet_usd)}` : 'غير مرتبط بوكالة'} />
          </div>

          <Panel title="دفتر المحفظة" icon={<FileText size={17} />} actions={
            <span className="text-xs text-gray-500">المعروض {ledger.length.toLocaleString('ar')} من {ledgerTotal.toLocaleString('ar')}</span>
          }>
            {ledger.length === 0 ? (
              <EmptyState title="لا توجد حركات بعد" description="ستظهر هنا كل عملية شحن أو سحب أو تسوية على محفظتك مع الرصيد بعد كل حركة." />
            ) : (
              <>
                <LedgerList rows={ledger} detailed />
                {ledger.length < ledgerTotal && (
                  <button type="button" onClick={() => void loadMoreLedger()} disabled={loadingMoreLedger} className="mt-4 w-full rounded-lg border border-wattar-900 px-4 py-3 text-sm text-gray-300 transition hover:bg-dark-elevated disabled:opacity-50">
                    {loadingMoreLedger ? 'جاري التحميل...' : 'تحميل حركات أقدم'}
                  </button>
                )}
              </>
            )}
          </Panel>

          <div className="rounded-xl border border-wattar-900 bg-dark-surface p-4 text-xs leading-6 text-gray-400">
            كل حركة هنا مسجّلة بقيد لا يُحذف: النوع، المبلغ، الرصيد قبل وبعد، والسبب. لا يمكن تعديل رصيدك يدوياً من حسابك؛
            التعديلات الإدارية فقط تُسجَّل في سجل التدقيق.
          </div>
        </section>
      )}

      {activeTab === 'funding' && (
        <section className="space-y-4">
          <Panel title="طلب تمويل جديد" icon={<CircleDollarSign size={17} />}>
            <div className="grid gap-3 sm:grid-cols-2">
              <NumberField
                label="المبلغ المطلوب"
                value={fundingAmount}
                onChange={setFundingAmount}
                unit="$"
                min={1}
                disabled={isProcessing || frozen}
              />
              <div>
                <p className="mb-1.5 block text-sm font-medium text-gray-200">سبب الطلب</p>
                <div className="space-y-2">
                  {fundingReasons.map((reason) => (
                    <button
                      key={reason}
                      type="button"
                      onClick={() => setFundingReason(reason)}
                      disabled={isProcessing || frozen}
                      className={`block w-full rounded-xl border px-3 py-2 text-right text-xs transition ${
                        fundingReason === reason
                          ? 'border-wattar-400/50 bg-wattar-600/20 font-semibold text-white'
                          : 'border-white/[0.07] bg-white/[0.02] text-gray-300 hover:border-white/15'
                      }`}
                    >
                      {reason}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void submitFunding()}
              disabled={isProcessing || frozen || !Number(fundingAmount)}
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-wattar-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-wattar-500 disabled:opacity-50"
            >
              {processingId === 'funding' ? <Loader2 size={16} className="animate-spin" /> : <CircleDollarSign size={16} />}
              إرسال الطلب للإدارة
            </button>
            <p className="mt-2 text-[11px] text-gray-500">الاعتماد يشحن محفظتك مباشرة بقيد في الدفتر. الرفض يحتاج سبباً يظهر لك هنا.</p>
          </Panel>

          <Panel title={`طلباتي (${funding.length.toLocaleString('ar')})`} icon={<FileText size={17} />}>
            {funding.length === 0 ? (
              <EmptyState title="لا توجد طلبات تمويل" description="عندما لا يكفي رصيدك لتغطية طلبات العملاء، أرسل طلباً من الأعلى." />
            ) : (
              <div className="divide-y divide-white/[0.06]">
                {funding.map((request) => (
                  <div key={request.id} className="flex flex-wrap items-center gap-3 py-3">
                    <Badge tone={fundingTone(request.status)}>{fundingLabel(request.status)}</Badge>
                    <span className="text-sm font-semibold text-white">{formatUsd(request.amount_usd)}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-gray-400">{request.reason}</span>
                    <span className="text-[11px] text-gray-500">{new Date(request.created_at).toLocaleString('ar', { dateStyle: 'short', timeStyle: 'short' })}</span>
                    {request.status === 'pending' && (
                      <button
                        type="button"
                        onClick={() => void cancelFunding(request.id)}
                        disabled={isProcessing}
                        className="rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-gray-300 hover:bg-white/[0.06] disabled:opacity-50"
                      >
                        إلغاء الطلب
                      </button>
                    )}
                    {request.decision_note && (
                      <p className="w-full text-[11px] text-gray-500">ملاحظة الإدارة: {request.decision_note}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </section>
      )}

      {activeTab === 'reports' && agent && (
        <section className="space-y-4">
          <Panel title="فترة التقرير" icon={<FileText size={17} />}>
            <Segmented
              options={[
                { label: 'آخر 7 أيام', value: 7 },
                { label: 'آخر 30 يوماً', value: 30 },
                { label: 'آخر 90 يوماً', value: 90 },
              ]}
              value={reportDays}
              onChange={changeReportDays}
              columns={3}
            />
          </Panel>

          {report ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <StatCard icon={<CircleDollarSign size={18} />} label="طلبات الشحن" value={Number(report.totals.deposits_count).toLocaleString('ar')} />
                <StatCard icon={<CircleDollarSign size={18} />} label="قيمة الشحن" value={formatUsd(report.totals.deposit_usd)} />
                <StatCard icon={<Wallet size={18} />} label="طلبات السحب" value={Number(report.totals.withdrawals_count).toLocaleString('ar')} />
                <StatCard icon={<Wallet size={18} />} label="قيمة السحب" value={formatUsd(report.totals.withdrawal_usd)} />
                <StatCard icon={<Users size={18} />} label="عملاؤك" value={Number(report.totals.customers).toLocaleString('ar')} />
              </div>

              <Panel title={`الحركة اليومية — آخر ${report.days} يوماً`} icon={<FileText size={17} />}>
                <div className="max-h-[420px] overflow-y-auto">
                  <table className="w-full text-right text-xs">
                    <thead className="sticky top-0 bg-dark-surface text-gray-400">
                      <tr>
                        <th className="px-2 py-2 font-medium">اليوم</th>
                        <th className="px-2 py-2 font-medium">شحنات</th>
                        <th className="px-2 py-2 font-medium">قيمة الشحن</th>
                        <th className="px-2 py-2 font-medium">سحوبات</th>
                        <th className="px-2 py-2 font-medium">قيمة السحب</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.05]">
                      {report.daily.slice().reverse().map((day) => (
                        <tr key={day.day} className="text-gray-300">
                          <td className="px-2 py-2">{new Date(day.day).toLocaleDateString('ar')}</td>
                          <td className="px-2 py-2">{Number(day.deposits_count).toLocaleString('ar')}</td>
                          <td className="px-2 py-2">{formatUsd(day.deposit_usd)}</td>
                          <td className="px-2 py-2">{Number(day.withdrawals_count).toLocaleString('ar')}</td>
                          <td className="px-2 py-2">{formatUsd(day.withdrawal_usd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-[11px] text-gray-500">عمولتك: {Number(agent.commission_rate).toLocaleString('ar')}% من قيمة الشحن تُحتسب تلقائياً في مستحقاتك.</p>
              </Panel>
            </>
          ) : (
            <Panel title="التقرير" icon={<FileText size={17} />}>
              <p className="text-sm text-gray-500">{loading ? 'جاري إعداد التقرير...' : 'لا توجد بيانات كافية للتقرير.'}</p>
            </Panel>
          )}
        </section>
      )}

      {activeTab === 'agency' && isManager && agency && agencyDash && (
        <section className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard icon={<Building2 size={18} />} label="وكالتي" value={agency.name} hint={agencyLabel(agency.status)} />
            <StatCard icon={<Wallet size={18} />} label="محفظة الوكالة" value={formatUsd(agency.wallet_usd)} />
            <StatCard icon={<CircleDollarSign size={18} />} label="عمولة الوكالة" value={`${Number(agency.commission_rate).toLocaleString('ar')}%`} hint={`الوكلاء ${Number(agency.agent_commission_rate).toLocaleString('ar')}%`} />
            <StatCard icon={<Users size={18} />} label="الوكلاء" value={`${Number(agencyDash.totals?.active_agents ?? 0).toLocaleString('ar')} / ${Number(agencyDash.totals?.agents ?? 0).toLocaleString('ar')}`} hint={Number(agency.max_agents) > 0 ? `الحد ${agency.max_agents}` : 'بلا حد'} />
          </div>

          {agency.wallet_frozen_at && (
            <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              محفظة الوكالة مجمّدة. السبب: {agency.wallet_frozen_reason ?? 'غير مسجّل'}.
            </div>
          )}

          <Panel title="حصيلة الوكالة" icon={<FileText size={17} />}>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MiniStat label="إجمالي الشحن" value={formatUsd(agencyDash.totals?.deposit_usd ?? 0)} />
              <MiniStat label="إجمالي السحب" value={formatUsd(agencyDash.totals?.withdrawal_usd ?? 0)} />
              <MiniStat label="مجموع محافظ الوكلاء" value={formatUsd(agencyDash.totals?.wallets_usd ?? 0)} />
              <MiniStat label="عملاء الوكالة" value={Number(agencyDash.totals?.customers ?? 0).toLocaleString('ar')} />
            </div>
          </Panel>

          <Panel title={`وكلاء الوكالة (${(agencyDash.agents ?? []).length.toLocaleString('ar')})`} icon={<Users size={17} />}>
            {(agencyDash.agents ?? []).length === 0 ? (
              <EmptyState title="لا يوجد وكلاء" description="الإدارة العليا تُسند الوكلاء إلى وكالتك وتحدّد عمولة كل وكيل." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-right text-xs">
                  <thead className="text-gray-400">
                    <tr>
                      <th className="px-2 py-2 font-medium">الوكيل</th>
                      <th className="px-2 py-2 font-medium">الحالة</th>
                      <th className="px-2 py-2 font-medium">المحفظة</th>
                      <th className="px-2 py-2 font-medium">مخزون Coin</th>
                      <th className="px-2 py-2 font-medium">العمولة</th>
                      <th className="px-2 py-2 font-medium">عملاؤه</th>
                      <th className="px-2 py-2 font-medium">إجمالي شحنه</th>
                      <th className="px-2 py-2 font-medium">إجمالي سحبه</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.05]">
                    {(agencyDash.agents ?? []).map((row) => (
                      <tr key={row.id} className="text-gray-300">
                        <td className="px-2 py-2 font-medium text-white">
                          {row.display_name || row.username}
                          {row.wallet_frozen_at ? <Snowflake size={11} className="ml-1 inline text-red-300" /> : null}
                        </td>
                        <td className="px-2 py-2">{row.status === 'active' ? 'نشط' : row.status}</td>
                        <td className="px-2 py-2">{formatUsd(row.wallet_usd)}</td>
                        <td className="px-2 py-2">{Number(row.coin_inventory).toLocaleString('ar')}</td>
                        <td className="px-2 py-2">{Number(row.commission_rate).toLocaleString('ar')}%</td>
                        <td className="px-2 py-2">{Number(row.total_users).toLocaleString('ar')}</td>
                        <td className="px-2 py-2">{formatUsd(row.total_deposit_usd)}</td>
                        <td className="px-2 py-2">{formatUsd(row.total_withdrawal_usd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel title="دفتر محفظة الوكالة" icon={<FileText size={17} />}>
            {(agencyDash.recent_ledger ?? []).length === 0 ? (
              <p className="text-sm text-gray-500">لا توجد حركات على محفظة الوكالة بعد.</p>
            ) : (
              <LedgerList rows={agencyDash.recent_ledger ?? []} detailed />
            )}
          </Panel>
        </section>
      )}

      {rejectPicker && (
        <ReasonPickerModal
          title={rejectPicker.kind === 'deposit' ? 'رفض طلب الشحن' : 'رفض طلب السحب'}
          subtitle={rejectPicker.subtitle}
          description={rejectPicker.kind === 'deposit'
            ? 'اختر سببًا جاهزًا ليظهر للمستخدم في إشعاره ويُسجَّل في سجل الإدارة.'
            : 'سيُعاد رصيد Diamond إلى المستخدم عند الرفض. اختر السبب المناسب.'}
          options={rejectPicker.kind === 'deposit' ? depositRejectReasons : withdrawalRejectReasons}
          confirmLabel="تأكيد الرفض"
          tone="danger"
          processing={processingId === rejectPicker.id}
          onClose={() => {
            if (processingId) return;
            setRejectPicker(null);
          }}
          onSubmit={(reason) => {
            const picker = rejectPicker;
            setRejectPicker(null);
            if (picker.kind === 'deposit') {
              const deposit = deposits.find((item) => item.id === picker.id);
              if (deposit) void reviewDeposit(deposit, 'reject', reason);
            } else {
              const withdrawal = withdrawals.find((item) => item.id === picker.id);
              if (withdrawal) void reviewWithdrawal(withdrawal, 'reject', reason);
            }
          }}
        />
      )}
    </div>
  );
}

function StatCard({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-wattar-900 bg-dark-surface p-4">
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <span className="rounded-lg bg-wattar-600/20 p-1.5 text-wattar-300">{icon}</span>
        {label}
      </div>
      <p className="mt-2 text-xl font-bold text-white">{value}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-gray-500">{hint}</p> : null}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-dark-elevated px-3 py-2.5">
      <p className="text-[11px] text-gray-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-gray-100">{value}</p>
    </div>
  );
}

function Panel({ title, icon, actions, children }: { title: string; icon?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-wattar-900 bg-dark-surface p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold text-white">{icon}{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

const LEDGER_EVENT_LABELS: Record<string, string> = {
  opening: 'رصيد افتتاحي',
  admin_credit: 'شحن إداري',
  agency_transfer: 'تحويل من الوكالة',
  transfer_to_agent: 'تحويل إلى وكيل',
  funding_credit: 'تمويل معتمد',
  deposit_sale: 'اعتماد شحن',
  withdrawal_payout: 'دفع سحب',
  commission: 'احتساب عمولة',
  adjustment: 'تسوية إدارية',
  reversal: 'قيد عكسي',
};
function LedgerList({ rows, detailed = false }: { rows: LedgerRow[]; detailed?: boolean }) {
  return (
    <div className="divide-y divide-white/[0.06]">
      {rows.map((row) => {
        const negative = Number(row.amount_usd) < 0;
        return (
          <div key={row.id} className="flex flex-wrap items-center gap-3 py-2.5">
            <Badge tone={negative ? 'danger' : 'success'}>
              {negative ? '-' : '+'}${Math.abs(Number(row.amount_usd)).toFixed(2)}
            </Badge>
            <span className="text-xs text-gray-200">{LEDGER_EVENT_LABELS[row.event_type] ?? row.event_type}</span>
            <span className="text-[11px] text-gray-500">الرصيد بعدها ${Number(row.balance_after).toFixed(2)}</span>
            {detailed && row.notes ? <span className="min-w-0 flex-1 truncate text-[11px] text-gray-500">{row.notes}</span> : null}
            <span className="ml-auto text-[11px] text-gray-500">{new Date(row.created_at).toLocaleString('ar', { dateStyle: 'short', timeStyle: 'short' })}</span>
          </div>
        );
      })}
    </div>
  );
}

function fundingLabel(status: string): string {
  return ({ pending: 'بانتظار الإدارة', approved: 'معتمد', rejected: 'مرفوض', cancelled: 'ملغى' } as Record<string, string>)[status] ?? status;
}

function fundingTone(status: string): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  return ({ pending: 'warning', approved: 'success', rejected: 'danger', cancelled: 'neutral' } as Record<string, 'neutral' | 'success' | 'warning' | 'danger' | 'info'>)[status] ?? 'neutral';
}

function agencyLabel(status: string): string {
  return ({ pending: 'بانتظار الاعتماد', active: 'معتمدة', suspended: 'موقوفة', revoked: 'ملغى اعتمادها' } as Record<string, string>)[status] ?? status;
}

function pendingFundingCount(requests: FundingRequest[]): number {
  return requests.filter((request) => request.status === 'pending').length;
}

function pendingFundingAmount(requests: FundingRequest[]): number {
  return requests
    .filter((request) => request.status === 'pending')
    .reduce((sum, request) => sum + Number(request.amount_usd), 0);
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
