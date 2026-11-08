/**
 * Wattar App — تخزين مؤقت لبيانات بين الشاشات
 * يستخدم AsyncStorage للحفاظ على رقم الهاتف بين login و verify
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const PENDING_PHONE_KEY = 'wattar_pending_phone';

export async function setPendingPhone(phone: string): Promise<void> {
  await AsyncStorage.setItem(PENDING_PHONE_KEY, phone);
}

export async function getPendingPhone(): Promise<string | null> {
  return await AsyncStorage.getItem(PENDING_PHONE_KEY);
}

export async function clearPendingPhone(): Promise<void> {
  await AsyncStorage.removeItem(PENDING_PHONE_KEY);
}
