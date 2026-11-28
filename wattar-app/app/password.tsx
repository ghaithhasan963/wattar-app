import { useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronLeft, KeyRound } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { colors, fonts } from '@/lib/theme';
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
      Alert.alert('ظƒظ„ظ…ط© ط§ظ„ظ…ط±ظˆط± ظ‚طµظٹط±ط©', 'ط§ط³طھط®ط¯ظ… 8 ط£ط­ط±ظپ ط¹ظ„ظ‰ ط§ظ„ط£ظ‚ظ„.');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('ظƒظ„ظ…طھط§ ط§ظ„ظ…ط±ظˆط± ط؛ظٹط± ظ…طھط·ط§ط¨ظ‚طھظٹظ†', 'طھط­ظ‚ظ‚ ظ…ظ† ظƒظ„ظ…ط© ط§ظ„ظ…ط±ظˆط± ط§ظ„ط¬ط¯ظٹط¯ط©.');
      return;
    }
    if (emailIdentity && (!user?.email || !currentPassword)) {
      Alert.alert('طھط­ظ‚ظ‚ ظ…ظ† ظƒظ„ظ…ط© ط§ظ„ظ…ط±ظˆط± ط§ظ„ط­ط§ظ„ظٹط©', 'ط£ط¯ط®ظ„ ظƒظ„ظ…ط© ط§ظ„ظ…ط±ظˆط± ط§ظ„ط­ط§ظ„ظٹط© ظ„ظ„ظ…طھط§ط¨ط¹ط©.');
      return;
    }

    setLoading(true);
    try {
      if (emailIdentity && user?.email) {
        const { error: verificationError } = await supabase.auth.signInWithPassword({
          email: user.email,
          password: currentPassword,
        });
        if (verificationError) throw new Error('ظƒظ„ظ…ط© ط§ظ„ظ…ط±ظˆط± ط§ظ„ط­ط§ظ„ظٹط© ط؛ظٹط± طµط­ظٹط­ط©.');
      }
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      Alert.alert('طھظ… ط§ظ„طھط­ط¯ظٹط«', 'طھظ… طھط­ط¯ظٹط« ظƒظ„ظ…ط© ط§ظ„ظ…ط±ظˆط± ط¨ظ†ط¬ط§ط­.', [{ text: 'ط­ط³ظ†ظ‹ط§', onPress: () => router.back() }]);
    } catch (error: unknown) {
      Alert.alert('طھط¹ط°ط± طھط­ط¯ظٹط« ظƒظ„ظ…ط© ط§ظ„ظ…ط±ظˆط±', error instanceof Error ? error.message : 'ط­ط§ظˆظ„ ظ…ط±ط© ط£ط®ط±ظ‰.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} accessibilityLabel="ط±ط¬ظˆط¹">
          <ChevronLeft size={22} color={colors.textSecondary} />
        </TouchableOpacity>
        <Text style={styles.title}>ظƒظ„ظ…ط© ط§ظ„ظ…ط±ظˆط±</Text>
      </View>

      <View style={styles.card}>
        <View style={styles.icon}><KeyRound size={23} color={colors.primary} /></View>
        <Text style={styles.description}>ط§ط³طھط®ط¯ظ… ظƒظ„ظ…ط© ظ…ط±ظˆط± ظ‚ظˆظٹط© ظ„ط§ طھظ‚ظ„ ط¹ظ† 8 ط£ط­ط±ظپ.</Text>
        {emailIdentity && (
          <TextInput
            style={styles.input}
            value={currentPassword}
            onChangeText={setCurrentPassword}
            placeholder="ظƒظ„ظ…ط© ط§ظ„ظ…ط±ظˆط± ط§ظ„ط­ط§ظ„ظٹط©"
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
          placeholder="ظƒظ„ظ…ط© ط§ظ„ظ…ط±ظˆط± ط§ظ„ط¬ط¯ظٹط¯ط©"
          placeholderTextColor={colors.textSecondary}
          secureTextEntry
          textAlign="right"
          autoCapitalize="none"
        />
        <TextInput
          style={styles.input}
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          placeholder="طھط£ظƒظٹط¯ ظƒظ„ظ…ط© ط§ظ„ظ…ط±ظˆط± ط§ظ„ط¬ط¯ظٹط¯ط©"
          placeholderTextColor={colors.textSecondary}
          secureTextEntry
          textAlign="right"
          autoCapitalize="none"
        />
        <TouchableOpacity style={[styles.button, loading && styles.disabledButton]} onPress={savePassword} disabled={loading}>
          {loading
            ? <ActivityIndicator color={colors.background} />
            : <Text style={styles.buttonText}>ط­ظپط¸ ظƒظ„ظ…ط© ط§ظ„ظ…ط±ظˆط±</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, paddingHorizontal: 20, paddingTop: 58 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 26 },
  backButton: { position: 'absolute', left: 0, padding: 8 },
  title: { color: colors.text, fontSize: 20, fontFamily: fonts.bold },
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
  buttonText: { color: colors.background, fontSize: 15, fontFamily: fonts.bold },
});
