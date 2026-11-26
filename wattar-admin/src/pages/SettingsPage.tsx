/**
 * Wattar Admin — الإعدادات العامة
 * واجهة اختيارات (Toggle / Segmented) بدل الكتابة اليدوية، مقسّمة إلى أقسام واضحة.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Coins,
  Gem,
  Gift,
  Landmark,
  Loader2,
  Percent,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import {
  Badge,
  EmptyState,
  NumberField,
  PageHeader,
  SectionCard,
  Segmented,
  TextField,
  Toggle,
} from '@/components/ui';

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

type TabKey = 'economy' | 'deposits' | 'withdrawals' | 'rewards' | 'platform';

interface SettingMeta {
  label: string;
  description?: string;
  tab: TabKey;
  editor: 'toggle' | 'choice' | 'number' | 'text';
  unit?: string;
  options?: number[];
  min?: number;
  max?: number;
  step?: number;
  multiline?: boolean;
  dir?: 'rtl' | 'ltr';
}

const tabs: Array<{ key: TabKey; label: string; icon: typeof Wallet }> = [
  { key: 'economy', label: 'الاقتصاد والعملات', icon: Coins },
  { key: 'deposits', label: 'الشحن', icon: ArrowDownToLine },
  { key: 'withdrawals', label: 'السحب', icon: ArrowUpFromLine },
  { key: 'rewards', label: 'المكافآت والتحويل', icon: Gift },
  { key: 'platform', label: 'النظام والمتقدم', icon: Settings2 },
];

const meta: Record<string, SettingMeta> = {
  paid_coins_per_usd: {
    label: 'سعر الشحن — Coins لكل دولار',
    description: 'كم Coin يحصل المستخدم مقابل كل دولار يُشحنه. القيمة المعتمدة حاليًا 3000.',
    tab: 'economy', editor: 'choice', options: [3000, 2500, 2000, 1000], unit: 'Coin/$', min: 1, max: 100000,
  },
  usdt_to_gold_rate: {
    label: 'سعر USDT إلى Coin',
    description: 'يُستخدم في تحويلات USDT القديمة. وحّده مع سعر الشحن لتجنّب الالتباس.',
    tab: 'economy', editor: 'choice', options: [3000, 1000], unit: 'Coin/USDT', min: 1, max: 100000,
  },
  diamonds_per_usd: {
    label: 'سعر السحب — Diamond لكل دولار',
    description: 'كم Diamond يعادل دولارًا واحدًا عند السحب. 3000 تعني أن 30000 Diamond = 10$.',
    tab: 'economy', editor: 'choice', options: [3000, 1000], unit: 'Diamond/$', min: 1, max: 100000,
  },
  diamond_to_coin_rate: {
    label: 'تحويل Diamond إلى Coin',
    description: 'كم Coin يحصل المستخدم مقابل كل Diamond عند التحويل داخل التطبيق.',
    tab: 'economy', editor: 'choice', options: [1, 0.5, 2], unit: 'Coin/Diamond', min: 0.01, max: 100, step: 0.01,
  },
  gold_to_usdt_rate: {
    label: 'قيمة Coin بالدولار (قديم)',
    description: 'سعر مرجعي قديم يُستخدم في تقارير الألعاب. القيمة الحالية 0.00033333 = 1/3000.',
    tab: 'economy', editor: 'number', unit: 'USDT/Coin', min: 0, max: 1, step: 0.00000001,
  },
  global_rtp_default: {
    label: 'نسبة العائد الافتراضية للألعاب (RTP)',
    description: 'النسبة الافتراضية لكل المستخدمين الذين لا يملكون إعدادًا خاصًا.',
    tab: 'economy', editor: 'choice', options: [30, 50, 70, 90], unit: '%', min: 0, max: 100,
  },
  deposits_enabled: {
    label: 'تفعيل الشحن',
    description: 'إيقافه يمنع كل طلبات الشحن فورًا من التطبيق.',
    tab: 'deposits', editor: 'toggle',
  },
  deposit_fee_percent: {
    label: 'عمولة الشحن',
    description: 'نسبة تُخصم من مبلغ الشحن قبل إضافة Coin. اتركها 0 لإلغاء العمولة.',
    tab: 'deposits', editor: 'choice', options: [0, 2, 5, 10], unit: '%', min: 0, max: 99, step: 0.01,
  },
  max_deposit_usd_per_day: {
    label: 'أعلى شحن يومي للمستخدم',
    description: 'مجموع طلبات الشحن اليومية المسموح بها لكل مستخدم.',
    tab: 'deposits', editor: 'choice', options: [500, 2000, 5000, 10000], unit: 'USD', min: 1, max: 100000,
  },
  withdrawals_enabled: {
    label: 'تفعيل السحب',
    description: 'إيقافه يمنع طلبات السحب. السحب متاح للمضيفات الموثقات والوكلاء فقط.',
    tab: 'withdrawals', editor: 'toggle',
  },
  withdrawal_fee_percent: {
    label: 'عمولة السحب',
    description: 'نسبة تُخصم من قيمة السحب قبل تحويل المبلغ الصافي.',
    tab: 'withdrawals', editor: 'choice', options: [0, 2, 5, 10], unit: '%', min: 0, max: 99, step: 0.01,
  },
  min_withdrawal_diamonds: {
    label: 'الحد الأدنى للسحب',
    description: 'أقل عدد Diamond يمكن سحبه في الطلب الواحد.',
    tab: 'withdrawals', editor: 'choice', options: [10000, 30000, 50000, 100000], unit: 'Diamond', min: 1, max: 10000000,
  },
  max_withdrawal_usd_per_day: {
    label: 'أعلى سحب يومي للمستخدم',
    description: 'مجموع قيمة طلبات السحب اليومية لكل مستخدم بالدولار.',
    tab: 'withdrawals', editor: 'choice', options: [100, 500, 1000, 5000], unit: 'USD', min: 1, max: 100000,
  },
  signup_bonus_enabled: {
    label: 'تفعيل مكافأة التسجيل',
    description: 'منح Coin مجانية للمستخدم الجديد عند إكمال التسجيل.',
    tab: 'rewards', editor: 'toggle',
  },
  new_user_bonus_gold: {
    label: 'مكافأة التسجيل',
    description: 'عدد Coin الممنوحة لكل مستخدم جديد.',
    tab: 'rewards', editor: 'choice', options: [0, 100, 500, 1000], unit: 'Coin', min: 0, max: 100000,
  },
  referral_bonus_gold: {
    label: 'مكافأة الإحالة',
    description: 'عدد Coin التي يحصل عليها صاحب كود الدعوة.',
    tab: 'rewards', editor: 'choice', options: [0, 100, 500, 1000], unit: 'Coin', min: 0, max: 100000,
  },
  daily_bonus_gold: {
    label: 'مكافأة الدخول اليومية',
    description: 'عدد Coin المجانية عند استلام مكافأة الدخول مرة كل 24 ساعة (الحد الأقصى 100).',
    tab: 'rewards', editor: 'choice', options: [10, 25, 50, 100], unit: 'Coin', min: 1, max: 100,
  },
  transfers_enabled: {
    label: 'تفعيل التحويل بين المستخدمين',
    description: 'السماح بتحويل Coin بين الحسابات داخل التطبيق.',
    tab: 'rewards', editor: 'toggle',
  },
  transfer_fee_percent: {
    label: 'عمولة التحويل',
    description: 'نسبة تُخصم من مبلغ التحويل بين المستخدمين.',
    tab: 'rewards', editor: 'choice', options: [0, 2, 5, 10], unit: '%', min: 0, max: 99, step: 0.01,
  },
  min_transfer_gold: {
    label: 'أقل مبلغ للتحويل',
    description: 'أقل كمية Coin يمكن تحويلها في عملية واحدة.',
    tab: 'rewards', editor: 'number', unit: 'Coin', min: 1, max: 1000000,
  },
  maintenance_mode: {
    label: 'وضع الصيانة',
    description: 'إيقاف مؤقت للتطبيق مع إظهار رسالة للمستخدمين.',
    tab: 'platform', editor: 'toggle',
  },
  min_app_version: {
    label: 'أقل إصدار مسموح للتطبيق',
    description: 'المستخدمون على إصدار أقدم سيُطلب منهم التحديث.',
    tab: 'platform', editor: 'text', dir: 'ltr',
  },
  force_update_message: {
    label: 'رسالة التحديث الإجباري',
    description: 'تظهر للمستخدم عند الحاجة إلى تحديث التطبيق.',
    tab: 'platform', editor: 'text', multiline: true,
  },
  default_room_seat_count: {
    label: 'عدد مقاعد الغرفة الافتراضي',
    description: 'عدد المقاعد عند إنشاء غرفة صوتية جديدة.',
    tab: 'platform', editor: 'choice', options: [4, 6, 8, 10, 12], unit: 'مقعد', min: 1, max: 30,
  },
  free_coin_daily_grant: {
    label: 'منحة Coin المجانية اليومية (نظام قديم)',
    description: 'بقايا نظام الألعاب السابق؛ لا تُستخدم في اقتصاد Bigo الحالي.',
    tab: 'platform', editor: 'number', unit: 'Coin', min: 0, max: 100000,
  },
  free_coin_balance_cap: {
    label: 'سقف رصيد Coin المجانية (نظام قديم)',
    description: 'بقايا نظام الألعاب السابق؛ لا تُستخدم في اقتصاد Bigo الحالي.',
    tab: 'platform', editor: 'number', unit: 'Coin', min: 0, max: 1000000,
  },
};

const hiddenKeys = new Set<string>(['usdt_wallets']);

function defaultMeta(key: string): SettingMeta {
  return {
    label: key,
    tab: 'platform',
    editor: 'text',
  };
}

function isBooleanSetting(setting: Setting, settingMeta: SettingMeta | undefined): boolean {
  return settingMeta?.editor === 'toggle' || typeof setting.value === 'boolean';
}

export function SettingsPage() {
  const [settings, setSettings] = useState<Setting[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<TabKey>('economy');
  const [search, setSearch] = useState('');
  const [depositMethods, setDepositMethods] = useState<DepositMethod[]>([]);
  const [methodsLoading, setMethodsLoading] = useState(true);
  const [methodsError, setMethodsError] = useState<string | null>(null);
  const [savingMethod, setSavingMethod] = useState<string | null>(null);
  const [usdtWallets, setUsdtWallets] = useState<{ trc20: string; bep20: string }>({ trc20: '', bep20: '' });
  const [savingWallets, setSavingWallets] = useState(false);

  useEffect(() => {
    void load();
    void loadDepositMethods();
  }, []);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { data, error } = await supabase.from('admin_settings').select('*').order('key');
      if (error) throw error;
      const rows = (data ?? []) as Setting[];
      setSettings(rows);
      const nextDrafts: Record<string, string> = {};
      rows.forEach((setting) => {
        if (setting.value !== null && typeof setting.value === 'object') return;
        nextDrafts[setting.key] = String(setting.value ?? '');
      });
      setDrafts(nextDrafts);
      const walletsSetting = rows.find((setting) => setting.key === 'usdt_wallets');
      const walletsValue = walletsSetting?.value;
      if (walletsValue && typeof walletsValue === 'object') {
        setUsdtWallets({
          trc20: typeof walletsValue.trc20 === 'string' ? walletsValue.trc20 : '',
          bep20: typeof walletsValue.bep20 === 'string' ? walletsValue.bep20 : '',
        });
      }
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : 'تعذر تحميل الإعدادات');
    } finally {
      setLoading(false);
    }
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

  const persist = async (key: string, value: any) => {
    setSavingKey(key);
    try {
      const { error } = await supabase
        .from('admin_settings')
        .update({ value })
        .eq('key', key);
      if (error) throw error;
      setSettings((current) => current.map((setting) => setting.key === key ? { ...setting, value } : setting));
      setDrafts((current) => ({ ...current, [key]: typeof value === 'object' ? '' : String(value) }));
      toast.success('تم حفظ الإعداد');
    } catch (err: any) {
      toast.error(err?.message ?? 'تعذر حفظ الإعداد');
    } finally {
      setSavingKey(null);
    }
  };

  const saveDraft = async (setting: Setting) => {
    const settingMeta = meta[setting.key];
    const raw = drafts[setting.key] ?? '';
    if (settingMeta?.editor === 'number' || settingMeta?.editor === 'choice') {
      const numeric = Number(raw);
      if (!Number.isFinite(numeric)) {
        toast.error('أدخل قيمة رقمية صحيحة');
        return;
      }
      if (settingMeta.min !== undefined && numeric < settingMeta.min) {
        toast.error(`أقل قيمة مسموحة ${settingMeta.min}`);
        return;
      }
      if (settingMeta.max !== undefined && numeric > settingMeta.max) {
        toast.error(`أعلى قيمة مسموحة ${settingMeta.max}`);
        return;
      }
      await persist(setting.key, numeric);
      return;
    }

    // Preserve the stored JSONB type instead of guessing from the text. A
    // heuristic conversion would corrupt values such as "1.0", "03" or
    // "true " and change how the server reads the setting.
    if (typeof setting.value === 'boolean') {
      const normalized = raw.trim().toLowerCase();
      if (normalized !== 'true' && normalized !== 'false') {
        toast.error('أدخل true أو false فقط');
        return;
      }
      await persist(setting.key, normalized === 'true');
      return;
    }
    if (typeof setting.value === 'number') {
      const numeric = Number(raw);
      if (!Number.isFinite(numeric)) {
        toast.error('أدخل قيمة رقمية صحيحة');
        return;
      }
      await persist(setting.key, numeric);
      return;
    }
    if (setting.value !== null && typeof setting.value === 'object') {
      toast.error('هذا الإعداد كائن JSON ولا يمكن تعديله من حقل نصي');
      return;
    }
    await persist(setting.key, raw);
  };

  const getValue = (key: string): any => settings.find((setting) => setting.key === key)?.value;
  const coinRate = Number(getValue('paid_coins_per_usd') ?? 3000);
  const diamondRate = Number(getValue('diamonds_per_usd') ?? 3000);
  const depositsEnabled = getValue('deposits_enabled') === true;
  const withdrawalsEnabled = getValue('withdrawals_enabled') === true;
  const withdrawalFee = Number(getValue('withdrawal_fee_percent') ?? 0);
  const depositFee = Number(getValue('deposit_fee_percent') ?? 0);
  const minWithdrawalDiamonds = Number(getValue('min_withdrawal_diamonds') ?? 30000);
  const minWithdrawalUsd = diamondRate > 0 ? minWithdrawalDiamonds / diamondRate : 0;

  const filteredByTab = useMemo(() => {
    const query = search.trim().toLowerCase();
    return settings
      .filter((setting) => !hiddenKeys.has(setting.key))
      .filter((setting) => {
        const settingMeta = meta[setting.key] ?? defaultMeta(setting.key);
        if (!query) return settingMeta.tab === activeTab;
        const haystack = `${setting.key} ${settingMeta.label} ${settingMeta.description ?? ''}`.toLowerCase();
        return haystack.includes(query);
      })
      .sort((a, b) => {
        const metaA = meta[a.key] ?? defaultMeta(a.key);
        const metaB = meta[b.key] ?? defaultMeta(b.key);
        return metaA.label.localeCompare(metaB.label, 'ar');
      });
  }, [activeTab, search, settings]);

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

  const saveUsdtWallets = async () => {
    const trc20 = usdtWallets.trc20.trim();
    const bep20 = usdtWallets.bep20.trim();
    if (trc20 && !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(trc20)) {
      toast.error('عنوان TRC20 غير صالح (يجب أن يبدأ بحرف T وطوله 34 حرفًا)');
      return;
    }
    if (bep20 && !/^0x[0-9a-fA-F]{40}$/.test(bep20)) {
      toast.error('عنوان BEP20 غير صالح (يجب أن يبدأ بـ0x وطوله 42 حرفًا)');
      return;
    }
    setSavingWallets(true);
    try {
      const { error } = await supabase
        .from('admin_settings')
        .update({ value: { trc20: trc20 || null, bep20: bep20 || null } })
        .eq('key', 'usdt_wallets');
      if (error) throw error;
      toast.success('تم حفظ محافظ استلام USDT');
    } catch (err: any) {
      toast.error(err?.message ?? 'تعذر حفظ المحافظ');
    } finally {
      setSavingWallets(false);
    }
  };

  return (
    <div className="space-y-5" dir="rtl">
      <PageHeader
        title="الإعدادات العامة"
        subtitle="كل ما يخص الاقتصاد والشحن والسحب والمكافآت في مكان واحد — اختيارات جاهزة بدل الكتابة اليدوية."
        actions={(
          <div className="flex items-center gap-2">
            <Badge tone={depositsEnabled ? 'success' : 'danger'}>
              الشحن {depositsEnabled ? 'مفعّل' : 'متوقف'}
            </Badge>
            <Badge tone={withdrawalsEnabled ? 'success' : 'danger'}>
              السحب {withdrawalsEnabled ? 'مفعّل' : 'متوقف'}
            </Badge>
          </div>
        )}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          icon={Coins}
          label="سعر الشحن"
          value={`1$ = ${coinRate.toLocaleString()} Coin`}
          hint={`عمولة الشحن ${depositFee}%`}
          tone="gold"
        />
        <SummaryCard
          icon={Gem}
          label="سعر السحب"
          value={`1$ = ${diamondRate.toLocaleString()} Diamond`}
          hint={`عمولة السحب ${withdrawalFee}%`}
          tone="teal"
        />
        <SummaryCard
          icon={Percent}
          label="الحد الأدنى للسحب"
          value={`${minWithdrawalDiamonds.toLocaleString()} Diamond`}
          hint={`≈ $${minWithdrawalUsd.toFixed(0)} · عمولة ${withdrawalFee}%`}
          tone="violet"
        />
        <SummaryCard
          icon={ShieldCheck}
          label="أهلية السحب"
          value="مضيفات موثقات + وكلاء"
          hint="المستخدم العادي: تحويل إلى Coin فقط"
          tone="emerald"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/[0.07] bg-[#171a2c] p-3">
        <div className="flex flex-wrap gap-1.5">
          {tabs.map((tab) => {
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm transition ${active
                  ? 'bg-wattar-600/20 font-semibold text-wattar-100 ring-1 ring-inset ring-wattar-500/30'
                  : 'text-gray-400 hover:bg-white/[0.04] hover:text-gray-100'}`}
              >
                <tab.icon size={15} />
                {tab.label}
              </button>
            );
          })}
        </div>
        <label className="relative block min-w-[220px] flex-1 sm:max-w-xs">
          <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="ابحث عن إعداد..."
            className="w-full rounded-xl border border-white/[0.08] bg-[#111424] py-2 pr-9 pl-3 text-sm text-white outline-none transition placeholder:text-gray-600 focus:border-wattar-400/60"
          />
        </label>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">جارٍ تحميل الإعدادات...</p>
      ) : loadError ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
          <p>تعذر تحميل الإعدادات: {loadError}</p>
          <button onClick={load} className="mt-3 rounded-lg bg-red-500/20 px-4 py-2 text-xs">إعادة المحاولة</button>
        </div>
      ) : (
        <>
          {activeTab === 'deposits' ? (
            <MethodsSection
              methods={depositMethods}
              loading={methodsLoading}
              error={methodsError}
              savingMethod={savingMethod}
              onChange={updateDepositMethod}
              onSave={saveDepositMethod}
              onReload={loadDepositMethods}
              wallets={usdtWallets}
              setWallets={setUsdtWallets}
              onSaveWallets={saveUsdtWallets}
              savingWallets={savingWallets}
            />
          ) : null}

          {activeTab === 'withdrawals' ? (
            <SectionCard
              title="محافظ استلام USDT"
              description="عناوين عامة لاستلام شحن المستخدمين فقط — لا تُدخل مفاتيح خاصة هنا أبدًا."
              icon={Landmark}
            >
              <div className="grid gap-4 md:grid-cols-2">
                <TextField
                  label="عنوان TRC20"
                  value={usdtWallets.trc20}
                  onChange={(value) => setUsdtWallets((current) => ({ ...current, trc20: value }))}
                  placeholder="T..."
                  dir="ltr"
                />
                <TextField
                  label="عنوان BEP20"
                  value={usdtWallets.bep20}
                  onChange={(value) => setUsdtWallets((current) => ({ ...current, bep20: value }))}
                  placeholder="0x..."
                  dir="ltr"
                />
              </div>
              <button
                onClick={() => void saveUsdtWallets()}
                disabled={savingWallets}
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-wattar-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-wattar-500 disabled:opacity-50"
              >
                {savingWallets ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                حفظ المحافظ
              </button>
            </SectionCard>
          ) : null}

          {filteredByTab.length === 0 ? (
            <EmptyState
              title="لا توجد إعدادات في هذا القسم"
              description="جرّب قسمًا آخر أو امسح كلمة البحث."
            />
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              {filteredByTab.map((setting) => (
                <SettingEditor
                  key={setting.key}
                  setting={setting}
                  settingMeta={meta[setting.key] ?? defaultMeta(setting.key)}
                  saving={savingKey === setting.key}
                  draft={drafts[setting.key] ?? ''}
                  onDraftChange={(value) => setDrafts((current) => ({ ...current, [setting.key]: value }))}
                  onPersist={(value) => void persist(setting.key, value)}
                  onSaveDraft={() => void saveDraft(setting)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: typeof Coins;
  label: string;
  value: string;
  hint: string;
  tone: 'gold' | 'teal' | 'violet' | 'emerald';
}) {
  const toneClass = {
    gold: 'text-amber-300 bg-amber-400/10',
    teal: 'text-teal-300 bg-teal-400/10',
    violet: 'text-wattar-300 bg-wattar-500/10',
    emerald: 'text-emerald-300 bg-emerald-400/10',
  }[tone];
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-[#171a2c] p-4">
      <div className="flex items-center gap-2.5">
        <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${toneClass}`}>
          <Icon size={17} />
        </span>
        <span className="text-xs text-gray-400">{label}</span>
      </div>
      <p className="mt-3 truncate text-lg font-bold text-white">{value}</p>
      <p className="mt-1 text-[11px] text-gray-500">{hint}</p>
    </div>
  );
}

function SettingEditor({
  setting,
  settingMeta,
  saving,
  draft,
  onDraftChange,
  onPersist,
  onSaveDraft,
}: {
  setting: Setting;
  settingMeta: SettingMeta;
  saving: boolean;
  draft: string;
  onDraftChange: (value: string) => void;
  onPersist: (value: any) => void;
  onSaveDraft: () => void;
}) {
  const [custom, setCustom] = useState(false);
  const currentNumber = Number(setting.value);
  const optionValues = settingMeta.options ?? [];
  const usesOptions = settingMeta.editor === 'choice' && optionValues.length > 0;
  const valueOutsideOptions = usesOptions && !optionValues.includes(currentNumber);
  const isCustom = custom || valueOutsideOptions;
  const isBoolean = isBooleanSetting(setting, settingMeta);
  const dirty = draft !== String(setting.value ?? '');

  return (
    <div className="rounded-2xl border border-white/[0.07] bg-[#171a2c] p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-white">{settingMeta.label}</p>
          {settingMeta.description ? (
            <p className="mt-1 text-[11px] leading-5 text-gray-500">
              {settingMeta.description}
              {setting.is_public ? ' · عام' : ''}
            </p>
          ) : null}
        </div>
        <span className="shrink-0 rounded-md bg-white/[0.05] px-2 py-0.5 text-[10px] text-gray-500" dir="ltr">
          {setting.key}
        </span>
      </div>

      {isBoolean ? (
        <Toggle
          label={settingMeta.label}
          checked={setting.value === true}
          saving={saving}
          onChange={(checked) => onPersist(checked)}
        />
      ) : usesOptions && !isCustom ? (
        <>
          <Segmented
            options={optionValues.map((optionValue) => ({
              value: optionValue,
              label: `${optionValue.toLocaleString()}${settingMeta.unit ? ` ${settingMeta.unit}` : ''}`,
            }))}
            value={currentNumber}
            onChange={(nextValue) => onPersist(Number(nextValue))}
            columns={optionValues.length > 3 ? 4 : optionValues.length}
          />
          <button
            type="button"
            onClick={() => {
              setCustom(true);
              onDraftChange(String(setting.value ?? ''));
            }}
            className="mt-2 text-[11px] font-medium text-wattar-300 hover:text-wattar-200"
          >
            قيمة أخرى (مخصصة)
          </button>
        </>
      ) : settingMeta.editor === 'text' ? (
        <TextField
          label={settingMeta.label}
          value={draft}
          onChange={onDraftChange}
          multiline={settingMeta.multiline}
          dir={settingMeta.dir}
          onSave={onSaveDraft}
          saving={saving}
          dirty={dirty}
        />
      ) : (
        <div className="space-y-2">
          {isCustom ? (
            <button
              type="button"
              onClick={() => setCustom(false)}
              className="text-[11px] font-medium text-wattar-300 hover:text-wattar-200"
            >
              العودة إلى الاختيارات الجاهزة
            </button>
          ) : null}
          <NumberField
            label="القيمة"
            value={draft}
            onChange={onDraftChange}
            unit={settingMeta.unit}
            min={settingMeta.min}
            max={settingMeta.max}
            step={settingMeta.step}
            onSave={onSaveDraft}
            saving={saving}
            dirty={dirty}
          />
        </div>
      )}
    </div>
  );
}

function MethodsSection({
  methods,
  loading,
  error,
  savingMethod,
  onChange,
  onSave,
  onReload,
  wallets,
  setWallets,
  onSaveWallets,
  savingWallets,
}: {
  methods: DepositMethod[];
  loading: boolean;
  error: string | null;
  savingMethod: string | null;
  onChange: (method: string, changes: Partial<DepositMethod>) => void;
  onSave: (item: DepositMethod) => void;
  onReload: () => void;
  wallets: { trc20: string; bep20: string };
  setWallets: React.Dispatch<React.SetStateAction<{ trc20: string; bep20: string }>>;
  onSaveWallets: () => void;
  savingWallets: boolean;
}) {
  return (
    <SectionCard
      title="وسائل الشحن اليدوي"
      description="فعّل الطريقة بمفتاح واحد، واختر الحدود وسعر التحويل من قائمة جاهزة."
      icon={ArrowDownToLine}
    >
      {loading ? (
        <p className="text-sm text-gray-400">جارٍ تحميل وسائل الشحن...</p>
      ) : error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
          <p>تعذر تحميل وسائل الشحن: {error}</p>
          <button onClick={onReload} className="mt-3 rounded-lg bg-red-500/20 px-4 py-2 text-xs">إعادة المحاولة</button>
        </div>
      ) : methods.length === 0 ? (
        <EmptyState title="لا توجد وسائل شحن" description="طبّق ترحيل محفظة Wattar v2 أولًا." />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {methods.map((method) => (
            <div key={method.method} className="space-y-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-white">{method.name_ar}</p>
                  <p className="text-[11px] text-gray-500" dir="ltr">{method.method}</p>
                </div>
                <Toggle
                  label=""
                  checked={method.is_enabled}
                  onChange={(checked) => onChange(method.method, { is_enabled: checked })}
                />
              </div>
              <TextField
                label="الاسم الظاهر"
                value={method.name_ar}
                onChange={(value) => onChange(method.method, { name_ar: value })}
              />
              <TextField
                label="تعليمات الدفع الظاهرة للمستخدم"
                value={method.instructions}
                onChange={(value) => onChange(method.method, { instructions: value })}
                multiline
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <NumberField
                  label="الحد الأدنى"
                  value={String(method.min_amount_usd)}
                  onChange={(value) => onChange(method.method, { min_amount_usd: Number(value) })}
                  unit="USD"
                  min={0.01}
                  step={0.01}
                />
                <NumberField
                  label="الحد الأعلى"
                  value={String(method.max_amount_usd)}
                  onChange={(value) => onChange(method.method, { max_amount_usd: Number(value) })}
                  unit="USD"
                  min={0.01}
                  step={0.01}
                />
              </div>
              <div>
                <p className="mb-1.5 text-sm font-medium text-gray-200">سعر التحويل</p>
                <Segmented
                  options={[
                    { label: 'السعر العام', value: 0 },
                    { label: '3000 Coin/$', value: 3000 },
                    { label: '1000 Coin/$', value: 1000 },
                    { label: 'مخصص', value: -1 },
                  ]}
                  value={method.exchange_rate_usd_to_coins ?? 0}
                  onChange={(value) => onChange(method.method, {
                    exchange_rate_usd_to_coins: value === 0 ? null : value === -1 ? 3000 : Number(value),
                  })}
                  columns={2}
                />
                {method.exchange_rate_usd_to_coins !== null && method.exchange_rate_usd_to_coins !== 3000 && method.exchange_rate_usd_to_coins !== 1000 ? (
                  <div className="mt-2">
                    <NumberField
                      label="سعر مخصص"
                      value={String(method.exchange_rate_usd_to_coins)}
                      onChange={(value) => onChange(method.method, { exchange_rate_usd_to_coins: Number(value) })}
                      unit="Coin/$"
                      min={1}
                    />
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => onSave(method)}
                disabled={savingMethod === method.method}
                className="inline-flex items-center gap-2 rounded-xl bg-wattar-600 px-4 py-2 text-sm font-medium text-white hover:bg-wattar-500 disabled:opacity-50"
              >
                {savingMethod === method.method ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                حفظ الوسيلة
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
          <Landmark size={16} className="text-wattar-300" /> محافظ استلام USDT
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <TextField
            label="عنوان TRC20"
            value={wallets.trc20}
            onChange={(value) => setWallets((current) => ({ ...current, trc20: value }))}
            placeholder="T..."
            dir="ltr"
          />
          <TextField
            label="عنوان BEP20"
            value={wallets.bep20}
            onChange={(value) => setWallets((current) => ({ ...current, bep20: value }))}
            placeholder="0x..."
            dir="ltr"
          />
        </div>
        <button
          onClick={onSaveWallets}
          disabled={savingWallets}
          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-wattar-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-wattar-500 disabled:opacity-50"
        >
          {savingWallets ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
          حفظ المحافظ
        </button>
      </div>
    </SectionCard>
  );
}
