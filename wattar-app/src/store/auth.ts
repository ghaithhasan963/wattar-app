/**
 * Wattar App — متجر المصادقة
 */
import { create } from 'zustand';
import { Session, User } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { callFunction, supabase } from '@/lib/supabase';
import { clearPushRegistrationOnSignOut } from '@/lib/notifications';
import { describeDevice } from '@/lib/device';

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
  game_points: number;
  experience_points: number;
  level: number;
  adult_confirmed_at: string | null;
  total_deposited: number;
  total_withdrawn: number;
  total_wagered: number;
  total_won: number;
  total_gifts_sent: number;
  total_gifts_received: number;
  referral_code: string;
  preferred_language: string;
  gender: 'female' | 'male' | 'other' | null;
  profile_visibility: 'public' | 'friends';
  onboarding_completed_at: string | null;
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
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string) => Promise<boolean>;
  signInWithPhone: (phone: string) => Promise<void>;
  verifyOtp: (phone: string, code: string) => Promise<void>;
  signOut: (scope?: 'global' | 'local' | 'others') => Promise<void>;
  loadProfile: () => Promise<void>;
  completeOnboarding: (input: {
    gender: 'female' | 'male' | 'other';
    birthDate: string;
    profileVisibility: 'public' | 'friends';
  }) => Promise<void>;
  updateProfileVisibility: (visibility: 'public' | 'friends') => Promise<void>;
  updateProfile: (input: {
    username: string;
    displayName: string;
    bio: string;
    avatarUrl: string | null;
  }) => Promise<void>;
  updateBalance: (gold: number, diamond: number) => void;
}

async function signInWithOAuthProvider(provider: 'google'): Promise<void> {
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
  await recordSessionStarted();
}

async function recordSessionStarted(): Promise<void> {
  try {
    const device = await describeDevice();
    const { error } = await supabase.rpc('record_my_session_started', {
      p_device_id: device.deviceId,
      p_device_info: device.deviceInfo,
      p_user_agent: device.userAgent,
    });
    if (error) console.warn('[Wattar] Failed to record authenticated session:', error.message);
  } catch (error: unknown) {
    console.warn('[Wattar] Failed to record authenticated session:', error);
  }
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
        if (newSession?.user.is_anonymous) {
          set({
            session: null,
            user: null,
            profile: null,
            error: 'الحسابات المجهولة غير مدعومة. سجّل الدخول بحسابك للمتابعة.',
          });
          void supabase.auth.signOut({ scope: 'local' }).then(({ error }) => {
            if (error) console.warn('[Wattar] Failed to clear an anonymous session:', error);
          }).catch((error: unknown) => {
            console.warn('[Wattar] Failed to clear an anonymous session:', error);
          });
          return;
        }
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
      if (session?.user.is_anonymous) {
        const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' });
        if (signOutError) throw signOutError;
        set({ session: null, user: null, profile: null, error: null });
      } else {
        set({ session, user: session?.user ?? null });
      }

      if (session && !session.user.is_anonymous) {
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
      await recordSessionStarted();
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
      const result = await callFunction<{
        confirmation_required: boolean;
        session: Session | null;
        user: User | null;
      }>('auth-sign-up-email', {
        email: email.trim().toLowerCase(),
        password,
        email_redirect_to: Linking.createURL('callback'),
      });
      if (!result.user) throw new Error('تعذر إنشاء الحساب. حاول مرة أخرى.');
      if (!result.session) return result.confirmation_required;

      const { data, error } = await supabase.auth.setSession({
        access_token: result.session.access_token,
        refresh_token: result.session.refresh_token,
      });
      if (error) throw error;
      set({ session: data.session, user: data.user });
      await get().loadProfile();
      await recordSessionStarted();
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
      await callFunction('auth-send-phone-otp', { phone });
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
      await recordSessionStarted();
    } catch (err: any) {
      set({ error: err.message });
      throw err;
    } finally {
      set({ loading: false });
    }
  },

  signOut: async (scope = 'global') => {
    try {
      if (scope !== 'others') await clearPushRegistrationOnSignOut();
      const { error } = await supabase.auth.signOut({ scope });
      if (error) console.warn('[Wattar] Supabase sign-out failed:', error);
    } catch (error: unknown) {
      console.warn('[Wattar] Supabase sign-out request failed:', error);
    } finally {
      set({ session: null, user: null, profile: null, error: null });
    }
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

  completeOnboarding: async ({ gender, birthDate, profileVisibility }) => {
    const { session } = get();
    if (!session?.user) throw new Error('يجب تسجيل الدخول قبل إكمال الملف الشخصي');
    const { error } = await supabase.rpc('complete_my_onboarding', {
      p_gender: gender,
      p_birth_date: birthDate,
      p_profile_visibility: profileVisibility,
    });
    if (error) throw error;
    await get().loadProfile();
  },

  updateProfileVisibility: async (visibility) => {
    const { profile } = get();
    if (!profile) throw new Error('يجب تسجيل الدخول قبل تعديل الخصوصية');
    const { error } = await supabase.rpc('update_my_profile_visibility', {
      p_profile_visibility: visibility,
    });
    if (error) throw error;
    set({ profile: { ...profile, profile_visibility: visibility } });
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
