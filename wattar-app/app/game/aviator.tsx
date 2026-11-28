/**
 * Wattar App — طيارة المضاعفات (M9.4)
 * المستخدم يحدد مضاعف السحب، والخادم يحدد نقطة الانهيار:
 *   P(crash > x) = RTP ÷ x  →  E[x · 1(crash>x)] = RTP
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
      Alert.alert('مضاعف كبير', `أقصى مضاعف سحب هو ${maxMultiplier}x.`);
      return;
    }
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
        throw new Error('لم تصل نتيجة الجولة بشكل صحيح.');
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
      Alert.alert('خطأ', err instanceof Error ? err.message : 'تعذر إكمال الجولة.');
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
        title={game?.display_name ?? 'طيارة المضاعفات'}
        subtitle={game?.description ?? 'حدّد مضاعف السحب قبل الإقلاع. الطيارة تطير حتى نقطة انهيار يحددها الخادم.'}
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
            <Text style={styles.placeholder}>ضع رهانك وابدأ الرحلة</Text>
          )}
          {result && (
            <Text style={[styles.resultText, result.won ? styles.winText : styles.loseText]}>
              {result.won
                ? `ربحت ${result.payout.toLocaleString()} Coin!`
                : `انهارت عند ${result.crash.toFixed(2)}x`}
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
            الحد: {game.min_bet.toLocaleString()} – {game.max_bet.toLocaleString()} Coin
          </Text>
        ) : null}

        <View style={styles.inputGroup}>
          <View style={styles.inputHeading}>
            <Text style={styles.inputLabel}>السحب التلقائي عند (x)</Text>
            <Text style={styles.probability}>
              احتمال الوصول {formatPercent(targetProbability * 100)}
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
            RTP المعلن {formatPercent(rtp)} — تُحدد نقطة الانهيار على الخادم قبل عرض المسار.
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.playButton, (loading || validBet === null) && styles.playButtonDisabled]}
          onPress={play}
          disabled={loading || isFlying || validBet === null}
        >
          <Plane size={20} color={colors.inkDark} />
          <Text style={styles.playButtonText}>
            {loading ? 'جاري...' : isFlying ? 'تطير...' : 'إقلاع 🚀'}
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
