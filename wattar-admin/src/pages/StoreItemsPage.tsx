/**
 * Wattar Admin — كتالوج متجر الهدايا (M9.1)
 * كل الكتابة عبر RPCs محمية بصلاحية store.manage مع سبب إلزامي وتدقيق،
 * والحذف من العرض أرشفة فقط (السجلات التاريخية تبقى).
 */
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, Loader2, Plus, RefreshCw, Save } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { canAccess, useAuthStore } from '@/store/auth';
import { Toggle } from '@/components/ui';

const giftTypes = [
  { value: 'normal', label: 'عادية' },
  { value: 'animated', label: 'متحركة' },
  { value: 'entry', label: 'دخول' },
  { value: 'huge', label: 'ضخمة (ملء الشاشة)' },
  { value: 'seasonal', label: 'موسمية' },
  { value: 'rare', label: 'نادرة' },
  { value: 'collective', label: 'جماعية' },
  { value: 'occasion', label: 'مناسبات' },
] as const;

const rarities = [
  { value: 'common', label: 'شائعة' },
  { value: 'uncommon', label: 'غير شائعة' },
  { value: 'rare', label: 'نادرة' },
  { value: 'epic', label: 'ملحمية' },
  { value: 'legendary', label: 'أسطورية' },
] as const;

interface Gift {
  id: string;
  name: string;
  name_ar: string | null;
  icon_url: string;
  icon_emoji: string;
  animation_url: string | null;
  sound_url: string | null;
  effect_key: string | null;
  display_duration_ms: number;
  gift_type: string;
  rarity: string;
  category: string | null;
  price_gold: number;
  recipient_diamond_ratio: number;
  is_premium: boolean;
  is_active: boolean;
  sort_order: number;
  available_from: string | null;
  available_to: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  daily_limit_per_user: number | null;
  stock_total: number | null;
  stock_sold: number;
  archived_at: string | null;
  transactions_count: number;
}

interface Campaign {
  id: string;
  key: string;
  name: string;
  name_ar: string | null;
  starts_at: string;
  ends_at: string;
  discount_percent: number;
  is_active: boolean;
  running: boolean;
  gifts_count: number;
}

interface GiftForm {
  name: string;
  name_ar: string;
  icon_url: string;
  icon_emoji: string;
  animation_url: string;
  sound_url: string;
  effect_key: string;
  display_duration_ms: string;
  gift_type: string;
  rarity: string;
  category: string;
  price_gold: string;
  recipient_diamond_ratio: string;
  is_premium: boolean;
  is_active: boolean;
  sort_order: string;
  available_from: string;
  available_to: string;
  campaign_id: string;
  daily_limit_per_user: string;
  stock_total: string;
  reason: string;
}

interface GiftPayloadInput {
  name: string;
  name_ar: string | null;
  icon_url: string;
  icon_emoji: string;
  animation_url: string | null;
  sound_url: string | null;
  effect_key: string | null;
  display_duration_ms: number;
  gift_type: string;
  rarity: string;
  category: string | null;
  price_gold: number;
  recipient_diamond_ratio: number;
  is_premium: boolean;
  is_active: boolean;
  sort_order: number;
  available_from: string | null;
  available_to: string | null;
  campaign_id: string | null;
  daily_limit_per_user: number | null;
  stock_total: number | null;
}

const emptyGift: GiftForm = {
  name: '',
  name_ar: '',
  icon_url: '/gifts/',
  icon_emoji: '🎁',
  animation_url: '',
  sound_url: '',
  effect_key: '',
  display_duration_ms: '4000',
  gift_type: 'normal',
  rarity: 'common',
  category: 'common',
  price_gold: '100',
  recipient_diamond_ratio: '50',
  is_premium: false,
  is_active: true,
  sort_order: '10',
  available_from: '',
  available_to: '',
  campaign_id: '',
  daily_limit_per_user: '',
  stock_total: '',
  reason: '',
};

interface CampaignForm {
  key: string;
  name: string;
  name_ar: string;
  starts_at: string;
  ends_at: string;
  discount_percent: string;
  is_active: boolean;
  reason: string;
}

const emptyCampaign: CampaignForm = {
  key: '',
  name: '',
  name_ar: '',
  starts_at: '',
  ends_at: '',
  discount_percent: '0',
  is_active: true,
  reason: '',
};

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toIso(value: string): string | null {
  if (!value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isValidPath(value: string) {
  const trimmed = value.trim();
  return trimmed === '' || trimmed.startsWith('/gifts/') || /^https:\/\//i.test(trimmed);
}

export function StoreItemsPage() {
  const profile = useAuthStore((state) => state.profile);
  const canManage = canAccess(profile, 'store.manage');
  const adminId = profile?.id ?? null;

  const [gifts, setGifts] = useState<Gift[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<GiftForm>(emptyGift);
  const [campaignForm, setCampaignForm] = useState<CampaignForm>(emptyCampaign);
  const [savingCampaign, setSavingCampaign] = useState(false);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    if (!adminId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [giftsRes, campaignsRes] = await Promise.all([
        supabase.rpc('admin_list_gifts', { p_admin_id: adminId }),
        supabase.rpc('admin_list_gift_campaigns', { p_admin_id: adminId }),
      ]);
      if (giftsRes.error) throw giftsRes.error;
      if (campaignsRes.error) throw campaignsRes.error;
      setGifts((giftsRes.data ?? []) as Gift[]);
      setCampaigns((campaignsRes.data ?? []) as Campaign[]);
    } catch (caught: unknown) {
      setLoadError(caught instanceof Error ? caught.message : 'تعذر تحميل كتالوج الهدايا');
    } finally {
      setLoading(false);
    }
  }, [adminId]);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleGifts = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return gifts;
    return gifts.filter((gift) =>
      gift.name.toLowerCase().includes(term)
      || (gift.name_ar ?? '').toLowerCase().includes(term)
      || (gift.category ?? '').toLowerCase().includes(term),
    );
  }, [gifts, search]);

  const updateGift = <K extends keyof Gift>(id: string, field: K, value: Gift[K]) => {
    setGifts((current) => current.map((gift) => (gift.id === id ? { ...gift, [field]: value } : gift)));
  };

  const buildPayload = (gift: GiftPayloadInput) => ({
    name: gift.name,
    name_ar: gift.name_ar,
    icon_url: gift.icon_url,
    icon_emoji: gift.icon_emoji,
    animation_url: gift.animation_url,
    sound_url: gift.sound_url,
    effect_key: gift.effect_key,
    display_duration_ms: gift.display_duration_ms,
    gift_type: gift.gift_type,
    rarity: gift.rarity,
    category: gift.category,
    price_gold: gift.price_gold,
    recipient_diamond_ratio: gift.recipient_diamond_ratio,
    is_premium: gift.is_premium,
    is_active: gift.is_active,
    sort_order: gift.sort_order,
    available_from: gift.available_from,
    available_to: gift.available_to,
    campaign_id: gift.campaign_id,
    daily_limit_per_user: gift.daily_limit_per_user,
    stock_total: gift.stock_total,
  });

  const save = async (gift: Gift) => {
    if (!adminId || !canManage) return;
    const reason = (reasons[gift.id] ?? '').trim();
    if (reason.length < 10 || reason.length > 500) {
      toast.error('سبب التعديل مطلوب بين 10 و500 حرف');
      return;
    }
    if (!isValidPath(gift.icon_url) || !isValidPath(gift.animation_url ?? '') || !isValidPath(gift.sound_url ?? '')) {
      toast.error('الروابط يجب أن تبدأ بـ/gifts/ أو https://');
      return;
    }
    setSavingId(gift.id);
    try {
      const { error } = await supabase.rpc('admin_upsert_gift', {
        p_admin_id: adminId,
        p_gift_id: gift.id,
        p_payload: buildPayload(gift),
        p_reason: reason,
      });
      if (error) throw error;
      setReasons((current) => ({ ...current, [gift.id]: '' }));
      await load();
      toast.success('تم حفظ الهدية وتسجيل التغيير في سجل التدقيق');
    } catch (caught: unknown) {
      toast.error(caught instanceof Error ? caught.message : 'تعذر حفظ الهدية');
    } finally {
      setSavingId(null);
    }
  };

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!adminId || !canManage) return;
    if (form.reason.trim().length < 10) {
      toast.error('سبب الإضافة مطلوب بين 10 و500 حرف');
      return;
    }
    if (!isValidPath(form.icon_url) || !isValidPath(form.animation_url) || !isValidPath(form.sound_url)) {
      toast.error('الروابط يجب أن تبدأ بـ/gifts/ أو https://');
      return;
    }
    setCreating(true);
    try {
      const { error } = await supabase.rpc('admin_upsert_gift', {
        p_admin_id: adminId,
        p_gift_id: null,
        p_payload: buildPayload({
          ...form,
          animation_url: form.animation_url.trim() || null,
          sound_url: form.sound_url.trim() || null,
          effect_key: form.effect_key.trim() || null,
          category: form.category.trim() || null,
          campaign_id: form.campaign_id || null,
          display_duration_ms: Number(form.display_duration_ms),
          price_gold: Number(form.price_gold),
          recipient_diamond_ratio: Number(form.recipient_diamond_ratio),
          sort_order: Number(form.sort_order),
          daily_limit_per_user: form.daily_limit_per_user ? Number(form.daily_limit_per_user) : null,
          stock_total: form.stock_total ? Number(form.stock_total) : null,
          available_from: toIso(form.available_from),
          available_to: toIso(form.available_to),
        }),
        p_reason: form.reason.trim(),
      });
      if (error) throw error;
      setForm(emptyGift);
      await load();
      toast.success('تمت إضافة الهدية — تظهر في التطبيق فوراً بلا تعديل كود');
    } catch (caught: unknown) {
      toast.error(caught instanceof Error ? caught.message : 'تعذرت إضافة الهدية');
    } finally {
      setCreating(false);
    }
  };

  const archive = async (gift: Gift) => {
    if (!adminId || !canManage) return;
    const reason = window.prompt(`سبب إزالة «${gift.name_ar || gift.name}» من العرض (10–500 حرف):`)?.trim() ?? '';
    if (reason.length < 10) {
      toast.error('سبب الإزالة مطلوب بين 10 و500 حرف');
      return;
    }
    setArchivingId(gift.id);
    try {
      const { error } = await supabase.rpc('admin_archive_gift', {
        p_admin_id: adminId,
        p_gift_id: gift.id,
        p_reason: reason,
      });
      if (error) throw error;
      await load();
      toast.success('أُزيلت من العرض مع إبقاء كل السجلات التاريخية');
    } catch (caught: unknown) {
      toast.error(caught instanceof Error ? caught.message : 'تعذرت أرشفة الهدية');
    } finally {
      setArchivingId(null);
    }
  };

  const saveCampaign = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!adminId || !canManage) return;
    if (campaignForm.reason.trim().length < 10) {
      toast.error('سبب الحملة مطلوب بين 10 و500 حرف');
      return;
    }
    if (!campaignForm.starts_at || !campaignForm.ends_at) {
      toast.error('حدد بداية الحملة ونهايتها');
      return;
    }
    setSavingCampaign(true);
    try {
      const { error } = await supabase.rpc('admin_upsert_gift_campaign', {
        p_admin_id: adminId,
        p_campaign_id: null,
        p_payload: {
          key: campaignForm.key.trim(),
          name: campaignForm.name.trim(),
          name_ar: campaignForm.name_ar.trim() || null,
          starts_at: toIso(campaignForm.starts_at),
          ends_at: toIso(campaignForm.ends_at),
          discount_percent: Number(campaignForm.discount_percent),
          is_active: campaignForm.is_active,
        },
        p_reason: campaignForm.reason.trim(),
      });
      if (error) throw error;
      setCampaignForm(emptyCampaign);
      await load();
      toast.success('أُنشئت الحملة — اربط بها الهدايا ليُطبّق خصمها تلقائياً');
    } catch (caught: unknown) {
      toast.error(caught instanceof Error ? caught.message : 'تعذر إنشاء الحملة');
    } finally {
      setSavingCampaign(false);
    }
  };

  const toggleCampaign = async (campaign: Campaign) => {
    if (!adminId || !canManage) return;
    const reason = window.prompt(`سبب ${campaign.is_active ? 'إيقاف' : 'تفعيل'} الحملة «${campaign.name_ar || campaign.name}»:`)?.trim() ?? '';
    if (reason.length < 10) {
      toast.error('السبب مطلوب بين 10 و500 حرف');
      return;
    }
    try {
      const { error } = await supabase.rpc('admin_upsert_gift_campaign', {
        p_admin_id: adminId,
        p_campaign_id: campaign.id,
        p_payload: {
          key: campaign.key,
          name: campaign.name,
          name_ar: campaign.name_ar,
          starts_at: campaign.starts_at,
          ends_at: campaign.ends_at,
          discount_percent: campaign.discount_percent,
          is_active: !campaign.is_active,
        },
        p_reason: reason,
      });
      if (error) throw error;
      await load();
      toast.success('حُدّثت حالة الحملة');
    } catch (caught: unknown) {
      toast.error(caught instanceof Error ? caught.message : 'تعذر تحديث الحملة');
    }
  };

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">كتالوج متجر الهدايا</h1>
          <p className="mt-1 text-sm text-gray-400">
            الأنواع والندرة والمؤثرات والجدولة والحملات — كل التغييرات مسجلة بالسبب وقبل/بعد.
            الإزالة من العرض أرشفة فقط ولا تحذف أي حركة تاريخية.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="flex items-center gap-2 rounded-lg border border-wattar-900 px-3 py-2 text-sm text-gray-300"
        >
          <RefreshCw size={15} /> تحديث
        </button>
      </div>

      {!canManage ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
          صلاحية العرض فقط (store.view) — التعديل يتطلب store.manage.
        </div>
      ) : null}

      {canManage ? (
        <form onSubmit={create} className="space-y-4 rounded-xl border border-wattar-900 bg-dark-surface p-5">
          <h2 className="text-lg font-semibold text-white">إضافة هدية</h2>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            <Input label="اسم داخلي" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
            <Input label="الاسم العربي" value={form.name_ar} onChange={(v) => setForm({ ...form, name_ar: v })} />
            <Input label="رمز Emoji" value={form.icon_emoji} onChange={(v) => setForm({ ...form, icon_emoji: v })} />
            <Input label="أيقونة (/gifts/ أو https)" value={form.icon_url} onChange={(v) => setForm({ ...form, icon_url: v })} />
            <Input label="رابط الحركة (اختياري)" value={form.animation_url} onChange={(v) => setForm({ ...form, animation_url: v })} />
            <Input label="رابط الصوت (اختياري)" value={form.sound_url} onChange={(v) => setForm({ ...form, sound_url: v })} />
            <Input label="مفتاح المؤثر (مثل sparkle_gold)" value={form.effect_key} onChange={(v) => setForm({ ...form, effect_key: v })} />
            <Select label="نوع الهدية" value={form.gift_type} options={giftTypes} onChange={(v) => setForm({ ...form, gift_type: v })} />
            <Select label="الندرة" value={form.rarity} options={rarities} onChange={(v) => setForm({ ...form, rarity: v })} />
            <Input label="التصنيف" value={form.category} onChange={(v) => setForm({ ...form, category: v })} />
            <Input label="السعر Coins" type="number" value={form.price_gold} onChange={(v) => setForm({ ...form, price_gold: v })} />
            <Input label="نسبة المستفيد (%)" type="number" value={form.recipient_diamond_ratio} onChange={(v) => setForm({ ...form, recipient_diamond_ratio: v })} />
            <Input label="مدة العرض (مللي ثانية)" type="number" value={form.display_duration_ms} onChange={(v) => setForm({ ...form, display_duration_ms: v })} />
            <Input label="ترتيب العرض" type="number" value={form.sort_order} onChange={(v) => setForm({ ...form, sort_order: v })} />
            <Input label="بداية العرض (اختياري)" type="datetime-local" value={form.available_from} onChange={(v) => setForm({ ...form, available_from: v })} />
            <Input label="نهاية العرض (اختياري)" type="datetime-local" value={form.available_to} onChange={(v) => setForm({ ...form, available_to: v })} />
            <Select
              label="الحملة (خصم تلقائي)"
              value={form.campaign_id}
              options={[{ value: '', label: 'بلا حملة' }, ...campaigns.map((c) => ({ value: c.id, label: `${c.name_ar || c.name} (${c.discount_percent}%)` }))]}
              onChange={(v) => setForm({ ...form, campaign_id: v })}
            />
            <Input label="حد يومي لكل مستخدم (اختياري)" type="number" value={form.daily_limit_per_user} onChange={(v) => setForm({ ...form, daily_limit_per_user: v })} />
            <Input label="المخزون الكلي (اختياري)" type="number" value={form.stock_total} onChange={(v) => setForm({ ...form, stock_total: v })} />
            <Toggle label="هدية مميزة" checked={form.is_premium} onChange={(checked) => setForm({ ...form, is_premium: checked })} />
            <Toggle label="نشطة في المتجر" checked={form.is_active} onChange={(checked) => setForm({ ...form, is_active: checked })} />
          </div>
          <Input label="سبب الإضافة (إلزامي)" value={form.reason} onChange={(v) => setForm({ ...form, reason: v })} />
          <button disabled={creating} className="flex items-center gap-2 rounded-lg bg-wattar-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {creating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
            إضافة
          </button>
        </form>
      ) : null}

      <form onSubmit={saveCampaign} className="space-y-4 rounded-xl border border-wattar-900 bg-dark-surface p-5">
        <h2 className="text-lg font-semibold text-white">حملات الهدايا</h2>
        <p className="text-xs text-gray-400">
          الحملة تمنح خصماً على سعر الهدايا المرتبطة بها داخل نافذتها الزمنية فقط، ولا تغيّر أي عملية سابقة.
        </p>
        {canManage ? (
          <>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              <Input label="مفتاح (a-z0-9_)" value={campaignForm.key} onChange={(v) => setCampaignForm({ ...campaignForm, key: v })} />
              <Input label="الاسم الداخلي" value={campaignForm.name} onChange={(v) => setCampaignForm({ ...campaignForm, name: v })} />
              <Input label="الاسم العربي" value={campaignForm.name_ar} onChange={(v) => setCampaignForm({ ...campaignForm, name_ar: v })} />
              <Input label="البداية" type="datetime-local" value={campaignForm.starts_at} onChange={(v) => setCampaignForm({ ...campaignForm, starts_at: v })} />
              <Input label="النهاية" type="datetime-local" value={campaignForm.ends_at} onChange={(v) => setCampaignForm({ ...campaignForm, ends_at: v })} />
              <Input label="الخصم %" type="number" value={campaignForm.discount_percent} onChange={(v) => setCampaignForm({ ...campaignForm, discount_percent: v })} />
              <Toggle label="مفعّلة" checked={campaignForm.is_active} onChange={(checked) => setCampaignForm({ ...campaignForm, is_active: checked })} />
            </div>
            <Input label="سبب الإنشاء (إلزامي)" value={campaignForm.reason} onChange={(v) => setCampaignForm({ ...campaignForm, reason: v })} />
            <button disabled={savingCampaign} className="flex items-center gap-2 rounded-lg bg-wattar-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              {savingCampaign ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              إنشاء حملة
            </button>
          </>
        ) : null}
        <div className="grid gap-3">
          {campaigns.map((campaign) => (
            <div key={campaign.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-wattar-900 bg-dark-elevated p-3">
              <div>
                <p className="text-sm font-medium text-white">{campaign.name_ar || campaign.name}</p>
                <p className="mt-1 text-xs text-gray-400">
                  {campaign.key} · خصم {campaign.discount_percent}% · {campaign.gifts_count} هدية
                  {campaign.running ? ' · جارية الآن' : campaign.is_active ? ' · مجدولة' : ' · موقوفة'}
                </p>
              </div>
              {canManage ? (
                <button type="button" onClick={() => void toggleCampaign(campaign)} className="rounded-lg border border-wattar-900 px-3 py-1.5 text-xs text-gray-300">
                  {campaign.is_active ? 'إيقاف' : 'تفعيل'}
                </button>
              ) : null}
            </div>
          ))}
          {campaigns.length === 0 ? <p className="text-sm text-gray-400">لا توجد حملات بعد.</p> : null}
        </div>
      </form>

      <div className="flex flex-wrap items-center gap-3">
        <Input label="بحث" value={search} onChange={setSearch} />
      </div>

      {loading ? (
        <p className="text-gray-400">جاري التحميل...</p>
      ) : loadError ? (
        <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-300">
          <p>تعذر تحميل كتالوج الهدايا: {loadError}</p>
          <button onClick={() => void load()} className="mt-3 rounded-lg bg-red-500/20 px-4 py-2 text-sm">إعادة المحاولة</button>
        </div>
      ) : (
        <div className="grid gap-4">
          {visibleGifts.map((gift) => (
            <section key={gift.id} className="space-y-4 rounded-xl border border-wattar-900 bg-dark-surface p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{gift.icon_emoji}</span>
                  <div>
                    <h2 className="font-semibold text-white">{gift.name_ar || gift.name}</h2>
                    <p className="mt-1 text-xs text-gray-400">
                      {gift.name} · {gift.gift_type} · {gift.rarity}
                      {gift.archived_at ? ' · مؤرشف' : gift.is_active ? '' : ' · موقوف'}
                      {' · '}{gift.transactions_count} حركة
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-full max-w-[200px]">
                    <Toggle
                      label={gift.is_active ? 'متاحة في المتجر' : 'موقوفة'}
                      checked={gift.is_active}
                      onChange={(checked) => updateGift(gift.id, 'is_active', checked)}
                    />
                  </div>
                  {canManage && !gift.archived_at ? (
                    <button
                      type="button"
                      onClick={() => void archive(gift)}
                      disabled={archivingId === gift.id}
                      className="flex items-center gap-1.5 rounded-lg border border-red-500/40 px-3 py-2 text-xs text-red-300 disabled:opacity-50"
                    >
                      {archivingId === gift.id ? <Loader2 size={14} className="animate-spin" /> : <Archive size={14} />}
                      إزالة من العرض
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                <Input label="اسم داخلي" value={gift.name} onChange={(v) => updateGift(gift.id, 'name', v)} />
                <Input label="الاسم العربي" value={gift.name_ar ?? ''} onChange={(v) => updateGift(gift.id, 'name_ar', v || null)} />
                <Input label="رمز Emoji" value={gift.icon_emoji} onChange={(v) => updateGift(gift.id, 'icon_emoji', v)} />
                <Input label="أيقونة" value={gift.icon_url} onChange={(v) => updateGift(gift.id, 'icon_url', v)} />
                <Input label="رابط الحركة" value={gift.animation_url ?? ''} onChange={(v) => updateGift(gift.id, 'animation_url', v || null)} />
                <Input label="رابط الصوت" value={gift.sound_url ?? ''} onChange={(v) => updateGift(gift.id, 'sound_url', v || null)} />
                <Input label="مفتاح المؤثر" value={gift.effect_key ?? ''} onChange={(v) => updateGift(gift.id, 'effect_key', v || null)} />
                <Select label="النوع" value={gift.gift_type} options={giftTypes} onChange={(v) => updateGift(gift.id, 'gift_type', v)} />
                <Select label="الندرة" value={gift.rarity} options={rarities} onChange={(v) => updateGift(gift.id, 'rarity', v)} />
                <Input label="التصنيف" value={gift.category ?? ''} onChange={(v) => updateGift(gift.id, 'category', v || null)} />
                <Input label="السعر Coins" type="number" value={String(gift.price_gold)} onChange={(v) => updateGift(gift.id, 'price_gold', Number(v))} />
                <Input label="نسبة المستفيد (%)" type="number" value={String(gift.recipient_diamond_ratio)} onChange={(v) => updateGift(gift.id, 'recipient_diamond_ratio', Number(v))} />
                <Input label="مدة العرض (ms)" type="number" value={String(gift.display_duration_ms)} onChange={(v) => updateGift(gift.id, 'display_duration_ms', Number(v))} />
                <Input label="ترتيب العرض" type="number" value={String(gift.sort_order)} onChange={(v) => updateGift(gift.id, 'sort_order', Number(v))} />
                <Input label="بداية العرض" type="datetime-local" value={toLocalInput(gift.available_from)} onChange={(v) => updateGift(gift.id, 'available_from', toIso(v))} />
                <Input label="نهاية العرض" type="datetime-local" value={toLocalInput(gift.available_to)} onChange={(v) => updateGift(gift.id, 'available_to', toIso(v))} />
                <Select
                  label="الحملة"
                  value={gift.campaign_id ?? ''}
                  options={[{ value: '', label: 'بلا حملة' }, ...campaigns.map((c) => ({ value: c.id, label: `${c.name_ar || c.name} (${c.discount_percent}%)` }))]}
                  onChange={(v) => updateGift(gift.id, 'campaign_id', v || null)}
                />
                <Input label="حد يومي" type="number" value={gift.daily_limit_per_user === null ? '' : String(gift.daily_limit_per_user)} onChange={(v) => updateGift(gift.id, 'daily_limit_per_user', v ? Number(v) : null)} />
                <Input label="المخزون الكلي" type="number" value={gift.stock_total === null ? '' : String(gift.stock_total)} onChange={(v) => updateGift(gift.id, 'stock_total', v ? Number(v) : null)} />
                <Input label="المباع" value={String(gift.stock_sold)} onChange={() => undefined} />
                <Toggle label="هدية مميزة" checked={gift.is_premium} onChange={(checked) => updateGift(gift.id, 'is_premium', checked)} />
              </div>

              {canManage ? (
                <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
                  <Input label="سبب التعديل (إلزامي)" value={reasons[gift.id] ?? ''} onChange={(v) => setReasons({ ...reasons, [gift.id]: v })} />
                  <button onClick={() => void save(gift)} disabled={savingId === gift.id} className="flex h-10 items-center justify-center gap-2 rounded-lg bg-wattar-600 px-4 text-sm font-medium text-white disabled:opacity-50">
                    {savingId === gift.id ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                    حفظ
                  </button>
                </div>
              ) : null}
            </section>
          ))}
          {visibleGifts.length === 0 ? <p className="text-gray-400">لا توجد هدايا مطابقة.</p> : null}
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

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block text-xs text-gray-400">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-lg border border-wattar-900 bg-dark-elevated px-3 py-2 text-sm text-white"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}
