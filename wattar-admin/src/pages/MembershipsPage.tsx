import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Crown, Loader2, Plus, Save } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { Toggle } from '@/components/ui';

interface MembershipPlan {
  id: string;
  name: string;
  name_ar: string;
  duration_days: number;
  price_coins: number;
  xp_boost: number;
  is_active: boolean;
}

interface NewPlan {
  name: string;
  name_ar: string;
  duration_days: string;
  price_coins: string;
  xp_boost: string;
}

const emptyPlan: NewPlan = {
  name: '',
  name_ar: '',
  duration_days: '30',
  price_coins: '1000',
  xp_boost: '0',
};

export function MembershipsPage() {
  const [plans, setPlans] = useState<MembershipPlan[]>([]);
  const [form, setForm] = useState<NewPlan>(emptyPlan);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { data, error } = await supabase
        .from('membership_plans')
        .select('id, name, name_ar, duration_days, price_coins, xp_boost, is_active')
        .order('created_at', { ascending: true });
      if (error) throw error;
      setPlans((data ?? []) as MembershipPlan[]);
    } catch (caught: unknown) {
      setLoadError(caught instanceof Error ? caught.message : 'تعذر تحميل الخطط');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const isValid = (name: string, nameAr: string, days: number, price: number, xp: number) => (
    name.trim().length >= 2 && name.trim().length <= 80
    && nameAr.trim().length >= 2 && nameAr.trim().length <= 80
    && Number.isSafeInteger(days) && days >= 1 && days <= 365
    && Number.isSafeInteger(price) && price >= 1 && price <= 10000000
    && Number.isSafeInteger(xp) && xp >= 0 && xp <= 250
  );

  const save = async (plan: MembershipPlan) => {
    if (!isValid(plan.name, plan.name_ar, plan.duration_days, plan.price_coins, plan.xp_boost)) {
      toast.error('تحقق من الاسم والمدة والسعر ودفعة XP (حدها 250)');
      return;
    }
    setSavingId(plan.id);
    try {
      const { error } = await supabase.rpc('admin_upsert_membership_plan', {
        p_plan_id: plan.id,
        p_name: plan.name,
        p_name_ar: plan.name_ar,
        p_duration_days: plan.duration_days,
        p_price_coins: plan.price_coins,
        p_xp_boost: plan.xp_boost,
        p_is_active: plan.is_active,
      });
      if (error) throw error;
      toast.success('تم حفظ الخطة وتسجيل التغيير في سجل الإدارة');
      await load();
    } catch (caught: unknown) {
      toast.error(caught instanceof Error ? caught.message : 'تعذر حفظ الخطة');
    } finally {
      setSavingId(null);
    }
  };

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const days = Number(form.duration_days);
    const price = Number(form.price_coins);
    const xp = Number(form.xp_boost);
    if (!isValid(form.name, form.name_ar, days, price, xp)) {
      toast.error('تحقق من الأسماء والمدة والسعر وحدود XP');
      return;
    }
    setCreating(true);
    try {
      const { error } = await supabase.rpc('admin_upsert_membership_plan', {
        p_plan_id: null,
        p_name: form.name.trim(),
        p_name_ar: form.name_ar.trim(),
        p_duration_days: days,
        p_price_coins: price,
        p_xp_boost: xp,
        p_is_active: true,
      });
      if (error) throw error;
      setForm(emptyPlan);
      await load();
      toast.success('تم إنشاء الخطة وتسجيلها في سجل الإدارة');
    } catch (caught: unknown) {
      toast.error(caught instanceof Error ? caught.message : 'تعذر إنشاء الخطة');
    } finally {
      setCreating(false);
    }
  };

  const updatePlan = (id: string, field: keyof MembershipPlan, value: string | number | boolean) => {
    setPlans((current) => current.map((plan) => plan.id === id ? { ...plan, [field]: value } : plan));
  };

  return (
    <div className="space-y-6" dir="rtl">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-white"><Crown size={23} className="text-amber-300" /> عضويات VIP</h1>
        <p className="mt-1 text-sm text-gray-400">
          خطط مدفوعة بـCoin، غير متجددة تلقائيًا. دفعة XP لا تتجاوز 250 لكل عملية و500 شهريًا لكل مستخدم؛ جميع تغييرات الخطط مدققة.
        </p>
      </div>

      <form onSubmit={create} className="space-y-4 rounded-xl border border-wattar-900 bg-dark-surface p-5">
        <h2 className="text-lg font-semibold text-white">إضافة خطة</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <Input label="الاسم (إنجليزي)" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
          <Input label="الاسم بالعربية" value={form.name_ar} onChange={(v) => setForm({ ...form, name_ar: v })} />
          <Input label="المدة بالأيام (1–365)" type="number" value={form.duration_days} onChange={(v) => setForm({ ...form, duration_days: v })} />
          <Input label="السعر بـCoin (1–10,000,000)" type="number" value={form.price_coins} onChange={(v) => setForm({ ...form, price_coins: v })} />
          <Input label="دفعة XP (0–250)" type="number" value={form.xp_boost} onChange={(v) => setForm({ ...form, xp_boost: v })} />
        </div>
        <button disabled={creating} className="flex items-center gap-2 rounded-lg bg-wattar-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {creating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
          إنشاء خطة
        </button>
      </form>

      {loading ? (
        <p className="text-gray-400">جاري التحميل...</p>
      ) : loadError ? (
        <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-300">
          <p>تعذر تحميل الخطط: {loadError}</p>
          <button onClick={() => void load()} className="mt-3 rounded-lg bg-red-500/20 px-4 py-2 text-sm">إعادة المحاولة</button>
        </div>
      ) : plans.length === 0 ? (
        <p className="text-gray-400">لا توجد خطط عضوية بعد.</p>
      ) : (
        <div className="grid gap-4">
          {plans.map((plan) => (
            <section key={plan.id} className="space-y-4 rounded-xl border border-wattar-900 bg-dark-surface p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-white">{plan.name_ar} <span className="text-gray-500">· {plan.name}</span></h2>
                  <p className="mt-1 text-xs text-gray-400">تعديلات الخطة تُسجل في سجل الإدارة</p>
                </div>
                <div className="w-full max-w-xs">
                  <Toggle
                    label={plan.is_active ? 'متاحة للشراء' : 'موقوفة'}
                    description="إيقاف الخطة يخفيها عن الشراء الجديد دون التأثير على المشتركين الحاليين."
                    checked={plan.is_active}
                    onChange={(checked) => updatePlan(plan.id, 'is_active', checked)}
                  />
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <Input label="الاسم (إنجليزي)" value={plan.name} onChange={(v) => updatePlan(plan.id, 'name', v)} />
                <Input label="الاسم بالعربية" value={plan.name_ar} onChange={(v) => updatePlan(plan.id, 'name_ar', v)} />
                <Input label="المدة بالأيام" type="number" value={String(plan.duration_days)} onChange={(v) => updatePlan(plan.id, 'duration_days', Number(v))} />
                <Input label="السعر بـCoin" type="number" value={String(plan.price_coins)} onChange={(v) => updatePlan(plan.id, 'price_coins', Number(v))} />
                <Input label="دفعة XP (0–250)" type="number" value={String(plan.xp_boost)} onChange={(v) => updatePlan(plan.id, 'xp_boost', Number(v))} />
              </div>
              <div className="flex justify-end">
                <button
                  onClick={() => void save(plan)}
                  disabled={savingId === plan.id}
                  className="flex items-center gap-2 rounded-lg bg-wattar-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {savingId === plan.id ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                  حفظ
                </button>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label className="block text-xs text-gray-400">
      {label}
      <input
        type={type}
        min={type === 'number' ? '0' : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-lg border border-wattar-900 bg-dark-elevated px-3 py-2 text-sm text-white"
      />
    </label>
  );
}
