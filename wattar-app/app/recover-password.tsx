import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { LockKeyhole } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';

export default function RecoverPasswordScreen() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [loading, setLoading] = useState(false);

  const updatePassword = async () => {
    if (password.length < 8 || password.length > 128) {
      Alert.alert('كلمة مرور غير صالحة', 'استخدم كلمة مرور من 8 إلى 128 حرفًا.');
      return;
    }
    if (password !== confirmation) {
      Alert.alert('كلمتا المرور غير متطابقتين', 'تحقق من كلمة المرور الجديدة.');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      Alert.alert('تم تحديث كلمة المرور', 'يمكنك الآن المتابعة باستخدام كلمة المرور الجديدة.');
      router.replace('/(tabs)');
    } catch (error: unknown) {
      Alert.alert('تعذر تحديث كلمة المرور', error instanceof Error ? error.message : 'اطلب رابطًا جديدًا وحاول مرة أخرى.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.card}>
        <View style={styles.icon}><LockKeyhole size={23} color={colors.primary} /></View>
        <Text style={styles.title}>اختيار كلمة مرور جديدة</Text>
        <Text style={styles.description}>أنشئ كلمة مرور قوية لا تقل عن 8 أحرف.</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          placeholder="كلمة المرور الجديدة"
          placeholderTextColor={colors.textSecondary}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="new-password"
          textContentType="newPassword"
        />
        <TextInput
          style={styles.input}
          value={confirmation}
          onChangeText={setConfirmation}
          placeholder="تأكيد كلمة المرور"
          placeholderTextColor={colors.textSecondary}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="new-password"
          textContentType="newPassword"
        />
        <TouchableOpacity
          style={[styles.button, loading && styles.disabled]}
          onPress={() => void updatePassword()}
          disabled={loading}
          accessibilityRole="button"
        >
          {loading
            ? <ActivityIndicator color={colors.background} />
            : <Text style={styles.buttonText}>حفظ كلمة المرور</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', backgroundColor: colors.background, padding: 20 },
  card: { padding: 22, borderRadius: 24, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  icon: { width: 48, height: 48, borderRadius: 16, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  title: { color: colors.text, fontSize: 20, fontWeight: '800', textAlign: 'right' },
  description: { color: colors.textSecondary, fontSize: 13, textAlign: 'right', lineHeight: 20, marginTop: 8, marginBottom: 18 },
  input: { minHeight: 52, borderRadius: 15, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 15, color: colors.text, fontSize: 15, marginBottom: 12, textAlign: 'right' },
  button: { minHeight: 52, borderRadius: 15, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  disabled: { opacity: 0.5 },
  buttonText: { color: colors.background, fontSize: 15, fontWeight: '800' },
});
