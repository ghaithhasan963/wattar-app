/**
 * Wattar App — صفحة نرد (Dice)
 * المستخدم يختار target + direction (over/under)
 */
import React, { useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView, Animated, Easing,
} from 'react-native';
import { callFunction } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { Dice5, TrendingUp, TrendingDown } from 'lucide-react-native';
import { StatusBar } from 'expo-status-bar';
import { colors } from '@/lib/theme';
import { usePreferencesStore } from '@/store/preferences';

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

  const pWin = direction === 'over'
    ? (100 - Number(target)) / 100
    : (Number(target) - 1) / 100;
  const fairMult = 1 / Math.max(pWin, 0.01);
  const adjustedMult = fairMult * 30 / 100; // RTP 30%

  const play = async () => {
    const bet = Number(betAmount);
    const targetValue = Number(target);
    if (
      !Number.isSafeInteger(bet)
      || bet < 1
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
      <Text style={styles.title}>نرد</Text>

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

      {/* شريط الـ Target */}
      <View style={styles.targetCard}>
        <View style={styles.targetRow}>
          <Text style={styles.targetLabel}>تحت</Text>
          <Text style={[styles.targetValue, direction === 'under' && styles.targetValueActive]}>
            {Number(target) - 1}
          </Text>
          <View style={styles.targetSlider}>
            <View style={[styles.targetFill, { width: `${target}%` as any }]} />
            <View style={[styles.targetKnob, { left: `${target}%` as any }]} />
          </View>
          <Text style={[styles.targetValue, direction === 'over' && styles.targetValueActive]}>
            {100 - Number(target)}
          </Text>
          <Text style={styles.targetLabel}>فوق</Text>
        </View>
        <TextInput
          style={styles.targetInput}
          value={target}
          onChangeText={(v) => {
            const n = Number(v);
            if (n >= 2 && n <= 98) setTarget(v);
          }}
          keyboardType="numeric"
        />
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

        <Text style={styles.label}>مقدار Point للجولة</Text>
        <TextInput
          style={styles.input}
          value={betAmount}
          onChangeText={setBetAmount}
          keyboardType="numeric"
          placeholder="100"
          placeholderTextColor="#666"
        />

        <TouchableOpacity
          style={[styles.playButton, (rolling || loading) && styles.playButtonDisabled]}
          onPress={play}
          disabled={rolling || loading}
        >
          <Text style={styles.playButtonText}>
            {rolling ? '🎲 يدور...' : loading ? 'جاري...' : 'ارمِ النرد'}
          </Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.balance}>Point: {profile?.game_points?.toLocaleString() ?? 0}</Text>
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
  targetRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  targetLabel: { color: colors.roomMuted, fontSize: 12 },
  targetValue: { color: colors.roomMuted, fontSize: 14, fontWeight: '600' },
  targetValueActive: { color: colors.roomPrimary, fontSize: 18 },
  targetSlider: {
    flex: 1,
    height: 8,
    backgroundColor: colors.roomElevated,
    borderRadius: 4,
    position: 'relative',
    marginHorizontal: 8,
  },
  targetFill: {
    position: 'absolute',
    height: '100%',
    backgroundColor: colors.roomPrimary,
    borderRadius: 4,
    left: 0,
  },
  targetKnob: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#fff',
    top: -4,
    marginLeft: -8,
  },
  targetInput: {
    backgroundColor: colors.roomElevated,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    color: colors.roomText,
    fontSize: 14,
    marginTop: 12,
    textAlign: 'center',
  },
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
