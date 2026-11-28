import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { saveSessionMark } from '@/lib/recovery';
import { colors, fonts } from '@/lib/theme';

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
        setError('ط±ط§ط¨ط· ط§ظ„طھط£ظƒظٹط¯ ط؛ظٹط± ظ…ظƒطھظ…ظ„ ط£ظˆ ط§ظ†طھظ‡طھ طµظ„ط§ط­ظٹطھظ‡.');
        return;
      }

      const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
      if (exchangeError) throw exchangeError;
      useAuthStore.setState({ session: data.session, user: data.user });
      await useAuthStore.getState().loadProfile();
      const profile = useAuthStore.getState().profile;
      if (!profile) throw new Error('طھظ… طھط³ط¬ظٹظ„ ط§ظ„ط¯ط®ظˆظ„طŒ ظ„ظƒظ† طھط¹ط°ط± طھط­ظ…ظٹظ„ ظ…ظ„ظپ ط§ظ„ط­ط³ط§ط¨.');
      if (active) {
        if (flow === 'recovery') {
          // ط¹ظ„ط§ظ…ط© ط¬ظ„ط³ط© ط§ط³طھط¹ط§ط¯ط©: ط´ط§ط´ط© ط¥ط¹ط§ط¯ط© ط§ظ„طھط¹ظٹظٹظ† طھط±ظپط¶ ط§ظ„ط¹ظ…ظ„ ط¨ط¯ظˆظ†ظ‡ط§.
          if (data.user) {
            await saveSessionMark(AsyncStorage, { userId: data.user.id, startedAt: Date.now() });
          }
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
        setError(callbackError instanceof Error ? callbackError.message : 'طھط¹ط°ط± طھط£ظƒظٹط¯ ط§ظ„ط­ط³ط§ط¨.');
      }
    });

    return () => { active = false; };
  }, [code, errorDescription, flow, router]);

  return (
    <View style={styles.container}>
      {error ? (
        <>
          <Text style={styles.title}>طھط¹ط°ط± طھط£ظƒظٹط¯ ط§ظ„ط­ط³ط§ط¨</Text>
          <Text style={styles.error}>{error}</Text>
          <Text style={styles.hint}>ط§ط±ط¬ط¹ ط¥ظ„ظ‰ ط§ظ„طھط·ط¨ظٹظ‚ ظˆط§ط·ظ„ط¨ ط±ط§ط¨ط· طھط£ظƒظٹط¯ ط¬ط¯ظٹط¯ظ‹ط§.</Text>
        </>
      ) : (
        <>
          <ActivityIndicator size="large" color={colors.primaryLight} />
          <Text style={styles.title}>ط¬ط§ط±ظچ طھط£ظƒظٹط¯ ط­ط³ط§ط¨ظƒ...</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: 28 },
  title: { color: colors.text, fontSize: 20, fontFamily: fonts.semibold, marginTop: 16, textAlign: 'center' },
  error: { color: colors.danger, fontSize: 14, marginTop: 14, textAlign: 'center', lineHeight: 21 },
  hint: { color: colors.textSecondary, fontSize: 13, marginTop: 10, textAlign: 'center' },
});
