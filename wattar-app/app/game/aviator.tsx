/**
 * Wattar App — صفحة لعبة Aviator
 * نموذج أولي — يلعب عبر Edge Function
 */
import React, { useEffect, useState, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Animated, Easing, Alert, ScrollView,
} from 'react-native';
import { callFunction } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { Plane, TrendingUp } from 'lucide-react-native';
import { StatusBar } from 'expo-status-bar';
import { colors } from '@/lib/theme';
import { usePreferencesStore } from '@/store/preferences';
import { GameHeader } from '@/components/GameHeader';

interface AviatorResponse {
  crash_point: number;
  is_win: boolean;
  payout: number;
}

export default function AviatorGame() {
  const { profile, loadProfile } = useAuthStore();
  const reduceMotion = usePreferencesStore((state) => state.reduceMotion);
  const [betAmount, setBetAmount] = useState('100');
  const [cashoutMult, setCashoutMult] = useState('2.0');
  const [multiplier, setMultiplier] = useState(1.0);
  const [isFlying, setIsFlying] = useState(false);
  const [result, setResult] = useState<{ crash: number; won: boolean; payout: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const multAnim = useRef(new Animated.Value(1)).current;
  const flightAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const listenerId = multAnim.addListener(({ value }) => setMultiplier(value));
    return () => {
      multAnim.removeListener(listenerId);
      multAnim.stopAnimation();
    };
  }, [multAnim]);

  const play = async () => {
    const bet = Number(betAmount);
    const target = Number(cashoutMult);
    if (!Number.isSafeInteger(bet) || bet < 1 || !Number.isFinite(target) || target <= 1 || loading || isFlying) return;
    setLoading(true);
    setResult(null);
    setMultiplier(1.0);
    multAnim.setValue(1);
    flightAnim.setValue(0);

    try {
      const response = await callFunction<AviatorResponse>('game-aviator', {
        bet_amount: bet,
        auto_cashout_multiplier: target,
      }, `game-aviator-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`);
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
      Animated.parallel([
        Animated.timing(multAnim, {
          toValue: targetMult,
          duration: reduceMotion ? 300 : 3000,
          useNativeDriver: false,
          easing: Easing.out(Easing.cubic),
        }),
        Animated.timing(flightAnim, {
          toValue: 1,
          duration: reduceMotion ? 300 : 3000,
          useNativeDriver: true,
          easing: Easing.out(Easing.cubic),
        }),
      ]).start(({ finished }) => {
        if (!finished) return;
        setIsFlying(false);
        setResult({
          crash: response.crash_point,
          won: response.is_win,
          payout: response.payout,
        });
        void loadProfile().catch((error: unknown) => {
          console.warn('[Wattar] Failed to refresh game points after Aviator:', error);
        });
      });
    } catch (err: unknown) {
      setLoading(false);
      setIsFlying(false);
      Alert.alert('خطأ', err instanceof Error ? err.message : 'تعذر إكمال الجولة.');
    }
  };

  const planeX = flightAnim.interpolate({ inputRange: [0, 1], outputRange: [-95, 105] });
  const planeY = flightAnim.interpolate({ inputRange: [0, 1], outputRange: [60, -55] });
  const planeRotation = flightAnim.interpolate({ inputRange: [0, 1], outputRange: ['-12deg', '-34deg'] });

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <StatusBar style="light" />
      <GameHeader
        title="طيارة المضاعفات"
        subtitle="حدد رهانك ومضاعف السحب قبل إقلاع الجولة."
        balance={profile?.game_points ?? 0}
      />

      <View style={styles.gameArea}>
        <View style={styles.flightGrid} pointerEvents="none">
          {[0, 1, 2, 3].map((line) => <View key={`h-${line}`} style={[styles.gridLine, { top: 28 + line * 34 }]} />)}
          {[0, 1, 2, 3, 4].map((line) => <View key={`v-${line}`} style={[styles.gridVertical, { left: 28 + line * 58 }]} />)}
        </View>
        <View style={styles.flightTrack} pointerEvents="none" />
        {(isFlying || result) && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.plane,
              { transform: [{ translateX: planeX }, { translateY: planeY }, { rotate: planeRotation }] },
            ]}
          >
            <Plane size={28} color={result && !result.won ? colors.danger : colors.gold} />
          </Animated.View>
        )}
        <View style={styles.multDisplay}>
          {isFlying || result ? (
            <Text style={[styles.multiplier, result && !result.won && styles.multiplierCrash]}>
              {multiplier.toFixed(2)}x
            </Text>
          ) : (
            <Text style={styles.placeholder}>ضع رهانك وابدأ الرحلة</Text>
          )}
          {result && (
            <Text style={[styles.resultText, result.won ? styles.winText : styles.loseText]}>
              {result.won ? `ربحت ${result.payout} نقطة!` : `انهارت عند ${result.crash}x`}
            </Text>
          )}
        </View>
      </View>

      <View style={styles.controlsCard}>
        <View style={styles.inputRow}>
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>مقدار Point للجولة</Text>
            <TextInput
              style={styles.input}
              value={betAmount}
              onChangeText={setBetAmount}
              keyboardType="numeric"
              placeholder="100"
              placeholderTextColor="#666"
            />
          </View>
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>السحب عند (x)</Text>
            <TextInput
              style={styles.input}
              value={cashoutMult}
              onChangeText={setCashoutMult}
              keyboardType="numeric"
              placeholder="2.0"
              placeholderTextColor="#666"
            />
          </View>
        </View>

        <TouchableOpacity
          style={[styles.playButton, loading && styles.playButtonDisabled]}
          onPress={play}
          disabled={loading || isFlying}
        >
          <Plane size={20} color="#fff" />
          <Text style={styles.playButtonText}>
            {loading ? 'جاري...' : isFlying ? 'تطير...' : 'إقلاع 🚀'}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.infoCard}>
        <Text style={styles.infoHint}>كيف تلعب: حدّد المضاعف المطلوب للسحب، الطيارة تطير وينتهي ذلك عند الانهيار. إذا وصلت لمضاعفك قبل الانهيار → تفوز.</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.roomBackground },
  content: { padding: 16, paddingTop: 58, paddingBottom: 32 },
  title: { color: colors.roomText, fontSize: 24, fontWeight: '800', textAlign: 'center', marginBottom: 16 },
  gameArea: {
    backgroundColor: '#0E1724',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    minHeight: 270,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#25434A',
    overflow: 'hidden',
  },
  flightGrid: { ...StyleSheet.absoluteFill, opacity: 0.62 },
  gridLine: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: '#1C3944' },
  gridVertical: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: '#1C3944' },
  flightTrack: {
    position: 'absolute',
    left: 18,
    bottom: 28,
    width: 245,
    height: 2,
    backgroundColor: '#4BE1C6',
    opacity: 0.5,
    transform: [{ rotate: '-27deg' }],
  },
  plane: { position: 'absolute', left: '50%', bottom: 48, zIndex: 2 },
  multDisplay: { alignItems: 'center', zIndex: 3, minHeight: 80, justifyContent: 'center' },
  multiplier: { color: colors.roomTeal, fontSize: 58, fontWeight: '900', textShadowColor: '#38D9C055', textShadowRadius: 18 },
  multiplierCrash: { color: colors.danger },
  placeholder: { color: colors.roomMuted, fontSize: 16 },
  resultText: { fontSize: 14, marginTop: 8, fontWeight: '600' },
  winText: { color: colors.roomTeal },
  loseText: { color: colors.danger },
  controlsCard: { backgroundColor: colors.roomSurface, borderRadius: 16, padding: 16, marginTop: 16 },
  inputRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  inputGroup: { flex: 1 },
  inputLabel: { color: colors.roomMuted, fontSize: 12, marginBottom: 4 },
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
  },
  playButtonDisabled: { opacity: 0.5 },
  playButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  infoCard: { marginTop: 16, padding: 14, backgroundColor: colors.roomSurface, borderRadius: 12 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  infoText: { color: colors.roomMuted, fontSize: 13 },
  infoHint: { color: colors.roomMuted, fontSize: 12, marginTop: 8, lineHeight: 18 },
});
