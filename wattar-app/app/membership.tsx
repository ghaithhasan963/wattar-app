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
      setError(caught instanceof Error ? caught.message : 'تعذر تحميل درجات VIP.');
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
      ? `${tier.effective_price_coins.toLocaleString()} كوين (بدل ${tier.price_coins.toLocaleString()})`
      : `${tier.effective_price_coins.toLocaleString()} كوين`;
    const note =
      kind === 'renewal'
        ? 'يبدأ التجديد من تاريخ انتهاء اشتراكك الحالي.'
        : kind === 'upgrade'
          ? 'عند الترقية تُخصم القيمة المتبقية من اشتراكك الحالي من السعر تلقائيًا.'
          : '';
    Alert.alert(
      `شراء ${tier.name_ar}`,
      `السعر: ${priceLine}\nالمدة: ${tier.duration_days} يومًا.\n${note}`,
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'تأكيد الشراء',
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
        throw new Error(result?.message || 'تعذر إتمام الشراء.');
      }
      purchaseAttempt.current = null;
      await Promise.all([loadVip(), loadProfile()]);
      const kindAr = result.subscription?.purchase_kind === 'upgrade' ? 'الترقية' : result.subscription?.purchase_kind === 'renewal' ? 'التجديد' : 'الشراء';
      Alert.alert('تم تأكيد الطلب', `${kindAr} ناجح — تم تفعيل ${tier.name_ar}.`);
    } catch (caught: unknown) {
      Alert.alert('تعذر شراء VIP', caught instanceof Error ? caught.message : 'حاول مرة أخرى.');
    } finally {
      setBusyTier(null);
    }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} accessibilityLabel="رجوع">
          <ArrowLeft size={20} color={palette.text} />
        </TouchableOpacity>
        <Text style={styles.title}>VIP</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}><Crown size={24} color={palette.gold} /></View>
          <Text style={styles.heroTitle}>درجات VIP</Text>
          <Text style={styles.heroCopy}>
            اشترِ أي درجة مباشرة دون المرور بالدرجات السابقة. الشراء بكوين من محفظتك فقط — لا يُمنح VIP بالشحن التراكمي أو النشاط.
          </Text>
        </View>

        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>رصيد Coin المتاح</Text>
          <Text style={styles.balance}>{balance.toLocaleString()}</Text>
        </View>

        {myVip?.active ? (
          <View style={styles.activeCard}>
            <View style={styles.activeHeading}>
              <Check size={18} color={palette.teal} />
              <Text style={styles.activeTitle}>اشتراكك الحالي: {myVip.name_ar}</Text>
            </View>
            {expiresAt ? (
              <Text style={styles.expiryText}>
                ينتهي في {expiresAt.toLocaleDateString('ar', { year: 'numeric', month: 'long', day: 'numeric' })}
                {' · '}متبقٍ {myVip.days_remaining} يومًا
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
              <Text style={styles.protectionNote}>حماية من الطرد والحظر العادي داخل الغرف مفعّلة.</Text>
            ) : null}
          </View>
        ) : null}

        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity onPress={() => void loadVip()}><Text style={styles.retry}>إعادة المحاولة</Text></TouchableOpacity>
          </View>
        ) : null}

        <View style={styles.sectionHeading}>
          <Text style={styles.sectionTitle}>الدرجات المتاحة</Text>
          <Text style={styles.sectionSubtitle}>السعر والمدة والمزايا تحددها إدارة Wattar</Text>
        </View>

        {loading ? (
          <View style={styles.state}><ActivityIndicator color={palette.primary} /></View>
        ) : tiers.length === 0 && !error ? (
          <View style={styles.state}><Text style={styles.emptyText}>لا توجد درجات متاحة حاليًا.</Text></View>
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
                    <Text style={styles.planDuration}><Clock3 size={12} color={palette.muted} /> {tier.duration_days} يومًا · بدون تجديد تلقائي</Text>
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
                    <Text style={styles.offerText}>عرض لفترة محدودة بخصم {tier.offer_discount_percent}%</Text>
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
                    <Text style={styles.protectionText}>حماية من الطرد والحظر العادي في الغرف</Text>
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
                      ? 'جارٍ إتمام الطلب...'
                      : downgradeBlocked
                        ? 'لديك اشتراك أعلى نشط'
                        : isCurrent
                          ? 'تجديد — يبدأ بعد انتهاء الحالي'
                          : activeTier !== null && tier.tier > activeTier
                            ? 'ترقية — الفرق يُحسب تلقائيًا'
                            : canAfford
                              ? 'شراء بعملة Coin'
                              : 'رصيد Coin غير كافٍ'}
                  </Text>
                </TouchableOpacity>
                {busyTier !== null && !busy ? (
                  <View style={styles.busyNote}><X size={12} color={palette.muted} /><Text style={styles.busyText}>انتظر انتهاء الطلب الجاري.</Text></View>
                ) : null}
              </View>
            );
          })
        )}
        <Text style={styles.disclaimer}>
          VIP مدفوع حصراً بكوين من محفظتك ولا يتضمن أي دفع حقيقي عبر متجر التطبيقات. العقوبات الأمنية وقرارات الإدارة تتجاوز حماية VIP.
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
