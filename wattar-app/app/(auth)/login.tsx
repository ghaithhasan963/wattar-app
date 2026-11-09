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
import { colors } from '@/lib/theme';

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
      setLocalError('أدخل رقم هاتفك للمتابعة.');
      return;
    }
    setLocalError(null);
    try {
      await signInWithPhone(phone.trim());
      await setPendingPhone(phone.trim());
      router.push('/(auth)/verify');
    } catch (caught: unknown) {
      setLocalError(caught instanceof Error ? caught.message : 'تعذر إرسال رمز التحقق.');
    }
  };

  const handleSocialSignIn = async (provider: 'google' | 'facebook') => {
    if (provider === 'facebook') {
      setLocalError(null);
      useAuthStore.setState({ error: null });
      Alert.alert('Facebook غير متاح حاليًا', 'سنفعّل تسجيل الدخول عبر Facebook بعد إكمال إعداد الخدمة.');
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
            <Text style={styles.brandEyebrowText}>مجتمعك الصوتي العربي</Text>
          </View>
          <Text style={styles.title}>صوتك يقرّبنا</Text>
          <Text style={styles.subtitle}>غرف حية، أصدقاء جدد، ولحظات تستحق المشاركة.</Text>
        </View>

        <View style={styles.features}>
          <Feature icon={Mic2} label="غرف صوتية" />
          <Feature icon={UsersRound} label="مجتمع وأصدقاء" />
          <Feature icon={Gamepad2} label="ألعاب وتحديات" />
        </View>

        <View style={styles.authCard}>
          <Text style={styles.cardTitle}>{showPhoneForm ? 'الدخول برقم الهاتف' : 'أهلًا بك في وتر'}</Text>
          <Text style={styles.cardSubtitle}>
            {showPhoneForm ? 'سنرسل لك رمز تحقق لمرة واحدة.' : 'سجّل دخولك أو أنشئ حسابك وابدأ المشاركة.'}
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
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>إرسال رمز التحقق</Text>}
                {!loading && <ArrowLeft size={18} color="#fff" />}
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setShowPhoneForm(false)} disabled={loading}>
                <Text style={styles.backText}>العودة إلى خيارات الدخول</Text>
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
                <Phone size={19} color="#fff" />
                <Text style={styles.primaryButtonText}>المتابعة برقم الهاتف</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.emailButton}
                onPress={() => goToEmail('sign-in')}
                disabled={loading}
                accessibilityRole="button"
              >
                <Mail size={18} color={colors.text} />
                <Text style={styles.emailButtonText}>الدخول بالبريد الإلكتروني</Text>
              </TouchableOpacity>

              <View style={styles.divider}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>أو تابع باستخدام</Text>
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
                  accessibilityLabel="تسجيل الدخول عبر Facebook"
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
          <Text style={styles.signupPromptText}>جديد في وتر؟ <Text style={styles.signupLink}>أنشئ حسابك الآن</Text></Text>
        </TouchableOpacity>

        <Text style={styles.terms}>بالمتابعة، أنت توافق على شروط الاستخدام وسياسة الخصوصية.</Text>
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
    backgroundColor: '#1C1030',
  },
  glowSide: {
    position: 'absolute',
    top: 280,
    right: -140,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: '#160F25',
  },
  brand: { alignItems: 'center', marginBottom: 24 },
  logoFrame: {
    width: 88,
    height: 88,
    borderRadius: 28,
    padding: 5,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: '#61357D',
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
  brandEyebrowText: { color: colors.gold, fontSize: 11, fontWeight: '700' },
  title: { color: colors.text, fontSize: 28, fontWeight: '900', textAlign: 'center' },
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
    backgroundColor: '#130E1D',
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
  featureLabel: { color: colors.textSecondary, fontSize: 10, fontWeight: '600', textAlign: 'center' },
  authCard: {
    padding: 18,
    borderRadius: 24,
    backgroundColor: '#120D1B',
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTitle: { color: colors.text, fontSize: 19, fontWeight: '800', textAlign: 'right' },
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
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '800' },
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
  emailButtonText: { color: colors.text, fontSize: 14, fontWeight: '700' },
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
  socialButtonText: { color: colors.text, fontSize: 13, fontWeight: '700' },
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
  signupLink: { color: colors.primary, fontWeight: '800' },
  terms: { color: '#746A82', fontSize: 10, textAlign: 'center', lineHeight: 17 },
});
