/**
 * Wattar App — صفحة لعبة Aviator
 * نموذج أولي — يلعب عبر Edge Function
 */
import React, { useState, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Animated, Easing, Alert, ScrollView,
} from 'react-native';
import { callFunction } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { Plane, TrendingUp } from 'lucide-react-native';
import { StatusBar } from 'expo-status-bar';
import { colors } from '@/lib/theme';

export default function AviatorGame() {
  const { profile, loadProfile } = useAuthStore();
  const [betAmount, setBetAmount] = useState('100');
  const [cashoutMult, setCashoutMult] = useState('2.0');
  const [multiplier, setMultiplier] = useState(1.0);
  const [isFlying, setIsFlying] = useState(false);
  const [result, setResult] = useState<{ crash: number; won: boolean; payout: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const multAnim = useRef(new Animated.Value(0)).current;

  const play = async () => {
    if (!betAmount || !cashoutMult) return;
    setLoading(true);
    setResult(null);
    setMultiplier(1.0);

    try {
      const response = await callFunction<any>('game-aviator', {
        bet_amount: Number(betAmount),
        auto_cashout_multiplier: Number(cashoutMult),
      });
      setLoading(false);

      // محاكاة الرحلة بصريًا
      setIsFlying(true);
      const targetMult = response.is_win ? Number(cashoutMult) : response.crash_point;

      // أنيميشن المضاعف
      Animated.timing(multAnim, {
        toValue: targetMult,
        duration: 3000,
        useNativeDriver: false,
        easing: Easing.exp,
      }).start();

      // تحديث المضاعف كل 100ms
      const interval = setInterval(() => {
        setMultiplier(prev => {
          const next = prev + (targetMult - prev) * 0.1;
          if (Math.abs(next - targetMult) < 0.01) {
            clearInterval(interval);
            setIsFlying(false);
            setResult({
              crash: response.crash_point,
              won: response.is_win,
              payout: response.payout,
            });
            loadProfile();
            return targetMult;
          }
          return next;
        });
      }, 50);
    } catch (err: any) {
      setLoading(false);
      Alert.alert('خطأ', err.message);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <StatusBar style="light" />
      <Text style={styles.title}>طيارة المضاعفات</Text>

      <View style={styles.gameArea}>
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
              {result.won ? `ربحت ${result.payout} ذهب!` : `انهارت عند ${result.crash}x`}
            </Text>
          )}
        </View>
      </View>

      <View style={styles.controlsCard}>
        <View style={styles.inputRow}>
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>الرهان (ذهب)</Text>
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
        <View style={styles.infoRow}>
          <TrendingUp size={14} color="#9CA3AF" />
          <Text style={styles.infoText}>رصيدك: {profile?.balance_gold?.toLocaleString()} ذهب</Text>
        </View>
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
    backgroundColor: colors.roomSurface,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    minHeight: 200,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.roomElevated,
  },
  multDisplay: { alignItems: 'center' },
  multiplier: { color: colors.roomTeal, fontSize: 56, fontWeight: 'bold' },
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
