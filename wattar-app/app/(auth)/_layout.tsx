/**
 * Wattar App — Layout لشاشات التسجيل
 */
import { Stack, usePathname, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useAuthStore } from '@/store/auth';

export default function AuthLayout() {
  const { session, profile } = useAuthStore();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (pathname.endsWith('/callback')) return;
    if (session && profile) {
      if (!profile.onboarding_completed_at || !profile.gender) {
        router.replace('/(auth)/complete-profile');
      } else if (profile.adult_confirmed_at) {
        router.replace('/(tabs)');
      } else {
        router.replace('/(auth)/age-confirmation');
      }
    }
  }, [pathname, session, profile, router]);

  return (
    <Stack screenOptions={{ headerShown: false }} />
  );
}
