import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { callFunction, supabase } from '@/lib/supabase';

const TOKEN_STORAGE_KEY = 'wattar-expo-push-token';
const PROMPT_ASKED_KEY = 'wattar-notification-permission-asked';
const ANDROID_CHANNEL_ID = 'social';

export type SocialNotificationEvent =
  | 'friend_request'
  | 'friend_accepted'
  | 'new_follower'
  | 'private_message'
  | 'room_invitation'
  | 'dice_challenge'
  | 'gift_received';

export type PushRegistrationStatus = 'unsupported' | 'denied' | 'registered' | 'skipped' | 'failed';

export async function getSocialPushEnabled(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const [token, permission] = await Promise.all([
    AsyncStorage.getItem(TOKEN_STORAGE_KEY),
    Notifications.getPermissionsAsync(),
  ]);
  return Boolean(token && permission.granted);
}

async function ensureAndroidNotificationChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'التواصل والإشعارات',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#C064FF',
  });
}

async function registerCurrentDevice(): Promise<string> {
  await ensureAndroidNotificationChannel();

  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) throw new Error('معرّف مشروع Expo غير مضبوط.');

  let token: string;
  try {
    const tokenResponse = await Notifications.getExpoPushTokenAsync({ projectId });
    token = tokenResponse.data;
  } catch (error: unknown) {
    throw new Error(
      Platform.OS === 'android'
        ? 'تعذر تهيئة Firebase للإشعارات. تأكد من إعداد FCM V1 في Expo/EAS ثم أعد بناء التطبيق.'
        : error instanceof Error ? error.message : 'تعذر إنشاء رمز الإشعارات.',
    );
  }

  const platform = Platform.OS === 'ios' ? 'ios' : 'android';
  const { error } = await supabase.rpc('register_my_push_token', {
    p_token: token,
    p_platform: platform,
  });
  if (error) throw new Error(`تعذر تسجيل جهازك للإشعارات: ${error.message}`);
  await AsyncStorage.setItem(TOKEN_STORAGE_KEY, token);
  return token;
}

/**
 * F2: تسجيل الجهاز تلقائياً بعد الدخول بدل الاعتماد على مفتاح الإعدادات اليدوي.
 * `requestPermission` تطلب إذن النظام مرة واحدة فقط (تُحفظ المحاولة محلياً).
 * لا ترمي استثناءً — تُرجع الحالة ليقرر المستدعي كيف يسجّل الفشل.
 */
export async function syncSocialPushRegistration(
  options: { requestPermission?: boolean } = {},
): Promise<PushRegistrationStatus> {
  if (Platform.OS === 'web') return 'unsupported';
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return 'skipped';

  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && options.requestPermission) {
    const alreadyAsked = (await AsyncStorage.getItem(PROMPT_ASKED_KEY)) === '1';
    if (alreadyAsked && !permission.canAskAgain) return 'denied';
    if (permission.canAskAgain || !alreadyAsked) {
      await AsyncStorage.setItem(PROMPT_ASKED_KEY, '1');
      permission = await Notifications.requestPermissionsAsync();
    }
  }
  if (!permission.granted) return 'denied';

  try {
    await registerCurrentDevice();
    return 'registered';
  } catch (error: unknown) {
    console.warn('[Wattar] Push registration failed:', error);
    return 'failed';
  }
}

export async function enableSocialPushNotifications(): Promise<void> {
  if (Platform.OS === 'web') throw new Error('إشعارات الهاتف غير متاحة في نسخة الويب.');
  const currentPermission = await Notifications.getPermissionsAsync();
  const permission = currentPermission.granted
    ? currentPermission
    : await Notifications.requestPermissionsAsync();
  if (!permission.granted) throw new Error('لم يتم منح إذن الإشعارات من إعدادات الجهاز.');
  await AsyncStorage.setItem(PROMPT_ASKED_KEY, '1');
  await registerCurrentDevice();
}

export async function disableSocialPushNotifications(): Promise<void> {
  const token = await AsyncStorage.getItem(TOKEN_STORAGE_KEY);
  if (!token) return;
  const { error } = await supabase.rpc('remove_my_push_token', { p_token: token });
  if (error) throw new Error(`تعذر إيقاف الإشعارات: ${error.message}`);
  await AsyncStorage.removeItem(TOKEN_STORAGE_KEY);
}

/** عند تسجيل الخروج: احذف الرمز من الخادم حتى لا تُسلَّم إشعارات الحساب السابق للجهاز. */
export async function clearPushRegistrationOnSignOut(): Promise<void> {
  if (Platform.OS === 'web') return;
  const token = await AsyncStorage.getItem(TOKEN_STORAGE_KEY);
  try {
    if (token) await supabase.rpc('remove_my_push_token', { p_token: token });
  } catch (error: unknown) {
    console.warn('[Wattar] Failed to remove push token on sign out:', error);
  } finally {
    await AsyncStorage.removeItem(TOKEN_STORAGE_KEY);
  }
}

/**
 * FCM/APNs قد يبدّل رمز الجهاز. عند حدوث ذلك نطلب رمز Expo جديداً ونحدّثه
 * إن اختلف عن المحفوظ — بدل ترك رمز ميت في قاعدة البيانات.
 */
export function watchPushTokenRotation(): () => void {
  if (Platform.OS === 'web') return () => {};
  try {
    const subscription = Notifications.addPushTokenListener(() => {
      void (async () => {
        const stored = await AsyncStorage.getItem(TOKEN_STORAGE_KEY);
        if (!stored) return;
        const permission = await Notifications.getPermissionsAsync();
        if (!permission.granted) return;
        try {
          const fresh = await registerCurrentDevice();
          if (fresh !== stored) {
            await supabase.rpc('remove_my_push_token', { p_token: stored });
            await AsyncStorage.setItem(TOKEN_STORAGE_KEY, fresh);
          }
        } catch (error: unknown) {
          console.warn('[Wattar] Push token refresh failed:', error);
        }
      })();
    });
    return () => subscription.remove();
  } catch (error: unknown) {
    console.warn('[Wattar] Push token listener unavailable:', error);
    return () => {};
  }
}

export async function notifySocialEvent(
  eventType: SocialNotificationEvent,
  referenceId: string,
): Promise<void> {
  const result = await callFunction<{ sent: number; failed: number }>('social-push', {
    event_type: eventType,
    reference_id: referenceId,
  });
  if (result.failed > 0) {
    throw new Error(`تم إرسال ${result.sent} إشعار وتعذر إرسال ${result.failed}.`);
  }
}
