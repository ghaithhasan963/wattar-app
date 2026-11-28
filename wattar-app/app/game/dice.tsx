/**
 * Wattar App — نرد (M9.4)
 * حد التوقع واتجاهه من المستخدم، والنتيجة والمضاعف من الخادم.
 * المضاعف المعروض = (1 ÷ احتمال الفوز) × RTP المعلن.
 */
import React, { useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Alert, ScrollView, Animated, Easing,
} from 'react-native';
import { callFunction } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { Dice5, Minus, Plus, TrendingUp, TrendingDown } from 'lucide-react-native';
import { StatusBar } from 'expo-status-bar';
import { colors, fonts } from '@/lib/theme';
import { usePreferencesStore } from '@/store/preferences';
import { GameHeader } from '@/components/GameHeader';
import { GameBetControl, parseValidGameBet } from '@/components/GameBetControl';
import { GameHistoryCard, GameOddsCard, GameTestModeRow } from '@/components/GamePanels';
import { usePublicGames } from '@/hooks/usePublicGames';
import { diceQuote, formatPercent, newIdempotencyKey } from '@/lib/gameConfig';

interface DiceResponse {
  roll: number;
  is_win: boolean;
  payout: number;
  multiplier: number;
  test_mode: boolean;
  promo_reward: boolean;
}

export default function DiceGame() {
  const { profile, loadProfile } = useAuthStore();
  const reduceMotion = usePreferencesStore((state) => state.reduceMotion);
  const { find } = usePublicGames();
  const game = find('dice');
  const rtp = game?.declared_rtp ?? 30;
  const [betAmount, setBetAmount] = useState('100');
  const [target, setTarget] = useState('50');
  const [direction, setDirection] = useState<'over' | 'under'>('over');
  const [rolling, setRolling] = useState(false);
  const [testMode, setTestMode] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);
  const [result, setResult] = useState<{ roll: number; won: boolean; payout: number; mult: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const dieRotation = useRef(new Animated.Value(0)).current;
  const dieBounce = useRef(new Animated.Value(0)).current;
  const resultScale = useRef(new Animated.Value(0)).current;
  const validBet = parseValidGameBet(betAmount, profile?.balance_gold ?? 0);

  const quote = diceQuote(Number(target), direction, rtp);

  const changeTarget = (amount: number) => {
    const nextTarget = Math.min(98, Math.max(2, Number(target) + amount));
    setTarget(String(nextTarget));
  };

  const play = async () => {
    const bet = parseValidGameBet(betAmount, profile?.balance_gold ?? 0);
    const targetValue = Number(target);
    if (
      bet === null
      || !Number.isInteger(targetValue)
      || targetValue < 2
      || targetValue > 98
      || loading
    ) return;
    if (game && !game.available) {
      Alert.alert('اللعبة غير متاحة', 'هذه اللعبة غير متاحة لحسابك حالياً.');
      return;
    }
    if (game && (bet < game.min_bet || bet > game.max_bet)) {
      Alert.alert('الرهان خارج الحدود', `الحد المسموح من ${game.min_bet} إلى ${game.max_bet} Coin.`);
      return;
    }
    setLoading(true);
    setResult(null);
    resultScale.setValue(0);

    const rollAnimation = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(dieRotation, { toValue: 1, duration: 380, easing: Easing.linear, useNativeDriver: true }),
          Animated.timing(dieRotation, { toValue: 0, duration: 380, easing: Easing.linear, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(dieBounce, { toValue: 1, duration: 190, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(dieBounce, { toValue: 0, duration: 190, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        ]),
      ]),
    );

    try {
      setRolling(true);
      if (!reduceMotion) rollAnimation.start();
      const response = await callFunction<DiceResponse>('game-dice', {
        bet_amount: bet,
        target: targetValue,
        direction,
        test_mode: testMode,
      }, newIdempotencyKey('game-dice'));

      if (
        !Number.isInteger(response.roll)
        || response.roll < 1
        || response.roll > 100
        || typeof response.is_win !== 'boolean'
        || !Number.isFinite(response.payout)
        || response.payout < 0
        || !Number.isFinite(response.multiplier)
        || response.multiplier < 0
      ) {
        throw new Error('لم تصل نتيجة النرد بشكل صحيح.');
      }

      rollAnimation.stop();
      if (!reduceMotion) {
        await new Promise<void>((resolve) => {
          Animated.sequence([
            Animated.timing(dieBounce, { toValue: 0.8, duration: 90, easing: Easing.out(Easing.quad), useNativeDriver: true }),
            Animated.spring(dieBounce, { toValue: 0, speed: 20, bounciness: 10, useNativeDriver: true }),
          ]).start(() => resolve());
        });
      }
      setResult({
        roll: response.roll,
        won: response.is_win,
        payout: response.payout,
        mult: response.multiplier,
      });
      setHistoryKey((key) => key + 1);
      Animated.spring(resultScale, { toValue: 1, speed: 16, bounciness: 9, useNativeDriver: true }).start();
      void loadProfile().catch((error: unknown) => {
        console.warn('[Wattar] Failed to refresh Coin balance after dice:', error);
      });
    } catch (err: unknown) {
      Alert.alert('خطأ', err instanceof Error ? err.message : 'تعذر إكمال الجولة.');
    } finally {
      rollAnimation.stop();
      dieRotation.stopAnimation();
      dieBounce.stopAnimation();
      dieRotation.setValue(0);
      dieBounce.setValue(0);
      setRolling(false);
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <StatusBar style="light" />
      <GameHeader
        title={game?.display_name ?? 'نرد'}
        subtitle={game?.description ?? 'توقع أن تكون النتيجة أعلى أو أدنى من حدّك. المضاعف يُحسب على الخادم من RTP.'}
        balance={profile?.balance_gold ?? 0}
      />

      <GameTestModeRow
        enabled={game?.test_mode_enabled === true}
        value={testMode}
        onChange={setTestMode}
      />

      <View style={styles.diceContainer}>
        {rolling ? (
          <Animated.View style={{
            transform: [
              { translateY: dieBounce.interpolate({ inputRange: [0, 1], outputRange: [0, -38] }) },
              { scale: dieBounce.interpolate({ inputRange: [0, 1], outputRange: [1, 0.86] }) },
              { rotate: dieRotation.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) },
            ],
          }}>
            <Dice5 size={122} color={colors.roomPrimary} />
          </Animated.View>
        ) : result ? (
          <Animated.View
            style={[
              styles.diceResult,
              result.won ? styles.diceWin : styles.diceLose,
              { transform: [{ scale: resultScale }] },
            ]}
          >
            <Text style={styles.diceNumber}>{result.roll}</Text>
          </Animated.View>
        ) : (
          <View style={styles.dicePlaceholder}>
            <Dice5 size={122} color={colors.roomElevated} />
          </View>
        )}
      </View>

      {result && (
        <View style={[styles.resultBanner, result.won ? styles.winBanner : styles.loseBanner]}>
          <Text style={styles.resultText}>
            {result.won
              ? `🎉 الرقم ${result.roll} — ربحت ${result.payout.toLocaleString()} Coin (×${result.mult})`
              : `الرقم ${result.roll} — خسرت`}
          </Text>
        </View>
      )}

      <View style={styles.targetCard}>
        <View style={styles.targetHeading}>
          <Text style={styles.targetLabel}>حدّ التوقع</Text>
          <Text style={styles.targetRange}>من 2 إلى 98</Text>
        </View>
        <View style={styles.targetStepper}>
          <TouchableOpacity
            style={styles.stepButton}
            onPress={() => changeTarget(-1)}
            disabled={Number(target) <= 2 || loading}
            accessibilityRole="button"
            accessibilityLabel="خفض حد التوقع"
          >
            <Minus size={18} color={colors.roomText} />
          </TouchableOpacity>
          <View style={styles.targetValueCard}>
            <Text style={styles.targetValue}>{Number(target)}</Text>
            <Text style={styles.targetValueCaption}>من 100</Text>
          </View>
          <TouchableOpacity
            style={styles.stepButton}
            onPress={() => changeTarget(1)}
            disabled={Number(target) >= 98 || loading}
            accessibilityRole="button"
            accessibilityLabel="رفع حد التوقع"
          >
            <Plus size={18} color={colors.roomText} />
          </TouchableOpacity>
        </View>
        <Text style={styles.targetSummary}>
          {direction === 'under'
            ? `تربح إذا كانت النتيجة من 1 إلى ${Number(target) - 1}`
            : `تربح إذا كانت النتيجة من ${Number(target) + 1} إلى 100`}
        </Text>
        <View style={styles.targetPresets}>
          {[25, 50, 75].map((preset) => (
            <TouchableOpacity
              key={preset}
              style={[styles.targetPreset, Number(target) === preset && styles.targetPresetActive]}
              onPress={() => setTarget(String(preset))}
              disabled={loading}
              accessibilityRole="button"
              accessibilityState={{ selected: Number(target) === preset, disabled: loading }}
            >
              <Text style={[styles.targetPresetText, Number(target) === preset && styles.targetPresetTextActive]}>
                {preset}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.controlsCard}>
        <View style={styles.directionRow}>
          <TouchableOpacity
            style={[styles.dirBtn, direction === 'under' && styles.dirBtnActive]}
            onPress={() => setDirection('under')}
          >
            <TrendingDown size={18} color={direction === 'under' ? colors.text : colors.textMuted} />
            <Text style={[styles.dirText, direction === 'under' && styles.dirTextActive]}>تحت {Number(target) - 1}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.dirBtn, direction === 'over' && styles.dirBtnActive]}
            onPress={() => setDirection('over')}
          >
            <TrendingUp size={18} color={direction === 'over' ? colors.text : colors.textMuted} />
            <Text style={[styles.dirText, direction === 'over' && styles.dirTextActive]}>فوق {Number(target)}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>احتمال الفوز</Text>
            <Text style={styles.statValue}>{formatPercent(quote.pWin * 100)}</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>المضاعف المعلن</Text>
            <Text style={styles.statValue}>{quote.multiplier.toFixed(2)}x</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>RTP</Text>
            <Text style={styles.statValue}>{formatPercent(rtp)}</Text>
          </View>
        </View>

        <GameBetControl
          value={betAmount}
          balance={profile?.balance_gold ?? 0}
          disabled={loading || rolling}
          onChange={setBetAmount}
        />
        {game ? (
          <Text style={styles.limitHint}>
            الحد: {game.min_bet.toLocaleString()} – {game.max_bet.toLocaleString()} Coin
          </Text>
        ) : null}

        <TouchableOpacity
          style={[styles.playButton, (rolling || loading || validBet === null) && styles.playButtonDisabled]}
          onPress={play}
          disabled={rolling || loading || validBet === null}
        >
          <Text style={styles.playButtonText}>
            {rolling ? '🎲 يدور...' : loading ? 'جاري...' : 'ارمِ النرد'}
          </Text>
        </TouchableOpacity>
      </View>

      <GameOddsCard game={game} />
      <GameHistoryCard gameType="dice" refreshKey={historyKey} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.roomBackground },
  content: { padding: 16, paddingTop: 58, paddingBottom: 32 },
  diceContainer: { alignItems: 'center', marginVertical: 16, minHeight: 132, justifyContent: 'center' },
  dicePlaceholder: { padding: 20 },
  diceResult: {
    width: 122,
    height: 122,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
  },
  diceWin: { backgroundColor: colors.tealGlow, borderColor: colors.roomTeal },
  diceLose: { backgroundColor: colors.dangerGlow, borderColor: colors.danger },
  diceNumber: { fontSize: 56, fontFamily: fonts.black, color: colors.roomText },
  resultBanner: { padding: 12, borderRadius: 10, alignItems: 'center', marginBottom: 12 },
  winBanner: { backgroundColor: colors.tealHaze, borderWidth: 1, borderColor: colors.roomTeal },
  loseBanner: { backgroundColor: colors.dangerGlow, borderWidth: 1, borderColor: colors.danger },
  resultText: { color: colors.roomText, fontSize: 14, fontFamily: fonts.bold },
  targetCard: { backgroundColor: colors.roomSurface, borderRadius: 14, padding: 16, marginBottom: 12 },
  targetHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  targetLabel: { color: colors.roomText, fontSize: 13, fontFamily: fonts.bold },
  targetRange: { color: colors.roomMuted, fontSize: 10, fontFamily: fonts.semibold },
  targetStepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16, marginTop: 13 },
  stepButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.roomElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  targetValueCard: { minWidth: 92, alignItems: 'center', paddingVertical: 6 },
  targetValue: { color: colors.gold, fontSize: 32, fontFamily: fonts.black },
  targetValueCaption: { color: colors.roomMuted, fontSize: 10, fontFamily: fonts.semibold },
  targetSummary: { color: colors.roomText, fontSize: 11, fontFamily: fonts.semibold, textAlign: 'center', marginTop: 12 },
  targetPresets: { flexDirection: 'row', gap: 8, marginTop: 12 },
  targetPreset: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 9, backgroundColor: colors.roomElevated },
  targetPresetActive: { backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: colors.primary },
  targetPresetText: { color: colors.roomMuted, fontSize: 11, fontFamily: fonts.bold },
  targetPresetTextActive: { color: colors.roomText },
  controlsCard: { backgroundColor: colors.roomSurface, borderRadius: 16, padding: 16 },
  directionRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  dirBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: colors.roomElevated,
  },
  dirBtnActive: { backgroundColor: colors.roomPrimary },
  dirText: { color: colors.roomMuted, fontSize: 14, fontFamily: fonts.semibold },
  dirTextActive: { color: colors.roomText },
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  statBox: { flex: 1, backgroundColor: colors.roomElevated, borderRadius: 8, padding: 9, alignItems: 'center' },
  statLabel: { color: colors.roomMuted, fontSize: 10 },
  statValue: { color: colors.gold, fontSize: 14, fontFamily: fonts.black, marginTop: 4 },
  limitHint: { color: colors.roomMuted, fontSize: 10, textAlign: 'right', marginTop: 8 },
  playButton: {
    backgroundColor: colors.roomTeal,
    height: 50,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },
  playButtonDisabled: { opacity: 0.5 },
  playButtonText: { color: colors.background, fontSize: 16, fontFamily: fonts.black },
});
