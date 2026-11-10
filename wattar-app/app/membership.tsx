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
import { ArrowLeft, Check, Clock3, Crown, Sparkles } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';

interface MembershipPlan {
  id: string;
  name: string;
  name_ar: string;
  duration_days: number;
  price_coins: number;
  xp_boost: number;
}

interface MembershipPurchase {
  plan_name: string;
  plan_name_ar: string;
  expires_at: string;
}

const palette = {
  background: '#090611',
  surface: '#171128',
  elevated: '#211638',
  border: '#352449',
  text: '#F8F3FF',
  muted: '#B2A6C3',
  primary: '#B44BFF',
  gold: '#F4BD55',
  teal: '#72DCCA',
  danger: '#FF718E',
} as const;

export default function MembershipScreen() {
  const router = useRouter();
  const { profile, loadProfile } = useAuthStore();
  const [plans, setPlans] = useState<MembershipPlan[]>([]);
  const [membership, setMembership] = useState<MembershipPurchase | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const purchaseAttempt = useRef<{ planId: string; key: string } | null>(null);

  const loadMembership = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [plansResult, membershipResult] = await Promise.all([
        supabase
          .from('membership_plans')
          .select('id, name, name_ar, duration_days, price_coins, xp_boost')
          .eq('is_active', true)
          .order('price_coins'),
        supabase
          .from('membership_purchases')
          .select('plan_name, plan_name_ar, expires_at')
          .gt('expires_at', new Date().toISOString())
          .order('expires_at', { ascending: false })
          .limit(1),
      ]);
      if (plansResult.error) throw plansResult.error;
      if (membershipResult.error) throw membershipResult.error;
      setPlans((plansResult.data ?? []) as MembershipPlan[]);
      setMembership((membershipResult.data?.[0] ?? null) as MembershipPurchase | null);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'تعذر تحميل العضويات.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMembership();
  }, [loadMembership]);

  const purchase = async (plan: MembershipPlan) => {
    if (busyPlan) return;
    setBusyPlan(plan.id);
    try {
      if (purchaseAttempt.current?.planId !== plan.id) {
        purchaseAttempt.current = {
          planId: plan.id,
          key: `member-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        };
      }
      const { error: purchaseError } = await supabase.rpc('purchase_membership', {
        p_plan_id: plan.id,
        p_idempotency_key: purchaseAttempt.current.key,
      });
      if (purchaseError) throw purchaseError;
      purchaseAttempt.current = null;
      await Promise.all([loadMembership(), loadProfile()]);
      Alert.alert('تم تفعيل العضوية', 'العضوية غير متجددة تلقائيًا. يمكنك شراء مدة جديدة عند الرغبة.');
    } catch (caught: unknown) {
      Alert.alert('تعذر شراء العضوية', caught instanceof Error ? caught.message : 'حاول مرة أخرى.');
    } finally {
      setBusyPlan(null);
    }
  };

  const balance = profile?.balance_gold ?? 0;
  const expiresAt = membership ? new Date(membership.expires_at) : null;

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} accessibilityLabel="رجوع">
          <ArrowLeft size={20} color={palette.text} />
        </TouchableOpacity>
        <Text style={styles.title}>عضوية VIP</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}><Crown size={24} color={palette.gold} /></View>
          <Text style={styles.heroTitle}>عضوية باختيارك</Text>
          <Text style={styles.heroCopy}>
            اشترِ مدة محددة باستخدام Coins من محفظتك. العضوية لا تتجدد تلقائيًا ولا تتضمن دفعًا عبر متجر التطبيقات أو أموالًا حقيقية.
          </Text>
        </View>

        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>رصيد Coin المتاح</Text>
          <Text style={styles.balance}>{balance.toLocaleString()}</Text>
        </View>

        {membership ? (
          <View style={styles.activeCard}>
            <View style={styles.activeHeading}>
              <Check size={18} color={palette.teal} />
              <Text style={styles.activeTitle}>عضويتك الحالية: {membership.plan_name_ar || membership.plan_name}</Text>
            </View>
            {expiresAt ? (
              <Text style={styles.expiryText}>
                تنتهي في {expiresAt.toLocaleDateString('ar', { year: 'numeric', month: 'long', day: 'numeric' })}
              </Text>
            ) : null}
            <Text style={styles.renewText}>لا يوجد تجديد تلقائي؛ اشترِ مدة جديدة يدويًا عند رغبتك.</Text>
          </View>
        ) : null}

        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity onPress={() => void loadMembership()}><Text style={styles.retry}>إعادة المحاولة</Text></TouchableOpacity>
          </View>
        ) : null}

        <View style={styles.sectionHeading}>
          <Text style={styles.sectionTitle}>الخطط المتاحة</Text>
          <Text style={styles.sectionSubtitle}>المدة والسعر يحددهما فريق Wattar</Text>
        </View>

        {loading ? (
          <View style={styles.state}><ActivityIndicator color={palette.primary} /></View>
        ) : plans.length === 0 && !error ? (
          <View style={styles.state}><Text style={styles.emptyText}>لا توجد خطط متاحة حاليًا.</Text></View>
        ) : (
          plans.map((plan) => {
            const busy = busyPlan === plan.id;
            const canAfford = balance >= Number(plan.price_coins);
            return (
              <View key={plan.id} style={styles.planCard}>
                <View style={styles.planHeading}>
                  <View style={styles.planIcon}><Crown size={19} color={palette.gold} /></View>
                  <View style={styles.planCopy}>
                    <Text style={styles.planName}>{plan.name_ar || plan.name}</Text>
                    <Text style={styles.planDuration}><Clock3 size={12} color={palette.muted} /> {plan.duration_days} يومًا · بدون تجديد تلقائي</Text>
                  </View>
                  <Text style={styles.price}>{Number(plan.price_coins).toLocaleString()} Coin</Text>
                </View>
                {plan.xp_boost > 0 ? (
                  <View style={styles.xpNote}>
                    <Sparkles size={14} color={palette.teal} />
                    <Text style={styles.xpText}>دفعة تصل إلى {plan.xp_boost} XP، ضمن حد شهري أقصى 500 XP</Text>
                  </View>
                ) : null}
                <TouchableOpacity
                  style={[styles.buyButton, (!canAfford || busyPlan !== null) && styles.buyDisabled]}
                  disabled={!canAfford || busyPlan !== null}
                  onPress={() => void purchase(plan)}
                  accessibilityRole="button"
                >
                  {busy ? <ActivityIndicator size="small" color={palette.background} /> : null}
                  <Text style={styles.buyText}>{busy ? 'جارٍ إتمام الشراء...' : canAfford ? 'شراء بعملة Coin' : 'رصيد Coin غير كافٍ'}</Text>
                </TouchableOpacity>
              </View>
            );
          })
        )}
        <Text style={styles.disclaimer}>
          مستويات الحساب تُكتسب بالنشاط. شراء العضوية قد يمنح دفعة XP صغيرة ضمن الحدود الموضحة، ولا يشتري مستوى مباشرًا.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 54, paddingBottom: 12 },
  backButton: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  title: { color: palette.text, fontSize: 21, fontWeight: '800' },
  content: { paddingHorizontal: 16, paddingBottom: 36 },
  hero: { alignItems: 'center', padding: 21, borderRadius: 22, backgroundColor: palette.surface, borderWidth: 1, borderColor: '#684D27' },
  heroIcon: { width: 52, height: 52, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#382A14' },
  heroTitle: { color: palette.text, fontSize: 20, fontWeight: '800', marginTop: 13 },
  heroCopy: { color: palette.muted, fontSize: 12, lineHeight: 20, textAlign: 'center', marginTop: 8 },
  balanceCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, marginTop: 12, borderRadius: 16, backgroundColor: palette.elevated, borderWidth: 1, borderColor: palette.border },
  balanceLabel: { color: palette.muted, fontSize: 12 },
  balance: { color: palette.gold, fontSize: 18, fontWeight: '800' },
  activeCard: { padding: 15, marginTop: 12, borderRadius: 16, backgroundColor: '#11251F', borderWidth: 1, borderColor: '#2A6657' },
  activeHeading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  activeTitle: { color: palette.teal, fontSize: 13, fontWeight: '800' },
  expiryText: { color: palette.text, fontSize: 12, marginTop: 8, textAlign: 'right' },
  renewText: { color: palette.muted, fontSize: 11, marginTop: 5, textAlign: 'right' },
  sectionHeading: { marginTop: 22, marginBottom: 10 },
  sectionTitle: { color: palette.text, fontSize: 16, fontWeight: '800', textAlign: 'right' },
  sectionSubtitle: { color: palette.muted, fontSize: 11, marginTop: 4, textAlign: 'right' },
  planCard: { padding: 15, marginBottom: 11, borderRadius: 18, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  planHeading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  planIcon: { width: 39, height: 39, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#382A14' },
  planCopy: { flex: 1 },
  planName: { color: palette.text, fontSize: 14, fontWeight: '800', textAlign: 'right' },
  planDuration: { flexDirection: 'row', color: palette.muted, fontSize: 10, marginTop: 5, textAlign: 'right' },
  price: { color: palette.gold, fontSize: 12, fontWeight: '800' },
  xpNote: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 13 },
  xpText: { color: palette.teal, fontSize: 10, flex: 1, textAlign: 'right' },
  buyButton: { minHeight: 43, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 14, borderRadius: 12, backgroundColor: palette.gold },
  buyDisabled: { opacity: 0.55 },
  buyText: { color: palette.background, fontSize: 12, fontWeight: '800' },
  state: { alignItems: 'center', padding: 25 },
  emptyText: { color: palette.muted, fontSize: 12 },
  errorCard: { padding: 13, marginTop: 12, borderRadius: 14, backgroundColor: '#311622' },
  errorText: { color: palette.danger, fontSize: 12, textAlign: 'right' },
  retry: { color: palette.gold, marginTop: 8, textAlign: 'right' },
  disclaimer: { color: palette.muted, fontSize: 10, lineHeight: 17, textAlign: 'center', marginTop: 12, paddingHorizontal: 4 },
});
