/**
 * Wattar Admin — متجر المصادقة (Zustand)
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
}

export type StaffRole = 'admin' | 'super_admin' | 'agent';

interface StaffProfile {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  role: StaffRole;
  status: string;
}

async function loadStaffProfile(userId: string): Promise<StaffProfile> {
  const { data: profile, error } = await supabase
    .from('users')
    .select('id, username, display_name, avatar_url, role, status')
    .eq('id', userId)
    .single();

  if (error) {
    throw new Error(
      error.code === 'PGRST116'
        ? 'لم يُعثر على ملف هذا المستخدم في جدول users.'
        : `تعذر تحميل صلاحيات الحساب: ${error.message}`,
    );
  }
  if (!profile || !['admin', 'super_admin', 'agent'].includes(profile.role)) {
    throw new Error('هذا الحساب غير مخوّل بدخول لوحة الموظفين.');
  }
  if (profile.status !== 'active') {
    throw new Error('هذا الحساب موقوف.');
  }
  return profile as StaffProfile;
}

export const useAuthStore = create<AuthState>((set) => ({
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
      const credentials = isEmail
        ? { email: normalizedIdentifier.toLowerCase(), password }
        : { phone, password };
      const { data, error } = await supabase.auth.signInWithPassword(credentials);
      if (error) throw error;

      const profile = await loadStaffProfile(data.user.id);

      set({ session: data.session, user: data.user, profile, initialized: true });
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
}));
