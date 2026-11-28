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
      setError('ط³ط¬ظ‘ظ„ ط§ظ„ط¯ط®ظˆظ„ ط£ظˆظ„ظ‹ط§.');
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
      setError(caught instanceof Error ? caught.message : 'طھط¹ط°ط± طھط­ظ…ظٹظ„ ط­ط§ظ„ط© ط§ظ„ط·ظ„ط¨.');
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
      Alert.alert('ط±ط§ط¬ط¹ ط§ظ„ط·ظ„ط¨', 'ط§ظƒطھط¨ ظ†ط¨ط°ط© ظ…ظ† 20 ط¥ظ„ظ‰ 2000 ط­ط±ظپ.');
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
      Alert.alert('طھظ… ط¥ط±ط³ط§ظ„ ط§ظ„ط·ظ„ط¨', 'ط³طھط±ط§ط¬ط¹ ط§ظ„ط¥ط¯ط§ط±ط© ط·ظ„ط¨ طھظˆط«ظٹظ‚ ط­ط³ط§ط¨ظƒطŒ ظˆظٹط¸ظ„ ط¨ط±ظ†ط§ظ…ط¬ ط§ظ„ظ…ط¶ظٹظپط§طھ ظ…ظ†ظپطµظ„ظ‹ط§.');
    } catch (caught: unknown) {
      Alert.alert('طھط¹ط°ط± ط¥ط±ط³ط§ظ„ ط§ظ„ط·ظ„ط¨', caught instanceof Error ? caught.message : 'ط­ط§ظˆظ„ ظ…ط±ط© ط£ط®ط±ظ‰.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} accessibilityLabel="ط±ط¬ظˆط¹">
          <ArrowLeft size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>طھظˆط«ظٹظ‚ ط§ظ„ط­ط³ط§ط¨</Text>
      </View>

      {loading ? (
        <View style={styles.state}><ActivityIndicator color={colors.primary} /></View>
      ) : error ? (
        <View style={styles.state}>
          <Text style={styles.error}>{error}</Text>
          <TouchableOpacity onPress={() => void load()}><Text style={styles.retry}>ط¥ط¹ط§ط¯ط© ط§ظ„ظ…ط­ط§ظˆظ„ط©</Text></TouchableOpacity>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.hero}>
            <View style={styles.icon}><Mic size={26} color={colors.gold} /></View>
            <Text style={styles.title}>ط´ط§ط±ط© ظ…ظˆط«ظˆظ‚ظٹط© ظ„ط­ط³ط§ط¨ظƒ</Text>
            <Text style={styles.copy}>
              ظ‡ط°ط§ ط§ظ„ط·ظ„ط¨ ظ„ظ…ط±ط§ط¬ط¹ط© ط§ظ„طھظˆط«ظٹظ‚ ظپظ‚ط·طŒ ظˆظ„ط§ ظٹط¶ظٹظپظƒ ط¥ظ„ظ‰ ط¨ط±ظ†ط§ظ…ط¬ ط§ظ„ظ…ط¶ظٹظپط§طھ ط£ظˆ ظٹظ…ظ†ط­ طµظ„ط§ط­ظٹط© ط§ظ„ط±ط³ط§ط¦ظ„ ط§ظ„ط§ظپطھطھط§ط­ظٹط©. ط¨ط±ظ†ط§ظ…ط¬ ط§ظ„ظ…ط¶ظٹظپط§طھ ظ…ظ†ظپطµظ„ ظˆطھط¹ظٹظ‘ظ†ظ‡ ط§ظ„ط¥ط¯ط§ط±ط© ط¨ط¹ط¯ ظ…ظˆط§ظپظ‚طھظƒ.
            </Text>
          </View>

          {isVerifiedHost ? (
            <View style={styles.statusCard}>
              <BadgeCheck size={24} color={colors.success} />
              <View style={styles.statusCopy}>
                <Text style={styles.statusTitle}>ط­ط³ط§ط¨ظƒ ظ…ظˆط«ظ‘ظ‚</Text>
                <Text style={styles.copy}>طھط¸ظ‡ط± ط´ط§ط±ط© ط§ظ„طھظˆط«ظٹظ‚ ظ„ظ„ط¢ط®ط±ظٹظ†. ظ‡ط°ظ‡ ط§ظ„ط´ط§ط±ط© ظ…ط³طھظ‚ظ„ط© ط¹ظ† ط¹ط¶ظˆظٹط© ط¨ط±ظ†ط§ظ…ط¬ ط§ظ„ظ…ط¶ظٹظپط§طھ.</Text>
              </View>
            </View>
          ) : application?.status === 'pending' ? (
            <View style={styles.statusCard}>
              <ActivityIndicator color={colors.gold} />
              <View style={styles.statusCopy}>
                <Text style={styles.statusTitle}>ط·ظ„ط¨ظƒ ظ‚ظٹط¯ ط§ظ„ظ…ط±ط§ط¬ط¹ط©</Text>
                <Text style={styles.copy}>ط£ط±ط³ظ„ ط¨طھط§ط±ظٹط® {new Date(application.created_at).toLocaleDateString('ar')}.</Text>
              </View>
            </View>
          ) : (
            <>
              {application?.status === 'rejected' && (
                <View style={styles.rejectedCard}>
                  <Text style={styles.statusTitle}>ظ„ظ… طھطھظ… ط§ظ„ظ…ظˆط§ظپظ‚ط© ط¹ظ„ظ‰ ط§ظ„ط·ظ„ط¨ ط§ظ„ط³ط§ط¨ظ‚</Text>
                  {application.review_note ? <Text style={styles.copy}>ظ…ظ„ط§ط­ط¸ط© ط§ظ„ط¥ط¯ط§ط±ط©: {application.review_note}</Text> : null}
                </View>
              )}
              <View style={styles.formCard}>
                <Text style={styles.formTitle}>ط·ظ„ط¨ طھظˆط«ظٹظ‚ ط§ظ„ط­ط³ط§ط¨</Text>
                <Text style={styles.copy}>ط§ظƒطھط¨ظٹ ظ†ط¨ط°ط© طھط³ط§ط¹ط¯ ط§ظ„ط¥ط¯ط§ط±ط© ط¹ظ„ظ‰ ظ…ط±ط§ط¬ط¹ط© ظ‡ظˆظٹطھظƒ ظˆظ…ظˆط«ظˆظ‚ظٹط© ط§ظ„ط­ط³ط§ط¨. ط§ظ„ط­ط¯ ط§ظ„ط£ط¯ظ†ظ‰ 20 ط­ط±ظپظ‹ط§.</Text>
                <TextInput
                  value={applicationText}
                  onChangeText={setApplicationText}
                  placeholder="ط¹ط±ظ‘ظپظٹ ط§ظ„ط¥ط¯ط§ط±ط© ط¨ظ†ظپط³ظƒ..."
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
                    : <Text style={styles.submitText}>ط¥ط±ط³ط§ظ„ ظ„ظ„ظ…ط±ط§ط¬ط¹ط©</Text>}
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
