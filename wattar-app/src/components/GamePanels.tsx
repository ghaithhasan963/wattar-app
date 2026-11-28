/**
 * Wattar â€” ظ„ظˆط­ط§طھ ط§ظ„ط£ظ„ط¹ط§ط¨ ط§ظ„ظ…ط´طھط±ظƒط© (M9.4)
 * ط¹ط±ط¶ ط§ظ„ط§ط­طھظ…ط§ظ„ط§طھ ط§ظ„ظ…ط¹ظ„ظ†ط©طŒ ط§ظ„ط´ط§ط±ط© ط§ظ„طھط±ظˆظٹط¬ظٹط©طŒ ظ…ظپطھط§ط­ ظˆط¶ط¹ ط§ظ„ظ…ط­ط§ظƒط§ط©طŒ
 * ظˆط³ط¬ظ„ ط§ظ„ط¬ظˆظ„ط§طھ ط§ظ„ط´ط®طµظٹط© ظ…ط¹ ط¥ط­طµط§ط،ط§طھ ط§ظ„ظ„ط¹ط¨ط©.
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
        <Text style={styles.cardTitle}>ط§ظ„ط§ط­طھظ…ط§ظ„ط§طھ ط§ظ„ظ…ط¹ظ„ظ†ط©</Text>
        <View style={styles.rtpBadge}>
          <Text style={styles.rtpLabel}>RTP</Text>
          <Text style={styles.rtpValue}>{formatPercent(game.declared_rtp)}</Text>
        </View>
      </View>

      {game.promo ? (
        <View style={styles.promo}>
          <Text style={styles.promoText}>
            {game.promo.label ?? 'ط¹ط±ط¶ طھط±ظˆظٹط¬ظٹ'} آ· أ—{game.promo.multiplier}
          </Text>
          <Text style={styles.promoHint}>ظ…ظƒط§ظپط£ط© ظ…ط¹ظ„ظ†ط© ط¥ط¶ط§ظپظٹط©طŒ ظ„ط§ طھط؛ظٹظ‘ط± ط§ظ„ط§ط­طھظ…ط§ظ„ط§طھ ط§ظ„ط£ط³ط§ط³ظٹط©.</Text>
        </View>
      ) : null}

      <OddsBody gameType={game.game_type} odds={odds} />

      {game.rules ? <Text style={styles.rules}>{game.rules}</Text> : null}
      <Text style={styles.note}>
        ط§ظ„ظ†طھظٹط¬ط© طھظڈط­ط³ط¨ ط¹ظ„ظ‰ ط§ظ„ط®ط§ط¯ظ… ظپظ‚ط·طŒ ظˆظƒظ„ ط¬ظˆظ„ط© ظ…ط³ط¬ظ‘ظ„ط© ط¨ط´ظƒظ„ ظ…ط³طھظ‚ظ„.
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
              ط§ط­طھظ…ط§ظ„ {formatPercent(Number(segment.probability) * 100)}
            </Text>
            <Text style={styles.rowValue}>ط¹ط§ط¦ط¯ {formatPercent(Number(segment.segment_rtp))}</Text>
          </View>
        ))}
      </View>
    );
  }

  if (gameType === 'plinko') {
    const risks = (odds.risks ?? {}) as Record<string, { rtp?: number }>;
    const labels: Record<string, string> = { low: 'ظ…ظ†ط®ظپط¶', medium: 'ظ…طھظˆط³ط·', high: 'ط¹ط§ظ„ظٹ' };
    return (
      <View style={styles.rows}>
        {Object.entries(risks).map(([risk, value]) => (
          <View key={risk} style={styles.row}>
            <Text style={styles.rowLabel}>{labels[risk] ?? risk}</Text>
            <Text style={styles.rowValue}>RTP {formatPercent(Number(value.rtp))}</Text>
            <Text style={styles.rowValue}>طھظˆط²ظٹط¹ ط«ظ†ط§ط¦ظٹ 12 طµظپط§ظ‹</Text>
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
            <Text style={styles.rowValue}>أ—{Number(tier.multiplier)}</Text>
            <Text style={styles.rowValue}>
              ط§ط­طھظ…ط§ظ„ {formatPercent(Number(tier.probability) * 100)}
            </Text>
          </View>
        ))}
        <Text style={styles.rowHint}>
          ظ†ط³ط¨ط© ط§ظ„ط¥طµط§ط¨ط© {formatPercent(Number(odds.hit_rate ?? 0) * 100)}
        </Text>
      </View>
    );
  }

  if (gameType === 'dice') {
    return (
      <View style={styles.rows}>
        <Text style={styles.rowHint}>
          ط§ظ„ظ…ط¶ط§ط¹ظپ = (1 أ· ط§ط­طھظ…ط§ظ„ ط§ظ„ظپظˆط²) أ— RTP. ط§ظ„ظ†طھظٹط¬ط© ط±ظ‚ظ…ظٹط© ظ…ظ† 1 ط¥ظ„ظ‰ 100.
        </Text>
        <Text style={styles.rowHint}>ط§ط­طھظ…ط§ظ„ ط§ظ„ظپظˆط² ظٹط¸ظ‡ط± ظ…ط¨ط§ط´ط±ط© ظ‚ط¨ظ„ ظƒظ„ ط¬ظˆظ„ط©.</Text>
      </View>
    );
  }

  return (
    <View style={styles.rows}>
      <Text style={styles.rowHint}>P(طھط¬ط§ظˆط² x) = RTP أ· x â€” ظƒظ„ظ…ط§ ط§ط±طھظپط¹ ظ‡ط¯ظپ ط§ظ„ط³ط­ط¨ ظ‚ظ„ظ‘ ط§ط­طھظ…ط§ظ„ ط§ظ„ظˆطµظˆظ„.</Text>
    </View>
  );
}

export function GamePromoBanner({ game }: { game: PublicGame | null }) {
  if (!game?.promo) return null;
  return (
    <View style={styles.promoOnly}>
      <Text style={styles.promoText}>{game.promo.label ?? 'ط¹ط±ط¶ طھط±ظˆظٹط¬ظٹ'} آ· أ—{game.promo.multiplier}</Text>
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
        <Text style={styles.testTitle}>ظˆط¶ط¹ ط§ظ„ظ…ط­ط§ظƒط§ط©</Text>
        <Text style={styles.testHint}>ط¬ظˆظ„ط§طھ ط¨ظ„ط§ ط®طµظ… ط£ظˆ ط¥ط¶ط§ظپط© ظ„ط£ظٹ ط±طµظٹط¯ ط­ظ‚ظٹظ‚ظٹ.</Text>
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
      // ط§ظ„ط³ط¬ظ„ ظ…ظƒظ…ظ‘ظ„ ظ„ظ„ط¹ط±ط¶ ظپظ‚ط·ط› ظ„ط§ ظ†ط¹ط·ظ‘ظ„ ط§ظ„ظ„ط¹ط¨ ط¹ظ†ط¯ طھط¹ط°ظ‘ط±ظ‡.
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
        <Text style={styles.cardTitle}>ط³ط¬ظ„ظ‘ظٹ ظپظٹ ظ‡ط°ظ‡ ط§ظ„ظ„ط¹ط¨ط©</Text>
        <TouchableOpacity onPress={() => void load()} accessibilityRole="button" accessibilityLabel="طھط­ط¯ظٹط« ط§ظ„ط³ط¬ظ„">
          <Text style={styles.refresh}>طھط­ط¯ظٹط«</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.teal} />
      ) : (
        <>
          <View style={styles.metrics}>
            <Metric label="ط¬ظˆظ„ط§طھ" value={stats?.rounds ?? 0} />
            <Metric label="ظ…ط±ط§ظ‡ظ†ط§طھ" value={stats?.wagered ?? 0} />
            <Metric label="طµط§ظپظٹ" value={stats?.net ?? 0} signed />
            <Metric label="ظ…ظƒط§ط³ط¨" value={stats?.wins ?? 0} />
          </View>

          {rounds.length === 0 ? (
            <Text style={styles.rowHint}>ظ„ظ… طھظ„ط¹ط¨ ظ‡ط°ظ‡ ط§ظ„ظ„ط¹ط¨ط© ط¨ط¹ط¯.</Text>
          ) : (
            rounds.map((round) => (
              <View key={round.bet_id} style={styles.roundRow}>
                <Text style={[styles.roundResult, { color: round.is_win ? colors.success : colors.danger }]}>
                  {round.is_win ? `+${round.payout}` : `-${round.bet_amount}`}
                </Text>
                <Text style={styles.roundMeta}>
                  أ—{Number(round.multiplier).toFixed(2)}
                  {round.is_test ? ' آ· ظ…ط­ط§ظƒط§ط©' : ''}
                  {' آ· '}
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
