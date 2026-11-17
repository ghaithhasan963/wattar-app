import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Loader2, MessageCircle, RefreshCw, ShieldCheck, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { validateMessagingSettings, type MessagingSettings } from '@/lib/messagingSettings';
import { Toggle } from '@/components/ui';
import { UserPicker, type PickedUser } from '@/components/UserPicker';
import { ReasonPickerModal } from '@/components/ReasonPicker';

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

const hostAddReasons = [
  'تقدمت بطلب الانضمام واكتمل التحقق',
  'تحقق عمري مؤكد وموافقة على الشروط',
  'قرار إداري بعد المراجعة',
];

const hostSuspendReasons = [
  'طلبت إيقاف العضوية بنفسها',
  'مخالفة شروط برنامج المضيفات',
  'شكاوى متكررة من المستخدمين',
  'عدم نشاط لفترة طويلة',
];

const hostReactivateReasons = [
  'انتهت مدة الإيقاف',
  'قرار إداري بعد المراجعة',
];

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
  const [pickedUser, setPickedUser] = useState<PickedUser | null>(null);
  const [pickedAdultConfirmed, setPickedAdultConfirmed] = useState<boolean | null>(null);
  const [addReason, setAddReason] = useState(hostAddReasons[0]);
  const [membershipPicker, setMembershipPicker] = useState<{ user: HostProgramMember; active: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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

  // التحقق من تأكيد العمر للحساب المختار (شرط العضوية في برنامج المضيفات)
  useEffect(() => {
    if (!pickedUser) {
      setPickedAdultConfirmed(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data, error: checkError } = await supabase
          .from('users')
          .select('adult_confirmed_at')
          .eq('id', pickedUser.id)
          .maybeSingle();
        if (checkError) throw checkError;
        if (!cancelled) setPickedAdultConfirmed(data ? Boolean(data.adult_confirmed_at) : null);
      } catch {
        if (!cancelled) setPickedAdultConfirmed(null);
      }
    })();
    return () => { cancelled = true; };
  }, [pickedUser]);

  const changeMembership = async (userId: string, active: boolean, providedReason: string) => {
    if (providedReason.trim().length < 3) {
      toast.error('اختر سببًا واضحًا من الخيارات.');
      return;
    }
    setProcessingId(userId);
    try {
      const { error: actionError } = await supabase.rpc('admin_set_host_program_member', {
        p_user_id: userId,
        p_active: active,
        p_reason: providedReason.trim(),
      });
      if (actionError) throw actionError;
      toast.success(active ? 'أُضيفت المضيفة إلى برنامج المضيفات.' : 'أُوقفت عضوية المضيفة.');
      setPickedUser(null);
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
        <Toggle
          label="الرسائل الافتتاحية المجدولة من المضيفات"
          description="عند الإيقاف لا تُرسل أي افتتاحية جديدة، وتبقى المكتبة والسجلات محفوظة."
          checked={settings.host_outreach_enabled}
          onChange={(checked) => setSettings({ ...settings, host_outreach_enabled: checked })}
          disabled={saving || loading}
        />
        <button disabled={saving || loading} className="rounded-lg bg-wattar-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {saving ? <Loader2 className="inline animate-spin" size={16} /> : 'حفظ الإعدادات'}
        </button>
      </form>

      <section className="space-y-4 rounded-xl border border-wattar-900 bg-dark-surface p-5">
        <div>
          <h2 className="flex items-center gap-2 font-semibold text-white"><ShieldCheck size={18} className="text-emerald-300" /> أعضاء برنامج المضيفات</h2>
          <p className="mt-1 text-xs text-gray-400">هذه العضوية منفصلة عن توثيق الحساب. أضف حسابًا نشطًا ومؤكد العمر مع تسجيل سبب إداري.</p>
        </div>
        <div className="space-y-3">
          <UserPicker
            label="اختيار حساب لتعيينه مضيفة"
            description="ابحث بالاسم أو الهاتف واختر بضغطة واحدة — يجب أن يكون حسابًا نشطًا."
            value={pickedUser}
            onChange={setPickedUser}
          />
          {pickedUser && (
            <div className="space-y-3 rounded-lg border border-wattar-800 bg-dark-bg p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm text-white">
                <strong>{pickedUser.display_name || pickedUser.username}</strong>
                <span className="text-gray-400">@{pickedUser.username}</span>
                {pickedAdultConfirmed === null && <span className="text-gray-400">· جارٍ التحقق من العمر…</span>}
                {pickedAdultConfirmed === false && <span className="text-amber-300">· غير مؤكد العمر — لا يمكن التعيين</span>}
                {pickedUser.role && pickedUser.role !== 'user' && <span className="text-red-300">· دوره {pickedUser.role} وليس مستخدمًا عاديًا</span>}
              </div>
              <div>
                <p className="mb-2 text-sm font-medium text-gray-200">سبب التعيين (يُسجَّل في سجل الإدارة)</p>
                <div className="flex flex-wrap gap-2">
                  {hostAddReasons.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setAddReason(option)}
                      className={`rounded-xl border px-3 py-2 text-xs transition ${
                        addReason === option
                          ? 'border-wattar-400/50 bg-wattar-600/20 font-semibold text-white'
                          : 'border-white/[0.07] bg-white/[0.02] text-gray-300 hover:border-white/15'
                      }`}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>
              <button
                type="button"
                disabled={pickedAdultConfirmed !== true || (pickedUser.role ?? 'user') !== 'user' || processingId === pickedUser.id}
                onClick={() => void changeMembership(pickedUser.id, true, addReason)}
                className="flex items-center gap-2 rounded-lg bg-emerald-700 px-3 py-2 text-sm text-white disabled:opacity-50"
              >
                {processingId === pickedUser.id ? <Loader2 size={15} className="animate-spin" /> : <UserPlus size={15} />}
                تعيين كمضيفة
              </button>
            </div>
          )}
        </div>
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
                        onClick={() => setMembershipPicker({ user: host, active: host.status === 'active' ? false : true })}
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
        <h2 className="mb-3 font-semibold text-white">آخر عمولات الرسائل (Diamond)</h2>        <div className="overflow-x-auto">
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

      {membershipPicker && (
        <ReasonPickerModal
          title={membershipPicker.active ? 'إعادة تفعيل مضيفة' : 'إيقاف عضوية مضيفة'}
          subtitle={`${membershipPicker.user.display_name || membershipPicker.user.username} · @${membershipPicker.user.username}`}
          description={membershipPicker.active
            ? 'ستعود المضيفة لإرسال الافتتاحيات واستلام العمولات فوراً.'
            : 'يستمر صرف عمولاتها المستحقة، لكنها تتوقف عن إرسال افتتاحيات جديدة.'}
          options={membershipPicker.active ? hostReactivateReasons : hostSuspendReasons}
          confirmLabel={membershipPicker.active ? 'تأكيد إعادة التفعيل' : 'تأكيد الإيقاف'}
          tone={membershipPicker.active ? 'info' : 'warning'}
          processing={processingId === membershipPicker.user.user_id}
          onClose={() => { if (!processingId) setMembershipPicker(null); }}
          onSubmit={(reason) => {
            const picker = membershipPicker;
            setMembershipPicker(null);
            void changeMembership(picker.user.user_id, picker.active, reason);
          }}
        />
      )}
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
