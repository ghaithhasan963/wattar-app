import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Ban,
  Gavel,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase, callFunction } from '@/lib/supabase';
import { ReasonPickerModal } from '@/components/ReasonPicker';

type WordTab = 'words' | 'settings' | 'penalties' | 'appeals' | 'exceptions';

const revokePenaltyReasons = [
  'خطأ في تطبيق العقوبة',
  'انتهاء مدة العقوبة فعليًا',
  'قرار إداري بعد المراجعة',
  'الاعتراض مقبول والأدلة غير كافية',
];

const approveAppealNotes = [
  'بدون ملاحظة',
  'ثبت أن العقوبة غير مستحقة',
  'الأدلة غير كافية لثبوت المخالفة',
  'مراجعة إدارية أعلى',
];

const rejectAppealReasons = [
  'المخالفة ثابتة بالسجلات',
  'الاعتراض لا يحتوي معلومات جديدة',
  'تكرار الاعتراض دون مبرر',
  'العقوبة مطابقة لقواعد المجتمع',
];

interface ModerationWord {
  id: string;
  list_type: 'forbidden' | 'allowed';
  word: string;
  severity: 'low' | 'medium' | 'high';
  room_id: string | null;
  is_active: boolean;
  created_at: string;
}

interface ModerationSettings {
  filter_enabled: boolean;
  warnings_before_mute: number;
  mute_default_minutes: number;
  violations_before_temp_ban: number;
  temp_ban_default_hours: number;
  violations_before_permanent_ban: number;
  violation_counting_window_days: number;
}

interface PenaltyRow {
  id: string;
  user_id: string;
  user: { username: string; display_name: string | null } | null;
  penalty_type: 'warning' | 'mute' | 'kick' | 'temp_ban' | 'permanent_ban';
  reason: string;
  starts_at: string;
  ends_at: string | null;
  revoked_at: string | null;
}

interface AppealRow {
  id: string;
  user_id: string;
  user: { username: string; display_name: string | null } | null;
  penalty_id: string | null;
  statement: string;
  status: 'pending' | 'approved' | 'rejected';
  review_note: string | null;
  created_at: string;
}

interface ExceptionRow {
  id: string;
  subject_user_id: string | null;
  subject_room_id: string | null;
  reason: string;
  revoked_at: string | null;
  created_at: string;
}

const PENALTY_LABELS: Record<PenaltyRow['penalty_type'], string> = {
  warning: 'تحذير',
  mute: 'كتم',
  kick: 'طرد',
  temp_ban: 'حظر مؤقت',
  permanent_ban: 'حظر دائم',
};

const APPEAL_STATUS_LABELS: Record<AppealRow['status'], string> = {
  pending: 'قيد المراجعة',
  approved: 'مقبول',
  rejected: 'مرفوض',
};

const SEVERITY_LABELS: Record<ModerationWord['severity'], string> = {
  low: 'منخفضة',
  medium: 'متوسطة',
  high: 'عالية',
};

const inputClass =
  'w-full rounded-xl border border-white/10 bg-dark-elevated px-3 py-2.5 text-sm text-white placeholder:text-gray-500 focus:border-wattar-500 focus:outline-none';

function displayUser(user: { username: string; display_name: string | null } | null) {
  return user?.display_name || (user?.username ? `@${user.username}` : 'مستخدم');
}

export function ModerationPage() {
  const [tab, setTab] = useState<WordTab>('words');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [words, setWords] = useState<ModerationWord[]>([]);
  const [settings, setSettings] = useState<ModerationSettings | null>(null);
  const [penalties, setPenalties] = useState<PenaltyRow[]>([]);
  const [appeals, setAppeals] = useState<AppealRow[]>([]);
  const [exceptions, setExceptions] = useState<ExceptionRow[]>([]);

  const [newWord, setNewWord] = useState('');
  const [newWordList, setNewWordList] = useState<'forbidden' | 'allowed'>('forbidden');
  const [newWordSeverity, setNewWordSeverity] = useState<ModerationWord['severity']>('medium');
  const [exceptionUser, setExceptionUser] = useState('');
  const [exceptionReason, setExceptionReason] = useState('');
  const [penaltyPicker, setPenaltyPicker] = useState<PenaltyRow | null>(null);
  const [appealPicker, setAppealPicker] = useState<{ appeal: AppealRow; decision: 'approved' | 'rejected' } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const results = await Promise.all([
        supabase.from('moderation_words').select('*').order('list_type').order('word').limit(500),
        supabase.from('moderation_settings').select('*').eq('id', true).single(),
        supabase
          .from('user_penalties')
          .select(`id, user_id, user:users!user_penalties_user_id_fkey(username, display_name), penalty_type, reason, starts_at, ends_at, revoked_at`)
          .order('starts_at', { ascending: false })
          .limit(100),
        supabase
          .from('moderation_appeals')
          .select(`id, user_id, user:users!moderation_appeals_user_id_fkey(username, display_name), penalty_id, statement, status, review_note, created_at`)
          .order('created_at', { ascending: false })
          .limit(100),
        supabase.from('moderation_exceptions').select('*').order('created_at', { ascending: false }).limit(100),
      ]);
      const errors = results.find((result) => result.error);
      if (errors?.error) throw errors.error;
      setWords(((results[0].data ?? []) as ModerationWord[]).map((w) => ({ ...w })));
      setSettings(results[1].data as ModerationSettings);
      setPenalties(((results[2].data ?? []) as Array<PenaltyRow & { user: PenaltyRow['user'] | PenaltyRow['user'][] }>).map((p) => ({ ...p, user: Array.isArray(p.user) ? p.user[0] ?? null : p.user })));
      setAppeals(((results[3].data ?? []) as Array<AppealRow & { user: AppealRow['user'] | AppealRow['user'][] }>).map((a) => ({ ...a, user: Array.isArray(a.user) ? a.user[0] ?? null : a.user })));
      setExceptions((results[4].data ?? []) as ExceptionRow[]);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'تعذر تحميل البيانات.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = useCallback(
    async (action: string, payload: Record<string, unknown>, successMessage: string) => {
      setBusy(true);
      try {
        await callFunction('admin-moderation', { action, ...payload });
        toast.success(successMessage);
        await load();
      } catch (caught: unknown) {
        toast.error(caught instanceof Error ? caught.message : 'فشل الإجراء');
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const pendingAppeals = useMemo(() => appeals.filter((appeal) => appeal.status === 'pending'), [appeals]);
  const activePenalties = useMemo(
    () => penalties.filter((penalty) => !penalty.revoked_at && (!penalty.ends_at || new Date(penalty.ends_at) > new Date())),
    [penalties],
  );

  const tabs: Array<{ key: WordTab; label: string }> = [
    { key: 'words', label: `الكلمات (${words.length})` },
    { key: 'settings', label: 'الإعدادات' },
    { key: 'penalties', label: `العقوبات (${activePenalties.length})` },
    { key: 'appeals', label: `الاعتراضات (${pendingAppeals.length})` },
    { key: 'exceptions', label: 'الاستثناءات' },
  ];

  const updateSettingsField = (key: keyof ModerationSettings, value: number | boolean) => {
    setSettings((current) => (current ? { ...current, [key]: value } : current));
  };

  const saveSettings = () => {
    if (!settings) return;
    void run(
      'update_settings',
      {
        settings: {
          filter_enabled: settings.filter_enabled,
          warnings_before_mute: settings.warnings_before_mute,
          mute_default_minutes: settings.mute_default_minutes,
          violations_before_temp_ban: settings.violations_before_temp_ban,
          temp_ban_default_hours: settings.temp_ban_default_hours,
          violations_before_permanent_ban: settings.violations_before_permanent_ban,
          violation_counting_window_days: settings.violation_counting_window_days,
        },
      },
      'حُفظت إعدادات الإشراف',
    );
  };

  const numericSettings: Array<{ key: keyof ModerationSettings & string; label: string; min: number; max: number }> = [
    { key: 'warnings_before_mute', label: 'المخالفات قبل الكتم التلقائي', min: 1, max: 50 },
    { key: 'mute_default_minutes', label: 'مدة الكتم الافتراضية (دقيقة)', min: 1, max: 43200 },
    { key: 'violations_before_temp_ban', label: 'المخالفات قبل الحظر المؤقت', min: 2, max: 100 },
    { key: 'temp_ban_default_hours', label: 'مدة الحظر المؤقت الافتراضية (ساعة)', min: 1, max: 720 },
    { key: 'violations_before_permanent_ban', label: 'المخالفات قبل الحظر الدائم', min: 3, max: 200 },
    { key: 'violation_counting_window_days', label: 'نافذة عدّ المخالفات (يوم)', min: 1, max: 365 },
  ];

  return (
    <div className="space-y-6" dir="rtl">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="rounded-xl bg-wattar-500/10 p-3 text-wattar-300"><Gavel size={22} /></span>
          <div>
            <h1 className="text-2xl font-bold text-white">الإشراف والفلترة</h1>
            <p className="mt-1 text-sm text-gray-400">قوائم الكلمات وعتبات العقوبات والاعتراضات — القسم 22</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-dark-surface px-4 py-2.5 text-sm text-gray-200 transition hover:bg-dark-elevated disabled:opacity-50"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          تحديث
        </button>
      </header>

      {error && (
        <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
              tab === item.key
                ? 'bg-wattar-500/20 text-wattar-200 border border-wattar-500/40'
                : 'border border-white/10 bg-dark-surface text-gray-300 hover:bg-dark-elevated'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'words' && (
        <section className="space-y-4">
          <div className="rounded-2xl border border-white/[0.07] bg-dark-surface p-4">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-white">
              <Plus size={15} /> إضافة كلمة
            </h2>
            <div className="flex flex-wrap gap-2">
              <input
                value={newWord}
                onChange={(event) => setNewWord(event.target.value)}
                placeholder="الكلمة..."
                className={`${inputClass} max-w-xs`}
              />
              <select
                value={newWordList}
                onChange={(event) => setNewWordList(event.target.value as 'forbidden' | 'allowed')}
                className={`${inputClass} max-w-[10rem]`}
              >
                <option value="forbidden">قائمة الممنوعة</option>
                <option value="allowed">قائمة المسموحة</option>
              </select>
              <select
                value={newWordSeverity}
                onChange={(event) => setNewWordSeverity(event.target.value as ModerationWord['severity'])}
                disabled={newWordList === 'allowed'}
                className={`${inputClass} max-w-[10rem] disabled:opacity-40`}
              >
                <option value="low">خطورة منخفضة</option>
                <option value="medium">خطورة متوسطة</option>
                <option value="high">خطورة عالية</option>
              </select>
              <button
                type="button"
                disabled={busy || !newWord.trim()}
                onClick={() => {
                  void run(
                    'upsert_word',
                    { list_type: newWordList, word: newWord.trim(), severity: newWordSeverity },
                    'أُضيفت الكلمة',
                  );
                  setNewWord('');
                }}
                className="rounded-xl bg-wattar-500 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-wattar-600 disabled:opacity-50"
              >
                إضافة
              </button>
            </div>
            <p className="mt-3 text-xs leading-5 text-gray-500">
              الكلمات الممنوعة تُطابق رسائل الغرف والرسائل الخاصة بعد تطبيع النص (تشكيل/تطويل/تكرار/رموز).
              الكلمات المسموحة تُحذف من النص قبل الفحص فتمنع الالتباس.
            </p>
          </div>

          <div className="overflow-hidden rounded-2xl border border-white/[0.07] bg-dark-surface">
            {words.length === 0 && !loading ? (
              <p className="p-10 text-center text-sm text-gray-400">لا توجد كلمات بعد.</p>
            ) : (
              <div className="divide-y divide-white/[0.06]">
                {words.map((word) => (
                  <div key={word.id} className="flex flex-wrap items-center gap-3 p-4">
                    <span
                      className={`rounded-lg px-2 py-1 text-[11px] font-bold ${
                        word.list_type === 'forbidden' ? 'bg-rose-400/10 text-rose-300' : 'bg-emerald-400/10 text-emerald-300'
                      }`}
                    >
                      {word.list_type === 'forbidden' ? `ممنوعة · ${SEVERITY_LABELS[word.severity]}` : 'مسموحة'}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-gray-100">{word.word}</span>
                    {word.room_id && <span className="text-[11px] text-gray-500">خاصة بغرفة</span>}
                    {!word.is_active && <span className="text-[11px] text-gray-500">معطّلة</span>}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        void run(
                          'upsert_word',
                          { list_type: word.list_type, word: word.word, severity: word.severity, room_id: word.room_id, is_active: !word.is_active },
                          word.is_active ? 'عُطّلت الكلمة' : 'فُعّلت الكلمة',
                        );
                      }}
                      className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-gray-300 transition hover:bg-dark-elevated disabled:opacity-50"
                    >
                      {word.is_active ? 'تعطيل' : 'تفعيل'}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void run('delete_word', { word_id: word.id }, 'حُذفت الكلمة')}
                      className="rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-red-300 transition hover:bg-red-500/20 disabled:opacity-50"
                      aria-label="حذف"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {tab === 'settings' && settings && (
        <section className="rounded-2xl border border-white/[0.07] bg-dark-surface p-5">
          <label className="mb-5 flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-dark-elevated p-4">
            <span className="text-sm font-medium text-gray-200">تفعيل فلترة الكلمات</span>
            <input
              type="checkbox"
              checked={settings.filter_enabled}
              onChange={(event) => updateSettingsField('filter_enabled', event.target.checked)}
              className="h-5 w-5 accent-wattar-500"
            />
          </label>
          <div className="grid gap-4 md:grid-cols-2">
            {numericSettings.map((field) => (
              <label key={field.key} className="block">
                <span className="mb-1.5 block text-xs text-gray-400">{field.label}</span>
                <input
                  type="number"
                  min={field.min}
                  max={field.max}
                  value={settings[field.key] as number}
                  onChange={(event) => updateSettingsField(field.key, Number(event.target.value))}
                  className={inputClass}
                />
              </label>
            ))}
          </div>
          <button
            type="button"
            onClick={saveSettings}
            disabled={busy}
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-wattar-500 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-wattar-600 disabled:opacity-50"
          >
            <Save size={15} /> حفظ الإعدادات
          </button>
        </section>
      )}

      {tab === 'penalties' && (
        <section className="overflow-hidden rounded-2xl border border-white/[0.07] bg-dark-surface">
          {penalties.length === 0 && !loading ? (
            <p className="p-10 text-center text-sm text-gray-400">لا توجد عقوبات مسجّلة.</p>
          ) : (
            <div className="divide-y divide-white/[0.06]">
              {penalties.map((penalty) => {
                const active = !penalty.revoked_at && (!penalty.ends_at || new Date(penalty.ends_at) > new Date());
                return (
                  <div key={penalty.id} className="flex flex-wrap items-center gap-3 p-4">
                    <span
                      className={`rounded-lg px-2 py-1 text-[11px] font-bold ${
                        penalty.revoked_at
                          ? 'bg-gray-400/10 text-gray-400'
                          : penalty.penalty_type.includes('ban')
                            ? 'bg-red-500/15 text-red-300'
                            : 'bg-amber-400/10 text-amber-300'
                      }`}
                    >
                      {PENALTY_LABELS[penalty.penalty_type]}
                    </span>
                    <span className="text-sm text-gray-100">{displayUser(penalty.user)}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-gray-400">{penalty.reason}</span>
                    <span className="text-[11px] text-gray-500">
                      {penalty.ends_at ? `حتى ${new Date(penalty.ends_at).toLocaleString('ar', { dateStyle: 'short', timeStyle: 'short' })}` : '—'}
                    </span>
                    {active && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setPenaltyPicker(penalty)}
                        className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-gray-200 transition hover:bg-dark-elevated disabled:opacity-50"
                      >
                        رفع العقوبة
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {tab === 'appeals' && (
        <section className="overflow-hidden rounded-2xl border border-white/[0.07] bg-dark-surface">
          {appeals.length === 0 && !loading ? (
            <p className="p-10 text-center text-sm text-gray-400">لا توجد اعتراضات.</p>
          ) : (
            <div className="divide-y divide-white/[0.06]">
              {appeals.map((appeal) => (
                <div key={appeal.id} className="space-y-2 p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <span
                      className={`rounded-lg px-2 py-1 text-[11px] font-bold ${
                        appeal.status === 'pending'
                          ? 'bg-amber-400/10 text-amber-300'
                          : appeal.status === 'approved'
                            ? 'bg-emerald-400/10 text-emerald-300'
                            : 'bg-red-500/15 text-red-300'
                      }`}
                    >
                      {APPEAL_STATUS_LABELS[appeal.status]}
                    </span>
                    <span className="text-sm text-gray-100">{displayUser(appeal.user)}</span>
                    <span className="text-[11px] text-gray-500">
                      {new Date(appeal.created_at).toLocaleString('ar', { dateStyle: 'short', timeStyle: 'short' })}
                    </span>
                    {appeal.status === 'pending' && (
                      <span className="flex-1" />
                    )}
                    {appeal.status === 'pending' && (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setAppealPicker({ appeal, decision: 'approved' })}
                          className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-50"
                        >
                          قبول ورفع العقوبة
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setAppealPicker({ appeal, decision: 'rejected' })}
                          className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-bold text-red-300 transition hover:bg-red-500/20 disabled:opacity-50"
                        >
                          رفض
                        </button>
                      </>
                    )}
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm leading-6 text-gray-300">{appeal.statement}</p>
                  {appeal.review_note && <p className="text-xs text-gray-500">ملاحظة المراجعة: {appeal.review_note}</p>}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === 'exceptions' && (
        <section className="space-y-4">
          <div className="rounded-2xl border border-white/[0.07] bg-dark-surface p-4">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-white">
              <ShieldCheck size={15} /> إضافة استثناء (إعفاء من الفلترة)
            </h2>
            <div className="flex flex-wrap gap-2">
              <input
                value={exceptionUser}
                onChange={(event) => setExceptionUser(event.target.value)}
                placeholder="معرّف المستخدم (UUID)"
                className={`${inputClass} max-w-sm`}
              />
              <input
                value={exceptionReason}
                onChange={(event) => setExceptionReason(event.target.value)}
                placeholder="السبب..."
                className={`${inputClass} max-w-sm`}
              />
              <button
                type="button"
                disabled={busy || !exceptionUser.trim() || !exceptionReason.trim()}
                onClick={() => {
                  void run(
                    'add_exception',
                    { subject_user_id: exceptionUser.trim(), reason: exceptionReason.trim() },
                    'أُضيف الاستثناء',
                  );
                  setExceptionUser('');
                  setExceptionReason('');
                }}
                className="rounded-xl bg-wattar-500 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-wattar-600 disabled:opacity-50"
              >
                إضافة
              </button>
            </div>
          </div>
          <div className="overflow-hidden rounded-2xl border border-white/[0.07] bg-dark-surface">
            {exceptions.length === 0 && !loading ? (
              <p className="p-10 text-center text-sm text-gray-400">لا توجد استثناءات.</p>
            ) : (
              <div className="divide-y divide-white/[0.06]">
                {exceptions.map((exception) => (
                  <div key={exception.id} className="flex flex-wrap items-center gap-3 p-4">
                    <Ban size={15} className="text-gray-500" />
                    <span className="text-xs text-gray-300">
                      {exception.subject_user_id ? `مستخدم: ${exception.subject_user_id}` : `غرفة: ${exception.subject_room_id}`}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs text-gray-400">{exception.reason}</span>
                    {exception.revoked_at ? (
                      <span className="text-[11px] text-gray-500">ملغى</span>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void run('revoke_exception', { exception_id: exception.id }, 'أُلغي الاستثناء')}
                        className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-300 transition hover:bg-red-500/20 disabled:opacity-50"
                      >
                        إلغاء
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {penaltyPicker && (
        <ReasonPickerModal
          title="رفع العقوبة"
          subtitle={`${displayUser(penaltyPicker.user)} · ${PENALTY_LABELS[penaltyPicker.penalty_type]}`}
          description="اختر سببًا جاهزًا لرفع العقوبة — سيُسجَّل السبب في سجل التدقيق ويُبلَّغ المستخدم."
          options={revokePenaltyReasons}
          confirmLabel="رفع العقوبة"
          tone="warning"
          showNote
          noteLabel="ملاحظة داخلية إضافية (اختياري)"
          processing={busy}
          onClose={() => {
            if (busy) return;
            setPenaltyPicker(null);
          }}
          onSubmit={(reason, note) => {
            const penalty = penaltyPicker;
            setPenaltyPicker(null);
            const fullReason = note ? `${reason} — ${note}` : reason;
            void run('revoke_penalty', { penalty_id: penalty.id, reason: fullReason }, 'رُفعت العقوبة');
          }}
        />
      )}

      {appealPicker && (
        <ReasonPickerModal
          title={appealPicker.decision === 'approved' ? 'قبول الاعتراض' : 'رفض الاعتراض'}
          subtitle={displayUser(appealPicker.appeal.user)}
          description={
            appealPicker.decision === 'approved'
              ? 'قبول الاعتراض يرفع العقوبة عن المستخدم. اختر ملاحظة جاهزة أو اتركها بدون ملاحظة.'
              : 'رفض الاعتراض يُبقي العقوبة كما هي. اختر سببًا جاهزًا ليُسجَّل في سجل الإدارة.'
          }
          options={appealPicker.decision === 'approved' ? approveAppealNotes : rejectAppealReasons}
          confirmLabel={appealPicker.decision === 'approved' ? 'قبول ورفع العقوبة' : 'تأكيد الرفض'}
          tone={appealPicker.decision === 'approved' ? 'info' : 'danger'}
          showNote
          noteLabel="ملاحظة إضافية (اختياري)"
          processing={busy}
          onClose={() => {
            if (busy) return;
            setAppealPicker(null);
          }}
          onSubmit={(reason, note) => {
            const picker = appealPicker;
            setAppealPicker(null);
            const base = reason === 'بدون ملاحظة' ? '' : reason;
            const finalNote = [base, note].filter(Boolean).join(' — ');
            void run(
              'review_appeal',
              {
                appeal_id: picker.appeal.id,
                decision: picker.decision,
                note: finalNote || undefined,
              },
              picker.decision === 'approved' ? 'قُبل الاعتراض ورُفعت العقوبة' : 'رُفض الاعتراض',
            );
          }}
        />
      )}
    </div>
  );
}
