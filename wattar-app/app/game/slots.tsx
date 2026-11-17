import { useRef, useState } from 'react';
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

interface SlotsResponse {
  reels: string[];
  is_win: boolean;
  multiplier: number;
  payout: number;
}

const SYMBOLS = ['🍋', '🍀', '⭐', '🍇', '🍒', '🔔', '💎'];

export default function SlotsGame() {
  const { profile, loadProfile } = useAuthStore();
  const reduceMotion = usePreferencesStore((state) => state.reduceMotion);
  const [betAmount, setBetAmount] = useState('100');
  const [reels, setReels] = useState(['🍋', '⭐', '🍇']);
  const [result, setResult] = useState<SlotsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const spinValue = useRef(new Animated.Value(0)).current;
  const validBet = parseValidGameBet(betAmount, profile?.balance_gold ?? 0);

  const spin = async () => {
    const bet = parseValidGameBet(betAmount, profile?.balance_gold ?? 0);
    if (bet === null || loading) return;

    let spinTimer: ReturnType<typeof setInterval> | null = null;
    setLoading(true);
    setResult(null);
    setErrorMessage(null);
    spinValue.setValue(0);

    try {
      if (!reduceMotion) {
        spinTimer = setInterval(() => {
          setReels(Array.from({ length: 3 }, () => SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]));
        }, 110);
      }
      const response = await callFunction<SlotsResponse>(
        'game-slots',
        { bet_amount: bet },
        `game-slots-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`,
      );
      if (
        !Array.isArray(response.reels)
        || response.reels.length !== 3
        || response.reels.some((symbol) => typeof symbol !== 'string' || !SYMBOLS.includes(symbol))
        || typeof response.is_win !== 'boolean'
        || !Number.isFinite(response.multiplier)
        || !Number.isFinite(response.payout)
        || response.multiplier < 0
        || response.payout < 0
      ) {
        throw new Error('لم تصل نتيجة البكرات بشكل صحيح.');
      }
      if (spinTimer) clearInterval(spinTimer);

      if (reduceMotion) {
        setReels(response.reels);
        setResult(response);
        setLoading(false);
        void loadProfile().catch((error: unknown) => {
          console.warn('[Wattar] Failed to refresh Coin balance after slots:', error);
        });
        return;
      }

      Animated.timing(spinValue, {
        toValue: 1,
        duration: 1500,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (!finished) return;
        setReels(response.reels);
        setResult(response);
        setLoading(false);
        void loadProfile().catch((error: unknown) => {
          console.warn('[Wattar] Failed to refresh Coin balance after slots:', error);
        });
      });
    } catch (error: unknown) {
      if (spinTimer) clearInterval(spinTimer);
      setLoading(false);
      setResult(null);
      const message = error instanceof Error ? error.message : 'تعذر إكمال الجولة.';
      setErrorMessage(message);
    }
  };

  const translateY = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: [-24, 0],
  });
  const opacity = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: [0.55, 1],
  });

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <GameHeader
        title="Slots"
        subtitle="طابق الرموز الثلاثة واربح Coin داخل اللعبة."
        balance={profile?.balance_gold ?? 0}
      />

      <View style={styles.machine}>
        <View style={styles.machineLights}>
          <View style={styles.light} />
          <View style={styles.light} />
          <View style={styles.light} />
        </View>
        <Animated.View style={[styles.reelsFrame, { opacity, transform: [{ translateY }] }]}>
          {reels.map((symbol, index) => (
            <View key={`${index}-${symbol}`} style={styles.reel}>
              <Text style={styles.symbol}>{symbol}</Text>
            </View>
          ))}
        </Animated.View>
        <View style={styles.machineBase}>
          <Text style={styles.payline}>WATTAR · FREE PLAY</Text>
        </View>
      </View>

      {result ? (
        <View style={[styles.resultCard, result.is_win ? styles.winCard : styles.lossCard]}>
          <Text style={styles.resultTitle}>
            {result.is_win ? `رموز متطابقة · x${result.multiplier}` : 'جولة جديدة، حظ أوفر!'}
          </Text>
          <Text style={styles.resultText}>
            {result.is_win
              ? `الجائزة ${result.payout.toLocaleString()} Coin`
              : 'لم تطابق الرموز هذه المرة.'}
          </Text>
        </View>
      ) : null}
      {errorMessage ? <Text accessibilityRole="alert" style={styles.error}>{errorMessage}</Text> : null}

      <View style={styles.controls}>
        <GameBetControl
          value={betAmount}
          balance={profile?.balance_gold ?? 0}
          disabled={loading}
          onChange={(value) => {
            setBetAmount(value);
            setErrorMessage(null);
          }}
        />
        <TouchableOpacity
          style={[styles.spinButton, (loading || validBet === null) && styles.disabled]}
          onPress={spin}
          disabled={loading || validBet === null}
          accessibilityRole="button"
        >
          {loading
            ? <ActivityIndicator color={colors.background} />
            : <Text style={styles.spinText}>جرّب حظك</Text>}
        </TouchableOpacity>
        <Text style={styles.disclaimer}>
          الرهان يُخصم من رصيد Coin المشحون، والأرباح تعود إلى Coin.
        </Text>
      </View>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.roomBackground },
  content: { padding: 18, paddingTop: 62, paddingBottom: 36 },
  header: { alignItems: 'center', marginBottom: 22 },
  eyebrow: { color: colors.gold, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  title: { color: colors.roomText, fontSize: 30, fontWeight: '900', marginTop: 5 },
  subtitle: { color: colors.roomMuted, fontSize: 12, textAlign: 'center', marginTop: 5 },
  machine: { padding: 16, borderRadius: 28, backgroundColor: '#21142F', borderWidth: 1, borderColor: '#6E3A81' },
  machineLights: { flexDirection: 'row', justifyContent: 'center', gap: 12, marginBottom: 14 },
  light: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.gold },
  reelsFrame: { flexDirection: 'row', gap: 8, padding: 10, borderRadius: 19, backgroundColor: '#0A0712', borderWidth: 2, borderColor: '#A64FE5' },
  reel: { flex: 1, height: 112, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: '#211832', borderWidth: 1, borderColor: '#3D2B51' },
  symbol: { fontSize: 43 },
  machineBase: { alignItems: 'center', marginTop: 13 },
  payline: { color: '#B5A9C5', fontSize: 9, fontWeight: '900', letterSpacing: 2 },
  resultCard: { alignItems: 'center', padding: 14, marginTop: 14, borderRadius: 15, borderWidth: 1 },
  winCard: { backgroundColor: '#15372C', borderColor: colors.success },
  lossCard: { backgroundColor: colors.surface, borderColor: colors.border },
  resultTitle: { color: colors.text, fontSize: 14, fontWeight: '900' },
  resultText: { color: colors.textSecondary, fontSize: 12, marginTop: 5 },
  error: { color: colors.danger, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 12 },
  controls: { padding: 16, marginTop: 14, borderRadius: 19, backgroundColor: colors.roomSurface, borderWidth: 1, borderColor: colors.border },
  label: { color: colors.roomMuted, fontSize: 12, fontWeight: '700', textAlign: 'right', marginBottom: 8 },
  input: { height: 49, color: colors.roomText, fontSize: 16, paddingHorizontal: 13, borderRadius: 12, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, textAlign: 'center' },
  spinButton: { height: 50, alignItems: 'center', justifyContent: 'center', marginTop: 12, borderRadius: 14, backgroundColor: colors.gold },
  disabled: { opacity: 0.6 },
  spinText: { color: colors.background, fontSize: 15, fontWeight: '900' },
  disclaimer: { color: colors.textSecondary, fontSize: 10, lineHeight: 16, textAlign: 'center', marginTop: 11 },
  balanceCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, marginTop: 12, borderRadius: 15, backgroundColor: colors.surface },
  balanceLabel: { color: colors.textSecondary, fontSize: 12 },
  balance: { color: colors.gold, fontSize: 16, fontWeight: '900' },
});
