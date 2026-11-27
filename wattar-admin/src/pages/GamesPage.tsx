/**
 * Wattar Admin — الألعاب (M9.4)
 * إدارة كاملة من قاعدة البيانات: تشغيل/إيقاف، احتمالات معلنة، حدود الرهان،
 * المضاعف الأقصى، العمر، الدول المسموحة/المحظورة، العروض، وضع المحاكاة،
 * الإعدادات المتقدمة، وإحصاءات 30 يوماً وسجل الجولات.
 *
 * كل الكتابة عبر RPCs محمية بصلاحية games.manage مع سبب إلزامي وتدقيق قبل/بعد.
 * لا يُعدَّل جدول game_configs مباشرة من المتصفح.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BarChart3,
  Coins,
  Gamepad2,
  Loader2,
  RefreshCw,
  Save,
  Sparkles,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { canAccess, useAuthStore } from '@/store/auth';
import { Toggle } from '@/components/ui';

interface GameStats {
  rounds: number;
  wagered: number;
  returned: number;
  players: number;
  actual_rtp: number | null;
}

interface GameConfigRow {
  id: string;
  game_type: string;
  display_name: string;
  description_ar: string | null;
  icon: string;
  accent_color: string;
  sort_order: number;
  is_enabled: boolean;
  default_rtp: number;
  declared_rtp: number;
  declared_odds: Record<string, unknown>;
  min_bet_gold: number;
  max_bet_gold: number;
  max_multiplier: number;
  min_age: number;
  requires_adult: boolean;
  allowed_countries: string[] | null;
  blocked_countries: string[];
  promo_multiplier: number;
  promo_label: string | null;
  promo_starts_at: string | null;
  promo_ends_at: string | null;
  test_mode_enabled: boolean;
  rules_ar: string | null;
  settings: Record<string, unknown>;
  archived_at: string | null;
  updated_at: string;
  stats: GameStats;
}

interface GameStatsRow {
  game_type: string;
  display_name: string;
  is_enabled: boolean;
  declared_rtp: number;
  rounds: number;
  wagered: number;
  returned: number;
  net_house: number;
  actual_rtp: number | null;
  unique_players: number;
  test_rounds: number;
}

interface GameRoundRow {
  bet_id: string;
  game_type: string;
  user_id: string;
  username: string | null;
  bet_amount: number;
  payout: number;
  net: number;
  multiplier: number;
  is_win: boolean;
  is_test: boolean;
  forced_outcome: string | null;
  created_at: string;
}

interface GameDraft {
  display_name: string;
  description_ar: string;
  icon: string;
  accent_color: string;
  sort_order: string;
  is_enabled: boolean;
  default_rtp: string;
  min_bet_gold: string;
  max_bet_gold: string;
  max_multiplier: string;
  min_age: string;
  requires_adult: boolean;
  allowed_countries: string;
  blocked_countries: string;
  promo_multiplier: string;
  promo_label: string;
  promo_starts_at: string;
  promo_ends_at: string;
  test_mode_enabled: boolean;
  rules_ar: string;
  settings_text: string;
}

const gameIcons: Record<string, typeof Gamepad2> = {
  wheel: Sparkles,
  dice: Gamepad2,
  aviator: Activity,
  plinko: BarChart3,
  slots: Coins,
};

function checkReason(reason: string): string | null {
  const value = reason.trim();
  if (value.length < 10) return 'أدخل سبباً لا يقل عن 10 أحرف';
  if (value.length > 500) return 'السبب لا يتجاوز 500 حرف';
  return null;
}

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  return Number(value).toLocaleString('ar', { maximumFractionDigits: 2 });
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('ar', { dateStyle: 'short', timeStyle: 'short' });
}

function toDateTimeLocal(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (input: number) => String(input).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromDateTimeLocal(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseCountryList(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

function toDraft(row: GameConfigRow): GameDraft {
  return {
    display_name: row.display_name,
    description_ar: row.description_ar ?? '',
    icon: row.icon,
    accent_color: row.accent_color,
    sort_order: String(row.sort_order ?? 0),
    is_enabled: row.is_enabled,
    default_rtp: String(row.default_rtp),
    min_bet_gold: String(row.min_bet_gold),
    max_bet_gold: String(row.max_bet_gold),
    max_multiplier: String(row.max_multiplier),
    min_age: String(row.min_age),
    requires_adult: row.requires_adult,
    allowed_countries: (row.allowed_countries ?? []).join(', '),
    blocked_countries: (row.blocked_countries ?? []).join(', '),
    promo_multiplier: String(row.promo_multiplier ?? 1),
    promo_label: row.promo_label ?? '',
    promo_starts_at: toDateTimeLocal(row.promo_starts_at),
    promo_ends_at: toDateTimeLocal(row.promo_ends_at),
    test_mode_enabled: row.test_mode_enabled,
    rules_ar: row.rules_ar ?? '',
    settings_text: JSON.stringify(row.settings ?? {}, null, 2),
  };
}

export function GamesPage() {
  const profile = useAuthStore((state) => state.profile);
  const canManage = canAccess(profile, 'games.manage');
  const adminId = profile?.id ?? null;

  const [configs, setConfigs] = useState<GameConfigRow[]>([]);
  const [stats, setStats] = useState<GameStatsRow[]>([]);
  const [rounds, setRounds] = useState<GameRoundRow[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [drafts, setDrafts] = useState<Record<string, GameDraft>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loadingRounds, setLoadingRounds] = useState(false);

  const load = useCallback(async () => {
    if (!adminId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [configResult, statsResult] = await Promise.all([
        supabase.rpc('admin_list_game_configs'),
        supabase.rpc('admin_game_stats', { p_days: 30 }),
      ]);
      if (configResult.error) throw configResult.error;
      if (statsResult.error) throw statsResult.error;
      const configList = Array.isArray(configResult.data) ? (configResult.data as GameConfigRow[]) : [];
      setConfigs(configList);
      setStats(Array.isArray(statsResult.data) ? (statsResult.data as GameStatsRow[]) : []);
      setDrafts(Object.fromEntries(configList.map((row) => [row.game_type, toDraft(row)])));
      setSelected((current) => current || configList[0]?.game_type || '');
    } catch (caught: unknown) {
      setLoadError(caught instanceof Error ? caught.message : 'تعذر تحميل إعدادات الألعاب');
    } finally {
      setLoading(false);
    }
  }, [adminId]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadRounds = useCallback(async (gameType: string) => {
    if (!gameType) return;
    setLoadingRounds(true);
    try {
      const { data, error } = await supabase.rpc('admin_list_game_rounds', {
        p_game_type: gameType,
        p_user_id: null,
        p_limit: 25,
        p_offset: 0,
      });
      if (error) throw error;
      setRounds(Array.isArray(data) ? (data as GameRoundRow[]) : []);
    } catch (caught: unknown) {
      setRounds([]);
      toast.error(caught instanceof Error ? caught.message : 'تعذر تحميل سجل الجولات');
    } finally {
      setLoadingRounds(false);
    }
  }, []);

  useEffect(() => {
    void loadRounds(selected);
  }, [selected, loadRounds]);

  const activeConfig = useMemo(
    () => configs.find((row) => row.game_type === selected) ?? null,
    [configs, selected],
  );
  const activeStats = useMemo(
    () => stats.find((row) => row.game_type === selected) ?? null,
    [stats, selected],
  );
  const draft = selected ? drafts[selected] : undefined;

  const updateDraft = (patch: Partial<GameDraft>) => {
    if (!selected) return;
    setDrafts((prev) => ({ ...prev, [selected]: { ...prev[selected], ...patch } }));
  };

  const buildPayload = (source: GameDraft) => {
    let settings: unknown;
    try {
      settings = JSON.parse(source.settings_text || '{}');
    } catch {
      throw new Error('إعدادات JSON غير صالحة — تحقق من الصياغة');
    }
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      throw new Error('إعدادات JSON يجب أن تكون كائناً');
    }
    return {
      display_name: source.display_name.trim(),
      description_ar: source.description_ar.trim() || null,
      icon: source.icon.trim(),
      accent_color: source.accent_color.trim(),
      sort_order: Number(source.sort_order),
      is_enabled: source.is_enabled,
      default_rtp: Number(source.default_rtp),
      min_bet_gold: Number(source.min_bet_gold),
      max_bet_gold: Number(source.max_bet_gold),
      max_multiplier: Number(source.max_multiplier),
      min_age: Number(source.min_age),
      requires_adult: source.requires_adult,
      allowed_countries: source.allowed_countries.trim()
        ? parseCountryList(source.allowed_countries)
        : null,
      blocked_countries: parseCountryList(source.blocked_countries),
      promo_multiplier: Number(source.promo_multiplier),
      promo_label: source.promo_label.trim() || null,
      promo_starts_at: fromDateTimeLocal(source.promo_starts_at),
      promo_ends_at: fromDateTimeLocal(source.promo_ends_at),
      test_mode_enabled: source.test_mode_enabled,
      rules_ar: source.rules_ar.trim() || null,
      settings,
    };
  };

  const saveConfig = async () => {
    if (!adminId || !canManage || !selected || !draft) return;
    const reasonError = checkReason(reasons[selected] ?? '');
    if (reasonError) {
      toast.error(reasonError);
      return;
    }
    let payload: ReturnType<typeof buildPayload>;
    try {
      payload = buildPayload(draft);
    } catch (caught: unknown) {
      toast.error(caught instanceof Error ? caught.message : 'بيانات غير صالحة');
      return;
    }
    setBusy(selected);
    try {
      const { error } = await supabase.rpc('admin_upsert_game_config', {
        p_admin_id: adminId,
        p_game_type: selected,
        p_payload: payload,
        p_reason: (reasons[selected] ?? '').trim(),
      });
      if (error) throw error;
      toast.success('حُفظت إعدادات اللعبة');
      setReasons((prev) => ({ ...prev, [selected]: '' }));
      await load();
    } catch (caught: unknown) {
      toast.error(caught instanceof Error ? caught.message : 'تعذر حفظ الإعدادات');
    } finally {
      setBusy(null);
    }
  };

  const toggleEnabled = async (row: GameConfigRow, enabled: boolean) => {
    if (!adminId || !canManage) return;
    const reason = (reasons[row.game_type] ?? '').trim();
    const reasonError = checkReason(reason);
    if (reasonError) {
      toast.error(reasonError);
      return;
    }
    setBusy(row.game_type);
    try {
      const { error } = await supabase.rpc('admin_set_game_enabled', {
        p_admin_id: adminId,
        p_game_type: row.game_type,
        p_enabled: enabled,
        p_reason: reason,
      });
      if (error) throw error;
      toast.success(enabled ? 'فُعّلت اللعبة' : 'أُوقفت اللعبة');
      setReasons((prev) => ({ ...prev, [row.game_type]: '' }));
      await load();
    } catch (caught: unknown) {
      toast.error(caught instanceof Error ? caught.message : 'تعذر تغيير حالة اللعبة');
    } finally {
      setBusy(null);
    }
  };

  const savePromotion = async () => {
    if (!adminId || !canManage || !selected || !draft) return;
    const reasonError = checkReason(reasons[selected] ?? '');
    if (reasonError) {
      toast.error(reasonError);
      return;
    }
    setBusy(selected);
    try {
      const { error } = await supabase.rpc('admin_set_game_promotion', {
        p_admin_id: adminId,
        p_game_type: selected,
        p_multiplier: Number(draft.promo_multiplier) || 1,
        p_label: draft.promo_label.trim() || null,
        p_starts_at: fromDateTimeLocal(draft.promo_starts_at),
        p_ends_at: fromDateTimeLocal(draft.promo_ends_at),
        p_reason: (reasons[selected] ?? '').trim(),
      });
      if (error) throw error;
      toast.success('حُفظ العرض الترويجي');
      setReasons((prev) => ({ ...prev, [selected]: '' }));
      await load();
    } catch (caught: unknown) {
      toast.error(caught instanceof Error ? caught.message : 'تعذر حفظ العرض');
    } finally {
      setBusy(null);
    }
  };

  if (!canAccess(profile, 'games.view')) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-300" dir="rtl">
        لا تملك صلاحية عرض الألعاب.
      </div>
    );
  }

  if (loading) {
    return <p className="text-gray-400" dir="rtl">جاري التحميل...</p>;
  }

  if (loadError) {
    return (
      <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-300" dir="rtl">
        تعذر تحميل إعدادات الألعاب: {loadError}
        <button onClick={() => void load()} className="mt-3 block rounded-lg bg-red-500/20 px-4 py-2 text-sm">
          إعادة المحاولة
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">الألعاب</h1>
          <p className="mt-1 text-sm text-gray-400">
            كل النتائج تُحسب على الخادم. الاحتمالات وRTP معلنة ومحسوبة من الإعدادات،
            وأي تعديل يتطلب سبباً ويُدوَّن قبل/بعد.
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="flex items-center gap-2 rounded-lg border border-wattar-900 px-3 py-2 text-sm text-gray-300"
        >
          <RefreshCw size={16} /> تحديث
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="ألعاب نشطة" value={`${configs.filter((row) => row.is_enabled).length} / ${configs.length}`} icon={Gamepad2} />
        <StatCard label="جولات 30 يوماً" value={formatNumber(stats.reduce((sum, row) => sum + row.rounds, 0))} icon={Activity} />
        <StatCard label="مشاركات (Coin)" value={formatNumber(stats.reduce((sum, row) => sum + row.wagered, 0))} icon={Coins} />
        <StatCard label="لاعبون فريدون" value={formatNumber(stats.reduce((sum, row) => sum + row.unique_players, 0))} icon={Users} />
      </div>

      {!canManage ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
          صلاحيتك للعرض فقط. تحتاج games.manage للتعديل والتشغيل والإيقاف.
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {configs.map((row) => {
          const Icon = gameIcons[row.game_type] ?? Gamepad2;
          const isActive = row.game_type === selected;
          return (
            <button
              key={row.id}
              onClick={() => setSelected(row.game_type)}
              className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium ${
                isActive ? 'border-wattar-600 bg-wattar-600/20 text-white' : 'border-wattar-900 text-gray-300'
              }`}
            >
              <Icon size={16} />
              {row.display_name}
              {row.is_enabled ? null : <span className="text-xs text-red-300">(موقوفة)</span>}
            </button>
          );
        })}
      </div>

      {activeConfig && activeStats && draft ? (
        <>
          <section className="space-y-4 rounded-xl border border-wattar-900 bg-dark-surface p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-white">{activeConfig.display_name}</h2>
                <p className="mt-1 text-xs text-gray-500">
                  آخر تحديث: {formatDate(activeConfig.updated_at)}
                  {activeConfig.archived_at ? ' · مؤرشفة' : ''}
                </p>
              </div>
              <div className="w-full max-w-xs">
                <Toggle
                  label="حالة اللعبة"
                  description={activeConfig.is_enabled ? 'مفعّلة وتظهر للمستخدمين' : 'موقوفة ومخفية'}
                  checked={draft.is_enabled}
                  onChange={(checked) => {
                    updateDraft({ is_enabled: checked });
                    void toggleEnabled(activeConfig, checked);
                  }}
                  disabled={!canManage || busy === activeConfig.game_type}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="RTP المعلن" value={`${formatNumber(activeConfig.declared_rtp)}%`} />
              <Metric label="RTP الفعلي (30ي)" value={activeStats.actual_rtp === null ? '—' : `${formatNumber(activeStats.actual_rtp)}%`} />
              <Metric label="صافي المنصة" value={formatNumber(activeStats.net_house)} />
              <Metric label="جولات محاكاة" value={formatNumber(activeStats.test_rounds)} />
            </div>

            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              <Input label="الاسم الظاهر (2–40)" value={draft.display_name} onChange={(value) => updateDraft({ display_name: value })} />
              <Input label="الأيقونة" value={draft.icon} onChange={(value) => updateDraft({ icon: value })} />
              <Input label="اللون (#RRGGBB)" value={draft.accent_color} onChange={(value) => updateDraft({ accent_color: value })} />
              <Input label="الترتيب (0–1000)" type="number" value={draft.sort_order} onChange={(value) => updateDraft({ sort_order: value })} />
              <Input label="RTP (%)" type="number" value={draft.default_rtp} onChange={(value) => updateDraft({ default_rtp: value })} />
              <Input label="المضاعف الأقصى" type="number" value={draft.max_multiplier} onChange={(value) => updateDraft({ max_multiplier: value })} />
              <Input label="أقل رهان (Coin)" type="number" value={draft.min_bet_gold} onChange={(value) => updateDraft({ min_bet_gold: value })} />
              <Input label="أقصى رهان (Coin)" type="number" value={draft.max_bet_gold} onChange={(value) => updateDraft({ max_bet_gold: value })} />
              <Input label="العمر الأدنى (13–21)" type="number" value={draft.min_age} onChange={(value) => updateDraft({ min_age: value })} />
              <Input
                label="الدول المسموحة (ISO-2، فارغ = الكل)"
                value={draft.allowed_countries}
                onChange={(value) => updateDraft({ allowed_countries: value })}
              />
              <Input
                label="الدول المحظورة (ISO-2)"
                value={draft.blocked_countries}
                onChange={(value) => updateDraft({ blocked_countries: value })}
              />
              <Toggle
                label="تأكيد العمر إلزامي"
                checked={draft.requires_adult}
                onChange={(checked) => updateDraft({ requires_adult: checked })}
                disabled={!canManage}
              />
            </div>

            <label className="block text-xs text-gray-400">
              الوصف
              <textarea
                value={draft.description_ar}
                onChange={(event) => updateDraft({ description_ar: event.target.value })}
                rows={2}
                className="mt-1 w-full rounded-lg border border-wattar-900 bg-dark-elevated px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="block text-xs text-gray-400">
              القواعد المعلنة للمستخدم
              <textarea
                value={draft.rules_ar}
                onChange={(event) => updateDraft({ rules_ar: event.target.value })}
                rows={2}
                className="mt-1 w-full rounded-lg border border-wattar-900 bg-dark-elevated px-3 py-2 text-sm text-white"
              />
            </label>

            <div className="rounded-lg border border-wattar-900 bg-dark-elevated/40 p-3">
              <h3 className="mb-2 text-sm font-semibold text-white">الاحتمالات المعلنة (محسوبة)</h3>
              <DeclaredOdds gameType={activeConfig.game_type} odds={activeConfig.declared_odds} />
            </div>

            <details className="rounded-lg border border-wattar-900 bg-dark-elevated/40 p-3">
              <summary className="cursor-pointer text-sm font-semibold text-white">
                إعدادات متقدمة (JSON) — تُتحقق على الخادم
              </summary>
              <textarea
                value={draft.settings_text}
                onChange={(event) => updateDraft({ settings_text: event.target.value })}
                rows={12}
                spellCheck={false}
                className="mt-2 w-full rounded-lg border border-wattar-900 bg-dark px-3 py-2 font-mono text-xs text-white"
              />
            </details>

            {canManage ? (
              <div className="flex flex-wrap items-end gap-3">
                <Input
                  label="سبب الحفظ (10–500)"
                  value={reasons[selected] ?? ''}
                  onChange={(value) => setReasons((prev) => ({ ...prev, [selected]: value }))}
                />
                <button
                  type="button"
                  onClick={() => void saveConfig()}
                  disabled={busy === selected}
                  className="flex h-10 items-center gap-2 rounded-lg bg-wattar-600 px-4 text-sm font-medium text-white disabled:opacity-50"
                >
                  {busy === selected ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                  حفظ إعدادات اللعبة
                </button>
              </div>
            ) : null}
          </section>

          <section className="space-y-4 rounded-xl border border-wattar-900 bg-dark-surface p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-white">العرض الترويجي المعلن</h2>
              <span className="text-xs text-gray-500">يظهر للمستخدم داخل اللعبة، ولا يغيّر الاحتمالات الأساسية.</span>
            </div>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              <Input label="مضاعف العرض (1–10)" type="number" value={draft.promo_multiplier} onChange={(value) => updateDraft({ promo_multiplier: value })} />
              <Input label="عنوان العرض" value={draft.promo_label} onChange={(value) => updateDraft({ promo_label: value })} />
              <Input label="يبدأ" type="datetime-local" value={draft.promo_starts_at} onChange={(value) => updateDraft({ promo_starts_at: value })} />
              <Input label="ينتهي" type="datetime-local" value={draft.promo_ends_at} onChange={(value) => updateDraft({ promo_ends_at: value })} />
            </div>
            {canManage ? (
              <button
                type="button"
                onClick={() => void savePromotion()}
                disabled={busy === selected}
                className="flex items-center gap-2 rounded-lg border border-wattar-600 px-4 py-2 text-sm font-medium text-wattar-200 disabled:opacity-50"
              >
                {busy === selected ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                حفظ العرض
              </button>
            ) : null}
          </section>

          <section className="space-y-3 rounded-xl border border-wattar-900 bg-dark-surface p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-white">آخر الجولات</h2>
              <button
                onClick={() => void loadRounds(selected)}
                className="flex items-center gap-2 rounded-lg border border-wattar-900 px-3 py-1.5 text-xs text-gray-300"
              >
                <RefreshCw size={14} /> تحديث
              </button>
            </div>
            {loadingRounds ? (
              <p className="text-sm text-gray-400">جاري التحميل...</p>
            ) : rounds.length === 0 ? (
              <p className="text-sm text-gray-400">لا توجد جولات مسجّلة لهذه اللعبة.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-right text-sm">
                  <thead className="text-xs text-gray-400">
                    <tr>
                      <th className="py-2">الوقت</th>
                      <th>المستخدم</th>
                      <th>الرهان</th>
                      <th>العائد</th>
                      <th>المضاعف</th>
                      <th>النتيجة</th>
                      <th>النوع</th>
                    </tr>
                  </thead>
                  <tbody className="text-gray-200">
                    {rounds.map((round) => (
                      <tr key={round.bet_id} className="border-t border-wattar-900/60">
                        <td className="py-2 text-xs text-gray-400">{formatDate(round.created_at)}</td>
                        <td>{round.username ?? round.user_id.slice(0, 8)}</td>
                        <td>{formatNumber(round.bet_amount)}</td>
                        <td>{formatNumber(round.payout)}</td>
                        <td>{formatNumber(round.multiplier)}x</td>
                        <td className={round.is_win ? 'text-emerald-300' : 'text-red-300'}>
                          {round.is_win ? 'فوز' : 'خسارة'}
                        </td>
                        <td className="text-xs text-gray-400">
                          {round.is_test ? 'محاكاة' : 'حقيقية'}
                          {round.forced_outcome === 'win' ? ' · مكافأة معلنة' : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : (
        <p className="text-gray-400">لا توجد ألعاب مهيّأة.</p>
      )}
    </div>
  );
}

function DeclaredOdds({
  gameType,
  odds,
}: {
  gameType: string;
  odds: Record<string, unknown>;
}) {
  if (gameType === 'wheel') {
    const segments = Array.isArray(odds.segments) ? (odds.segments as Record<string, unknown>[]) : [];
    return (
      <div className="grid gap-1 text-xs text-gray-300 sm:grid-cols-2">
        {segments.map((segment) => (
          <p key={String(segment.index)}>
            {String(segment.label)} · احتمال {formatNumber(Number(segment.probability))}
            {' '}· عائد {formatNumber(Number(segment.segment_rtp))}%
          </p>
        ))}
      </div>
    );
  }

  if (gameType === 'plinko') {
    const risks = (odds.risks ?? {}) as Record<string, { rtp?: number }>;
    return (
      <div className="flex flex-wrap gap-4 text-xs text-gray-300">
        {Object.entries(risks).map(([risk, value]) => (
          <p key={risk}>{risk} · RTP {formatNumber(Number(value.rtp))}%</p>
        ))}
      </div>
    );
  }

  if (gameType === 'slots') {
    const tiers = Array.isArray(odds.tiers) ? (odds.tiers as Record<string, unknown>[]) : [];
    return (
      <div className="space-y-1 text-xs text-gray-300">
        {tiers.map((tier, index) => (
          <p key={index}>
            {String(tier.symbol)} × {formatNumber(Number(tier.multiplier))}
            {' '}· احتمال {formatNumber(Number(tier.probability))}
          </p>
        ))}
        <p>نسبة الإصابة {formatNumber(Number(odds.hit_rate))}</p>
      </div>
    );
  }

  return <p className="text-xs text-gray-300">{String(odds.formula ?? '—')}</p>;
}

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: typeof Gamepad2;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-wattar-900 bg-dark-surface p-4">
      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-wattar-600/15 text-wattar-300">
        <Icon size={18} />
      </span>
      <div>
        <p className="text-xs text-gray-400">{label}</p>
        <p className="text-lg font-semibold text-white">{value}</p>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-wattar-900 bg-dark-elevated/40 p-3">
      <p className="text-xs text-gray-400">{label}</p>
      <p className="mt-1 text-base font-semibold text-white">{value}</p>
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
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-lg border border-wattar-900 bg-dark-elevated px-3 py-2 text-sm text-white"
      />
    </label>
  );
}
