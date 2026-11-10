/**
 * Wattar App — صفحة بلانغو (Plinko)
 * الكرة تسقط عبر صف من الأوتاد، تنتهي في خانة مع مضاعف
 */
import React, { useState, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, Animated, Easing, ScrollView,
} from 'react-native';
import { callFunction } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { usePreferencesStore } from '@/store/preferences';
import { StatusBar } from 'expo-status-bar';
import { colors } from '@/lib/theme';

const ROWS = 12;
const SLOTS = 11;

const MULTIPLIERS: Record<string, number[]> = {
  low:    [5, 3, 2, 1.5, 1, 0.5, 1, 1.5, 2, 3, 5],
  medium: [10, 5, 3, 1.5, 1, 0.3, 1, 1.5, 3, 5, 10],
  high:   [100, 20, 5, 1.5, 0.5, 0.2, 0.5, 1.5, 5, 20, 100],
};

const SLOT_COLORS: Record<string, string> = {
  high: '#EF4444',
  mid: colors.gold,
  low: colors.roomTeal,
  zero: '#6B7280',
};

interface PlinkoResponse {
  final_slot: number;
  path?: Array<'L' | 'R'>;
  multiplier: number;
  payout: number;
  is_win: boolean;
}

function getColor(mult: number): string {
  if (mult >= 10) return SLOT_COLORS.high;
  if (mult >= 1) return SLOT_COLORS.mid;
  if (mult < 1) return SLOT_COLORS.zero;
  return SLOT_COLORS.low;
}

function makeDisplayPath(finalSlot: number): Array<'L' | 'R'> {
  const path: Array<'L' | 'R'> = Array(ROWS).fill('L');
  const rightSteps = Math.min(finalSlot, ROWS);
  const positions = Array.from({ length: ROWS }, (_, index) => index);
  for (let index = positions.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [positions[index], positions[swapIndex]] = [positions[swapIndex], positions[index]];
  }
  positions.slice(0, rightSteps).forEach((position) => {
    path[position] = 'R';
  });
  return path;
}

export default function PlinkoGame() {
  const { profile, loadProfile } = useAuthStore();
  const reduceMotion = usePreferencesStore((state) => state.reduceMotion);
  const [betAmount, setBetAmount] = useState('100');
  const [risk, setRisk] = useState<'low' | 'medium' | 'high'>('medium');
  const [dropping, setDropping] = useState(false);
  const [result, setResult] = useState<{ slot: number; mult: number; payout: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [boardWidth, setBoardWidth] = useState(0);
  const ballPos = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;

  const play = async () => {
    const bet = Number(betAmount);
    if (!Number.isSafeInteger(bet) || bet < 1 || loading || dropping) return;
    setLoading(true);
    setResult(null);
    setDropping(false);
    ballPos.setValue({ x: 0, y: 0 });

    try {
      const response = await callFunction<PlinkoResponse>('game-plinko', {
        bet_amount: bet,
        risk_level: risk,
      }, `game-plinko-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`);

      const path = response.path ?? makeDisplayPath(response.final_slot);
      if (
        !Number.isInteger(response.final_slot)
        || response.final_slot < 0
        || response.final_slot >= multipliers.length
        || !Array.isArray(path)
        || path.length !== ROWS
        || path.some((step) => step !== 'L' && step !== 'R')
        || !Number.isFinite(response.multiplier)
        || response.multiplier < 0
        || !Number.isFinite(response.payout)
        || response.payout < 0
        || typeof response.is_win !== 'boolean'
      ) {
        throw new Error('لم تصل نتيجة بلانغو بشكل صحيح.');
      }

      setLoading(false);
      setDropping(true);
      const horizontalStep = Math.max(boardWidth, 240) / (ROWS + 1) / 2;
      let horizontalOffset = 0;
      const animations = path.map((step, index) => {
        horizontalOffset += step === 'R' ? horizontalStep : -horizontalStep;
        if (index === path.length - 1) {
          horizontalOffset = (response.final_slot - (SLOTS - 1) / 2) * (Math.max(boardWidth, 240) / SLOTS);
        }
        return Animated.parallel([
          Animated.timing(ballPos.x, {
            toValue: horizontalOffset,
            duration: reduceMotion ? 55 : 160,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: false,
          }),
          Animated.timing(ballPos.y, {
            toValue: (index + 1) / path.length,
            duration: reduceMotion ? 55 : 160,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: false,
          }),
        ]);
      });
      await new Promise<void>((resolve) => {
        Animated.sequence(animations).start(() => resolve());
      });
      setDropping(false);
      setResult({
        slot: response.final_slot,
        mult: response.multiplier,
        payout: response.payout,
      });
      void loadProfile().catch((error: unknown) => {
        console.warn('[Wattar] Failed to refresh game points after Plinko:', error);
      });
    } catch (err: unknown) {
      setDropping(false);
      Alert.alert('خطأ', err instanceof Error ? err.message : 'تعذر إكمال الجولة.');
    } finally {
      setLoading(false);
    }
  };

  const multipliers = MULTIPLIERS[risk];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <StatusBar style="light" />
      <Text style={styles.title}>بلانغو</Text>

      <View style={styles.boardContainer}>
        {/* صفوف الأوتاد */}
        <View
          style={styles.pegsBoard}
          onLayout={(event) => setBoardWidth(event.nativeEvent.layout.width)}
        >
          {Array.from({ length: ROWS }).map((_, row) => (
            <View
              key={row}
              style={[
                styles.pegRow,
                {
                  top: row * 18,
                  gap: Math.max(4, Math.min(20, (boardWidth || 280) / (row + 4))),
                },
              ]}
            >
              {Array.from({ length: row + 2 }).map((_, i) => (
                <View key={i} style={styles.peg} />
              ))}
            </View>
          ))}
        </View>

        {/* الكرة */}
        {dropping && (
          <Animated.View
            style={[
              styles.ball,
              {
                left: 16 + (Math.max(boardWidth, 240) - 16) / 2,
                top: 16,
                transform: [
                { translateX: ballPos.x },
                { translateY: ballPos.y.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, 240],
                  }) },
                ],
              },
            ]}
          />
        )}

        {/* الخانات السفلية */}
        <View style={styles.slotsRow}>
          {multipliers.map((mult, i) => (
            <View
              key={i}
              style={[
                styles.slot,
                {
                  backgroundColor: getColor(mult) + '30',
                  borderColor: getColor(mult),
                  borderWidth: result?.slot === i ? 3 : 1,
                },
              ]}
            >
              <Text style={[styles.slotText, { color: getColor(mult) }]}>
                {mult >= 1 ? `${mult}x` : `${mult}`}
              </Text>
            </View>
          ))}
        </View>
      </View>

      {result && (
        <View style={[styles.resultBanner, result.payout > 0 ? styles.winBanner : styles.loseBanner]}>
          <Text style={styles.resultText}>
            {result.payout > 0
              ? `🎉 وقعت في ${result.mult}x — ربحت ${result.payout} نقطة`
              : `وقع في خانة ${result.mult}x — خسرت`}
          </Text>
        </View>
      )}

      <View style={styles.controlsCard}>
        <Text style={styles.label}>مستوى المخاطرة</Text>
        <View style={styles.riskRow}>
          {(['low', 'medium', 'high'] as const).map(r => (
            <TouchableOpacity
              key={r}
              style={[styles.riskBtn, risk === r && styles.riskBtnActive]}
              onPress={() => setRisk(r)}
              disabled={dropping || loading}
            >
              <Text style={[styles.riskText, risk === r && styles.riskTextActive]}>
                {r === 'low' ? 'منخفض' : r === 'medium' ? 'متوسط' : 'عالي'}
              </Text>
            </TouchableOpacity>
          ))}
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
          style={[styles.playButton, (dropping || loading) && styles.playButtonDisabled]}
          onPress={play}
          disabled={dropping || loading}
        >
          <Text style={styles.playButtonText}>
            {dropping ? 'تسقط...' : loading ? 'جاري...' : '🔻 أسقط الكرة'}
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
  boardContainer: {
    backgroundColor: '#120D1C',
    borderRadius: 24,
    padding: 16,
    alignItems: 'center',
    marginVertical: 16,
    minHeight: 320,
    position: 'relative',
    borderWidth: 1,
    borderColor: '#382A4B',
    overflow: 'hidden',
  },
  pegsBoard: {
    position: 'relative',
    width: '100%',
    alignItems: 'center',
    height: 240,
  },
  pegRow: {
    position: 'absolute',
    flexDirection: 'row',
    width: '100%',
    justifyContent: 'center',
  },
  peg: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#AE7BDF',
    shadowColor: '#B550FF',
    shadowOpacity: 0.65,
    shadowRadius: 5,
    elevation: 3,
  },
  ball: {
    position: 'absolute',
    top: 0,
    width: 15,
    height: 15,
    borderRadius: 8,
    backgroundColor: '#FFE7A3',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    shadowColor: colors.gold,
    shadowOpacity: 0.9,
    shadowRadius: 9,
    elevation: 7,
  },
  slotsRow: {
    flexDirection: 'row',
    gap: 2,
    marginTop: 8,
    width: '100%',
  },
  slot: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
  },
  slotText: { fontSize: 10, fontWeight: 'bold' },
  resultBanner: { padding: 12, borderRadius: 10, alignItems: 'center', marginBottom: 12 },
  winBanner: { backgroundColor: '#50D3C520', borderWidth: 1, borderColor: colors.roomTeal },
  loseBanner: { backgroundColor: '#EF444420', borderWidth: 1, borderColor: '#EF4444' },
  resultText: { color: colors.roomText, fontSize: 14, fontWeight: 'bold' },
  controlsCard: { backgroundColor: colors.roomSurface, borderRadius: 16, padding: 16 },
  label: { color: colors.roomMuted, fontSize: 13, marginBottom: 8, marginTop: 12 },
  riskRow: { flexDirection: 'row', gap: 8 },
  riskBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: colors.roomElevated,
    alignItems: 'center',
  },
  riskBtnActive: { backgroundColor: colors.roomPrimary },
  riskText: { color: colors.roomMuted, fontSize: 13, fontWeight: '600' },
  riskTextActive: { color: colors.roomText },
  input: {
    backgroundColor: colors.roomElevated,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.roomText,
    fontSize: 16,
  },
  playButton: {
    backgroundColor: colors.gold,
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
