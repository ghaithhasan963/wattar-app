/**
 * Wattar App — صفحة عجلة الحظ (Wheel)
 * 6 خانات: x0, x2, x5, x10, x20, x50
 */
import React, { useState, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Animated, Easing, Alert, ScrollView,
} from 'react-native';
import Svg, { Circle, Path, Text as SvgText } from 'react-native-svg';
import { callFunction } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { usePreferencesStore } from '@/store/preferences';
import { StatusBar } from 'expo-status-bar';
import { colors } from '@/lib/theme';
import { GameHeader } from '@/components/GameHeader';
import { GameBetControl, parseValidGameBet } from '@/components/GameBetControl';

const SEGMENTS = [
  { value: 0,  label: 'خسارة', color: '#1F2937' },
  { value: 2,  label: 'x2',   color: '#EF4444' },
  { value: 5,  label: 'x5',   color: '#3B82F6' },
  { value: 10, label: 'x10',  color: '#10B981' },
  { value: 20, label: 'x20',  color: '#A78BFA' },
  { value: 50, label: 'x50',  color: '#F59E0B' },
];

const SEGMENT_ANGLE = 360 / SEGMENTS.length;

interface WheelResponse {
  winning_segment: number;
  is_win: boolean;
  payout: number;
}

export default function WheelGame() {
  const { profile, loadProfile } = useAuthStore();
  const reduceMotion = usePreferencesStore((state) => state.reduceMotion);
  const [betAmount, setBetAmount] = useState('100');
  const [selectedSegment, setSelectedSegment] = useState(1); // x2 default
  const [rotation] = useState(new Animated.Value(0));
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<{ won: boolean; payout: number; segment: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const currentRotation = useRef(0);
  const validBet = parseValidGameBet(betAmount, profile?.balance_gold ?? 0);

  const spin = async () => {
    const bet = parseValidGameBet(betAmount, profile?.balance_gold ?? 0);
    if (bet === null || spinning || loading) return;
    setLoading(true);
    setResult(null);

    try {
      const response = await callFunction<WheelResponse>('game-wheel', {
        bet_amount: bet,
        segment_choice: selectedSegment,
      }, `game-wheel-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`);

      const winningSegment = response.winning_segment;
      if (
        !Number.isInteger(winningSegment)
        || winningSegment < 0
        || winningSegment >= SEGMENTS.length
        || typeof response.is_win !== 'boolean'
        || !Number.isFinite(response.payout)
        || response.payout < 0
      ) {
        throw new Error('لم تصل نتيجة العجلة بشكل صحيح.');
      }

      setLoading(false);
      setSpinning(true);

      const targetAngle = (360 - (winningSegment * SEGMENT_ANGLE + SEGMENT_ANGLE / 2)) % 360;
      const fullSpins = 5; // 5 دورات كاملة
      const currentAngle = ((currentRotation.current % 360) + 360) % 360;
      const angleToTarget = (targetAngle - currentAngle + 360) % 360;
      const newRotation = currentRotation.current + 360 * fullSpins + angleToTarget;

      Animated.timing(rotation, {
        toValue: newRotation,
        duration: reduceMotion ? 300 : 4000,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start(() => {
        currentRotation.current = newRotation;
        setSpinning(false);
        setResult({
          won: response.is_win,
          payout: response.payout,
          segment: winningSegment,
        });
        void loadProfile().catch((error: unknown) => {
          console.warn('[Wattar] Failed to refresh Coin balance after wheel:', error);
        });
      });
    } catch (err: unknown) {
      setLoading(false);
      Alert.alert('خطأ', err instanceof Error ? err.message : 'تعذر إكمال الجولة.');
    }
  };

  const spinDeg = rotation.interpolate({
    inputRange: [0, 360],
    outputRange: ['0deg', '360deg'],
  });
  const wheelCenter = 140;
  const wheelRadius = 136;
  const sectorPath = (index: number) => {
    const start = (index * SEGMENT_ANGLE - 90) * Math.PI / 180;
    const end = ((index + 1) * SEGMENT_ANGLE - 90) * Math.PI / 180;
    const x1 = wheelCenter + wheelRadius * Math.cos(start);
    const y1 = wheelCenter + wheelRadius * Math.sin(start);
    const x2 = wheelCenter + wheelRadius * Math.cos(end);
    const y2 = wheelCenter + wheelRadius * Math.sin(end);
    return `M ${wheelCenter} ${wheelCenter} L ${x1} ${y1} A ${wheelRadius} ${wheelRadius} 0 0 1 ${x2} ${y2} Z`;
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <StatusBar style="light" />
      <GameHeader
        title="عجلة الحظ"
        subtitle="اختر خانتك، ثم شاهد دوران العجلة والنتيجة مباشرة."
        balance={profile?.balance_gold ?? 0}
      />

      <View style={styles.wheelContainer}>
        <View style={styles.pointer} />
        <Animated.View
          style={[
            styles.wheel,
            { transform: [{ rotate: spinDeg }] },
          ]}
        >
          <Svg width={280} height={280} viewBox="0 0 280 280">
            {SEGMENTS.map((segment, index) => {
              const labelAngle = (index * SEGMENT_ANGLE + SEGMENT_ANGLE / 2 - 90) * Math.PI / 180;
              const labelX = wheelCenter + 89 * Math.cos(labelAngle);
              const labelY = wheelCenter + 89 * Math.sin(labelAngle);
              return (
                <React.Fragment key={segment.value}>
                  <Path d={sectorPath(index)} fill={segment.color} stroke="#11172A" strokeWidth={2} />
                  <SvgText
                    x={labelX}
                    y={labelY}
                    fill="#FFFFFF"
                    fontSize={segment.value >= 10 ? 14 : 16}
                    fontWeight="bold"
                    textAnchor="middle"
                    alignmentBaseline="middle"
                  >
                    {segment.label}
                  </SvgText>
                </React.Fragment>
              );
            })}
            <Circle cx={wheelCenter} cy={wheelCenter} r={31} fill="#11172A" stroke="#F59E0B" strokeWidth={4} />
            <SvgText x={wheelCenter} y={wheelCenter + 8} fill="#F59E0B" fontSize={23} fontWeight="bold" textAnchor="middle">
              W
            </SvgText>
          </Svg>
        </Animated.View>
      </View>

      {result && (
        <View style={[styles.resultBanner, result.won ? styles.winBanner : styles.loseBanner]}>
          <Text style={styles.resultText}>
            {result.won
              ? `🎉 ربحت ${result.payout} Coin!`
              : `خسرت — وقفت على ${SEGMENTS[result.segment].label}`}
          </Text>
        </View>
      )}

      <View style={styles.controlsCard}>
        <Text style={styles.label}>اختر خانتك:</Text>
        <View style={styles.segmentsRow}>
          {SEGMENTS.map((seg, i) => (
            <TouchableOpacity
              key={i}
              style={[
                styles.segmentBtn,
                { backgroundColor: seg.color },
                selectedSegment === i && styles.segmentBtnActive,
              ]}
              onPress={() => setSelectedSegment(i)}
              disabled={spinning || loading}
            >
              <Text style={styles.segmentBtnText}>{seg.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <GameBetControl
          value={betAmount}
          balance={profile?.balance_gold ?? 0}
          disabled={spinning || loading}
          onChange={setBetAmount}
        />

        <TouchableOpacity
          style={[styles.spinButton, (spinning || loading || validBet === null) && styles.spinButtonDisabled]}
          onPress={spin}
          disabled={spinning || loading || validBet === null}
        >
          <Text style={styles.spinButtonText}>
            {loading ? 'جاري...' : spinning ? 'يدور...' : '🎡 أدر العجلة'}
          </Text>
        </TouchableOpacity>
      </View>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.roomBackground },
  content: { padding: 16, paddingTop: 58, paddingBottom: 32, alignItems: 'stretch' },
  title: { color: colors.roomText, fontSize: 24, fontWeight: '800', textAlign: 'center' },
  subtitle: { color: colors.roomMuted, fontSize: 12, textAlign: 'center', marginTop: 5 },
  wheelContainer: { alignItems: 'center', marginVertical: 24 },
  pointer: {
    position: 'absolute',
    top: -8,
    width: 0,
    height: 0,
    borderLeftWidth: 12,
    borderRightWidth: 12,
    borderTopWidth: 20,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: colors.gold,
    zIndex: 2,
  },
  wheel: {
    width: 280,
    height: 280,
    borderRadius: 140,
    borderWidth: 4,
    borderColor: colors.gold,
    overflow: 'hidden',
  },
  resultBanner: {
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  winBanner: { backgroundColor: '#159C9C20', borderWidth: 1, borderColor: colors.roomTeal },
  loseBanner: { backgroundColor: '#C94D6020', borderWidth: 1, borderColor: colors.danger },
  resultText: { color: colors.roomText, fontSize: 16, fontWeight: 'bold' },
  controlsCard: { backgroundColor: colors.roomSurface, borderRadius: 16, padding: 16 },
  label: { color: colors.roomMuted, fontSize: 13, marginBottom: 8, marginTop: 12 },
  segmentsRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  segmentBtn: {
    flexBasis: '30%',
    flexGrow: 1,
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  segmentBtnActive: {
    borderColor: colors.roomText,
    shadowColor: colors.gold,
    shadowOpacity: 0.45,
    shadowRadius: 8,
    elevation: 3,
  },
  segmentBtnText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  input: {
    backgroundColor: colors.roomElevated,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.roomText,
    fontSize: 16,
  },
  spinButton: {
    backgroundColor: colors.gold,
    height: 50,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  spinButtonDisabled: { opacity: 0.5 },
  spinButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  balance: { color: colors.roomMuted, fontSize: 13, textAlign: 'center', marginTop: 16 },
});
