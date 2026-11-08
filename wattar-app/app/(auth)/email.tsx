import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { ChevronRight, Mail, Lock } from 'lucide-react-native';
import { useAuthStore } from '@/store/auth';
import { colors } from '@/lib/theme';

type EmailMode = 'sign-in' | 'sign-up';

export default function EmailAuthScreen() {
  const router = useRouter();
  const { signInWithEmail, signUpWithEmail, loading } = useAuthStore();
  const [mode, setMode] = useState<EmailMode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    try {
      if (mode === 'sign-in') {
        await signInWithEmail(email, password);
        router.replace('/(tabs)');
        return;
      }

      const emailConfirmationRequired = await signUpWithEmail(email, password);
      if (emailConfirmationRequired) {
        Alert.alert(
          'تحقق من بريدك الإلكتروني',
          'أرسلنا رابط تأكيد إلى بريدك. أكّد الحساب ثم سجّل الدخول.',
        );
        setMode('sign-in');
        return;
      }
      router.replace('/(tabs)');
    } catch (submitError: unknown) {
      setError(submitError instanceof Error ? submitError.message : 'تعذر إكمال العملية.');
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <ChevronRight size={22} color={colors.textSecondary} />
          <Text style={styles.backText}>رجوع</Text>
        </TouchableOpacity>

        <View style={styles.brand}>
          <View style={styles.logo}><Text style={styles.logoText}>W</Text></View>
          <Text style={styles.title}>{mode === 'sign-in' ? 'أهلًا بعودتك' : 'إنشاء حساب جديد'}</Text>
          <Text style={styles.subtitle}>تابع إلى عالم Wattar الصوتي</Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.label}>البريد الإلكتروني</Text>
          <View style={styles.inputWrap}>
            <Mail size={18} color={colors.textSecondary} />
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={(value) => { setEmail(value); setError(null); }}
              placeholder="name@example.com"
              placeholderTextColor="#64748B"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              textContentType="emailAddress"
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
              placeholder={mode === 'sign-up' ? '6 أحرف على الأقل' : 'كلمة المرور'}
              placeholderTextColor="#64748B"
              secureTextEntry
              autoCapitalize="none"
              autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
              textContentType={mode === 'sign-up' ? 'newPassword' : 'password'}
              editable={!loading}
            />
          </View>

          {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}

          <TouchableOpacity
            style={[styles.submitButton, loading && styles.disabled]}
            onPress={submit}
            disabled={loading || !email.trim() || !password || (mode === 'sign-up' && password.length < 6)}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.submitText}>
                {mode === 'sign-in' ? 'تسجيل الدخول' : 'إنشاء الحساب'}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.switchButton}
            onPress={() => { setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in'); setError(null); }}
            disabled={loading}
          >
            <Text style={styles.switchText}>
              {mode === 'sign-in' ? 'ليس لديك حساب؟ إنشاء حساب' : 'لديك حساب؟ تسجيل الدخول'}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, padding: 24, paddingTop: 54, justifyContent: 'center' },
  backButton: { position: 'absolute', top: 50, right: 22, zIndex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  backText: { color: colors.textSecondary, fontSize: 14 },
  brand: { alignItems: 'center', marginBottom: 34 },
  logo: { width: 66, height: 66, borderRadius: 20, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  logoText: { color: '#fff', fontSize: 34, fontWeight: '800' },
  title: { color: colors.text, fontSize: 26, fontWeight: '800' },
  subtitle: { color: colors.textSecondary, fontSize: 14, marginTop: 8 },
  form: { gap: 12 },
  label: { color: colors.text, fontSize: 14, fontWeight: '600', marginTop: 6 },
  inputWrap: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  input: { flex: 1, color: colors.text, fontSize: 15, paddingVertical: 12, textAlign: 'left' },
  error: { color: colors.danger, fontSize: 13, textAlign: 'center', lineHeight: 20 },
  submitButton: { height: 54, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, marginTop: 10 },
  disabled: { opacity: 0.55 },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  switchButton: { alignItems: 'center', padding: 14 },
  switchText: { color: colors.primary, fontSize: 14, fontWeight: '600' },
});
