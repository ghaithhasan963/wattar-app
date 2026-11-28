/**
 * Wattar App â€” ط·ظٹط§ط±ط© ط§ظ„ظ…ط¶ط§ط¹ظپط§طھ (M9.4)
 * ط§ظ„ظ…ط³طھط®ط¯ظ… ظٹط­ط¯ط¯ ظ…ط¶ط§ط¹ظپ ط§ظ„ط³ط­ط¨طŒ ظˆط§ظ„ط®ط§ط¯ظ… ظٹط­ط¯ط¯ ظ†ظ‚ط·ط© ط§ظ„ط§ظ†ظ‡ظٹط§ط±:
 *   P(crash > x) = RTP أ· x  â†’  E[x آ· 1(crash>x)] = RTP
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Animated, Easing, Alert, ScrollView,
} from 'react-native';
import { callFunction } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { Plane } from 'lucide-react-native';
import { StatusBar } from 'expo-status-bar';
import { colors, fonts } from '@/lib/theme';
import { usePreferencesStore } from '@/store/preferences';
import { GameHeader } from '@/components/GameHeader';
import { GameBetControl, parseValidGameBet } from '@/components/GameBetControl';
import { GameHistoryCard, GameOddsCard, GameTestModeRow } from '@/components/GamePanels';
import { usePublicGames } from '@/hooks/usePublicGames';
import { aviatorWinProbability, formatPercent, newIdempotencyKey } from '@/lib/gameConfig';

interface AviatorResponse {
  crash_point: number;
  is_win: boolean;
  payout: number;
  multiplier: number;
  test_mode: boolean;
  promo_reward: boolean;
}

export default function AviatorGame() {
  const { profile, loadProfile } = useAuthStore();
  const reduceMotion = usePreferencesStore((state) => state.reduceMotion);
  const { find } = usePublicGames();
  const game = find('aviator');
  const rtp = game?.declared_rtp ?? 25;
  const maxMultiplier = game?.max_multiplier ?? 1000;
  const [betAmount, setBetAmount] = useState('100');
  const [cashoutMult, setCashoutMult] = useState('2.0');
  const [multiplier, setMultiplier] = useState(1.0);
  const [isFlying, setIsFlying] = useState(false);
  const [testMode, setTestMode] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);
  const [result, setResult] = useState<{ crash: number; won: boolean; payout: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const multAnim = useRef(new Animated.Value(1)).current;
  const flightAnim = useRef(new Animated.Value(0)).current;
  const lastRendered = useRef(1);
  const validBet = parseValidGameBet(betAmount, profile?.balance_gold ?? 0);
  const targetValue = Number(cashoutMult);
  const targetProbability = Number.isFinite(targetValue) && targetValue > 1
    ? aviatorWinProbability(targetValue, rtp)
    : 0;

  useEffect(() => {
    const listenerId = multAnim.addListener(({ value }) => {
      if (Math.abs(value - lastRendered.current) >= 0.01) {
        lastRendered.current = value;
        setMultiplier(value);
      }
    });
    return () => {
      multAnim.removeListener(listenerId);
      multAnim.stopAnimation();
    };
  }, [multAnim]);

  const play = async () => {
    const bet = parseValidGameBet(betAmount, profile?.balance_gold ?? 0);
    const target = Number(cashoutMult);
    if (bet === null || !Number.isFinite(target) || target <= 1 || loading || isFlying) return;
    if (target > maxMultiplier) {
      Alert.alert('ظ…ط¶ط§ط¹ظپ ظƒط¨ظٹط±', `ط£ظ‚طµظ‰ ظ…ط¶ط§ط¹ظپ ط³ط­ط¨ ظ‡ظˆ ${maxMultiplier}x.`);
      return;
    }
    if (game && !game.available) {
      Alert.alert('ط§ظ„ظ„ط¹ط¨ط© ط؛ظٹط± ظ…طھط§ط­ط©', 'ظ‡ط°ظ‡ ط§ظ„ظ„ط¹ط¨ط© ط؛ظٹط± ظ…طھط§ط­ط© ظ„ط­ط³ط§ط¨ظƒ ط­ط§ظ„ظٹط§ظ‹.');
      return;
    }
    if (game && (bet < game.min_bet || bet > game.max_bet)) {
      Alert.alert('ط§ظ„ط±ظ‡ط§ظ† ط®ط§ط±ط¬ ط§ظ„ط­ط¯ظˆط¯', `ط§ظ„ط­ط¯ ط§ظ„ظ…ط³ظ…ظˆط­ ظ…ظ† ${game.min_bet} ط¥ظ„ظ‰ ${game.max_bet} Coin.`);
      return;
    }
    setLoading(true);
    setResult(null);
    setMultiplier(1.0);
    lastRendered.current = 1;
    multAnim.setValue(1);
    flightAnim.setValue(0);

    try {
      const response = await callFunction<AviatorResponse>('game-aviator', {
        bet_amount: bet,
        auto_cashout_multiplier: target,
        test_mode: testMode,
      }, newIdempotencyKey('game-aviator'));
      if (
        typeof response.is_win !== 'boolean'
        || !Number.isFinite(response.crash_point)
        || !Number.isFinite(response.payout)
        || response.crash_point < 1
        || response.payout < 0
      ) {
        throw new Error('ظ„ظ… طھطµظ„ ظ†طھظٹط¬ط© ط§ظ„ط¬ظˆظ„ط© ط¨ط´ظƒظ„ طµط­ظٹط­.');
      }

      setLoading(false);
      setIsFlying(true);
      const targetMult = response.is_win ? target : response.crash_point;
      const duration = reduceMotion
        ? 320
        : Math.min(4200, 850 + Math.round(targetMult * 320));

      Animated.parallel([
        Animated.timing(multAnim, {
          toValue: targetMult,
          duration,
          useNativeDriver: false,
          easing: Easing.out(Easing.quad),
        }),
        Animated.timing(flightAnim, {
          toValue: 1,
          duration,
          useNativeDriver: true,
          easing: Easing.out(Easing.quad),
        }),
      ]).start(({ finished }) => {
        if (!finished) return;
        setMultiplier(targetMult);
        setIsFlying(false);
        setResult({
          crash: response.crash_point,
          won: response.is_win,
          payout: response.payout,
        });
        setHistoryKey((key) => key + 1);
        void loadProfile().catch((error: unknown) => {
          console.warn('[Wattar] Failed to refresh Coin balance after Aviator:', error);
        });
      });
    } catch (err: unknown) {
      setLoading(false);
      setIsFlying(false);
      Alert.alert('ط®ط·ط£', err instanceof Error ? err.message : 'طھط¹ط°ط± ط¥ظƒظ…ط§ظ„ ط§ظ„ط¬ظˆظ„ط©.');
    }
  };

  const planeX = flightAnim.interpolate({ inputRange: [0, 1], outputRange: [-110, 110] });
  const planeY = flightAnim.interpolate({ inputRange: [0, 1], outputRange: [70, -62] });
  const planeRotation = flightAnim.interpolate({ inputRange: [0, 1], outputRange: ['-8deg', '-32deg'] });
  const crashed = result !== null && !result.won;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <StatusBar style="light" />
      <GameHeader
        title={game?.display_name ?? 'ط·ظٹط§ط±ط© ط§ظ„ظ…ط¶ط§ط¹ظپط§طھ'}
        subtitle={game?.description ?? 'ط­ط¯ظ‘ط¯ ظ…ط¶ط§ط¹ظپ ط§ظ„ط³ط­ط¨ ظ‚ط¨ظ„ ط§ظ„ط¥ظ‚ظ„ط§ط¹. ط§ظ„ط·ظٹط§ط±ط© طھط·ظٹط± ط­طھظ‰ ظ†ظ‚ط·ط© ط§ظ†ظ‡ظٹط§ط± ظٹط­ط¯ط¯ظ‡ط§ ط§ظ„ط®ط§ط¯ظ….'}
        balance={profile?.balance_gold ?? 0}
      />

      <GameTestModeRow
        enabled={game?.test_mode_enabled === true}
        value={testMode}
        onChange={setTestMode}
      />

      <View style={styles.gameArea}>
        <View style={styles.flightGrid} pointerEvents="none">
          {[0, 1, 2, 3].map((line) => <View key={`h-${line}`} style={[styles.gridLine, { top: 28 + line * 40 }]} />)}
          {[0, 1, 2, 3, 4].map((line) => <View key={`v-${line}`} style={[styles.gridVertical, { left: 30 + line * 62 }]} />)}
        </View>
        {(isFlying || result) && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.plane,
              { transform: [{ translateX: planeX }, { translateY: planeY }, { rotate: planeRotation }] },
            ]}
          >
            <Plane size={30} color={crashed ? colors.danger : colors.gold} />
          </Animated.View>
        )}
        <View style={styles.multDisplay}>
          {isFlying || result ? (
            <Text style={[styles.multiplier, crashed && styles.multiplierCrash]}>
              {multiplier.toFixed(2)}x
            </Text>
          ) : (
            <Text style={styles.placeholder}>ط¶ط¹ ط±ظ‡ط§ظ†ظƒ ظˆط§ط¨ط¯ط£ ط§ظ„ط±ط­ظ„ط©</Text>
          )}
          {result && (
            <Text style={[styles.resultText, result.won ? styles.winText : styles.loseText]}>
              {result.won
                ? `ط±ط¨ط­طھ ${result.payout.toLocaleString()} Coin!`
                : `ط§ظ†ظ‡ط§ط±طھ ط¹ظ†ط¯ ${result.crash.toFixed(2)}x`}
            </Text>
          )}
        </View>
      </View>

      <View style={styles.controlsCard}>
        <GameBetControl
          value={betAmount}
          balance={profile?.balance_gold ?? 0}
          disabled={loading || isFlying}
          onChange={setBetAmount}
        />
        {game ? (
          <Text style={styles.limitHint}>
            ط§ظ„ط­ط¯: {game.min_bet.toLocaleString()} â€“ {game.max_bet.toLocaleString()} Coin
          </Text>
        ) : null}

        <View style={styles.inputGroup}>
          <View style={styles.inputHeading}>
            <Text style={styles.inputLabel}>ط§ظ„ط³ط­ط¨ ط§ظ„طھظ„ظ‚ط§ط¦ظٹ ط¹ظ†ط¯ (x)</Text>
            <Text style={styles.probability}>
              ط§ط­طھظ…ط§ظ„ ط§ظ„ظˆطµظˆظ„ {formatPercent(targetProbability * 100)}
            </Text>
          </View>
          <TextInput
            style={styles.input}
            value={cashoutMult}
            onChangeText={setCashoutMult}
            keyboardType="decimal-pad"
            placeholder="2.0"
            placeholderTextColor={colors.textMuted}
            editable={!loading && !isFlying}
          />
          <View style={styles.targetPresets}>
            {['1.5', '2', '3', '5'].map((preset) => (
              <TouchableOpacity
                key={preset}
                style={[styles.targetPreset, cashoutMult === preset && styles.targetPresetActive]}
                onPress={() => setCashoutMult(preset)}
                disabled={loading || isFlying}
                accessibilityRole="button"
                accessibilityState={{ selected: cashoutMult === preset, disabled: loading || isFlying }}
              >
                <Text style={[styles.targetPresetText, cashoutMult === preset && styles.targetPresetTextActive]}>
                  {preset}x
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.targetHint}>
            RTP ط§ظ„ظ…ط¹ظ„ظ† {formatPercent(rtp)} â€” طھظڈط­ط¯ط¯ ظ†ظ‚ط·ط© ط§ظ„ط§ظ†ظ‡ظٹط§ط± ط¹ظ„ظ‰ ط§ظ„ط®ط§ط¯ظ… ظ‚ط¨ظ„ ط¹ط±ط¶ ط§ظ„ظ…ط³ط§ط±.
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.playButton, (loading || validBet === null) && styles.playButtonDisabled]}
          onPress={play}
          disabled={loading || isFlying || validBet === null}
        >
          <Plane size={20} color={colors.inkDark} />
          <Text style={styles.playButtonText}>
            {loading ? 'ط¬ط§ط±ظٹ...' : isFlying ? 'طھط·ظٹط±...' : 'ط¥ظ‚ظ„ط§ط¹ ًںڑ€'}
          </Text>
        </TouchableOpacity>
      </View>

      <GameOddsCard game={game} />
      <GameHistoryCard gameType="aviator" refreshKey={historyKey} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.roomBackground },
  content: { padding: 16, paddingTop: 58, paddingBottom: 32 },
  gameArea: {
    backgroundColor: colors.roomBackground,
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    minHeight: 280,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    overflow: 'hidden',
    marginTop: 12,
  },
  flightGrid: { ...StyleSheet.absoluteFill, opacity: 0.6 },
  gridLine: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: colors.borderSoft },
  gridVertical: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: colors.borderSoft },
  plane: { position: 'absolute', left: '50%', bottom: 60, zIndex: 2 },
  multDisplay: { alignItems: 'center', zIndex: 3, minHeight: 88, justifyContent: 'center' },
  multiplier: { color: colors.roomTeal, fontSize: 60, fontFamily: fonts.black, textShadowColor: colors.tealEdge, textShadowRadius: 18 },
  multiplierCrash: { color: colors.danger },
  placeholder: { color: colors.roomMuted, fontSize: 16 },
  resultText: { fontSize: 14, marginTop: 8, fontFamily: fonts.semibold },
  winText: { color: colors.roomTeal },
  loseText: { color: colors.danger },
  controlsCard: { backgroundColor: colors.roomSurface, borderRadius: 16, padding: 16, marginTop: 16 },
  limitHint: { color: colors.roomMuted, fontSize: 10, textAlign: 'right', marginTop: 8 },
  inputGroup: { marginTop: 14 },
  inputHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 },
  inputLabel: { color: colors.roomMuted, fontSize: 12 },
  probability: { color: colors.teal, fontSize: 10, fontFamily: fonts.bold },
  targetHint: { color: colors.roomMuted, fontSize: 10, lineHeight: 15, marginTop: 7, textAlign: 'right' },
  targetPresets: { flexDirection: 'row', gap: 7, marginTop: 9 },
  targetPreset: { flex: 1, minHeight: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: colors.roomElevated },
  targetPresetActive: { backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: colors.primary },
  targetPresetText: { color: colors.roomMuted, fontSize: 11, fontFamily: fonts.bold },
  targetPresetTextActive: { color: colors.roomText },
  input: {
    backgroundColor: colors.roomElevated,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.roomText,
    fontSize: 16,
  },
  playButton: {
    backgroundColor: colors.roomPrimary,
    height: 50,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 14,
  },
  playButtonDisabled: { opacity: 0.5 },
  playButtonText: { color: colors.inkDark, fontSize: 16, fontFamily: fonts.black },
});
