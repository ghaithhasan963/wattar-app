/**
 * Wattar Admin — لوحة تفاصيل المستخدم (M7.3)
 * تقرأ admin_get_user_detail (ملف/محفظة/إحصائيات/حركات/جلسات/عقوبات/بلاغات/غرف)
 * وتتيح تعديل الرصيد بسبب إلزامي وعكس قيد موثّق عبر دوال القاعدة المحمية بالصلاحية.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  Coins,
  CreditCard,
  History,
  Loader2,
  Lock,
  MessageSquareWarning,
  Radio,
  RotateCcw,
  ShieldCheck,
  Smartphone,
  UserRound,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { canAccess, useAuthStore } from '@/store/auth';

type Currency = 'gold' | 'diamond' | 'conv_gold' | 'promo_dia';

interface WalletInfo {
  balance_gold: number;
  balance_diamond: number;
  balance_converted_coins: number;
  balance_diamond_promo: number;
  total_deposited: number;
  total_withdrawn: number;
  total_wagered: number;
  total_won: number;
  total_gifts_sent: number;
  total_gifts_received: number;
}

interface StatsInfo {
  wallet_transactions: number;
  deposits_total: number;
  deposits_pending: number;
  withdrawals_total: number;
  withdrawals_pending: number;
  gifts_sent: number;
  gifts_received: number;
  rooms_owned: number;
  active_sessions: number;
  pending_reports: number;
  active_penalties: number;
}

interface TransactionRow {
  id: string;
  type: string;
  amount: number;
  currency: string;
  balance_before: number;
  balance_after: number;
  reason: string | null;
  created_by_function: string | null;
  entry_kind: string | null;
  reversal_of: string | null;
  reversed_by: string | null;
  executed_by_role: string | null;
  created_at: string;
}

interface SessionRow {
  id: string;
  device_info: string | null;
  ip_address: string | null;
  user_agent: string | null;
  is_active: boolean;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
  device_id: string | null;
}

interface PenaltyRow {
  id: string;
  penalty_type: string;
  reason: string | null;
  starts_at: string | null;
  ends_at: string | null;
  revoked_at: string | null;
  revoke_reason: string | null;
  created_at: string;
}

interface ReportRow {
  id: string;
  reason: string | null;
  status: string;
  decision_note: string | null;
  created_at: string;
  reporter_id: string | null;
  reporter_name: string | null;
}

interface RoomRow {
  id: string;
  name: string | null;
  status: string;
  listeners_count: number | null;
  created_at: string;
}

interface UserDetail {
  profile: Record<string, any>;
  wallet: WalletInfo;
  stats: StatsInfo;
  host: { status: string; approved_at: string | null; platform_commission_percent: number | null; agent_commission_percent: number | null } | null;
  transactions: TransactionRow[];
  sessions: SessionRow[];
  penalties: PenaltyRow[];
  reports_against: ReportRow[];
  rooms_owned: RoomRow[];
}

const currencyLabels: Record<string, string> = {
  gold: 'Coin',
  diamond: 'Diamond',
  conv_gold: 'Coin محوّل',
  promo_dia: 'Diamond ترويجي',
};

const txTypeLabels: Record<string, string> = {
  deposit: 'شحن',
  withdrawal: 'سحب',
  transfer_in: 'تحويل وارد',
  transfer_out: 'تحويل صادر',
  gift_sent: 'هدية مُرسلة',
  gift_received: 'هدية مستلمة',
  game_bet: 'رهان لعبة',
  game_win: 'ربح لعبة',
  mission_reward: 'مكافأة مهمة',
  daily_bonus: 'مكافأة يومية',
  admin_adjustment: 'تعديل إداري',
  conversion: 'تحويل عملة',
  refund: 'استرجاع',
};

const tabs = [
  { key: 'overview', label: 'نظرة عامة', icon: UserRound },
  { key: 'wallet', label: 'المحفظة', icon: CreditCard },
  { key: 'transactions', label: 'الحركات', icon: History },
  { key: 'sessions', label: 'الأجهزة', icon: Smartphone },
  { key: 'moderation', label: 'الإشراف', icon: ShieldCheck },
] as const;

type TabKey = typeof tabs[number]['key'];

function fmt(value: number | null | undefined): string {
  return Number(value ?? 0).toLocaleString('ar');
}

function date(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString('ar') : '—';
}

export function UserDetailDrawer({ userId, onClose }: { userId: string; onClose: () => void }) {
  const profile = useAuthStore((state) => state.profile);
  const canManageWallets = canAccess(profile, 'wallets.manage');
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>('overview');
  const [busy, setBusy] = useState(false);

  const [currency, setCurrency] = useState<Currency>('gold');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');

  const [reverseTarget, setReverseTarget] = useState<TransactionRow | null>(null);
  const [reverseReason, setReverseReason] = useState('');

  const load = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('admin_get_user_detail', {
        p_admin_id: profile.id,
        p_user_id: userId,
      });
      if (rpcError) throw rpcError;
      setDetail(data as UserDetail);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'تعذر تحميل تفاصيل المستخدم.');
    } finally {
      setLoading(false);
    }
  }, [profile?.id, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const submitAdjust = async () => {
    if (!profile?.id || !detail) return;
    const trimmed = reason.trim();
    const numeric = Number(amount);
    if (!Number.isFinite(numeric) || numeric === 0) {
      toast.error('أدخل مبلغًا رقميًا غير صفري');
      return;
    }
    if (trimmed.length < 10 || trimmed.length > 500) {
      toast.error('السبب مطلوب بين 10 و500 حرف');
      return;
    }
    setBusy(true);
    try {
      const { data, error: rpcError } = await supabase.rpc('admin_adjust_user_balance', {
        p_admin_id: profile.id,
        p_user_id: userId,
        p_currency: currency,
        p_amount: Math.trunc(numeric),
        p_reason: trimmed,
        p_idempotency_key: `panel-adjust-${userId}-${Date.now()}`,
      });
      if (rpcError) throw rpcError;
      const result = data as { balance_before: number; balance_after: number };
      toast.success(`تم التعديل: ${fmt(result.balance_before)} ← ${fmt(result.balance_after)}`);
      setAmount('');
      setReason('');
      await load();
    } catch (caught: unknown) {
      toast.error(caught instanceof Error ? caught.message : 'تعذر تعديل الرصيد.');
    } finally {
      setBusy(false);
    }
  };

  const submitReverse = async () => {
    if (!profile?.id || !reverseTarget) return;
    const trimmed = reverseReason.trim();
    if (trimmed.length < 10 || trimmed.length > 500) {
      toast.error('سبب العكس مطلوب بين 10 و500 حرف');
      return;
    }
    setBusy(true);
    try {
      const { error: rpcError } = await supabase.rpc('admin_reverse_user_transaction', {
        p_admin_id: profile.id,
        p_transaction_id: reverseTarget.id,
        p_reason: trimmed,
      });
      if (rpcError) throw rpcError;
      toast.success('تم تسجيل القيد العكسي');
      setReverseTarget(null);
      setReverseReason('');
      await load();
    } catch (caught: unknown) {
      toast.error(caught instanceof Error ? caught.message : 'تعذر عكس القيد.');
    } finally {
      setBusy(false);
    }
  };

  const p = detail?.profile ?? {};
  const statCards = useMemo(() => (detail ? [
    { label: 'حركات المحفظة', value: detail.stats.wallet_transactions },
    { label: 'شحنات (معلّقة)', value: `${detail.stats.deposits_total} (${detail.stats.deposits_pending})` },
    { label: 'سحوبات (معلّقة)', value: `${detail.stats.withdrawals_total} (${detail.stats.withdrawals_pending})` },
    { label: 'هدايا مُرسلة', value: detail.stats.gifts_sent },
    { label: 'هدايا مستلمة', value: detail.stats.gifts_received },
    { label: 'غرف مملوكة', value: detail.stats.rooms_owned },
    { label: 'أجهزة نشطة', value: detail.stats.active_sessions },
    { label: 'عقوبات سارية', value: detail.stats.active_penalties },
    { label: 'بلاغات معلّقة', value: detail.stats.pending_reports },
  ] : []), [detail]);

  return (
    <div className="fixed inset-0 z-50 flex justify-start bg-black/70" dir="rtl" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="تفاصيل المستخدم"
        className="flex h-full w-full max-w-3xl flex-col overflow-hidden border-l border-wattar-900 bg-dark-surface"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-wattar-900 p-5">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-white">
              {p.display_name || p.username || 'تفاصيل المستخدم'}
            </h2>
            <p className="mt-1 truncate text-xs text-gray-400">
              @{p.username ?? '—'} · {p.id ?? userId}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="rounded-lg border border-wattar-900 px-3 py-1.5 text-xs text-gray-300 hover:bg-dark-elevated disabled:opacity-50"
            >
              تحديث
            </button>
            <button type="button" onClick={onClose} aria-label="إغلاق" className="text-gray-400 hover:text-white">
              <X size={20} />
            </button>
          </div>
        </header>

        <nav className="flex gap-1 overflow-x-auto border-b border-wattar-900 px-3 py-2">
          {tabs.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setTab(item.key)}
                className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${
                  tab === item.key ? 'bg-wattar-600/20 text-wattar-200' : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                <Icon size={14} />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="flex justify-center py-16 text-gray-400"><Loader2 className="animate-spin" /></div>
          ) : error ? (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">{error}</div>
          ) : !detail ? null : (
            <>
              {tab === 'overview' && (
                <div className="space-y-5">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Info label="الحالة" value={p.status} />
                    <Info label="الدور" value={p.role} />
                    <Info label="الهاتف" value={p.phone ?? '—'} />
                    <Info label="البريد" value={p.email ?? '—'} />
                    <Info label="الجنس" value={p.gender ?? '—'} />
                    <Info label="اللغة" value={p.preferred_language ?? '—'} />
                    <Info label="تأكيد العمر" value={p.adult_confirmed_at ? date(p.adult_confirmed_at) : 'غير مؤكد'} />
                    <Info label="إكمال الملف" value={p.onboarding_completed_at ? date(p.onboarding_completed_at) : 'غير مكتمل'} />
                    <Info label="تاريخ التسجيل" value={date(p.created_at)} />
                    <Info label="آخر ظهور" value={date(p.last_seen_at)} />
                    <Info label="كود الإحالة" value={p.referral_code ?? '—'} />
                    <Info label="المستوى / XP" value={`${fmt(p.level)} / ${fmt(p.experience_points)}`} />
                  </div>
                  {p.banned_reason ? (
                    <div className="flex gap-2 rounded-lg border border-red-500/25 bg-red-500/10 p-3 text-xs text-red-200">
                      <Ban size={15} className="mt-0.5 shrink-0" />
                      سبب الحظر: {p.banned_reason}
                    </div>
                  ) : null}
                  {detail.host ? (
                    <div className="rounded-xl border border-wattar-900 bg-dark-elevated p-3 text-xs text-gray-300">
                      مضيفة: {detail.host.status} · اعتماد {date(detail.host.approved_at)} · عمولة المنصة{' '}
                      {detail.host.platform_commission_percent ?? '—'}% · عمولة الوكيل {detail.host.agent_commission_percent ?? '—'}%
                    </div>
                  ) : null}
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {statCards.map((card) => (
                      <div key={card.label} className="rounded-xl border border-wattar-900 bg-dark-elevated p-3">
                        <p className="text-[11px] text-gray-500">{card.label}</p>
                        <p className="mt-1 text-base font-bold text-white">{card.value}</p>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-xl border border-wattar-900 bg-dark-elevated p-3">
                    <p className="mb-2 text-xs font-semibold text-gray-300">الخصوصية</p>
                    <div className="flex flex-wrap gap-1.5 text-[11px] text-gray-400">
                      {Object.entries((p.privacy ?? {}) as Record<string, string>).map(([key, value]) => (
                        <span key={key} className="rounded bg-white/5 px-2 py-0.5">{key}: {value}</span>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {tab === 'wallet' && (
                <div className="space-y-5">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <WalletCard label="Coin" value={detail.wallet.balance_gold} tone="text-amber-300" />
                    <WalletCard label="Diamond" value={detail.wallet.balance_diamond} tone="text-teal-300" />
                    <WalletCard label="Coin محوّل" value={detail.wallet.balance_converted_coins} tone="text-sky-300" />
                    <WalletCard label="Diamond ترويجي" value={detail.wallet.balance_diamond_promo} tone="text-fuchsia-300" />
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                    <Info label="إجمالي الشحن" value={fmt(detail.wallet.total_deposited)} />
                    <Info label="إجمالي السحب" value={fmt(detail.wallet.total_withdrawn)} />
                    <Info label="إجمالي الرهان" value={fmt(detail.wallet.total_wagered)} />
                    <Info label="إجمالي الأرباح" value={fmt(detail.wallet.total_won)} />
                    <Info label="هدايا مُرسلة" value={fmt(detail.wallet.total_gifts_sent)} />
                    <Info label="هدايا مستلمة" value={fmt(detail.wallet.total_gifts_received)} />
                  </div>

                  {canManageWallets ? (
                    <section className="rounded-xl border border-wattar-500/25 bg-wattar-600/[0.07] p-4">
                      <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
                        <Coins size={16} className="text-wattar-300" />
                        تعديل الرصيد (بسبب إلزامي)
                      </h3>
                      <p className="mt-1 text-[11px] leading-5 text-gray-400">
                        كل تعديل يُسجَّل في دفتر المحفظة وسجل الإدارة مع الرصيد قبل/بعد، ويمكن عكسه لاحقًا بقيد موثّق.
                      </p>
                      <div className="mt-3 grid gap-2 sm:grid-cols-3">
                        <label className="text-xs text-gray-300">
                          العملة
                          <select
                            value={currency}
                            onChange={(event) => setCurrency(event.target.value as Currency)}
                            className="mt-1 w-full rounded-lg border border-wattar-900 bg-dark-elevated px-2 py-2 text-sm text-white"
                          >
                            {Object.entries(currencyLabels).map(([value, label]) => (
                              <option key={value} value={value}>{label}</option>
                            ))}
                          </select>
                        </label>
                        <label className="text-xs text-gray-300">
                          المبلغ (+ إضافة / − خصم)
                          <input
                            type="number"
                            value={amount}
                            onChange={(event) => setAmount(event.target.value)}
                            placeholder="100"
                            className="mt-1 w-full rounded-lg border border-wattar-900 bg-dark-elevated px-2 py-2 text-sm text-white"
                          />
                        </label>
                        <label className="text-xs text-gray-300 sm:col-span-1">
                          السبب
                          <input
                            value={reason}
                            onChange={(event) => setReason(event.target.value)}
                            maxLength={500}
                            placeholder="10 أحرف على الأقل"
                            className="mt-1 w-full rounded-lg border border-wattar-900 bg-dark-elevated px-2 py-2 text-sm text-white"
                          />
                        </label>
                      </div>
                      <button
                        type="button"
                        onClick={() => void submitAdjust()}
                        disabled={busy}
                        className="mt-3 flex items-center gap-2 rounded-lg bg-wattar-600 px-4 py-2 text-sm font-semibold text-white hover:bg-wattar-700 disabled:opacity-50"
                      >
                        {busy ? <Loader2 size={15} className="animate-spin" /> : <Coins size={15} />}
                        تنفيذ التعديل
                      </button>
                    </section>
                  ) : (
                    <p className="flex items-center gap-2 rounded-lg border border-wattar-900 bg-dark-elevated p-3 text-xs text-gray-400">
                      <Lock size={14} /> تعديل الأرصدة يتطلب صلاحية «إدارة المحافظ».
                    </p>
                  )}
                </div>
              )}

              {tab === 'transactions' && (
                <div className="space-y-2">
                  {detail.transactions.length === 0 ? (
                    <p className="p-6 text-center text-sm text-gray-500">لا توجد حركات.</p>
                  ) : detail.transactions.map((tx) => (
                    <article key={tx.id} className="rounded-xl border border-wattar-900 bg-dark-elevated p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-white">
                            {txTypeLabels[tx.type] ?? tx.type}
                            <span className={`mr-2 text-xs ${tx.amount >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                              {tx.amount >= 0 ? '+' : ''}{fmt(tx.amount)} {currencyLabels[tx.currency] ?? tx.currency}
                            </span>
                          </p>
                          <p className="mt-1 text-[11px] text-gray-500">
                            {fmt(tx.balance_before)} ← {fmt(tx.balance_after)} · {date(tx.created_at)}
                            {tx.created_by_function ? ` · ${tx.created_by_function}` : ''}
                            {tx.entry_kind && tx.entry_kind !== 'normal' ? ` · ${tx.entry_kind}` : ''}
                          </p>
                          {tx.reason ? <p className="mt-1 text-[11px] text-gray-400">السبب: {tx.reason}</p> : null}
                          {tx.reversal_of ? (
                            <p className="mt-1 text-[11px] text-amber-300">قيد عكسي لحركة {tx.reversal_of.slice(0, 8)}</p>
                          ) : null}
                          {tx.reversed_by ? (
                            <p className="mt-1 text-[11px] text-amber-300">معكوسة بالقيد {tx.reversed_by.slice(0, 8)}</p>
                          ) : null}
                        </div>
                        {canManageWallets && !tx.reversal_of && !tx.reversed_by ? (
                          <button
                            type="button"
                            onClick={() => {
                              setReverseTarget(tx);
                              setReverseReason('');
                            }}
                            className="flex items-center gap-1 rounded-lg border border-amber-500/30 px-2.5 py-1.5 text-[11px] text-amber-200 hover:bg-amber-500/10"
                          >
                            <RotateCcw size={13} />
                            عكس
                          </button>
                        ) : null}
                      </div>
                    </article>
                  ))}
                </div>
              )}

              {tab === 'sessions' && (
                <div className="space-y-2">
                  {detail.sessions.length === 0 ? (
                    <p className="p-6 text-center text-sm text-gray-500">لا توجد جلسات مسجلة.</p>
                  ) : detail.sessions.map((session) => (
                    <article key={session.id} className="rounded-xl border border-wattar-900 bg-dark-elevated p-3 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold text-white">
                          {session.device_info || session.user_agent || 'جهاز غير معروف'}
                        </p>
                        <span className={session.is_active ? 'text-green-400' : 'text-gray-500'}>
                          {session.is_active ? 'نشطة' : 'منتهية'}
                        </span>
                      </div>
                      <p className="mt-1 text-gray-500">
                        IP: {session.ip_address ?? '—'} · آخر استخدام: {date(session.last_used_at)} · أُنشئت: {date(session.created_at)}
                      </p>
                      {session.expires_at ? <p className="mt-1 text-gray-500">تنتهي: {date(session.expires_at)}</p> : null}
                    </article>
                  ))}
                </div>
              )}

              {tab === 'moderation' && (
                <div className="space-y-4">
                  <section>
                    <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-white">
                      <AlertTriangle size={15} className="text-amber-300" />
                      العقوبات ({detail.penalties.length})
                    </h3>
                    {detail.penalties.length === 0 ? (
                      <p className="rounded-lg border border-wattar-900 bg-dark-elevated p-3 text-xs text-gray-500">لا عقوبات.</p>
                    ) : detail.penalties.map((penalty) => (
                      <article key={penalty.id} className="mb-2 rounded-lg border border-wattar-900 bg-dark-elevated p-3 text-xs">
                        <p className="font-semibold text-white">
                          {penalty.penalty_type}
                          {penalty.revoked_at ? <span className="mr-2 text-green-400">ملغاة</span> : null}
                        </p>
                        <p className="mt-1 text-gray-400">{penalty.reason ?? '—'}</p>
                        <p className="mt-1 text-gray-500">
                          {date(penalty.starts_at)} ← {date(penalty.ends_at)}
                          {penalty.revoke_reason ? ` · إلغاء: ${penalty.revoke_reason}` : ''}
                        </p>
                      </article>
                    ))}
                  </section>

                  <section>
                    <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-white">
                      <MessageSquareWarning size={15} className="text-red-300" />
                      البلاغات ضده ({detail.reports_against.length})
                    </h3>
                    {detail.reports_against.length === 0 ? (
                      <p className="rounded-lg border border-wattar-900 bg-dark-elevated p-3 text-xs text-gray-500">لا بلاغات.</p>
                    ) : detail.reports_against.map((report) => (
                      <article key={report.id} className="mb-2 rounded-lg border border-wattar-900 bg-dark-elevated p-3 text-xs">
                        <p className="font-semibold text-white">{report.reason ?? 'بدون نص'}</p>
                        <p className="mt-1 text-gray-500">
                          {report.status} · من {report.reporter_name ?? report.reporter_id?.slice(0, 8) ?? '—'} · {date(report.created_at)}
                        </p>
                        {report.decision_note ? <p className="mt-1 text-gray-400">قرار: {report.decision_note}</p> : null}
                      </article>
                    ))}
                  </section>

                  <section>
                    <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-white">
                      <Radio size={15} className="text-wattar-300" />
                      الغرف المملوكة ({detail.rooms_owned.length})
                    </h3>
                    {detail.rooms_owned.length === 0 ? (
                      <p className="rounded-lg border border-wattar-900 bg-dark-elevated p-3 text-xs text-gray-500">لا غرف.</p>
                    ) : detail.rooms_owned.map((room) => (
                      <article key={room.id} className="mb-2 rounded-lg border border-wattar-900 bg-dark-elevated p-3 text-xs">
                        <p className="font-semibold text-white">{room.name ?? 'غرفة بلا اسم'}</p>
                        <p className="mt-1 text-gray-500">
                          {room.status} · مستمعون {fmt(room.listeners_count)} · {date(room.created_at)}
                        </p>
                      </article>
                    ))}
                  </section>
                </div>
              )}
            </>
          )}
        </div>
      </aside>

      {reverseTarget ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" onClick={() => setReverseTarget(null)}>
          <div className="w-full max-w-md rounded-xl border border-wattar-900 bg-dark-surface" onClick={(event) => event.stopPropagation()}>
            <div className="border-b border-wattar-900 p-4">
              <h3 className="text-base font-semibold text-white">عكس القيد</h3>
              <p className="mt-1 text-xs text-gray-400">
                {txTypeLabels[reverseTarget.type] ?? reverseTarget.type} · {fmt(reverseTarget.amount)}{' '}
                {currencyLabels[reverseTarget.currency] ?? reverseTarget.currency} · {date(reverseTarget.created_at)}
              </p>
            </div>
            <div className="space-y-3 p-4">
              <label className="block text-xs text-gray-300">
                سبب العكس (10–500 حرف)
                <textarea
                  value={reverseReason}
                  onChange={(event) => setReverseReason(event.target.value)}
                  rows={3}
                  maxLength={500}
                  className="mt-1 w-full rounded-lg border border-wattar-900 bg-dark-elevated px-3 py-2 text-sm text-white"
                />
              </label>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setReverseTarget(null)}
                  className="rounded-lg border border-wattar-900 px-3 py-2 text-sm text-gray-300 hover:bg-dark-elevated"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  onClick={() => void submitReverse()}
                  disabled={busy}
                  className="flex items-center gap-2 rounded-lg bg-amber-700 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
                >
                  {busy ? <Loader2 size={15} className="animate-spin" /> : <RotateCcw size={15} />}
                  تنفيذ العكس
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="rounded-lg border border-wattar-900 bg-dark-elevated p-2.5">
      <p className="text-[11px] text-gray-500">{label}</p>
      <p className="mt-0.5 truncate text-xs text-gray-200">{value ?? '—'}</p>
    </div>
  );
}

function WalletCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-xl border border-wattar-900 bg-dark-elevated p-3">
      <p className="text-[11px] text-gray-500">{label}</p>
      <p className={`mt-1 text-base font-bold ${tone}`}>{fmt(value)}</p>
    </div>
  );
}
