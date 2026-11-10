import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';

interface ActivityRow {
  id: number;
  event_type: string;
  actor_user_id: string | null;
  subject_user_id: string | null;
  resource_type: string | null;
  resource_id: string | null;
  source: string;
  ip_hash: string | null;
  identity_hash: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  actor: { username: string; display_name: string | null } | null;
  subject: { username: string; display_name: string | null } | null;
}

const eventLabels: Record<string, string> = {
  phone_otp_requested: 'طلب رمز هاتف',
  phone_otp_rate_limited: 'تجاوز حد رموز الهاتف',
  phone_otp_rejected: 'تعذر إرسال رمز الهاتف',
  email_signup_succeeded: 'إنشاء حساب بالبريد',
  email_signup_rate_limited: 'تجاوز حد التسجيل',
  email_signup_rejected: 'تعذر إنشاء حساب',
  session_started: 'بدء جلسة',
  account_created: 'إنشاء حساب',
  admin_action_recorded: 'إجراء إداري',
  room_created: 'إنشاء غرفة',
  room_closed: 'إغلاق غرفة',
  room_moderation_action: 'إجراء إشراف على غرفة',
  room_member_joined: 'دخول غرفة',
  room_member_left: 'مغادرة غرفة',
  room_message_sent: 'رسالة في غرفة',
  private_message_sent: 'رسالة خاصة',
  friend_request_sent: 'إرسال طلب صداقة',
  friend_request_accepted: 'قبول طلب صداقة',
  user_followed: 'متابعة مستخدم',
  gift_sent: 'إرسال هدية',
  wallet_transaction_recorded: 'حركة في المحفظة',
  game_played: 'لعب جولة',
  deposit_requested: 'طلب شحن',
  deposit_status_changed: 'تحديث طلب شحن',
  withdrawal_requested: 'طلب سحب',
  withdrawal_status_changed: 'تحديث طلب سحب',
  host_application_submitted: 'طلب مضيفة',
  host_application_reviewed: 'مراجعة طلب مضيفة',
  host_assigned: 'اعتماد مضيفة',
  host_status_changed: 'تغيير حالة مضيفة',
};

const sourceLabels: Record<string, string> = {
  auth: 'الحساب',
  account: 'الحساب',
  room: 'الغرف',
  social: 'المجتمع',
  wallet: 'المحفظة',
  host: 'المضيفات',
};

export function PlatformActivityPage() {
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [eventFilter, setEventFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: queryError } = await supabase
        .from('platform_activity_log')
        .select(`
          id, event_type, actor_user_id, subject_user_id,
          resource_type, resource_id, source, ip_hash, identity_hash,
          metadata, created_at,
          actor:users!platform_activity_log_actor_user_id_fkey(username, display_name),
          subject:users!platform_activity_log_subject_user_id_fkey(username, display_name)
        `)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(500);
      if (queryError) throw queryError;
      const loaded = (data ?? []) as Array<ActivityRow & {
        actor: ActivityRow['actor'] | ActivityRow['actor'][];
        subject: ActivityRow['subject'] | ActivityRow['subject'][];
      }>;
      setRows(loaded.map((row) => ({
        ...row,
        actor: Array.isArray(row.actor) ? row.actor[0] ?? null : row.actor,
        subject: Array.isArray(row.subject) ? row.subject[0] ?? null : row.subject,
      })));
    } catch (caught: unknown) {
      const message = caught instanceof Error ? caught.message : 'تعذر تحميل سجل النشاط.';
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const eventTypes = useMemo(
    () => [...new Set(rows.map((row) => row.event_type))].sort(),
    [rows],
  );
  const visibleRows = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return rows.filter((row) => {
      if (eventFilter && row.event_type !== eventFilter) return false;
      if (!term) return true;
      return [
        row.actor?.username,
        row.actor?.display_name,
        row.subject?.username,
        row.subject?.display_name,
        row.event_type,
        row.resource_id,
        row.ip_hash?.slice(0, 12),
        row.identity_hash?.slice(0, 12),
      ].some((value) => value?.toLocaleLowerCase().includes(term));
    });
  }, [eventFilter, rows, search]);

  const uniqueNetworks = new Set(rows.flatMap((row) => row.ip_hash ? [row.ip_hash] : [])).size;
  const authAttempts = rows.filter((row) => row.source === 'auth').length;

  return (
    <div className="space-y-6" dir="rtl">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <span className="rounded-xl bg-cyan-400/10 p-3 text-cyan-300"><Activity size={21} /></span>
            <div>
              <h1 className="text-2xl font-bold text-white">حركة المنصة</h1>
              <p className="mt-1 text-sm text-gray-400">أحداث الحسابات والغرف والألعاب والمحفظة والإدارة؛ لا يُسجل محتوى الرسائل أو بيانات الاعتماد.</p>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-dark-surface px-4 py-2.5 text-sm text-gray-200 transition hover:bg-dark-elevated disabled:opacity-50"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          تحديث السجل
        </button>
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        <Stat label="الأحداث الظاهرة" value={rows.length.toLocaleString('ar')} />
        <Stat label="أحداث المصادقة" value={authAttempts.toLocaleString('ar')} />
        <Stat label="بصمات شبكة مجزأة" value={uniqueNetworks.toLocaleString('ar')} />
      </section>

      <div className="grid gap-3 rounded-xl border border-wattar-900 bg-dark-surface p-4 md:grid-cols-[minmax(0,1fr)_250px]">
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500" size={17} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="بحث باسم المستخدم أو جزء من البصمة..."
            className="w-full rounded-lg border border-wattar-900 bg-dark-elevated py-2.5 pr-10 pl-4 text-sm text-white placeholder-gray-500 focus:border-wattar-500 focus:outline-none"
          />
        </div>
        <select
          value={eventFilter}
          onChange={(event) => setEventFilter(event.target.value)}
          className="rounded-lg border border-wattar-900 bg-dark-elevated px-3 py-2.5 text-sm text-white focus:border-wattar-500 focus:outline-none"
        >
          <option value="">كل الأحداث</option>
          {eventTypes.map((event) => (
            <option key={event} value={event}>{eventLabels[event] ?? event}</option>
          ))}
        </select>
      </div>

      {error ? (
        <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
          تعذر تحميل السجل: {error}
          <p className="mt-1 text-xs text-red-200/80">تأكد من تطبيق ترحيل سجل النشاط في قاعدة البيانات قبل فتح هذه الصفحة.</p>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-wattar-900 bg-dark-surface">
        {loading && rows.length === 0 ? (
          <p className="p-10 text-center text-sm text-gray-400">جاري تحميل سجل النشاط...</p>
        ) : visibleRows.length === 0 ? (
          <div className="p-10 text-center">
            <ShieldCheck size={26} className="mx-auto mb-3 text-gray-500" />
            <p className="font-medium text-gray-300">لا توجد أحداث مطابقة</p>
            <p className="mt-1 text-sm text-gray-500">ستظهر الأحداث بعد تطبيق ترحيل النشاط وتحديث البيانات.</p>
          </div>
        ) : (
          <div className="divide-y divide-wattar-900/70">
            {visibleRows.map((row) => (
              <article key={row.id} className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_minmax(13rem,0.8fr)_auto] md:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${row.source === 'auth' ? 'bg-amber-500/10 text-amber-300' : 'bg-wattar-500/10 text-wattar-300'}`}>
                      {eventLabels[row.event_type] ?? row.event_type}
                    </span>
                    <span className="text-xs text-gray-500">{sourceLabels[row.source] ?? row.source}</span>
                  </div>
                  <p className="mt-2 text-sm text-gray-200">
                    {row.actor?.display_name || row.actor?.username || (row.source === 'auth' ? 'محاولة غير مرتبطة بحساب' : 'نشاط النظام')}
                    {row.subject && row.subject_user_id !== row.actor_user_id
                      ? <span className="text-gray-400"> ← {row.subject.display_name || `@${row.subject.username}`}</span>
                      : null}
                  </p>
                  {row.resource_type ? (
                    <p className="mt-1 break-all text-[11px] text-gray-500">
                      {row.resource_type}{row.resource_id ? ` · ${row.resource_id}` : ''}
                    </p>
                  ) : null}
                </div>
                <div className="space-y-1 text-[10px] text-gray-500">
                  {row.ip_hash && <p>بصمة الشبكة: <code className="text-gray-400">{row.ip_hash.slice(0, 12)}</code></p>}
                  {row.identity_hash && <p>بصمة الحساب: <code className="text-gray-400">{row.identity_hash.slice(0, 12)}</code></p>}
                  {row.metadata && Object.keys(row.metadata).length > 0 && (
                    <p>تفاصيل: {Object.entries(row.metadata).map(([key, value]) => `${key}: ${String(value)}`).join(' · ')}</p>
                  )}
                </div>
                <time className="whitespace-nowrap text-xs text-gray-500" dateTime={row.created_at}>
                  {new Date(row.created_at).toLocaleString('ar')}
                </time>
              </article>
            ))}
          </div>
        )}
      </div>
      <p className="text-xs leading-5 text-gray-500">
        يعرض السجل آخر 500 حدث تشغيلي مسجل. بصمات الشبكة والهوية مشفّرة باتجاه واحد للمقارنة فقط؛ ليست عناوين IP أو بيانات اتصال قابلة للقراءة، ولا يشمل السجل كل تفاعل اجتماعي داخل التطبيق.
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-dark-surface p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-2 text-xl font-bold text-white">{value}</p>
    </div>
  );
}
