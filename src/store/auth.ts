/**
 * Wattar App — متجر المصادقة
 */
import { create } from 'zustand';
import { Session, User } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from '@/lib/supabase';

let authSubscription: { unsubscribe: () => void } | null = null;

interface UserProfile {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  role: string;
  status: string;
  balance_gold: number;
  balance_diamond: number;
  total_deposited: number;
  total_withdrawn: number;
  total_wagered: number;
  total_won: number;
  total_gifts_sent: number;
  total_gifts_received: number;
  referral_code: string;
  preferred_language: string;
}

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: UserProfile | null;
  initialized: boolean;
  loading: boolean;
  error: string | null;

  init: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithFacebook: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string) => Promise<boolean>;
  signInWithPhone: (phone: string) => Promise<void>;
  verifyOtp: (phone: string, code: string) => Promise<void>;
  signInAsGuest: () => Promise<void>;
  signOut: () => Promise<void>;
  loadProfile: () => Promise<void>;
  updateProfile: (input: {
    username: string;
    displayName: string;
    bio: string;
    avatarUrl: string | null;
  }) => Promise<void>;
  updateBalance: (gold: number, diamond: number) => void;
}

async function signInWithOAuthProvider(
  provider: 'google' | 'facebook',
): Promise<void> {
  const redirectTo = Linking.createURL('callback');
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo,
      skipBrowserRedirect: true,
    },
  });
  if (error) throw error;
  if (!data.url) throw new Error('لم يُرجع Supabase رابط تسجيل الدخول');

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success') return;

  const callbackUrl = new URL(result.url);
  const authError = callbackUrl.searchParams.get('error_description');
  if (authError) throw new Error(authError);

  const code = callbackUrl.searchParams.get('code');
  if (!code) throw new Error('لم يصل رمز تسجيل الدخول من مزود الحساب');

  const { data: sessionData, error: sessionError } =
    await supabase.auth.exchangeCodeForSession(code);
  if (sessionError) throw sessionError;

  const { session, user } = sessionData;
  useAuthStore.setState({ session, user });
  await useAuthStore.getState().loadProfile();
}

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  user: null,
  profile: null,
  initialized: false,
  loading: false,
  error: null,

  init: async () => {
    if (!authSubscription) {
      authSubscription = supabase.auth.onAuthStateChange((_event, newSession) => {
        set({ session: newSession, user: newSession?.user ?? null });
        if (newSession) {
          set({ error: null });
          setTimeout(() => {
            get().loadProfile().catch((err: unknown) => {
              set({
                profile: null,
                error: err instanceof Error
                  ? err.message
                  : 'تعذر تحميل ملف المستخدم',
              });
            });
          }, 0);
        } else {
          set({ profile: null, error: null, initialized: true });
        }
      }).data.subscription;
    }

    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      if (error) throw error;
      set({ session, user: session?.user ?? null });

      if (session) {
        try {
          await get().loadProfile();
        } catch (profileError: unknown) {
          set({
            profile: null,
            error: profileError instanceof Error
              ? profileError.message
              : 'تعذر تحميل ملف المستخدم',
          });
        }
      } else {
        set({ profile: null, error: null });
      }
      set({ initialized: true });
    } catch (err: unknown) {
      set({
        initialized: true,
        error: err instanceof Error
          ? err.message
          : 'تعذر تهيئة جلسة تسجيل الدخول',
      });
    }
  },

  signInWithGoogle: async () => {
    set({ loading: true, error: null });
    try {
      await signInWithOAuthProvider('google');
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : 'تعذر تسجيل الدخول باستخدام Google' });
    } finally {
      set({ loading: false });
    }
  },

  signInWithFacebook: async () => {
    set({ loading: true, error: null });
    try {
      await signInWithOAuthProvider('facebook');
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : 'تعذر تسجيل الدخول باستخدام Facebook' });
    } finally {
      set({ loading: false });
    }
  },

  signInWithEmail: async (email, password) => {
    set({ loading: true, error: null });
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;
      set({ session: data.session, user: data.user });
      await get().loadProfile();
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : 'تعذر تسجيل الدخول بالبريد الإلكتروني' });
      throw err;
    } finally {
      set({ loading: false });
    }
  },

  signUpWithEmail: async (email, password) => {
    set({ loading: true, error: null });
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: Linking.createURL('callback'),
        },
      });
      if (error) throw error;
      if (!data.session || !data.user) return true;

      set({ session: data.session, user: data.user });
      await get().loadProfile();
      return false;
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : 'تعذر إنشاء الحساب' });
      throw err;
    } finally {
      set({ loading: false });
    }
  },

  signInWithPhone: async (phone: string) => {
    set({ loading: true, error: null });
    try {
      const { error } = await supabase.auth.signInWithOtp({
        phone,
        options: { channel: 'sms' },
      });
      if (error) throw error;
    } catch (err: any) {
      set({ error: err.message });
      throw err;
    } finally {
      set({ loading: false });
    }
  },

  verifyOtp: async (phone: string, code: string) => {
    set({ loading: true, error: null });
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        phone,
        token: code,
        type: 'sms',
      });
      if (error) throw error;
      set({ session: data.session, user: data.user });
      await get().loadProfile();
    } catch (err: any) {
      set({ error: err.message });
      throw err;
    } finally {
      set({ loading: false });
    }
  },

  signInAsGuest: async () => {
    set({ loading: true, error: null });
    try {
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error) throw error;
      set({ session: data.session, user: data.user });
      await get().loadProfile();
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : 'تعذر تسجيل الدخول كزائر' });
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
    const { session } = get();
    if (!session?.user) return;

    // محاولة جلب البروفايل، إن لم يوجد → إنشاؤه
    const { data: existing, error: profileError } = await supabase
      .from('users')
      .select('*')
      .eq('id', session.user.id)
      .maybeSingle();

    if (profileError) throw profileError;

    if (existing) {
      set({ profile: existing as UserProfile });
    } else {
      throw new Error(
        'تم تسجيل الدخول لكن ملف المستخدم غير موجود. يلزم تطبيق patch_auth_profile_trigger.sql على قاعدة البيانات ثم إعادة المحاولة.',
      );
    }
  },

  updateProfile: async ({ username, displayName, bio, avatarUrl }) => {
    const { profile } = get();
    if (!profile) throw new Error('يجب تسجيل الدخول قبل تعديل الملف الشخصي');

    const { data, error } = await supabase.rpc('update_my_profile', {
      p_username: username,
      p_display_name: displayName,
      p_bio: bio,
      p_avatar_url: avatarUrl,
    });

    if (error) throw error;
    const updatedProfile = Array.isArray(data) ? data[0] : data;
    if (!updatedProfile) throw new Error('لم يتم إرجاع بيانات الملف الشخصي بعد التحديث');

    set({ profile: updatedProfile as UserProfile });
  },

  updateBalance: (gold, diamond) => {
    const { profile } = get();
    if (!profile) return;
    set({
      profile: {
        ...profile,
        balance_gold: gold,
        balance_diamond: diamond,
      },
    });
  },
}));
