import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw, Save, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { canAccess, useAuthStore } from '@/store/auth';
import { Toggle } from '@/components/ui';

interface ProtectionProduct {
  id: string;
  kind: 'anti_kick' | 'anti_ban';
  mode: 'permanent' | 'subscription' | 'bundle';
  name_ar: string;
  price_coins: number;
  duration_days: number | null;
  is_active: boolean;
  updated_at: string;
}

interface ProtectionRow {
  id: string;
  kind: string;
  expires_at: string | null;
  created_at: string;
  user: { username: string; display_name: string | null } | null;
}

const kindLabels: Record<string, string> = {
  anti_kick: 'مانع طرد',
  anti_ban: 'مانع حظر',
};

const modeLabels: Record<string, string> = {
  permanent: 'دائم',
  subscription: 'اشتراك',
  bundle: 'باقة',
};

export function ProtectionProductsPage() {
  const profile = useAuthStore((state) => state.profile);
  const canManage = canAccess(profile, 'protection.manage');
  const adminId = profile?.id ?? null;

  const [products, setProducts] = useState<ProtectionProduct[]>([]);
  const [rows, setRows] = useState<ProtectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [productsRes, rowsRes] = await Promise.all([
        supabase
          .from('protection_products')
          .select('id, kind, mode, name_ar, price_coins, duration_days, is_active, updated_at')
          .order('kind', { ascending: true })
          .order('price_coins', { ascending: true }),
        supabase
          .from('user_protections')
          .select('id, kind, expires_at, created_at, user:users(username, display_name)')
          .order('created_at', { ascending: false })
          .limit(50),
      ]);
      if (productsRes.error) throw productsRes.error;
      if (rowsRes.error) throw rowsRes.error;
      setProducts((productsRes.data ?? []) as unknown as ProtectionProduct[]);
      setRows((rowsRes.data ?? []) as unknown as ProtectionRow[]);
    } catch (caught: unknown) {
      setLoadError(caught instanceof Error ? caught.message : 'تعذر تحميل منتجات الحماية');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const updateField = <K extends keyof ProtectionProduct>(id: string, field: K, value: ProtectionProduct[K]) => {
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, [field]: value } : p)));
  };

  const save = async (product: ProtectionProduct) => {
    if (!adminId) return;
    const reason = (reasons[product.id] ?? '').trim();
    if (reason.length < 10 || reason.length > 500) {
      toast.error('سبب التعديل مطلوب بين 10 و500 حرف');
      return;
    }
    const nameAr = product.name_ar.trim();
    if (nameAr.length < 2 || nameAr.length > 60) {
      toast.error('اسم المنتج مطلوب بين 2 و60 حرفًا');
      return;
    }
    if (!Number.isSafeInteger(product.price_coins) || product.price_coins < 1 || product.price_coins > 10000000) {
      toast.error('السعر يجب أن يكون بين 1 و10,000,000 كوين');
      return;
    }
    if (product.mode !== 'permanent') {
      if (!Number.isSafeInteger(product.duration_days ?? 0) || (product.duration_days ?? 0) < 1 || (product.duration_days ?? 0) > 3650) {
        toast.error('مدة الاشتراك/الباقة يجب أن تكون بين 1 و3650 يومًا');
        return;
      }
    }
    setSavingId(product.id);
    try {
      const { error } = await supabase.rpc('admin_upsert_protection_product', {
        p_admin_id: adminId,
        p_product_id: product.id,
        p_payload: {
          kind: product.kind,
          mode: product.mode,
          name_ar: nameAr,
          price_coins: product.price_coins,
          duration_days: product.mode === 'permanent' ? null : product.duration_days,
          is_active: product.is_active,
        },
        p_reason: reason,
      });
      if (error) throw error;
      toast.success(`تم حفظ ${nameAr} وتسجيل التغيير في سجل الإدارة`);
      await load();
    } catch (caught: unknown) {
      toast.error(caught instanceof Error ? caught.message : 'تعذر حفظ المنتج');
    } finally {
      setSavingId(null);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>, product: ProtectionProduct) => {
    event.preventDefault();
    void save(product);
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center gap-2 text-sm text-gray-400">
        <Loader2 className="h-5 w-5 animate-spin" /> جاري تحميل منتجات الحماية...
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-bold text-white">
            <ShieldCheck className="h-5 w-5 text-emerald-400" /> أدوات الحماية المدفوعة
          </h1>
          <p className="mt-1 text-sm text-gray-400">
            مانع الطرد ومانع الحظر — دائم أو اشتراك أو باقة، بالأسعار الإدارية — التغييرات تُسجَّل في سجل الإدارة.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-gray-200 hover:bg-white/[0.06]"
        >
          <RefreshCw className="h-4 w-4" /> تحديث
        </button>
      </header>

      {loadError && (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{loadError}</p>
      )}

      <div className="space-y-4">
        {products.map((product) => (
          <form
            key={product.id}
            onSubmit={(event) => submit(event, product)}
            className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5"
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-white">
                {kindLabels[product.kind] ?? product.kind}{' '}
                <span className="text-sm font-normal text-gray-500">— {modeLabels[product.mode] ?? product.mode}</span>
              </h2>
              <span
                className={`rounded-full px-2.5 py-1 text-xs ${
                  product.is_active ? 'bg-emerald-500/15 text-emerald-300' : 'bg-gray-500/15 text-gray-400'
                }`}
              >
                {product.is_active ? 'معروض' : 'معطّل'}
              </span>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-gray-200">الاسم بالعربية</span>
                <input
                  type="text"
                  value={product.name_ar}
                  onChange={(e) => updateField(product.id, 'name_ar', e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white"
                  maxLength={60}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-gray-200">السعر (كوين)</span>
                <input
                  type="number"
                  min={1}
                  max={10000000}
                  value={product.price_coins}
                  onChange={(e) => updateField(product.id, 'price_coins', Number(e.target.value))}
                  className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white"
                />
              </label>
              {product.mode !== 'permanent' ? (
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-gray-200">المدة (يوم)</span>
                  <input
                    type="number"
                    min={1}
                    max={3650}
                    value={product.duration_days ?? 30}
                    onChange={(e) => updateField(product.id, 'duration_days', Number(e.target.value))}
                    className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white"
                  />
                </label>
              ) : (
                <div className="flex items-end pb-2 text-sm text-gray-500">دائم — بلا مدة</div>
              )}
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-gray-200">سبب التعديل (مطلوب)</span>
                <input
                  type="text"
                  value={reasons[product.id] ?? ''}
                  onChange={(e) => setReasons((prev) => ({ ...prev, [product.id]: e.target.value }))}
                  className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white"
                  maxLength={500}
                  placeholder="سبب واضح يُسجَّل في سجل الإدارة"
                />
              </label>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <Toggle
                label="معروض للبيع"
                checked={product.is_active}
                onChange={(checked) => updateField(product.id, 'is_active', checked)}
              />
            </div>

            <div className="mt-4 flex justify-end">
              <button
                type="submit"
                disabled={!canManage || savingId === product.id}
                className="inline-flex items-center gap-2 rounded-xl bg-wattar-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {savingId === product.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                حفظ التعديلات
              </button>
            </div>
          </form>
        ))}
      </div>

      <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
        <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-white">
          <ShieldCheck className="h-4 w-4 text-emerald-400" /> آخر ٥٠ حماية مشتراة
        </h2>
        {rows.length === 0 ? (
          <p className="text-sm text-gray-500">لا عمليات بعد.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="text-xs text-gray-400">
                <tr>
                  <th className="px-3 py-2">المستخدم</th>
                  <th className="px-3 py-2">النوع</th>
                  <th className="px-3 py-2">الانتهاء</th>
                  <th className="px-3 py-2">تاريخ الشراء</th>
                </tr>
              </thead>
              <tbody className="text-gray-200">
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-white/[0.05]">
                    <td className="px-3 py-2">{row.user?.username ?? '—'}</td>
                    <td className="px-3 py-2">{kindLabels[row.kind] ?? row.kind}</td>
                    <td className="px-3 py-2">{row.expires_at ? new Date(row.expires_at).toLocaleString('ar') : 'دائم'}</td>
                    <td className="px-3 py-2">{new Date(row.created_at).toLocaleString('ar')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
