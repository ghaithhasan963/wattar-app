/**
 * Wattar Admin — حزم الملصقات (M9.2، القسم 26)
 * كل الكتابة عبر RPCs محمية بصلاحية stickers.manage مع سبب إلزامي وتدقيق،
 * والتعطيل أرشفة فقط (السجلات التاريخية تبقى ولا يُحذف شيء).
 */
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, Loader2, Plus, RefreshCw, Save, Search } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { canAccess, useAuthStore } from '@/store/auth';
import { Toggle } from '@/components/ui';

interface StickerRow {
  id: string;
  pack_id: string;
  code: string;
  emoji: string | null;
  image_url: string | null;
  animation_url: string | null;
  sort_order: number;
  is_active: boolean;
}

interface PackRow {
  id: string;
  key: string;
  name: string;
  name_ar: string | null;
  icon_emoji: string;
  cover_url: string | null;
  sort_order: number;
  is_premium: boolean;
  is_active: boolean;
  archived_at: string | null;
  stickers_count: number;
  active_stickers: number;
  stickers: StickerRow[];
}

interface PackDraft {
  key: string;
  name: string;
  name_ar: string;
  icon_emoji: string;
  cover_url: string;
  sort_order: string;
  is_premium: boolean;
  is_active: boolean;
}

interface StickerDraft {
  code: string;
  emoji: string;
  image_url: string;
  animation_url: string;
  sort_order: string;
  is_active: boolean;
}

const emptyPackDraft: PackDraft = {
  key: '',
  name: '',
  name_ar: '',
  icon_emoji: '🙂',
  cover_url: '',
  sort_order: '10',
  is_premium: false,
  is_active: true,
};

const emptyStickerDraft: StickerDraft = {
  code: '',
  emoji: '🙂',
  image_url: '',
  animation_url: '',
  sort_order: '10',
  is_active: true,
};

function toPackDraft(pack: PackRow): PackDraft {
  return {
    key: pack.key,
    name: pack.name,
    name_ar: pack.name_ar ?? '',
    icon_emoji: pack.icon_emoji || '🙂',
    cover_url: pack.cover_url ?? '',
    sort_order: String(pack.sort_order ?? 0),
    is_premium: pack.is_premium,
    is_active: pack.is_active,
  };
}

function toStickerDraft(sticker: StickerRow): StickerDraft {
  return {
    code: sticker.code,
    emoji: sticker.emoji ?? '',
    image_url: sticker.image_url ?? '',
    animation_url: sticker.animation_url ?? '',
    sort_order: String(sticker.sort_order ?? 0),
    is_active: sticker.is_active,
  };
}

function checkReason(reason: string): string | null {
  const value = reason.trim();
  if (value.length < 10) return 'أدخل سبباً لا يقل عن 10 أحرف';
  if (value.length > 500) return 'السبب لا يتجاوز 500 حرف';
  return null;
}

function isAssetUrl(value: string): boolean {
  if (!value) return true;
  return value.startsWith('/stickers/') || /^https:\/\//i.test(value);
}

export function StickerPacksPage() {
  const profile = useAuthStore((state) => state.profile);
  const canManage = canAccess(profile, 'stickers.manage');
  const adminId = profile?.id ?? null;

  const [packs, setPacks] = useState<PackRow[]>([]);
  const [packDrafts, setPackDrafts] = useState<Record<string, PackDraft>>({});
  const [stickerDrafts, setStickerDrafts] = useState<Record<string, StickerDraft>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [newSticker, setNewSticker] = useState<StickerDraft>(emptyStickerDraft);
  const [newPack, setNewPack] = useState<PackDraft>(emptyPackDraft);
  const [createReason, setCreateReason] = useState('');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    if (!adminId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const { data, error } = await supabase.rpc('admin_list_sticker_packs', { p_admin_id: adminId });
      if (error) throw error;
      const list = (data ?? []) as PackRow[];
      setPacks(list);
      setPackDrafts(
        Object.fromEntries(list.map((pack) => [pack.id, toPackDraft(pack)])),
      );
      setStickerDrafts(
        Object.fromEntries(
          list.flatMap((pack) => pack.stickers.map((sticker) => [sticker.id, toStickerDraft(sticker)])),
        ),
      );
    } catch (caught: unknown) {
      setLoadError(caught instanceof Error ? caught.message : 'تعذر تحميل حزم الملصقات.');
    } finally {
      setLoading(false);
    }
  }, [adminId]);

  useEffect(() => {
    void load();
  }, [load]);

  const visiblePacks = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return packs;
    return packs.filter((pack) => {
      if (pack.key.includes(term) || pack.name.toLowerCase().includes(term)) return true;
      if ((pack.name_ar ?? '').includes(search.trim())) return true;
      return pack.stickers.some((sticker) => sticker.code.includes(term));
    });
  }, [packs, search]);

  const updatePackDraft = <K extends keyof PackDraft>(id: string, field: K, value: PackDraft[K]) => {
    setPackDrafts((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  };

  const updateStickerDraft = <K extends keyof StickerDraft>(id: string, field: K, value: StickerDraft[K]) => {
    setStickerDrafts((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  };

  const setReason = (id: string, value: string) => {
    setReasons((prev) => ({ ...prev, [id]: value }));
  };

  const createPack = async (event: FormEvent) => {
    event.preventDefault();
    if (!adminId || !canManage) return;
    const reasonError = checkReason(createReason);
    if (reasonError) {
      toast.error(reasonError);
      return;
    }
    const key = newPack.key.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,60}$/.test(key)) {
      toast.error('المفتاح: أحرف إنجليزية صغيرة وأرقام و_ بين 3 و60');
      return;
    }
    const name = newPack.name.trim();
    if (name.length < 2 || name.length > 80) {
      toast.error('اسم الحزمة يجب أن يكون بين 2 و80 حرفاً');
      return;
    }
    if (!isAssetUrl(newPack.cover_url.trim())) {
      toast.error('رابط الغلاف يجب أن يبدأ بـ /stickers/ أو https://');
      return;
    }
    setCreating(true);
    try {
      const { error } = await supabase.rpc('admin_upsert_sticker_pack', {
        p_admin_id: adminId,
        p_pack_id: null,
        p_payload: {
          key,
          name,
          name_ar: newPack.name_ar.trim() || null,
          icon_emoji: newPack.icon_emoji.trim() || '🙂',
          cover_url: newPack.cover_url.trim() || null,
          sort_order: Number(newPack.sort_order) || 0,
          is_premium: newPack.is_premium,
          is_active: newPack.is_active,
        },
        p_reason: createReason.trim(),
      });
      if (error) throw error;
      toast.success('أُضيفت الحزمة');
      setNewPack(emptyPackDraft);
      setCreateReason('');
      await load();
    } catch (caught: unknown) {
      toast.error(caught instanceof Error ? caught.message : 'تعذر إنشاء الحزمة');
    } finally {
      setCreating(false);
    }
  };

  const savePack = async (pack: PackRow) => {
    if (!adminId || !canManage) return;
    const draft = packDrafts[pack.id];
    if (!draft) return;
    const reasonError = checkReason(reasons[pack.id] ?? '');
    if (reasonError) {
      toast.error(reasonError);
      return;
    }
    const key = draft.key.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,60}$/.test(key)) {
      toast.error('المفتاح: أحرف إنجليزية صغيرة وأرقام و_ بين 3 و60');
      return;
    }
    const name = draft.name.trim();
    if (name.length < 2 || name.length > 80) {
      toast.error('اسم الحزمة يجب أن يكون بين 2 و80 حرفاً');
      return;
    }
    if (!isAssetUrl(draft.cover_url.trim())) {
      toast.error('رابط الغلاف يجب أن يبدأ بـ /stickers/ أو https://');
      return;
    }
    setSavingId(pack.id);
    try {
      const { error } = await supabase.rpc('admin_upsert_sticker_pack', {
        p_admin_id: adminId,
        p_pack_id: pack.id,
        p_payload: {
          key,
          name,
          name_ar: draft.name_ar.trim() || null,
          icon_emoji: draft.icon_emoji.trim() || '🙂',
          cover_url: draft.cover_url.trim() || null,
          sort_order: Number(draft.sort_order) || 0,
          is_premium: draft.is_premium,
          is_active: draft.is_active,
        },
        p_reason: (reasons[pack.id] ?? '').trim(),
      });
      if (error) throw error;
      toast.success('حُفظت الحزمة');
      setReasons((prev) => ({ ...prev, [pack.id]: '' }));
      await load();
    } catch (caught: unknown) {
      toast.error(caught instanceof Error ? caught.message : 'تعذر حفظ الحزمة');
    } finally {
      setSavingId(null);
    }
  };

  const archivePack = async (pack: PackRow) => {
    if (!adminId || !canManage) return;
    const reasonError = checkReason(reasons[pack.id] ?? '');
    if (reasonError) {
      toast.error(reasonError);
      return;
    }
    const draft = packDrafts[pack.id] ?? toPackDraft(pack);
    setSavingId(pack.id);
    try {
      const { error } = await supabase.rpc('admin_upsert_sticker_pack', {
        p_admin_id: adminId,
        p_pack_id: pack.id,
        p_payload: {
          key: draft.key,
          name: draft.name,
          name_ar: draft.name_ar.trim() || null,
          icon_emoji: draft.icon_emoji.trim() || '🙂',
          cover_url: draft.cover_url.trim() || null,
          sort_order: Number(draft.sort_order) || 0,
          is_premium: draft.is_premium,
          is_active: false,
        },
        p_reason: (reasons[pack.id] ?? '').trim(),
      });
      if (error) throw error;
      toast.success('أُخرجت الحزمة من العرض (السجلات محفوظة)');
      setReasons((prev) => ({ ...prev, [pack.id]: '' }));
      await load();
    } catch (caught: unknown) {
      toast.error(caught instanceof Error ? caught.message : 'تعذر أرشفة الحزمة');
    } finally {
      setSavingId(null);
    }
  };

  const saveSticker = async (sticker: StickerRow) => {
    if (!adminId || !canManage) return;
    const draft = stickerDrafts[sticker.id];
    if (!draft) return;
    const reasonError = checkReason(reasons[sticker.id] ?? '');
    if (reasonError) {
      toast.error(reasonError);
      return;
    }
    const code = draft.code.trim().toLowerCase();
    if (!/^[a-z0-9_]{2,60}$/.test(code)) {
      toast.error('الرمز: أحرف إنجليزية صغيرة وأرقام و_ بين 2 و60');
      return;
    }
    if (!draft.emoji.trim() && !draft.image_url.trim() && !draft.animation_url.trim()) {
      toast.error('أدخل رمزاً أو صورة أو حركة للملصق');
      return;
    }
    if (!isAssetUrl(draft.image_url.trim()) || !isAssetUrl(draft.animation_url.trim())) {
      toast.error('روابط الملصق يجب أن تبدأ بـ /stickers/ أو https://');
      return;
    }
    setSavingId(sticker.id);
    try {
      const { error } = await supabase.rpc('admin_upsert_sticker', {
        p_admin_id: adminId,
        p_sticker_id: sticker.id,
        p_payload: {
          pack_id: sticker.pack_id,
          code,
          emoji: draft.emoji.trim() || null,
          image_url: draft.image_url.trim() || null,
          animation_url: draft.animation_url.trim() || null,
          sort_order: Number(draft.sort_order) || 0,
          is_active: draft.is_active,
        },
        p_reason: (reasons[sticker.id] ?? '').trim(),
      });
      if (error) throw error;
      toast.success('حُفظ الملصق');
      setReasons((prev) => ({ ...prev, [sticker.id]: '' }));
      await load();
    } catch (caught: unknown) {
      toast.error(caught instanceof Error ? caught.message : 'تعذر حفظ الملصق');
    } finally {
      setSavingId(null);
    }
  };

  const addSticker = async (event: FormEvent, packId: string) => {
    event.preventDefault();
    if (!adminId || !canManage) return;
    const reasonError = checkReason(reasons[`new:${packId}`] ?? '');
    if (reasonError) {
      toast.error(reasonError);
      return;
    }
    const code = newSticker.code.trim().toLowerCase();
    if (!/^[a-z0-9_]{2,60}$/.test(code)) {
      toast.error('الرمز: أحرف إنجليزية صغيرة وأرقام و_ بين 2 و60');
      return;
    }
    if (!newSticker.emoji.trim() && !newSticker.image_url.trim() && !newSticker.animation_url.trim()) {
      toast.error('أدخل رمزاً أو صورة أو حركة للملصق');
      return;
    }
    if (!isAssetUrl(newSticker.image_url.trim()) || !isAssetUrl(newSticker.animation_url.trim())) {
      toast.error('روابط الملصق يجب أن تبدأ بـ /stickers/ أو https://');
      return;
    }
    setAddingTo(packId);
    try {
      const { error } = await supabase.rpc('admin_upsert_sticker', {
        p_admin_id: adminId,
        p_sticker_id: null,
        p_payload: {
          pack_id: packId,
          code,
          emoji: newSticker.emoji.trim() || null,
          image_url: newSticker.image_url.trim() || null,
          animation_url: newSticker.animation_url.trim() || null,
          sort_order: Number(newSticker.sort_order) || 0,
          is_active: newSticker.is_active,
        },
        p_reason: (reasons[`new:${packId}`] ?? '').trim(),
      });
      if (error) throw error;
      toast.success('أُضيف الملصق');
      setNewSticker(emptyStickerDraft);
      setReasons((prev) => ({ ...prev, [`new:${packId}`]: '' }));
      await load();
    } catch (caught: unknown) {
      toast.error(caught instanceof Error ? caught.message : 'تعذر إضافة الملصق');
    } finally {
      setAddingTo(null);
    }
  };

  if (!canAccess(profile, 'stickers.view')) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-300" dir="rtl">
        لا تملك صلاحية عرض الملصقات.
      </div>
    );
  }

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">حزم الملصقات</h1>
          <p className="mt-1 text-sm text-gray-400">
            إضافة وتعديل وتعطيل حزم الملصقات. لا يُحذف أي سجل — التعطيل يخرج الحزمة أو الملصق من العرض فقط.
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="flex items-center gap-2 rounded-lg border border-wattar-900 px-3 py-2 text-sm text-gray-300"
        >
          <RefreshCw size={16} /> تحديث
        </button>
      </div>

      {!canManage ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
          صلاحيتك للعرض فقط. تحتاج stickers.manage للتعديل.
        </div>
      ) : null}

      {canManage ? (
        <form onSubmit={createPack} className="space-y-4 rounded-xl border border-wattar-900 bg-dark-surface p-5">
          <h2 className="text-lg font-semibold text-white">إضافة حزمة</h2>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            <Input label="المفتاح (a-z0-9_)" value={newPack.key} onChange={(value) => setNewPack({ ...newPack, key: value })} />
            <Input label="الاسم" value={newPack.name} onChange={(value) => setNewPack({ ...newPack, name: value })} />
            <Input label="الاسم بالعربية" value={newPack.name_ar} onChange={(value) => setNewPack({ ...newPack, name_ar: value })} />
            <Input label="الأيقونة (إيموجي)" value={newPack.icon_emoji} onChange={(value) => setNewPack({ ...newPack, icon_emoji: value })} />
            <Input label="رابط الغلاف (اختياري)" value={newPack.cover_url} onChange={(value) => setNewPack({ ...newPack, cover_url: value })} />
            <Input label="الترتيب" type="number" value={newPack.sort_order} onChange={(value) => setNewPack({ ...newPack, sort_order: value })} />
            <Toggle label="حزمة مميزة" checked={newPack.is_premium} onChange={(checked) => setNewPack({ ...newPack, is_premium: checked })} />
            <Toggle label="ظاهرة في التطبيق" checked={newPack.is_active} onChange={(checked) => setNewPack({ ...newPack, is_active: checked })} />
            <Input label="سبب الإضافة (10–500)" value={createReason} onChange={setCreateReason} />
          </div>
          <button disabled={creating} className="flex items-center gap-2 rounded-lg bg-wattar-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {creating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
            إضافة الحزمة
          </button>
        </form>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-1 items-center gap-2 rounded-lg border border-wattar-900 bg-dark-surface px-3 py-2">
          <Search size={16} className="text-gray-500" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="ابحث بالمفتاح أو الاسم أو رمز الملصق"
            className="w-full bg-transparent text-sm text-white outline-none"
          />
        </div>
        <p className="text-sm text-gray-400">
          {packs.length} حزمة · {packs.reduce((sum, pack) => sum + pack.stickers_count, 0)} ملصق
        </p>
      </div>

      {loading ? (
        <p className="text-gray-400">جاري التحميل...</p>
      ) : loadError ? (
        <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-300">
          {loadError}
          <button onClick={() => void load()} className="mt-3 rounded-lg bg-red-500/20 px-4 py-2 text-sm">إعادة المحاولة</button>
        </div>
      ) : (
        <div className="grid gap-4">
          {visiblePacks.map((pack) => {
            const draft = packDrafts[pack.id] ?? toPackDraft(pack);
            return (
              <section key={pack.id} className="space-y-4 rounded-xl border border-wattar-900 bg-dark-surface p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{draft.icon_emoji || '🙂'}</span>
                    <div>
                      <h2 className="font-semibold text-white">{pack.name_ar || pack.name}</h2>
                      <p className="mt-1 text-xs text-gray-400">
                        {pack.key} · {pack.stickers_count} ملصق ({pack.active_stickers} نشط)
                        {pack.archived_at ? ' · مؤرشف' : ''}
                        {pack.is_premium ? ' · مميز' : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-full max-w-[180px]">
                      <Toggle
                        label={draft.is_active ? 'ظاهرة' : 'مخفية'}
                        checked={draft.is_active}
                        onChange={(checked) => updatePackDraft(pack.id, 'is_active', checked)}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => void archivePack(pack)}
                      disabled={savingId === pack.id || pack.archived_at !== null}
                      className="flex items-center gap-1.5 rounded-lg border border-red-500/40 px-3 py-2 text-xs text-red-300 disabled:opacity-50"
                    >
                      {savingId === pack.id ? <Loader2 size={14} className="animate-spin" /> : <Archive size={14} />}
                      إخراج من العرض
                    </button>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                  <Input label="المفتاح" value={draft.key} onChange={(value) => updatePackDraft(pack.id, 'key', value)} />
                  <Input label="الاسم" value={draft.name} onChange={(value) => updatePackDraft(pack.id, 'name', value)} />
                  <Input label="الاسم بالعربية" value={draft.name_ar} onChange={(value) => updatePackDraft(pack.id, 'name_ar', value)} />
                  <Input label="الأيقونة" value={draft.icon_emoji} onChange={(value) => updatePackDraft(pack.id, 'icon_emoji', value)} />
                  <Input label="رابط الغلاف" value={draft.cover_url} onChange={(value) => updatePackDraft(pack.id, 'cover_url', value)} />
                  <Input label="الترتيب" type="number" value={draft.sort_order} onChange={(value) => updatePackDraft(pack.id, 'sort_order', value)} />
                  <Toggle label="حزمة مميزة" checked={draft.is_premium} onChange={(checked) => updatePackDraft(pack.id, 'is_premium', checked)} />
                  <Input
                    label="سبب الحفظ (10–500)"
                    value={reasons[pack.id] ?? ''}
                    onChange={(value) => setReason(pack.id, value)}
                  />
                  <div className="flex items-end">
                    <button
                      onClick={() => void savePack(pack)}
                      disabled={savingId === pack.id}
                      className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-wattar-600 px-4 text-sm font-medium text-white disabled:opacity-50"
                    >
                      {savingId === pack.id ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                      حفظ الحزمة
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-white">الملصقات</h3>
                  <div className="grid gap-3 md:grid-cols-2">
                    {pack.stickers.map((sticker) => {
                      const stickerDraft = stickerDrafts[sticker.id] ?? toStickerDraft(sticker);
                      return (
                        <div key={sticker.id} className="space-y-2 rounded-lg border border-wattar-900 bg-dark-elevated p-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xl">{stickerDraft.emoji || '🙂'}</span>
                            <span className="text-xs text-gray-400">{sticker.code}</span>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <Input label="الرمز" value={stickerDraft.code} onChange={(value) => updateStickerDraft(sticker.id, 'code', value)} />
                            <Input label="إيموجي" value={stickerDraft.emoji} onChange={(value) => updateStickerDraft(sticker.id, 'emoji', value)} />
                            <Input label="رابط صورة" value={stickerDraft.image_url} onChange={(value) => updateStickerDraft(sticker.id, 'image_url', value)} />
                            <Input label="رابط حركة" value={stickerDraft.animation_url} onChange={(value) => updateStickerDraft(sticker.id, 'animation_url', value)} />
                            <Input label="الترتيب" type="number" value={stickerDraft.sort_order} onChange={(value) => updateStickerDraft(sticker.id, 'sort_order', value)} />
                            <Toggle
                              label={stickerDraft.is_active ? 'نشط' : 'معطّل'}
                              checked={stickerDraft.is_active}
                              onChange={(checked) => updateStickerDraft(sticker.id, 'is_active', checked)}
                            />
                          </div>
                          <Input
                            label="سبب الحفظ (10–500)"
                            value={reasons[sticker.id] ?? ''}
                            onChange={(value) => setReason(sticker.id, value)}
                          />
                          <button
                            onClick={() => void saveSticker(sticker)}
                            disabled={savingId === sticker.id}
                            className="flex w-full items-center justify-center gap-2 rounded-lg bg-wattar-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
                          >
                            {savingId === sticker.id ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                            حفظ الملصق
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  {canManage ? (
                    <form
                      onSubmit={(event) => void addSticker(event, pack.id)}
                      className="space-y-2 rounded-lg border border-wattar-900 bg-dark-elevated p-3"
                    >
                      <h4 className="text-xs font-semibold text-white">إضافة ملصق</h4>
                      <div className="grid gap-2 md:grid-cols-3">
                        <Input label="الرمز" value={newSticker.code} onChange={(value) => setNewSticker({ ...newSticker, code: value })} />
                        <Input label="إيموجي" value={newSticker.emoji} onChange={(value) => setNewSticker({ ...newSticker, emoji: value })} />
                        <Input label="الترتيب" type="number" value={newSticker.sort_order} onChange={(value) => setNewSticker({ ...newSticker, sort_order: value })} />
                        <Input label="رابط صورة" value={newSticker.image_url} onChange={(value) => setNewSticker({ ...newSticker, image_url: value })} />
                        <Input label="رابط حركة" value={newSticker.animation_url} onChange={(value) => setNewSticker({ ...newSticker, animation_url: value })} />
                        <Input
                          label="سبب الإضافة (10–500)"
                          value={reasons[`new:${pack.id}`] ?? ''}
                          onChange={(value) => setReason(`new:${pack.id}`, value)}
                        />
                      </div>
                      <button
                        disabled={addingTo === pack.id}
                        className="flex items-center gap-2 rounded-lg bg-wattar-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
                      >
                        {addingTo === pack.id ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                        إضافة الملصق
                      </button>
                    </form>
                  ) : null}
                </div>
              </section>
            );
          })}
          {visiblePacks.length === 0 ? <p className="text-gray-400">لا توجد حزم مطابقة.</p> : null}
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
