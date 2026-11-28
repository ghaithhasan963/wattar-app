/**
 * Wattar App — بلانغو (M9.4)
 * 12 صفاً ← 13 خانة، والمسار والخانة النهائية يأتيان من الخادم (توزيع ثنائي
 * دقيق C(12,k)/2^12). جدول المضاعفات لكل مستوى مخاطرة من إعدادات الخادم،
 * والرسوم تتبع المسار الذي أعاده الخادم فقط.
 */
import React, { useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Alert, Animated, Easing, ScrollView,
} from 'react-native';
import { callFunction } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { usePreferencesStore } from '@/store/preferences';
import { StatusBar } from 'expo-status-bar';
import { colors, fonts } from '@/lib/theme';
import { GameHeader } from '@/components/GameHeader';
import { GameBetControl, parseValidGameBet } from '@/components/GameBetControl';
import { GameHistoryCard, GameOddsCard, GameTestModeRow } from '@/components/GamePanels';
import { usePublicGames } from '@/hooks/usePublicGames';
import { formatPercent, newIdempotencyKey, toPlinkoTable } from '@/lib/gameConfig';

type RiskLevel = 'low' | 'medium' | 'high';

interface PlinkoResponse {
  final_slot: number;
  path: Array<'L' | 'R'>;
  path_length: number;
  multiplier: number;
  payout: number;
  is_win: boolean;
  test_mode: boolean;
  promo_reward: boolean;
}

const RISK_LABELS: Record<RiskLevel, string> = {
  low: 'منخفض',
  medium: 'متوسط',
  high: 'عالي',
};

const SLOT_COLORS = {
  high: colors.danger,
  mid: colors.gold,
  low: colors.roomTeal,
  zero: colors.textMuted,
};

function getColor(mult: number): string {
  if (mult >= 5) return SLOT_COLORS.high;
  if (mult >= 1) return SLOT_COLORS.mid;
  if (mult > 0) return SLOT_COLORS.zero;
  return SLOT_COLORS.low;
}

function formatSlot(mult: number): string {
  if (!Number.isFinite(mult)) return '—';
  if (mult >= 10) return String(Math.round(mult));
  if (mult >= 1) return String(Math.round(mult * 10) / 10);
  return String(Math.round(mult * 100) / 100);
}

export default function PlinkoGame() {
  const { profile, loadProfile } = useAuthStore();
  const reduceMotion = usePreferencesStore((state) => state.reduceMotion);
  const { find } = usePublicGames();
  const game = find('plinko');
  const [betAmount, setBetAmount] = useState('100');
  const [risk, setRisk] = useState<RiskLevel>('medium');
  const [dropping, setDropping] = useState(false);
  const [testMode, setTestMode] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);
  const [result, setResult] = useState<{ slot: number; mult: number; payout: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [boardWidth, setBoardWidth] = useState(0);
  const ballX = useRef(new Animated.Value(0)).current;
  const ballY = useRef(new Animated.Value(0)).current;
  const validBet = parseValidGameBet(betAmount, profile?.balance_gold ?? 0);

  const table = useMemo(
    () => toPlinkoTable(game?.settings ?? {}, risk),
    [game, risk],
  );
  const multipliers = table.multipliers;
  const rows = table.rows;
  const slotCount = multipliers.length;
  const width = Math.max(boardWidth, 260);
  const slotWidth = width / Math.max(1, slotCount);

  const play = async () => {
    const bet = parseValidGameBet(betAmount, profile?.balance_gold ?? 0);
    if (bet === null || loading || dropping) return;
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
    ballX.setValue(0);
    ballY.setValue(0);

    try {
      const response = await callFunction<PlinkoResponse>('game-plinko', {
        bet_amount: bet,
        risk_level: risk,
        test_mode: testMode,
      }, newIdempotencyKey('game-plinko'));

      const path = response.path;
      if (
        !Number.isInteger(response.final_slot)
        || response.final_slot < 0
        || response.final_slot >= multipliers.length
        || !Array.isArray(path)
        || path.length !== rows
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

      const stepX = slotWidth / 2;
      const stepDuration = reduceMotion ? 45 : 135;
      let offset = 0;
      const horizontalSteps = path.map((step) => {
        offset += step === 'R' ? stepX : -stepX;
        return Animated.timing(ballX, {
          toValue: offset,
          duration: stepDuration,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        });
      });

      await new Promise<void>((resolve) => {
        Animated.parallel([
          Animated.sequence(horizontalSteps),
          Animated.timing(ballY, {
            toValue: 1,
            duration: stepDuration * path.length,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
        ]).start(() => resolve());
      });
      setDropping(false);
      setResult({
        slot: response.final_slot,
        mult: response.multiplier,
        payout: response.payout,
      });
      setHistoryKey((key) => key + 1);
      void loadProfile().catch((error: unknown) => {
        console.warn('[Wattar] Failed to refresh Coin balance after Plinko:', error);
      });
    } catch (err: unknown) {
      ballX.setValue(0);
      ballY.setValue(0);
      Alert.alert('خطأ', err instanceof Error ? err.message : 'تعذر إكمال الجولة.');
    } finally {
      setDropping(false);
      setLoading(false);
    }
  };

  const ballTranslateY = ballY.interpolate({
    inputRange: [0, 1],
    outputRange: [0, Math.max(120, rows * 19)],
  });

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <StatusBar style="light" />
      <GameHeader
        title={game?.display_name ?? 'بلانغو'}
        subtitle={game?.description ?? 'اختر مستوى المخاطرة وأسقط الكرة. الخانة تُختار على الخادم بتوزيع ثنائي معلن.'}
        balance={profile?.balance_gold ?? 0}
      />

      <GameTestModeRow
        enabled={game?.test_mode_enabled === true}
        value={testMode}
        onChange={setTestMode}
      />

      <View style={styles.boardContainer}>
        <View
          style={styles.pegsBoard}
          onLayout={(event) => setBoardWidth(event.nativeEvent.layout.width)}
        >
          {Array.from({ length: rows }).map((_, row) => {
            const gap = width / (row + 3);
            return (
              <View
                key={row}
                style={[
                  styles.pegRow,
                  { top: 10 + row * 19, gap: Math.max(5, Math.min(22, gap)) },
                ]}
              >
                {Array.from({ length: row + 2 }).map((__, index) => (
                  <View key={index} style={styles.peg} />
                ))}
              </View>
            );
          })}

          {dropping && (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.ball,
                {
                  left: width / 2 - 7,
                  transform: [{ translateX: ballX }, { translateY: ballTranslateY }],
                },
              ]}
            />
          )}
        </View>

        <View style={styles.slotsRow}>
          {multipliers.map((mult, index) => {
            const color = getColor(mult);
            const isHit = result?.slot === index;
            return (
              <View
                key={`${index}-${mult}`}
                style={[
                  styles.slot,
                  {
                    backgroundColor: `${color}30`,
                    borderColor: color,
                    borderWidth: isHit ? 2 : 1,
                  },
                ]}
              >
                <Text style={[styles.slotText, { color }]} numberOfLines={1}>
                  {formatSlot(mult)}
                </Text>
              </View>
            );
          })}
        </View>
      </View>

      {result && (
        <View style={[styles.resultBanner, result.payout > 0 ? styles.winBanner : styles.loseBanner]}>
          <Text style={styles.resultText}>
            {result.payout > 0
              ? `🎉 وقعت في ${formatSlot(result.mult)}x — ربحت ${result.payout.toLocaleString()} Coin`
              : `وقعت في ${formatSlot(result.mult)}x — خسرت`}
          </Text>
        </View>
      )}

      <View style={styles.controlsCard}>
        <Text style={styles.label}>مستوى المخاطرة</Text>
        <View style={styles.riskRow}>
          {(['low', 'medium', 'high'] as const).map((level) => (
            <TouchableOpacity
              key={level}
              style={[styles.riskBtn, risk === level && styles.riskBtnActive]}
              onPress={() => setRisk(level)}
              disabled={dropping || loading}
              accessibilityRole="button"
              accessibilityState={{ selected: risk === level, disabled: dropping || loading }}
            >
              <Text style={[styles.riskText, risk === level && styles.riskTextActive]}>
                {RISK_LABELS[level]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.riskHint}>
          RTP المعلن {formatPercent(game?.declared_rtp ?? 0)} — {slotCount} خانة بتوزيع ثنائي دقيق.
        </Text>

        <GameBetControl
          value={betAmount}
          balance={profile?.balance_gold ?? 0}
          disabled={dropping || loading}
          onChange={setBetAmount}
        />
        {game ? (
          <Text style={styles.limitHint}>
            الحد: {game.min_bet.toLocaleString()} – {game.max_bet.toLocaleString()} Coin
          </Text>
        ) : null}

        <TouchableOpacity
          style={[styles.playButton, (dropping || loading || validBet === null) && styles.playButtonDisabled]}
          onPress={play}
          disabled={dropping || loading || validBet === null}
        >
          <Text style={styles.playButtonText}>
            {dropping ? 'تسقط...' : loading ? 'جاري...' : '🔻 أسقط الكرة'}
          </Text>
        </TouchableOpacity>
      </View>

      <GameOddsCard game={game} />
      <GameHistoryCard gameType="plinko" refreshKey={historyKey} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.roomBackground },
  content: { padding: 16, paddingTop: 58, paddingBottom: 32 },
  boardContainer: {
    backgroundColor: colors.roomSurface,
    borderRadius: 24,
    padding: 16,
    alignItems: 'center',
    marginVertical: 14,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    overflow: 'hidden',
  },
  pegsBoard: {
    position: 'relative',
    width: '100%',
    height: 246,
    alignItems: 'center',
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
    backgroundColor: colors.primaryLight,
    shadowColor: colors.primary,
    shadowOpacity: 0.6,
    shadowRadius: 4,
    elevation: 3,
  },
  ball: {
    position: 'absolute',
    top: 2,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.gold,
    borderWidth: 2,
    borderColor: colors.text,
    shadowColor: colors.gold,
    shadowOpacity: 0.9,
    shadowRadius: 8,
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
    paddingVertical: 7,
    borderRadius: 5,
    alignItems: 'center',
  },
  slotText: { fontSize: 7.5, fontFamily: fonts.black },
  resultBanner: { padding: 12, borderRadius: 10, alignItems: 'center', marginBottom: 12 },
  winBanner: { backgroundColor: colors.tealHaze, borderWidth: 1, borderColor: colors.roomTeal },
  loseBanner: { backgroundColor: colors.dangerGlow, borderWidth: 1, borderColor: colors.danger },
  resultText: { color: colors.roomText, fontSize: 14, fontFamily: fonts.bold },
  controlsCard: { backgroundColor: colors.roomSurface, borderRadius: 16, padding: 16 },
  label: { color: colors.roomMuted, fontSize: 13, marginBottom: 8 },
  riskRow: { flexDirection: 'row', gap: 8 },
  riskBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: colors.roomElevated,
    alignItems: 'center',
  },
  riskBtnActive: { backgroundColor: colors.roomPrimary },
  riskText: { color: colors.roomMuted, fontSize: 13, fontFamily: fonts.semibold },
  riskTextActive: { color: colors.roomText },
  riskHint: { color: colors.roomMuted, fontSize: 10, textAlign: 'right', marginTop: 8, lineHeight: 15 },
  limitHint: { color: colors.roomMuted, fontSize: 10, textAlign: 'right', marginTop: 8 },
  playButton: {
    backgroundColor: colors.gold,
    height: 50,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },
  playButtonDisabled: { opacity: 0.5 },
  playButtonText: { color: colors.inkGold, fontSize: 16, fontFamily: fonts.bold },
});
