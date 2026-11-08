import { useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronLeft, KeyRound } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import { useAuthStore } from '@/store/auth';

export default function PasswordScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const emailIdentity = user?.identities?.some((identity) => identity.provider === 'email') ?? false;
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const savePassword = async () => {
    if (newPassword.length < 8) {
      Alert.alert('كلمة المرور قصيرة', 'استخدم 8 أحرف على الأقل.');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('كلمتا المرور غير متطابقتين', 'تحقق من كلمة المرور الجديدة.');
      return;
    }
    if (emailIdentity && (!user?.email || !currentPassword)) {
      Alert.alert('تحقق من كلمة المرور الحالية', 'أدخل كلمة المرور الحالية للمتابعة.');
      return;
    }

    setLoading(true);
    try {
      if (emailIdentity && user?.email) {
        const { error: verificationError } = await supabase.auth.signInWithPassword({
          email: user.email,
          password: currentPassword,
        });
        if (verificationError) throw new Error('كلمة المرور الحالية غير صحيحة.');
      }
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      Alert.alert('تم التحديث', 'تم تحديث كلمة المرور بنجاح.', [{ text: 'حسنًا', onPress: () => router.back() }]);
    } catch (error: unknown) {
      Alert.alert('تعذر تحديث كلمة المرور', error instanceof Error ? error.message : 'حاول مرة أخرى.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} accessibilityLabel="رجوع">
          <ChevronLeft size={22} color={colors.textSecondary} />
        </TouchableOpacity>
        <Text style={styles.title}>كلمة المرور</Text>
      </View>

      <View style={styles.card}>
        <View style={styles.icon}><KeyRound size={23} color={colors.primary} /></View>
        <Text style={styles.description}>استخدم كلمة مرور قوية لا تقل عن 8 أحرف.</Text>
        {emailIdentity && (
          <TextInput
            style={styles.input}
            value={currentPassword}
            onChangeText={setCurrentPassword}
            placeholder="كلمة المرور الحالية"
            placeholderTextColor={colors.textSecondary}
            secureTextEntry
            textAlign="right"
            autoCapitalize="none"
          />
        )}
        <TextInput
          style={styles.input}
          value={newPassword}
          onChangeText={setNewPassword}
          placeholder="كلمة المرور الجديدة"
          placeholderTextColor={colors.textSecondary}
          secureTextEntry
          textAlign="right"
          autoCapitalize="none"
        />
        <TextInput
          style={styles.input}
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          placeholder="تأكيد كلمة المرور الجديدة"
          placeholderTextColor={colors.textSecondary}
          secureTextEntry
          textAlign="right"
          autoCapitalize="none"
        />
        <TouchableOpacity style={[styles.button, loading && styles.disabledButton]} onPress={savePassword} disabled={loading}>
          {loading
            ? <ActivityIndicator color={colors.background} />
            : <Text style={styles.buttonText}>حفظ كلمة المرور</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, paddingHorizontal: 20, paddingTop: 58 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 26 },
  backButton: { position: 'absolute', left: 0, padding: 8 },
  title: { color: colors.text, fontSize: 20, fontWeight: '800' },
  card: { padding: 22, borderRadius: 24, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  icon: {
    width: 48, height: 48, borderRadius: 16, backgroundColor: colors.primarySoft,
    alignItems: 'center', justifyContent: 'center', marginBottom: 14,
  },
  description: { color: colors.textSecondary, fontSize: 14, textAlign: 'right', marginBottom: 18 },
  input: {
    minHeight: 52, borderRadius: 15, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 15, color: colors.text, fontSize: 15, marginBottom: 12,
  },
  button: {
    minHeight: 52, borderRadius: 15, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center', marginTop: 8,
  },
  disabledButton: { opacity: 0.5 },
  buttonText: { color: colors.background, fontSize: 15, fontWeight: '800' },
});
