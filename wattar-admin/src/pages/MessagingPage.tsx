import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Loader2, MessageCircle, RefreshCw, Search, ShieldCheck, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { validateMessagingSettings, type MessagingSettings } from '@/lib/messagingSettings';

interface HostProgramMember {
  user_id: string;
  username: string;
  display_name: string | null;
  status: 'active' | 'suspended';
  approved_at: string;
}

interface HostCommission {
  transaction_id: string;
  user_id: string;
  username: string;
  amount_diamond: number;
  created_at: string;
}

interface HostIntroTemplate {
  template_id: number;
  body: string;
  is_active: boolean;
  created_at: string;
}

interface HostCandidate {
  id: string;
  username: string;
  display_name: string | null;
  adult_confirmed_at: string | null;
}

const initialSettings: MessagingSettings = {
  free_message_limit: 5,
  price_coin: 50,
  host_commission_percent: 60,
  host_intro_daily_limit: 2,
  host_outreach_enabled: true,
};

export function MessagingPage() {
  const [settings, setSettings] = useState(initialSettings);
  const [hosts, setHosts] = useState<HostProgramMember[]>([]);
  const [commissions, setCommissions] = useState<HostCommission[]>([]);
  const [templates, setTemplates] = useState<HostIntroTemplate[]>([]);
  const [templateDraft, setTemplateDraft] = useState('');
  const [templateBusyId, setTemplateBusyId] = useState<number | null>(null);
  const [username, setUsername] = useState('');
  const [reason, setReason] = useState('');
  const [candidate, setCandidate] = useState<HostCandidate | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searching, setSearching] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [settingsResult, hostsResult, commissionsResult, templatesResult] = await Promise.all([
        supabase.rpc('admin_get_private_message_settings'),
        supabase.rpc('admin_list_host_program_members'),
        supabase.rpc('admin_list_host_message_commissions'),
        supabase.rpc('admin_list_host_intro_templates'),
      ]);
      if (settingsResult.error) throw settingsResult.error;
      if (hostsResult.error) throw hostsResult.error;
      if (commissionsResult.error) throw commissionsResult.error;
      if (templatesResult.error) throw templatesResult.error;
      if (settingsResult.data && typeof settingsResult.data === 'object') {
        setSettings({ ...initialSettings, ...(settingsResult.data as MessagingSettings) });
      }
      setHosts((hostsResult.data ?? []) as HostProgramMember[]);
      setCommissions((commissionsResult.data ?? []) as HostCommission[]);
      setTemplates((templatesResult.data ?? []) as HostIntroTemplate[]);
    } catch (caught: unknown) {
      const message = caught instanceof Error ? caught.message : 'تعذر تحميل إعدادات الرسائل.';
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const saveTemplate = async (templateId: number | null, body: string, active: boolean) => {
    const text = body.trim();
    if (text.length < 1 || text.length > 500) {
      toast.error('يجب أن يكون نص الافتتاحية بين حرف و500 حرف.');
      return;
    }
    setTemplateBusyId(templateId ?? -1);
    try {
      const { error: saveError } = await supabase.rpc('admin_set_host_intro_template', {
        p_template_id: templateId,
        p_body: text,
        p_is_active: active,
      });
      if (saveError) throw saveError;
      if (templateId === null) setTemplateDraft('');
      await load();
      toast.success(templateId === null ? 'أُضيفت الافتتاحية وسُجلت في سجل الإدارة.' : 'حُدثت الافتتاحية.');
    } catch (caught: unknown) {
      toast.error(caught instanceof Error ? caught.message : 'تعذر حفظ الافتتاحية.');
    } finally {
      setTemplateBusyId(null);
    }
  };

  useEffect(() => {
    void load();
  }, [load]);

  const saveSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const rangeError = validateMessagingSettings(settings);
    if (rangeError) {
      toast.error(rangeError);
      return;
    }

    setSaving(true);
    try {
      const { error: saveError } = await supabase.rpc('admin_update_private_message_settings', {
        p_free_message_limit: settings.free_message_limit,
        p_price_coin: settings.price_coin,
        p_host_commission_percent: settings.host_commission_percent,
        p_host_intro_daily_limit: settings.host_intro_daily_limit,
        p_host_outreach_enabled: settings.host_outreach_enabled,
      });
      if (saveError) throw saveError;
      toast.success('حُفظت الإعدادات وسُجل التغيير في سجل الإدارة.');
      await load();
    } catch (caught: unknown) {
      toast.error(caught instanceof Error ? caught.message : 'تعذر حفظ إعدادات الرسائل.');
    } finally {
      setSaving(false);
    }
  };

  const findCandidate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = username.trim();
    if (!/^[a-zA-Z0-9._-]{3,50}$/.test(value)) {
      toast.error('أدخل اسم مستخدم صحيحًا.');
      return;
    }
    setSearching(true);
    setCandidate(null);
    try {
      const { data, error: searchError } = await supabase
        .from('users')
        .select('id, username, display_name, adult_confirmed_at')
        .eq('username', value)
        .eq('role', 'user')
        .eq('status', 'active')
        .maybeSingle();
      if (searchError) throw searchError;
      if (!data) {
        toast.error('لم يُعثر على مستخدم نشط بهذا الاسم.');
        return;
      }
      setCandidate(data as HostCandidate);
    } catch (caught: unknown) {
      toast.error(caught instanceof Error ? caught.message : 'تعذر البحث عن الحساب.');
    } finally {
      setSearching(false);
    }
  };

  const changeMembership = async (userId: string, active: boolean) => {
    if (reason.trim().length < 3) {
      toast.error('اكتب سببًا واضحًا من 3 أحرف على الأقل.');
      return;
    }
    setProcessingId(userId);
    try {
      const { error: actionError } = await supabase.rpc('admin_set_host_program_member', {
        p_user_id: userId,
        p_active: active,
        p_reason: reason.trim(),
      });
      if (actionError) throw actionError;
      toast.success(active ? 'أُضيفت المضيفة إلى برنامج المضيفات.' : 'أُوقفت عضوية المضيفة.');
      setCandidate(null);
      setUsername('');
      setReason('');
      await load();
    } catch (caught: unknown) {
      toast.error(caught instanceof Error ? caught.message : 'تعذر تحديث عضوية المضيفة.');
    } finally {
      setProcessingId(null);
    }
  };

  const inputClass = 'w-full rounded-lg border border-wattar-900 bg-dark-bg px-3 py-2 text-sm text-white outline-none focus:border-wattar-500';

  return (
    <div className="space-y-6" dir="rtl">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-white">
            <MessageCircle size={23} className="text-purple-300" /> الرسائل وبرنامج المضيفات
          </h1>
          <p className="mt-1 text-sm text-gray-400">
            إدارة سعر الرسائل، الرسائل الافتتاحية، وعضوية المضيفات بشكل مستقل عن شارة التوثيق.
          </p>
        </div>
        <button onClick={() => void load()} className="rounded-lg border border-wattar-900 p-2 text-gray-300" aria-label="تحديث">
          <RefreshCw size={17} />
        </button>
      </header>

      {error && (
        <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-300">
          تعذر تحميل بيانات الرسائل: {error}
        </div>
      )}

      <form onSubmit={saveSettings} className="space-y-4 rounded-xl border border-wattar-900 bg-dark-surface p-5">
        <div>
          <h2 className="font-semibold text-white">سياسة الرسائل</h2>
          <p className="mt-1 text-xs text-gray-400">تظهر تكلفة الرسالة قبل الإرسال، وتُسجل كل عملية محفظة وعمولة.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <NumberField label="رسائل مجانية لكل طرف" min={0} max={100} value={settings.free_message_limit}
            onChange={(value) => setSettings({ ...settings, free_message_limit: value })} />
          <NumberField label="سعر الرسالة (Coin)" min={1} max={1_000_000} value={settings.price_coin}
            onChange={(value) => setSettings({ ...settings, price_coin: value })} />
          <NumberField label="حصة المضيفة (%)" min={0} max={100} value={settings.host_commission_percent}
            onChange={(value) => setSettings({ ...settings, host_commission_percent: value })} />
          <NumberField label="افتتاحيات مضيفات يوميًا لكل مستخدم" min={0} max={10} value={settings.host_intro_daily_limit}
            onChange={(value) => setSettings({ ...settings, host_intro_daily_limit: value })} />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-200">
          <input type="checkbox" checked={settings.host_outreach_enabled}
            onChange={(event) => setSettings({ ...settings, host_outreach_enabled: event.target.checked })} />
          تفعيل الرسائل الافتتاحية المجدولة من المضيفات
        </label>
        <button disabled={saving || loading} className="rounded-lg bg-wattar-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {saving ? <Loader2 className="inline animate-spin" size={16} /> : 'حفظ الإعدادات'}
        </button>
      </form>

      <section className="space-y-4 rounded-xl border border-wattar-900 bg-dark-surface p-5">
        <div>
          <h2 className="flex items-center gap-2 font-semibold text-white"><ShieldCheck size={18} className="text-emerald-300" /> أعضاء برنامج المضيفات</h2>
          <p className="mt-1 text-xs text-gray-400">هذه العضوية منفصلة عن توثيق الحساب. أضف حسابًا نشطًا ومؤكد العمر مع تسجيل سبب إداري.</p>
        </div>
        <form onSubmit={findCandidate} className="grid gap-3 md:grid-cols-[1fr_2fr_auto]">
          <input className={inputClass} value={username} onChange={(event) => setUsername(event.target.value)} placeholder="اسم المستخدم" />
          <input className={inputClass} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="سبب التعيين أو الإيقاف (مدقق)" maxLength={500} />
          <button disabled={searching} className="flex items-center justify-center gap-2 rounded-lg border border-wattar-700 px-4 py-2 text-sm text-white disabled:opacity-50">
            {searching ? <Loader2 className="animate-spin" size={16} /> : <Search size={16} />} بحث
          </button>
        </form>
        {candidate && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-wattar-800 bg-dark-bg p-3">
            <div className="text-sm text-white">
              <strong>{candidate.display_name || candidate.username}</strong>
              <span className="mr-2 text-gray-400">@{candidate.username}</span>
              {!candidate.adult_confirmed_at && <span className="mr-2 text-amber-300">غير مؤكد العمر</span>}
            </div>
            <button disabled={!candidate.adult_confirmed_at || processingId === candidate.id}
              onClick={() => void changeMembership(candidate.id, true)}
              className="flex items-center gap-2 rounded-lg bg-emerald-700 px-3 py-2 text-sm text-white disabled:opacity-50">
              {processingId === candidate.id ? <Loader2 size={15} className="animate-spin" /> : <UserPlus size={15} />}
              تعيين كمضيفة
            </button>
          </div>
        )}
        {loading ? <p className="text-sm text-gray-400">جاري التحميل...</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-right text-sm">
              <thead className="text-xs text-gray-400"><tr>
                <th className="p-3">الحساب</th><th className="p-3">الحالة</th><th className="p-3">تاريخ الاعتماد</th><th className="p-3">إجراء</th>
              </tr></thead>
              <tbody>
                {hosts.map((host) => (
                  <tr key={host.user_id} className="border-t border-wattar-950">
                    <td className="p-3 text-white">{host.display_name || host.username}<span className="mr-2 text-gray-500">@{host.username}</span></td>
                    <td className="p-3">{host.status === 'active' ? 'نشطة' : 'موقوفة'}</td>
                    <td className="p-3 text-gray-400">{new Date(host.approved_at).toLocaleDateString('ar')}</td>
                    <td className="p-3">
                      <button disabled={processingId === host.user_id}
                        onClick={() => void changeMembership(host.user_id, host.status !== 'active')}
                        className="rounded-md border border-wattar-800 px-3 py-1.5 text-xs text-white disabled:opacity-50">
                        {host.status === 'active' ? 'إيقاف' : 'إعادة تفعيل'}
                      </button>
                    </td>
                  </tr>
                ))}
                {hosts.length === 0 && <tr><td className="p-4 text-center text-gray-500" colSpan={4}>لا توجد عضويات بعد.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-4 rounded-xl border border-wattar-900 bg-dark-surface p-5">
        <div>
          <h2 className="font-semibold text-white">مكتبة افتتاحيات المضيفات ({templates.length})</h2>
          <p className="mt-1 text-xs text-gray-400">الرسائل أصلية، وتُرسل مرة واحدة لكل مضيفة ومستخدم. أوقف النصوص غير المناسبة بدل حذف سجلها.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <textarea value={templateDraft} onChange={(event) => setTemplateDraft(event.target.value)}
            maxLength={500} rows={2} placeholder="اكتب افتتاحية جديدة" className={inputClass} />
          <button type="button" disabled={templateBusyId !== null}
            onClick={() => void saveTemplate(null, templateDraft, true)}
            className="rounded-lg bg-wattar-600 px-4 py-2 text-sm text-white disabled:opacity-50">
            إضافة للمكتبة
          </button>
        </div>
        <div className="max-h-[420px] space-y-2 overflow-y-auto">
          {templates.map((template) => (
            <div key={template.template_id} className="flex items-start justify-between gap-3 rounded-lg border border-wattar-950 bg-dark-bg p-3">
              <p className="flex-1 text-sm leading-6 text-gray-200">{template.body}</p>
              <button type="button" disabled={templateBusyId !== null}
                onClick={() => void saveTemplate(template.template_id, template.body, !template.is_active)}
                className={`shrink-0 rounded-md px-3 py-1.5 text-xs ${template.is_active ? 'bg-emerald-900/50 text-emerald-300' : 'bg-gray-800 text-gray-400'} disabled:opacity-50`}>
                {templateBusyId === template.template_id ? 'جارٍ الحفظ...' : template.is_active ? 'مفعلة' : 'متوقفة'}
              </button>
            </div>
          ))}
          {templates.length === 0 && <p className="text-sm text-gray-500">لم تُحمّل المكتبة بعد.</p>}
        </div>
      </section>

      <section className="rounded-xl border border-wattar-900 bg-dark-surface p-5">
        <h2 className="mb-3 font-semibold text-white">آخر عمولات الرسائل (Diamond)</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[460px] text-right text-sm">
            <thead className="text-xs text-gray-400"><tr>
              <th className="p-3">المضيفة</th><th className="p-3">العمولة</th><th className="p-3">التاريخ</th>
            </tr></thead>
            <tbody>
              {commissions.map((item) => (
                <tr key={item.transaction_id} className="border-t border-wattar-950">
                  <td className="p-3 text-white">@{item.username}</td>
                  <td className="p-3 text-cyan-300">{Number(item.amount_diamond).toLocaleString()} Diamond</td>
                  <td className="p-3 text-gray-400">{new Date(item.created_at).toLocaleString('ar')}</td>
                </tr>
              ))}
              {commissions.length === 0 && <tr><td className="p-4 text-center text-gray-500" colSpan={3}>لا توجد عمولات مسجلة.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function NumberField({ label, min, max, value, onChange }: {
  label: string;
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="space-y-1 text-xs text-gray-400">
      {label}
      <input type="number" min={min} max={max} step={1} value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full rounded-lg border border-wattar-900 bg-dark-bg px-3 py-2 text-sm text-white outline-none focus:border-wattar-500" />
    </label>
  );
}
