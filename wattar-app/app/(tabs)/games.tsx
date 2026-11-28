/**
 * Wattar App â€” طµظپط­ط© ط§ظ„ط£ظ„ط¹ط§ط¨ (M9.4)
 * ط§ظ„ظ‚ط§ط¦ظ…ط© طھظڈط¨ظ†ظ‰ ظ…ظ† get_public_games(): ط§ظ„ط£ظ„ط¹ط§ط¨ ط§ظ„ظ…ظپط¹ظ‘ظ„ط© ظپظ‚ط· طھط¸ظ‡ط±طŒ ظ…ط¹ ط­ط§ظ„ط©
 * ط§ظ„ط¥طھط§ط­ط© (ط¥ظٹظ‚ط§ظپ/ظ…ظ†ط·ظ‚ط©/ط¹ظ…ط±)طŒ RTP ط§ظ„ظ…ط¹ظ„ظ†طŒ ظˆط§ظ„ط¹ط±ظˆط¶ ط§ظ„طھط±ظˆظٹط¬ظٹط© ط§ظ„ظ…ط¹ظ„ظ†ط©.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Animated, Easing, View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { ArrowLeft, Gamepad2, Dice5, Plane, ChevronDown, Users, Gift, Gem, Sparkles } from 'lucide-react-native';
import { useAuthStore } from '@/store/auth';
import { usePreferencesStore } from '@/store/preferences';
import { usePublicGames } from '@/hooks/usePublicGames';
import { supabase } from '@/lib/supabase';
import { colors, fonts } from '@/lib/theme';
import { CurrencyIcon } from '@/components/CurrencyIcon';
import { formatPercent, gameUnavailableLabel, PublicGame } from '@/lib/gameConfig';

const GAME_ICONS: Record<string, typeof Gamepad2> = {
  disc: Sparkles,
  'dice-5': Dice5,
  plane: Plane,
  'chevrons-down': ChevronDown,
  gem: Gem,
  gamepad: Gamepad2,
};

function iconFor(game: PublicGame) {
  return GAME_ICONS[game.icon] ?? GAME_ICONS.gamepad;
}

export default function GamesScreen() {
  const router = useRouter();
  const { profile } = useAuthStore();
  const loadProfile = useAuthStore((state) => state.loadProfile);
  const { reduceMotion } = usePreferencesStore();
  const [claimingBonus, setClaimingBonus] = useState(false);
  const entrance = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const { games, loading, error, reload } = usePublicGames();

  useEffect(() => {
    if (reduceMotion) {
      entrance.setValue(1);
      return;
    }
    Animated.timing(entrance, {
      toValue: 1,
      duration: 360,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [entrance, reduceMotion]);

  const entranceStyle = {
    opacity: entrance,
    transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
  };

  const claimDailyBonus = async () => {
    if (claimingBonus) return;
    setClaimingBonus(true);
    try {
      const { data, error: rpcError } = await supabase.rpc('claim_daily_game_points');
      if (rpcError) throw rpcError;
      if (data?.claimed) {
        await loadProfile();
        Alert.alert('طھظ…طھ ط§ظ„ط¥ط¶ط§ظپط©', `ط£ط¶ظپظ†ط§ ${Number(data.granted).toLocaleString()} Coin ط¥ظ„ظ‰ ط±طµظٹط¯ظƒ.`);
      } else {
        Alert.alert('طھظ… ط§ط³طھط®ط¯ط§ظ… ط§ظ„ظ…ظƒط§ظپط£ط© ط§ظ„ظٹظˆظ…ظٹط©', 'ظٹظ…ظƒظ†ظƒ ط§ط³طھظ„ط§ظ… ظ…ظƒط§ظپط£ط© ط§ظ„ط¯ط®ظˆظ„ ظ…ط±ط© ط£ط®ط±ظ‰ ط¨ط¹ط¯ ظ…ط±ظˆط± 24 ط³ط§ط¹ط©.');
      }
    } catch (caught: unknown) {
      Alert.alert('طھط¹ط°ط±طھ ط§ظ„ظ…ظƒط§ظپط£ط© ط§ظ„ظٹظˆظ…ظٹط©', caught instanceof Error ? caught.message : 'ط­ط§ظˆظ„ ظ…ط±ط© ط£ط®ط±ظ‰.');
    } finally {
      setClaimingBonus(false);
    }
  };

  const openGame = (game: PublicGame) => {
    if (!game.available) {
      Alert.alert(game.display_name, gameUnavailableLabel(game.unavailable_reason));
      return;
    }
    router.push(`/game/${game.game_type}` as never);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>ط§ظ„ط£ظ„ط¹ط§ط¨</Text>
        <View style={styles.balanceCard}>
          <View style={styles.balanceHeading}>
            <CurrencyIcon currency="coin" size={30} />
            <Text style={styles.balanceLabel}>ط±طµظٹط¯ Coin</Text>
          </View>
          <Text style={styles.balanceValue}>{profile?.balance_gold?.toLocaleString() ?? 0}</Text>
        </View>
      </View>

      <TouchableOpacity
        style={styles.claimButton}
        onPress={claimDailyBonus}
        disabled={claimingBonus}
        accessibilityRole="button"
      >
        {claimingBonus
          ? <ActivityIndicator size="small" color={colors.background} />
          : <Gift size={18} color={colors.background} />}
        <Text style={styles.claimButtonText}>
          {claimingBonus ? 'ط¬ط§ط±ظٹ ط§ظ„ط§ط³طھظ„ط§ظ…...' : 'ط§ط³طھظ„ط§ظ… Coin ط§ظ„ظٹظˆظ…ظٹط©'}
        </Text>
      </TouchableOpacity>
      <Text style={styles.pointsNotice}>ظ…ظƒط§ظپط£ط© ظٹظˆظ…ظٹط© ظ…ط­ط¯ظˆط¯ط© ط¨ط§ظ„ظ€Coin. ط§ظ„ط£ظ„ط¹ط§ط¨ طھظڈظ„ط¹ط¨ ط¨ط±طµظٹط¯ CoinطŒ ظˆط§ظ„ظ†طھط§ط¦ط¬ طھظڈط­ط³ط¨ ط¹ظ„ظ‰ ط§ظ„ط®ط§ط¯ظ… ظپظ‚ط·.</Text>

      <Animated.View style={[styles.communityCard, entranceStyle]}>
        <View style={styles.communityIcon}><Users size={22} color={colors.primary} /></View>
        <View style={styles.communityCopy}>
          <Text style={styles.communityTitle}>طھط­ط¯ظٹط§طھ ط§ظ„ط£طµط¯ظ‚ط§ط،</Text>
          <Text style={styles.communityDescription}>ظ†ط±ط¯ ظ…ط¬ط§ظ†ظٹ ظ„ط´ط®طµظٹظ† ط£ظˆ ط£ط±ط¨ط¹ط© â€” ط¨ط¯ظˆظ† ط¹ظ…ظ„ط§طھ</Text>
        </View>
        <TouchableOpacity
          style={styles.communityButton}
          onPress={() => router.push('/(tabs)/friends')}
          accessibilityRole="button"
          accessibilityLabel="ط§ظپطھط­ طھط­ط¯ظٹط§طھ ط§ظ„ط£طµط¯ظ‚ط§ط،"
        >
          <ArrowLeft size={18} color={colors.text} />
        </TouchableOpacity>
      </Animated.View>

      <View style={styles.sectionHeading}>
        <View>
          <Text style={styles.sectionTitle}>ط§ط®طھط± ظ„ط¹ط¨طھظƒ</Text>
          <Text style={styles.sectionSubtitle}>ط¬ظˆظ„ط§طھ ط³ط±ظٹط¹ط© ط¨ط±طµظٹط¯ Coin ظپظ‚ط·</Text>
        </View>
        <View style={styles.gamesCount}>
          <Text style={styles.gamesCountText}>{games.length} ط£ظ„ط¹ط§ط¨</Text>
        </View>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.teal} style={styles.loader} />
      ) : error ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => void reload()} accessibilityRole="button">
            <Text style={styles.retryText}>ط¥ط¹ط§ط¯ط© ط§ظ„ظ…ط­ط§ظˆظ„ط©</Text>
          </TouchableOpacity>
        </View>
      ) : games.length === 0 ? (
        <Text style={styles.pointsNotice}>ظ„ط§ طھظˆط¬ط¯ ط£ظ„ط¹ط§ط¨ ظ…طھط§ط­ط© ط­ط§ظ„ظٹط§ظ‹.</Text>
      ) : (
        <Animated.View style={[styles.gamesGrid, entranceStyle]}>
          {games.map((game) => {
            const Icon = iconFor(game);
            const accent = game.accent_color || colors.primary;
            return (
              <TouchableOpacity
                key={game.game_type}
                style={[styles.gameCard, { borderTopColor: accent }, !game.available && styles.gameCardDisabled]}
                onPress={() => openGame(game)}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={`ط§ظپطھط­ ظ„ط¹ط¨ط© ${game.display_name}`}
              >
                <View style={styles.gameCardTop}>
                  <View style={[styles.gameIconBg, { backgroundColor: `${accent}22` }]}>
                    <Icon size={25} color={accent} />
                  </View>
                  <ArrowLeft size={17} color={colors.textSecondary} />
                </View>
                <View style={styles.gameInfo}>
                  <Text style={styles.gameName}>{game.display_name}</Text>
                  <Text style={styles.gameDesc} numberOfLines={2}>
                    {game.description ?? 'ط¬ظˆظ„ط© ط³ط±ظٹط¹ط© ط¨ط±طµظٹط¯ Coin.'}
                  </Text>
                  <View style={styles.badgeRow}>
                    <View style={styles.rtpPill}>
                      <Text style={styles.rtpPillText}>RTP {formatPercent(game.declared_rtp)}</Text>
                    </View>
                    {game.promo ? (
                      <View style={styles.promoPill}>
                        <Text style={styles.promoPillText}>أ—{game.promo.multiplier} ط¹ط±ط¶</Text>
                      </View>
                    ) : null}
                    {game.test_mode_enabled ? (
                      <View style={styles.testPill}>
                        <Text style={styles.testPillText}>ظ…ط­ط§ظƒط§ط©</Text>
                      </View>
                    ) : null}
                  </View>
                  {!game.available ? (
                    <Text style={styles.unavailableText}>{gameUnavailableLabel(game.unavailable_reason)}</Text>
                  ) : null}
                </View>
              </TouchableOpacity>
            );
          })}
        </Animated.View>
      )}

      <Animated.View style={[styles.statsCard, entranceStyle]}>
        <Text style={styles.statsTitle}>ط§ظ„ط¹ط¨ ط¨ط£ظ…ط§ظ†</Text>
        <Text style={styles.pointsNotice}>ط§ظ„ظ†طھط§ط¦ط¬ طھظڈط­ط¯ط¯ ط¹ظ„ظ‰ ط§ظ„ط®ط§ط¯ظ… ط¨ط¹ط´ظˆط§ط¦ظٹط© ط¢ظ…ظ†ط©طŒ ظˆظƒظ„ ط¬ظˆظ„ط© طھظڈط³ط¬ظژظ‘ظ„ ط¨ط´ظƒظ„ ظ…ط³طھظ‚ظ„. Coin ظ„ط§ طھظڈط³ط­ط¨ ظ†ظ‚ط¯ظ‹ط§ط› ط§ظ„ط³ط­ط¨ ظ…طھط§ط­ ظ„ط£ط±ط¨ط§ط­ Diamond ظپظ‚ط·.</Text>
      </Animated.View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingBottom: 104 },
  header: { padding: 16, paddingTop: 60, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: colors.text, fontSize: 24, fontFamily: fonts.bold },
  balanceCard: { backgroundColor: colors.surface, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12 },
  balanceHeading: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  balanceLabel: { color: colors.textSecondary, fontSize: 11 },
  balanceValue: { color: colors.primaryLight, fontSize: 15, fontFamily: fonts.bold, marginTop: 5, textAlign: 'right' },
  claimButton: {
    marginHorizontal: 16, marginTop: 2, minHeight: 48, borderRadius: 14, paddingHorizontal: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9,
    backgroundColor: colors.gold,
  },
  claimButtonText: { color: colors.background, fontSize: 13, fontFamily: fonts.bold },
  pointsNotice: { color: colors.textSecondary, fontSize: 12, lineHeight: 19, textAlign: 'right', marginHorizontal: 18, marginTop: 8 },
  communityCard: { marginHorizontal: 16, marginTop: 4, padding: 14, borderRadius: 16, flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  communityIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  communityCopy: { flex: 1, gap: 4 },
  communityTitle: { color: colors.text, fontSize: 14, fontFamily: fonts.semibold },
  communityDescription: { color: colors.textSecondary, fontSize: 11 },
  communityButton: { width: 34, height: 34, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  sectionHeading: { marginHorizontal: 18, marginTop: 22, marginBottom: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { color: colors.text, fontSize: 18, fontFamily: fonts.black },
  sectionSubtitle: { color: colors.textSecondary, fontSize: 11, marginTop: 4 },
  gamesCount: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  gamesCountText: { color: colors.teal, fontSize: 10, fontFamily: fonts.bold },
  loader: { marginTop: 30 },
  errorCard: { marginHorizontal: 16, marginTop: 16, padding: 16, borderRadius: 14, backgroundColor: colors.dangerSoft, borderWidth: 1, borderColor: colors.danger, gap: 10 },
  errorText: { color: colors.danger, fontSize: 12, textAlign: 'right' },
  retryButton: { alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: colors.surface },
  retryText: { color: colors.text, fontSize: 12, fontFamily: fonts.bold },
  gamesGrid: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12 },
  gameCard: {
    width: '48%',
    minHeight: 188,
    borderRadius: 19,
    padding: 13,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderTopWidth: 3,
  },
  gameCardDisabled: { opacity: 0.55 },
  gameCardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  gameIconBg: {
    width: 44,
    height: 44,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gameInfo: { flex: 1, justifyContent: 'flex-end', marginTop: 10 },
  gameName: { color: colors.text, fontSize: 15, fontFamily: fonts.black, textAlign: 'right' },
  gameDesc: { minHeight: 32, color: colors.textSecondary, fontSize: 10, lineHeight: 15, marginTop: 4, textAlign: 'right' },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 8 },
  rtpPill: { paddingVertical: 3, paddingHorizontal: 7, borderRadius: 8, backgroundColor: colors.tealSoft },
  rtpPillText: { color: colors.teal, fontSize: 9, fontFamily: fonts.bold },
  promoPill: { paddingVertical: 3, paddingHorizontal: 7, borderRadius: 8, backgroundColor: colors.goldSoft },
  promoPillText: { color: colors.gold, fontSize: 9, fontFamily: fonts.bold },
  testPill: { paddingVertical: 3, paddingHorizontal: 7, borderRadius: 8, backgroundColor: colors.primarySoft },
  testPillText: { color: colors.primary, fontSize: 9, fontFamily: fonts.bold },
  unavailableText: { color: colors.danger, fontSize: 10, fontFamily: fonts.bold, marginTop: 6, textAlign: 'right' },
  statsCard: {
    margin: 16,
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 16,
  },
  statsTitle: { color: colors.text, fontSize: 16, fontFamily: fonts.bold, marginBottom: 12 },
});
