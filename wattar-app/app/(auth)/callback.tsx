import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';

export default function AuthCallbackScreen() {
  const router = useRouter();
  const { code, flow, error_description: errorDescription } =
    useLocalSearchParams<{ code?: string; flow?: string; error_description?: string }>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const completeSignIn = async () => {
      if (errorDescription) {
        setError(errorDescription);
        return;
      }
      if (!code) {
        setError('رابط التأكيد غير مكتمل أو انتهت صلاحيته.');
        return;
      }

      const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
      if (exchangeError) throw exchangeError;
      useAuthStore.setState({ session: data.session, user: data.user });
      await useAuthStore.getState().loadProfile();
      const profile = useAuthStore.getState().profile;
      if (!profile) throw new Error('تم تسجيل الدخول، لكن تعذر تحميل ملف الحساب.');
      if (active) {
        if (flow === 'recovery') {
          router.replace('/recover-password');
          return;
        }
        router.replace(
          !profile.onboarding_completed_at
            ? '/(auth)/complete-profile'
            : !profile.adult_confirmed_at
              ? '/(auth)/age-confirmation'
              : '/(tabs)',
        );
      }
    };

    completeSignIn().catch((callbackError: unknown) => {
      if (active) {
        setError(callbackError instanceof Error ? callbackError.message : 'تعذر تأكيد الحساب.');
      }
    });

    return () => { active = false; };
  }, [code, errorDescription, flow, router]);

  return (
    <View style={styles.container}>
      {error ? (
        <>
          <Text style={styles.title}>تعذر تأكيد الحساب</Text>
          <Text style={styles.error}>{error}</Text>
          <Text style={styles.hint}>ارجع إلى التطبيق واطلب رابط تأكيد جديدًا.</Text>
        </>
      ) : (
        <>
          <ActivityIndicator size="large" color="#A78BFA" />
          <Text style={styles.title}>جارٍ تأكيد حسابك...</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B1020', alignItems: 'center', justifyContent: 'center', padding: 28 },
  title: { color: '#F8FAFC', fontSize: 20, fontWeight: '700', marginTop: 16, textAlign: 'center' },
  error: { color: '#FCA5A5', fontSize: 14, marginTop: 14, textAlign: 'center', lineHeight: 21 },
  hint: { color: '#94A3B8', fontSize: 13, marginTop: 10, textAlign: 'center' },
});
