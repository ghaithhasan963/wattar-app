import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Save } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';

interface GiftItem {
  id: string;
  name: string;
  name_ar: string | null;
  icon_url: string;
  icon_emoji: string;
  price_gold: number;
  recipient_diamond_ratio: number;
  category: string | null;
  is_premium: boolean;
  is_active: boolean;
  sort_order: number;
}

interface NewGift {
  name: string;
  name_ar: string;
  icon_url: string;
  icon_emoji: string;
  price_gold: string;
  recipient_diamond_ratio: string;
  category: string;
  is_premium: boolean;
  sort_order: string;
}

const emptyGift: NewGift = {
  name: '',
  name_ar: '',
  icon_url: '',
  icon_emoji: '🎁',
  price_gold: '100',
  recipient_diamond_ratio: '50',
  category: 'common',
  is_premium: false,
  sort_order: '10',
};

function isValidGift(gift: Pick<GiftItem, 'name' | 'icon_emoji' | 'price_gold' | 'recipient_diamond_ratio' | 'category' | 'sort_order'>) {
  return gift.name.trim().length >= 2 && gift.name.trim().length <= 50
    && [...gift.icon_emoji].length >= 1 && [...gift.icon_emoji].length <= 8
    && Number.isSafeInteger(gift.price_gold) && gift.price_gold > 0
    && Number.isFinite(gift.recipient_diamond_ratio)
    && gift.recipient_diamond_ratio >= 1 && gift.recipient_diamond_ratio <= 100
    && (gift.category?.length ?? 0) <= 30
    && Number.isSafeInteger(gift.sort_order) && gift.sort_order >= 0;
}

function isValidIconUrl(value: string) {
  return value.trim() === '' || value.trim().startsWith('/gifts/') || /^https:\/\//i.test(value.trim());
}

export function StoreItemsPage() {
  const [gifts, setGifts] = useState<GiftItem[]>([]);
  const [form, setForm] = useState<NewGift>(emptyGift);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { data, error } = await supabase.from('gifts')
        .select('id, name, name_ar, icon_url, icon_emoji, price_gold, recipient_diamond_ratio, category, is_premium, is_active, sort_order')
        .order('sort_order');
      if (error) throw error;
      setGifts((data ?? []) as GiftItem[]);
    } catch (caught: unknown) {
      setLoadError(caught instanceof Error ? caught.message : 'تعذر تحميل كتالوج الهدايا');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (gift: GiftItem) => {
    if ((gift.name_ar?.trim().length ?? 0) > 50 || !isValidGift(gift) || !isValidIconUrl(gift.icon_url)) {
      toast.error('تحقق من الاسم والسعر والرمز ورابط الصورة ونسبة Diamonds وترتيب العرض');
      return;
    }
    setSavingId(gift.id);
    try {
      const { error } = await supabase.from('gifts').update({
        name: gift.name.trim(),
        name_ar: gift.name_ar?.trim() || null,
        icon_url: gift.icon_url.trim(),
        icon_emoji: gift.icon_emoji,
        price_gold: gift.price_gold,
        recipient_diamond_ratio: Math.round(gift.recipient_diamond_ratio * 100) / 100,
        category: gift.category?.trim() || null,
        is_premium: gift.is_premium,
        is_active: gift.is_active,
        sort_order: gift.sort_order,
      }).eq('id', gift.id);
      if (error) throw error;
      toast.success('تم حفظ الهدية وتسجيل التغيير في سجل الإدارة');
    } catch (caught: unknown) {
      toast.error(caught instanceof Error ? caught.message : 'تعذر حفظ الهدية');
    } finally {
      setSavingId(null);
    }
  };

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const gift = {
      name: form.name,
      icon_emoji: form.icon_emoji,
      price_gold: Number(form.price_gold),
      recipient_diamond_ratio: Number(form.recipient_diamond_ratio),
      category: form.category,
      sort_order: Number(form.sort_order),
    };
    if ((form.name_ar.trim().length > 50) || !isValidGift(gift) || !isValidIconUrl(form.icon_url)) {
      toast.error('تحقق من الاسم والسعر والرمز ورابط الصورة ونسبة Diamonds وترتيب العرض');
      return;
    }
    setCreating(true);
    try {
      const { error } = await supabase.from('gifts').insert({
        ...gift,
        name: form.name.trim(),
        name_ar: form.name_ar.trim() || null,
        icon_url: form.icon_url.trim(),
        is_premium: form.is_premium,
        is_active: true,
      });
      if (error) throw error;
      setForm(emptyGift);
      await load();
      toast.success('تمت إضافة الهدية وتسجيل التغيير في سجل الإدارة');
    } catch (caught: unknown) {
      toast.error(caught instanceof Error ? caught.message : 'تعذرت إضافة الهدية');
    } finally {
      setCreating(false);
    }
  };

  const updateGift = (id: string, field: keyof GiftItem, value: string | number | boolean | null) => {
    setGifts((current) => current.map((gift) => gift.id === id ? { ...gift, [field]: value } : gift));
  };

  return (
    <div className="space-y-6" dir="rtl">
      <div>
        <h1 className="text-2xl font-bold text-white">كتالوج متجر الهدايا</h1>
        <p className="mt-1 text-sm text-gray-400">
          عدّل الأسعار والتوفر ونسبة Diamonds بوضوح؛ التغييرات مسجلة إداريًا ولا تُحذف الهدايا المستخدمة في المعاملات.
        </p>
      </div>

      <form onSubmit={create} className="space-y-4 rounded-xl border border-wattar-900 bg-dark-surface p-5">
        <h2 className="text-lg font-semibold text-white">إضافة هدية</h2>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          <Input label="اسم داخلي" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
          <Input label="الاسم العربي" value={form.name_ar} onChange={(v) => setForm({ ...form, name_ar: v })} />
          <Input label="رمز Emoji" value={form.icon_emoji} onChange={(v) => setForm({ ...form, icon_emoji: v })} />
          <Input label="رابط صورة HTTPS (اختياري)" value={form.icon_url} onChange={(v) => setForm({ ...form, icon_url: v })} />
          <Input label="السعر Coins" type="number" value={form.price_gold} onChange={(v) => setForm({ ...form, price_gold: v })} />
          <Input label="نسبة Diamonds للمستلم (%)" type="number" value={form.recipient_diamond_ratio} onChange={(v) => setForm({ ...form, recipient_diamond_ratio: v })} />
          <Input label="التصنيف" value={form.category} onChange={(v) => setForm({ ...form, category: v })} />
          <Input label="ترتيب العرض" type="number" value={form.sort_order} onChange={(v) => setForm({ ...form, sort_order: v })} />
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input type="checkbox" checked={form.is_premium} onChange={(e) => setForm({ ...form, is_premium: e.target.checked })} className="h-4 w-4 accent-wattar-600" />
            هدية مميزة
          </label>
        </div>
        <button disabled={creating} className="flex items-center gap-2 rounded-lg bg-wattar-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {creating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
          إضافة
        </button>
      </form>

      {loading ? (
        <p className="text-gray-400">جاري التحميل...</p>
      ) : loadError ? (
        <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-300">
          <p>تعذر تحميل كتالوج الهدايا: {loadError}</p>
          <button onClick={() => void load()} className="mt-3 rounded-lg bg-red-500/20 px-4 py-2 text-sm">إعادة المحاولة</button>
        </div>
      ) : (
        <div className="grid gap-4">
          {gifts.map((gift) => (
            <section key={gift.id} className="space-y-4 rounded-xl border border-wattar-900 bg-dark-surface p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{gift.icon_emoji}</span>
                  <div>
                    <h2 className="font-semibold text-white">{gift.name_ar || gift.name}</h2>
                    <p className="mt-1 text-xs text-gray-400">{gift.name}</p>
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-300">
                  <input type="checkbox" checked={gift.is_active} onChange={(e) => updateGift(gift.id, 'is_active', e.target.checked)} className="h-4 w-4 accent-wattar-600" />
                  {gift.is_active ? 'متاحة' : 'موقوفة'}
                </label>
              </div>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                <Input label="اسم داخلي" value={gift.name} onChange={(v) => updateGift(gift.id, 'name', v)} />
                <Input label="الاسم العربي" value={gift.name_ar ?? ''} onChange={(v) => updateGift(gift.id, 'name_ar', v || null)} />
                <Input label="رمز Emoji" value={gift.icon_emoji} onChange={(v) => updateGift(gift.id, 'icon_emoji', v)} />
                <Input label="رابط صورة HTTPS (اختياري)" value={gift.icon_url} onChange={(v) => updateGift(gift.id, 'icon_url', v)} />
                <Input label="السعر Coins" type="number" value={String(gift.price_gold)} onChange={(v) => updateGift(gift.id, 'price_gold', Number(v))} />
                <Input label="نسبة Diamonds للمستلم (%)" type="number" value={String(gift.recipient_diamond_ratio)} onChange={(v) => updateGift(gift.id, 'recipient_diamond_ratio', Number(v))} />
                <Input label="التصنيف" value={gift.category ?? ''} onChange={(v) => updateGift(gift.id, 'category', v || null)} />
                <Input label="ترتيب العرض" type="number" value={String(gift.sort_order)} onChange={(v) => updateGift(gift.id, 'sort_order', Number(v))} />
                <label className="flex items-center gap-2 text-sm text-gray-300">
                  <input type="checkbox" checked={gift.is_premium} onChange={(e) => updateGift(gift.id, 'is_premium', e.target.checked)} className="h-4 w-4 accent-wattar-600" />
                  هدية مميزة
                </label>
              </div>
              <div className="flex justify-end">
                <button onClick={() => void save(gift)} disabled={savingId === gift.id} className="flex items-center gap-2 rounded-lg bg-wattar-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                  {savingId === gift.id ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                  حفظ
                </button>
              </div>
            </section>
          ))}
          {gifts.length === 0 ? <p className="text-gray-400">لا توجد هدايا في الكتالوج.</p> : null}
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
