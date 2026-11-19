/**
 * Wattar Admin — صفحة الموظفين والصلاحيات (M7.1)
 * - قائمة الموظفين المكلفين (admin_list_staff)
 * - منح/سحب/تغيير دور موظف مع سبب إلزامي (admin_grant_staff_role / admin_revoke_staff_role)
 * - مصفوفة صلاحيات الأدوار (admin_list_role_permissions / admin_set_role_permission)
 * - إدارة التحقق بخطوتين لحسابي (admin_totp_begin/confirm/verify/disable)
 */
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, ShieldCheck, KeyRound, Copy, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { STAFF_ROLE_LABELS, canAccess, useAuthStore } from '@/store/auth';
import { UserPicker, PickedUser } from '@/components/UserPicker';
import { ReasonPickerModal } from '@/components/ReasonPicker';
import { PageHeader, SectionCard, Badge, EmptyState, Segmented, SelectField, TextField } from '@/components/ui';

type StaffRoleKey = 'finance' | 'moderator' | 'support' | 'operations';

interface StaffRow {
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  staff_role: string;
  is_active: boolean;
  granted_at: string | null;
  granted_by_name: string | null;
  grant_reason: string | null;
  revoked_at: string | null;
  revoke_reason: string | null;
  totp_enabled: boolean;
}

interface MatrixRow {
  staff_role: string;
  permission: string;
  category: string;
  description: string;
  allowed: boolean;
}

const grantableRoles: Array<{ value: StaffRoleKey | 'super_admin'; label: string; hint?: string }> = [
  { value: 'finance', label: 'المالية' },
  { value: 'moderator', label: 'الإشراف' },
  { value: 'support', label: 'الدعم' },
  { value: 'operations', label: 'العمليات' },
  { value: 'super_admin', label: 'الإدارة العليا', hint: 'لحسابات users.role = super_admin فقط' },
];

const roleTone: Record<string, 'success' | 'info' | 'warning' | 'danger' | 'neutral'> = {
  super_admin: 'danger',
  finance: 'success',
  moderator: 'warning',
  support: 'info',
  operations: 'neutral',
};

const revokeReasonOptions = [
  'إنهاء تكليف الموظف',
  'نقل الموظف إلى قسم آخر',
  'مخالفة سياسات العمل',
  'استقالة الموظف',
  'مراجعة أمنية دورية',
];

const matrixReasonOptions = [
  'تعديل صلاحيات الدور حسب الحاجة التشغيلية',
  'توسيع صلاحيات الدور لمهام جديدة',
  'تضييق الصلاحيات لمراجعة أمنية',
  'تصحيح إعداد افتراضي غير مناسب',
];

const grantReasonOptions = [
  'تكليف موظف جديد بالوظيفة',
  'ترقية داخلية',
  'تغطية غياب موظف آخر',
  'إعادة تكليف بعد مراجعة',
];

export function StaffPage() {
  const profile = useAuthStore((state) => state.profile);
  const loadProfile = useAuthStore((state) => state.loadProfile);

  const canManage = canAccess(profile, 'staff.manage');
  const selfTotp = profile?.totp ?? { enabled: false, verified_recently: false };

  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // منح/تغيير دور
  const [grantTarget, setGrantTarget] = useState<PickedUser | null>(null);
  const [grantRole, setGrantRole] = useState<StaffRoleKey | 'super_admin'>('support');
  const [showGrantReason, setShowGrantReason] = useState(false);
  const [granting, setGranting] = useState(false);

  // سحب دور
  const [revokeTarget, setRevokeTarget] = useState<StaffRow | null>(null);
  const [revoking, setRevoking] = useState(false);

  // المصفوفة
  const [matrix, setMatrix] = useState<MatrixRow[]>([]);
  const [matrixLoading, setMatrixLoading] = useState(true);
  const [matrixSaving, setMatrixSaving] = useState<string | null>(null);
  const [pendingMatrixChange, setPendingMatrixChange] = useState<{ role: string; permission: string; allowed: boolean } | null>(null);
  const [matrixFilter, setMatrixFilter] = useState<'all' | 'granted' | 'denied'>('all');

  // TOTP
  const [totpSetup, setTotpSetup] = useState<{ secret_base32: string; otpauth_url: string } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [totpBusy, setTotpBusy] = useState(false);
  const [totpDisableReason, setTotpDisableReason] = useState<string | null>(null);

  const loadStaff = useCallback(async (showLoader = true) => {
    if (showLoader) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const { data, error: queryError } = await supabase.rpc('admin_list_staff');
      if (queryError) throw queryError;
      setStaff((data ?? []) as StaffRow[]);
    } catch (loadError: unknown) {
      const message = loadError instanceof Error ? loadError.message : 'تعذر تحميل قائمة الموظفين.';
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadMatrix = useCallback(async () => {
    setMatrixLoading(true);
    try {
      const { data, error: queryError } = await supabase.rpc('admin_list_role_permissions');
      if (queryError) throw queryError;
      setMatrix((data ?? []) as MatrixRow[]);
    } catch (loadError: unknown) {
      toast.error(loadError instanceof Error ? loadError.message : 'تعذر تحميل مصفوفة الصلاحيات.');
    } finally {
      setMatrixLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStaff();
    loadMatrix();
  }, [loadStaff, loadMatrix]);

  const activeStaff = useMemo(() => staff.filter((row) => row.is_active), [staff]);
  const inactiveStaff = useMemo(() => staff.filter((row) => !row.is_active), [staff]);

  const matrixByCategory = useMemo(() => {
    const filtered = matrix.filter((row) => {
      if (matrixFilter === 'granted') return row.allowed;
      if (matrixFilter === 'denied') return !row.allowed;
      return true;
    });
    const groups = new Map<string, MatrixRow[]>();
    for (const row of filtered) {
      const list = groups.get(row.category) ?? [];
      list.push(row);
      groups.set(row.category, list);
    }
    return Array.from(groups.entries());
  }, [matrix, matrixFilter]);

  const handleGrant = async (reason: string) => {
    if (!grantTarget) return;
    setGranting(true);
    try {
      const { error: rpcError } = await supabase.rpc('admin_grant_staff_role', {
        p_user_id: grantTarget.id,
        p_staff_role: grantRole,
        p_reason: reason,
      });
      if (rpcError) throw rpcError;
      toast.success(`تم تكليف ${grantTarget.username} بدور ${STAFF_ROLE_LABELS[grantRole] ?? grantRole}.`);
      setShowGrantReason(false);
      setGrantTarget(null);
      await loadStaff(false);
    } catch (grantError: unknown) {
      toast.error(grantError instanceof Error ? grantError.message : 'تعذر منح الدور.');
    } finally {
      setGranting(false);
    }
  };

  const handleRevoke = async (reason: string) => {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      const { error: rpcError } = await supabase.rpc('admin_revoke_staff_role', {
        p_user_id: revokeTarget.user_id,
        p_reason: reason,
      });
      if (rpcError) throw rpcError;
      toast.success(`تم سحب دور ${revokeTarget.username}.`);
      setRevokeTarget(null);
      await loadStaff(false);
    } catch (revokeError: unknown) {
      toast.error(revokeError instanceof Error ? revokeError.message : 'تعذر سحب الدور.');
    } finally {
      setRevoking(false);
    }
  };

  const handleMatrixChange = async (reason: string) => {
    if (!pendingMatrixChange) return;
    const { role, permission, allowed } = pendingMatrixChange;
    setMatrixSaving(`${role}:${permission}`);
    try {
      const { error: rpcError } = await supabase.rpc('admin_set_role_permission', {
        p_staff_role: role,
        p_permission: permission,
        p_allowed: allowed,
        p_reason: reason,
      });
      if (rpcError) throw rpcError;
      setMatrix((rows) => rows.map((row) => (
        row.staff_role === role && row.permission === permission ? { ...row, allowed } : row
      )));
      toast.success(`تم تحديث صلاحية «${permission}» لدور ${STAFF_ROLE_LABELS[role] ?? role}.`);
      setPendingMatrixChange(null);
    } catch (saveError: unknown) {
      toast.error(saveError instanceof Error ? saveError.message : 'تعذر تعديل المصفوفة.');
    } finally {
      setMatrixSaving(null);
    }
  };

  const handleTotpBegin = async () => {
    setTotpBusy(true);
    try {
      const { data, error: rpcError } = await supabase.rpc('admin_totp_begin');
      if (rpcError) throw rpcError;
      setTotpSetup(data as { secret_base32: string; otpauth_url: string });
      setTotpCode('');
      toast.info('أنشئنا سراً جديداً — أدخله في تطبيق المصادقة ثم أكّده بالرمز الحالي.');
    } catch (beginError: unknown) {
      toast.error(beginError instanceof Error ? beginError.message : 'تعذر بدء تفعيل التحقق بخطوتين.');
    } finally {
      setTotpBusy(false);
    }
  };

  const handleTotpConfirm = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(totpCode.trim())) {
      toast.error('أدخل رمزاً من 6 أرقام.');
      return;
    }
    setTotpBusy(true);
    try {
      const { error: rpcError } = await supabase.rpc('admin_totp_confirm', { p_code: totpCode.trim() });
      if (rpcError) throw rpcError;
      toast.success('تم تفعيل التحقق بخطوتين لحسابك.');
      setTotpSetup(null);
      setTotpCode('');
      await loadProfile();
    } catch (confirmError: unknown) {
      toast.error(confirmError instanceof Error ? confirmError.message : 'رمز غير صالح.');
    } finally {
      setTotpBusy(false);
    }
  };

  const handleTotpDisable = async (reason: string) => {
    setTotpBusy(true);
    try {
      const { error: rpcError } = await supabase.rpc('admin_totp_disable', {
        p_code: totpCode.trim(),
        p_reason: reason,
      });
      if (rpcError) throw rpcError;
      toast.success('تم تعطيل التحقق بخطوتين.');
      setTotpDisableReason(null);
      setTotpCode('');
      await loadProfile();
    } catch (disableError: unknown) {
      toast.error(disableError instanceof Error ? disableError.message : 'تعذر تعطيل التحقق بخطوتين.');
    } finally {
      setTotpBusy(false);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.info('تم النسخ.');
    } catch {
      toast.error('تعذر النسخ — انسخ النص يدوياً.');
    }
  };

  const renderStaffRow = (row: StaffRow) => (
    <tr key={row.user_id} className={row.is_active ? '' : 'opacity-50'}>
      <td className="px-3 py-2.5">
        <div className="text-sm font-medium text-gray-100">{row.display_name ?? row.username}</div>
        <div className="text-xs text-gray-500">@{row.username}</div>
      </td>
      <td className="px-3 py-2.5">
        <Badge tone={roleTone[row.staff_role] ?? 'neutral'}>
          {STAFF_ROLE_LABELS[row.staff_role] ?? row.staff_role}
        </Badge>
      </td>
      <td className="px-3 py-2.5">
        <Badge tone={row.is_active ? 'success' : 'neutral'}>{row.is_active ? 'نشط' : 'مسحوب'}</Badge>
      </td>
      <td className="px-3 py-2.5">
        <Badge tone={row.totp_enabled ? 'success' : 'warning'}>
          {row.totp_enabled ? '2FA مفعّل' : 'بلا 2FA'}
        </Badge>
      </td>
      <td className="px-3 py-2.5 text-xs text-gray-400">
        {row.is_active ? (
          <div>
            <div>{row.granted_by_name ? `بواسطة ${row.granted_by_name}` : '—'}</div>
            {row.granted_at ? <div className="text-gray-500">{new Date(row.granted_at).toLocaleString('ar')}</div> : null}
            {row.grant_reason ? <div className="mt-0.5 text-gray-500">السبب: {row.grant_reason}</div> : null}
          </div>
        ) : (
          <div>
            {row.revoked_at ? <div className="text-gray-500">{new Date(row.revoked_at).toLocaleString('ar')}</div> : null}
            {row.revoke_reason ? <div className="text-gray-500">السبب: {row.revoke_reason}</div> : null}
          </div>
        )}
      </td>
      <td className="px-3 py-2.5 text-left">
        {row.is_active && canManage && row.staff_role !== 'super_admin' ? (
          <button
            type="button"
            onClick={() => setRevokeTarget(row)}
            className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-300 transition hover:bg-red-500/20"
          >
            سحب الدور
          </button>
        ) : row.is_active && canManage && row.staff_role === 'super_admin' ? (
          <span className="text-xs text-gray-600" title="حسابات الإدارة العليا محصّنة من السحب">محصّن</span>
        ) : (
          canManage && row.staff_role !== 'super_admin' ? (
            <button
              type="button"
              onClick={() => {
                setGrantTarget({
                  id: row.user_id,
                  username: row.username,
                  display_name: row.display_name,
                  phone: null,
                  role: null,
                  status: null,
                });
                setGrantRole((row.staff_role as StaffRoleKey) ?? 'support');
                setShowGrantReason(true);
              }}
              className="rounded-lg border border-wattar-500/30 bg-wattar-500/10 px-3 py-1.5 text-xs font-medium text-wattar-300 transition hover:bg-wattar-500/20"
            >
              إعادة تكليف
            </button>
          ) : null
        )}
      </td>
    </tr>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="الموظفون والصلاحيات"
        subtitle="إدارة أدوار طاقم الإدارة (المالية، الإشراف، الدعم، العمليات) وصلاحيات كل دور والتحقق بخطوتين."
        actions={
          <button
            type="button"
            onClick={() => { loadStaff(false); loadMatrix(); }}
            className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-gray-300 transition hover:border-white/20"
            disabled={refreshing || matrixLoading}
          >
            <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
            تحديث
          </button>
        }
      />

      {/* قسم التحقق بخطوتين لحسابي */}
      <SectionCard
        title="التحقق بخطوتين (حسابي)"
        description="طبقة حماية إضافية لحسابك الإداري عبر تطبيق مصادقة (Google Authenticator أو ما يعادله)."
        icon={KeyRound}
      >
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={selfTotp.enabled ? 'success' : 'warning'}>
            {selfTotp.enabled ? 'مفعّل' : 'غير مفعّل'}
          </Badge>
          {selfTotp.enabled ? (
            <Badge tone={selfTotp.verified_recently ? 'success' : 'danger'}>
              {selfTotp.verified_recently ? 'الجلسة موثقة' : 'يلزم رمز تحقق'}
            </Badge>
          ) : null}
          {profile?.totpRequired ? (
            <span className="text-xs text-gray-500">الإلزام العام مفعّل في إعدادات المنصة.</span>
          ) : null}
        </div>

        {!selfTotp.enabled && !totpSetup ? (
          <div>
            <p className="mt-3 text-sm text-gray-400">
              يُنشئ النظام سراً سرياً تُدخله في تطبيق المصادقة، ثم يؤكَّد التفعيل بأول رمز من 6 أرقام.
            </p>
            <button
              type="button"
              onClick={handleTotpBegin}
              disabled={totpBusy}
              className="mt-3 flex items-center gap-2 rounded-xl bg-wattar-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-wattar-500 disabled:opacity-50"
            >
              {totpBusy ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />}
              بدء التفعيل
            </button>
          </div>
        ) : null}

        {totpSetup ? (
          <form onSubmit={handleTotpConfirm} className="mt-4 space-y-3">
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <p className="text-xs text-gray-500">أدخل هذا السر في تطبيق المصادقة (أو افتح الرابط من جهاز يحمل التطبيق):</p>
              <div className="mt-2 flex items-center gap-2">
                <code className="flex-1 break-all rounded-lg bg-black/40 px-3 py-2 text-sm text-wattar-300" dir="ltr">{totpSetup.secret_base32}</code>
                <button type="button" onClick={() => copy(totpSetup.secret_base32)} className="rounded-lg border border-white/10 p-2 text-gray-400 hover:text-gray-200" aria-label="نسخ السر">
                  <Copy size={14} />
                </button>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <code className="flex-1 break-all rounded-lg bg-black/40 px-3 py-2 text-[11px] text-gray-400" dir="ltr">{totpSetup.otpauth_url}</code>
                <button type="button" onClick={() => copy(totpSetup.otpauth_url)} className="rounded-lg border border-white/10 p-2 text-gray-400 hover:text-gray-200" aria-label="نسخ الرابط">
                  <Copy size={14} />
                </button>
              </div>
            </div>
            <TextField
              label="رمز التأكيد (6 أرقام)"
              value={totpCode}
              onChange={setTotpCode}
              placeholder="123456"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={totpBusy}
                className="flex items-center gap-2 rounded-xl bg-wattar-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-wattar-500 disabled:opacity-50"
              >
                {totpBusy ? <Loader2 size={15} className="animate-spin" /> : null}
                تأكيد التفعيل
              </button>
              <button
                type="button"
                onClick={() => setTotpSetup(null)}
                disabled={totpBusy}
                className="rounded-xl border border-white/10 px-4 py-2 text-sm text-gray-400 transition hover:border-white/20"
              >
                إلغاء
              </button>
            </div>
          </form>
        ) : null}

        {selfTotp.enabled && !selfTotp.verified_recently ? (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!/^\d{6}$/.test(totpCode.trim())) {
                toast.error('أدخل رمزاً من 6 أرقام.');
                return;
              }
              setTotpBusy(true);
              try {
                const { error: rpcError } = await supabase.rpc('admin_totp_verify', { p_code: totpCode.trim() });
                if (rpcError) throw rpcError;
                toast.success('تم توثيق الجلسة لثلاثين دقيقة.');
                setTotpCode('');
                await loadProfile();
              } catch (verifyError: unknown) {
                toast.error(verifyError instanceof Error ? verifyError.message : 'رمز غير صالح.');
              } finally {
                setTotpBusy(false);
              }
            }}
            className="mt-4 flex flex-wrap items-end gap-3"
          >
            <div className="min-w-[200px] flex-1">
              <TextField
                label="رمز التحقق (6 أرقام)"
                value={totpCode}
                onChange={setTotpCode}
                placeholder="123456"
              />
            </div>
            <button
              type="submit"
              disabled={totpBusy}
              className="flex items-center gap-2 rounded-xl bg-wattar-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-wattar-500 disabled:opacity-50"
            >
              {totpBusy ? <Loader2 size={15} className="animate-spin" /> : null}
              توثيق الجلسة
            </button>
          </form>
        ) : null}

        {selfTotp.enabled ? (
          <div className="mt-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[200px] flex-1">
                <TextField
                  label="رمز التحقق لتأكيد التعطيل"
                  value={totpCode}
                  onChange={setTotpCode}
                  placeholder="123456"
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!/^\d{6}$/.test(totpCode.trim())) {
                    toast.error('أدخل رمزاً من 6 أرقام أولاً.');
                    return;
                  }
                  setTotpDisableReason('modal');
                }}
                disabled={totpBusy}
                className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-300 transition hover:bg-red-500/20 disabled:opacity-50"
              >
                تعطيل التحقق بخطوتين
              </button>
            </div>
          </div>
        ) : null}
      </SectionCard>

      {/* منح دور */}
      {canManage ? (
        <SectionCard
          title="تكليف موظف جديد"
          description="اختر حساباً نشطاً (مستخدم/دعم/إدارة) ودوراً وظيفياً — يُسجَّل التكليف في سجل الإدارة مع السبب."
          icon={Plus}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <UserPicker
              label="الحساب"
              description="ابحث بالاسم أو الهاتف. لا يمكن تكليف المضيفات والوكلاء ومديري الوكالات."
              value={grantTarget}
              onChange={(user) => setGrantTarget(user)}
            />
            <div>
              <span className="mb-1.5 block text-sm font-medium text-gray-200">الدور الوظيفي</span>
              <Segmented
                options={grantableRoles}
                value={grantRole}
                onChange={(value) => setGrantRole(value)}
                columns={3}
              />
            </div>
          </div>
          <button
            type="button"
            disabled={!grantTarget || granting}
            onClick={() => setShowGrantReason(true)}
            className="mt-4 flex items-center gap-2 rounded-xl bg-wattar-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-wattar-500 disabled:opacity-50"
          >
            {granting ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />}
            متابعة التكليف
          </button>
        </SectionCard>
      ) : null}

      {/* قائمة الموظفين */}
      <SectionCard
        title={`الموظفون النشطون (${activeStaff.length})`}
        description="كل موظف واحد له دور واحد. حسابات الإدارة العليا محصّنة ولا تُسحب."
        icon={ShieldCheck}
      >
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-gray-400">
            <Loader2 size={16} className="animate-spin" /> جاري التحميل…
          </div>
        ) : error ? (
          <EmptyState title="تعذر تحميل الموظفين" description={error} />
        ) : activeStaff.length === 0 ? (
          <EmptyState title="لا موظفين بعد" description="استخدم قسم «تكليف موظف جديد» أعلاه." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-right">
              <thead>
                <tr className="border-b border-white/[0.06] text-xs text-gray-500">
                  <th className="px-3 py-2 text-right font-medium">الموظف</th>
                  <th className="px-3 py-2 text-right font-medium">الدور</th>
                  <th className="px-3 py-2 text-right font-medium">الحالة</th>
                  <th className="px-3 py-2 text-right font-medium">2FA</th>
                  <th className="px-3 py-2 text-right font-medium">تفاصيل التكليف</th>
                  <th className="px-3 py-2 text-right font-medium">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">{activeStaff.map(renderStaffRow)}</tbody>
            </table>
          </div>
        )}

        {inactiveStaff.length > 0 ? (
          <details className="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
            <summary className="cursor-pointer text-sm text-gray-400">سجل التكاليف المسحوبة ({inactiveStaff.length})</summary>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[640px] text-right">
                <thead>
                  <tr className="border-b border-white/[0.06] text-xs text-gray-500">
                    <th className="px-3 py-2 text-right font-medium">الموظف</th>
                    <th className="px-3 py-2 text-right font-medium">آخر دور</th>
                    <th className="px-3 py-2 text-right font-medium">الحالة</th>
                    <th className="px-3 py-2 text-right font-medium">2FA</th>
                    <th className="px-3 py-2 text-right font-medium">تفاصيل السحب</th>
                    <th className="px-3 py-2 text-right font-medium">إجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">{inactiveStaff.map(renderStaffRow)}</tbody>
              </table>
            </div>
          </details>
        ) : null}
      </SectionCard>

      {/* مصفوفة الصلاحيات */}
      <SectionCard
        title="مصفوفة صلاحيات الأدوار"
        description="دور الإدارة العليا يملك كل الصلاحيات دائماً ولا يُعدَّل. التعديل على الأدوار الأربعة يُسجَّل في سجل الإدارة."
        icon={ShieldCheck}
      >
        <div className="mb-4 max-w-xs">
          <SelectField
            label="تصفية"
            value={matrixFilter}
            onChange={(value) => setMatrixFilter(value as 'all' | 'granted' | 'denied')}
            options={[
              { label: 'كل الصلاحيات', value: 'all' },
              { label: 'الممنوحة فقط', value: 'granted' },
              { label: 'الممنوعة فقط', value: 'denied' },
            ]}
          />
        </div>

        {matrixLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-gray-400">
            <Loader2 size={16} className="animate-spin" /> جاري التحميل…
          </div>
        ) : matrixByCategory.length === 0 ? (
          <EmptyState title="لا نتائج" description="جرّب تغيير التصفية." />
        ) : (
          <div className="space-y-4">
            {matrixByCategory.map(([category, rows]) => {
              const permissions = Array.from(new Set(rows.map((row) => row.permission)));
              const roleKeys: StaffRoleKey[] = ['finance', 'moderator', 'support', 'operations'];
              return (
                <div key={category} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                  <h4 className="mb-2 text-sm font-semibold text-gray-200">{category}</h4>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] text-right">
                      <thead>
                        <tr className="text-xs text-gray-500">
                          <th className="px-2 py-1.5 text-right font-medium">الصلاحية</th>
                          {roleKeys.map((role) => (
                            <th key={role} className="px-2 py-1.5 text-center font-medium">{STAFF_ROLE_LABELS[role]}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/[0.04]">
                        {permissions.map((permission) => (
                          <tr key={permission}>
                            <td className="px-2 py-1.5">
                              <div className="text-sm text-gray-200" dir="ltr">{permission}</div>
                              <div className="text-[11px] text-gray-500">
                                {rows.find((row) => row.permission === permission)?.description}
                              </div>
                            </td>
                            {roleKeys.map((role) => {
                              const row = rows.find((item) => item.staff_role === role && item.permission === permission);
                              const allowed = row?.allowed ?? false;
                              const saving = matrixSaving === `${role}:${permission}`;
                              return (
                                <td key={role} className="px-2 py-1.5 text-center">
                                  <button
                                    type="button"
                                    disabled={!canManage || saving}
                                    title={canManage ? (allowed ? 'اضغط للسحب مع سبب' : 'اضغط للمنح مع سبب') : 'التعديل للإدارة العليا فقط'}
                                    onClick={() => setPendingMatrixChange({ role, permission, allowed: !allowed })}
                                    className={canManage
                                      ? 'rounded-full px-3 py-1 text-[11px] font-medium transition'
                                      : 'cursor-default rounded-full px-3 py-1 text-[11px] font-medium'}
                                    style={
                                      allowed
                                        ? { backgroundColor: 'rgba(34,197,94,0.15)', color: '#86efac', border: '1px solid rgba(34,197,94,0.3)' }
                                        : { backgroundColor: 'rgba(255,255,255,0.03)', color: '#6b7280', border: '1px solid rgba(255,255,255,0.08)' }
                                    }
                                  >
                                    {saving ? <Loader2 size={11} className="mx-auto animate-spin" /> : allowed ? 'ممنوحة' : 'ممنوعة'}
                                  </button>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      {/* نوافذ الأسباب */}
      {showGrantReason && grantTarget ? (
        <ReasonPickerModal
          title={`تكليف ${grantTarget.display_name ?? grantTarget.username}`}
          subtitle={`الدور: ${STAFF_ROLE_LABELS[grantRole] ?? grantRole}`}
          description="سيُسجَّل التكليف في سجل الإدارة مع السبب. لا يمكن تغيير دورك بنفسك."
          options={grantReasonOptions}
          confirmLabel="تنفيذ التكليف"
          tone="info"
          processing={granting}
          onClose={() => setShowGrantReason(false)}
          onSubmit={(reason) => handleGrant(reason)}
        />
      ) : null}

      {revokeTarget ? (
        <ReasonPickerModal
          title={`سحب دور ${revokeTarget.display_name ?? revokeTarget.username}`}
          subtitle={`الدور الحالي: ${STAFF_ROLE_LABELS[revokeTarget.staff_role] ?? revokeTarget.staff_role}`}
          description="سيفقد الموظف صلاحياته فوراً ويُسجَّل السحب في سجل الإدارة."
          options={revokeReasonOptions}
          confirmLabel="تنفيذ السحب"
          tone="danger"
          processing={revoking}
          showNote
          onClose={() => setRevokeTarget(null)}
          onSubmit={(reason) => handleRevoke(reason)}
        />
      ) : null}

      {pendingMatrixChange ? (
        <ReasonPickerModal
          title={`${pendingMatrixChange.allowed ? 'منح' : 'سحب'} صلاحية`}
          subtitle={`${pendingMatrixChange.permission} — ${STAFF_ROLE_LABELS[pendingMatrixChange.role] ?? pendingMatrixChange.role}`}
          description="تغييرات المصفوفة تنطبق على كل موظفي هذا الدور فوراً."
          options={matrixReasonOptions}
          confirmLabel={pendingMatrixChange.allowed ? 'منح الصلاحية' : 'سحب الصلاحية'}
          tone={pendingMatrixChange.allowed ? 'info' : 'warning'}
          processing={matrixSaving !== null}
          onClose={() => setPendingMatrixChange(null)}
          onSubmit={(reason) => handleMatrixChange(reason)}
        />
      ) : null}

      {totpDisableReason ? (
        <ReasonPickerModal
          title="تعطيل التحقق بخطوتين"
          subtitle="سيُطلب منك رمز صحيح في حقل الرمز أعلاه لتأكيد التعطيل"
          description="سيُسجَّل التعطيل في سجل الإدارة. عند تفعيل الإلزام العام لاحقاً ستُحجب الإجراءات المالية الحساسة حتى إعادة التفعيل."
          options={[
            'استبدال جهاز المصادقة',
            'فقدان جهاز المصادقة',
            'قرار إداري مؤقت',
          ]}
          confirmLabel="تعطيل الحماية"
          tone="danger"
          processing={totpBusy}
          onClose={() => setTotpDisableReason(null)}
          onSubmit={(reason) => handleTotpDisable(reason)}
        />
      ) : null}
    </div>
  );
}
