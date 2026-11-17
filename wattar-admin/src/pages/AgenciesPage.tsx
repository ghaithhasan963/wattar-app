/**
 * Wattar Admin — الوكالات والوكلاء (M5)
 * هرمية: الإدارة العليا ← مدير الوكالة ← الوكيل ← المستخدمون
 * كل الأرقام حقيقية من القاعدة، وكل كتابة تمرّ عبر admin-agencies (مسجّلة في سجل التدقيق).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Building2,
  Check,
  CircleDollarSign,
  History,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Snowflake,
  UserCheck,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { callFunction, supabase } from '@/lib/supabase';
import { PageHeader, SectionCard, SelectField, Segmented, Toggle, Badge, EmptyState, TextField, NumberField } from '@/components/ui';
import { ReasonPickerModal } from '@/components/ReasonPicker';
import { LedgerModal } from '@/components/LedgerModal';

interface Agency {
  id: string;
  name: string;
  status: 'pending' | 'active' | 'suspended' | 'revoked';
  owner_user_id: string | null;
  commission_rate: number;
  agent_commission_rate: number;
  wallet_usd: number;
  wallet_frozen_at: string | null;
  wallet_frozen_reason: string | null;
  daily_deposit_limit_usd: number;
  daily_withdrawal_limit_usd: number;
  max_agents: number;
  can_approve_hosts: boolean;
  can_create_agents: boolean;
  notes: string | null;
  created_at: string;
}

interface AgencyAgent {
  id: string;
  user_id: string;
  agency_id: string | null;
  status: string;
  wallet_usd: number;
  coin_inventory: number;
  commission_rate: number;
  total_users: number;
  total_deposit_usd: number;
  total_withdrawal_usd: number;
  wallet_frozen_at: string | null;
  user: { username: string; display_name: string | null; phone: string | null } | null;
}

interface FundingRequest {
  id: string;
  requester_kind: 'agent' | 'agency';
  agent_id: string | null;
  agency_id: string | null;
  amount_usd: number;
  reason: string;
  status: string;
  decision_note: string | null;
  created_at: string;
}

interface UserOption {
  id: string;
  username: string;
  display_name: string | null;
  phone: string | null;
  role: string;
}

const STATUS_LABELS: Record<Agency['status'], string> = {
  pending: 'بانتظار الاعتماد',
  active: 'معتمدة',
  suspended: 'موقوفة',
  revoked: 'ملغى اعتمادها',
};

const STATUS_TONE: Record<Agency['status'], 'success' | 'warning' | 'danger' | 'neutral'> = {
  pending: 'warning',
  active: 'success',
  suspended: 'warning',
  revoked: 'danger',
};

const suspendReasons = [
  'مخالفة شروط اتفاقية الوكالة',
  'عدم مطابقة السجلات المالية',
  'شكاوى متكررة من المستخدمين',
  'مراجعة مالية إدارية',
];

const revokeReasons = [
  'احتيال أو تلاعب مالي مؤكد',
  'انتهاء مدة الاتفاقية دون تجديد',
  'مخالفة قانونية أو تسريب بيانات',
  'تكرار المخالفات بعد التعليق',
];

const walletReasons = [
  'تمويل تشغيلي معتمد',
  'تسوية مستحقات الوكالة',
  'تغطية طلبات سحب المستخدمين',
  'إعادة توزيع أرصدة بين الوكلاء',
];

const fundingRejectReasons = [
  'الرصيد الحالي يكفي ولا حاجة لتمويل',
  'المبلغ المطلوب غير مبرر بالسجلات',
  'يجب تسوية المستحقات السابقة أولاً',
  'طلب مكرر',
];

const FUNDING_STATUS_LABELS: Record<string, string> = {
  pending: 'معلّق',
  approved: 'معتمد',
  rejected: 'مرفوض',
  cancelled: 'ملغى من الطالب',
};

const FUNDING_STATUS_TONES: Record<string, 'warning' | 'success' | 'danger' | 'neutral'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
};

const agencyFreezeReasons = [
  'مراجعة مالية إدارية',
  'شبهة تلاعب بالسجلات',
  'مطابقة جرد دورية',
];

const agencyUnfreezeReasons = [
  'انتهت المراجعة المالية',
  'تأكدت سلامة السجلات',
];

const agentAdjustReasonsAgency = [
  'تسوية فرق مالي مؤكد',
  'تغطية طلبات سحب معلّقة',
  'تصحيح قيد خاطئ',
  'تحويل من محفظة الوكالة',
];

export function AgenciesPage() {
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [agents, setAgents] = useState<AgencyAgent[]>([]);
  const [funding, setFunding] = useState<FundingRequest[]>([]);
  const [managers, setManagers] = useState<Record<string, UserOption>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [manageAgency, setManageAgency] = useState<Agency | null>(null);
  const [ledgerAgency, setLedgerAgency] = useState<Agency | null>(null);
  const [statusPicker, setStatusPicker] = useState<{ agency: Agency; status: 'suspended' | 'revoked' } | null>(null);
  const [fundingPicker, setFundingPicker] = useState<{ request: FundingRequest; decision: 'approved' | 'rejected' } | null>(null);
  const [freezePicker, setFreezePicker] = useState<Agency | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [agencyRes, agentRes, fundingRes] = await Promise.all([
        supabase.from('agencies').select('*').order('created_at', { ascending: false }),
        supabase
          .from('agents')
          .select('id, user_id, agency_id, status, wallet_usd, coin_inventory, commission_rate, total_users, total_deposit_usd, total_withdrawal_usd, wallet_frozen_at, user:users!agents_user_id_fkey(username, display_name, phone)')
          .order('created_at', { ascending: false }),
        supabase
          .from('agent_funding_requests')
          .select('id, requester_kind, agent_id, agency_id, amount_usd, reason, status, decision_note, created_at')
          .order('created_at', { ascending: false })
          .limit(120),
      ]);
      const failure = agencyRes.error ?? agentRes.error ?? fundingRes.error;
      if (failure) throw failure;

      const agencyRows = (agencyRes.data ?? []) as Agency[];
      setAgencies(agencyRows);
      setAgents(((agentRes.data ?? []) as Array<AgencyAgent & { user: AgencyAgent['user'] | AgencyAgent['user'][] }>).map((row) => ({
        ...row,
        user: Array.isArray(row.user) ? row.user[0] ?? null : row.user,
      })));
      setFunding((fundingRes.data ?? []) as FundingRequest[]);

      const ownerIds = [...new Set(agencyRows.map((row) => row.owner_user_id).filter(Boolean))] as string[];
      if (ownerIds.length > 0) {
        const { data: users } = await supabase
          .from('users')
          .select('id, username, display_name, phone, role')
          .in('id', ownerIds);
        const map: Record<string, UserOption> = {};
        ((users ?? []) as UserOption[]).forEach((user) => { map[user.id] = user; });
        setManagers(map);
      } else {
        setManagers({});
      }
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'تعذر تحميل بيانات الوكالات.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const call = async (body: Record<string, unknown>, successMessage: string, identifier: string) => {
    setBusy(identifier);
    try {
      await callFunction('admin-agencies', body);
      toast.success(successMessage);
      await load();
      return true;
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'تعذر تنفيذ الإجراء.');
      return false;
    } finally {
      setBusy(null);
    }
  };

  const visible = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return agencies.filter((agency) => {
      if (statusFilter !== 'all' && agency.status !== statusFilter) return false;
      if (!term) return true;
      const manager = agency.owner_user_id ? managers[agency.owner_user_id] : null;
      return [agency.name, manager?.username, manager?.display_name, manager?.phone]
        .some((value) => value?.toLocaleLowerCase().includes(term));
    });
  }, [agencies, managers, search, statusFilter]);

  const pendingFunding = useMemo(
    () => funding.filter((request) => request.status === 'pending').sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [funding],
  );
  const fundingHistory = useMemo(() => funding.filter((request) => request.status !== 'pending'), [funding]);

  const kpis = useMemo(() => ({
    total: agencies.length,
    active: agencies.filter((agency) => agency.status === 'active').length,
    agents: agents.length,
    wallets: agencies.reduce((sum, agency) => sum + Number(agency.wallet_usd), 0)
      + agents.reduce((sum, agent) => sum + Number(agent.wallet_usd), 0),
  }), [agencies, agents]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="الوكالات والوكلاء"
        subtitle="هرمية مالية معزولة: الإدارة العليا ← مدير الوكالة ← الوكيل ← المستخدمون. لا رصيد بلا قيد في الدفتر."
        actions={(
          <>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs text-gray-300 transition hover:bg-white/[0.06] disabled:opacity-50"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              تحديث
            </button>
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-wattar-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-wattar-500"
            >
              <Plus size={16} />
              وكالة جديدة
            </button>
          </>
        )}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={Building2} label="الوكالات" value={String(kpis.total)} hint={`${kpis.active} معتمدة`} />
        <KpiCard icon={UserCheck} label="الوكلاء" value={String(kpis.agents)} hint="كل الوكلاء المسجّلين" />
        <KpiCard icon={Wallet} label="أرصدة المحافظ" value={`$${kpis.wallets.toFixed(2)}`} hint="وكالات + وكلاء" />
        <KpiCard icon={CircleDollarSign} label="طلبات تمويل معلّقة" value={String(pendingFunding.length)} hint="تحتاج قراراً" tone={pendingFunding.length ? 'warning' : 'default'} />
      </div>

      <SectionCard
        title="البحث والتصفية"
        icon={Search}
        description="اعرض الوكالات حسب الحالة أو ابحث باسم الوكالة أو مديرها."
      >
        <div className="flex flex-wrap items-end gap-3">
          <label className="relative block min-w-[240px] flex-1">
            <span className="mb-1.5 block text-sm font-medium text-gray-200">بحث</span>
            <Search className="absolute right-3 top-[2.55rem] -translate-y-1/2 text-gray-500" size={17} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="اسم الوكالة أو اسم المدير أو هاتفه…"
              className="w-full rounded-xl border border-white/[0.08] bg-[#111424] py-2.5 pr-10 pl-3 text-sm text-white outline-none transition placeholder:text-gray-600 focus:border-wattar-400/60"
            />
          </label>
          <div className="w-full sm:w-52">
            <SelectField
              label="حالة الوكالة"
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: 'all', label: 'كل الحالات' },
                { value: 'pending', label: 'بانتظار الاعتماد' },
                { value: 'active', label: 'معتمدة' },
                { value: 'suspended', label: 'موقوفة' },
                { value: 'revoked', label: 'ملغى اعتمادها' },
              ]}
            />
          </div>
        </div>
      </SectionCard>

      {pendingFunding.length > 0 && (
        <SectionCard
          title="طلبات التمويل المعلّقة"
          icon={CircleDollarSign}
          tone="warning"
          description="الوكيل أو مدير الوكالة يطلب تمويلاً عندما لا يكفي رصيده. الاعتماد يشحن المحفظة فوراً بقيد في الدفتر."
        >
          <div className="divide-y divide-white/[0.06]">
            {pendingFunding.map((request) => {
              const agency = agencies.find((row) => row.id === request.agency_id);
              const agent = agents.find((row) => row.id === request.agent_id);
              const target = request.requester_kind === 'agency'
                ? `وكالة: ${agency?.name ?? '—'}`
                : `وكيل: ${agent?.user?.display_name ?? agent?.user?.username ?? '—'}`;
              return (
                <div key={request.id} className="flex flex-wrap items-center gap-3 py-3">
                  <Badge tone="info">${Number(request.amount_usd).toFixed(2)}</Badge>
                  <span className="text-sm text-gray-100">{target}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-gray-400">{request.reason}</span>
                  <span className="text-[11px] text-gray-500">{new Date(request.created_at).toLocaleString('ar', { dateStyle: 'short', timeStyle: 'short' })}</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void call(
                        { action: 'decide_funding', request_id: request.id, decision: 'approved' },
                        'تم اعتماد التمويل وشحن المحفظة.',
                        `funding-${request.id}`,
                      )}
                      className="inline-flex items-center gap-1 rounded-lg bg-emerald-600/90 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
                    >
                      {busy === `funding-${request.id}` ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                      اعتماد وتمويل
                    </button>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => setFundingPicker({ request, decision: 'rejected' })}
                      className="inline-flex items-center gap-1 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-bold text-red-300 transition hover:bg-red-500/20 disabled:opacity-50"
                    >
                      <X size={13} />
                      رفض
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}

      {fundingHistory.length > 0 && (
        <SectionCard
          title={`سجل طلبات التمويل (${fundingHistory.length})`}
          icon={History}
          description="كل القرارات السابقة — المعتمد والمرفوض والملغى — مع سبب القرار كما سُجّل."
        >
          <div className="max-h-[380px] divide-y divide-white/[0.06] overflow-y-auto">
            {fundingHistory.map((request) => {
              const agency = agencies.find((row) => row.id === request.agency_id);
              const agent = agents.find((row) => row.id === request.agent_id);
              const target = request.requester_kind === 'agency'
                ? `وكالة: ${agency?.name ?? '—'}`
                : `وكيل: ${agent?.user?.display_name ?? agent?.user?.username ?? '—'}`;
              return (
                <div key={request.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <Badge tone={FUNDING_STATUS_TONES[request.status] ?? 'neutral'}>
                    {FUNDING_STATUS_LABELS[request.status] ?? request.status}
                  </Badge>
                  <Badge tone="info">${Number(request.amount_usd).toFixed(2)}</Badge>
                  <span className="text-sm text-gray-100">{target}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-gray-400">
                    {request.decision_note ? `القرار: ${request.decision_note}` : request.reason}
                  </span>
                  <span className="text-[11px] text-gray-500">{new Date(request.created_at).toLocaleString('ar', { dateStyle: 'short', timeStyle: 'short' })}</span>
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}

      <SectionCard
        title={`الوكالات (${visible.length})`}
        icon={Building2}
        description="اعتماد، تعليق، إدارة مدير ووكلاء، وتمويل المحافظ — كل قرار يحتاج سبباً ويُسجَّل في سجل التدقيق."
      >
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-gray-400">
            <Loader2 size={16} className="animate-spin" /> جارٍ التحميل…
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            title={agencies.length === 0 ? 'لا توجد وكالات بعد' : 'لا نتائج مطابقة'}
            description={agencies.length === 0 ? 'ابدأ بإنشاء وكالة ثم اعتمادها وربط الوكلاء بها.' : 'جرّب تغيير كلمة البحث أو الحالة.'}
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {visible.map((agency) => {
              const agencyAgents = agents.filter((agent) => agent.agency_id === agency.id);
              const manager = agency.owner_user_id ? managers[agency.owner_user_id] : null;
              return (
                <article key={agency.id} className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-base font-semibold text-white">{agency.name}</h3>
                        <Badge tone={STATUS_TONE[agency.status]}>{STATUS_LABELS[agency.status]}</Badge>
                        {agency.wallet_frozen_at ? <Badge tone="danger"><Snowflake size={11} /> محفظة مجمّدة</Badge> : null}
                      </div>
                      <p className="mt-1 text-xs text-gray-400">
                        المدير: {manager?.display_name ?? manager?.username ?? 'غير معيَّن'}
                        {manager?.phone ? ` · ${manager.phone}` : ''}
                      </p>
                    </div>
                    <div className="text-left">
                      <p className="text-[11px] text-gray-500">رصيد المحفظة</p>
                      <p className="text-lg font-bold text-wattar-200">${Number(agency.wallet_usd).toFixed(2)}</p>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-gray-400 sm:grid-cols-4">
                    <div className="rounded-lg bg-white/[0.03] px-2 py-1.5">
                      <p className="text-gray-500">الوكلاء</p>
                      <p className="mt-0.5 text-sm font-semibold text-gray-100">{agencyAgents.length}{agency.max_agents > 0 ? ` / ${agency.max_agents}` : ''}</p>
                    </div>
                    <div className="rounded-lg bg-white/[0.03] px-2 py-1.5">
                      <p className="text-gray-500">عمولة الوكالة</p>
                      <p className="mt-0.5 text-sm font-semibold text-gray-100">{Number(agency.commission_rate)}%</p>
                    </div>
                    <div className="rounded-lg bg-white/[0.03] px-2 py-1.5">
                      <p className="text-gray-500">عمولة الوكلاء</p>
                      <p className="mt-0.5 text-sm font-semibold text-gray-100">{Number(agency.agent_commission_rate)}%</p>
                    </div>
                    <div className="rounded-lg bg-white/[0.03] px-2 py-1.5">
                      <p className="text-gray-500">حد الشحن اليومي</p>
                      <p className="mt-0.5 text-sm font-semibold text-gray-100">
                        {Number(agency.daily_deposit_limit_usd) > 0 ? `$${Number(agency.daily_deposit_limit_usd)}` : 'بلا حد'}
                      </p>
                    </div>
                  </div>

                  {agency.wallet_frozen_at ? (
                    <p className="mt-3 rounded-lg border border-red-500/20 bg-red-500/[0.07] px-3 py-2 text-[11px] text-red-200">
                      المحفظة مجمّدة: {agency.wallet_frozen_reason ?? 'بدون سبب مسجّل'}
                    </p>
                  ) : null}

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setManageAgency(agency)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-gray-200 transition hover:bg-white/[0.06]"
                    >
                      إدارة الوكالة
                    </button>
                    {agency.status === 'pending' && (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void call({ action: 'set_status', agency_id: agency.id, status: 'active', reason: 'اعتماد الوكالة' }, 'تم اعتماد الوكالة.', `status-${agency.id}`)}
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-600/90 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
                      >
                        {busy === `status-${agency.id}` ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                        اعتماد
                      </button>
                    )}
                    {agency.status === 'suspended' && (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void call({ action: 'set_status', agency_id: agency.id, status: 'active', reason: 'رفع الإيقاف' }, 'تمت إعادة تفعيل الوكالة.', `status-${agency.id}`)}
                        className="rounded-lg bg-emerald-600/90 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
                      >
                        إعادة تفعيل
                      </button>
                    )}
                    {agency.status === 'active' && (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => setStatusPicker({ agency, status: 'suspended' })}
                        className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-bold text-amber-300 transition hover:bg-amber-500/20 disabled:opacity-50"
                      >
                        تعليق
                      </button>
                    )}
                    {agency.status !== 'revoked' && (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => setStatusPicker({ agency, status: 'revoked' })}
                        className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-bold text-red-300 transition hover:bg-red-500/20 disabled:opacity-50"
                      >
                        إلغاء الاعتماد
                      </button>
                    )}
                    <span className="flex-1" />
                    <button
                      type="button"
                      onClick={() => setLedgerAgency(agency)}
                      className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] text-gray-300 transition hover:bg-white/[0.06]"
                    >
                      <BookOpen size={12} />
                      دفتر المحفظة
                    </button>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => setFreezePicker(agency)}
                      className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] text-gray-300 transition hover:bg-white/[0.06] disabled:opacity-50"
                    >
                      <Snowflake size={12} />
                      {agency.wallet_frozen_at ? 'فك التجميد' : 'تجميد المحفظة'}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </SectionCard>

      {createOpen && (
        <CreateAgencyModal
          busy={busy === 'create'}
          onClose={() => setCreateOpen(false)}
          onSubmit={async (payload) => {
            const ok = await call({ action: 'create', ...payload }, 'أُنشئت الوكالة بحالة «بانتظار الاعتماد».', 'create');
            if (ok) setCreateOpen(false);
          }}
        />
      )}

      {manageAgency && (
        <ManageAgencyModal
          agency={manageAgency}
          agents={agents}
          busy={busy}
          managers={managers}
          onClose={() => setManageAgency(null)}
          onCall={call}
        />
      )}

      {statusPicker && (
        <ReasonPickerModal
          title={statusPicker.status === 'suspended' ? 'تعليق الوكالة' : 'إلغاء اعتماد الوكالة'}
          subtitle={statusPicker.agency.name}
          description={statusPicker.status === 'suspended'
            ? 'التعليق يوقف وكلاء الوكالة عن العمل التشغيلي فوراً. اختر سبباً جاهزاً.'
            : 'إلغاء الاعتماد نهائي ويوقف كل وكلاء الوكالة. اختر سبباً جاهزاً.'}
          options={statusPicker.status === 'suspended' ? suspendReasons : revokeReasons}
          confirmLabel={statusPicker.status === 'suspended' ? 'تأكيد التعليق' : 'تأكيد الإلغاء'}
          tone="danger"
          processing={busy === `status-${statusPicker.agency.id}`}
          onClose={() => { if (!busy) setStatusPicker(null); }}
          onSubmit={(reason) => {
            const picker = statusPicker;
            setStatusPicker(null);
            void call(
              { action: 'set_status', agency_id: picker.agency.id, status: picker.status, reason },
              picker.status === 'suspended' ? 'تم تعليق الوكالة.' : 'تم إلغاء اعتماد الوكالة.',
              `status-${picker.agency.id}`,
            );
          }}
        />
      )}

      {fundingPicker && (
        <ReasonPickerModal
          title="رفض طلب التمويل"
          subtitle={`$${Number(fundingPicker.request.amount_usd).toFixed(2)}`}
          description="سيُبلَّغ الطالب بالسبب ويُسجَّل القرار في سجل التدقيق."
          options={fundingRejectReasons}
          confirmLabel="تأكيد الرفض"
          tone="danger"
          processing={busy === `funding-${fundingPicker.request.id}`}
          onClose={() => { if (!busy) setFundingPicker(null); }}
          onSubmit={(reason) => {
            const picker = fundingPicker;
            setFundingPicker(null);
            void call(
              { action: 'decide_funding', request_id: picker.request.id, decision: 'rejected', note: reason },
              'تم رفض طلب التمويل.',
              `funding-${picker.request.id}`,
            );
          }}
        />
      )}

      {freezePicker && (
        <ReasonPickerModal
          title={freezePicker.wallet_frozen_at ? 'فك تجميد محفظة الوكالة' : 'تجميد محفظة الوكالة'}
          subtitle={freezePicker.name}
          description={freezePicker.wallet_frozen_at
            ? 'يستأنف كل عمل الوكالة المالي بعد فك التجميد.'
            : 'التجميد يوقف كل الحركات المالية للوكالة ووكلائها فوراً.'}
          options={freezePicker.wallet_frozen_at ? agencyUnfreezeReasons : agencyFreezeReasons}
          confirmLabel={freezePicker.wallet_frozen_at ? 'تأكيد فك التجميد' : 'تأكيد التجميد'}
          tone={freezePicker.wallet_frozen_at ? 'info' : 'warning'}
          processing={busy === `freeze-${freezePicker.id}`}
          onClose={() => { if (!busy) setFreezePicker(null); }}
          onSubmit={(reason) => {
            const target = freezePicker;
            setFreezePicker(null);
            void call(
              { action: 'freeze_wallet', kind: 'agency', id: target.id, frozen: !target.wallet_frozen_at, reason },
              target.wallet_frozen_at ? 'تم فك تجميد المحفظة.' : 'تم تجميد المحفظة.',
              `freeze-${target.id}`,
            );
          }}
        />
      )}

      {ledgerAgency && (
        <LedgerModal
          kind="agency"
          targetId={ledgerAgency.id}
          title="دفتر محفظة الوكالة"
          subtitle={`${ledgerAgency.name} — الرصيد الحالي $${Number(ledgerAgency.wallet_usd).toFixed(2)}`}
          onClose={() => setLedgerAgency(null)}
        />
      )}
    </div>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = 'default',
}: {
  icon: typeof Building2;
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'warning';
}) {
  return (
    <div className={`rounded-2xl border p-4 ${tone === 'warning' ? 'border-amber-400/25 bg-amber-400/[0.05]' : 'border-white/[0.07] bg-[#171a2c]'}`}>
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <Icon size={15} className={tone === 'warning' ? 'text-amber-300' : 'text-wattar-300'} />
        {label}
      </div>
      <p className="mt-2 text-2xl font-bold text-white">{value}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-gray-500">{hint}</p> : null}
    </div>
  );
}

function CreateAgencyModal({
  busy,
  onClose,
  onSubmit,
}: {
  busy: boolean;
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [commission, setCommission] = useState('20');
  const [agentCommission, setAgentCommission] = useState('10');
  const [depositLimit, setDepositLimit] = useState('0');
  const [withdrawLimit, setWithdrawLimit] = useState('0');
  const [maxAgents, setMaxAgents] = useState('10');
  const [approveHosts, setApproveHosts] = useState(false);
  const [createAgents, setCreateAgents] = useState(true);
  const [manager, setManager] = useState<UserOption | null>(null);
  const [search, setSearch] = useState('');
  const [options, setOptions] = useState<UserOption[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const term = search.trim();
    if (term.length < 2) {
      setOptions([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const { data, error } = await supabase
          .from('users')
          .select('id, username, display_name, phone, role')
          .or(`username.ilike.%${term}%,display_name.ilike.%${term}%,phone.ilike.%${term}%`)
          .eq('status', 'active')
          .limit(6);
        if (error) throw error;
        setOptions((data ?? []) as UserOption[]);
      } catch {
        setOptions([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  const valid = name.trim().length >= 2;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/[0.08] bg-[#171a2c]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/[0.07] p-5">
          <div>
            <h2 className="text-lg font-semibold text-white">وكالة جديدة</h2>
            <p className="mt-1 text-xs text-gray-400">تُنشأ بحالة «بانتظار الاعتماد» — لا تعمل مالياً حتى تعتمدها.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white" aria-label="إغلاق"><X size={20} /></button>
        </div>

        <div className="space-y-4 p-5">
          <TextField label="اسم الوكالة" value={name} onChange={setName} placeholder="مثال: وكالة الشام" />

          <div>
            <p className="mb-2 text-sm font-medium text-gray-200">مدير الوكالة (اختياري الآن)</p>
            {manager ? (
              <div className="flex items-center justify-between rounded-xl border border-wattar-500/30 bg-wattar-600/10 px-3 py-2.5">
                <span className="text-sm text-white">
                  {manager.display_name ?? manager.username}
                  <span className="mr-2 text-xs text-gray-400">@{manager.username}</span>
                </span>
                <button type="button" onClick={() => setManager(null)} className="text-gray-400 hover:text-white"><X size={16} /></button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="ابحث بالاسم أو الهاتف لتعيين المدير…"
                    className="w-full rounded-xl border border-white/[0.08] bg-[#111424] py-2.5 pr-10 pl-3 text-sm text-white placeholder:text-gray-600 focus:border-wattar-400/60 focus:outline-none"
                  />
                  {searching ? <Loader2 size={15} className="absolute left-3 top-1/2 -translate-y-1/2 animate-spin text-gray-500" /> : null}
                </div>
                {options.length > 0 && (
                  <div className="mt-2 space-y-1 rounded-xl border border-white/[0.07] bg-[#111424] p-2">
                    {options.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => { setManager(option); setOptions([]); setSearch(''); }}
                        className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-right text-sm text-gray-200 hover:bg-white/[0.05]"
                      >
                        <span>{option.display_name ?? option.username}</span>
                        <span className="text-xs text-gray-500">@{option.username}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
            <p className="mt-1.5 text-[11px] text-gray-500">سيُرفع دور المدير إلى «مدير وكالة» تلقائياً.</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <NumberField label="عمولة الوكالة" value={commission} onChange={setCommission} unit="%" min={0} max={100} />
            <NumberField label="عمولة الوكلاء الافتراضية" value={agentCommission} onChange={setAgentCommission} unit="%" min={0} max={100} />
            <NumberField label="حد الشحن اليومي" description="0 = بلا حد" value={depositLimit} onChange={setDepositLimit} unit="$" min={0} />
            <NumberField label="حد السحب اليومي" description="0 = بلا حد" value={withdrawLimit} onChange={setWithdrawLimit} unit="$" min={0} />
            <NumberField label="أقصى عدد وكلاء" description="0 = بلا حد" value={maxAgents} onChange={setMaxAgents} min={0} />
          </div>

          <div className="space-y-2">
            <Toggle label="تستطيع الوكالة اعتماد مضيفات" checked={approveHosts} onChange={setApproveHosts} />
            <Toggle label="تستطيع الوكالة إنشاء وكلاء" checked={createAgents} onChange={setCreateAgents} />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} disabled={busy} className="rounded-xl border border-white/[0.08] px-4 py-2 text-sm text-gray-300 hover:bg-white/[0.04] disabled:opacity-50">إلغاء</button>
            <button
              onClick={() => void onSubmit({
                name: name.trim(),
                user_id: manager?.id ?? null,
                commission_rate: Number(commission) || 0,
                agent_commission_rate: Number(agentCommission) || 0,
                daily_deposit_limit_usd: Number(depositLimit) || 0,
                daily_withdrawal_limit_usd: Number(withdrawLimit) || 0,
                max_agents: Number(maxAgents) || 0,
                can_approve_hosts: approveHosts,
                can_create_agents: createAgents,
                reason: 'إنشاء وكالة',
              })}
              disabled={!valid || busy}
              className="flex min-w-32 items-center justify-center gap-2 rounded-xl bg-wattar-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-wattar-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              إنشاء الوكالة
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ManageAgencyModal({
  agency,
  agents,
  managers,
  busy,
  onClose,
  onCall,
}: {
  agency: Agency;
  agents: AgencyAgent[];
  managers: Record<string, UserOption>;
  busy: string | null;
  onClose: () => void;
  onCall: (body: Record<string, unknown>, message: string, identifier: string) => Promise<boolean>;
}) {
  const [tab, setTab] = useState<'settings' | 'team' | 'wallet'>('settings');
  const [name, setName] = useState(agency.name);
  const [commission, setCommission] = useState(String(Number(agency.commission_rate)));
  const [agentCommission, setAgentCommission] = useState(String(Number(agency.agent_commission_rate)));
  const [depositLimit, setDepositLimit] = useState(String(Number(agency.daily_deposit_limit_usd)));
  const [withdrawLimit, setWithdrawLimit] = useState(String(Number(agency.daily_withdrawal_limit_usd)));
  const [maxAgents, setMaxAgents] = useState(String(Number(agency.max_agents)));
  const [approveHosts, setApproveHosts] = useState(agency.can_approve_hosts);
  const [createAgents, setCreateAgents] = useState(agency.can_create_agents);

  const [managerSearch, setManagerSearch] = useState('');
  const [managerOptions, setManagerOptions] = useState<UserOption[]>([]);
  const [managerTarget, setManagerTarget] = useState<UserOption | null>(null);

  const [amount, setAmount] = useState('');
  const [walletReason, setWalletReason] = useState(walletReasons[0]);
  const [targetAgent, setTargetAgent] = useState('');

  const [agentLedger, setAgentLedger] = useState<AgencyAgent | null>(null);
  const [agentFreeze, setAgentFreeze] = useState<AgencyAgent | null>(null);
  const [agentAdjust, setAgentAdjust] = useState<AgencyAgent | null>(null);
  const [agencyLedgerOpen, setAgencyLedgerOpen] = useState(false);

  const agencyAgents = agents.filter((agent) => agent.agency_id === agency.id);
  const unassigned = agents.filter((agent) => !agent.agency_id);
  const manager = agency.owner_user_id ? managers[agency.owner_user_id] : null;
  const identifier = `agency-${agency.id}`;

  useEffect(() => {
    const term = managerSearch.trim();
    if (term.length < 2) { setManagerOptions([]); return; }
    const timer = setTimeout(async () => {
      try {
        const { data } = await supabase
          .from('users')
          .select('id, username, display_name, phone, role')
          .or(`username.ilike.%${term}%,display_name.ilike.%${term}%,phone.ilike.%${term}%`)
          .eq('status', 'active')
          .limit(6);
        setManagerOptions((data ?? []) as UserOption[]);
      } catch { setManagerOptions([]); }
    }, 350);
    return () => clearTimeout(timer);
  }, [managerSearch]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/[0.08] bg-[#171a2c]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-white/[0.07] p-5">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-white">{agency.name}</h2>
              <Badge tone={STATUS_TONE[agency.status]}>{STATUS_LABELS[agency.status]}</Badge>
            </div>
            <p className="mt-1 text-xs text-gray-400">
              الرصيد ${Number(agency.wallet_usd).toFixed(2)} · المدير {manager?.display_name ?? manager?.username ?? 'غير معيَّن'}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white" aria-label="إغلاق"><X size={20} /></button>
        </div>

        <div className="border-b border-white/[0.07] p-4">
          <Segmented
            options={[
              { label: 'البيانات والحدود', value: 'settings' },
              { label: 'المدير والوكلاء', value: 'team' },
              { label: 'المحفظة والتمويل', value: 'wallet' },
            ]}
            value={tab}
            onChange={setTab}
            columns={3}
          />
        </div>

        <div className="space-y-4 p-5">
          {tab === 'settings' && (
            <>
              <TextField label="اسم الوكالة" value={name} onChange={setName} />
              <div className="grid gap-3 sm:grid-cols-2">
                <NumberField label="عمولة الوكالة" value={commission} onChange={setCommission} unit="%" min={0} max={100} />
                <NumberField label="عمولة الوكلاء" value={agentCommission} onChange={setAgentCommission} unit="%" min={0} max={100} />
                <NumberField label="حد الشحن اليومي" description="0 = بلا حد" value={depositLimit} onChange={setDepositLimit} unit="$" min={0} />
                <NumberField label="حد السحب اليومي" description="0 = بلا حد" value={withdrawLimit} onChange={setWithdrawLimit} unit="$" min={0} />
                <NumberField label="أقصى عدد وكلاء" description="0 = بلا حد" value={maxAgents} onChange={setMaxAgents} min={0} />
              </div>
              <div className="space-y-2">
                <Toggle label="اعتماد مضيفات" checked={approveHosts} onChange={setApproveHosts} />
                <Toggle label="إنشاء وكلاء" checked={createAgents} onChange={setCreateAgents} />
              </div>
              <button
                type="button"
                disabled={busy === identifier}
                onClick={() => void onCall({
                  action: 'update',
                  agency_id: agency.id,
                  name: name.trim(),
                  commission_rate: Number(commission) || 0,
                  agent_commission_rate: Number(agentCommission) || 0,
                  daily_deposit_limit_usd: Number(depositLimit) || 0,
                  daily_withdrawal_limit_usd: Number(withdrawLimit) || 0,
                  max_agents: Number(maxAgents) || 0,
                  can_approve_hosts: approveHosts,
                  can_create_agents: createAgents,
                  reason: 'تعديل إعدادات الوكالة',
                }, 'تم تحديث إعدادات الوكالة.', identifier)}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-wattar-600 py-2.5 text-sm font-semibold text-white transition hover:bg-wattar-500 disabled:opacity-50"
              >
                {busy === identifier ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                حفظ التعديلات
              </button>
            </>
          )}

          {tab === 'team' && (
            <>
              <div>
                <p className="mb-2 text-sm font-medium text-gray-200">مدير الوكالة</p>
                {managerTarget ? (
                  <div className="flex items-center justify-between rounded-xl border border-wattar-500/30 bg-wattar-600/10 px-3 py-2.5">
                    <span className="text-sm text-white">{managerTarget.display_name ?? managerTarget.username}</span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={busy === identifier}
                        onClick={() => void onCall(
                          { action: 'assign_manager', agency_id: agency.id, user_id: managerTarget.id, reason: 'تعيين مدير وكالة' },
                          'تم تعيين مدير الوكالة.',
                          identifier,
                        ).then((ok) => { if (ok) setManagerTarget(null); })}
                        className="rounded-lg bg-emerald-600/90 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
                      >
                        تأكيد التعيين
                      </button>
                      <button type="button" onClick={() => setManagerTarget(null)} className="text-gray-400 hover:text-white"><X size={16} /></button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="relative">
                      <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
                      <input
                        value={managerSearch}
                        onChange={(event) => setManagerSearch(event.target.value)}
                        placeholder={manager ? `الحالي: ${manager.display_name ?? manager.username} — ابحث للتغيير…` : 'ابحث لتعيين مدير…'}
                        className="w-full rounded-xl border border-white/[0.08] bg-[#111424] py-2.5 pr-10 pl-3 text-sm text-white placeholder:text-gray-600 focus:border-wattar-400/60 focus:outline-none"
                      />
                    </div>
                    {managerOptions.length > 0 && (
                      <div className="mt-2 space-y-1 rounded-xl border border-white/[0.07] bg-[#111424] p-2">
                        {managerOptions.map((option) => (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() => { setManagerTarget(option); setManagerOptions([]); setManagerSearch(''); }}
                            className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-right text-sm text-gray-200 hover:bg-white/[0.05]"
                          >
                            <span>{option.display_name ?? option.username}</span>
                            <span className="text-xs text-gray-500">@{option.username}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-medium text-gray-200">وكلاء الوكالة ({agencyAgents.length})</p>
                  <span className="text-[11px] text-gray-500">الحد الأقصى {Number(agency.max_agents) > 0 ? agency.max_agents : 'بلا حد'}</span>
                </div>
                {agencyAgents.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-white/10 bg-white/[0.015] px-4 py-5 text-center text-xs text-gray-500">لا يوجد وكلاء بعد.</p>
                ) : (
                  <div className="divide-y divide-white/[0.06] rounded-xl border border-white/[0.07]">
                    {agencyAgents.map((agent) => (
                      <div key={agent.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                        <Users size={14} className="text-gray-500" />
                        <span className="text-sm text-gray-100">{agent.user?.display_name ?? agent.user?.username ?? 'وكيل'}</span>
                        <Badge tone={agent.wallet_frozen_at ? 'danger' : 'neutral'}>
                          {agent.wallet_frozen_at ? <Snowflake size={10} /> : null} ${Number(agent.wallet_usd).toFixed(2)}
                        </Badge>
                        <span className="flex-1" />
                        <button
                          type="button"
                          onClick={() => setAgentLedger(agent)}
                          className="rounded-md border border-white/10 px-2 py-1 text-[11px] text-gray-300 transition hover:bg-white/[0.06]"
                        >
                          دفتر
                        </button>
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => setAgentAdjust(agent)}
                          className="rounded-md border border-white/10 px-2 py-1 text-[11px] text-gray-300 transition hover:bg-white/[0.06] disabled:opacity-50"
                        >
                          تسوية
                        </button>
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => setAgentFreeze(agent)}
                          className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[11px] text-gray-300 transition hover:bg-white/[0.06] disabled:opacity-50"
                        >
                          <Snowflake size={11} />
                          {agent.wallet_frozen_at ? 'فك' : 'تجميد'}
                        </button>
                        <button
                          type="button"
                          disabled={busy === identifier}
                          onClick={() => void onCall(
                            { action: 'assign_agent', agent_id: agent.id, agency_id: null, reason: 'فصل الوكيل عن الوكالة' },
                            'تم فصل الوكيل عن الوكالة.',
                            identifier,
                          )}
                          className="text-[11px] text-gray-400 underline decoration-dotted hover:text-red-300"
                        >
                          فصل
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {unassigned.length > 0 && (
                <div>
                  <p className="mb-2 text-sm font-medium text-gray-200">ضم وكيل غير مرتبط</p>
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <SelectField
                        label="الوكيل"
                        value={targetAgent}
                        onChange={setTargetAgent}
                        options={[
                          { value: '', label: 'اختر وكيلاً…' },
                          ...unassigned.map((agent) => ({
                            value: agent.id,
                            label: `${agent.user?.display_name ?? agent.user?.username ?? 'وكيل'} — $${Number(agent.wallet_usd).toFixed(2)}`,
                          })),
                        ]}
                      />
                    </div>
                    <button
                      type="button"
                      disabled={!targetAgent || busy === identifier}
                      onClick={() => void onCall(
                        { action: 'assign_agent', agent_id: targetAgent, agency_id: agency.id, reason: 'ضم وكيل إلى الوكالة' },
                        'تم ضم الوكيل إلى الوكالة.',
                        identifier,
                      ).then((ok) => { if (ok) setTargetAgent(''); })}
                      className="h-[42px] rounded-xl bg-wattar-600 px-4 text-xs font-semibold text-white transition hover:bg-wattar-500 disabled:opacity-50"
                    >
                      ضم
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {tab === 'wallet' && (
            <>
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
                <p className="text-xs text-gray-500">رصيد محفظة الوكالة</p>
                <p className="mt-1 text-2xl font-bold text-wattar-200">${Number(agency.wallet_usd).toFixed(2)}</p>
                {agency.wallet_frozen_at ? (
                  <p className="mt-2 text-[11px] text-red-300">مجمّدة: {agency.wallet_frozen_reason ?? 'بدون سبب'}</p>
                ) : null}
                <button
                  type="button"
                  onClick={() => setAgencyLedgerOpen(true)}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-[11px] text-gray-300 transition hover:bg-white/[0.06]"
                >
                  <BookOpen size={12} />
                  دفتر محفظة الوكالة
                </button>
              </div>

              <div className="space-y-3 rounded-xl border border-white/[0.07] p-3">
                <p className="text-sm font-medium text-gray-200">شحن محفظة الوكالة</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <NumberField label="المبلغ" value={amount} onChange={setAmount} unit="$" min={1} />
                  <SelectField label="سبب التمويل" value={walletReason} onChange={setWalletReason} options={walletReasons.map((reason) => ({ value: reason, label: reason }))} />
                </div>
                <button
                  type="button"
                  disabled={!Number(amount) || busy === identifier}
                  onClick={() => void onCall(
                    { action: 'credit_agency', agency_id: agency.id, amount_usd: Number(amount), reason: walletReason, idempotency_key: crypto.randomUUID() },
                    'تم شحن محفظة الوكالة بقيد في الدفتر.',
                    identifier,
                  ).then((ok) => { if (ok) setAmount(''); })}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:opacity-50"
                >
                  <Wallet size={16} />
                  شحن المحفظة
                </button>
              </div>

              {agencyAgents.length > 0 && (
                <div className="space-y-3 rounded-xl border border-white/[0.07] p-3">
                  <p className="text-sm font-medium text-gray-200">تحويل إلى محفظة وكيل</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <SelectField
                      label="الوكيل"
                      value={targetAgent}
                      onChange={setTargetAgent}
                      options={[
                        { value: '', label: 'اختر وكيلاً…' },
                        ...agencyAgents.map((agent) => ({
                          value: agent.id,
                          label: `${agent.user?.display_name ?? agent.user?.username ?? 'وكيل'} — $${Number(agent.wallet_usd).toFixed(2)}`,
                        })),
                      ]}
                    />
                    <NumberField label="المبلغ" value={amount} onChange={setAmount} unit="$" min={1} />
                  </div>
                  <button
                    type="button"
                    disabled={!targetAgent || !Number(amount) || busy === identifier}
                    onClick={() => void onCall(
                      {
                        action: 'transfer_to_agent',
                        agency_id: agency.id,
                        agent_id: targetAgent,
                        amount_usd: Number(amount),
                        reason: walletReason,
                        idempotency_key: crypto.randomUUID(),
                      },
                      'تم التحويل إلى محفظة الوكيل بقيدين متقابلين.',
                      identifier,
                    ).then((ok) => { if (ok) setAmount(''); })}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-wattar-600 py-2.5 text-sm font-semibold text-white transition hover:bg-wattar-500 disabled:opacity-50"
                  >
                    <CircleDollarSign size={16} />
                    تحويل للوكيل
                  </button>
                </div>
              )}

              <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.05] p-3 text-[11px] leading-6 text-amber-200">
                <ShieldAlert size={13} className="mb-1 inline" /> كل حركة هنا تُكتب في دفتر محفظة منفصل مع رصيد قبل/بعد وسبب وفاعل، ولا يمكن حذفها.
              </div>
            </>
          )}
        </div>

        {agentLedger && (
          <LedgerModal
            kind="agent"
            targetId={agentLedger.id}
            title="دفتر محفظة الوكيل"
            subtitle={`${agentLedger.user?.display_name ?? agentLedger.user?.username ?? 'وكيل'} — الرصيد الحالي $${Number(agentLedger.wallet_usd).toFixed(2)}`}
            onClose={() => setAgentLedger(null)}
          />
        )}
        {agentFreeze && (
          <ReasonPickerModal
            title={agentFreeze.wallet_frozen_at ? 'فك تجميد محفظة الوكيل' : 'تجميد محفظة الوكيل'}
            subtitle={agentFreeze.user?.display_name ?? agentFreeze.user?.username ?? ''}
            description={agentFreeze.wallet_frozen_at
              ? 'يستأنف الوكيل الشحن والسحب فوراً بعد فك التجميد.'
              : 'التجميد يوقف كل حركة على محفظة الوكيل فوراً.'}
            options={agentFreeze.wallet_frozen_at ? agencyUnfreezeReasons : agencyFreezeReasons}
            confirmLabel={agentFreeze.wallet_frozen_at ? 'تأكيد فك التجميد' : 'تأكيد التجميد'}
            tone={agentFreeze.wallet_frozen_at ? 'info' : 'warning'}
            processing={busy === identifier}
            onClose={() => { if (!busy) setAgentFreeze(null); }}
            onSubmit={(reason) => {
              const target = agentFreeze;
              setAgentFreeze(null);
              void onCall(
                { action: 'freeze_wallet', kind: 'agent', id: target.id, frozen: !target.wallet_frozen_at, reason },
                target.wallet_frozen_at ? 'تم فك تجميد محفظة الوكيل.' : 'تم تجميد محفظة الوكيل.',
                identifier,
              );
            }}
          />
        )}
        {agentAdjust && (
          <AgencyAgentAdjustModal
            agent={agentAdjust}
            busy={busy !== null}
            onClose={() => setAgentAdjust(null)}
            onDone={() => setAgentAdjust(null)}
            onCall={onCall}
          />
        )}
        {agencyLedgerOpen && (
          <LedgerModal
            kind="agency"
            targetId={agency.id}
            title="دفتر محفظة الوكالة"
            subtitle={`${agency.name} — الرصيد الحالي $${Number(agency.wallet_usd).toFixed(2)}`}
            onClose={() => setAgencyLedgerOpen(false)}
          />
        )}
      </div>
    </div>
  );
}

function AgencyAgentAdjustModal({
  agent,
  busy,
  onClose,
  onDone,
  onCall,
}: {
  agent: AgencyAgent;
  busy: boolean;
  onClose: () => void;
  onDone: () => void;
  onCall: (body: Record<string, unknown>, message: string, identifier: string) => Promise<boolean>;
}) {
  const [direction, setDirection] = useState<'credit' | 'debit'>('credit');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState(agentAdjustReasonsAgency[0]);

  const value = Number(amount) || 0;
  const projected = direction === 'credit' ? Number(agent.wallet_usd) + value : Number(agent.wallet_usd) - value;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md rounded-2xl border border-white/[0.08] bg-[#171a2c]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-white/[0.07] p-5">
          <div>
            <h2 className="text-lg font-semibold text-white">تسوية محفظة الوكيل</h2>
            <p className="mt-1 text-xs text-gray-400">
              {agent.user?.display_name ?? agent.user?.username ?? 'وكيل'} — الرصيد الحالي ${Number(agent.wallet_usd).toFixed(2)}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-white" aria-label="إغلاق"><X size={20} /></button>
        </div>
        <div className="space-y-4 p-5">
          {agent.wallet_frozen_at ? (
            <p className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-200">
              المحفظة مجمّدة — يجب فك التجميد أولاً.
            </p>
          ) : null}
          <Segmented
            options={[
              { label: 'إضافة رصيد +', value: 'credit' },
              { label: 'خصم رصيد −', value: 'debit' },
            ]}
            value={direction}
            onChange={setDirection}
            columns={2}
          />
          <NumberField label="المبلغ" value={amount} onChange={setAmount} unit="$" min={1} />
          <div>
            <p className="mb-2 text-sm font-medium text-gray-200">سبب التسوية</p>
            <div className="space-y-2">
              {agentAdjustReasonsAgency.map((option) => (
                <button
                  key={option}
                  type="button"
                  disabled={busy}
                  onClick={() => setReason(option)}
                  className={`block w-full rounded-xl border px-3 py-2 text-right text-xs transition ${
                    reason === option
                      ? 'border-wattar-400/50 bg-wattar-600/20 font-semibold text-white'
                      : 'border-white/[0.07] bg-white/[0.02] text-gray-300 hover:border-white/15'
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
          <p className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2 text-xs text-gray-300">
            الرصيد بعد التسوية: <span className={`font-bold ${projected < 0 ? 'text-red-300' : 'text-white'}`}>${projected.toFixed(2)}</span>
            {projected < 0 ? ' — لا يمكن أن يصبح الرصيد سالباً.' : ''}
          </p>
          <button
            type="button"
            disabled={busy || value <= 0 || projected < 0 || Boolean(agent.wallet_frozen_at)}
            onClick={() => void onCall(
              {
                action: 'adjust_agent_wallet',
                agent_id: agent.id,
                amount_usd: direction === 'credit' ? value : -value,
                reason,
                idempotency_key: crypto.randomUUID(),
              },
              'نُفّذت التسوية بقيد في دفتر محفظة الوكيل.',
              `adjust-${agent.id}`,
            ).then((ok) => { if (ok) onDone(); })}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-wattar-600 py-2.5 text-sm font-semibold text-white transition hover:bg-wattar-500 disabled:opacity-50"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Wallet size={16} />}
            تنفيذ التسوية بقيد
          </button>
        </div>
      </div>
    </div>
  );
}