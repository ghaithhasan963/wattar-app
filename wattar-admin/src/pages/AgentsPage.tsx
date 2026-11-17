/**
 * Wattar Admin — صفحة الوكلاء (M5)
 * قائمة + إنشاء وكيل + صلاحيات وعمولة + حدود تشغيلية + محفظة ودفتر + تجميد.
 * كل الكتابة عبر دوال مدقَّقة، وكل خيار بضغطة زر (لا كتابة true/false).
 */
import { useCallback, useEffect, useState } from 'react';
import { supabase, callFunction } from '@/lib/supabase';
import {
  BookOpen,
  DollarSign,
  FileText,
  Loader2,
  Plus,
  Settings2,
  Shield,
  ShieldOff,
  Snowflake,
  Wallet,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge, EmptyState, NumberField, Segmented, Toggle } from '@/components/ui';
import { ReasonPickerModal } from '@/components/ReasonPicker';
import { LedgerModal } from '@/components/LedgerModal';

const suspendReasons = [
  'مخالفة شروط العمل كوسيط',
  'تأخر في تسوية مستحقات العملاء',
  'شكاوى متكررة من المستخدمين',
  'عدم مطابقة السجلات المالية',
];

const banReasons = [
  'احتيال أو تلاعب مالي مؤكد',
  'استخدام بيانات مستخدمين دون إذن',
  'تسريب بيانات أو مخالفة قانونية',
  'تكرار المخالفات بعد الإيقاف',
];

const settingsReasons = [
  'تحديث العمولة اتفاقياً',
  'تعديل الحدود التشغيلية',
  'تحديث صلاحيات الوكيل',
  'تسوية مالية دورية',
];

const walletAdjustReasons = [
  'تسوية فرق مالي مؤكد',
  'تغطية طلبات سحب معلّقة',
  'تصحيح قيد خاطئ',
  'تحويل من وكالة الوكيل',
];

const freezeReasons = [
  'مراجعة مالية عاجلة',
  'شبهة تلاعب بالسجلات',
  'مطابقة جرد المخزون',
];

const unfreezeReasons = [
  'انتهت المراجعة المالية',
  'تأكدت سلامة السجلات',
];

const prepaySources = ['تحويل بنكي', 'شام كاش', 'سيرياتيل كاش', 'USDT', 'نقداً في المكتب'];

interface Agent {
  id: string;
  user_id: string;
  agency_id: string | null;
  wallet_usd: number;
  coin_inventory: number;
  commission_rate: number;
  exchange_rate_usd_to_gold: number;
  daily_deposit_limit_usd: number;
  daily_withdrawal_limit_usd: number;
  min_operation_usd: number;
  max_operation_usd: number;
  max_users: number;
  credit_limit_usd: number;
  wallet_frozen_at: string | null;
  wallet_frozen_reason: string | null;
  can_create_users: boolean;
  can_approve_deposits: boolean;
  can_approve_withdrawals: boolean;
  can_set_user_rtp: boolean;
  can_force_outcome: boolean;
  can_suspend_users: boolean;
  total_users: number;
  total_deposit_usd: number;
  total_commission_usd: number;
  status: string;
  created_at: string;
  user: { username: string; display_name: string | null; phone: string | null; email: string | null } | null;
  agency: { name: string } | null;
}

type AgentPermissionKey =
  | 'can_create_users'
  | 'can_approve_deposits'
  | 'can_approve_withdrawals'
  | 'can_set_user_rtp'
  | 'can_force_outcome'
  | 'can_suspend_users';

type AgentPermissionFlags = Pick<Agent, AgentPermissionKey>;

const permissionOptions: Array<{ key: AgentPermissionKey; label: string; hint?: string }> = [
  { key: 'can_create_users', label: 'إنشاء حسابات العملاء' },
  { key: 'can_approve_deposits', label: 'مراجعة واعتماد طلبات الشحن' },
  { key: 'can_approve_withdrawals', label: 'مراجعة طلبات السحب' },
  { key: 'can_set_user_rtp', label: 'تعديل إعداد RTP للعملاء', hint: 'حساس' },
  { key: 'can_force_outcome', label: 'فرض نتيجة اللعبة', hint: 'حساس' },
  { key: 'can_suspend_users', label: 'إيقاف حسابات العملاء' },
];

export function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creditAgent, setCreditAgent] = useState<Agent | null>(null);
  const [settingsAgent, setSettingsAgent] = useState<Agent | null>(null);
  const [ledgerAgent, setLedgerAgent] = useState<Agent | null>(null);
  const [adjustAgent, setAdjustAgent] = useState<Agent | null>(null);
  const [freezeAgent, setFreezeAgent] = useState<Agent | null>(null);
  const [processingAgentId, setProcessingAgentId] = useState<string | null>(null);
  const [statusPicker, setStatusPicker] = useState<{ agent: Agent; status: 'suspended' | 'banned' } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('agents')
        .select(`
          id, user_id, agency_id, wallet_usd, coin_inventory, commission_rate, exchange_rate_usd_to_gold,
          daily_deposit_limit_usd, daily_withdrawal_limit_usd, min_operation_usd, max_operation_usd,
          max_users, credit_limit_usd, wallet_frozen_at, wallet_frozen_reason,
          can_create_users, can_approve_deposits, can_approve_withdrawals, can_set_user_rtp, can_force_outcome, can_suspend_users,
          total_users, total_deposit_usd, total_commission_usd, status, created_at,
          user:users!agents_user_id_fkey(username, display_name, phone, email),
          agency:agencies(name)
        `)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setAgents(((data ?? []) as Array<Agent & { user: Agent['user'] | Agent['user'][]; agency: Agent['agency'] | Agent['agency'][] }>).map((row) => ({
        ...row,
        user: Array.isArray(row.user) ? row.user[0] ?? null : row.user,
        agency: Array.isArray(row.agency) ? row.agency[0] ?? null : row.agency,
      })));
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'تعذر تحميل الوكلاء.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setAgentStatus = async (agent: Agent, status: 'active' | 'suspended' | 'banned', providedReason?: string) => {
    if (status !== 'active' && !providedReason) {
      setStatusPicker({ agent, status });
      return;
    }
    const reason = status === 'active' ? undefined : providedReason;
    if (status === 'active' && !window.confirm('هل تريد إعادة تفعيل دخول هذا الوكيل؟')) return;

    setProcessingAgentId(agent.id);
    try {
      await callFunction('admin-set-agent-status', {
        agent_id: agent.id,
        status,
        ...(reason ? { reason: reason.trim() } : {}),
      });
      toast.success(
        status === 'active'
          ? 'تمت إعادة تفعيل الوكيل.'
          : status === 'banned'
            ? 'تم حظر الوكيل.'
            : 'تم إيقاف/أرشفة الوكيل مع الاحتفاظ بسجلاته.',
      );
      await load();
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'تعذر تحديث حالة الوكيل.');
    } finally {
      setProcessingAgentId(null);
    }
  };

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">الوكلاء</h1>
          <p className="mt-1 text-sm text-gray-400">إنشاء وإدارة الوكلاء: صلاحيات، حدود، محافظ ودفاتر — كل قرار مدقَّق بسبب.</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 rounded-lg bg-wattar-600 px-4 py-2 text-sm font-medium text-white hover:bg-wattar-700"
        >
          <Plus size={18} />
          إنشاء وكيل جديد
        </button>
      </div>

      {loading ? (
        <p className="text-gray-400">جاري التحميل...</p>
      ) : agents.length === 0 ? (
        <EmptyState title="لا يوجد وكلاء بعد" description="ابدأ بإنشاء وكيل، أو أنشئ وكالة من صفحة «الوكالات» ثم اضمّه إليها." />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {agents.map((ag) => (
            <div key={ag.id} className="rounded-xl border border-wattar-900 bg-dark-surface p-5">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-white">{ag.user?.display_name ?? ag.user?.username}</p>
                  <p className="text-xs text-gray-500">البريد: {ag.user?.email ?? '—'} · الهاتف: {ag.user?.phone ?? '—'}</p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    الوكالة: {ag.agency?.name ?? 'مستقل — لم يُضم لوكالة'}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className={`rounded px-2 py-1 text-xs ${
                    ag.status === 'active'
                      ? 'bg-green-500/10 text-green-400'
                      : ag.status === 'banned'
                        ? 'bg-red-500/10 text-red-400'
                        : 'bg-amber-500/10 text-amber-300'
                  }`}>
                    {ag.status === 'active' ? 'نشط' : ag.status === 'banned' ? 'محظور' : 'موقوف'}
                  </span>
                  {ag.wallet_frozen_at ? <Badge tone="danger"><Snowflake size={11} /> محفظة مجمّدة</Badge> : null}
                </div>
              </div>

              <div className="mb-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                <Stat label="محفظة السحب" value={`$${Number(ag.wallet_usd).toFixed(2)}`} tone="gold" />
                <Stat label="مخزون Coin" value={Number(ag.coin_inventory).toLocaleString('ar')} />
                <Stat label="العمولة" value={`${Number(ag.commission_rate)}%`} />
                <Stat label="حد الشحن اليومي" value={Number(ag.daily_deposit_limit_usd) > 0 ? `$${Number(ag.daily_deposit_limit_usd)}` : 'بلا حد'} />
                <Stat label="حد السحب اليومي" value={Number(ag.daily_withdrawal_limit_usd) > 0 ? `$${Number(ag.daily_withdrawal_limit_usd)}` : 'بلا حد'} />
                <Stat label="العملية (أدنى/أقصى)" value={`${Number(ag.min_operation_usd) > 0 ? `$${Number(ag.min_operation_usd)}` : '—'} / ${Number(ag.max_operation_usd) > 0 ? `$${Number(ag.max_operation_usd)}` : '—'}`} />
                <Stat label="العملاء" value={`${Number(ag.total_users).toLocaleString('ar')}${Number(ag.max_users) > 0 ? ` / ${Number(ag.max_users)}` : ''}`} />
                <Stat label="إجمالي العمولات" value={`$${Number(ag.total_commission_usd).toFixed(2)}`} tone="green" />
                <Stat label="حد الائتمان" value={`$${Number(ag.credit_limit_usd).toFixed(2)}`} />
              </div>

              {ag.wallet_frozen_at ? (
                <p className="mb-3 rounded-lg border border-red-500/20 bg-red-500/[0.07] px-3 py-2 text-[11px] text-red-200">
                  المحفظة مجمّدة: {ag.wallet_frozen_reason ?? 'بدون سبب مسجّل'} — لا تُنفَّذ أي حركة مالية للوكيل.
                </p>
              ) : null}

              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  onClick={() => setSettingsAgent(ag)}
                  disabled={processingAgentId === ag.id}
                  className="flex items-center justify-center gap-2 rounded-lg border border-wattar-700/50 bg-dark-elevated py-2 text-sm text-gray-200 disabled:opacity-50 sm:col-span-2"
                >
                  <Settings2 size={16} />
                  الصلاحيات والعمولة والحدود
                </button>
                <button
                  onClick={() => setCreditAgent(ag)}
                  disabled={ag.status !== 'active'}
                  className="flex items-center justify-center gap-2 rounded-lg border border-wattar-600 bg-wattar-600/20 py-2 text-sm text-wattar-300 hover:bg-wattar-600/30 disabled:opacity-50"
                >
                  <DollarSign size={16} />
                  إضافة مخزون مدفوع مسبقاً
                </button>
                <button
                  onClick={() => setAdjustAgent(ag)}
                  disabled={processingAgentId === ag.id}
                  className="flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] py-2 text-sm text-gray-200 hover:bg-white/[0.06] disabled:opacity-50"
                >
                  <Wallet size={16} />
                  تسوية محفظة السحب
                </button>
                <button
                  onClick={() => setLedgerAgent(ag)}
                  className="flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] py-2 text-sm text-gray-200 hover:bg-white/[0.06]"
                >
                  <BookOpen size={16} />
                  دفتر المحفظة
                </button>
                <button
                  onClick={() => setFreezeAgent(ag)}
                  disabled={processingAgentId === ag.id}
                  className="flex items-center justify-center gap-2 rounded-lg border border-sky-500/30 bg-sky-500/10 py-2 text-sm text-sky-300 hover:bg-sky-500/20 disabled:opacity-50"
                >
                  <Snowflake size={16} />
                  {ag.wallet_frozen_at ? 'فك تجميد المحفظة' : 'تجميد المحفظة'}
                </button>
                {ag.status !== 'banned' && (
                  <button
                    onClick={() => void setAgentStatus(ag, ag.status === 'active' ? 'suspended' : 'active')}
                    disabled={processingAgentId === ag.id}
                    className="flex items-center justify-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 py-2 text-sm text-amber-300 disabled:opacity-50"
                  >
                    {processingAgentId === ag.id ? <Loader2 size={16} className="animate-spin" /> : <ShieldOff size={16} />}
                    {ag.status === 'active' ? 'إيقاف/أرشفة' : 'إعادة التفعيل'}
                  </button>
                )}
                {ag.status !== 'banned' && (
                  <button
                    onClick={() => void setAgentStatus(ag, 'banned')}
                    disabled={processingAgentId === ag.id}
                    className="flex items-center justify-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 py-2 text-sm text-red-300 disabled:opacity-50"
                  >
                    <Shield size={16} />
                    حظر الوكيل
                  </button>
                )}
                {ag.status === 'banned' && (
                  <button
                    onClick={() => void setAgentStatus(ag, 'active')}
                    disabled={processingAgentId === ag.id}
                    className="flex items-center justify-center gap-2 rounded-lg border border-green-500/30 bg-green-500/10 py-2 text-sm text-green-300 disabled:opacity-50"
                  >
                    إعادة تفعيل الوكيل
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreateModal && (
        <CreateAgentModal
          onClose={() => setShowCreateModal(false)}
          onCreated={() => {
            setShowCreateModal(false);
            load();
          }}
        />
      )}

      {creditAgent && (
        <CreditAgentModal
          agent={creditAgent}
          onClose={() => setCreditAgent(null)}
          onCredited={() => {
            setCreditAgent(null);
            load();
          }}
        />
      )}
      {settingsAgent && (
        <AgentSettingsModal
          agent={settingsAgent}
          onClose={() => setSettingsAgent(null)}
          onSaved={() => {
            setSettingsAgent(null);
            load();
          }}
        />
      )}
      {adjustAgent && (
        <AdjustWalletModal
          agent={adjustAgent}
          onClose={() => setAdjustAgent(null)}
          onSaved={() => {
            setAdjustAgent(null);
            load();
          }}
        />
      )}
      {ledgerAgent && (
        <LedgerModal
          kind="agent"
          targetId={ledgerAgent.id}
          title="دفتر محفظة الوكيل"
          subtitle={`${ledgerAgent.user?.display_name ?? ledgerAgent.user?.username} — الرصيد الحالي $${Number(ledgerAgent.wallet_usd).toFixed(2)}`}
          onClose={() => setLedgerAgent(null)}
        />
      )}
      {freezeAgent && (
        <ReasonPickerModal
          title={freezeAgent.wallet_frozen_at ? 'فك تجميد محفظة الوكيل' : 'تجميد محفظة الوكيل'}
          subtitle={freezeAgent.user?.display_name ?? freezeAgent.user?.username ?? ''}
          description={freezeAgent.wallet_frozen_at
            ? 'سيستطيع الوكيل تنفيذ الشحن والسحب فوراً بعد فك التجميد.'
            : 'التجميد يوقف كل حركة على محفظة الوكيل فوراً (شحن، سحب، تمويل).'}
          options={freezeAgent.wallet_frozen_at ? unfreezeReasons : freezeReasons}
          confirmLabel={freezeAgent.wallet_frozen_at ? 'تأكيد فك التجميد' : 'تأكيد التجميد'}
          tone={freezeAgent.wallet_frozen_at ? 'info' : 'warning'}
          processing={processingAgentId === freezeAgent.id}
          onClose={() => { if (!processingAgentId) setFreezeAgent(null); }}
          onSubmit={(reason) => {
            const target = freezeAgent;
            setFreezeAgent(null);
            void (async () => {
              setProcessingAgentId(target.id);
              try {
                await callFunction('admin-agencies', {
                  action: 'freeze_wallet',
                  kind: 'agent',
                  id: target.id,
                  frozen: !target.wallet_frozen_at,
                  reason,
                });
                toast.success(target.wallet_frozen_at ? 'تم فك تجميد المحفظة.' : 'تم تجميد المحفظة.');
                await load();
              } catch (error: unknown) {
                toast.error(error instanceof Error ? error.message : 'تعذر تحديث حالة المحفظة.');
              } finally {
                setProcessingAgentId(null);
              }
            })();
          }}
        />
      )}
      {statusPicker && (
        <ReasonPickerModal
          title={statusPicker.status === 'banned' ? 'حظر الوكيل نهائيًا' : 'إيقاف الوكيل مؤقتًا'}
          subtitle={`@${statusPicker.agent.user?.username ?? ''} · ${statusPicker.agent.user?.display_name ?? ''}`}
          description={statusPicker.status === 'banned'
            ? 'الحظر يمنع الوكيل من الدخول وكل صلاحياته. اختر سببًا جاهزًا ليُسجَّل في سجل التدقيق.'
            : 'الإيقاف مؤقت وقابل للتراجع. اختر سببًا جاهزًا ليُسجَّل في سجل التدقيق.'}
          options={statusPicker.status === 'banned' ? banReasons : suspendReasons}
          confirmLabel={statusPicker.status === 'banned' ? 'تأكيد الحظر' : 'تأكيد الإيقاف'}
          tone="danger"
          processing={processingAgentId === statusPicker.agent.id}
          onClose={() => {
            if (processingAgentId) return;
            setStatusPicker(null);
          }}
          onSubmit={(reason) => {
            const picker = statusPicker;
            setStatusPicker(null);
            void setAgentStatus(picker.agent, picker.status, reason);
          }}
        />
      )}
    </div>
  );
}

function Stat({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'gold' | 'green' }) {
  return (
    <div className="rounded-lg bg-white/[0.03] px-2.5 py-2">
      <p className="text-[11px] text-gray-500">{label}</p>
      <p className={`mt-0.5 text-sm font-semibold ${tone === 'gold' ? 'text-gold-500' : tone === 'green' ? 'text-green-400' : 'text-white'}`}>{value}</p>
    </div>
  );
}

function AgentSettingsModal({ agent, onClose, onSaved }: { agent: Agent; onClose: () => void; onSaved: () => void }) {
  const [tab, setTab] = useState<'money' | 'limits' | 'permissions'>('money');
  const [commissionRate, setCommissionRate] = useState(String(Number(agent.commission_rate)));
  const [exchangeRate, setExchangeRate] = useState(String(Number(agent.exchange_rate_usd_to_gold)));
  const [depositLimit, setDepositLimit] = useState(String(Number(agent.daily_deposit_limit_usd)));
  const [withdrawLimit, setWithdrawLimit] = useState(String(Number(agent.daily_withdrawal_limit_usd)));
  const [minOp, setMinOp] = useState(String(Number(agent.min_operation_usd)));
  const [maxOp, setMaxOp] = useState(String(Number(agent.max_operation_usd)));
  const [maxUsers, setMaxUsers] = useState(String(Number(agent.max_users)));
  const [creditLimit, setCreditLimit] = useState(String(Number(agent.credit_limit_usd)));
  const [permissions, setPermissions] = useState<AgentPermissionFlags>({
    can_create_users: agent.can_create_users,
    can_approve_deposits: agent.can_approve_deposits,
    can_approve_withdrawals: agent.can_approve_withdrawals,
    can_set_user_rtp: agent.can_set_user_rtp,
    can_force_outcome: agent.can_force_outcome,
    can_suspend_users: agent.can_suspend_users,
  });
  const [reasonPicker, setReasonPicker] = useState(false);
  const [loading, setLoading] = useState(false);

  const dirty =
    Number(commissionRate) !== Number(agent.commission_rate)
    || Number(exchangeRate) !== Number(agent.exchange_rate_usd_to_gold)
    || Number(depositLimit) !== Number(agent.daily_deposit_limit_usd)
    || Number(withdrawLimit) !== Number(agent.daily_withdrawal_limit_usd)
    || Number(minOp) !== Number(agent.min_operation_usd)
    || Number(maxOp) !== Number(agent.max_operation_usd)
    || Number(maxUsers) !== Number(agent.max_users)
    || Number(creditLimit) !== Number(agent.credit_limit_usd)
    || permissionOptions.some(({ key }) => permissions[key] !== agent[key]);

  const apply = async (reason: string) => {
    const commission = Number(commissionRate);
    const rate = Number(exchangeRate);
    if (!Number.isFinite(commission) || commission < 0 || commission > 100) {
      toast.error('نسبة العمولة يجب أن تكون بين 0 و100.');
      return;
    }
    if (!Number.isFinite(rate) || rate < 1 || rate > 1_000_000) {
      toast.error('سعر التحويل يجب أن يكون بين 1 و1,000,000 Coin لكل دولار.');
      return;
    }
    if (Number(minOp) > 0 && Number(maxOp) > 0 && Number(minOp) > Number(maxOp)) {
      toast.error('الحد الأدنى للعملية لا يمكن أن يتجاوز الحد الأقصى.');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.rpc('admin_update_agent_settings', {
        p_agent_id: agent.id,
        p_commission_rate: commission,
        p_exchange_rate_usd_to_gold: rate,
        p_can_create_users: permissions.can_create_users,
        p_can_approve_deposits: permissions.can_approve_deposits,
        p_can_approve_withdrawals: permissions.can_approve_withdrawals,
        p_can_set_user_rtp: permissions.can_set_user_rtp,
        p_can_force_outcome: permissions.can_force_outcome,
        p_can_suspend_users: permissions.can_suspend_users,
        p_reason: reason,
      });
      if (error) throw error;

      await callFunction('admin-agencies', {
        action: 'update_agent_limits',
        agent_id: agent.id,
        commission_rate: commission,
        daily_deposit_limit_usd: Number(depositLimit) || 0,
        daily_withdrawal_limit_usd: Number(withdrawLimit) || 0,
        min_operation_usd: Number(minOp) || 0,
        max_operation_usd: Number(maxOp) || 0,
        max_users: Math.max(0, Math.round(Number(maxUsers) || 0)),
        credit_limit_usd: Number(creditLimit) || 0,
        reason,
      });

      toast.success('حُفظت إعدادات الوكيل وسُجل التغيير في سجل الإدارة.');
      onSaved();
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'تعذر حفظ إعدادات الوكيل.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-wattar-900 bg-dark-surface"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-wattar-900 p-5">
          <div>
            <h2 className="text-lg font-semibold text-white">إعدادات الوكيل</h2>
            <p className="mt-1 text-xs text-gray-400">{agent.user?.display_name ?? agent.user?.username}{agent.agency?.name ? ` — ${agent.agency.name}` : ''}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="إغلاق"><X size={20} className="text-gray-400" /></button>
        </div>

        <div className="border-b border-wattar-900 p-4">
          <Segmented
            options={[
              { label: 'المالية', value: 'money' },
              { label: 'الحدود التشغيلية', value: 'limits' },
              { label: 'الصلاحيات', value: 'permissions' },
            ]}
            value={tab}
            onChange={setTab}
            columns={3}
          />
        </div>

        <div className="space-y-4 p-5">
          {tab === 'money' && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <NumberField label="عمولة الوكيل" value={commissionRate} onChange={setCommissionRate} unit="%" min={0} max={100} />
                <NumberField label="سعر الشحن" description="موحّد على المنصة: 3000" value={exchangeRate} onChange={setExchangeRate} unit="Coin/$" min={1} />
              </div>
              <p className="rounded-lg border border-amber-500/25 bg-amber-500/[0.07] p-3 text-xs leading-5 text-amber-200">
                غيّر سعر الشحن فقط بقرار مالي واضح — تغييره لا يعيد احتساب القيود السابقة.
              </p>
            </>
          )}

          {tab === 'limits' && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <NumberField label="حد الشحن اليومي" description="0 = بلا حد" value={depositLimit} onChange={setDepositLimit} unit="$" min={0} />
                <NumberField label="حد السحب اليومي" description="0 = بلا حد" value={withdrawLimit} onChange={setWithdrawLimit} unit="$" min={0} />
                <NumberField label="أدنى قيمة عملية" description="0 = بلا حد" value={minOp} onChange={setMinOp} unit="$" min={0} />
                <NumberField label="أقصى قيمة عملية" description="0 = بلا حد" value={maxOp} onChange={setMaxOp} unit="$" min={0} />
                <NumberField label="أقصى عدد عملاء" description="0 = بلا حد" value={maxUsers} onChange={setMaxUsers} min={0} />
                <NumberField label="حد الائتمان" value={creditLimit} onChange={setCreditLimit} unit="$" min={0} />
              </div>
              <p className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3 text-xs leading-5 text-gray-400">
                تُفرض هذه الحدود على كل عملية شحن وسحب ينفذها الوكيل، وتُمنع العملية فور تجاوزها.
              </p>
            </>
          )}

          {tab === 'permissions' && (
            <div className="space-y-2">
              {permissionOptions.map(({ key, label, hint }) => (
                <Toggle
                  key={key}
                  label={hint ? `${label} (${hint})` : label}
                  checked={permissions[key]}
                  onChange={(checked) => setPermissions((current) => ({ ...current, [key]: checked }))}
                />
              ))}
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-5 text-amber-200">
                صلاحيتا RTP وفرض نتائج الألعاب مرتفعتا الحساسية؛ فعّلهما فقط عند الحاجة. كل تعديل يُسجَّل مع السبب.
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={() => setReasonPicker(true)}
            disabled={loading || !dirty}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-wattar-600 py-2.5 font-medium text-white transition hover:bg-wattar-700 disabled:opacity-50"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : null}
            حفظ التعديلات وتوثيق السبب
          </button>
        </div>

        {reasonPicker && (
          <ReasonPickerModal
            title="سبب تعديل إعدادات الوكيل"
            subtitle={agent.user?.display_name ?? agent.user?.username ?? ''}
            description="يُسجَّل السبب في سجل الإدارة مع كل قيمة قبل/بعد."
            options={settingsReasons}
            confirmLabel="حفظ بالسبب المختار"
            tone="info"
            processing={loading}
            onClose={() => { if (!loading) setReasonPicker(false); }}
            onSubmit={(reason) => {
              setReasonPicker(false);
              void apply(reason);
            }}
          />
        )}
      </div>
    </div>
  );
}

function AdjustWalletModal({ agent, onClose, onSaved }: { agent: Agent; onClose: () => void; onSaved: () => void }) {
  const [direction, setDirection] = useState<'credit' | 'debit'>('credit');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState(walletAdjustReasons[0]);
  const [loading, setLoading] = useState(false);

  const value = Number(amount) || 0;
  const projected = direction === 'credit' ? Number(agent.wallet_usd) + value : Number(agent.wallet_usd) - value;

  const submit = async () => {
    if (value <= 0) {
      toast.error('أدخل مبلغاً أكبر من صفر.');
      return;
    }
    setLoading(true);
    try {
      await callFunction('admin-agencies', {
        action: 'adjust_agent_wallet',
        agent_id: agent.id,
        amount_usd: direction === 'credit' ? value : -value,
        reason,
        idempotency_key: crypto.randomUUID(),
      });
      toast.success('نُفّذت التسوية بقيد في دفتر المحفظة.');
      onSaved();
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'تعذر تنفيذ التسوية.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-lg rounded-2xl border border-wattar-900 bg-dark-surface"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-wattar-900 p-5">
          <div>
            <h2 className="text-lg font-semibold text-white">تسوية محفظة السحب</h2>
            <p className="mt-1 text-xs text-gray-400">{agent.user?.display_name ?? agent.user?.username} — الرصيد الحالي ${Number(agent.wallet_usd).toFixed(2)}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="إغلاق"><X size={20} className="text-gray-400" /></button>
        </div>
        <div className="space-y-4 p-5">
          {agent.wallet_frozen_at ? (
            <p className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-200">
              المحفظة مجمّدة — يجب فك التجميد أولاً قبل أي تسوية.
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
              {walletAdjustReasons.map((option) => (
                <button
                  key={option}
                  type="button"
                  disabled={loading}
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
            onClick={() => void submit()}
            disabled={loading || value <= 0 || projected < 0 || Boolean(agent.wallet_frozen_at)}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-wattar-600 py-2.5 font-semibold text-white transition hover:bg-wattar-500 disabled:opacity-50"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Wallet size={16} />}
            تنفيذ التسوية بقيد
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateAgentModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    username: '',
    password: '',
    display_name: '',
    phone: '',
    email: '',
    commission_rate: '10',
    credit_limit_usd: '1000',
    exchange_rate_usd_to_gold: '3000',
    permissions: {
      can_create_users: true,
      can_approve_deposits: true,
      can_approve_withdrawals: true,
      can_set_user_rtp: false,
      can_force_outcome: false,
      can_suspend_users: false,
    },
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await callFunction('admin-create-agent', {
        username: form.username,
        password: form.password,
        display_name: form.display_name || undefined,
        phone: form.phone || undefined,
        email: form.email || undefined,
        commission_rate: Number(form.commission_rate),
        credit_limit_usd: Number(form.credit_limit_usd),
        exchange_rate_usd_to_gold: Number(form.exchange_rate_usd_to_gold),
        permissions: form.permissions,
      });
      toast.success('تم إنشاء الوكيل بنجاح');
      onCreated();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-wattar-900 bg-dark-surface" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-wattar-900 p-5">
          <h2 className="text-lg font-semibold text-white">إنشاء وكيل جديد</h2>
          <button type="button" onClick={onClose} aria-label="إغلاق"><X size={20} className="text-gray-400" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          <p className="rounded-lg border border-wattar-700/40 bg-wattar-900/30 p-3 text-xs leading-5 text-gray-300">
            يستطيع الوكيل تسجيل الدخول بالبريد أو رقم الهاتف الدولي باستخدام كلمة المرور نفسها، دون الحاجة إلى SMS.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Input label="اسم المستخدم" value={form.username} onChange={v => setForm({ ...form, username: v })} required />
            <Input label="كلمة المرور" type="password" value={form.password} onChange={v => setForm({ ...form, password: v })} required />
            <Input label="الاسم الظاهر" value={form.display_name} onChange={v => setForm({ ...form, display_name: v })} />
            <Input label="البريد الإلكتروني لتسجيل الدخول" type="email" value={form.email} onChange={v => setForm({ ...form, email: v })} required />
            <Input label="رقم الهاتف الدولي لتسجيل الدخول" type="tel" value={form.phone} onChange={v => setForm({ ...form, phone: v })} required placeholder="+963..." />
            <Input label="نسبة العمولة" type="number" value={form.commission_rate} onChange={v => setForm({ ...form, commission_rate: v })} required />
            <Input label="حد الائتمان" type="number" value={form.credit_limit_usd} onChange={v => setForm({ ...form, credit_limit_usd: v })} required />
            <Input label="سعر الشحن (Coin لكل $)" type="number" value={form.exchange_rate_usd_to_gold} onChange={v => setForm({ ...form, exchange_rate_usd_to_gold: v })} required />
          </div>
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-semibold text-white">صلاحيات البداية</legend>
            {permissionOptions.map(({ key, label, hint }) => (
              <Toggle
                key={key}
                label={hint ? `${label} (${hint})` : label}
                checked={form.permissions[key]}
                onChange={(checked) => setForm((current) => ({
                  ...current,
                  permissions: { ...current.permissions, [key]: checked },
                }))}
              />
            ))}
          </fieldset>
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-5 text-amber-200">
            صلاحيتا RTP وفرض نتائج الألعاب معطلتان افتراضيًا. يمكن تعديل كل الصلاحيات لاحقًا مع تسجيل السبب.
          </p>
          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-wattar-600 py-2.5 font-medium text-white hover:bg-wattar-700 disabled:opacity-50"
          >
            {loading && <Loader2 size={16} className="animate-spin" />}
            إنشاء الوكيل
          </button>
        </form>
      </div>
    </div>
  );
}

function CreditAgentModal({ agent, onClose, onCredited }: { agent: Agent; onClose: () => void; onCredited: () => void }) {
  const [amount, setAmount] = useState('');
  const [source, setSource] = useState(prepaySources[0]);
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState<{ fingerprint: string; key: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const fingerprint = `${agent.id}:${Number(amount)}:${source}`;
      const requestKey = attempt?.fingerprint === fingerprint
        ? attempt.key
        : `agent-prefund-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      setAttempt({ fingerprint, key: requestKey });
      await callFunction('admin-credit-agent', {
        agent_id: agent.id,
        amount_usd: Number(amount),
        notes: `استلام مسبق عبر ${source}`,
      }, { idempotencyKey: requestKey });
      toast.success('تمت إضافة Coin إلى مخزون الوكيل');
      setAttempt(null);
      onCredited();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-wattar-900 bg-dark-surface" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-wattar-900 p-5">
          <h2 className="text-lg font-semibold text-white">إضافة مخزون مدفوع مسبقاً</h2>
          <button type="button" onClick={onClose} aria-label="إغلاق"><X size={20} className="text-gray-400" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          <div className="rounded-xl bg-dark-elevated p-3 text-sm">
            <p className="text-white">{agent.user?.display_name ?? agent.user?.username}</p>
            <p className="text-xs text-gray-500">المخزون الحالي: {Number(agent.coin_inventory).toLocaleString('ar')} Coin</p>
            <p className="text-xs text-gray-500">السيولة النقدية الحالية: ${Number(agent.wallet_usd).toFixed(2)}</p>
            <p className="text-xs text-gray-500">
              ستُضاف {Math.floor(Number(amount || 0) * Number(agent.exchange_rate_usd_to_gold)).toLocaleString('ar')} Coin بعد تأكيد استلام الدفعة.
            </p>
          </div>
          <NumberField label="المبلغ المستلم مسبقاً" value={amount} onChange={setAmount} unit="$" min={1} />
          <div>
            <p className="mb-2 text-sm font-medium text-gray-200">طريقة استلام الدفعة</p>
            <div className="grid grid-cols-2 gap-2">
              {prepaySources.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setSource(option)}
                  className={`rounded-xl border px-3 py-2 text-xs transition ${
                    source === option
                      ? 'border-wattar-400/50 bg-wattar-600/20 font-semibold text-white'
                      : 'border-white/[0.07] bg-white/[0.02] text-gray-300 hover:border-white/15'
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
          <button
            type="submit"
            disabled={loading || !Number(amount)}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-wattar-600 py-2.5 font-medium text-white hover:bg-wattar-700 disabled:opacity-50"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <DollarSign size={16} />}
            تأكيد استلام وإضافة المخزون
          </button>
        </form>
      </div>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  type = 'text',
  required,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm text-gray-300">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        placeholder={placeholder}
        className="w-full rounded-xl border border-wattar-900 bg-dark-elevated px-3 py-2.5 text-sm text-white placeholder:text-gray-600 focus:border-wattar-400/60 focus:outline-none"
      />
    </div>
  );
}
