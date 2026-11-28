import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { ArrowLeft, BadgeCheck, Mic } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { colors as themeColors, fonts } from '@/lib/theme';

const colors = {
  background: themeColors.background,
  surface: themeColors.surface,
  elevated: themeColors.surfaceElevated,
  border: themeColors.border,
  text: themeColors.text,
  muted: themeColors.textSecondary,
  primary: themeColors.primary,
  gold: themeColors.gold,
  success: themeColors.teal,
  danger: themeColors.danger,
};

interface HostApplication {
  id: string;
  application_text: string;
  status: 'pending' | 'approved' | 'rejected';
  review_note: string | null;
  created_at: string;
}

export default function HostApplicationScreen() {
  const router = useRouter();
  const { profile } = useAuthStore();
  const [application, setApplication] = useState<HostApplication | null>(null);
  const [isVerifiedHost, setIsVerifiedHost] = useState(false);
  const [applicationText, setApplicationText] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!profile?.id) {
      setLoading(false);
      setError('سجّل الدخول أولًا.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const [applicationResult, hostResult] = await Promise.all([
        supabase
          .from('host_applications')
          .select('id, application_text, status, review_note, created_at')
          .eq('user_id', profile.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('verified_hosts')
          .select('user_id')
          .eq('user_id', profile.id)
          .eq('status', 'active')
          .maybeSingle(),
      ]);
      if (applicationResult.error) throw applicationResult.error;
      if (hostResult.error) throw hostResult.error;
      setApplication(applicationResult.data as HostApplication | null);
      setIsVerifiedHost(Boolean(hostResult.data));
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'تعذر تحميل حالة الطلب.');
    } finally {
      setLoading(false);
    }
  }, [profile?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    const text = applicationText.trim();
    if (text.length < 20 || text.length > 2000 || submitting) {
      Alert.alert('راجع الطلب', 'اكتب نبذة من 20 إلى 2000 حرف.');
      return;
    }

    setSubmitting(true);
    try {
      const { error: submitError } = await supabase.rpc('submit_host_application', {
        p_application_text: text,
      });
      if (submitError) throw submitError;
      setApplicationText('');
      await load();
      Alert.alert('تم إرسال الطلب', 'ستراجع الإدارة طلب توثيق حسابك، ويظل برنامج المضيفات منفصلًا.');
    } catch (caught: unknown) {
      Alert.alert('تعذر إرسال الطلب', caught instanceof Error ? caught.message : 'حاول مرة أخرى.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} accessibilityLabel="رجوع">
          <ArrowLeft size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>توثيق الحساب</Text>
      </View>

      {loading ? (
        <View style={styles.state}><ActivityIndicator color={colors.primary} /></View>
      ) : error ? (
        <View style={styles.state}>
          <Text style={styles.error}>{error}</Text>
          <TouchableOpacity onPress={() => void load()}><Text style={styles.retry}>إعادة المحاولة</Text></TouchableOpacity>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.hero}>
            <View style={styles.icon}><Mic size={26} color={colors.gold} /></View>
            <Text style={styles.title}>شارة موثوقية لحسابك</Text>
            <Text style={styles.copy}>
              هذا الطلب لمراجعة التوثيق فقط، ولا يضيفك إلى برنامج المضيفات أو يمنح صلاحية الرسائل الافتتاحية. برنامج المضيفات منفصل وتعيّنه الإدارة بعد موافقتك.
            </Text>
          </View>

          {isVerifiedHost ? (
            <View style={styles.statusCard}>
              <BadgeCheck size={24} color={colors.success} />
              <View style={styles.statusCopy}>
                <Text style={styles.statusTitle}>حسابك موثّق</Text>
                <Text style={styles.copy}>تظهر شارة التوثيق للآخرين. هذه الشارة مستقلة عن عضوية برنامج المضيفات.</Text>
              </View>
            </View>
          ) : application?.status === 'pending' ? (
            <View style={styles.statusCard}>
              <ActivityIndicator color={colors.gold} />
              <View style={styles.statusCopy}>
                <Text style={styles.statusTitle}>طلبك قيد المراجعة</Text>
                <Text style={styles.copy}>أرسل بتاريخ {new Date(application.created_at).toLocaleDateString('ar')}.</Text>
              </View>
            </View>
          ) : (
            <>
              {application?.status === 'rejected' && (
                <View style={styles.rejectedCard}>
                  <Text style={styles.statusTitle}>لم تتم الموافقة على الطلب السابق</Text>
                  {application.review_note ? <Text style={styles.copy}>ملاحظة الإدارة: {application.review_note}</Text> : null}
                </View>
              )}
              <View style={styles.formCard}>
                <Text style={styles.formTitle}>طلب توثيق الحساب</Text>
                <Text style={styles.copy}>اكتبي نبذة تساعد الإدارة على مراجعة هويتك وموثوقية الحساب. الحد الأدنى 20 حرفًا.</Text>
                <TextInput
                  value={applicationText}
                  onChangeText={setApplicationText}
                  placeholder="عرّفي الإدارة بنفسك..."
                  placeholderTextColor={colors.muted}
                  multiline
                  maxLength={2000}
                  textAlignVertical="top"
                  style={styles.input}
                />
                <Text style={styles.counter}>{applicationText.trim().length}/2000</Text>
                <TouchableOpacity
                  style={[styles.submitButton, submitting && styles.disabled]}
                  onPress={() => void submit()}
                  disabled={submitting}
                  accessibilityRole="button"
                >
                  {submitting
                    ? <ActivityIndicator size="small" color={colors.text} />
                    : <Text style={styles.submitText}>إرسال للمراجعة</Text>}
                </TouchableOpacity>
              </View>
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 56, paddingBottom: 14, gap: 12 },
  backButton: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  headerTitle: { color: colors.text, fontSize: 20, fontFamily: fonts.bold },
  content: { padding: 18, paddingBottom: 36, gap: 16 },
  state: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  hero: { borderWidth: 1, borderColor: colors.border, borderRadius: 22, padding: 20, backgroundColor: colors.surface, alignItems: 'center' },
  icon: { width: 56, height: 56, borderRadius: 18, backgroundColor: colors.elevated, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  title: { color: colors.text, fontSize: 22, fontFamily: fonts.black, textAlign: 'center' },
  copy: { color: colors.muted, fontSize: 13, lineHeight: 21, textAlign: 'center', marginTop: 8 },
  statusCard: { flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 18, padding: 18, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
  statusCopy: { flex: 1 },
  statusTitle: { color: colors.text, fontSize: 16, fontFamily: fonts.bold },
  rejectedCard: { borderRadius: 18, padding: 18, backgroundColor: themeColors.dangerSoft, borderColor: themeColors.dangerGlow, borderWidth: 1 },
  formCard: { borderRadius: 18, padding: 18, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
  formTitle: { color: colors.text, fontSize: 17, fontFamily: fonts.bold },
  input: { minHeight: 150, marginTop: 16, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.elevated, padding: 14, color: colors.text, fontSize: 14, lineHeight: 22 },
  counter: { color: colors.muted, fontSize: 11, textAlign: 'left', marginTop: 6 },
  submitButton: { minHeight: 48, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  submitText: { color: colors.text, fontSize: 14, fontFamily: fonts.bold },
  disabled: { opacity: 0.6 },
  error: { color: colors.danger, textAlign: 'center' },
  retry: { color: colors.primary, fontFamily: fonts.semibold },
});
