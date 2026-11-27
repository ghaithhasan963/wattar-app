import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Crown, Loader2, RefreshCw, Save, Ticket } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { canAccess, useAuthStore } from '@/store/auth';
import { Toggle } from '@/components/ui';

interface VipTier {
  tier: number;
  name_ar: string;
  duration_days: number;
  price_coins: number;
  frame: string | null;
  badge: string | null;
  entry_effect: string | null;
  perks: string[];
  room_kick_protection: boolean;
  offer_discount_percent: number;
  offer_ends_at: string | null;
  is_active: boolean;
  updated_at: string;
}

interface VipSubscriptionRow {
  id: string;
  tier: number;
  purchase_kind: string;
  price_coins_paid: number;
  discount_percent: number;
  paid_coins: number;
  upgrade_credit_coins: number;
  starts_at: string;
  expires_at: string;
  created_at: string;
  user: { username: string; display_name: string | null } | null;
}

const kindLabels: Record<string, string> = {
  initial: 'شراء أول',
  upgrade: 'ترقية',
  renewal: 'تجديد',
};

const toInputDateTime = (value: string | null): string => {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
};

export function VIPPage() {
  const profile = useAuthStore((state) => state.profile);
  const canManage = canAccess(profile, 'vip.manage');
  const adminId = profile?.id ?? null;

  const [tiers, setTiers] = useState<VipTier[]>([]);
  const [subs, setSubs] = useState<VipSubscriptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingTier, setSavingTier] = useState<number | null>(null);
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [tiersRes, subsRes] = await Promise.all([
        supabase.from('vip_tiers').select('*').order('tier', { ascending: true }),
        supabase
          .from('vip_subscriptions')
          .select('id, tier, purchase_kind, price_coins_paid, discount_percent, paid_coins, upgrade_credit_coins, starts_at, expires_at, created_at, user:users(username, display_name)')
          .order('created_at', { ascending: false })
          .limit(50),
      ]);
      if (tiersRes.error) throw tiersRes.error;
      if (subsRes.error) throw subsRes.error;
      setTiers(((tiersRes.data ?? []) as VipTier[]).map((t) => ({ ...t, perks: Array.isArray(t.perks) ? t.perks : [] })));
      setSubs((subsRes.data ?? []) as unknown as VipSubscriptionRow[]);
    } catch (caught: unknown) {
      setLoadError(caught instanceof Error ? caught.message : 'تعذر تحميل بيانات VIP');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const updateTierField = <K extends keyof VipTier>(tier: number, field: K, value: VipTier[K]) => {
    setTiers((prev) => prev.map((t) => (t.tier === tier ? { ...t, [field]: value } : t)));
  };

  const save = async (tier: VipTier) => {
    if (!adminId) return;
    const reason = (reasons[tier.tier] ?? '').trim();
    if (reason.length < 10 || reason.length > 500) {
      toast.error('سبب التعديل مطلوب بين 10 و500 حرف');
      return;
    }
    const nameAr = tier.name_ar.trim();
    if (nameAr.length < 2 || nameAr.length > 40) {
      toast.error('اسم الدرجة مطلوب بين 2 و40 حرفًا');
      return;
    }
    if (!Number.isSafeInteger(tier.duration_days) || tier.duration_days < 1 || tier.duration_days > 3650) {
      toast.error('المدة يجب أن تكون بين 1 و3650 يومًا');
      return;
    }
    if (!Number.isSafeInteger(tier.price_coins) || tier.price_coins < 1 || tier.price_coins > 10000000) {
      toast.error('السعر يجب أن يكون بين 1 و10,000,000 كوين');
      return;
    }
    if (tier.offer_discount_percent < 0 || tier.offer_discount_percent > 90) {
      toast.error('نسبة الخصم بين 0 و90');
      return;
    }
    if (tier.perks.some((p) => p.trim().length === 0 || p.trim().length > 160)) {
      toast.error('كل ميزة يجب أن تكون نصًا بين 1 و160 حرفًا');
      return;
    }
    setSavingTier(tier.tier);
    try {
      const { error } = await supabase.rpc('admin_upsert_vip_tier', {
        p_admin_id: adminId,
        p_tier: tier.tier,
        p_payload: {
          name_ar: nameAr,
          duration_days: tier.duration_days,
          price_coins: tier.price_coins,
          frame: tier.frame?.trim() || null,
          badge: tier.badge?.trim() || null,
          entry_effect: tier.entry_effect?.trim() || null,
          perks: tier.perks.map((p) => p.trim()).filter((p) => p.length > 0),
          room_kick_protection: tier.room_kick_protection,
          offer_discount_percent: Number(tier.offer_discount_percent),
          offer_ends_at: tier.offer_ends_at ? new Date(tier.offer_ends_at).toISOString() : null,
          is_active: tier.is_active,
        },
        p_reason: reason,
      });
      if (error) throw error;
      toast.success(`تم حفظ ${nameAr} وتسجيل التغيير في سجل الإدارة`);
      await load();
    } catch (caught: unknown) {
      toast.error(caught instanceof Error ? caught.message : 'تعذر حفظ الدرجة');
    } finally {
      setSavingTier(null);
    }
  };

  const addPerk = (tier: number) => updateTierField(tier, 'perks', [...(tiers.find((t) => t.tier === tier)?.perks ?? []), '']);

  const submit = (event: FormEvent<HTMLFormElement>, tier: VipTier) => {
    event.preventDefault();
    void save(tier);
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center gap-2 text-sm text-gray-400">
        <Loader2 className="h-5 w-5 animate-spin" /> جاري تحميل درجات VIP...
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-bold text-white">
            <Crown className="h-5 w-5 text-amber-400" /> درجات VIP (١–١٠)
          </h1>
          <p className="mt-1 text-sm text-gray-400">
            السعر والمدة والمزايا والإطار والشارة وتأثير الدخول والعروض — التغييرات تُسجَّل في سجل الإدارة.
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
        {tiers.map((tier) => (
          <form
            key={tier.tier}
            onSubmit={(event) => submit(event, tier)}
            className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5"
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-white">
                {tier.name_ar} <span className="text-sm font-normal text-gray-500">#{tier.tier}</span>
              </h2>
              <span
                className={`rounded-full px-2.5 py-1 text-xs ${
                  tier.is_active ? 'bg-emerald-500/15 text-emerald-300' : 'bg-gray-500/15 text-gray-400'
                }`}
              >
                {tier.is_active ? 'مفعّلة' : 'معطّلة'}
              </span>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-gray-200">الاسم بالعربية</span>
                <input
                  type="text"
                  value={tier.name_ar}
                  onChange={(e) => updateTierField(tier.tier, 'name_ar', e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white"
                  maxLength={40}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-gray-200">المدة (يوم)</span>
                <input
                  type="number"
                  min={1}
                  max={3650}
                  value={tier.duration_days}
                  onChange={(e) => updateTierField(tier.tier, 'duration_days', Number(e.target.value))}
                  className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-gray-200">السعر (كوين)</span>
                <input
                  type="number"
                  min={1}
                  max={10000000}
                  value={tier.price_coins}
                  onChange={(e) => updateTierField(tier.tier, 'price_coins', Number(e.target.value))}
                  className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-gray-200">مفتاح الإطار</span>
                <input
                  type="text"
                  value={tier.frame ?? ''}
                  onChange={(e) => updateTierField(tier.tier, 'frame', e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white"
                  maxLength={60}
                  placeholder="vip_frame_1"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-gray-200">مفتاح الشارة</span>
                <input
                  type="text"
                  value={tier.badge ?? ''}
                  onChange={(e) => updateTierField(tier.tier, 'badge', e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white"
                  maxLength={60}
                  placeholder="vip_badge_1"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-gray-200">مفتاح تأثير الدخول</span>
                <input
                  type="text"
                  value={tier.entry_effect ?? ''}
                  onChange={(e) => updateTierField(tier.tier, 'entry_effect', e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white"
                  maxLength={60}
                  placeholder="vip_entry_1"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-gray-200">خصم العرض (%)</span>
                <input
                  type="number"
                  min={0}
                  max={90}
                  value={tier.offer_discount_percent}
                  onChange={(e) => updateTierField(tier.tier, 'offer_discount_percent', Number(e.target.value))}
                  className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-gray-200">نهاية العرض (اختياري)</span>
                <input
                  type="datetime-local"
                  value={toInputDateTime(tier.offer_ends_at)}
                  onChange={(e) => updateTierField(tier.tier, 'offer_ends_at', e.target.value ? new Date(e.target.value).toISOString() : null)}
                  className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-gray-200">سبب التعديل (مطلوب)</span>
                <input
                  type="text"
                  value={reasons[tier.tier] ?? ''}
                  onChange={(e) => setReasons((prev) => ({ ...prev, [tier.tier]: e.target.value }))}
                  className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white"
                  maxLength={500}
                  placeholder="سبب واضح يُسجَّل في سجل الإدارة"
                />
              </label>
            </div>

            <div className="mt-4">
              <span className="mb-1.5 block text-sm font-medium text-gray-200">المزايا (بصرية واجتماعية)</span>
              <div className="space-y-2">
                {tier.perks.map((perk, index) => (
                  <div key={index} className="flex gap-2">
                    <input
                      type="text"
                      value={perk}
                      maxLength={160}
                      onChange={(e) => {
                        const next = [...tier.perks];
                        next[index] = e.target.value;
                        updateTierField(tier.tier, 'perks', next);
                      }}
                      className="flex-1 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white"
                    />
                    <button
                      type="button"
                      onClick={() => updateTierField(tier.tier, 'perks', tier.perks.filter((_, i) => i !== index))}
                      className="rounded-xl border border-white/10 px-3 text-sm text-red-300 hover:bg-red-500/10"
                    >
                      حذف
                    </button>
                  </div>
                ))}
                {tier.perks.length < 12 && (
                  <button
                    type="button"
                    onClick={() => addPerk(tier.tier)}
                    className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-gray-200 hover:bg-white/[0.06]"
                  >
                    + إضافة ميزة
                  </button>
                )}
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <Toggle
                label="حماية من الطرد/الحظر العادي في الغرف"
                checked={tier.room_kick_protection}
                onChange={(checked) => updateTierField(tier.tier, 'room_kick_protection', checked)}
              />
              <Toggle
                label="درجة مفعّلة للبيع"
                checked={tier.is_active}
                onChange={(checked) => updateTierField(tier.tier, 'is_active', checked)}
              />
            </div>

            <div className="mt-4 flex justify-end">
              <button
                type="submit"
                disabled={!canManage || savingTier === tier.tier}
                className="inline-flex items-center gap-2 rounded-xl bg-wattar-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {savingTier === tier.tier ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                حفظ التعديلات
              </button>
            </div>
          </form>
        ))}
      </div>

      <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
        <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-white">
          <Ticket className="h-4 w-4 text-amber-400" /> آخر ٥٠ عملية VIP (شراء/ترقية/تجديد)
        </h2>
        {subs.length === 0 ? (
          <p className="text-sm text-gray-500">لا عمليات بعد.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="text-xs text-gray-400">
                <tr>
                  <th className="px-3 py-2">المستخدم</th>
                  <th className="px-3 py-2">الدرجة</th>
                  <th className="px-3 py-2">النوع</th>
                  <th className="px-3 py-2">مدفوع</th>
                  <th className="px-3 py-2">خصم</th>
                  <th className="px-3 py-2">رصيد ترقية</th>
                  <th className="px-3 py-2">من</th>
                  <th className="px-3 py-2">إلى</th>
                </tr>
              </thead>
              <tbody className="text-gray-200">
                {subs.map((row) => (
                  <tr key={row.id} className="border-t border-white/[0.05]">
                    <td className="px-3 py-2">{row.user?.username ?? '—'}</td>
                    <td className="px-3 py-2">VIP {row.tier}</td>
                    <td className="px-3 py-2">{kindLabels[row.purchase_kind] ?? row.purchase_kind}</td>
                    <td className="px-3 py-2">{row.paid_coins.toLocaleString('ar')}</td>
                    <td className="px-3 py-2">{row.discount_percent > 0 ? `${row.discount_percent}%` : '—'}</td>
                    <td className="px-3 py-2">{row.upgrade_credit_coins > 0 ? row.upgrade_credit_coins.toLocaleString('ar') : '—'}</td>
                    <td className="px-3 py-2">{new Date(row.starts_at).toLocaleString('ar')}</td>
                    <td className="px-3 py-2">{new Date(row.expires_at).toLocaleString('ar')}</td>
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
