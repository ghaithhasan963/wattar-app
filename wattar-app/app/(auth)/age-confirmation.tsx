import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ShieldCheck } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import { useAuthStore } from '@/store/auth';

export default function AgeConfirmationScreen() {
  const router = useRouter();
  const { loadProfile, signOut } = useAuthStore();
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const continueToApp = async () => {
    if (!confirmed || loading) return;
    setLoading(true);
    setError(null);
    try {
      const { error: confirmationError } = await supabase.rpc('confirm_my_adult_status', {
        p_is_18_or_older: true,
      });
      if (confirmationError) throw confirmationError;
      await loadProfile();
      router.replace('/(tabs)');
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'تعذر حفظ التأكيد. حاول مرة أخرى.');
    } finally {
      setLoading(false);
    }
  };

  const leaveApp = async () => {
    await signOut();
    router.replace('/(auth)/login');
  };

  return (
    <View style={styles.screen}>
      <View style={styles.card}>
        <View style={styles.icon}><ShieldCheck size={30} color={colors.primary} /></View>
        <Text style={styles.title}>تأكيد العمر</Text>
        <Text style={styles.description}>
          يتطلب استخدام Wattar أن يكون عمرك 18 عامًا أو أكثر. هذا إقرار ذاتي ولا يُعد تحققًا من الهوية أو العمر.
        </Text>

        <TouchableOpacity
          style={styles.confirmRow}
          onPress={() => setConfirmed((value) => !value)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: confirmed }}
        >
          <View style={[styles.checkbox, confirmed && styles.checkboxChecked]}>
            {confirmed && <Text style={styles.checkmark}>✓</Text>}
          </View>
          <Text style={styles.confirmText}>أؤكد أن عمري 18 عامًا أو أكثر</Text>
        </TouchableOpacity>

        {error && <Text style={styles.error}>{error}</Text>}

        <TouchableOpacity
          style={[styles.primaryButton, (!confirmed || loading) && styles.disabledButton]}
          onPress={continueToApp}
          disabled={!confirmed || loading}
        >
          {loading
            ? <ActivityIndicator color={colors.background} />
            : <Text style={styles.primaryButtonText}>متابعة</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={styles.leaveButton} onPress={leaveApp} disabled={loading}>
          <Text style={styles.leaveText}>لا أستطيع التأكيد — تسجيل الخروج</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    padding: 24,
    borderRadius: 26,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  icon: {
    width: 58,
    height: 58,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
    marginBottom: 20,
  },
  title: { color: colors.text, fontSize: 24, fontWeight: '800', textAlign: 'right' },
  description: { color: colors.textSecondary, fontSize: 15, lineHeight: 25, textAlign: 'right', marginTop: 12 },
  confirmRow: { flexDirection: 'row-reverse', alignItems: 'center', marginTop: 24, gap: 12 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkmark: { color: colors.background, fontSize: 16, fontWeight: '900' },
  confirmText: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '700', textAlign: 'right' },
  error: { color: colors.danger, fontSize: 13, textAlign: 'right', marginTop: 14 },
  primaryButton: {
    minHeight: 52,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
  },
  disabledButton: { opacity: 0.45 },
  primaryButtonText: { color: colors.background, fontSize: 16, fontWeight: '800' },
  leaveButton: { alignItems: 'center', paddingVertical: 16 },
  leaveText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
});
