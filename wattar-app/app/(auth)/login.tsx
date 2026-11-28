import React, { useState } from 'react';
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
import { useRouter } from 'expo-router';
import { ArrowLeft, Gamepad2, Mail, Mic2, Phone, Sparkles, UsersRound } from 'lucide-react-native';
import { useAuthStore } from '@/store/auth';
import { setPendingPhone } from '@/lib/pending';
import { colors, fonts } from '@/lib/theme';

export default function LoginScreen() {
  const router = useRouter();
  const {
    signInWithPhone,
    signInWithGoogle,
    loading,
    error,
  } = useAuthStore();
  const [phone, setPhone] = useState('');
  const [showPhoneForm, setShowPhoneForm] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSendOtp = async () => {
    if (!phone.trim()) {
      setLocalError('ط£ط¯ط®ظ„ ط±ظ‚ظ… ظ‡ط§طھظپظƒ ظ„ظ„ظ…طھط§ط¨ط¹ط©.');
      return;
    }
    setLocalError(null);
    try {
      await signInWithPhone(phone.trim());
      await setPendingPhone(phone.trim());
      router.push('/(auth)/verify');
    } catch (caught: unknown) {
      setLocalError(caught instanceof Error ? caught.message : 'طھط¹ط°ط± ط¥ط±ط³ط§ظ„ ط±ظ…ط² ط§ظ„طھط­ظ‚ظ‚.');
    }
  };

  const handleSocialSignIn = async (provider: 'google' | 'facebook') => {
    if (provider === 'facebook') {
      setLocalError(null);
      useAuthStore.setState({ error: null });
      Alert.alert('Facebook ط؛ظٹط± ظ…طھط§ط­ ط­ط§ظ„ظٹظ‹ط§', 'ط³ظ†ظپط¹ظ‘ظ„ طھط³ط¬ظٹظ„ ط§ظ„ط¯ط®ظˆظ„ ط¹ط¨ط± Facebook ط¨ط¹ط¯ ط¥ظƒظ…ط§ظ„ ط¥ط¹ط¯ط§ط¯ ط§ظ„ط®ط¯ظ…ط©.');
      return;
    }
    setLocalError(null);
    await signInWithGoogle();
    const { session, profile, error: authError } = useAuthStore.getState();
    if (session && profile) {
      router.replace(profile.onboarding_completed_at ? '/(tabs)' : '/(auth)/complete-profile');
    }
    else if (authError) setLocalError(authError);
  };

  const goToEmail = (mode: 'sign-in' | 'sign-up') => {
    setLocalError(null);
    router.push({ pathname: '/(auth)/email', params: { mode } });
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
        <View pointerEvents="none" style={styles.glowTop} />
        <View pointerEvents="none" style={styles.glowSide} />

        <View style={styles.brand}>
          <View style={styles.logoFrame}>
            <Image source={require('../../assets/wattar-icon.png')} style={styles.logo} />
          </View>
          <View style={styles.brandEyebrow}>
            <Sparkles size={14} color={colors.gold} />
            <Text style={styles.brandEyebrowText}>ظ…ط¬طھظ…ط¹ظƒ ط§ظ„طµظˆطھظٹ ط§ظ„ط¹ط±ط¨ظٹ</Text>
          </View>
          <Text style={styles.title}>طµظˆطھظƒ ظٹظ‚ط±ظ‘ط¨ظ†ط§</Text>
          <Text style={styles.subtitle}>ط؛ط±ظپ ط­ظٹط©طŒ ط£طµط¯ظ‚ط§ط، ط¬ط¯ط¯طŒ ظˆظ„ط­ط¸ط§طھ طھط³طھط­ظ‚ ط§ظ„ظ…ط´ط§ط±ظƒط©.</Text>
        </View>

        <View style={styles.features}>
          <Feature icon={Mic2} label="ط؛ط±ظپ طµظˆطھظٹط©" />
          <Feature icon={UsersRound} label="ظ…ط¬طھظ…ط¹ ظˆط£طµط¯ظ‚ط§ط،" />
          <Feature icon={Gamepad2} label="ط£ظ„ط¹ط§ط¨ ظˆطھط­ط¯ظٹط§طھ" />
        </View>

        <View style={styles.authCard}>
          <Text style={styles.cardTitle}>{showPhoneForm ? 'ط§ظ„ط¯ط®ظˆظ„ ط¨ط±ظ‚ظ… ط§ظ„ظ‡ط§طھظپ' : 'ط£ظ‡ظ„ظ‹ط§ ط¨ظƒ ظپظٹ ظˆطھط±'}</Text>
          <Text style={styles.cardSubtitle}>
            {showPhoneForm ? 'ط³ظ†ط±ط³ظ„ ظ„ظƒ ط±ظ…ط² طھط­ظ‚ظ‚ ظ„ظ…ط±ط© ظˆط§ط­ط¯ط©.' : 'ط³ط¬ظ‘ظ„ ط¯ط®ظˆظ„ظƒ ط£ظˆ ط£ظ†ط´ط¦ ط­ط³ط§ط¨ظƒ ظˆط§ط¨ط¯ط£ ط§ظ„ظ…ط´ط§ط±ظƒط©.'}
          </Text>

          {showPhoneForm ? (
            <View style={styles.phoneForm}>
              <TextInput
                style={styles.phoneInput}
                value={phone}
                onChangeText={(value) => {
                  setPhone(value);
                  setLocalError(null);
                }}
                placeholder="+963 9XX XXX XXX"
                placeholderTextColor={colors.textSecondary}
                keyboardType="phone-pad"
                autoComplete="tel"
                textAlign="left"
                editable={!loading}
              />
              <TouchableOpacity
                style={[styles.primaryButton, loading && styles.disabled]}
                onPress={handleSendOtp}
                disabled={loading}
                accessibilityRole="button"
              >
                {loading ? <ActivityIndicator color={colors.text} /> : <Text style={styles.primaryButtonText}>ط¥ط±ط³ط§ظ„ ط±ظ…ط² ط§ظ„طھط­ظ‚ظ‚</Text>}
                {!loading && <ArrowLeft size={18} color={colors.text} />}
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setShowPhoneForm(false)} disabled={loading}>
                <Text style={styles.backText}>ط§ظ„ط¹ظˆط¯ط© ط¥ظ„ظ‰ ط®ظٹط§ط±ط§طھ ط§ظ„ط¯ط®ظˆظ„</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <TouchableOpacity
                style={[styles.primaryButton, loading && styles.disabled]}
                onPress={() => {
                  setLocalError(null);
                  setShowPhoneForm(true);
                }}
                disabled={loading}
                accessibilityRole="button"
              >
                <Phone size={19} color={colors.text} />
                <Text style={styles.primaryButtonText}>ط§ظ„ظ…طھط§ط¨ط¹ط© ط¨ط±ظ‚ظ… ط§ظ„ظ‡ط§طھظپ</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.emailButton}
                onPress={() => goToEmail('sign-in')}
                disabled={loading}
                accessibilityRole="button"
              >
                <Mail size={18} color={colors.text} />
                <Text style={styles.emailButtonText}>ط§ظ„ط¯ط®ظˆظ„ ط¨ط§ظ„ط¨ط±ظٹط¯ ط§ظ„ط¥ظ„ظƒطھط±ظˆظ†ظٹ</Text>
              </TouchableOpacity>

              <View style={styles.divider}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>ط£ظˆ طھط§ط¨ط¹ ط¨ط§ط³طھط®ط¯ط§ظ…</Text>
                <View style={styles.dividerLine} />
              </View>

              <View style={styles.socialRow}>
                <TouchableOpacity
                  style={[styles.socialButton, loading && styles.disabled]}
                  onPress={() => handleSocialSignIn('google')}
                  disabled={loading}
                  accessibilityRole="button"
                >
                  <Text style={styles.socialButtonText}>Google</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.socialButton, loading && styles.disabled]}
                  onPress={() => handleSocialSignIn('facebook')}
                  disabled={loading}
                  accessibilityRole="button"
                  accessibilityLabel="طھط³ط¬ظٹظ„ ط§ظ„ط¯ط®ظˆظ„ ط¹ط¨ط± Facebook"
                >
                  <Text style={styles.socialButtonText}>Facebook</Text>
                </TouchableOpacity>
              </View>

              {loading && <ActivityIndicator color={colors.primary} style={styles.loader} />}

            </>
          )}

          {(localError || error) && (
            <Text accessibilityRole="alert" style={styles.errorText}>{localError || error}</Text>
          )}
        </View>

        <TouchableOpacity
          style={styles.signupPrompt}
          onPress={() => goToEmail('sign-up')}
          disabled={loading}
          accessibilityRole="button"
        >
          <Text style={styles.signupPromptText}>ط¬ط¯ظٹط¯ ظپظٹ ظˆطھط±طں <Text style={styles.signupLink}>ط£ظ†ط´ط¦ ط­ط³ط§ط¨ظƒ ط§ظ„ط¢ظ†</Text></Text>
        </TouchableOpacity>

        <Text style={styles.terms}>ط¨ط§ظ„ظ…طھط§ط¨ط¹ط©طŒ ط£ظ†طھ طھظˆط§ظپظ‚ ط¹ظ„ظ‰ ط´ط±ظˆط· ط§ظ„ط§ط³طھط®ط¯ط§ظ… ظˆط³ظٹط§ط³ط© ط§ظ„ط®طµظˆطµظٹط©.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Feature({ icon: Icon, label }: { icon: typeof Mic2; label: string }) {
  return (
    <View style={styles.feature}>
      <View style={styles.featureIcon}>
        <Icon size={18} color={colors.primary} />
      </View>
      <Text style={styles.featureLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 22,
    paddingTop: 38,
    paddingBottom: 24,
    overflow: 'hidden',
  },
  glowTop: {
    position: 'absolute',
    top: -130,
    alignSelf: 'center',
    width: 340,
    height: 340,
    borderRadius: 170,
    backgroundColor: colors.primaryHaze,
  },
  glowSide: {
    position: 'absolute',
    top: 280,
    right: -140,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: colors.heroSurface,
  },
  brand: { alignItems: 'center', marginBottom: 24 },
  logoFrame: {
    width: 88,
    height: 88,
    borderRadius: 28,
    padding: 5,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    marginBottom: 17,
  },
  logo: { width: '100%', height: '100%', borderRadius: 23 },
  brandEyebrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: colors.goldSoft,
    marginBottom: 10,
  },
  brandEyebrowText: { color: colors.gold, fontSize: 11, fontFamily: fonts.semibold },
  title: { color: colors.text, fontSize: 28, fontFamily: fonts.black, textAlign: 'center' },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 21,
    marginTop: 7,
    textAlign: 'center',
    maxWidth: 310,
  },
  features: { flexDirection: 'row-reverse', gap: 9, marginBottom: 18 },
  feature: {
    flex: 1,
    minHeight: 79,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: 17,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 4,
  },
  featureIcon: {
    width: 31,
    height: 31,
    borderRadius: 11,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureLabel: { color: colors.textSecondary, fontSize: 10, fontFamily: fonts.semibold, textAlign: 'center' },
  authCard: {
    padding: 18,
    borderRadius: 24,
    backgroundColor: colors.sheet,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTitle: { color: colors.text, fontSize: 19, fontFamily: fonts.bold, textAlign: 'right' },
  cardSubtitle: { color: colors.textSecondary, fontSize: 12, textAlign: 'right', marginTop: 5, marginBottom: 16 },
  primaryButton: {
    minHeight: 53,
    borderRadius: 15,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  primaryButtonText: { color: colors.text, fontSize: 15, fontFamily: fonts.bold },
  emailButton: {
    minHeight: 51,
    borderRadius: 15,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    marginTop: 10,
  },
  emailButtonText: { color: colors.text, fontSize: 14, fontFamily: fonts.semibold },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 15, marginBottom: 12 },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { color: colors.textSecondary, fontSize: 11 },
  socialRow: { flexDirection: 'row', gap: 10 },
  socialButton: {
    flex: 1,
    height: 45,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  socialButtonText: { color: colors.text, fontSize: 13, fontFamily: fonts.semibold },
  loader: { marginTop: 12 },
  phoneForm: { gap: 12 },
  phoneInput: {
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 15,
    color: colors.text,
    fontSize: 16,
  },
  backText: { color: colors.textSecondary, fontSize: 13, textAlign: 'center', paddingVertical: 5 },
  disabled: { opacity: 0.55 },
  errorText: { color: colors.danger, fontSize: 12, textAlign: 'center', lineHeight: 18, marginTop: 12 },
  signupPrompt: { alignItems: 'center', paddingVertical: 17 },
  signupPromptText: { color: colors.textSecondary, fontSize: 13 },
  signupLink: { color: colors.primary, fontFamily: fonts.bold },
  terms: { color: colors.textMuted, fontSize: 10, textAlign: 'center', lineHeight: 17 },
});
