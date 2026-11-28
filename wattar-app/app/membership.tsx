import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { ArrowLeft, Check, Clock3, Crown, Sparkles, X } from 'lucide-react-native';
import { supabase, callFunction } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { colors, fonts } from '@/lib/theme';

interface VipTierPublic {
  tier: number;
  name_ar: string;
  duration_days: number;
  price_coins: number;
  frame: string | null;
  badge: string | null;
  entry_effect: string | null;
  perks: string[];
  room_kick_protection: boolean;
  offer_discount_percent: number;
  offer_active: boolean;
  effective_price_coins: number;
  offer_ends_at: string | null;
}

interface MyVip {
  active: boolean;
  tier: number | null;
  name_ar: string | null;
  frame: string | null;
  badge: string | null;
  entry_effect: string | null;
  perks: string[];
  room_kick_protection: boolean;
  starts_at: string | null;
  expires_at: string | null;
  days_remaining: number;
  purchase_kind: string | null;
}

const palette = {
  background: colors.background,
  surface: colors.surface,
  elevated: colors.surfaceElevated,
  border: colors.border,
  text: colors.text,
  muted: colors.textSecondary,
  primary: colors.primary,
  gold: colors.gold,
  teal: colors.teal,
  danger: colors.danger,
} as const;

export default function MembershipScreen() {
  const router = useRouter();
  const { profile, loadProfile } = useAuthStore();
  const [tiers, setTiers] = useState<VipTierPublic[]>([]);
  const [myVip, setMyVip] = useState<MyVip | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyTier, setBusyTier] = useState<number | null>(null);
  const purchaseAttempt = useRef<{ tier: number; key: string } | null>(null);

  const loadVip = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [tiersResult, myVipResult] = await Promise.all([
        supabase.rpc('get_public_vip_tiers'),
        supabase.rpc('get_my_vip'),
      ]);
      if (tiersResult.error) throw tiersResult.error;
      if (myVipResult.error) throw myVipResult.error;
      setTiers((tiersResult.data ?? []) as VipTierPublic[]);
      setMyVip(myVipResult.data as MyVip);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'طھط¹ط°ط± طھط­ظ…ظٹظ„ ط¯ط±ط¬ط§طھ VIP.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadVip();
  }, [loadVip]);

  const balance = profile?.balance_gold ?? 0;
  const activeTier = myVip?.active ? myVip.tier : null;
  const expiresAt = myVip?.expires_at ? new Date(myVip.expires_at) : null;

  const purchase = async (tier: VipTierPublic) => {
    if (busyTier) return;
    const kind = activeTier === tier.tier ? 'renewal' : activeTier !== null && tier.tier > activeTier ? 'upgrade' : 'initial';
    const priceLine = tier.offer_active
      ? `${tier.effective_price_coins.toLocaleString()} ظƒظˆظٹظ† (ط¨ط¯ظ„ ${tier.price_coins.toLocaleString()})`
      : `${tier.effective_price_coins.toLocaleString()} ظƒظˆظٹظ†`;
    const note =
      kind === 'renewal'
        ? 'ظٹط¨ط¯ط£ ط§ظ„طھط¬ط¯ظٹط¯ ظ…ظ† طھط§ط±ظٹط® ط§ظ†طھظ‡ط§ط، ط§ط´طھط±ط§ظƒظƒ ط§ظ„ط­ط§ظ„ظٹ.'
        : kind === 'upgrade'
          ? 'ط¹ظ†ط¯ ط§ظ„طھط±ظ‚ظٹط© طھظڈط®طµظ… ط§ظ„ظ‚ظٹظ…ط© ط§ظ„ظ…طھط¨ظ‚ظٹط© ظ…ظ† ط§ط´طھط±ط§ظƒظƒ ط§ظ„ط­ط§ظ„ظٹ ظ…ظ† ط§ظ„ط³ط¹ط± طھظ„ظ‚ط§ط¦ظٹظ‹ط§.'
          : '';
    Alert.alert(
      `ط´ط±ط§ط، ${tier.name_ar}`,
      `ط§ظ„ط³ط¹ط±: ${priceLine}\nط§ظ„ظ…ط¯ط©: ${tier.duration_days} ظٹظˆظ…ظ‹ط§.\n${note}`,
      [
        { text: 'ط¥ظ„ط؛ط§ط،', style: 'cancel' },
        {
          text: 'طھط£ظƒظٹط¯ ط§ظ„ط´ط±ط§ط،',
          style: 'default',
          onPress: () => void confirmPurchase(tier),
        },
      ],
    );
  };

  const confirmPurchase = async (tier: VipTierPublic) => {
    if (busyTier) return;
    setBusyTier(tier.tier);
    try {
      if (purchaseAttempt.current?.tier !== tier.tier) {
        purchaseAttempt.current = {
          tier: tier.tier,
          key: `vip-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`,
        };
      }
      const result = await callFunction<{ success?: boolean; error?: string; message?: string; subscription?: { purchase_kind: string } }>(
        'vip-purchase',
        { tier: tier.tier },
        purchaseAttempt.current.key,
      );
      if (!result?.success) {
        throw new Error(result?.message || 'طھط¹ط°ط± ط¥طھظ…ط§ظ… ط§ظ„ط´ط±ط§ط،.');
      }
      purchaseAttempt.current = null;
      await Promise.all([loadVip(), loadProfile()]);
      const kindAr = result.subscription?.purchase_kind === 'upgrade' ? 'ط§ظ„طھط±ظ‚ظٹط©' : result.subscription?.purchase_kind === 'renewal' ? 'ط§ظ„طھط¬ط¯ظٹط¯' : 'ط§ظ„ط´ط±ط§ط،';
      Alert.alert('طھظ… طھط£ظƒظٹط¯ ط§ظ„ط·ظ„ط¨', `${kindAr} ظ†ط§ط¬ط­ â€” طھظ… طھظپط¹ظٹظ„ ${tier.name_ar}.`);
    } catch (caught: unknown) {
      Alert.alert('طھط¹ط°ط± ط´ط±ط§ط، VIP', caught instanceof Error ? caught.message : 'ط­ط§ظˆظ„ ظ…ط±ط© ط£ط®ط±ظ‰.');
    } finally {
      setBusyTier(null);
    }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} accessibilityLabel="ط±ط¬ظˆط¹">
          <ArrowLeft size={20} color={palette.text} />
        </TouchableOpacity>
        <Text style={styles.title}>VIP</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}><Crown size={24} color={palette.gold} /></View>
          <Text style={styles.heroTitle}>ط¯ط±ط¬ط§طھ VIP</Text>
          <Text style={styles.heroCopy}>
            ط§ط´طھط±ظگ ط£ظٹ ط¯ط±ط¬ط© ظ…ط¨ط§ط´ط±ط© ط¯ظˆظ† ط§ظ„ظ…ط±ظˆط± ط¨ط§ظ„ط¯ط±ط¬ط§طھ ط§ظ„ط³ط§ط¨ظ‚ط©. ط§ظ„ط´ط±ط§ط، ط¨ظƒظˆظٹظ† ظ…ظ† ظ…ط­ظپط¸طھظƒ ظپظ‚ط· â€” ظ„ط§ ظٹظڈظ…ظ†ط­ VIP ط¨ط§ظ„ط´ط­ظ† ط§ظ„طھط±ط§ظƒظ…ظٹ ط£ظˆ ط§ظ„ظ†ط´ط§ط·.
          </Text>
        </View>

        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>ط±طµظٹط¯ Coin ط§ظ„ظ…طھط§ط­</Text>
          <Text style={styles.balance}>{balance.toLocaleString()}</Text>
        </View>

        {myVip?.active ? (
          <View style={styles.activeCard}>
            <View style={styles.activeHeading}>
              <Check size={18} color={palette.teal} />
              <Text style={styles.activeTitle}>ط§ط´طھط±ط§ظƒظƒ ط§ظ„ط­ط§ظ„ظٹ: {myVip.name_ar}</Text>
            </View>
            {expiresAt ? (
              <Text style={styles.expiryText}>
                ظٹظ†طھظ‡ظٹ ظپظٹ {expiresAt.toLocaleDateString('ar', { year: 'numeric', month: 'long', day: 'numeric' })}
                {' آ· '}ظ…طھط¨ظ‚ظچ {myVip.days_remaining} ظٹظˆظ…ظ‹ط§
              </Text>
            ) : null}
            {myVip.perks?.length ? (
              <View style={styles.perkWrap}>
                {myVip.perks.map((perk, index) => (
                  <View key={index} style={styles.perkRow}>
                    <Sparkles size={12} color={palette.teal} />
                    <Text style={styles.perkText}>{perk}</Text>
                  </View>
                ))}
              </View>
            ) : null}
            {myVip.room_kick_protection ? (
              <Text style={styles.protectionNote}>ط­ظ…ط§ظٹط© ظ…ظ† ط§ظ„ط·ط±ط¯ ظˆط§ظ„ط­ط¸ط± ط§ظ„ط¹ط§ط¯ظٹ ط¯ط§ط®ظ„ ط§ظ„ط؛ط±ظپ ظ…ظپط¹ظ‘ظ„ط©.</Text>
            ) : null}
          </View>
        ) : null}

        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity onPress={() => void loadVip()}><Text style={styles.retry}>ط¥ط¹ط§ط¯ط© ط§ظ„ظ…ط­ط§ظˆظ„ط©</Text></TouchableOpacity>
          </View>
        ) : null}

        <View style={styles.sectionHeading}>
          <Text style={styles.sectionTitle}>ط§ظ„ط¯ط±ط¬ط§طھ ط§ظ„ظ…طھط§ط­ط©</Text>
          <Text style={styles.sectionSubtitle}>ط§ظ„ط³ط¹ط± ظˆط§ظ„ظ…ط¯ط© ظˆط§ظ„ظ…ط²ط§ظٹط§ طھط­ط¯ط¯ظ‡ط§ ط¥ط¯ط§ط±ط© Wattar</Text>
        </View>

        {loading ? (
          <View style={styles.state}><ActivityIndicator color={palette.primary} /></View>
        ) : tiers.length === 0 && !error ? (
          <View style={styles.state}><Text style={styles.emptyText}>ظ„ط§ طھظˆط¬ط¯ ط¯ط±ط¬ط§طھ ظ…طھط§ط­ط© ط­ط§ظ„ظٹظ‹ط§.</Text></View>
        ) : (
          tiers.map((tier) => {
            const busy = busyTier === tier.tier;
            const isCurrent = activeTier === tier.tier;
            const canAfford = balance >= tier.effective_price_coins;
            const downgradeBlocked = activeTier !== null && tier.tier < activeTier;
            return (
              <View key={tier.tier} style={styles.planCard}>
                <View style={styles.planHeading}>
                  <View style={styles.planIcon}><Crown size={19} color={palette.gold} /></View>
                  <View style={styles.planCopy}>
                    <Text style={styles.planName}>{tier.name_ar}</Text>
                    <Text style={styles.planDuration}><Clock3 size={12} color={palette.muted} /> {tier.duration_days} ظٹظˆظ…ظ‹ط§ آ· ط¨ط¯ظˆظ† طھط¬ط¯ظٹط¯ طھظ„ظ‚ط§ط¦ظٹ</Text>
                  </View>
                  <View style={styles.priceWrap}>
                    {tier.offer_active ? (
                      <Text style={styles.priceOld}>{tier.price_coins.toLocaleString()}</Text>
                    ) : null}
                    <Text style={styles.price}>{tier.effective_price_coins.toLocaleString()} Coin</Text>
                  </View>
                </View>
                {tier.offer_active ? (
                  <View style={styles.offerNote}>
                    <Sparkles size={14} color={palette.gold} />
                    <Text style={styles.offerText}>ط¹ط±ط¶ ظ„ظپطھط±ط© ظ…ط­ط¯ظˆط¯ط© ط¨ط®طµظ… {tier.offer_discount_percent}%</Text>
                  </View>
                ) : null}
                {tier.perks?.length ? (
                  <View style={styles.perkWrap}>
                    {tier.perks.map((perk, index) => (
                      <View key={index} style={styles.perkRow}>
                        <Sparkles size={12} color={palette.muted} />
                        <Text style={styles.perkText}>{perk}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
                {tier.room_kick_protection ? (
                  <View style={styles.protectionRow}>
                    <Check size={13} color={palette.teal} />
                    <Text style={styles.protectionText}>ط­ظ…ط§ظٹط© ظ…ظ† ط§ظ„ط·ط±ط¯ ظˆط§ظ„ط­ط¸ط± ط§ظ„ط¹ط§ط¯ظٹ ظپظٹ ط§ظ„ط؛ط±ظپ</Text>
                  </View>
                ) : null}
                <TouchableOpacity
                  style={[styles.buyButton, (!canAfford || busyTier !== null || downgradeBlocked) && styles.buyDisabled]}
                  disabled={!canAfford || busyTier !== null || downgradeBlocked}
                  onPress={() => void purchase(tier)}
                  accessibilityRole="button"
                >
                  {busy ? <ActivityIndicator size="small" color={palette.background} /> : null}
                  <Text style={styles.buyText}>
                    {busy
                      ? 'ط¬ط§ط±ظچ ط¥طھظ…ط§ظ… ط§ظ„ط·ظ„ط¨...'
                      : downgradeBlocked
                        ? 'ظ„ط¯ظٹظƒ ط§ط´طھط±ط§ظƒ ط£ط¹ظ„ظ‰ ظ†ط´ط·'
                        : isCurrent
                          ? 'طھط¬ط¯ظٹط¯ â€” ظٹط¨ط¯ط£ ط¨ط¹ط¯ ط§ظ†طھظ‡ط§ط، ط§ظ„ط­ط§ظ„ظٹ'
                          : activeTier !== null && tier.tier > activeTier
                            ? 'طھط±ظ‚ظٹط© â€” ط§ظ„ظپط±ظ‚ ظٹظڈط­ط³ط¨ طھظ„ظ‚ط§ط¦ظٹظ‹ط§'
                            : canAfford
                              ? 'ط´ط±ط§ط، ط¨ط¹ظ…ظ„ط© Coin'
                              : 'ط±طµظٹط¯ Coin ط؛ظٹط± ظƒط§ظپظچ'}
                  </Text>
                </TouchableOpacity>
                {busyTier !== null && !busy ? (
                  <View style={styles.busyNote}><X size={12} color={palette.muted} /><Text style={styles.busyText}>ط§ظ†طھط¸ط± ط§ظ†طھظ‡ط§ط، ط§ظ„ط·ظ„ط¨ ط§ظ„ط¬ط§ط±ظٹ.</Text></View>
                ) : null}
              </View>
            );
          })
        )}
        <Text style={styles.disclaimer}>
          VIP ظ…ط¯ظپظˆط¹ ط­طµط±ط§ظ‹ ط¨ظƒظˆظٹظ† ظ…ظ† ظ…ط­ظپط¸طھظƒ ظˆظ„ط§ ظٹطھط¶ظ…ظ† ط£ظٹ ط¯ظپط¹ ط­ظ‚ظٹظ‚ظٹ ط¹ط¨ط± ظ…طھط¬ط± ط§ظ„طھط·ط¨ظٹظ‚ط§طھ. ط§ظ„ط¹ظ‚ظˆط¨ط§طھ ط§ظ„ط£ظ…ظ†ظٹط© ظˆظ‚ط±ط§ط±ط§طھ ط§ظ„ط¥ط¯ط§ط±ط© طھطھط¬ط§ظˆط² ط­ظ…ط§ظٹط© VIP.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 54, paddingBottom: 12 },
  backButton: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  title: { color: palette.text, fontSize: 21, fontFamily: fonts.bold },
  content: { paddingHorizontal: 16, paddingBottom: 36 },
  hero: { alignItems: 'center', padding: 21, borderRadius: 22, backgroundColor: palette.surface, borderWidth: 1, borderColor: colors.goldLine },
  heroIcon: { width: 52, height: 52, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.goldSoft },
  heroTitle: { color: palette.text, fontSize: 20, fontFamily: fonts.bold, marginTop: 13 },
  heroCopy: { color: palette.muted, fontSize: 12, lineHeight: 20, textAlign: 'center', marginTop: 8 },
  balanceCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, marginTop: 12, borderRadius: 16, backgroundColor: palette.elevated, borderWidth: 1, borderColor: palette.border },
  balanceLabel: { color: palette.muted, fontSize: 12 },
  balance: { color: palette.gold, fontSize: 18, fontFamily: fonts.bold },
  activeCard: { padding: 15, marginTop: 12, borderRadius: 16, backgroundColor: colors.tealSoft, borderWidth: 1, borderColor: colors.tealEdge },
  activeHeading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  activeTitle: { color: palette.teal, fontSize: 13, fontFamily: fonts.bold },
  expiryText: { color: palette.text, fontSize: 12, marginTop: 8, textAlign: 'right' },
  protectionNote: { color: palette.teal, fontSize: 11, marginTop: 6, textAlign: 'right' },
  sectionHeading: { marginTop: 22, marginBottom: 10 },
  sectionTitle: { color: palette.text, fontSize: 16, fontFamily: fonts.bold, textAlign: 'right' },
  sectionSubtitle: { color: palette.muted, fontSize: 11, marginTop: 4, textAlign: 'right' },
  planCard: { padding: 15, marginBottom: 11, borderRadius: 18, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  planHeading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  planIcon: { width: 39, height: 39, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.goldSoft },
  planCopy: { flex: 1 },
  planName: { color: palette.text, fontSize: 14, fontFamily: fonts.bold, textAlign: 'right' },
  planDuration: { flexDirection: 'row', color: palette.muted, fontSize: 10, marginTop: 5, textAlign: 'right' },
  priceWrap: { alignItems: 'flex-end' },
  price: { color: palette.gold, fontSize: 12, fontFamily: fonts.bold },
  priceOld: { color: palette.muted, fontSize: 10, textDecorationLine: 'line-through' },
  offerNote: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 13 },
  offerText: { color: palette.gold, fontSize: 10, flex: 1, textAlign: 'right' },
  perkWrap: { marginTop: 10, gap: 5 },
  perkRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  perkText: { color: palette.muted, fontSize: 11, flex: 1, textAlign: 'right' },
  protectionRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  protectionText: { color: palette.teal, fontSize: 10, flex: 1, textAlign: 'right' },
  busyNote: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 },
  busyText: { color: palette.muted, fontSize: 10 },
  buyButton: { minHeight: 43, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 14, borderRadius: 12, backgroundColor: palette.gold },
  buyDisabled: { opacity: 0.55 },
  buyText: { color: palette.background, fontSize: 12, fontFamily: fonts.bold },
  state: { alignItems: 'center', padding: 25 },
  emptyText: { color: palette.muted, fontSize: 12 },
  errorCard: { padding: 13, marginTop: 12, borderRadius: 14, backgroundColor: colors.dangerSoft },
  errorText: { color: palette.danger, fontSize: 12, textAlign: 'right' },
  retry: { color: palette.gold, marginTop: 8, textAlign: 'right' },
  disclaimer: { color: palette.muted, fontSize: 10, lineHeight: 17, textAlign: 'center', marginTop: 12, paddingHorizontal: 4 },
});
