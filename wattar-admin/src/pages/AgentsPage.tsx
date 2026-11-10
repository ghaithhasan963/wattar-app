/**
 * Wattar Admin — صفحة الوكلاء
 * قائمة + إنشاء وكيل + شحن رصيد
 */
import { useEffect, useState } from 'react';
import { supabase, callFunction } from '@/lib/supabase';
import { Plus, DollarSign, Loader2, X, Shield, ShieldOff } from 'lucide-react';
import { toast } from 'sonner';

interface Agent {
  id: string;
  user_id: string;
  wallet_usd: number;
  coin_inventory: number;
  commission_rate: number;
  exchange_rate_usd_to_gold: number;
  total_users: number;
  total_deposit_usd: number;
  total_commission_usd: number;
  status: string;
  created_at: string;
  user: { username: string; display_name: string | null; phone: string | null; email: string | null } | null;
}

export function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creditAgent, setCreditAgent] = useState<Agent | null>(null);
  const [processingAgentId, setProcessingAgentId] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('agents')
        .select(`
          id, user_id, wallet_usd, coin_inventory, commission_rate, exchange_rate_usd_to_gold, total_users, total_deposit_usd,
          total_commission_usd, status, created_at,
          user:users!agents_user_id_fkey(username, display_name, phone, email)
        `)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setAgents(((data ?? []) as any[]).map(a => ({
        ...a,
        user: Array.isArray(a.user) ? a.user[0] ?? null : a.user,
      })));
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'تعذر تحميل الوكلاء.');
    } finally {
      setLoading(false);
    }
  };

  const setAgentStatus = async (agent: Agent, status: 'active' | 'suspended' | 'banned') => {
    const reason = status === 'active'
      ? undefined
      : window.prompt(status === 'banned' ? 'اكتب سبب الحظر الدائم للوكيل:' : 'اكتب سبب إيقاف/أرشفة الوكيل:');
    if (status !== 'active' && !reason?.trim()) return;
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">الوكلاء</h1>
          <p className="text-gray-400 mt-1">إنشاء وإدارة وكلاء الشحن</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 rounded-lg bg-wattar-600 hover:bg-wattar-700 px-4 py-2 text-white text-sm font-medium"
        >
          <Plus size={18} />
          إنشاء وكيل جديد
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? (
          <p className="text-gray-400">جاري التحميل...</p>
        ) : agents.length === 0 ? (
          <p className="text-gray-500">لا يوجد وكلاء بعد</p>
        ) : agents.map(ag => (
          <div key={ag.id} className="bg-dark-surface rounded-xl border border-wattar-900 p-5">
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="font-medium text-white">{ag.user?.display_name ?? ag.user?.username}</p>
                <p className="text-xs text-gray-500">البريد: {ag.user?.email ?? '—'}</p>
                <p className="text-xs text-gray-500">الهاتف: {ag.user?.phone ?? '—'}</p>
              </div>
              <span className={`px-2 py-1 rounded text-xs ${
                ag.status === 'active'
                  ? 'bg-green-500/10 text-green-400'
                  : ag.status === 'banned'
                    ? 'bg-red-500/10 text-red-400'
                    : 'bg-amber-500/10 text-amber-300'
              }`}>
                {ag.status === 'active' ? 'نشط' : ag.status === 'banned' ? 'محظور' : 'موقوف'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm mb-4">
              <div>
                <p className="text-xs text-gray-500">سيولة نقدية لطلبات السحب</p>
                <p className="font-semibold text-gold-500">${ag.wallet_usd}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">مخزون Coin لدى الوكيل</p>
                <p className="font-semibold text-white">{Number(ag.coin_inventory).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">العمولة</p>
                <p className="font-semibold text-white">{ag.commission_rate}%</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">المستخدمون</p>
                <p className="font-semibold text-white">{ag.total_users}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">إجمالي العمولات</p>
                <p className="font-semibold text-green-400">${ag.total_commission_usd}</p>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <button
                onClick={() => setCreditAgent(ag)}
                disabled={ag.status !== 'active'}
                className="rounded-lg bg-wattar-600/20 hover:bg-wattar-600/30 border border-wattar-600 py-2 text-sm text-wattar-300 flex items-center justify-center gap-2"
              >
                <DollarSign size={16} />
                إضافة مخزون مدفوع مسبقًا
              </button>
              {ag.status !== 'banned' && (
                <button
                  onClick={() => void setAgentStatus(ag, ag.status === 'active' ? 'suspended' : 'active')}
                  disabled={processingAgentId === ag.id}
                  className="rounded-lg border border-amber-500/30 bg-amber-500/10 py-2 text-sm text-amber-300 flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {processingAgentId === ag.id ? <Loader2 size={16} className="animate-spin" /> : <ShieldOff size={16} />}
                  {ag.status === 'active' ? 'إيقاف/أرشفة' : 'إعادة التفعيل'}
                </button>
              )}
              {ag.status !== 'banned' && (
                <button
                  onClick={() => void setAgentStatus(ag, 'banned')}
                  disabled={processingAgentId === ag.id}
                  className="rounded-lg border border-red-500/30 bg-red-500/10 py-2 text-sm text-red-300 flex items-center justify-center gap-2 disabled:opacity-50 sm:col-span-2"
                >
                  <Shield size={16} />
                  حظر الوكيل
                </button>
              )}
              {ag.status === 'banned' && (
                <button
                  onClick={() => void setAgentStatus(ag, 'active')}
                  disabled={processingAgentId === ag.id}
                  className="rounded-lg border border-green-500/30 bg-green-500/10 py-2 text-sm text-green-300 flex items-center justify-center gap-2 disabled:opacity-50 sm:col-span-2"
                >
                  إعادة تفعيل الوكيل
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

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
    exchange_rate_usd_to_gold: '1000',
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
      <div className="bg-dark-surface rounded-xl border border-wattar-900 max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="p-6 border-b border-wattar-900 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">إنشاء وكيل جديد</h2>
          <button onClick={onClose}><X size={20} className="text-gray-400" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <p className="rounded-lg border border-wattar-700/40 bg-wattar-900/30 p-3 text-xs leading-5 text-gray-300">
            يستطيع الوكيل تسجيل الدخول بالبريد أو رقم الهاتف الدولي باستخدام كلمة المرور نفسها، دون الحاجة إلى SMS.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <Input label="اسم المستخدم" value={form.username} onChange={v => setForm({ ...form, username: v })} required />
            <Input label="كلمة المرور" type="password" value={form.password} onChange={v => setForm({ ...form, password: v })} required />
            <Input label="الاسم الظاهر" value={form.display_name} onChange={v => setForm({ ...form, display_name: v })} />
            <Input label="البريد الإلكتروني لتسجيل الدخول" type="email" value={form.email} onChange={v => setForm({ ...form, email: v })} required />
            <Input label="رقم الهاتف الدولي لتسجيل الدخول" type="tel" value={form.phone} onChange={v => setForm({ ...form, phone: v })} required placeholder="+963..." />
            <Input label="نسبة العمولة (%)" type="number" value={form.commission_rate} onChange={v => setForm({ ...form, commission_rate: v })} required />
            <Input label="حد الائتمان ($)" type="number" value={form.credit_limit_usd} onChange={v => setForm({ ...form, credit_limit_usd: v })} required />
            <Input label="سعر الشحن (1$ = ? Coin)" type="number" value={form.exchange_rate_usd_to_gold} onChange={v => setForm({ ...form, exchange_rate_usd_to_gold: v })} required />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-wattar-600 hover:bg-wattar-700 disabled:opacity-50 py-2.5 font-medium text-white flex items-center justify-center gap-2"
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
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState<{ fingerprint: string; key: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const fingerprint = `${agent.id}:${Number(amount)}:${notes.trim()}`;
      const requestKey = attempt?.fingerprint === fingerprint
        ? attempt.key
        : `agent-prefund-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      setAttempt({ fingerprint, key: requestKey });
      await callFunction('admin-credit-agent', {
        agent_id: agent.id,
        amount_usd: Number(amount),
        notes: notes || undefined,
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
      <div className="bg-dark-surface rounded-xl border border-wattar-900 max-w-md w-full" onClick={e => e.stopPropagation()}>
        <div className="p-6 border-b border-wattar-900 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">إضافة مخزون مدفوع مسبقًا</h2>
          <button onClick={onClose}><X size={20} className="text-gray-400" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="bg-dark-elevated rounded-lg p-3 text-sm">
            <p className="text-white">{agent.user?.display_name ?? agent.user?.username}</p>
            <p className="text-gray-500 text-xs">المخزون الحالي: {Number(agent.coin_inventory).toLocaleString()} Coin</p>
            <p className="text-gray-500 text-xs">السيولة النقدية الحالية: ${agent.wallet_usd}</p>
            <p className="text-gray-500 text-xs">
              ستضاف {Math.floor(Number(amount || 0) * Number(agent.exchange_rate_usd_to_gold)).toLocaleString()} Coin بعد تأكيد استلام الدفعة.
            </p>
          </div>
          <Input
            label="المبلغ المستلم مسبقًا ($)"
            type="number"
            value={amount}
            onChange={setAmount}
            required
            placeholder="100"
          />
          <div>
            <label className="block text-sm text-gray-300 mb-1">ملاحظات</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-lg bg-dark-elevated border border-wattar-900 px-3 py-2 text-white text-sm"
              rows={2}
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-wattar-600 hover:bg-wattar-700 disabled:opacity-50 py-2.5 font-medium text-white"
          >
            {loading ? 'جاري...' : 'تأكيد استلام وإضافة المخزون'}
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
      <label className="block text-sm text-gray-300 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        placeholder={placeholder}
        className="w-full rounded-lg bg-dark-elevated border border-wattar-900 px-3 py-2 text-white text-sm"
      />
    </div>
  );
}
