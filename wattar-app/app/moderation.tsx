import React, { useCallback, useEffect, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronRight, Gavel, ShieldAlert } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { colors, fonts } from '@/lib/theme';

interface ActivePenalty {
  id: string;
  penalty_type: 'warning' | 'mute' | 'kick' | 'temp_ban' | 'permanent_ban';
  reason: string;
  starts_at: string;
  ends_at: string | null;
}

interface Appeal {
  id: string;
  penalty_id: string | null;
  status: 'pending' | 'approved' | 'rejected';
  statement: string;
  review_note: string | null;
  created_at: string;
}

interface ModerationStatus {
  violations_in_window: number;
  window_days: number;
  active_penalties: ActivePenalty[];
  appeals: Appeal[];
}

const PENALTY_LABELS: Record<ActivePenalty['penalty_type'], string> = {
  warning: 'طھط­ط°ظٹط±',
  mute: 'ظƒطھظ… ط§ظ„ظ…ط­ط§ط¯ط«ط©',
  kick: 'ط·ط±ط¯ ظ…ظ† ط؛ط±ظپط©',
  temp_ban: 'ط­ط¸ط± ظ…ط¤ظ‚طھ',
  permanent_ban: 'ط­ط¸ط± ط¯ط§ط¦ظ…',
};

const APPEAL_STATUS_LABELS: Record<Appeal['status'], string> = {
  pending: 'ظ‚ظٹط¯ ط§ظ„ظ…ط±ط§ط¬ط¹ط©',
  approved: 'ظ…ظ‚ط¨ظˆظ„',
  rejected: 'ظ…ط±ظپظˆط¶',
};

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('ar', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function ModerationScreen() {
  const router = useRouter();
  const [status, setStatus] = useState<ModerationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [appealingPenaltyId, setAppealingPenaltyId] = useState<string | null>(null);
  const [appealText, setAppealText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_my_moderation_status');
      if (error) throw error;
      setStatus(data as ModerationStatus);
    } catch (error: unknown) {
      Alert.alert('طھط¹ط°ط± طھط­ظ…ظٹظ„ ط§ظ„ط­ط§ظ„ط©', error instanceof Error ? error.message : 'ط­ط§ظˆظ„ ظ…ط±ط© ط£ط®ط±ظ‰.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const pendingAppealPenaltyIds = new Set(
    (status?.appeals ?? []).filter((appeal) => appeal.status === 'pending' && appeal.penalty_id).map((appeal) => appeal.penalty_id as string),
  );

  const submitAppeal = async () => {
    if (!appealingPenaltyId) return;
    const text = appealText.trim();
    if (text.length < 10) {
      Alert.alert('ظ†طµ ظ‚طµظٹط±', 'ظ†طµ ط§ظ„ط§ط¹طھط±ط§ط¶ ظٹط¬ط¨ ط£ظ† ظٹظƒظˆظ† 10 ط£ط­ط±ظپ ط¹ظ„ظ‰ ط§ظ„ط£ظ‚ظ„.');
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.rpc('submit_moderation_appeal', {
        p_penalty_id: appealingPenaltyId,
        p_statement: text,
      });
      if (error) throw error;
      setAppealingPenaltyId(null);
      setAppealText('');
      await loadStatus();
      Alert.alert('طھظ… ط§ظ„ط¥ط±ط³ط§ظ„', 'ظˆطµظ„ ط§ط¹طھط±ط§ط¶ظƒ ظˆط³ظٹطھظ… ظ…ط±ط§ط¬ط¹طھظ‡ ظ…ظ† ظپط±ظٹظ‚ ط§ظ„ط¥ط´ط±ط§ظپ.');
    } catch (error: unknown) {
      Alert.alert('طھط¹ط°ط± ط¥ط±ط³ط§ظ„ ط§ظ„ط§ط¹طھط±ط§ط¶', error instanceof Error ? error.message : 'ط­ط§ظˆظ„ ظ…ط±ط© ط£ط®ط±ظ‰.');
    } finally {
      setSubmitting(false);
    }
  };

  const penalties = status?.active_penalties ?? [];
  const appeals = status?.appeals ?? [];

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()} accessibilityLabel="ط±ط¬ظˆط¹">
          <ChevronRight size={22} color={colors.textSecondary} />
        </TouchableOpacity>
        <View>
          <Text style={styles.title}>ط§ظ„ظ…ط®ط§ظ„ظپط§طھ ظˆط§ظ„ط¹ظ‚ظˆط¨ط§طھ</Text>
          <Text style={styles.subtitle}>ط³ط¬ظ„ ظ…ط®ط§ظ„ظپط§طھظƒ ظˆط¹ظ‚ظˆط¨ط§طھظƒ ط§ظ„ط³ط§ط±ظٹط© ظˆط§ط¹طھط±ط§ط¶ط§طھظƒ</Text>
        </View>
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={loadStatus} tintColor={colors.primary} />}
      >
        <View style={styles.summaryCard}>
          <ShieldAlert size={22} color={colors.primary} />
          <View style={styles.summaryTexts}>
            <Text style={styles.summaryValue}>
              {status ? `${status.violations_in_window} ظ…ط®ط§ظ„ظپط©` : 'â€”'}
            </Text>
            <Text style={styles.summaryLabel}>
              ط®ظ„ط§ظ„ ط¢ط®ط± {status?.window_days ?? 90} ظٹظˆظ…ط§ظ‹ â€” طھظڈط±ظپط¹ ط§ظ„ط¹ظ‚ظˆط¨ط§طھ طھظ„ظ‚ط§ط¦ظٹط§ظ‹ ط¹ظ†ط¯ طھظƒط±ط§ط± ط§ظ„ظ…ط®ط§ظ„ظپط§طھ
            </Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>ط§ظ„ط¹ظ‚ظˆط¨ط§طھ ط§ظ„ط³ط§ط±ظٹط©</Text>
        {penalties.length === 0 && !loading && (
          <Text style={styles.empty}>ظ„ط§ طھظˆط¬ط¯ ط¹ظ‚ظˆط¨ط§طھ ط³ط§ط±ظٹط© ط¹ظ„ظٹظƒ.</Text>
        )}
        {penalties.map((penalty) => (
          <View key={penalty.id} style={styles.penaltyCard}>
            <View style={styles.penaltyHeader}>
              <Gavel size={16} color={colors.primary} />
              <Text style={styles.penaltyType}>{PENALTY_LABELS[penalty.penalty_type] ?? penalty.penalty_type}</Text>
            </View>
            <Text style={styles.penaltyReason}>{penalty.reason}</Text>
            <Text style={styles.penaltyMeta}>
              {penalty.ends_at ? `ط­طھظ‰ ${formatDateTime(penalty.ends_at)}` : 'ط¨ط¯ظˆظ† ظ…ط¯ط© ظ…ط­ط¯ط¯ط©'}
            </Text>
            {penalty.penalty_type !== 'warning' && !pendingAppealPenaltyIds.has(penalty.id) && (
              appealingPenaltyId === penalty.id ? (
                <View style={styles.appealForm}>
                  <TextInput
                    style={styles.appealInput}
                    value={appealText}
                    onChangeText={setAppealText}
                    placeholder="ط§ظƒطھط¨ ط³ط¨ط¨ ط§ط¹طھط±ط§ط¶ظƒ (10 ط£ط­ط±ظپ ط¹ظ„ظ‰ ط§ظ„ط£ظ‚ظ„)..."
                    placeholderTextColor={colors.textSecondary}
                    multiline
                    textAlignVertical="top"
                    editable={!submitting}
                  />
                  <View style={styles.appealActions}>
                    <TouchableOpacity
                      style={styles.cancelButton}
                      onPress={() => { setAppealingPenaltyId(null); setAppealText(''); }}
                      disabled={submitting}
                    >
                      <Text style={styles.cancelText}>ط¥ظ„ط؛ط§ط،</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.submitButton} onPress={() => void submitAppeal()} disabled={submitting}>
                      <Text style={styles.submitText}>{submitting ? 'ط¬ط§ط±ظٹ ط§ظ„ط¥ط±ط³ط§ظ„...' : 'ط¥ط±ط³ط§ظ„ ط§ظ„ط§ط¹طھط±ط§ط¶'}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.appealButton}
                  onPress={() => setAppealingPenaltyId(penalty.id)}
                >
                  <Text style={styles.appealButtonText}>طھظ‚ط¯ظٹظ… ط§ط¹طھط±ط§ط¶</Text>
                </TouchableOpacity>
              )
            )}
            {pendingAppealPenaltyIds.has(penalty.id) && (
              <Text style={styles.pendingNote}>ط§ط¹طھط±ط§ط¶ظƒ ظ‚ظٹط¯ ط§ظ„ظ…ط±ط§ط¬ط¹ط©</Text>
            )}
          </View>
        ))}

        <Text style={styles.sectionTitle}>ط§ظ„ط§ط¹طھط±ط§ط¶ط§طھ</Text>
        {appeals.length === 0 && !loading && (
          <Text style={styles.empty}>ظ„ظ… طھظ‚ط¯ظ… ط£ظٹ ط§ط¹طھط±ط§ط¶ ط¨ط¹ط¯.</Text>
        )}
        {appeals.map((appeal) => (
          <View key={appeal.id} style={styles.appealCard}>
            <View style={styles.appealCardHeader}>
              <Text style={[styles.appealStatusBase, { color: appeal.status === 'approved' ? colors.success : appeal.status === 'rejected' ? colors.danger : colors.primary }]}>
                {APPEAL_STATUS_LABELS[appeal.status] ?? appeal.status}
              </Text>
              <Text style={styles.appealDate}>{formatDateTime(appeal.created_at)}</Text>
            </View>
            <Text style={styles.appealStatement}>{appeal.statement}</Text>
            {appeal.review_note ? (
              <Text style={styles.appealNote}>ظ…ظ„ط§ط­ط¸ط© ط§ظ„ظ…ط±ط§ط¬ط¹ط©: {appeal.review_note}</Text>
            ) : null}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingTop: 54, paddingBottom: 18 },
  backButton: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  title: { color: colors.text, fontSize: 18, fontFamily: fonts.semibold },
  subtitle: { color: colors.textSecondary, fontSize: 11, marginTop: 3 },
  content: { paddingHorizontal: 16, paddingBottom: 32 },
  summaryCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderWidth: 1, borderColor: colors.border, borderRadius: 15, backgroundColor: colors.surface },
  summaryTexts: { flex: 1 },
  summaryValue: { color: colors.text, fontSize: 15, fontFamily: fonts.semibold },
  summaryLabel: { color: colors.textSecondary, fontSize: 11, marginTop: 4, lineHeight: 16 },
  sectionTitle: { color: colors.text, fontSize: 14, fontFamily: fonts.semibold, marginTop: 22, marginBottom: 10 },
  empty: { color: colors.textSecondary, textAlign: 'center', marginTop: 12, fontSize: 13 },
  penaltyCard: { padding: 14, borderWidth: 1, borderColor: colors.border, borderRadius: 15, backgroundColor: colors.surface, marginBottom: 10 },
  penaltyHeader: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  penaltyType: { color: colors.text, fontSize: 14, fontFamily: fonts.semibold },
  penaltyReason: { color: colors.textSecondary, fontSize: 12, marginTop: 8, lineHeight: 18 },
  penaltyMeta: { color: colors.textSecondary, fontSize: 11, marginTop: 6 },
  appealButton: { alignSelf: 'flex-start', marginTop: 10, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: colors.primarySoft },
  appealButtonText: { color: colors.primary, fontSize: 11, fontFamily: fonts.semibold },
  pendingNote: { color: colors.textSecondary, fontSize: 11, marginTop: 10 },
  appealForm: { marginTop: 10 },
  appealInput: { borderWidth: 1, borderColor: colors.border, borderRadius: 11, backgroundColor: colors.background, color: colors.text, paddingHorizontal: 12, paddingVertical: 10, fontSize: 12, minHeight: 84, textAlign: 'right' },
  appealActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 9 },
  cancelButton: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: colors.surface },
  cancelText: { color: colors.textSecondary, fontSize: 11, fontFamily: fonts.semibold },
  submitButton: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: colors.primarySoft },
  submitText: { color: colors.primary, fontSize: 11, fontFamily: fonts.semibold },
  appealCard: { padding: 14, borderWidth: 1, borderColor: colors.border, borderRadius: 15, backgroundColor: colors.surface, marginBottom: 10 },
  appealCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  appealStatusBase: { fontSize: 12, fontFamily: fonts.semibold },
  appealDate: { color: colors.textSecondary, fontSize: 10 },
  appealStatement: { color: colors.text, fontSize: 12, marginTop: 8, lineHeight: 18 },
  appealNote: { color: colors.textSecondary, fontSize: 11, marginTop: 8, lineHeight: 16 },
});
