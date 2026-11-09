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
import { colors } from '@/lib/theme';
import { useAuthStore } from '@/store/auth';

type Gender = 'female' | 'male' | 'other';
type Visibility = 'public' | 'friends';

const genderOptions: { value: Gender; label: string }[] = [
  { value: 'female', label: 'أنثى' },
  { value: 'male', label: 'ذكر' },
  { value: 'other', label: 'أفضل وصفًا آخر' },
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
      setError('اختر الجنس للمتابعة.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
      setError('أدخل تاريخ الميلاد بصيغة سنة-شهر-يوم، مثل 2000-05-21.');
      return;
    }

    const [year, month, day] = birthDate.split('-').map(Number);
    const parsedDate = new Date(Date.UTC(year, month - 1, day));
    if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== birthDate) {
      setError('تاريخ الميلاد غير صحيح.');
      return;
    }

    setSaving(true);
    try {
      await completeOnboarding({ gender, birthDate, profileVisibility: visibility });
      router.replace('/(tabs)');
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'تعذر حفظ بيانات الملف. حاول مجددًا.');
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
        <Text style={styles.title}>لنجهّز ملفك</Text>
        <Text style={styles.subtitle}>هذه المعلومات تساعدنا على حماية المجتمع وضبط خصوصية حسابك.</Text>

        <View style={styles.card}>
          <Text style={styles.label}>الجنس <Text style={styles.required}>مطلوب</Text></Text>
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

          <Text style={styles.label}>تاريخ الميلاد</Text>
          <TextInput
            style={styles.input}
            value={birthDate}
            onChangeText={(value) => { setBirthDate(value); setError(null); }}
            placeholder="YYYY-MM-DD"
            placeholderTextColor="#756B83"
            keyboardType="numbers-and-punctuation"
            autoComplete="birthdate-full"
            textContentType="birthdate"
            maxLength={10}
            textAlign="left"
            editable={!saving && !loading}
          />

          <Text style={styles.label}>من يمكنه رؤية ملفك؟</Text>
          <View style={styles.visibilityRow}>
            {([
              { value: 'public', label: 'عام', detail: 'يظهر للأعضاء' },
              { value: 'friends', label: 'الأصدقاء فقط', detail: 'إخفاء تفاصيل الملف' },
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
              نتحقق من بلوغ 18 عامًا على الخادم ولا نحتفظ بتاريخ ميلادك. هذا ليس توثيق هوية؛ لن نطلب رفع صورة هويتك هنا.
            </Text>
          </View>

          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          <TouchableOpacity
            style={[styles.submitButton, (saving || loading) && styles.disabled]}
            onPress={submit}
            disabled={saving || loading}
            accessibilityRole="button"
          >
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>حفظ ومتابعة</Text>}
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={styles.leaveButton} onPress={leave} disabled={saving}>
          <Text style={styles.leaveText}>تسجيل الخروج</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 20, paddingTop: 40, paddingBottom: 24 },
  icon: { width: 54, height: 54, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: colors.primarySoft, alignSelf: 'flex-end', marginBottom: 15 },
  title: { color: colors.text, fontSize: 25, fontWeight: '900', textAlign: 'right' },
  subtitle: { color: colors.textSecondary, fontSize: 13, lineHeight: 21, textAlign: 'right', marginTop: 7, marginBottom: 20 },
  card: { padding: 18, borderRadius: 22, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  label: { color: colors.text, fontSize: 13, fontWeight: '800', textAlign: 'right', marginTop: 17, marginBottom: 9 },
  required: { color: colors.gold, fontSize: 11 },
  optionRow: { flexDirection: 'row-reverse', gap: 7 },
  option: { flex: 1, minHeight: 43, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
  optionSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  optionText: { color: colors.textSecondary, fontSize: 11, fontWeight: '700', textAlign: 'center' },
  optionTextSelected: { color: colors.text },
  input: { minHeight: 50, color: colors.text, fontSize: 15, paddingHorizontal: 14, borderRadius: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
  visibilityRow: { flexDirection: 'row', gap: 8 },
  visibilityOption: { flex: 1, minHeight: 77, alignItems: 'center', justifyContent: 'center', gap: 5, padding: 8, borderRadius: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
  optionDetail: { color: colors.textSecondary, fontSize: 10, textAlign: 'center' },
  privacyNote: { flexDirection: 'row-reverse', alignItems: 'flex-start', gap: 8, padding: 12, marginTop: 18, borderRadius: 12, backgroundColor: '#211B2C' },
  privacyText: { flex: 1, color: colors.textSecondary, fontSize: 11, lineHeight: 18, textAlign: 'right' },
  error: { color: colors.danger, fontSize: 12, lineHeight: 18, textAlign: 'right', marginTop: 12 },
  submitButton: { minHeight: 51, alignItems: 'center', justifyContent: 'center', marginTop: 18, borderRadius: 14, backgroundColor: colors.primary },
  disabled: { opacity: 0.55 },
  submitText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  leaveButton: { alignItems: 'center', paddingVertical: 17 },
  leaveText: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
});
