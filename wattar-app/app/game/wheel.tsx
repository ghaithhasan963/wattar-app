/**
 * Wattar App — عجلة الحظ (M9.4)
 * الخانات والاحتمالات والعائد تأتي من الخادم؛ المستخدم يختار خانته فقط،
 * والخادم يختار الخانة الفائزة وفق الأوزان المعلنة.
 */
import React, { useMemo, useRef, useState } from 'react';
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
import { GameHistoryCard, GameOddsCard, GameTestModeRow } from '@/components/GamePanels';
import { usePublicGames } from '@/hooks/usePublicGames';
import {
  formatPercent, GameSegment, newIdempotencyKey, toWheelSegments,
} from '@/lib/gameConfig';

interface WheelResponse {
  winning_segment: number;
  is_win: boolean;
  payout: number;
  multiplier: number;
  test_mode: boolean;
  promo_reward: boolean;
}

const WHEEL_SIZE = 292;
const WHEEL_CENTER = WHEEL_SIZE / 2;
const WHEEL_RADIUS = WHEEL_SIZE / 2 - 6;

export default function WheelGame() {
  const { profile, loadProfile } = useAuthStore();
  const reduceMotion = usePreferencesStore((state) => state.reduceMotion);
  const { find } = usePublicGames();
  const game = find('wheel');
  const segments = useMemo<GameSegment[]>(
    () => toWheelSegments(game?.settings ?? {}),
    [game],
  );
  const [betAmount, setBetAmount] = useState('100');
  const [selectedSegment, setSelectedSegment] = useState(1);
  const [rotation] = useState(new Animated.Value(0));
  const [spinning, setSpinning] = useState(false);
  const [testMode, setTestMode] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);
  const [result, setResult] = useState<{ won: boolean; payout: number; segment: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const currentRotation = useRef(0);
  const validBet = parseValidGameBet(betAmount, profile?.balance_gold ?? 0);
  const selectedIndex = Math.min(selectedSegment, segments.length - 1);
  const segmentAngle = 360 / segments.length;

  const spin = async () => {
    const bet = parseValidGameBet(betAmount, profile?.balance_gold ?? 0);
    if (bet === null || spinning || loading) return;
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

    try {
      const response = await callFunction<WheelResponse>('game-wheel', {
        bet_amount: bet,
        segment_choice: selectedIndex,
        test_mode: testMode,
      }, newIdempotencyKey('game-wheel'));

      const winningSegment = response.winning_segment;
      if (
        !Number.isInteger(winningSegment)
        || winningSegment < 0
        || winningSegment >= segments.length
        || typeof response.is_win !== 'boolean'
        || !Number.isFinite(response.payout)
        || response.payout < 0
      ) {
        throw new Error('لم تصل نتيجة العجلة بشكل صحيح.');
      }

      setLoading(false);
      setSpinning(true);

      const targetAngle = (360 - (winningSegment * segmentAngle + segmentAngle / 2)) % 360;
      const currentAngle = ((currentRotation.current % 360) + 360) % 360;
      const angleToTarget = (targetAngle - currentAngle + 360) % 360;
      const newRotation = currentRotation.current + 360 * 6 + angleToTarget;

      Animated.timing(rotation, {
        toValue: newRotation,
        duration: reduceMotion ? 320 : 4200,
        easing: Easing.bezier(0.12, 0.72, 0.06, 1),
        useNativeDriver: true,
      }).start(() => {
        currentRotation.current = newRotation;
        setSpinning(false);
        setResult({
          won: response.is_win,
          payout: response.payout,
          segment: winningSegment,
        });
        setHistoryKey((key) => key + 1);
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

  const sectorPath = (index: number) => {
    const start = (index * segmentAngle - 90) * Math.PI / 180;
    const end = ((index + 1) * segmentAngle - 90) * Math.PI / 180;
    const x1 = WHEEL_CENTER + WHEEL_RADIUS * Math.cos(start);
    const y1 = WHEEL_CENTER + WHEEL_RADIUS * Math.sin(start);
    const x2 = WHEEL_CENTER + WHEEL_RADIUS * Math.cos(end);
    const y2 = WHEEL_CENTER + WHEEL_RADIUS * Math.sin(end);
    return `M ${WHEEL_CENTER} ${WHEEL_CENTER} L ${x1} ${y1} A ${WHEEL_RADIUS} ${WHEEL_RADIUS} 0 0 1 ${x2} ${y2} Z`;
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <StatusBar style="light" />
      <GameHeader
        title={game?.display_name ?? 'عجلة الحظ'}
        subtitle={game?.description ?? 'اختر خانتك، ثم أدر العجلة. كل خانة لها احتمال وعائد معلن.'}
        balance={profile?.balance_gold ?? 0}
      />

      <GameTestModeRow
        enabled={game?.test_mode_enabled === true}
        value={testMode}
        onChange={setTestMode}
      />

      <View style={styles.wheelContainer}>
        <View style={styles.pointer} />
        <Animated.View style={[styles.wheel, { transform: [{ rotate: spinDeg }] }]}>
          <Svg width={WHEEL_SIZE} height={WHEEL_SIZE} viewBox={`0 0 ${WHEEL_SIZE} ${WHEEL_SIZE}`}>
            {segments.map((segment, index) => {
              const labelAngle = (index * segmentAngle + segmentAngle / 2 - 90) * Math.PI / 180;
              const labelX = WHEEL_CENTER + (WHEEL_RADIUS - 46) * Math.cos(labelAngle);
              const labelY = WHEEL_CENTER + (WHEEL_RADIUS - 46) * Math.sin(labelAngle);
              return (
                <React.Fragment key={`${segment.label}-${index}`}>
                  <Path d={sectorPath(index)} fill={segment.color} stroke="#11172A" strokeWidth={2} />
                  <SvgText
                    x={labelX}
                    y={labelY}
                    fill="#FFFFFF"
                    fontSize={segments.length > 6 ? 11 : 14}
                    fontWeight="bold"
                    textAnchor="middle"
                    alignmentBaseline="middle"
                  >
                    {segment.label}
                  </SvgText>
                </React.Fragment>
              );
            })}
            <Circle cx={WHEEL_CENTER} cy={WHEEL_CENTER} r={32} fill="#11172A" stroke={colors.gold} strokeWidth={4} />
            <SvgText x={WHEEL_CENTER} y={WHEEL_CENTER + 8} fill={colors.gold} fontSize={22} fontWeight="bold" textAnchor="middle">
              W
            </SvgText>
          </Svg>
        </Animated.View>
      </View>

      {result && (
        <View style={[styles.resultBanner, result.won ? styles.winBanner : styles.loseBanner]}>
          <Text style={styles.resultText}>
            {result.won
              ? `🎉 ربحت ${result.payout.toLocaleString()} Coin!`
              : `خسرت — وقفت على ${segments[result.segment]?.label ?? ''}`}
          </Text>
        </View>
      )}

      <View style={styles.controlsCard}>
        <View style={styles.segmentHeading}>
          <Text style={styles.label}>اختر خانتك</Text>
          <Text style={styles.labelHint}>
            RTP المعلن {formatPercent(game?.declared_rtp ?? 0)}
          </Text>
        </View>
        <View style={styles.segmentsRow}>
          {segments.map((segment, index) => (
            <TouchableOpacity
              key={`${segment.label}-${index}`}
              style={[
                styles.segmentBtn,
                { backgroundColor: segment.color },
                selectedIndex === index && styles.segmentBtnActive,
              ]}
              onPress={() => setSelectedSegment(index)}
              disabled={spinning || loading}
              accessibilityRole="button"
              accessibilityState={{ selected: selectedIndex === index }}
            >
              <Text style={styles.segmentBtnText}>{segment.label}</Text>
              <Text style={styles.segmentProb}>{formatPercent(segment.probability * 100)}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <GameBetControl
          value={betAmount}
          balance={profile?.balance_gold ?? 0}
          disabled={spinning || loading}
          onChange={setBetAmount}
        />
        {game ? (
          <Text style={styles.limitHint}>
            الحد: {game.min_bet.toLocaleString()} – {game.max_bet.toLocaleString()} Coin
          </Text>
        ) : null}

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

      <GameOddsCard game={game} />
      <GameHistoryCard gameType="wheel" refreshKey={historyKey} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.roomBackground },
  content: { padding: 16, paddingTop: 58, paddingBottom: 32 },
  wheelContainer: { alignItems: 'center', marginVertical: 22 },
  pointer: {
    position: 'absolute',
    top: -10,
    width: 0,
    height: 0,
    borderLeftWidth: 13,
    borderRightWidth: 13,
    borderTopWidth: 22,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: colors.gold,
    zIndex: 2,
  },
  wheel: {
    width: WHEEL_SIZE,
    height: WHEEL_SIZE,
    borderRadius: WHEEL_SIZE / 2,
    borderWidth: 4,
    borderColor: colors.gold,
    overflow: 'hidden',
    backgroundColor: colors.background,
  },
  resultBanner: { padding: 14, borderRadius: 12, alignItems: 'center', marginBottom: 12 },
  winBanner: { backgroundColor: '#159C9C20', borderWidth: 1, borderColor: colors.roomTeal },
  loseBanner: { backgroundColor: '#C94D6020', borderWidth: 1, borderColor: colors.danger },
  resultText: { color: colors.roomText, fontSize: 15, fontWeight: 'bold' },
  controlsCard: { backgroundColor: colors.roomSurface, borderRadius: 16, padding: 16 },
  segmentHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  label: { color: colors.roomMuted, fontSize: 13 },
  labelHint: { color: colors.teal, fontSize: 11, fontWeight: '800' },
  segmentsRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  segmentBtn: {
    flexBasis: '30%',
    flexGrow: 1,
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  segmentBtnActive: {
    borderColor: colors.roomText,
    shadowColor: colors.gold,
    shadowOpacity: 0.45,
    shadowRadius: 8,
    elevation: 3,
  },
  segmentBtnText: { color: '#fff', fontSize: 12, fontWeight: '900' },
  segmentProb: { color: '#ffffffB0', fontSize: 9, marginTop: 3, fontWeight: '700' },
  limitHint: { color: colors.roomMuted, fontSize: 10, textAlign: 'right', marginTop: 8 },
  spinButton: {
    backgroundColor: colors.gold,
    height: 50,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },
  spinButtonDisabled: { opacity: 0.5 },
  spinButtonText: { color: colors.background, fontSize: 16, fontWeight: '900' },
});
