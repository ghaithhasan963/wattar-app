/**
 * Wattar App — صفحة نرد (Dice)
 * المستخدم يختار target + direction (over/under)
 */
import React, { useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Alert, ScrollView, Animated, Easing,
} from 'react-native';
import { callFunction } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { Dice5, Minus, Plus, TrendingUp, TrendingDown } from 'lucide-react-native';
import { StatusBar } from 'expo-status-bar';
import { colors } from '@/lib/theme';
import { usePreferencesStore } from '@/store/preferences';
import { GameHeader } from '@/components/GameHeader';
import { GameBetControl, parseValidGameBet } from '@/components/GameBetControl';

interface DiceResponse {
  roll: number;
  is_win: boolean;
  payout: number;
  multiplier: number;
}

export default function DiceGame() {
  const { profile, loadProfile } = useAuthStore();
  const reduceMotion = usePreferencesStore((state) => state.reduceMotion);
  const [betAmount, setBetAmount] = useState('100');
  const [target, setTarget] = useState('50');
  const [direction, setDirection] = useState<'over' | 'under'>('over');
  const [rolling, setRolling] = useState(false);
  const [result, setResult] = useState<{ roll: number; won: boolean; payout: number; mult: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const dieRotation = useRef(new Animated.Value(0)).current;
  const dieBounce = useRef(new Animated.Value(0)).current;
  const validBet = parseValidGameBet(betAmount, profile?.game_points ?? 0);

  const pWin = direction === 'over'
    ? (100 - Number(target)) / 100
    : (Number(target) - 1) / 100;
  const fairMult = 1 / Math.max(pWin, 0.01);
  const adjustedMult = fairMult * 30 / 100; // RTP 30%
  const changeTarget = (amount: number) => {
    const nextTarget = Math.min(98, Math.max(2, Number(target) + amount));
    setTarget(String(nextTarget));
  };

  const play = async () => {
    const bet = parseValidGameBet(betAmount, profile?.game_points ?? 0);
    const targetValue = Number(target);
    if (
      bet === null
      || !Number.isInteger(targetValue)
      || targetValue < 2
      || targetValue > 98
      || loading
    ) return;
    setLoading(true);
    setResult(null);

    const rollAnimation = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(dieRotation, { toValue: 1, duration: 420, easing: Easing.linear, useNativeDriver: true }),
          Animated.timing(dieRotation, { toValue: 0, duration: 420, easing: Easing.linear, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(dieBounce, { toValue: 1, duration: 210, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(dieBounce, { toValue: 0, duration: 210, easing: Easing.in(Easing.quad), useNativeDriver: true }),
          Animated.timing(dieBounce, { toValue: 1, duration: 210, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(dieBounce, { toValue: 0, duration: 210, easing: Easing.in(Easing.quad), useNativeDriver: true }),
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
      }, `game-dice-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`);
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
            Animated.timing(dieBounce, { toValue: 0.75, duration: 100, easing: Easing.out(Easing.quad), useNativeDriver: true }),
            Animated.spring(dieBounce, { toValue: 0, speed: 18, bounciness: 8, useNativeDriver: true }),
          ]).start(() => resolve());
        });
      }
      setResult({
        roll: response.roll,
        won: response.is_win,
        payout: response.payout,
        mult: response.multiplier,
      });
      void loadProfile().catch((error: unknown) => {
        console.warn('[Wattar] Failed to refresh game points after dice:', error);
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
        title="نرد"
        subtitle="اختر اتجاه التوقع وحدد رهانك قبل بدء الجولة."
        balance={profile?.game_points ?? 0}
      />

      <View style={styles.diceContainer}>
        {rolling ? (
          <Animated.View style={{ transform: [
            { translateY: dieBounce.interpolate({ inputRange: [0, 1], outputRange: [0, -36] }) },
            { scale: dieBounce.interpolate({ inputRange: [0, 1], outputRange: [1, 0.88] }) },
            { rotate: dieRotation.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) },
          ] }}>
            <Dice5 size={120} color={colors.roomPrimary} />
          </Animated.View>
        ) : result ? (
          <View style={[styles.diceResult, result.won ? styles.diceWin : styles.diceLose]}>
            <Text style={styles.diceNumber}>{result.roll}</Text>
          </View>
        ) : (
          <View style={styles.dicePlaceholder}>
            <Dice5 size={120} color={colors.roomElevated} />
          </View>
        )}
      </View>

      {result && (
        <View style={[styles.resultBanner, result.won ? styles.winBanner : styles.loseBanner]}>
          <Text style={styles.resultText}>
            {result.won
              ? `🎉 الرقم ${result.roll} — ربحت ${result.payout} نقطة (${result.mult}x)`
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
            <TrendingDown size={18} color={direction === 'under' ? '#fff' : '#9CA3AF'} />
            <Text style={[styles.dirText, direction === 'under' && styles.dirTextActive]}>تحت {Number(target) - 1}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.dirBtn, direction === 'over' && styles.dirBtnActive]}
            onPress={() => setDirection('over')}
          >
            <TrendingUp size={18} color={direction === 'over' ? '#fff' : '#9CA3AF'} />
            <Text style={[styles.dirText, direction === 'over' && styles.dirTextActive]}>فوق {Number(target)}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>احتمال الفوز</Text>
            <Text style={styles.statValue}>{(pWin * 100).toFixed(1)}%</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>المضاعف</Text>
            <Text style={styles.statValue}>{adjustedMult.toFixed(2)}x</Text>
          </View>
        </View>

        <GameBetControl
          value={betAmount}
          balance={profile?.game_points ?? 0}
          disabled={loading || rolling}
          onChange={setBetAmount}
        />

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

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.roomBackground },
  content: { padding: 16, paddingTop: 58, paddingBottom: 32 },
  title: { color: colors.roomText, fontSize: 24, fontWeight: '800', textAlign: 'center', marginBottom: 16 },
  diceContainer: { alignItems: 'center', marginVertical: 16 },
  dicePlaceholder: { padding: 20 },
  diceResult: {
    width: 120,
    height: 120,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
  },
  diceWin: { backgroundColor: '#159C9C30', borderColor: colors.roomTeal },
  diceLose: { backgroundColor: '#C94D6030', borderColor: colors.danger },
  diceNumber: { fontSize: 56, fontWeight: 'bold', color: colors.roomText },
  resultBanner: { padding: 12, borderRadius: 10, alignItems: 'center', marginBottom: 12 },
  winBanner: { backgroundColor: '#159C9C20', borderWidth: 1, borderColor: colors.roomTeal },
  loseBanner: { backgroundColor: '#C94D6020', borderWidth: 1, borderColor: colors.danger },
  resultText: { color: colors.roomText, fontSize: 14, fontWeight: 'bold' },
  targetCard: { backgroundColor: colors.roomSurface, borderRadius: 14, padding: 16, marginBottom: 12 },
  targetHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  targetLabel: { color: colors.roomText, fontSize: 13, fontWeight: '800' },
  targetRange: { color: colors.roomMuted, fontSize: 10, fontWeight: '700' },
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
  targetValue: { color: colors.gold, fontSize: 32, fontWeight: '900' },
  targetValueCaption: { color: colors.roomMuted, fontSize: 10, fontWeight: '700' },
  targetSummary: { color: colors.roomText, fontSize: 11, fontWeight: '700', textAlign: 'center', marginTop: 12 },
  targetPresets: { flexDirection: 'row', gap: 8, marginTop: 12 },
  targetPreset: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 9, backgroundColor: colors.roomElevated },
  targetPresetActive: { backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: colors.primary },
  targetPresetText: { color: colors.roomMuted, fontSize: 11, fontWeight: '800' },
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
  dirText: { color: colors.roomMuted, fontSize: 14, fontWeight: '600' },
  dirTextActive: { color: colors.roomText },
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  statBox: { flex: 1, backgroundColor: colors.roomElevated, borderRadius: 8, padding: 10, alignItems: 'center' },
  statLabel: { color: colors.roomMuted, fontSize: 11 },
  statValue: { color: colors.gold, fontSize: 16, fontWeight: 'bold', marginTop: 4 },
  label: { color: colors.roomMuted, fontSize: 13, marginBottom: 4 },
  input: {
    backgroundColor: colors.roomElevated,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.roomText,
    fontSize: 16,
  },
  playButton: {
    backgroundColor: colors.roomTeal,
    height: 50,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  playButtonDisabled: { opacity: 0.5 },
  playButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  balance: { color: colors.roomMuted, fontSize: 13, textAlign: 'center', marginTop: 16 },
});
