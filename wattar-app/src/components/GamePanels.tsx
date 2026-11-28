/**
 * Wattar — لوحات الألعاب المشتركة (M9.4)
 * عرض الاحتمالات المعلنة، الشارة الترويجية، مفتاح وضع المحاكاة،
 * وسجل الجولات الشخصية مع إحصاءات اللعبة.
 */
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { supabase } from '@/lib/supabase';
import { colors, fonts } from '@/lib/theme';
import { formatPercent, GameType, PublicGame } from '@/lib/gameConfig';

interface GameStat {
  rounds: number;
  wagered: number;
  returned: number;
  net: number;
  wins: number;
}

interface RoundRow {
  bet_id: string;
  bet_amount: number;
  payout: number;
  net: number;
  multiplier: number;
  is_win: boolean;
  is_test: boolean;
  created_at: string;
}

export function GameOddsCard({ game }: { game: PublicGame | null }) {
  if (!game) return null;
  const odds = game.declared_odds ?? {};

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>الاحتمالات المعلنة</Text>
        <View style={styles.rtpBadge}>
          <Text style={styles.rtpLabel}>RTP</Text>
          <Text style={styles.rtpValue}>{formatPercent(game.declared_rtp)}</Text>
        </View>
      </View>

      {game.promo ? (
        <View style={styles.promo}>
          <Text style={styles.promoText}>
            {game.promo.label ?? 'عرض ترويجي'} · ×{game.promo.multiplier}
          </Text>
          <Text style={styles.promoHint}>مكافأة معلنة إضافية، لا تغيّر الاحتمالات الأساسية.</Text>
        </View>
      ) : null}

      <OddsBody gameType={game.game_type} odds={odds} />

      {game.rules ? <Text style={styles.rules}>{game.rules}</Text> : null}
      <Text style={styles.note}>
        النتيجة تُحسب على الخادم فقط، وكل جولة مسجّلة بشكل مستقل.
      </Text>
    </View>
  );
}

function OddsBody({ gameType, odds }: { gameType: GameType; odds: Record<string, unknown> }) {
  if (gameType === 'wheel') {
    const segments = Array.isArray(odds.segments)
      ? (odds.segments as Array<Record<string, unknown>>)
      : [];
    return (
      <View style={styles.rows}>
        {segments.map((segment) => (
          <View key={String(segment.index)} style={styles.row}>
            <View style={[styles.dot, { backgroundColor: String(segment.color ?? colors.primary) }]} />
            <Text style={styles.rowLabel}>{String(segment.label ?? '')}</Text>
            <Text style={styles.rowValue}>
              احتمال {formatPercent(Number(segment.probability) * 100)}
            </Text>
            <Text style={styles.rowValue}>عائد {formatPercent(Number(segment.segment_rtp))}</Text>
          </View>
        ))}
      </View>
    );
  }

  if (gameType === 'plinko') {
    const risks = (odds.risks ?? {}) as Record<string, { rtp?: number }>;
    const labels: Record<string, string> = { low: 'منخفض', medium: 'متوسط', high: 'عالي' };
    return (
      <View style={styles.rows}>
        {Object.entries(risks).map(([risk, value]) => (
          <View key={risk} style={styles.row}>
            <Text style={styles.rowLabel}>{labels[risk] ?? risk}</Text>
            <Text style={styles.rowValue}>RTP {formatPercent(Number(value.rtp))}</Text>
            <Text style={styles.rowValue}>توزيع ثنائي 12 صفاً</Text>
          </View>
        ))}
      </View>
    );
  }

  if (gameType === 'slots') {
    const tiers = Array.isArray(odds.tiers) ? (odds.tiers as Array<Record<string, unknown>>) : [];
    return (
      <View style={styles.rows}>
        {tiers.map((tier, index) => (
          <View key={index} style={styles.row}>
            <Text style={styles.rowLabel}>{String(tier.symbol ?? '')}</Text>
            <Text style={styles.rowValue}>×{Number(tier.multiplier)}</Text>
            <Text style={styles.rowValue}>
              احتمال {formatPercent(Number(tier.probability) * 100)}
            </Text>
          </View>
        ))}
        <Text style={styles.rowHint}>
          نسبة الإصابة {formatPercent(Number(odds.hit_rate ?? 0) * 100)}
        </Text>
      </View>
    );
  }

  if (gameType === 'dice') {
    return (
      <View style={styles.rows}>
        <Text style={styles.rowHint}>
          المضاعف = (1 ÷ احتمال الفوز) × RTP. النتيجة رقمية من 1 إلى 100.
        </Text>
        <Text style={styles.rowHint}>احتمال الفوز يظهر مباشرة قبل كل جولة.</Text>
      </View>
    );
  }

  return (
    <View style={styles.rows}>
      <Text style={styles.rowHint}>P(تجاوز x) = RTP ÷ x — كلما ارتفع هدف السحب قلّ احتمال الوصول.</Text>
    </View>
  );
}

export function GamePromoBanner({ game }: { game: PublicGame | null }) {
  if (!game?.promo) return null;
  return (
    <View style={styles.promoOnly}>
      <Text style={styles.promoText}>{game.promo.label ?? 'عرض ترويجي'} · ×{game.promo.multiplier}</Text>
    </View>
  );
}

export function GameTestModeRow({
  enabled,
  value,
  onChange,
}: {
  enabled: boolean;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  if (!enabled) return null;
  return (
    <View style={styles.testRow}>
      <View style={styles.testCopy}>
        <Text style={styles.testTitle}>وضع المحاكاة</Text>
        <Text style={styles.testHint}>جولات بلا خصم أو إضافة لأي رصيد حقيقي.</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.surfaceMuted, true: colors.primarySoft }}
        thumbColor={value ? colors.teal : colors.textSecondary}
      />
    </View>
  );
}

export function GameHistoryCard({
  gameType,
  refreshKey = 0,
}: {
  gameType: GameType;
  refreshKey?: number;
}) {
  const [stats, setStats] = useState<GameStat | null>(null);
  const [rounds, setRounds] = useState<RoundRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [statsResult, roundsResult] = await Promise.all([
        supabase.rpc('get_my_game_stats'),
        supabase.rpc('get_my_game_rounds', { p_game_type: gameType, p_limit: 5 }),
      ]);
      if (!statsResult.error) {
        const payload = (statsResult.data ?? {}) as {
          by_game?: Array<Record<string, unknown>>;
        };
        const row = (payload.by_game ?? []).find((item) => item.game_type === gameType);
        setStats(row
          ? {
              rounds: Number(row.rounds ?? 0),
              wagered: Number(row.wagered ?? 0),
              returned: Number(row.returned ?? 0),
              net: Number(row.net ?? 0),
              wins: Number(row.wins ?? 0),
            }
          : null);
      }
      if (!roundsResult.error && Array.isArray(roundsResult.data)) {
        setRounds(roundsResult.data as RoundRow[]);
      }
    } catch {
      // السجل مكمّل للعرض فقط؛ لا نعطّل اللعب عند تعذّره.
    } finally {
      setLoading(false);
    }
  }, [gameType]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>سجلّي في هذه اللعبة</Text>
        <TouchableOpacity onPress={() => void load()} accessibilityRole="button" accessibilityLabel="تحديث السجل">
          <Text style={styles.refresh}>تحديث</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.teal} />
      ) : (
        <>
          <View style={styles.metrics}>
            <Metric label="جولات" value={stats?.rounds ?? 0} />
            <Metric label="مراهنات" value={stats?.wagered ?? 0} />
            <Metric label="صافي" value={stats?.net ?? 0} signed />
            <Metric label="مكاسب" value={stats?.wins ?? 0} />
          </View>

          {rounds.length === 0 ? (
            <Text style={styles.rowHint}>لم تلعب هذه اللعبة بعد.</Text>
          ) : (
            rounds.map((round) => (
              <View key={round.bet_id} style={styles.roundRow}>
                <Text style={[styles.roundResult, { color: round.is_win ? colors.success : colors.danger }]}>
                  {round.is_win ? `+${round.payout}` : `-${round.bet_amount}`}
                </Text>
                <Text style={styles.roundMeta}>
                  ×{Number(round.multiplier).toFixed(2)}
                  {round.is_test ? ' · محاكاة' : ''}
                  {' · '}
                  {new Date(round.created_at).toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>
            ))
          )}
        </>
      )}
    </View>
  );
}

function Metric({ label, value, signed = false }: { label: string; value: number; signed?: boolean }) {
  const color = signed ? (value >= 0 ? colors.success : colors.danger) : colors.text;
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, { color }]}>
        {signed && value > 0 ? '+' : ''}{Number(value).toLocaleString()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginTop: 14,
    gap: 10,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { color: colors.text, fontSize: 14, fontFamily: fonts.bold },
  refresh: { color: colors.teal, fontSize: 11, fontFamily: fonts.bold },
  rtpBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 9, paddingVertical: 4, borderRadius: 9, backgroundColor: colors.tealSoft,
  },
  rtpLabel: { color: colors.teal, fontSize: 9, fontFamily: fonts.black },
  rtpValue: { color: colors.teal, fontSize: 12, fontFamily: fonts.black },
  promo: {
    borderRadius: 12, borderWidth: 1, borderColor: colors.gold,
    backgroundColor: colors.goldSoft, padding: 10, gap: 3,
  },
  promoOnly: {
    borderRadius: 12, borderWidth: 1, borderColor: colors.gold,
    backgroundColor: colors.goldSoft, padding: 10, marginBottom: 12,
  },
  promoText: { color: colors.gold, fontSize: 12, fontFamily: fonts.bold, textAlign: 'right' },
  promoHint: { color: colors.textSecondary, fontSize: 10, textAlign: 'right' },
  rows: { gap: 7 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  rowLabel: { flex: 1, color: colors.text, fontSize: 11, fontFamily: fonts.semibold, textAlign: 'right' },
  rowValue: { color: colors.textSecondary, fontSize: 10, textAlign: 'right' },
  rowHint: { color: colors.textSecondary, fontSize: 10, lineHeight: 16, textAlign: 'right' },
  rules: { color: colors.textSecondary, fontSize: 10, lineHeight: 16, textAlign: 'right' },
  note: { color: colors.textSecondary, fontSize: 9, lineHeight: 14, textAlign: 'right' },
  testRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1,
    borderColor: colors.border, padding: 12, marginTop: 12,
  },
  testCopy: { flex: 1, gap: 2 },
  testTitle: { color: colors.text, fontSize: 12, fontFamily: fonts.bold, textAlign: 'right' },
  testHint: { color: colors.textSecondary, fontSize: 10, textAlign: 'right' },
  metrics: { flexDirection: 'row', gap: 8 },
  metric: { flex: 1, backgroundColor: colors.background, borderRadius: 10, paddingVertical: 8, alignItems: 'center' },
  metricLabel: { color: colors.textSecondary, fontSize: 9, fontFamily: fonts.semibold },
  metricValue: { fontSize: 12, fontFamily: fonts.black, marginTop: 2 },
  roundRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 7,
  },
  roundResult: { fontSize: 12, fontFamily: fonts.black },
  roundMeta: { color: colors.textSecondary, fontSize: 10 },
});
