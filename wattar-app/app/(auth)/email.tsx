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
import { ChevronRight, Eye, EyeOff, Lock, Mail, ShieldCheck, Sparkles } from 'lucide-react-native';
import { useAuthStore } from '@/store/auth';
import { colors } from '@/lib/theme';

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

  useEffect(() => {
    setMode(requestedMode === 'sign-up' ? 'sign-up' : 'sign-in');
  }, [requestedMode]);

  const submit = async () => {
    setError(null);
    const normalizedEmail = email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      setError('أدخل بريدًا إلكترونيًا صحيحًا.');
      return;
    }
    if (!password) {
      setError('أدخل كلمة المرور للمتابعة.');
      return;
    }
    if (mode === 'sign-up' && password.length < 8) {
      setError('اجعل كلمة المرور 8 أحرف على الأقل لزيادة أمان حسابك.');
      return;
    }
    if (mode === 'sign-up' && password !== confirmPassword) {
      setError('كلمتا المرور غير متطابقتين.');
      return;
    }

    try {
      if (mode === 'sign-in') {
        await signInWithEmail(normalizedEmail, password);
        const profile = useAuthStore.getState().profile;
        router.replace(profile?.onboarding_completed_at ? '/(tabs)' : '/(auth)/complete-profile');
        return;
      }

      const emailConfirmationRequired = await signUpWithEmail(normalizedEmail, password);
      if (emailConfirmationRequired) {
        Alert.alert(
          'باقي خطوة واحدة',
          'أرسلنا رابط تأكيد إلى بريدك الإلكتروني. افتحه للعودة إلى التطبيق ومتابعة إعداد حسابك.',
          [{ text: 'حسنًا', onPress: () => setMode('sign-in') }],
        );
        return;
      }
      router.replace('/(auth)/complete-profile');
    } catch (submitError: unknown) {
      setError(submitError instanceof Error ? submitError.message : 'تعذر إكمال العملية. حاول مرة أخرى.');
    }
  };

  const switchMode = (nextMode: EmailMode) => {
    setMode(nextMode);
    setError(null);
    setConfirmPassword('');
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
          accessibilityLabel="العودة إلى خيارات الدخول"
        >
          <ChevronRight size={20} color={colors.textSecondary} />
          <Text style={styles.backText}>خيارات الدخول</Text>
        </TouchableOpacity>

        <View style={styles.brand}>
          <View style={styles.logoFrame}>
            <Image source={require('../../assets/wattar-icon.png')} style={styles.logo} />
          </View>
          <View style={styles.brandEyebrow}>
            <Sparkles size={13} color={colors.gold} />
            <Text style={styles.brandEyebrowText}>أهلاً بك في وتر</Text>
          </View>
          <Text style={styles.title}>{mode === 'sign-in' ? 'سعداء بعودتك' : 'مكانك بيننا'}</Text>
          <Text style={styles.subtitle}>
            {mode === 'sign-in' ? 'سجّل دخولك وتابع عالمك الصوتي.' : 'أنشئ حسابك وابدأ حكايتك بصوتك.'}
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
              <Text style={[styles.modeTabText, mode === 'sign-up' && styles.modeTabTextActive]}>حساب جديد</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeTab, mode === 'sign-in' && styles.modeTabActive]}
              onPress={() => switchMode('sign-in')}
              disabled={loading}
              accessibilityRole="tab"
              accessibilityState={{ selected: mode === 'sign-in' }}
            >
              <Text style={[styles.modeTabText, mode === 'sign-in' && styles.modeTabTextActive]}>تسجيل الدخول</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.label}>البريد الإلكتروني</Text>
          <View style={styles.inputWrap}>
            <Mail size={18} color={colors.textSecondary} />
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={(value) => { setEmail(value); setError(null); }}
              placeholder="name@example.com"
              placeholderTextColor="#756B83"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
              returnKeyType="next"
              editable={!loading}
            />
          </View>

          <Text style={styles.label}>كلمة المرور</Text>
          <View style={styles.inputWrap}>
            <Lock size={18} color={colors.textSecondary} />
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={(value) => { setPassword(value); setError(null); }}
              placeholder={mode === 'sign-up' ? '8 أحرف على الأقل' : 'أدخل كلمة المرور'}
              placeholderTextColor="#756B83"
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
              accessibilityLabel={passwordVisible ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
              hitSlop={8}
            >
              {passwordVisible
                ? <EyeOff size={18} color={colors.textSecondary} />
                : <Eye size={18} color={colors.textSecondary} />}
            </TouchableOpacity>
          </View>

          {mode === 'sign-up' && (
            <>
              <Text style={styles.label}>تأكيد كلمة المرور</Text>
              <View style={styles.inputWrap}>
                <ShieldCheck size={18} color={colors.textSecondary} />
                <TextInput
                  style={styles.input}
                  value={confirmPassword}
                  onChangeText={(value) => { setConfirmPassword(value); setError(null); }}
                  placeholder="أعد كتابة كلمة المرور"
                  placeholderTextColor="#756B83"
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

          <TouchableOpacity
            style={[styles.submitButton, loading && styles.disabled]}
            onPress={submit}
            disabled={loading}
            accessibilityRole="button"
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.submitText}>
                {mode === 'sign-in' ? 'تسجيل الدخول' : 'إنشاء حسابي'}
              </Text>
            )}
          </TouchableOpacity>

          <View style={styles.footer}>
            <Text style={styles.footerText}>
              {mode === 'sign-in' ? 'ليس لديك حساب؟' : 'لديك حساب بالفعل؟'}
            </Text>
            <TouchableOpacity
              onPress={() => switchMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')}
              disabled={loading}
              accessibilityRole="button"
            >
              <Text style={styles.footerLink}>{mode === 'sign-in' ? 'إنشاء حساب' : 'تسجيل الدخول'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Text style={styles.terms}>بياناتك محفوظة بأمان. بالمتابعة، أنت توافق على شروط الاستخدام وسياسة الخصوصية.</Text>
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
  backText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  brand: { alignItems: 'center', marginBottom: 23 },
  logoFrame: {
    width: 70,
    height: 70,
    padding: 4,
    borderRadius: 23,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: '#61357D',
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
  brandEyebrowText: { color: colors.gold, fontSize: 10, fontWeight: '700' },
  title: { color: colors.text, fontSize: 25, fontWeight: '900' },
  subtitle: { color: colors.textSecondary, fontSize: 13, marginTop: 6, textAlign: 'center' },
  card: {
    padding: 19,
    borderRadius: 24,
    backgroundColor: '#120D1B',
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
  modeTabText: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  modeTabTextActive: { color: '#fff' },
  label: { color: colors.text, fontSize: 13, fontWeight: '700', textAlign: 'right', marginBottom: 8 },
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
  submitButton: {
    minHeight: 53,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    marginTop: 4,
  },
  disabled: { opacity: 0.55 },
  submitText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, paddingTop: 18 },
  footerText: { color: colors.textSecondary, fontSize: 12 },
  footerLink: { color: colors.primary, fontSize: 12, fontWeight: '800' },
  terms: { color: '#746A82', fontSize: 10, lineHeight: 17, textAlign: 'center', marginTop: 18 },
});
