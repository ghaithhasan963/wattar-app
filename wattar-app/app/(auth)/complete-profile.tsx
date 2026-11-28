import { useState } from 'react';
import {
  ActivityIndicator,
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
import { LockKeyhole, ShieldCheck } from 'lucide-react-native';
import { colors, fonts } from '@/lib/theme';
import { useAuthStore } from '@/store/auth';

type Gender = 'female' | 'male' | 'other';
type Visibility = 'public' | 'friends';

const genderOptions: { value: Gender; label: string }[] = [
  { value: 'female', label: 'ط£ظ†ط«ظ‰' },
  { value: 'male', label: 'ط°ظƒط±' },
  { value: 'other', label: 'ط£ظپط¶ظ„ ظˆطµظپظ‹ط§ ط¢ط®ط±' },
];

export default function CompleteProfileScreen() {
  const router = useRouter();
  const { completeOnboarding, signOut, loading } = useAuthStore();
  const [gender, setGender] = useState<Gender | null>(null);
  const [birthDate, setBirthDate] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('public');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!gender) {
      setError('ط§ط®طھط± ط§ظ„ط¬ظ†ط³ ظ„ظ„ظ…طھط§ط¨ط¹ط©.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
      setError('ط£ط¯ط®ظ„ طھط§ط±ظٹط® ط§ظ„ظ…ظٹظ„ط§ط¯ ط¨طµظٹط؛ط© ط³ظ†ط©-ط´ظ‡ط±-ظٹظˆظ…طŒ ظ…ط«ظ„ 2000-05-21.');
      return;
    }

    const [year, month, day] = birthDate.split('-').map(Number);
    const parsedDate = new Date(Date.UTC(year, month - 1, day));
    if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== birthDate) {
      setError('طھط§ط±ظٹط® ط§ظ„ظ…ظٹظ„ط§ط¯ ط؛ظٹط± طµط­ظٹط­.');
      return;
    }

    setSaving(true);
    try {
      await completeOnboarding({ gender, birthDate, profileVisibility: visibility });
      router.replace('/(tabs)');
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'طھط¹ط°ط± ط­ظپط¸ ط¨ظٹط§ظ†ط§طھ ط§ظ„ظ…ظ„ظپ. ط­ط§ظˆظ„ ظ…ط¬ط¯ط¯ظ‹ط§.');
    } finally {
      setSaving(false);
    }
  };

  const leave = async () => {
    await signOut();
    router.replace('/(auth)/login');
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.icon}><ShieldCheck size={27} color={colors.primary} /></View>
        <Text style={styles.title}>ظ„ظ†ط¬ظ‡ظ‘ط² ظ…ظ„ظپظƒ</Text>
        <Text style={styles.subtitle}>ظ‡ط°ظ‡ ط§ظ„ظ…ط¹ظ„ظˆظ…ط§طھ طھط³ط§ط¹ط¯ظ†ط§ ط¹ظ„ظ‰ ط­ظ…ط§ظٹط© ط§ظ„ظ…ط¬طھظ…ط¹ ظˆط¶ط¨ط· ط®طµظˆطµظٹط© ط­ط³ط§ط¨ظƒ.</Text>

        <View style={styles.card}>
          <Text style={styles.label}>ط§ظ„ط¬ظ†ط³ <Text style={styles.required}>ظ…ط·ظ„ظˆط¨</Text></Text>
          <View style={styles.optionRow}>
            {genderOptions.map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[styles.option, gender === option.value && styles.optionSelected]}
                onPress={() => setGender(option.value)}
                accessibilityRole="radio"
                accessibilityState={{ selected: gender === option.value }}
              >
                <Text style={[styles.optionText, gender === option.value && styles.optionTextSelected]}>
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>طھط§ط±ظٹط® ط§ظ„ظ…ظٹظ„ط§ط¯</Text>
          <TextInput
            style={styles.input}
            value={birthDate}
            onChangeText={(value) => { setBirthDate(value); setError(null); }}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={colors.textMuted}
            keyboardType="numbers-and-punctuation"
            autoComplete="birthdate-full"
            textContentType="birthdate"
            maxLength={10}
            textAlign="left"
            editable={!saving && !loading}
          />

          <Text style={styles.label}>ظ…ظ† ظٹظ…ظƒظ†ظ‡ ط±ط¤ظٹط© ظ…ظ„ظپظƒطں</Text>
          <View style={styles.visibilityRow}>
            {([
              { value: 'public', label: 'ط¹ط§ظ…', detail: 'ظٹط¸ظ‡ط± ظ„ظ„ط£ط¹ط¶ط§ط،' },
              { value: 'friends', label: 'ط§ظ„ط£طµط¯ظ‚ط§ط، ظپظ‚ط·', detail: 'ط¥ط®ظپط§ط، طھظپط§طµظٹظ„ ط§ظ„ظ…ظ„ظپ' },
            ] as const).map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[styles.visibilityOption, visibility === option.value && styles.optionSelected]}
                onPress={() => setVisibility(option.value)}
                accessibilityRole="radio"
                accessibilityState={{ selected: visibility === option.value }}
              >
                {option.value === 'friends' && <LockKeyhole size={15} color={visibility === option.value ? colors.primary : colors.textSecondary} />}
                <Text style={[styles.optionText, visibility === option.value && styles.optionTextSelected]}>{option.label}</Text>
                <Text style={styles.optionDetail}>{option.detail}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.privacyNote}>
            <LockKeyhole size={16} color={colors.gold} />
            <Text style={styles.privacyText}>
              ظ†طھط­ظ‚ظ‚ ظ…ظ† ط¨ظ„ظˆط؛ 18 ط¹ط§ظ…ظ‹ط§ ط¹ظ„ظ‰ ط§ظ„ط®ط§ط¯ظ… ظˆظ„ط§ ظ†ط­طھظپط¸ ط¨طھط§ط±ظٹط® ظ…ظٹظ„ط§ط¯ظƒ. ظ‡ط°ط§ ظ„ظٹط³ طھظˆط«ظٹظ‚ ظ‡ظˆظٹط©ط› ظ„ظ† ظ†ط·ظ„ط¨ ط±ظپط¹ طµظˆط±ط© ظ‡ظˆظٹطھظƒ ظ‡ظ†ط§.
            </Text>
          </View>

          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          <TouchableOpacity
            style={[styles.submitButton, (saving || loading) && styles.disabled]}
            onPress={submit}
            disabled={saving || loading}
            accessibilityRole="button"
          >
            {saving ? <ActivityIndicator color={colors.text} /> : <Text style={styles.submitText}>ط­ظپط¸ ظˆظ…طھط§ط¨ط¹ط©</Text>}
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={styles.leaveButton} onPress={leave} disabled={saving}>
          <Text style={styles.leaveText}>طھط³ط¬ظٹظ„ ط§ظ„ط®ط±ظˆط¬</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 20, paddingTop: 40, paddingBottom: 24 },
  icon: { width: 54, height: 54, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: colors.primarySoft, alignSelf: 'flex-end', marginBottom: 15 },
  title: { color: colors.text, fontSize: 25, fontFamily: fonts.black, textAlign: 'right' },
  subtitle: { color: colors.textSecondary, fontSize: 13, lineHeight: 21, textAlign: 'right', marginTop: 7, marginBottom: 20 },
  card: { padding: 18, borderRadius: 22, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  label: { color: colors.text, fontSize: 13, fontFamily: fonts.bold, textAlign: 'right', marginTop: 17, marginBottom: 9 },
  required: { color: colors.gold, fontSize: 11 },
  optionRow: { flexDirection: 'row-reverse', gap: 7 },
  option: { flex: 1, minHeight: 43, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
  optionSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  optionText: { color: colors.textSecondary, fontSize: 11, fontFamily: fonts.semibold, textAlign: 'center' },
  optionTextSelected: { color: colors.text },
  input: { minHeight: 50, color: colors.text, fontSize: 15, paddingHorizontal: 14, borderRadius: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
  visibilityRow: { flexDirection: 'row', gap: 8 },
  visibilityOption: { flex: 1, minHeight: 77, alignItems: 'center', justifyContent: 'center', gap: 5, padding: 8, borderRadius: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
  optionDetail: { color: colors.textSecondary, fontSize: 10, textAlign: 'center' },
  privacyNote: { flexDirection: 'row-reverse', alignItems: 'flex-start', gap: 8, padding: 12, marginTop: 18, borderRadius: 12, backgroundColor: colors.surfaceMuted },
  privacyText: { flex: 1, color: colors.textSecondary, fontSize: 11, lineHeight: 18, textAlign: 'right' },
  error: { color: colors.danger, fontSize: 12, lineHeight: 18, textAlign: 'right', marginTop: 12 },
  submitButton: { minHeight: 51, alignItems: 'center', justifyContent: 'center', marginTop: 18, borderRadius: 14, backgroundColor: colors.primary },
  disabled: { opacity: 0.55 },
  submitText: { color: colors.text, fontSize: 14, fontFamily: fonts.bold },
  leaveButton: { alignItems: 'center', paddingVertical: 17 },
  leaveText: { color: colors.textSecondary, fontSize: 12, fontFamily: fonts.semibold },
});
