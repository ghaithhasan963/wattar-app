import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ChevronRight, Eye, EyeOff, Lock, Mail, ShieldCheck, Sparkles } from 'lucide-react-native';
import { useAuthStore } from '@/store/auth';
import { colors, fonts } from '@/lib/theme';
import { supabase } from '@/lib/supabase';
import { describeAuthError, describeRecoveryRequestError, RECOVERY_EMAIL_SENT_MESSAGE } from '@/lib/authMessages';
import { checkRecoveryAllowance, describeRecoveryWait, readAttempts, recordAttempt } from '@/lib/recovery';

type EmailMode = 'sign-in' | 'sign-up';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function EmailAuthScreen() {
  const router = useRouter();
  const { mode: requestedMode } = useLocalSearchParams<{ mode?: string }>();
  const { signInWithEmail, signUpWithEmail, loading } = useAuthStore();
  const [mode, setMode] = useState<EmailMode>(requestedMode === 'sign-up' ? 'sign-up' : 'sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetSending, setResetSending] = useState(false);

  useEffect(() => {
    setMode(requestedMode === 'sign-up' ? 'sign-up' : 'sign-in');
  }, [requestedMode]);

  const submit = async () => {
    setError(null);
    const normalizedEmail = email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      setError('ط£ط¯ط®ظ„ ط¨ط±ظٹط¯ظ‹ط§ ط¥ظ„ظƒطھط±ظˆظ†ظٹظ‹ط§ طµط­ظٹط­ظ‹ط§.');
      return;
    }
    if (!password) {
      setError('ط£ط¯ط®ظ„ ظƒظ„ظ…ط© ط§ظ„ظ…ط±ظˆط± ظ„ظ„ظ…طھط§ط¨ط¹ط©.');
      return;
    }
    if (mode === 'sign-up' && (password.length < 8 || password.length > 128)) {
      setError('ط§ط³طھط®ط¯ظ… ظƒظ„ظ…ط© ظ…ط±ظˆط± ظ…ظ† 8 ط¥ظ„ظ‰ 128 ط­ط±ظپظ‹ط§ ظ„ط²ظٹط§ط¯ط© ط£ظ…ط§ظ† ط­ط³ط§ط¨ظƒ.');
      return;
    }
    if (mode === 'sign-up' && password !== confirmPassword) {
      setError('ظƒظ„ظ…طھط§ ط§ظ„ظ…ط±ظˆط± ط؛ظٹط± ظ…طھط·ط§ط¨ظ‚طھظٹظ†.');
      return;
    }

    try {
      if (mode === 'sign-in') {
        await signInWithEmail(normalizedEmail, password);
        const profile = useAuthStore.getState().profile;
        router.replace(
          !profile?.onboarding_completed_at
            ? '/(auth)/complete-profile'
            : !profile.adult_confirmed_at
              ? '/(auth)/age-confirmation'
              : '/(tabs)',
        );
        return;
      }

      const emailConfirmationRequired = await signUpWithEmail(normalizedEmail, password);
      if (emailConfirmationRequired) {
        Alert.alert(
          'ط¨ط§ظ‚ظٹ ط®ط·ظˆط© ظˆط§ط­ط¯ط©',
          'ط£ط±ط³ظ„ظ†ط§ ط±ط§ط¨ط· طھط£ظƒظٹط¯ ط¥ظ„ظ‰ ط¨ط±ظٹط¯ظƒ ط§ظ„ط¥ظ„ظƒطھط±ظˆظ†ظٹ. ط§ظپطھط­ظ‡ ظ„ظ„ط¹ظˆط¯ط© ط¥ظ„ظ‰ ط§ظ„طھط·ط¨ظٹظ‚ ظˆظ…طھط§ط¨ط¹ط© ط¥ط¹ط¯ط§ط¯ ط­ط³ط§ط¨ظƒ.',
          [{ text: 'ط­ط³ظ†ظ‹ط§', onPress: () => setMode('sign-in') }],
        );
        return;
      }
      router.replace('/(auth)/complete-profile');
    } catch (submitError: unknown) {
      setError(describeAuthError(submitError));
    }
  };

  const switchMode = (nextMode: EmailMode) => {
    setMode(nextMode);
    setError(null);
    setConfirmPassword('');
  };

  const sendPasswordReset = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      setError('ط£ط¯ط®ظ„ ط¨ط±ظٹط¯ظƒ ط§ظ„ط¥ظ„ظƒطھط±ظˆظ†ظٹ ط£ظˆظ„ظ‹ط§ ظ„ط¥ط±ط³ط§ظ„ ط±ط§ط¨ط· ط¥ط¹ط§ط¯ط© ط§ظ„طھط¹ظٹظٹظ†.');
      return;
    }

    setError(null);

    // ط­ط¯ظ‘ ظ…ط­ط§ظˆظ„ط§طھ ظ…ط­ظ„ظٹ (ظٹظڈظƒظ…ظ„ظ‡ ط­ط¯ظ‘ Supabase ط¹ظ„ظ‰ ط§ظ„ط®ط§ط¯ظ…).
    const requestedAt = Date.now();
    try {
      const allowance = checkRecoveryAllowance(await readAttempts(AsyncStorage, requestedAt), requestedAt);
      if (!allowance.allowed) {
        setError(describeRecoveryWait(allowance.reason ?? 'cooldown', allowance.retryAfterMs));
        return;
      }
    } catch {
      // طھط¹ط°ظ‘ط± ظ‚ط±ط§ط،ط© ط§ظ„طھط®ط²ظٹظ† ط§ظ„ظ…ط­ظ„ظٹ: ظ†ظƒظ…ظ„طŒ ظˆط§ظ„ط®ط§ط¯ظ… ظٹظپط±ط¶ ط­ط¯ظ‘ظ‡.
    }

    setResetSending(true);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo: Linking.createURL('callback', { queryParams: { flow: 'recovery' } }),
      });
      if (resetError) throw resetError;
      // ط±ط³ط§ظ„ط© ظ…ط­ط§ظٹط¯ط©: ظ„ط§ طھظƒط´ظپ ط¥ظ† ظƒط§ظ† ط§ظ„ط¨ط±ظٹط¯ ظ…ط³ط¬ظ‘ظ„ط§ظ‹.
      Alert.alert('طھط­ظ‚ظ‚ ظ…ظ† ط¨ط±ظٹط¯ظƒ', RECOVERY_EMAIL_SENT_MESSAGE);
    } catch (resetError: unknown) {
      setError(describeRecoveryRequestError(resetError));
    } finally {
      try {
        await recordAttempt(AsyncStorage, Date.now());
      } catch {
        // ظ„ط§ ظ†ظڈظپط´ظ„ ط§ظ„ط·ظ„ط¨ ط¨ط³ط¨ط¨ ط§ظ„طھط®ط²ظٹظ† ط§ظ„ظ…ط­ظ„ظٹ.
      }
      setResetSending(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.replace('/(auth)/login')}
          accessibilityRole="button"
          accessibilityLabel="ط§ظ„ط¹ظˆط¯ط© ط¥ظ„ظ‰ ط®ظٹط§ط±ط§طھ ط§ظ„ط¯ط®ظˆظ„"
        >
          <ChevronRight size={20} color={colors.textSecondary} />
          <Text style={styles.backText}>ط®ظٹط§ط±ط§طھ ط§ظ„ط¯ط®ظˆظ„</Text>
        </TouchableOpacity>

        <View style={styles.brand}>
          <View style={styles.logoFrame}>
            <Image source={require('../../assets/wattar-icon.png')} style={styles.logo} />
          </View>
          <View style={styles.brandEyebrow}>
            <Sparkles size={13} color={colors.gold} />
            <Text style={styles.brandEyebrowText}>ط£ظ‡ظ„ط§ظ‹ ط¨ظƒ ظپظٹ ظˆطھط±</Text>
          </View>
          <Text style={styles.title}>{mode === 'sign-in' ? 'ط³ط¹ط¯ط§ط، ط¨ط¹ظˆط¯طھظƒ' : 'ظ…ظƒط§ظ†ظƒ ط¨ظٹظ†ظ†ط§'}</Text>
          <Text style={styles.subtitle}>
            {mode === 'sign-in' ? 'ط³ط¬ظ‘ظ„ ط¯ط®ظˆظ„ظƒ ظˆطھط§ط¨ط¹ ط¹ط§ظ„ظ…ظƒ ط§ظ„طµظˆطھظٹ.' : 'ط£ظ†ط´ط¦ ط­ط³ط§ط¨ظƒ ظˆط§ط¨ط¯ط£ ط­ظƒط§ظٹطھظƒ ط¨طµظˆطھظƒ.'}
          </Text>
        </View>

        <View style={styles.card}>
          <View style={styles.modeSwitch}>
            <TouchableOpacity
              style={[styles.modeTab, mode === 'sign-up' && styles.modeTabActive]}
              onPress={() => switchMode('sign-up')}
              disabled={loading}
              accessibilityRole="tab"
              accessibilityState={{ selected: mode === 'sign-up' }}
            >
              <Text style={[styles.modeTabText, mode === 'sign-up' && styles.modeTabTextActive]}>ط­ط³ط§ط¨ ط¬ط¯ظٹط¯</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeTab, mode === 'sign-in' && styles.modeTabActive]}
              onPress={() => switchMode('sign-in')}
              disabled={loading}
              accessibilityRole="tab"
              accessibilityState={{ selected: mode === 'sign-in' }}
            >
              <Text style={[styles.modeTabText, mode === 'sign-in' && styles.modeTabTextActive]}>طھط³ط¬ظٹظ„ ط§ظ„ط¯ط®ظˆظ„</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.label}>ط§ظ„ط¨ط±ظٹط¯ ط§ظ„ط¥ظ„ظƒطھط±ظˆظ†ظٹ</Text>
          <View style={styles.inputWrap}>
            <Mail size={18} color={colors.textSecondary} />
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={(value) => { setEmail(value); setError(null); }}
              placeholder="name@example.com"
              placeholderTextColor={colors.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
              returnKeyType="next"
              editable={!loading}
            />
          </View>

          <Text style={styles.label}>ظƒظ„ظ…ط© ط§ظ„ظ…ط±ظˆط±</Text>
          <View style={styles.inputWrap}>
            <Lock size={18} color={colors.textSecondary} />
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={(value) => { setPassword(value); setError(null); }}
              placeholder={mode === 'sign-up' ? '8 ط£ط­ط±ظپ ط¹ظ„ظ‰ ط§ظ„ط£ظ‚ظ„' : 'ط£ط¯ط®ظ„ ظƒظ„ظ…ط© ط§ظ„ظ…ط±ظˆط±'}
              placeholderTextColor={colors.textMuted}
              secureTextEntry={!passwordVisible}
              autoCapitalize="none"
              autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
              textContentType={mode === 'sign-up' ? 'newPassword' : 'password'}
              returnKeyType={mode === 'sign-up' ? 'next' : 'go'}
              onSubmitEditing={mode === 'sign-in' ? submit : undefined}
              editable={!loading}
            />
            <TouchableOpacity
              onPress={() => setPasswordVisible((visible) => !visible)}
              accessibilityRole="button"
              accessibilityLabel={passwordVisible ? 'ط¥ط®ظپط§ط، ظƒظ„ظ…ط© ط§ظ„ظ…ط±ظˆط±' : 'ط¥ط¸ظ‡ط§ط± ظƒظ„ظ…ط© ط§ظ„ظ…ط±ظˆط±'}
              hitSlop={8}
            >
              {passwordVisible
                ? <EyeOff size={18} color={colors.textSecondary} />
                : <Eye size={18} color={colors.textSecondary} />}
            </TouchableOpacity>
          </View>

          {mode === 'sign-up' && (
            <>
              <Text style={styles.label}>طھط£ظƒظٹط¯ ظƒظ„ظ…ط© ط§ظ„ظ…ط±ظˆط±</Text>
              <View style={styles.inputWrap}>
                <ShieldCheck size={18} color={colors.textSecondary} />
                <TextInput
                  style={styles.input}
                  value={confirmPassword}
                  onChangeText={(value) => { setConfirmPassword(value); setError(null); }}
                  placeholder="ط£ط¹ط¯ ظƒطھط§ط¨ط© ظƒظ„ظ…ط© ط§ظ„ظ…ط±ظˆط±"
                  placeholderTextColor={colors.textMuted}
                  secureTextEntry={!passwordVisible}
                  autoCapitalize="none"
                  autoComplete="new-password"
                  textContentType="newPassword"
                  returnKeyType="go"
                  onSubmitEditing={submit}
                  editable={!loading}
                />
              </View>
            </>
          )}

          {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}

          {mode === 'sign-in' && (
            <TouchableOpacity
              style={styles.forgotPassword}
              onPress={() => void sendPasswordReset()}
              disabled={loading || resetSending}
              accessibilityRole="button"
            >
              <Text style={styles.forgotPasswordText}>
                {resetSending ? 'ط¬ط§ط±ظچ ط¥ط±ط³ط§ظ„ ط§ظ„ط±ط§ط¨ط·...' : 'ظ†ط³ظٹطھ ظƒظ„ظ…ط© ط§ظ„ظ…ط±ظˆط±طں'}
              </Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.submitButton, loading && styles.disabled]}
            onPress={submit}
            disabled={loading}
            accessibilityRole="button"
          >
            {loading ? (
              <ActivityIndicator color={colors.text} />
            ) : (
              <Text style={styles.submitText}>
                {mode === 'sign-in' ? 'طھط³ط¬ظٹظ„ ط§ظ„ط¯ط®ظˆظ„' : 'ط¥ظ†ط´ط§ط، ط­ط³ط§ط¨ظٹ'}
              </Text>
            )}
          </TouchableOpacity>

          <View style={styles.footer}>
            <Text style={styles.footerText}>
              {mode === 'sign-in' ? 'ظ„ظٹط³ ظ„ط¯ظٹظƒ ط­ط³ط§ط¨طں' : 'ظ„ط¯ظٹظƒ ط­ط³ط§ط¨ ط¨ط§ظ„ظپط¹ظ„طں'}
            </Text>
            <TouchableOpacity
              onPress={() => switchMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')}
              disabled={loading}
              accessibilityRole="button"
            >
              <Text style={styles.footerLink}>{mode === 'sign-in' ? 'ط¥ظ†ط´ط§ط، ط­ط³ط§ط¨' : 'طھط³ط¬ظٹظ„ ط§ظ„ط¯ط®ظˆظ„'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Text style={styles.terms}>ط¨ظٹط§ظ†ط§طھظƒ ظ…ط­ظپظˆط¸ط© ط¨ط£ظ…ط§ظ†. ط¨ط§ظ„ظ…طھط§ط¨ط¹ط©طŒ ط£ظ†طھ طھظˆط§ظپظ‚ ط¹ظ„ظ‰ ط´ط±ظˆط· ط§ظ„ط§ط³طھط®ط¯ط§ظ… ظˆط³ظٹط§ط³ط© ط§ظ„ط®طµظˆطµظٹط©.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 22,
    paddingTop: 58,
    paddingBottom: 24,
  },
  backButton: {
    position: 'absolute',
    top: 44,
    right: 22,
    zIndex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
  },
  backText: { color: colors.textSecondary, fontSize: 13, fontFamily: fonts.semibold },
  brand: { alignItems: 'center', marginBottom: 23 },
  logoFrame: {
    width: 70,
    height: 70,
    padding: 4,
    borderRadius: 23,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    marginBottom: 13,
  },
  logo: { width: '100%', height: '100%', borderRadius: 19 },
  brandEyebrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 18,
    backgroundColor: colors.goldSoft,
    marginBottom: 9,
  },
  brandEyebrowText: { color: colors.gold, fontSize: 10, fontFamily: fonts.semibold },
  title: { color: colors.text, fontSize: 25, fontFamily: fonts.black },
  subtitle: { color: colors.textSecondary, fontSize: 13, marginTop: 6, textAlign: 'center' },
  card: {
    padding: 19,
    borderRadius: 24,
    backgroundColor: colors.sheet,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modeSwitch: {
    flexDirection: 'row-reverse',
    padding: 4,
    borderRadius: 14,
    backgroundColor: colors.background,
    marginBottom: 20,
  },
  modeTab: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
  },
  modeTabActive: { backgroundColor: colors.primary },
  modeTabText: { color: colors.textSecondary, fontSize: 12, fontFamily: fonts.semibold },
  modeTabTextActive: { color: colors.text },
  label: { color: colors.text, fontSize: 13, fontFamily: fonts.semibold, textAlign: 'right', marginBottom: 8 },
  inputWrap: {
    minHeight: 53,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 13,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 15,
  },
  input: { flex: 1, color: colors.text, fontSize: 14, paddingVertical: 12, textAlign: 'right' },
  error: { color: colors.danger, fontSize: 12, textAlign: 'right', lineHeight: 19, marginBottom: 8 },
  forgotPassword: { alignSelf: 'flex-start', paddingVertical: 8 },
  forgotPasswordText: { color: colors.primary, fontSize: 12, fontFamily: fonts.semibold },
  submitButton: {
    minHeight: 53,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    marginTop: 4,
  },
  disabled: { opacity: 0.55 },
  submitText: { color: colors.text, fontSize: 15, fontFamily: fonts.bold },
  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, paddingTop: 18 },
  footerText: { color: colors.textSecondary, fontSize: 12 },
  footerLink: { color: colors.primary, fontSize: 12, fontFamily: fonts.bold },
  terms: { color: colors.textMuted, fontSize: 10, lineHeight: 17, textAlign: 'center', marginTop: 18 },
});
