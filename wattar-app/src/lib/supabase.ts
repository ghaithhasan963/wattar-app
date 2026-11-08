/**
 * Wattar App — عميل Supabase المشترك
 * @version 1.0.0
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';

// يُقرأ من متغيرات البيئة (.env)
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder';

export const supabase: SupabaseClient = createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  {
    auth: {
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: true,
      storage: AsyncStorage,
      storageKey: 'wattar-auth',
    },
    realtime: {
      params: { eventsPerSecond: 10 },
    },
  },
);

// استدعاء Edge Function
export async function callFunction<T = unknown>(
  name: string,
  body: unknown,
  idempotencyKey?: string,
): Promise<T> {
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;

  const response = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(idempotencyKey ? { 'X-Idempotency-Key': idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || data.error || 'فشل الطلب');
  }

  return data as T;
}

// رفع صورة إلى Supabase Storage (يعمل مع React Native عبر base64)
export async function uploadImage(uri: string, bucket: string, pathPrefix: string): Promise<string> {
  // قراءة الملف كـ base64
  const base64Data = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const fileExt = uri.split('.').pop()?.toLowerCase() ?? 'jpg';
  const mimeType = fileExt === 'png' ? 'image/png' : 'image/jpeg';
  const filePath = `${pathPrefix}_${Date.now()}.${fileExt}`;

  // تحويل base64 إلى ArrayBuffer
  const binary = atob(base64Data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  const { error } = await supabase.storage
    .from(bucket)
    .upload(filePath, bytes.buffer, {
      contentType: mimeType,
      upsert: true,
    });

  if (error) throw new Error(`فشل رفع الصورة: ${error.message}`);

  const { data: { publicUrl } } = supabase.storage
    .from(bucket)
    .getPublicUrl(filePath);

  return publicUrl;
}

export async function uploadPrivateMedia(
  uri: string,
  bucket: string,
  path: string,
  contentType: string,
  maxBytes: number,
): Promise<string> {
  if (path.startsWith('/') || path.split('/').includes('..')) {
    throw new Error('مسار الملف غير صالح');
  }
  const fileInfo = await FileSystem.getInfoAsync(uri);
  if (!fileInfo.exists || !fileInfo.size) throw new Error('تعذر قراءة ملف الوسائط');
  if (fileInfo.size > maxBytes) throw new Error('حجم الملف أكبر من الحد المسموح');

  const base64Data = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const binary = atob(base64Data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const { error } = await supabase.storage.from(bucket).upload(path, bytes.buffer, {
    contentType,
    upsert: false,
  });
  if (error) throw new Error(`تعذر رفع الوسائط: ${error.message}`);
  return path;
}
