import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { ArrowLeft, Award, Flame, Sparkles, Trophy } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { colors, fonts } from '@/lib/theme';

interface LoyaltyBadge {
  days: number;
  key: string;
  label: string;
}

interface LoyaltyState {
  enabled: boolean;
  timezone: string;
  streak_days: number;
  best_streak: number;
  total_points: number;
  badge: string | null;
  badge_label: string | null;
  claimed_today: boolean;
  last_claim_date: string | null;
  next_streak_days: number;
  points_if_claimed_now: number;
  next_badge: LoyaltyBadge | null;
  badges: LoyaltyBadge[];
  note: string;
}

interface ClaimResult {
  status: 'claimed' | 'already_claimed' | 'disabled';
  points_awarded?: number;
  streak_days?: number;
  badge_label?: string | null;
  badge_awarded?: boolean;
}

const palette = {
  background: colors.background,
  surface: colors.surface,
  elevated: colors.surfaceElevated,
  border: colors.border,
  text: colors.text,
  muted: colors.textSecondary,
  primary: colors.primary,
  gold: colors.gold,
  teal: colors.teal,
  danger: colors.danger,
} as const;

export default function LoyaltyScreen() {
  const router = useRouter();
  const [state, setState] = useState<LoyaltyState | null>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('get_my_loyalty');
      if (rpcError) throw rpcError;
      setState(data as LoyaltyState);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'طھط¹ط°ط± طھط­ظ…ظٹظ„ ط³ظ„ط³ظ„ط© ط§ظ„ظˆظ„ط§ط،.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const claim = async () => {
    setClaiming(true);
    try {
      const { data, error: rpcError } = await supabase.rpc('claim_daily_loyalty');
      if (rpcError) throw rpcError;
      const result = data as ClaimResult;
      if (result.status === 'claimed') {
        Alert.alert(
          `ط³ظ„ط³ظ„ط© ${result.streak_days ?? 1} ط£ظٹط§ظ…`,
          `+${result.points_awarded ?? 0} ظ†ظ‚ط·ط© ظˆظ„ط§ط،`
            + (result.badge_awarded && result.badge_label ? `\nط´ط§ط±ط© ط¬ط¯ظٹط¯ط©: ${result.badge_label}` : ''),
        );
      } else if (result.status === 'already_claimed') {
        Alert.alert('ط³ظڈط¬ظ‘ظ„ ط§ظ„ظٹظˆظ…', 'ط¹ط¯ ط؛ط¯ط§ظ‹ ظ„ظ…ظˆط§طµظ„ط© ط§ظ„ط³ظ„ط³ظ„ط©.');
      } else {
        Alert.alert('ط§ظ„ظˆظ„ط§ط، ظ…طھظˆظ‚ظپ ظ…ط¤ظ‚طھط§ظ‹', 'ظ†ظ‚ط§ط· ط§ظ„ظˆظ„ط§ط، ط؛ظٹط± ظ…ظپط¹ظ‘ظ„ط© ط­ط§ظ„ظٹط§ظ‹.');
      }
      await load();
    } catch (caught: unknown) {
      Alert.alert('طھط¹ط°ط± طھط³ط¬ظٹظ„ ط§ظ„ط­ط¶ظˆط±', caught instanceof Error ? caught.message : 'ط­ط§ظˆظ„ ظ…ط±ط© ط£ط®ط±ظ‰.');
    } finally {
      setClaiming(false);
    }
  };

  const badges = state?.badges ?? [];
  const reached = state?.streak_days ?? 0;

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} accessibilityLabel="ط±ط¬ظˆط¹">
          <ArrowLeft size={20} color={palette.text} />
        </TouchableOpacity>
        <Text style={styles.title}>ط³ظ„ط³ظ„ط© ط§ظ„ظˆظ„ط§ط،</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}><Flame size={26} color={palette.gold} /></View>
          <Text style={styles.heroTitle}>ط­ط¶ظˆط± ظٹظˆظ…ظٹطŒ ظ†ظ‚ط§ط· ظˆط´ط§ط±ط§طھ</Text>
          <Text style={styles.heroCopy}>
            ط³ط¬ظ‘ظ„ ط­ط¶ظˆط±ظƒ ظƒظ„ ظٹظˆظ… ظ„طھط²ظٹط¯ ط³ظ„ط³ظ„طھظƒ. ط§ظ„ظ†ظ‚ط§ط· طھظڈط­ط³ط¨ ط¹ظ„ظ‰ ط§ظ„ط®ط§ط¯ظ… ط­ط³ط¨ طھظˆظ‚ظٹطھ ط§ظ„ط¥ط¯ط§ط±ط©طŒ
            ظˆظ‡ظٹ ظ„ظ„ط¹ط±ط¶ ظˆط§ظ„ط´ط§ط±ط§طھ ظپظ‚ط· â€” ظ„ط§ طھظڈط­ظˆظژظ‘ظ„ ط¥ظ„ظ‰ ط±طµظٹط¯ ط£ظˆ Coin.
          </Text>
        </View>

        {loading ? (
          <View style={styles.state}><ActivityIndicator color={palette.primary} /></View>
        ) : error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity onPress={() => void load()}><Text style={styles.retry}>ط¥ط¹ط§ط¯ط© ط§ظ„ظ…ط­ط§ظˆظ„ط©</Text></TouchableOpacity>
          </View>
        ) : state ? (
          <>
            <View style={styles.statsRow}>
              <View style={styles.statCard}>
                <Flame size={16} color={palette.gold} />
                <Text style={styles.statValue}>{state.streak_days}</Text>
                <Text style={styles.statLabel}>ط£ظٹط§ظ… ظ…طھطµظ„ط©</Text>
              </View>
              <View style={styles.statCard}>
                <Trophy size={16} color={palette.teal} />
                <Text style={styles.statValue}>{state.best_streak}</Text>
                <Text style={styles.statLabel}>ط£ظپط¶ظ„ ط³ظ„ط³ظ„ط©</Text>
              </View>
              <View style={styles.statCard}>
                <Sparkles size={16} color={palette.primary} />
                <Text style={styles.statValue}>{state.total_points.toLocaleString()}</Text>
                <Text style={styles.statLabel}>ظ†ظ‚ط§ط· ط§ظ„ظˆظ„ط§ط،</Text>
              </View>
            </View>

            {state.badge_label ? (
              <View style={styles.badgeCard}>
                <Award size={18} color={palette.gold} />
                <Text style={styles.badgeText}>ط´ط§ط±طھظƒ ط§ظ„ط­ط§ظ„ظٹط©: {state.badge_label}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              style={[styles.claimButton, (!state.enabled || state.claimed_today || claiming) && styles.claimDisabled]}
              disabled={!state.enabled || state.claimed_today || claiming}
              onPress={() => void claim()}
              accessibilityRole="button"
            >
              {claiming ? <ActivityIndicator size="small" color={palette.background} /> : null}
              <Text style={styles.claimText}>
                {!state.enabled
                  ? 'ظ†ظ‚ط§ط· ط§ظ„ظˆظ„ط§ط، ط؛ظٹط± ظ…ظپط¹ظ‘ظ„ط©'
                  : state.claimed_today
                    ? 'ط³ط¬ظ‘ظ„طھ ط­ط¶ظˆط±ظƒ ط§ظ„ظٹظˆظ… â€” ط¹ط¯ ط؛ط¯ط§ظ‹'
                    : `ط³ط¬ظ‘ظ„ ط­ط¶ظˆط± ط§ظ„ظٹظˆظ… (+${state.points_if_claimed_now} ظ†ظ‚ط·ط©)`}
              </Text>
            </TouchableOpacity>

            <View style={styles.sectionHeading}>
              <Text style={styles.sectionTitle}>ط§ظ„ط´ط§ط±ط§طھ</Text>
              <Text style={styles.sectionSubtitle}>ط¹طھط¨ط§طھ ط§ظ„ط£ظٹط§ظ… طھط­ط¯ط¯ظ‡ط§ ط¥ط¯ط§ط±ط© Wattar</Text>
            </View>

            {badges.map((badge) => {
              const unlocked = reached >= badge.days || state.badge === badge.key;
              return (
                <View key={badge.key} style={[styles.badgeRow, unlocked && styles.badgeRowUnlocked]}>
                  <Award size={16} color={unlocked ? palette.gold : palette.muted} />
                  <Text style={[styles.badgeName, unlocked && styles.badgeNameUnlocked]}>{badge.label}</Text>
                  <Text style={styles.badgeDays}>{badge.days} ط£ظٹط§ظ…</Text>
                </View>
              );
            })}

            {state.next_badge ? (
              <Text style={styles.nextHint}>
                ط§ظ„طھط§ظ„ظٹط©: {state.next_badge.label} ط¨ط¹ط¯ {Math.max(state.next_badge.days - reached, 1)} ظٹظˆظ… ظ…طھطµظ„.
              </Text>
            ) : (
              <Text style={styles.nextHint}>ظˆطµظ„طھ ط¥ظ„ظ‰ ط£ط¹ظ„ظ‰ ط´ط§ط±ط© ظ…طھط§ط­ط©.</Text>
            )}

            <Text style={styles.disclaimer}>{state.note}</Text>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 54, paddingBottom: 12 },
  backButton: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  title: { color: palette.text, fontSize: 21, fontFamily: fonts.bold },
  content: { paddingHorizontal: 16, paddingBottom: 36 },
  hero: { alignItems: 'center', padding: 21, borderRadius: 22, backgroundColor: palette.surface, borderWidth: 1, borderColor: colors.goldLine },
  heroIcon: { width: 52, height: 52, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.goldSoft },
  heroTitle: { color: palette.text, fontSize: 20, fontFamily: fonts.bold, marginTop: 13 },
  heroCopy: { color: palette.muted, fontSize: 12, lineHeight: 20, textAlign: 'center', marginTop: 8 },
  statsRow: { flexDirection: 'row', gap: 9, marginTop: 14 },
  statCard: { flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: 16, backgroundColor: palette.elevated, borderWidth: 1, borderColor: palette.border, gap: 5 },
  statValue: { color: palette.text, fontSize: 19, fontFamily: fonts.bold },
  statLabel: { color: palette.muted, fontSize: 10 },
  badgeCard: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: 14, marginTop: 12, borderRadius: 16, backgroundColor: colors.goldSoft, borderWidth: 1, borderColor: colors.goldLine },
  badgeText: { color: palette.gold, fontSize: 13, fontFamily: fonts.semibold, flex: 1, textAlign: 'right' },
  claimButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 14, borderRadius: 14, backgroundColor: palette.gold },
  claimDisabled: { opacity: 0.55 },
  claimText: { color: palette.background, fontSize: 13, fontFamily: fonts.bold },
  sectionHeading: { marginTop: 24, marginBottom: 10 },
  sectionTitle: { color: palette.text, fontSize: 16, fontFamily: fonts.bold, textAlign: 'right' },
  sectionSubtitle: { color: palette.muted, fontSize: 11, marginTop: 4, textAlign: 'right' },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, marginBottom: 9, borderRadius: 15, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  badgeRowUnlocked: { backgroundColor: colors.goldSoft, borderColor: colors.goldLine },
  badgeName: { color: palette.muted, fontSize: 13, fontFamily: fonts.semibold, flex: 1, textAlign: 'right' },
  badgeNameUnlocked: { color: palette.text },
  badgeDays: { color: palette.muted, fontSize: 11 },
  nextHint: { color: palette.muted, fontSize: 11, textAlign: 'right', marginTop: 4 },
  state: { alignItems: 'center', padding: 25 },
  errorCard: { padding: 13, marginTop: 12, borderRadius: 14, backgroundColor: colors.dangerSoft },
  errorText: { color: palette.danger, fontSize: 12, textAlign: 'right' },
  retry: { color: palette.gold, marginTop: 8, textAlign: 'right' },
  disclaimer: { color: palette.muted, fontSize: 10, lineHeight: 17, textAlign: 'center', marginTop: 14, paddingHorizontal: 4 },
});
