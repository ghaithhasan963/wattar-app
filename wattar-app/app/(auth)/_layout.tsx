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

  useEffect(() => {
    if (session && profile) {
      if (!profile.onboarding_completed_at || !profile.gender) {
        router.replace('/(auth)/complete-profile');
      } else if (profile.adult_confirmed_at) {
        router.replace('/(tabs)');
      } else {
        router.replace('/(auth)/age-confirmation');
      }
    }
  }, [session, profile, router]);

  return (
    <Stack screenOptions={{ headerShown: false }} />
  );
}
