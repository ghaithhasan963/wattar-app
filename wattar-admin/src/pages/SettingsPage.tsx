/**
 * Wattar Admin — صفحة الإعدادات العامة
 * مفاتيح admin_settings
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Save, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface Setting {
  key: string;
  value: any;
  description: string | null;
  is_public: boolean;
}

interface DepositMethod {
  method: 'usdt' | 'sham_cash' | 'syriatel_cash' | 'agent';
  name_ar: string;
  instructions: string;
  is_enabled: boolean;
  min_amount_usd: number;
  max_amount_usd: number;
  exchange_rate_usd_to_coins: number | null;
  sort_order: number;
}

const settingLabels: Record<string, string> = {
  daily_bonus_gold: 'مكافأة الدخول اليومية (Coin)',
};

const settingDescriptions: Record<string, string> = {
  daily_bonus_gold: 'عدد Coin المجانية عند استلام مكافأة الدخول مرة كل 24 ساعة (الحد الأقصى 100).',
};

export function SettingsPage() {
  const [settings, setSettings] = useState<Setting[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [depositMethods, setDepositMethods] = useState<DepositMethod[]>([]);
  const [methodsLoading, setMethodsLoading] = useState(true);
  const [methodsError, setMethodsError] = useState<string | null>(null);
  const [savingMethod, setSavingMethod] = useState<string | null>(null);

  useEffect(() => {
    load();
    loadDepositMethods();
  }, []);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { data, error } = await supabase.from('admin_settings').select('*').order('key');
      if (error) throw error;
      setSettings((data ?? []).filter((setting) =>
        setting.key !== 'free_coin_daily_grant'
        && setting.key !== 'free_coin_balance_cap'
        && setting.key !== 'diamond_to_coin_rate'
        &&
        (!setting.key.startsWith('withdraw') || [
          'withdrawals_enabled',
          'withdrawal_fee_percent',
          'min_withdrawal_diamonds',
        ].includes(setting.key))
        && !setting.key.startsWith('transfer')
      ));
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : 'تعذر تحميل الإعدادات');
    } finally {
      setLoading(false);
    }
  };

  const save = async (key: string) => {
    setSavingKey(key);
    const setting = settings.find(s => s.key === key);
    if (!setting) return;
    try {
      // تحويل القيمة إلى JSONB-compatible
      let val: any = setting.value;
      if (typeof val === 'string') {
        if (val === 'true') val = true;
        else if (val === 'false') val = false;
        else if (!isNaN(Number(val))) val = Number(val);
      }
      if (key === 'daily_bonus_gold' && (!Number.isInteger(Number(val)) || Number(val) < 1 || Number(val) > 100)) {
        toast.error('مكافأة الدخول اليومية يجب أن تكون رقماً صحيحاً بين 1 و100 Coin');
        setSavingKey(null);
        return;
      }
      const { error } = await supabase
        .from('admin_settings')
        .update({ value: val })
        .eq('key', key);
      if (error) throw error;
      toast.success('تم حفظ الإعداد');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSavingKey(null);
    }
  };

  const update = (key: string, value: any) => {
    setSettings(prev => prev.map(s => s.key === key ? { ...s, value } : s));
  };

  const loadDepositMethods = async () => {
    setMethodsLoading(true);
    setMethodsError(null);
    try {
      const { data, error } = await supabase
        .from('deposit_methods')
        .select('method, name_ar, instructions, is_enabled, min_amount_usd, max_amount_usd, exchange_rate_usd_to_coins, sort_order')
        .order('sort_order');
      if (error) throw error;
      setDepositMethods((data ?? []) as DepositMethod[]);
    } catch (err: unknown) {
      setMethodsError(err instanceof Error ? err.message : 'تعذر تحميل وسائل الشحن');
    } finally {
      setMethodsLoading(false);
    }
  };

  const updateDepositMethod = (method: string, changes: Partial<DepositMethod>) => {
    setDepositMethods((current) => current.map((item) => item.method === method
      ? { ...item, ...changes }
      : item));
  };

  const saveDepositMethod = async (item: DepositMethod) => {
    const minAmount = Number(item.min_amount_usd);
    const maxAmount = Number(item.max_amount_usd);
    const exchangeRate = item.exchange_rate_usd_to_coins === null
      ? null
      : Number(item.exchange_rate_usd_to_coins);
    if (!item.name_ar.trim() || !Number.isFinite(minAmount) || minAmount <= 0
      || !Number.isFinite(maxAmount) || maxAmount < minAmount
      || (exchangeRate !== null && (!Number.isFinite(exchangeRate) || exchangeRate <= 0))) {
      toast.error('تحقق من الاسم والحدود وسعر التحويل');
      return;
    }

    setSavingMethod(item.method);
    try {
      const { error } = await supabase
        .from('deposit_methods')
        .update({
          name_ar: item.name_ar.trim(),
          instructions: item.instructions.trim(),
          is_enabled: item.is_enabled,
          min_amount_usd: minAmount,
          max_amount_usd: maxAmount,
          exchange_rate_usd_to_coins: exchangeRate,
          updated_at: new Date().toISOString(),
        })
        .eq('method', item.method);
      if (error) throw error;
      toast.success('تم حفظ وسيلة الشحن');
      await loadDepositMethods();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'تعذر حفظ وسيلة الشحن');
    } finally {
      setSavingMethod(null);
    }
  };

  // تجميع الإعدادات حسب الفئة
  const categories: Record<string, Setting[]> = {};
  settings.forEach(s => {
    let cat = 'عام';
    if (s.key.startsWith('deposit')) cat = 'الشحن';
    else if (s.key.startsWith('withdraw') || s.key === 'diamonds_per_usd') cat = 'السحب';
    else if (s.key.startsWith('transfer')) cat = 'التحويل';
    else if (s.key.startsWith('usdt') || s.key.includes('gold') || s.key.includes('diamond') || s.key.includes('coins_per_usd')) cat = 'العملات';
    else if (s.key.includes('bonus') || s.key.includes('referral') || s.key.includes('point_')) cat = 'المكافآت';
    else if (s.key.includes('room')) cat = 'الغرف';
    else if (s.key.includes('app') || s.key.includes('maintenance') || s.key.includes('update')) cat = 'النظام';

    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(s);
  });

  return (
    <div className="space-y-6" dir="rtl">
      <div>
        <h1 className="text-2xl font-bold text-white">الإعدادات العامة</h1>
        <p className="text-gray-400 mt-1">ضبط كل جوانب التطبيق من مكان واحد</p>
      </div>

      {loading ? (
        <p className="text-gray-400">جاري التحميل...</p>
      ) : loadError ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-300">
          <p>تعذر تحميل الإعدادات: {loadError}</p>
          <button onClick={load} className="mt-3 rounded-lg bg-red-500/20 px-4 py-2 text-sm">إعادة المحاولة</button>
        </div>
      ) : settings.length === 0 ? (
        <p className="text-gray-400">لا توجد إعدادات متاحة لهذا الحساب.</p>
      ) : (
        <div className="space-y-6">
          {Object.entries(categories).map(([cat, items]) => (
            <div key={cat} className="bg-dark-surface rounded-xl border border-wattar-900 p-6">
              <h2 className="text-lg font-semibold text-white mb-4">{cat}</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {items.map(s => (
                  <div key={s.key} className="bg-dark-elevated rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-medium text-white">{settingLabels[s.key] ?? s.key}</label>
                      {s.is_public && (
                        <span className="text-xs text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded">عام</span>
                      )}
                    </div>
                    {(settingDescriptions[s.key] ?? s.description) && (
                      <p className="text-xs text-gray-500 mb-2">{settingDescriptions[s.key] ?? s.description}</p>
                    )}
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={typeof s.value === 'object' ? JSON.stringify(s.value) : String(s.value)}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === 'true') update(s.key, true);
                          else if (v === 'false') update(s.key, false);
                          else if (!isNaN(Number(v)) && v !== '') update(s.key, Number(v));
                          else update(s.key, v);
                        }}
                        className="flex-1 rounded bg-dark border border-wattar-900 px-3 py-2 text-white text-sm"
                      />
                      <button
                        onClick={() => save(s.key)}
                        disabled={savingKey === s.key}
                        className="rounded bg-wattar-600 hover:bg-wattar-700 px-3 text-white"
                      >
                        {savingKey === s.key ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-bold text-white">وسائل الشحن اليدوي</h2>
          <p className="mt-1 text-sm text-gray-400">
            تفعيل الطرق وتعليماتها وحدودها وسعر تحويل الدولار إلى Coins.
          </p>
        </div>
        {methodsLoading ? (
          <p className="text-gray-400">جاري تحميل وسائل الشحن...</p>
        ) : methodsError ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-300">
            <p>تعذر تحميل وسائل الشحن: {methodsError}</p>
            <button onClick={loadDepositMethods} className="mt-3 rounded-lg bg-red-500/20 px-4 py-2 text-sm">إعادة المحاولة</button>
          </div>
        ) : depositMethods.length === 0 ? (
          <p className="text-gray-400">لا توجد وسائل شحن. طبّق ترحيل محفظة Wattar v2 أولًا.</p>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {depositMethods.map((method) => (
              <div key={method.method} className="space-y-4 rounded-xl border border-wattar-900 bg-dark-surface p-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-semibold text-white">{method.method}</p>
                    <p className="text-xs text-gray-500">طريقة الدفع وإرشادات المستخدم</p>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-gray-300">
                    <input
                      type="checkbox"
                      checked={method.is_enabled}
                      onChange={(event) => updateDepositMethod(method.method, { is_enabled: event.target.checked })}
                      className="h-4 w-4 accent-purple-500"
                    />
                    مفعّلة
                  </label>
                </div>
                <label className="block space-y-1">
                  <span className="text-xs text-gray-400">الاسم الظاهر</span>
                  <input
                    value={method.name_ar}
                    onChange={(event) => updateDepositMethod(method.method, { name_ar: event.target.value })}
                    className="w-full rounded-lg border border-wattar-900 bg-dark px-3 py-2 text-sm text-white"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs text-gray-400">تعليمات الدفع الظاهرة للمستخدم</span>
                  <textarea
                    value={method.instructions}
                    onChange={(event) => updateDepositMethod(method.method, { instructions: event.target.value })}
                    rows={3}
                    className="w-full resize-y rounded-lg border border-wattar-900 bg-dark px-3 py-2 text-sm text-white"
                  />
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <label className="space-y-1">
                    <span className="text-xs text-gray-400">الحد الأدنى ($)</span>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={method.min_amount_usd}
                      onChange={(event) => updateDepositMethod(method.method, { min_amount_usd: Number(event.target.value) })}
                      className="w-full rounded-lg border border-wattar-900 bg-dark px-3 py-2 text-sm text-white"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs text-gray-400">الحد الأعلى ($)</span>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={method.max_amount_usd}
                      onChange={(event) => updateDepositMethod(method.method, { max_amount_usd: Number(event.target.value) })}
                      className="w-full rounded-lg border border-wattar-900 bg-dark px-3 py-2 text-sm text-white"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs text-gray-400">Coins لكل $1 (فارغ = السعر العام أو سعر الوكيل)</span>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={method.exchange_rate_usd_to_coins ?? ''}
                      onChange={(event) => updateDepositMethod(method.method, {
                        exchange_rate_usd_to_coins: event.target.value === '' ? null : Number(event.target.value),
                      })}
                      className="w-full rounded-lg border border-wattar-900 bg-dark px-3 py-2 text-sm text-white"
                    />
                  </label>
                </div>
                <button
                  onClick={() => saveDepositMethod(method)}
                  disabled={savingMethod === method.method}
                  className="flex items-center gap-2 rounded-lg bg-wattar-600 px-4 py-2 text-sm font-medium text-white hover:bg-wattar-700 disabled:opacity-50"
                >
                  {savingMethod === method.method ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                  حفظ الوسيلة
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
