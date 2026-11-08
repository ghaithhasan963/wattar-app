/**
 * Wattar App — Layout لشاشات التسجيل
 */
import { Stack, useRouter, useSegments } from 'expo-router';
import { useEffect } from 'react';
import { useAuthStore } from '@/store/auth';

export default function AuthLayout() {
  const { session, profile } = useAuthStore();
  const segments = useSegments();
  const router = useRouter();

  // إذا كان لديه جلسة، أعد توجيهه للتبويبات
  useEffect(() => {
    if (session && profile) {
      router.replace('/(tabs)');
    }
  }, [session, profile]);

  return (
    <Stack screenOptions={{ headerShown: false }} />
  );
}
