import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { callFunction, supabase } from '@/lib/supabase';

const TOKEN_STORAGE_KEY = 'wattar-expo-push-token';
const ANDROID_CHANNEL_ID = 'social';

export type SocialNotificationEvent =
  | 'friend_request'
  | 'private_message'
  | 'room_invitation'
  | 'dice_challenge';

export async function getSocialPushEnabled(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const [token, permission] = await Promise.all([
    AsyncStorage.getItem(TOKEN_STORAGE_KEY),
    Notifications.getPermissionsAsync(),
  ]);
  return Boolean(token && permission.granted);
}

export async function enableSocialPushNotifications(): Promise<void> {
  if (Platform.OS === 'web') throw new Error('إشعارات الهاتف غير متاحة في نسخة الويب.');
  const currentPermission = await Notifications.getPermissionsAsync();
  const permission = currentPermission.granted
    ? currentPermission
    : await Notifications.requestPermissionsAsync();
  if (!permission.granted) throw new Error('لم يتم منح إذن الإشعارات من إعدادات الجهاز.');

  if (Platform.OS === 'android') {
    if (!Constants.expoConfig?.android?.googleServicesFile) {
      throw new Error(
        'تم منح إذن الإشعارات، لكن إعداد Firebase لأندرويد غير مكتمل. أضف ملف google-services.json داخل wattar-app ثم أنشئ APK جديدًا.',
      );
    }
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: 'التواصل',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#C064FF',
    });
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) throw new Error('معرّف مشروع Expo غير مضبوط.');

  let tokenData: string;
  try {
    const tokenResponse = await Notifications.getExpoPushTokenAsync({ projectId });
    tokenData = tokenResponse.data;
  } catch (error: unknown) {
    if (Platform.OS === 'android') {
      throw new Error(
        'تعذر تهيئة Firebase للإشعارات. أضف google-services.json وتأكد من إعداد FCM V1 في Expo/EAS، ثم أعد بناء التطبيق.',
      );
    }
    throw new Error(error instanceof Error ? error.message : 'تعذر إنشاء رمز الإشعارات.');
  }

  const platform = Platform.OS === 'ios' ? 'ios' : 'android';
  const { error } = await supabase.rpc('register_my_push_token', {
    p_token: tokenData,
    p_platform: platform,
  });
  if (error) throw new Error(`تعذر تسجيل جهازك للإشعارات: ${error.message}`);
  await AsyncStorage.setItem(TOKEN_STORAGE_KEY, tokenData);
}

export async function disableSocialPushNotifications(): Promise<void> {
  const token = await AsyncStorage.getItem(TOKEN_STORAGE_KEY);
  if (!token) return;
  const { error } = await supabase.rpc('remove_my_push_token', { p_token: token });
  if (error) throw new Error(`تعذر إيقاف الإشعارات: ${error.message}`);
  await AsyncStorage.removeItem(TOKEN_STORAGE_KEY);
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
