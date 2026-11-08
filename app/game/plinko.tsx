/**
 * Wattar App — صفحة بلانغو (Plinko)
 * الكرة تسقط عبر صف من الأوتاد، تنتهي في خانة مع مضاعف
 */
import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, Animated, Easing, ScrollView,
} from 'react-native';
import { callFunction } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
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

function getColor(mult: number): string {
  if (mult >= 10) return SLOT_COLORS.high;
  if (mult >= 1) return SLOT_COLORS.mid;
  if (mult < 1) return SLOT_COLORS.zero;
  return SLOT_COLORS.low;
}

export default function PlinkoGame() {
  const { profile, loadProfile } = useAuthStore();
  const [betAmount, setBetAmount] = useState('100');
  const [risk, setRisk] = useState<'low' | 'medium' | 'high'>('medium');
  const [dropping, setDropping] = useState(false);
  const [result, setResult] = useState<{ slot: number; mult: number; payout: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [ballPos] = useState(new Animated.ValueXY({ x: 0, y: 0 }));

  const play = async () => {
    if (!betAmount) return;
    setLoading(true);
    setResult(null);
    setDropping(true);
    ballPos.setValue({ x: 0, y: 0 });

    try {
      const response = await callFunction<any>('game-plinko', {
        bet_amount: Number(betAmount),
        risk_level: risk,
      });

      // محاكاة سقوط الكرة
      Animated.sequence([
        Animated.timing(ballPos.y, {
          toValue: 1,
          duration: 2000,
          easing: Easing.bounce,
          useNativeDriver: false,
        }),
      ]).start(() => {
        setDropping(false);
        setLoading(false);
        setResult({
          slot: response.final_slot,
          mult: response.multiplier,
          payout: response.payout,
        });
        loadProfile();
      });
    } catch (err: any) {
      setDropping(false);
      setLoading(false);
      Alert.alert('خطأ', err.message);
    }
  };

  const multipliers = MULTIPLIERS[risk];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <StatusBar style="light" />
      <Text style={styles.title}>بلانغو</Text>

      <View style={styles.boardContainer}>
        {/* صفوف الأوتاد */}
        <View style={styles.pegsBoard}>
          {Array.from({ length: ROWS }).map((_, row) => (
            <View key={row} style={[styles.pegRow, { marginTop: row * 18 }]}>
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
                transform: [
                  { translateX: ballPos.x.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-10, 10],
                  }) },
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
              ? `🎉 وقعت في ${result.mult}x — ربحت ${result.payout} ذهب`
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
            >
              <Text style={[styles.riskText, risk === r && styles.riskTextActive]}>
                {r === 'low' ? 'منخفض' : r === 'medium' ? 'متوسط' : 'عالي'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>الرهان (ذهب)</Text>
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

      <Text style={styles.balance}>رصيدك: {profile?.balance_gold?.toLocaleString()} ذهب</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.roomBackground },
  content: { padding: 16, paddingTop: 58, paddingBottom: 32 },
  title: { color: colors.roomText, fontSize: 24, fontWeight: '800', textAlign: 'center', marginBottom: 16 },
  boardContainer: {
    backgroundColor: colors.roomSurface,
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    marginVertical: 16,
    minHeight: 320,
    position: 'relative',
  },
  pegsBoard: {
    position: 'relative',
    width: '100%',
    alignItems: 'center',
    height: 240,
  },
  pegRow: {
    flexDirection: 'row',
    gap: 24,
    justifyContent: 'center',
  },
  peg: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.roomPrimary,
  },
  ball: {
    position: 'absolute',
    top: 0,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.gold,
    borderWidth: 1,
    borderColor: '#fff',
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
