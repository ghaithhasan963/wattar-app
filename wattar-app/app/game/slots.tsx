/**
 * Wattar App — Slots (M9.4)
 * جدول الجوائز ورموز الخسارة من إعدادات الخادم. الخادم يسحب الفئة وفق
 * الاحتمالات المعلنة ويعيد الرموز؛ العميل يعرض فقط ولا يقرر النتيجة.
 */
import React, { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAuthStore } from '@/store/auth';
import { callFunction } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import { usePreferencesStore } from '@/store/preferences';
import { GameHeader } from '@/components/GameHeader';
import { GameBetControl, parseValidGameBet } from '@/components/GameBetControl';
import { GameHistoryCard, GameOddsCard, GameTestModeRow } from '@/components/GamePanels';
import { usePublicGames } from '@/hooks/usePublicGames';
import { formatPercent, newIdempotencyKey, toSlotsConfig } from '@/lib/gameConfig';

interface SlotsResponse {
  reels: string[];
  is_win: boolean;
  multiplier: number;
  payout: number;
  test_mode: boolean;
  promo_reward: boolean;
}

const CELL_HEIGHT = 96;
const STRIP_LENGTH = 14;
const IDLE_REELS = ['🍋', '⭐', '🍇'];
const REEL_DURATIONS = [820, 1080, 1340];

export default function SlotsGame() {
  const { profile, loadProfile } = useAuthStore();
  const reduceMotion = usePreferencesStore((state) => state.reduceMotion);
  const { find } = usePublicGames();
  const game = find('slots');

  const config = useMemo(() => toSlotsConfig(game?.settings ?? {}), [game]);
  const pool = useMemo(() => {
    const symbols = [...config.tiers.map((tier) => tier.symbol), ...config.lossSymbols];
    return symbols.length > 0 ? symbols : IDLE_REELS;
  }, [config]);
  const allowedSymbols = useMemo(() => new Set(pool), [pool]);

  const [betAmount, setBetAmount] = useState('100');
  const [reels, setReels] = useState<string[]>(IDLE_REELS);
  const [strips, setStrips] = useState<string[][]>([]);
  const [spinning, setSpinning] = useState(false);
  const [testMode, setTestMode] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);
  const [result, setResult] = useState<SlotsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const reelAnim = useRef([
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
  ]).current;
  const winPulse = useRef(new Animated.Value(0)).current;
  const validBet = parseValidGameBet(betAmount, profile?.balance_gold ?? 0);

  const buildStrip = (finalSymbol: string): string[] => {
    const strip: string[] = [];
    for (let index = 0; index < STRIP_LENGTH - 1; index += 1) {
      strip.push(pool[(index + Math.floor(Math.random() * pool.length)) % pool.length]);
    }
    strip.push(finalSymbol);
    return strip;
  };

  const spin = async () => {
    const bet = parseValidGameBet(betAmount, profile?.balance_gold ?? 0);
    if (bet === null || loading || spinning) return;
    if (game && !game.available) {
      setErrorMessage('هذه اللعبة غير متاحة لحسابك حالياً.');
      return;
    }
    if (game && (bet < game.min_bet || bet > game.max_bet)) {
      setErrorMessage(`الحد المسموح من ${game.min_bet} إلى ${game.max_bet} Coin.`);
      return;
    }

    setLoading(true);
    setResult(null);
    setErrorMessage(null);
    winPulse.setValue(0);
    reelAnim.forEach((value) => value.setValue(0));

    try {
      const response = await callFunction<SlotsResponse>('game-slots', {
        bet_amount: bet,
        test_mode: testMode,
      }, newIdempotencyKey('game-slots'));

      if (
        !Array.isArray(response.reels)
        || response.reels.length !== 3
        || response.reels.some((symbol) => typeof symbol !== 'string' || !allowedSymbols.has(symbol))
        || typeof response.is_win !== 'boolean'
        || !Number.isFinite(response.multiplier)
        || !Number.isFinite(response.payout)
        || response.multiplier < 0
        || response.payout < 0
      ) {
        throw new Error('لم تصل نتيجة البكرات بشكل صحيح.');
      }

      setLoading(false);

      if (reduceMotion) {
        setStrips([]);
        setReels(response.reels);
        setResult(response);
        setHistoryKey((key) => key + 1);
        void loadProfile().catch((error: unknown) => {
          console.warn('[Wattar] Failed to refresh Coin balance after slots:', error);
        });
        return;
      }

      const nextStrips = response.reels.map((symbol) => buildStrip(symbol));
      setStrips(nextStrips);
      setSpinning(true);

      await new Promise<void>((resolve) => {
        Animated.parallel(
          reelAnim.map((value, index) => Animated.timing(value, {
            toValue: 1,
            duration: REEL_DURATIONS[index] ?? 1200,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          })),
        ).start(() => resolve());
      });

      reelAnim.forEach((value) => value.setValue(0));
      setStrips([]);
      setSpinning(false);
      setReels(response.reels);
      setResult(response);
      setHistoryKey((key) => key + 1);
      if (response.is_win) {
        Animated.sequence([
          Animated.timing(winPulse, { toValue: 1, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.spring(winPulse, { toValue: 0, speed: 14, bounciness: 10, useNativeDriver: true }),
        ]).start();
      }
      void loadProfile().catch((error: unknown) => {
        console.warn('[Wattar] Failed to refresh Coin balance after slots:', error);
      });
    } catch (error: unknown) {
      reelAnim.forEach((value) => value.setValue(0));
      setStrips([]);
      setSpinning(false);
      setLoading(false);
      setResult(null);
      setErrorMessage(error instanceof Error ? error.message : 'تعذر إكمال الجولة.');
    }
  };

  const winScale = winPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] });
  const hitRate = config.tiers.reduce((sum, tier) => sum + tier.probability, 0);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <GameHeader
        title={game?.display_name ?? 'Slots'}
        subtitle={game?.description ?? 'طابق الرموز الثلاثة. الفئة تُسحب على الخادم وفق الاحتمالات المعلنة.'}
        balance={profile?.balance_gold ?? 0}
      />

      <GameTestModeRow
        enabled={game?.test_mode_enabled === true}
        value={testMode}
        onChange={setTestMode}
      />

      <Animated.View style={[styles.machine, result?.is_win ? { transform: [{ scale: winScale }] } : null]}>
        <View style={styles.machineLights}>
          <View style={styles.light} />
          <View style={styles.light} />
          <View style={styles.light} />
        </View>

        <View style={styles.reelsFrame}>
          {[0, 1, 2].map((index) => {
            const isHit = Boolean(result?.is_win) && reels[index] === result?.reels[0];
            return (
              <View
                key={index}
                style={[styles.reel, isHit ? styles.reelWin : null]}
              >
                {spinning && strips[index] ? (
                  <Animated.View
                    style={{
                      transform: [{
                        translateY: reelAnim[index].interpolate({
                          inputRange: [0, 1],
                          outputRange: [0, -(strips[index].length - 1) * CELL_HEIGHT],
                        }),
                      }],
                    }}
                  >
                    {strips[index].map((symbol, cell) => (
                      <View key={`${cell}-${symbol}`} style={styles.cell}>
                        <Text style={styles.symbol}>{symbol}</Text>
                      </View>
                    ))}
                  </Animated.View>
                ) : (
                  <View style={styles.cell}>
                    <Text style={styles.symbol}>{reels[index]}</Text>
                  </View>
                )}
              </View>
            );
          })}
        </View>

        <View style={styles.machineBase}>
          <Text style={styles.payline}>WATTAR · RTP {formatPercent(game?.declared_rtp ?? 0)}</Text>
        </View>
      </Animated.View>

      {result ? (
        <View style={[styles.resultCard, result.is_win ? styles.winCard : styles.lossCard]}>
          <Text style={styles.resultTitle}>
            {result.is_win ? `رموز متطابقة · ×${result.multiplier}` : 'جولة جديدة، حظ أوفر!'}
          </Text>
          <Text style={styles.resultText}>
            {result.is_win
              ? `الجائزة ${result.payout.toLocaleString()} Coin`
              : 'لم تطابق الرموز هذه المرة.'}
            {result.test_mode ? ' · محاكاة بلا أرصدة حقيقية' : ''}
            {result.promo_reward ? ' · مكافأة معلنة' : ''}
          </Text>
        </View>
      ) : null}
      {errorMessage ? <Text accessibilityRole="alert" style={styles.error}>{errorMessage}</Text> : null}

      <View style={styles.controls}>
        <Text style={styles.tableTitle}>جدول الجوائز المعلن</Text>
        <View style={styles.tableRow}>
          {config.tiers.map((tier) => (
            <View key={tier.symbol} style={styles.tableCell}>
              <Text style={styles.tableSymbol}>{tier.symbol}</Text>
              <Text style={styles.tableMult}>×{tier.multiplier}</Text>
              <Text style={styles.tableProb}>{formatPercent(tier.probability * 100)}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.tableHint}>
          نسبة الإصابة {formatPercent(hitRate * 100)} — رمزان مختلفان أو أكثر يعنيان خسارة الجولة.
        </Text>

        <GameBetControl
          value={betAmount}
          balance={profile?.balance_gold ?? 0}
          disabled={loading || spinning}
          onChange={(value) => {
            setBetAmount(value);
            setErrorMessage(null);
          }}
        />
        {game ? (
          <Text style={styles.limitHint}>
            الحد: {game.min_bet.toLocaleString()} – {game.max_bet.toLocaleString()} Coin
          </Text>
        ) : null}

        <TouchableOpacity
          style={[styles.spinButton, (loading || spinning || validBet === null) && styles.disabled]}
          onPress={spin}
          disabled={loading || spinning || validBet === null}
          accessibilityRole="button"
        >
          {loading || spinning
            ? <ActivityIndicator color={colors.background} />
            : <Text style={styles.spinText}>جرّب حظك</Text>}
        </TouchableOpacity>
        <Text style={styles.disclaimer}>
          الرهان يُخصم من رصيد Coin، والأرباح تعود إلى Coin. كل جولة تُسجَّل بشكل مستقل.
        </Text>
      </View>

      <GameOddsCard game={game} />
      <GameHistoryCard gameType="slots" refreshKey={historyKey} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.roomBackground },
  content: { padding: 18, paddingTop: 62, paddingBottom: 36 },
  machine: { padding: 16, borderRadius: 28, backgroundColor: '#21142F', borderWidth: 1, borderColor: '#6E3A81' },
  machineLights: { flexDirection: 'row', justifyContent: 'center', gap: 12, marginBottom: 14 },
  light: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.gold },
  reelsFrame: {
    flexDirection: 'row',
    gap: 8,
    padding: 10,
    borderRadius: 19,
    backgroundColor: '#0A0712',
    borderWidth: 2,
    borderColor: '#A64FE5',
  },
  reel: {
    flex: 1,
    height: CELL_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    backgroundColor: '#211832',
    borderWidth: 1,
    borderColor: '#3D2B51',
    overflow: 'hidden',
  },
  reelWin: { borderColor: colors.gold, backgroundColor: '#2A1D3F' },
  cell: { height: CELL_HEIGHT, alignItems: 'center', justifyContent: 'center' },
  symbol: { fontSize: 43 },
  machineBase: { alignItems: 'center', marginTop: 13 },
  payline: { color: '#B5A9C5', fontSize: 9, fontWeight: '900', letterSpacing: 1.4 },
  resultCard: { alignItems: 'center', padding: 14, marginTop: 14, borderRadius: 15, borderWidth: 1 },
  winCard: { backgroundColor: '#15372C', borderColor: colors.success },
  lossCard: { backgroundColor: colors.surface, borderColor: colors.border },
  resultTitle: { color: colors.text, fontSize: 14, fontWeight: '900' },
  resultText: { color: colors.textSecondary, fontSize: 12, marginTop: 5, textAlign: 'center' },
  error: { color: colors.danger, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 12 },
  controls: {
    padding: 16,
    marginTop: 14,
    borderRadius: 19,
    backgroundColor: colors.roomSurface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tableTitle: { color: colors.roomText, fontSize: 12, fontWeight: '800', textAlign: 'right', marginBottom: 9 },
  tableRow: { flexDirection: 'row', gap: 6 },
  tableCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: colors.roomElevated,
  },
  tableSymbol: { fontSize: 20 },
  tableMult: { color: colors.gold, fontSize: 11, fontWeight: '900', marginTop: 3 },
  tableProb: { color: colors.roomMuted, fontSize: 9, marginTop: 2 },
  tableHint: { color: colors.roomMuted, fontSize: 10, textAlign: 'right', marginTop: 8, lineHeight: 15 },
  limitHint: { color: colors.roomMuted, fontSize: 10, textAlign: 'right', marginTop: 8 },
  spinButton: {
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
    borderRadius: 14,
    backgroundColor: colors.gold,
  },
  disabled: { opacity: 0.6 },
  spinText: { color: colors.background, fontSize: 15, fontWeight: '900' },
  disclaimer: { color: colors.textSecondary, fontSize: 10, lineHeight: 16, textAlign: 'center', marginTop: 11 },
});
