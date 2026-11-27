/**
 * Wattar Admin — الإشعارات (M9.3)
 * حملات إدارية (إنشاء/جدولة/إرسال/إلغاء) + كتالوج أنواع الإشعارات.
 * كل الكتابة عبر RPCs محمية بصلاحيتي notifications.view/manage مع سبب
 * إلزامي وتدقيق قبل/بعد. لا يُحذف أي سجل: الإلغاء حالة لا حذف.
 */
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, Loader2, Megaphone, RefreshCw, Save, Send, Tags, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { canAccess, useAuthStore } from '@/store/auth';
import { Toggle } from '@/components/ui';

interface CampaignRow {
  id: string;
  title: string;
  body: string;
  route: string | null;
  audience_kind: string;
  audience_value: Record<string, unknown>;
  status: string;
  scheduled_at: string | null;
  sent_at: string | null;
  recipients_count: number;
  created_by: string | null;
  created_by_username: string | null;
  created_at: string;
  updated_at: string;
}

interface NotificationTypeRow {
  event_type: string;
  category: string;
  label_ar: string;
  description_ar: string | null;
  push_default: boolean;
  in_app_default: boolean;
  can_disable_in_app: boolean;
  sort_order: number;
  is_active: boolean;
  updated_at: string;
}

interface CampaignDraft {
  title: string;
  body: string;
  route: string;
  audience_kind: string;
  role: string;
  level: string;
  user_ids: string;
  scheduled_at: string;
}

interface TypeDraft {
  label_ar: string;
  description_ar: string;
  category: string;
  sort_order: string;
  push_default: boolean;
  in_app_default: boolean;
  can_disable_in_app: boolean;
  is_active: boolean;
}

const audienceLabels: Record<string, string> = {
  all: 'كل المستخدمين النشطين',
  role: 'حسب الدور',
  vip: 'مشتركو VIP النشطون',
  hosts: 'المضيفات الموثقات',
  level_min: 'مستوى أدنى',
  user_ids: 'قائمة مستخدمين محددة',
};

const statusLabels: Record<string, string> = {
  draft: 'مسودة',
  scheduled: 'مجدولة',
  sending: 'قيد الإرسال',
  sent: 'أُرسلت',
  cancelled: 'ملغاة',
};

const statusStyles: Record<string, string> = {
  draft: 'border-gray-500/40 bg-gray-500/10 text-gray-300',
  scheduled: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
  sending: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  sent: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  cancelled: 'border-red-500/40 bg-red-500/10 text-red-300',
};

const roleOptions = [
  { value: 'user', label: 'مستخدم' },
  { value: 'guest', label: 'زائر' },
  { value: 'agent', label: 'وكيل' },
  { value: 'support', label: 'دعم' },
  { value: 'admin', label: 'إدارة' },
  { value: 'super_admin', label: 'إدارة عليا' },
] as const;

const categoryOptions = [
  { value: 'messages', label: 'الرسائل والدعوات' },
  { value: 'social', label: 'المجتمع والأصدقاء' },
  { value: 'gifts', label: 'الهدايا' },
  { value: 'wallet', label: 'المحفظة والأرباح' },
  { value: 'account', label: 'الحساب والعضويات' },
  { value: 'support', label: 'الدعم والإشراف' },
  { value: 'marketing', label: 'إعلانات Wattar' },
] as const;

const emptyCampaign: CampaignDraft = {
  title: '',
  body: '',
  route: '',
  audience_kind: 'all',
  role: 'user',
  level: '1',
  user_ids: '',
  scheduled_at: '',
};

const emptyType: TypeDraft = {
  label_ar: '',
  description_ar: '',
  category: 'marketing',
  sort_order: '500',
  push_default: true,
  in_app_default: true,
  can_disable_in_app: true,
  is_active: true,
};

function checkReason(reason: string): string | null {
  const value = reason.trim();
  if (value.length < 10) return 'أدخل سبباً لا يقل عن 10 أحرف';
  if (value.length > 500) return 'السبب لا يتجاوز 500 حرف';
  return null;
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
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('ar', { dateStyle: 'short', timeStyle: 'short' });
}

function buildAudienceValue(draft: CampaignDraft): Record<string, unknown> {
  if (draft.audience_kind === 'role') return { role: draft.role };
  if (draft.audience_kind === 'level_min') return { level: Number(draft.level) || 1 };
  if (draft.audience_kind === 'user_ids') {
    const ids = draft.user_ids
      .split(/[\s,]+/)
      .map((item) => item.trim())
      .filter(Boolean);
    return { user_ids: ids };
  }
  return {};
}

function toTypeDraft(row: NotificationTypeRow): TypeDraft {
  return {
    label_ar: row.label_ar,
    description_ar: row.description_ar ?? '',
    category: row.category,
    sort_order: String(row.sort_order ?? 0),
    push_default: row.push_default,
    in_app_default: row.in_app_default,
    can_disable_in_app: row.can_disable_in_app,
    is_active: row.is_active,
  };
}

export function NotificationsPage() {
  const profile = useAuthStore((state) => state.profile);
  const canManage = canAccess(profile, 'notifications.manage');
  const adminId = profile?.id ?? null;

  const [tab, setTab] = useState<'campaigns' | 'types'>('campaigns');
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [types, setTypes] = useState<NotificationTypeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [draft, setDraft] = useState<CampaignDraft>(emptyCampaign);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [createReason, setCreateReason] = useState('');
  const [savingCampaign, setSavingCampaign] = useState(false);

  const [rowReasons, setRowReasons] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const [typeDrafts, setTypeDrafts] = useState<Record<string, TypeDraft>>({});
  const [newType, setNewType] = useState({ event_type: '', ...emptyType });
  const [newTypeReason, setNewTypeReason] = useState('');
  const [savingType, setSavingType] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!adminId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [campaignResult, typeResult] = await Promise.all([
        supabase.rpc('admin_list_notification_campaigns', { p_admin_id: adminId }),
        supabase.rpc('admin_list_notification_types', { p_admin_id: adminId }),
      ]);
      if (campaignResult.error) throw campaignResult.error;
      if (typeResult.error) throw typeResult.error;
      setCampaigns(Array.isArray(campaignResult.data) ? (campaignResult.data as CampaignRow[]) : []);
      const typeList = Array.isArray(typeResult.data) ? (typeResult.data as NotificationTypeRow[]) : [];
      setTypes(typeList);
      setTypeDrafts(Object.fromEntries(typeList.map((row) => [row.event_type, toTypeDraft(row)])));
    } catch (caught: unknown) {
      setLoadError(caught instanceof Error ? caught.message : 'تعذر تحميل بيانات الإشعارات.');
    } finally {
      setLoading(false);
    }
  }, [adminId]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => ({
    sent: campaigns.filter((item) => item.status === 'sent').length,
    scheduled: campaigns.filter((item) => item.status === 'scheduled').length,
    recipients: campaigns.reduce((sum, item) => sum + (item.recipients_count ?? 0), 0),
    activeTypes: types.filter((item) => item.is_active).length,
  }), [campaigns, types]);

  const resetForm = () => {
    setDraft(emptyCampaign);
    setEditingId(null);
    setCreateReason('');
  };

  const startEdit = (row: CampaignRow) => {
    const value = row.audience_value ?? {};
    setEditingId(row.id);
    setDraft({
      title: row.title,
      body: row.body,
      route: row.route ?? '',
      audience_kind: row.audience_kind,
      role: typeof value.role === 'string' ? value.role : 'user',
      level: String(value.level ?? '1'),
      user_ids: Array.isArray(value.user_ids) ? (value.user_ids as string[]).join('\n') : '',
      scheduled_at: toDateTimeLocal(row.scheduled_at),
    });
    setTab('campaigns');
    toast.info('حُمّلت الحملة في النموذج للتعديل');
  };

  const saveCampaign = async (event: FormEvent) => {
    event.preventDefault();
    if (!adminId || !canManage) return;
    const reasonError = checkReason(createReason);
    if (reasonError) {
      toast.error(reasonError);
      return;
    }
    if (draft.title.trim().length < 3 || draft.title.trim().length > 120) {
      toast.error('عنوان الحملة يجب أن يكون بين 3 و120 حرفاً');
      return;
    }
    if (draft.body.trim().length < 3 || draft.body.trim().length > 500) {
      toast.error('نص الحملة يجب أن يكون بين 3 و500 حرف');
      return;
    }
    if (draft.audience_kind === 'user_ids') {
      const ids = buildAudienceValue(draft).user_ids as string[];
      if (!ids.length) {
        toast.error('أدخل معرف مستخدم واحداً على الأقل');
        return;
      }
    }
    setSavingCampaign(true);
    try {
      const { error } = await supabase.rpc('admin_upsert_notification_campaign', {
        p_admin_id: adminId,
        p_campaign_id: editingId,
        p_payload: {
          title: draft.title.trim(),
          body: draft.body.trim(),
          route: draft.route.trim() || null,
          audience_kind: draft.audience_kind,
          audience_value: buildAudienceValue(draft),
          scheduled_at: fromDateTimeLocal(draft.scheduled_at),
        },
        p_reason: createReason.trim(),
      });
      if (error) throw error;
      toast.success(editingId ? 'حُدّثت الحملة' : 'أُنشئت الحملة');
      resetForm();
      await load();
    } catch (caught: unknown) {
      toast.error(caught instanceof Error ? caught.message : 'تعذر حفظ الحملة');
    } finally {
      setSavingCampaign(false);
    }
  };

  const dispatchCampaign = async (row: CampaignRow) => {
    if (!adminId || !canManage) return;
    setBusyId(row.id);
    try {
      const { data, error } = await supabase.rpc('dispatch_notification_campaign', {
        p_campaign_id: row.id,
      });
      if (error) throw error;
      const result = data as { recipients?: number; already_processed?: boolean } | null;
      if (result?.already_processed) toast.info('الحملة مُعالجة مسبقاً — لم يُكرَّر الإرسال');
      else toast.success(`أُرسلت الحملة إلى ${result?.recipients ?? 0} مستخدماً`);
      await load();
    } catch (caught: unknown) {
      toast.error(caught instanceof Error ? caught.message : 'تعذر إرسال الحملة');
    } finally {
      setBusyId(null);
    }
  };

  const cancelCampaign = async (row: CampaignRow) => {
    if (!adminId || !canManage) return;
    const reasonError = checkReason(rowReasons[row.id] ?? '');
    if (reasonError) {
      toast.error(reasonError);
      return;
    }
    setBusyId(row.id);
    try {
      const { error } = await supabase.rpc('admin_cancel_notification_campaign', {
        p_admin_id: adminId,
        p_campaign_id: row.id,
        p_reason: (rowReasons[row.id] ?? '').trim(),
      });
      if (error) throw error;
      toast.success('أُلغيت الحملة (السجل محفوظ)');
      setRowReasons((prev) => ({ ...prev, [row.id]: '' }));
      await load();
    } catch (caught: unknown) {
      toast.error(caught instanceof Error ? caught.message : 'تعذر إلغاء الحملة');
    } finally {
      setBusyId(null);
    }
  };

  const saveType = async (row: NotificationTypeRow) => {
    if (!adminId || !canManage) return;
    const rowDraft = typeDrafts[row.event_type] ?? toTypeDraft(row);
    const reasonError = checkReason(rowReasons[row.event_type] ?? '');
    if (reasonError) {
      toast.error(reasonError);
      return;
    }
    if (rowDraft.label_ar.trim().length < 2 || rowDraft.label_ar.trim().length > 80) {
      toast.error('اسم النوع يجب أن يكون بين 2 و80 حرفاً');
      return;
    }
    setSavingType(row.event_type);
    try {
      const { error } = await supabase.rpc('admin_upsert_notification_type', {
        p_admin_id: adminId,
        p_event_type: row.event_type,
        p_payload: {
          category: rowDraft.category,
          label_ar: rowDraft.label_ar.trim(),
          description_ar: rowDraft.description_ar.trim() || null,
          sort_order: Number(rowDraft.sort_order) || 0,
          push_default: rowDraft.push_default,
          in_app_default: rowDraft.in_app_default,
          can_disable_in_app: rowDraft.can_disable_in_app,
          is_active: rowDraft.is_active,
        },
        p_reason: (rowReasons[row.event_type] ?? '').trim(),
      });
      if (error) throw error;
      toast.success('حُفظ نوع الإشعار');
      setRowReasons((prev) => ({ ...prev, [row.event_type]: '' }));
      await load();
    } catch (caught: unknown) {
      toast.error(caught instanceof Error ? caught.message : 'تعذر حفظ النوع');
    } finally {
      setSavingType(null);
    }
  };

  const createType = async (event: FormEvent) => {
    event.preventDefault();
    if (!adminId || !canManage) return;
    const reasonError = checkReason(newTypeReason);
    if (reasonError) {
      toast.error(reasonError);
      return;
    }
    const key = newType.event_type.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,60}$/.test(key)) {
      toast.error('المفتاح: أحرف إنجليزية صغيرة وأرقام و_ بين 3 و60');
      return;
    }
    if (newType.label_ar.trim().length < 2) {
      toast.error('أدخل اسم النوع');
      return;
    }
    setSavingType(key);
    try {
      const { error } = await supabase.rpc('admin_upsert_notification_type', {
        p_admin_id: adminId,
        p_event_type: key,
        p_payload: {
          category: newType.category,
          label_ar: newType.label_ar.trim(),
          description_ar: newType.description_ar.trim() || null,
          sort_order: Number(newType.sort_order) || 0,
          push_default: newType.push_default,
          in_app_default: newType.in_app_default,
          can_disable_in_app: newType.can_disable_in_app,
          is_active: newType.is_active,
        },
        p_reason: newTypeReason.trim(),
      });
      if (error) throw error;
      toast.success('أُضيف نوع الإشعار');
      setNewType({ event_type: '', ...emptyType });
      setNewTypeReason('');
      await load();
    } catch (caught: unknown) {
      toast.error(caught instanceof Error ? caught.message : 'تعذر إضافة النوع');
    } finally {
      setSavingType(null);
    }
  };

  if (!canAccess(profile, 'notifications.view')) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-300" dir="rtl">
        لا تملك صلاحية عرض الإشعارات.
      </div>
    );
  }

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">الإشعارات والحملات</h1>
          <p className="mt-1 text-sm text-gray-400">
            حملات إدارية لكل المستخدمين أو لجمهور محدد، وكتالوج أنواع الإشعارات الذي يظهر في التطبيق.
            التسليم يتم عبر طابور خادمي مع منع تكرار.
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
        <StatCard label="حملات أُرسلت" value={stats.sent} icon={Megaphone} />
        <StatCard label="مجدولة" value={stats.scheduled} icon={Bell} />
        <StatCard label="إجمالي المستلمين" value={stats.recipients} icon={Send} />
        <StatCard label="أنواع نشطة" value={stats.activeTypes} icon={Tags} />
      </div>

      {!canManage ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
          صلاحيتك للعرض فقط. تحتاج notifications.manage للإنشاء والإرسال والتعديل.
        </div>
      ) : null}

      <div className="flex gap-2">
        <button
          onClick={() => setTab('campaigns')}
          className={`rounded-lg px-4 py-2 text-sm font-medium ${tab === 'campaigns' ? 'bg-wattar-600 text-white' : 'border border-wattar-900 text-gray-300'}`}
        >
          الحملات
        </button>
        <button
          onClick={() => setTab('types')}
          className={`rounded-lg px-4 py-2 text-sm font-medium ${tab === 'types' ? 'bg-wattar-600 text-white' : 'border border-wattar-900 text-gray-300'}`}
        >
          أنواع الإشعارات
        </button>
      </div>

      {loading ? (
        <p className="text-gray-400">جاري التحميل...</p>
      ) : loadError ? (
        <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-300">
          {loadError}
          <button onClick={() => void load()} className="mt-3 rounded-lg bg-red-500/20 px-4 py-2 text-sm">إعادة المحاولة</button>
        </div>
      ) : tab === 'campaigns' ? (
        <>
          {canManage ? (
            <form onSubmit={saveCampaign} className="space-y-4 rounded-xl border border-wattar-900 bg-dark-surface p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">
                  {editingId ? 'تعديل حملة' : 'حملة جديدة'}
                </h2>
                {editingId ? (
                  <button type="button" onClick={resetForm} className="text-xs text-gray-400 underline">
                    إلغاء التعديل
                  </button>
                ) : null}
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <Input label="العنوان (3–120)" value={draft.title} onChange={(value) => setDraft({ ...draft, title: value })} />
                <Input label="المسار داخل التطبيق (اختياري)" value={draft.route} onChange={(value) => setDraft({ ...draft, route: value })} />
              </div>
              <label className="block text-xs text-gray-400">
                نص الإشعار (3–500)
                <textarea
                  value={draft.body}
                  onChange={(event) => setDraft({ ...draft, body: event.target.value })}
                  rows={3}
                  className="mt-1 w-full rounded-lg border border-wattar-900 bg-dark-elevated px-3 py-2 text-sm text-white"
                />
              </label>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                <Select
                  label="الجمهور"
                  value={draft.audience_kind}
                  options={Object.entries(audienceLabels).map(([value, label]) => ({ value, label }))}
                  onChange={(value) => setDraft({ ...draft, audience_kind: value })}
                />
                {draft.audience_kind === 'role' ? (
                  <Select
                    label="الدور"
                    value={draft.role}
                    options={roleOptions}
                    onChange={(value) => setDraft({ ...draft, role: value })}
                  />
                ) : null}
                {draft.audience_kind === 'level_min' ? (
                  <Input label="أدنى مستوى" type="number" value={draft.level} onChange={(value) => setDraft({ ...draft, level: value })} />
                ) : null}
                <Input
                  label="موعد الإرسال (اختياري)"
                  type="datetime-local"
                  value={draft.scheduled_at}
                  onChange={(value) => setDraft({ ...draft, scheduled_at: value })}
                />
                <Input label="سبب الإجراء (10–500)" value={createReason} onChange={setCreateReason} />
              </div>
              {draft.audience_kind === 'user_ids' ? (
                <label className="block text-xs text-gray-400">
                  معرفات المستخدمين (سطر أو فاصلة لكل معرف)
                  <textarea
                    value={draft.user_ids}
                    onChange={(event) => setDraft({ ...draft, user_ids: event.target.value })}
                    rows={3}
                    className="mt-1 w-full rounded-lg border border-wattar-900 bg-dark-elevated px-3 py-2 text-sm text-white"
                  />
                </label>
              ) : null}
              <button disabled={savingCampaign} className="flex items-center gap-2 rounded-lg bg-wattar-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                {savingCampaign ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                {editingId ? 'حفظ التعديل' : 'إنشاء الحملة'}
              </button>
            </form>
          ) : null}

          <div className="space-y-3">
            {campaigns.map((row) => {
              const busy = busyId === row.id;
              const canDispatch = canManage && ['draft', 'scheduled'].includes(row.status);
              const canCancel = canManage && ['draft', 'scheduled', 'sending'].includes(row.status);
              return (
                <section key={row.id} className="space-y-3 rounded-xl border border-wattar-900 bg-dark-surface p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-white">{row.title}</h3>
                      <p className="mt-1 text-sm text-gray-400">{row.body}</p>
                      <p className="mt-2 text-xs text-gray-500">
                        {audienceLabels[row.audience_kind] ?? row.audience_kind}
                        {row.route ? ` · ${row.route}` : ''}
                        {` · المستلمون: ${row.recipients_count}`}
                        {` · أُنشئت: ${formatDate(row.created_at)}`}
                        {row.scheduled_at ? ` · موعدها: ${formatDate(row.scheduled_at)}` : ''}
                        {row.sent_at ? ` · أُرسلت: ${formatDate(row.sent_at)}` : ''}
                        {row.created_by_username ? ` · بواسطة: ${row.created_by_username}` : ''}
                      </p>
                    </div>
                    <span className={`rounded-lg border px-2.5 py-1 text-xs ${statusStyles[row.status] ?? statusStyles.draft}`}>
                      {statusLabels[row.status] ?? row.status}
                    </span>
                  </div>

                  {canManage && (canDispatch || canCancel) ? (
                    <div className="flex flex-wrap items-end gap-2">
                      {canCancel ? (
                        <Input
                          label="سبب الإلغاء (10–500)"
                          value={rowReasons[row.id] ?? ''}
                          onChange={(value) => setRowReasons((prev) => ({ ...prev, [row.id]: value }))}
                        />
                      ) : null}
                      {canDispatch ? (
                        <button
                          type="button"
                          onClick={() => void dispatchCampaign(row)}
                          disabled={busy}
                          className="flex h-10 items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-medium text-white disabled:opacity-50"
                        >
                          {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                          إرسال الآن
                        </button>
                      ) : null}
                      {canCancel ? (
                        <button
                          type="button"
                          onClick={() => void cancelCampaign(row)}
                          disabled={busy}
                          className="flex h-10 items-center gap-2 rounded-lg border border-red-500/40 px-4 text-sm text-red-300 disabled:opacity-50"
                        >
                          {busy ? <Loader2 size={16} className="animate-spin" /> : <XCircle size={16} />}
                          إلغاء الحملة
                        </button>
                      ) : null}
                      {['draft', 'scheduled'].includes(row.status) ? (
                        <button
                          type="button"
                          onClick={() => startEdit(row)}
                          className="flex h-10 items-center gap-2 rounded-lg border border-wattar-900 px-4 text-sm text-gray-300"
                        >
                          تعديل
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </section>
              );
            })}
            {campaigns.length === 0 ? <p className="text-gray-400">لا توجد حملات بعد.</p> : null}
          </div>
        </>
      ) : (
        <>
          {canManage ? (
            <form onSubmit={createType} className="space-y-4 rounded-xl border border-wattar-900 bg-dark-surface p-5">
              <h2 className="text-lg font-semibold text-white">إضافة نوع إشعار</h2>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                <Input label="المفتاح (a-z0-9_)" value={newType.event_type} onChange={(value) => setNewType({ ...newType, event_type: value })} />
                <Input label="الاسم بالعربية" value={newType.label_ar} onChange={(value) => setNewType({ ...newType, label_ar: value })} />
                <Select label="الفئة" value={newType.category} options={categoryOptions} onChange={(value) => setNewType({ ...newType, category: value })} />
                <Input label="الوصف" value={newType.description_ar} onChange={(value) => setNewType({ ...newType, description_ar: value })} />
                <Input label="الترتيب" type="number" value={newType.sort_order} onChange={(value) => setNewType({ ...newType, sort_order: value })} />
                <Input label="سبب الإضافة (10–500)" value={newTypeReason} onChange={setNewTypeReason} />
                <Toggle label="دفع افتراضي" checked={newType.push_default} onChange={(checked) => setNewType({ ...newType, push_default: checked })} />
                <Toggle label="داخل التطبيق افتراضي" checked={newType.in_app_default} onChange={(checked) => setNewType({ ...newType, in_app_default: checked })} />
                <Toggle label="قابل للتعطيل داخل التطبيق" checked={newType.can_disable_in_app} onChange={(checked) => setNewType({ ...newType, can_disable_in_app: checked })} />
              </div>
              <button disabled={savingType !== null} className="flex items-center gap-2 rounded-lg bg-wattar-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                {savingType !== null ? <Loader2 size={16} className="animate-spin" /> : <Tags size={16} />}
                إضافة النوع
              </button>
            </form>
          ) : null}

          <div className="space-y-3">
            {types.map((row) => {
              const rowDraft = typeDrafts[row.event_type] ?? toTypeDraft(row);
              const busy = savingType === row.event_type;
              return (
                <section key={row.event_type} className="space-y-3 rounded-xl border border-wattar-900 bg-dark-surface p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="font-semibold text-white">{rowDraft.label_ar || row.event_type}</h3>
                      <p className="mt-1 text-xs text-gray-500">
                        {row.event_type} · {categoryOptions.find((item) => item.value === rowDraft.category)?.label ?? rowDraft.category}
                        {row.is_active ? '' : ' · معطّل'}
                      </p>
                    </div>
                    <Toggle
                      label={rowDraft.is_active ? 'نشط' : 'معطّل'}
                      checked={rowDraft.is_active}
                      onChange={(checked) => setTypeDrafts((prev) => ({
                        ...prev,
                        [row.event_type]: { ...rowDraft, is_active: checked },
                      }))}
                      disabled={!canManage}
                    />
                  </div>
                  <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                    <Input
                      label="الاسم بالعربية"
                      value={rowDraft.label_ar}
                      onChange={(value) => setTypeDrafts((prev) => ({ ...prev, [row.event_type]: { ...rowDraft, label_ar: value } }))}
                    />
                    <Input
                      label="الوصف"
                      value={rowDraft.description_ar}
                      onChange={(value) => setTypeDrafts((prev) => ({ ...prev, [row.event_type]: { ...rowDraft, description_ar: value } }))}
                    />
                    <Select
                      label="الفئة"
                      value={rowDraft.category}
                      options={categoryOptions}
                      onChange={(value) => setTypeDrafts((prev) => ({ ...prev, [row.event_type]: { ...rowDraft, category: value } }))}
                    />
                    <Input
                      label="الترتيب"
                      type="number"
                      value={rowDraft.sort_order}
                      onChange={(value) => setTypeDrafts((prev) => ({ ...prev, [row.event_type]: { ...rowDraft, sort_order: value } }))}
                    />
                    <Toggle
                      label="دفع افتراضي"
                      checked={rowDraft.push_default}
                      onChange={(checked) => setTypeDrafts((prev) => ({ ...prev, [row.event_type]: { ...rowDraft, push_default: checked } }))}
                      disabled={!canManage}
                    />
                    <Toggle
                      label="داخل التطبيق افتراضي"
                      checked={rowDraft.in_app_default}
                      onChange={(checked) => setTypeDrafts((prev) => ({ ...prev, [row.event_type]: { ...rowDraft, in_app_default: checked } }))}
                      disabled={!canManage}
                    />
                    <Toggle
                      label="قابل للتعطيل داخل التطبيق"
                      checked={rowDraft.can_disable_in_app}
                      onChange={(checked) => setTypeDrafts((prev) => ({ ...prev, [row.event_type]: { ...rowDraft, can_disable_in_app: checked } }))}
                      disabled={!canManage}
                    />
                    {canManage ? (
                      <>
                        <Input
                          label="سبب الحفظ (10–500)"
                          value={rowReasons[row.event_type] ?? ''}
                          onChange={(value) => setRowReasons((prev) => ({ ...prev, [row.event_type]: value }))}
                        />
                        <div className="flex items-end">
                          <button
                            type="button"
                            onClick={() => void saveType(row)}
                            disabled={busy}
                            className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-wattar-600 px-4 text-sm font-medium text-white disabled:opacity-50"
                          >
                            {busy ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                            حفظ النوع
                          </button>
                        </div>
                      </>
                    ) : null}
                  </div>
                </section>
              );
            })}
            {types.length === 0 ? <p className="text-gray-400">لا توجد أنواع إشعارات.</p> : null}
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: typeof Bell;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-wattar-900 bg-dark-surface p-4">
      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-wattar-600/15 text-wattar-300">
        <Icon size={18} />
      </span>
      <div>
        <p className="text-xs text-gray-400">{label}</p>
        <p className="text-lg font-semibold text-white">{value.toLocaleString('ar')}</p>
      </div>
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
