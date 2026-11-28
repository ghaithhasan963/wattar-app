import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { ArrowLeft, Check, Clock3, Sparkles, Target } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { colors, fonts } from '@/lib/theme';

interface DailyMission {
  mission_id: string;
  mission_key: string;
  title: string;
  description: string;
  event_type: string;
  target_count: number;
  current_progress: number;
  reward_gold: number;
  reward_xp: number;
  is_claimed: boolean;
  coin_awarded: number;
  xp_awarded: number;
}

export default function MissionsScreen() {
  const router = useRouter();
  const loadProfile = useAuthStore((state) => state.loadProfile);
  const [missions, setMissions] = useState<DailyMission[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyMission, setBusyMission] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadMissions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: loadError } = await supabase.rpc('list_daily_missions');
      if (loadError) throw loadError;
      setMissions((data ?? []) as DailyMission[]);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'طھط¹ط°ط± طھط­ظ…ظٹظ„ ط§ظ„ظ…ظ‡ظ…ط§طھ.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMissions();
  }, [loadMissions]);

  const claimMission = async (mission: DailyMission) => {
    setBusyMission(mission.mission_id);
    setNotice(null);
    setError(null);
    try {
      const { data, error: claimError } = await supabase.rpc('claim_daily_mission', {
        p_mission_id: mission.mission_id,
      });
      if (claimError) throw claimError;
      const result = data as { coin_awarded?: number; xp_awarded?: number } | null;
      const coins = Number(result?.coin_awarded ?? 0);
      const xp = Number(result?.xp_awarded ?? 0);
      setNotice(`طھظ… ط§ط³طھظ„ط§ظ… ط§ظ„ظ…ظƒط§ظپط£ط©: ${coins.toLocaleString()} Coin ظˆ${xp.toLocaleString()} XP.`);
      await Promise.all([loadMissions(), loadProfile()]);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'طھط¹ط°ط± ط§ط³طھظ„ط§ظ… ظ…ظƒط§ظپط£ط© ط§ظ„ظ…ظ‡ظ…ط©.');
    } finally {
      setBusyMission(null);
    }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} accessibilityLabel="ط±ط¬ظˆط¹">
          <ArrowLeft size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>ظ…ظ‡ظ…ط§طھ ط§ظ„ظٹظˆظ…</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={loadMissions} tintColor={colors.gold} />}
      >
        <View style={styles.hero}>
          <View style={styles.heroIcon}><Target size={23} color={colors.gold} /></View>
          <Text style={styles.heroTitle}>طھظ‚ط¯ظ‘ظ… ظˆط§ظ„ط¹ط¨ ظ…ط¬ط§ظ†ظ‹ط§</Text>
          <Text style={styles.heroCopy}>ط£ظƒظ…ظ„ ط£ظ‡ط¯ط§ظپظ‹ط§ ظ…ط¬طھظ…ط¹ظٹط© ظˆط§ط³طھظ„ظ… Coin ظˆXP. ظƒظ„ ظ…ظ‡ظ…ط© طھط¹ط·ظٹ ط­طھظ‰ 100 Coin ظ…ط¬ط§ظ†ظ‹ط§طŒ ظˆط§ظ„ظ€Coin ط¹ظ…ظ„ط© ط§ظ„ظ„ط¹ط¨ ظˆط§ظ„ظ‡ط¯ط§ظٹط§ ط¯ط§ط®ظ„ ط§ظ„طھط·ط¨ظٹظ‚.</Text>
        </View>

        {notice ? <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text> : null}
        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity onPress={() => void loadMissions()}><Text style={styles.retry}>ط¥ط¹ط§ط¯ط© ط§ظ„ظ…ط­ط§ظˆظ„ط©</Text></TouchableOpacity>
          </View>
        ) : null}

        {loading && missions.length === 0 ? (
          <View style={styles.state}><ActivityIndicator color={colors.primary} /></View>
        ) : missions.length === 0 && !error ? (
          <View style={styles.state}>
            <Sparkles size={25} color={colors.primary} />
            <Text style={styles.emptyTitle}>ظ„ط§ طھظˆط¬ط¯ ظ…ظ‡ظ…ط§طھ ظ†ط´ط·ط© ط§ظ„ط¢ظ†</Text>
            <Text style={styles.emptyCopy}>ط§ط±ط¬ط¹ ظ„ط§ط­ظ‚ظ‹ط§ ظ„ط§ظƒطھط´ط§ظپ ط£ظ‡ط¯ط§ظپ ط¬ط¯ظٹط¯ط©.</Text>
          </View>
        ) : missions.map((mission) => {
          const progress = Math.min(mission.current_progress, mission.target_count);
          const completed = progress >= mission.target_count;
          return (
            <View key={mission.mission_id} style={styles.card}>
              <View style={styles.cardTop}>
                <View style={styles.missionIcon}>
                  {mission.is_claimed ? <Check size={18} color={colors.success} /> : <Clock3 size={18} color={colors.primary} />}
                </View>
                <View style={styles.missionCopy}>
                  <Text style={styles.missionTitle}>{mission.title}</Text>
                  <Text style={styles.missionDescription}>{mission.description}</Text>
                </View>
              </View>

              <View style={styles.progressRow}>
                <Text style={styles.progressLabel}>ط§ظ„طھظ‚ط¯ظ…</Text>
                <Text style={styles.progressValue}>{progress} / {mission.target_count}</Text>
              </View>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${Math.min(100, (progress / mission.target_count) * 100)}%` }]} />
              </View>

              <View style={styles.rewardRow}>
                <Text style={styles.rewardLabel}>ط§ظ„ظ…ظƒط§ظپط£ط©</Text>
                <Text style={styles.rewardValue}>
                  {mission.reward_gold.toLocaleString()} Coin آ· {mission.reward_xp.toLocaleString()} XP
                </Text>
              </View>

              <TouchableOpacity
                style={[styles.claimButton, (!completed || mission.is_claimed || busyMission === mission.mission_id) && styles.claimButtonDisabled]}
                disabled={!completed || mission.is_claimed || busyMission === mission.mission_id}
                onPress={() => void claimMission(mission)}
              >
                {busyMission === mission.mission_id
                  ? <ActivityIndicator size="small" color={colors.background} />
                  : <Text style={styles.claimText}>{mission.is_claimed ? 'طھظ… ط§ظ„ط§ط³طھظ„ط§ظ… ط§ظ„ظٹظˆظ…' : completed ? 'ط§ط³طھظ„ط§ظ… ط§ظ„ظ…ظƒط§ظپط£ط©' : 'ط£ظƒظ…ظ„ ط§ظ„ظ…ظ‡ظ…ط© ط£ظˆظ„ظ‹ط§'}</Text>}
              </TouchableOpacity>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, paddingTop: 54 },
  header: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 20, marginBottom: 14 },
  backButton: { position: 'absolute', left: 16, padding: 8 },
  title: { color: colors.text, fontSize: 20, fontFamily: fonts.bold },
  content: { paddingHorizontal: 16, paddingBottom: 36, gap: 12 },
  hero: { padding: 17, borderRadius: 22, backgroundColor: colors.primaryHaze, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'flex-end' },
  heroIcon: { width: 42, height: 42, borderRadius: 15, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginBottom: 11 },
  heroTitle: { color: colors.text, fontSize: 17, fontFamily: fonts.black },
  heroCopy: { color: colors.textSecondary, textAlign: 'right', lineHeight: 20, fontSize: 12, marginTop: 7 },
  notice: { color: colors.success, textAlign: 'right', backgroundColor: colors.successSoft, padding: 12, borderRadius: 12 },
  errorCard: { padding: 14, borderRadius: 14, backgroundColor: colors.dangerSoft, gap: 8 },
  errorText: { color: colors.danger, textAlign: 'right' },
  retry: { color: colors.gold, textAlign: 'right', fontFamily: fonts.bold },
  state: { minHeight: 180, alignItems: 'center', justifyContent: 'center', gap: 9, padding: 20 },
  emptyTitle: { color: colors.text, fontSize: 15, fontFamily: fonts.bold },
  emptyCopy: { color: colors.textSecondary, textAlign: 'center', fontSize: 12 },
  card: { padding: 15, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  missionIcon: { width: 40, height: 40, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  missionCopy: { flex: 1, gap: 4, alignItems: 'flex-end' },
  missionTitle: { color: colors.text, fontSize: 14, fontFamily: fonts.bold, textAlign: 'right' },
  missionDescription: { color: colors.textSecondary, fontSize: 11, lineHeight: 17, textAlign: 'right' },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16, marginBottom: 7 },
  progressLabel: { color: colors.textSecondary, fontSize: 11 },
  progressValue: { color: colors.text, fontSize: 11, fontFamily: fonts.semibold },
  progressTrack: { height: 7, borderRadius: 4, backgroundColor: colors.surfaceMuted, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: colors.primary, borderRadius: 4 },
  rewardRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 13 },
  rewardLabel: { color: colors.textSecondary, fontSize: 11 },
  rewardValue: { color: colors.gold, fontSize: 11, fontFamily: fonts.bold },
  claimButton: { minHeight: 42, marginTop: 13, borderRadius: 13, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center' },
  claimButtonDisabled: { backgroundColor: colors.surfaceMuted },
  claimText: { color: colors.background, fontSize: 12, fontFamily: fonts.black },
});
