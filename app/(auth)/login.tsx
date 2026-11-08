/**
 * Wattar App — صفحة الدخول (Login)
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '@/store/auth';
import { setPendingPhone } from '@/lib/pending';
import { Phone, ArrowRight, Mail } from 'lucide-react-native';
import { colors } from '@/lib/theme';

export default function LoginScreen() {
  const router = useRouter();
  const { signInWithPhone, signInWithGoogle, signInWithFacebook, signInAsGuest, loading, error } = useAuthStore();
  const [phone, setPhone] = useState('');
  const [mode, setMode] = useState<'phone' | 'options'>('options');
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSendOtp = async () => {
    if (!phone) return;
    setLocalError(null);
    try {
      await signInWithPhone(phone);
      await setPendingPhone(phone);
      router.push('/(auth)/verify');
    } catch (err: unknown) {
      setLocalError(err instanceof Error ? err.message : 'تعذر إرسال رمز التحقق');
    }
  };

  const handleGuestSignIn = async () => {
    setLocalError(null);
    try {
      await signInAsGuest();
      const { session, profile } = useAuthStore.getState();
      if (!session || !profile) {
        throw new Error('تعذر تجهيز حساب الزائر. تحقق من إعدادات Supabase وسياسات قاعدة البيانات.');
      }
      router.replace('/(tabs)');
    } catch (err: unknown) {
      setLocalError(err instanceof Error ? err.message : 'تعذر تسجيل الدخول كزائر');
    }
  };

  const handleFacebookSignIn = async () => {
    setLocalError(null);
    await signInWithFacebook();
    const { session, profile, error: authError } = useAuthStore.getState();
    if (session && profile) router.replace('/(tabs)');
    else if (authError) setLocalError(authError);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.logo}>
          <Text style={styles.logoText}>W</Text>
        </View>
        <Text style={styles.title}>Wattar | وتر</Text>
        <Text style={styles.subtitle}>أهلاً بك في عالم الصوت والمرح</Text>
      </View>

      {mode === 'options' ? (
        <View style={styles.optionsContainer}>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => {
              setLocalError(null);
              setMode('phone');
            }}
          >
            <Phone size={20} color="#fff" />
            <Text style={styles.primaryButtonText}>الدخول برقم الهاتف</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={signInWithGoogle}
            disabled={loading}
          >
            <Text style={styles.secondaryButtonText}>الدخول بحساب Google</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={handleFacebookSignIn}
            disabled={loading}
          >
            <Text style={styles.secondaryButtonText}>الدخول بحساب Facebook</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => router.push('/(auth)/email')}
            disabled={loading}
          >
            <Mail size={18} color="#fff" />
            <Text style={styles.secondaryButtonText}>البريد الإلكتروني</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.guestButton}
            onPress={handleGuestSignIn}
            disabled={loading}
          >
            <Text style={styles.guestButtonText}>الدخول كزائر</Text>
          </TouchableOpacity>

          {loading && <ActivityIndicator color={colors.primary} style={{ marginTop: 16 }} />}

          {(localError || error) && (
            <Text style={styles.errorText}>{localError || error}</Text>
          )}
        </View>
      ) : (
        <View style={styles.phoneContainer}>
          <Text style={styles.label}>رقم الهاتف</Text>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={(value) => {
              setPhone(value);
              setLocalError(null);
            }}
            placeholder="+963 9XX XXX XXX"
            placeholderTextColor={colors.textSecondary}
            keyboardType="phone-pad"
            autoCapitalize="none"
          />
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={handleSendOtp}
            disabled={loading || !phone}
          >
            <Text style={styles.primaryButtonText}>إرسال رمز التحقق</Text>
            <ArrowRight size={20} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setMode('options')}>
            <Text style={styles.backText}>رجوع</Text>
          </TouchableOpacity>
          {(localError || error) && (
            <Text style={styles.errorText}>{localError || error}</Text>
          )}
        </View>
      )}

      <Text style={styles.terms}>
        بالمتابعة، أنت توافق على شروط الاستخدام وسياسة الخصوصية
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: 24,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logo: {
    width: 80,
    height: 80,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  logoText: {
    fontSize: 40,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  optionsContainer: {
    gap: 12,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    height: 56,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    height: 56,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '500',
  },
  guestButton: {
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guestButtonText: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  phoneContainer: {
    gap: 12,
  },
  label: {
    color: colors.textSecondary,
    fontSize: 14,
    marginBottom: 4,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: colors.text,
    fontSize: 16,
  },
  backText: {
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 8,
  },
  errorText: {
    color: colors.danger,
    textAlign: 'center',
    marginTop: 8,
  },
  terms: {
    color: '#6B7280',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 24,
  },
});
