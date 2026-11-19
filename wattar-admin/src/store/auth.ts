/**
 * Wattar Admin — متجر المصادقة (Zustand)
 * M7.1: ملف الموظف يجمع الدور القديم (users.role) مع دور الموظف
 * ومصفوفة صلاحيات RBAC وحالة التحقق بخطوتين (TOTP).
 */
import { create } from 'zustand';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: StaffProfile | null;
  initialized: boolean;
  loading: boolean;
  error: string | null;
  initialize: () => Promise<void>;
  signIn: (identifier: string, password: string) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  loadProfile: () => Promise<void>;
  verifyTotp: (code: string) => Promise<void>;
}

export type StaffRole = 'admin' | 'super_admin' | 'agent' | 'agency_manager' | 'support' | 'user';

export interface StaffTotpState {
  enabled: boolean;
  verified_recently: boolean;
}

export interface StaffProfile {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  role: StaffRole;
  status: string;
  /** دور الموظف في نظام RBAC (null = حساب بلا تكليف موظف) */
  staffRole: string | null;
  /** صلاحيات الدور من المصفوفة (فارغة للإدارة العليا = كل شيء) */
  permissions: Record<string, boolean>;
  totp: StaffTotpState;
  totpRequired: boolean;
}

interface StaffProfileRpc {
  staff_role: string;
  permissions: Record<string, boolean>;
  totp: { enabled: boolean; verified_recently: boolean };
  totp_required: boolean;
}

/**
 * بوابة صلاحية موحّدة للوحة:
 * - الموظف المفعّل: من مصفوفة أدواره (الإدارة العليا = كل الصلاحيات).
 * - حساب بلا تكليف: توافق المسار القديم (admin/super_admin كامل،
 *   support يرى الدعم فقط).
 */
export function canAccess(profile: StaffProfile | null, permission?: string): boolean {
  if (!permission) return true;
  if (!profile) return false;
  if (profile.staffRole) {
    return profile.staffRole === 'super_admin' || Boolean(profile.permissions[permission]);
  }
  if (profile.role === 'support') return permission === 'support.view';
  return ['admin', 'super_admin'].includes(profile.role);
}

export const STAFF_ROLE_LABELS: Record<string, string> = {
  super_admin: 'الإدارة العليا',
  finance: 'المالية',
  moderator: 'الإشراف',
  support: 'الدعم',
  operations: 'العمليات',
};

async function loadStaffProfile(userId: string): Promise<StaffProfile> {
  const [usersResult, staffResult] = await Promise.all([
    supabase
      .from('users')
      .select('id, username, display_name, avatar_url, role, status')
      .eq('id', userId)
      .single(),
    supabase.rpc('admin_my_staff_profile'),
  ]);

  const { data: profile, error } = usersResult;
  if (error) {
    throw new Error(
      error.code === 'PGRST116'
        ? 'لم يُعثر على ملف هذا المستخدم في جدول users.'
        : `تعذر تحميل صلاحيات الحساب: ${error.message}`,
    );
  }

  const staff = (staffResult.error ? null : staffResult.data) as StaffProfileRpc | null;
  const legacyAllowed = ['admin', 'super_admin', 'agent', 'agency_manager', 'support'].includes(profile.role);
  if (!legacyAllowed && !staff?.staff_role) {
    throw new Error('هذا الحساب غير مخوّل بدخول لوحة الموظفين.');
  }
  if (profile.status !== 'active') {
    throw new Error('هذا الحساب موقوف.');
  }

  return {
    ...profile,
    role: profile.role as StaffRole,
    staffRole: staff?.staff_role ?? null,
    permissions: staff?.permissions ?? {},
    totp: staff?.totp ?? { enabled: false, verified_recently: false },
    totpRequired: staff?.totp_required ?? false,
  };
}

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  user: null,
  profile: null,
  initialized: false,
  loading: false,
  error: null,

  initialize: async () => {
    set({ loading: true, error: null });
    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      if (error) throw error;
      if (!session) {
        set({ session: null, user: null, profile: null });
        return;
      }

      const profile = await loadStaffProfile(session.user.id);
      set({ session, user: session.user, profile });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'تعذر التحقق من حساب الإدارة.';
      await supabase.auth.signOut();
      set({ session: null, user: null, profile: null, error: message });
    } finally {
      set({ initialized: true, loading: false });
    }
  },

  signIn: async (identifier, password) => {
    set({ loading: true, error: null });
    try {
      const normalizedIdentifier = identifier.trim();
      const isEmail = normalizedIdentifier.includes('@');
      const phone = normalizedIdentifier.replace(/[()\s-]/g, '');
      if (!isEmail && !/^\+[1-9]\d{6,14}$/.test(phone)) {
        throw new Error('أدخل بريدًا إلكترونيًا صحيحًا أو رقم هاتف دوليًا يبدأ بـ +.');
      }
      let session: Session;
      let user: User;

      if (isEmail) {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: normalizedIdentifier.toLowerCase(),
          password,
        });
        if (error) throw error;
        session = data.session;
        user = data.user;
      } else {
        const { data, error } = await supabase.functions.invoke<{
          access_token: string;
          refresh_token: string;
        }>('agent-phone-login', { body: { phone, password } });

        if (error) {
          const status = 'context' in error && error.context instanceof Response
            ? error.context.status
            : undefined;
          if (status === 401) {
            throw new Error('بيانات الدخول غير صحيحة أو الحساب غير نشط.');
          }
          if (status === 429) {
            throw new Error('محاولات كثيرة. حاول مجددًا بعد قليل.');
          }
          throw new Error('تعذر الاتصال بخدمة تسجيل الدخول. تحقق من اتصالك وحاول مجددًا.');
        }
        if (!data?.access_token || !data.refresh_token) {
          throw new Error('تعذر إكمال تسجيل الدخول برقم الهاتف.');
        }

        const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
        });
        if (sessionError) throw sessionError;
        if (!sessionData.session || !sessionData.user) {
          throw new Error('تعذر إكمال تسجيل الدخول برقم الهاتف.');
        }
        session = sessionData.session;
        user = sessionData.user;
      }

      const profile = await loadStaffProfile(user.id);
      set({ session, user, profile, initialized: true });
    } catch (err: unknown) {
      await supabase.auth.signOut();
      const message = err instanceof Error ? err.message : 'تعذر تسجيل الدخول إلى لوحة الإدارة.';
      set({ session: null, user: null, profile: null, initialized: true, error: message });
      throw err;
    } finally {
      set({ loading: false });
    }
  },

  requestPasswordReset: async (email) => {
    set({ loading: true, error: null });
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'تعذر إرسال رابط إعادة تعيين كلمة المرور.';
      set({ error: message });
      throw err;
    } finally {
      set({ loading: false });
    }
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ session: null, user: null, profile: null, error: null });
  },

  loadProfile: async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const profile = await loadStaffProfile(session.user.id);
    set({ session, user: session.user, profile });
  },

  verifyTotp: async (code) => {
    const { error } = await supabase.rpc('admin_totp_verify', { p_code: code.trim() });
    if (error) throw new Error(error.message);
    await get().loadProfile();
  },
}));
