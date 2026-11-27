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
import { ArrowLeft, Check, ShieldCheck, X } from 'lucide-react-native';
import { supabase, callFunction } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';

interface ProtectionProductPublic {
  id: string;
  kind: 'anti_kick' | 'anti_ban';
  mode: 'permanent' | 'subscription' | 'bundle';
  name_ar: string;
  price_coins: number;
  duration_days: number | null;
}

interface MyProtection {
  kind: 'anti_kick' | 'anti_ban';
  name_ar: string;
  permanent: boolean;
  expires_at: string | null;
  active: boolean;
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

const kindLabels: Record<string, string> = {
  anti_kick: 'مانع الطرد',
  anti_ban: 'مانع الحظر',
};

const kindDescriptions: Record<string, string> = {
  anti_kick: 'يمنع إدارة الغرفة (المالك والمشرفون) من طردك من الغرفة.',
  anti_ban: 'يمنع إدارة الغرفة (المالك والمشرفون) من حظرك من الغرفة.',
};

export default function ProtectionScreen() {
  const router = useRouter();
  const { profile, loadProfile } = useAuthStore();
  const [products, setProducts] = useState<ProtectionProductPublic[]>([]);
  const [myProtections, setMyProtections] = useState<MyProtection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const purchaseAttempt = useRef<{ productId: string; key: string } | null>(null);

  const loadProtections = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [productsResult, myResult] = await Promise.all([
        supabase.rpc('get_public_protection_products'),
        supabase.rpc('get_my_protections'),
      ]);
      if (productsResult.error) throw productsResult.error;
      if (myResult.error) throw myResult.error;
      setProducts((productsResult.data ?? []) as ProtectionProductPublic[]);
      setMyProtections((myResult.data ?? []) as MyProtection[]);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'تعذر تحميل منتجات الحماية.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProtections();
  }, [loadProtections]);

  const balance = profile?.balance_gold ?? 0;
  const activeByKind: Record<string, MyProtection | undefined> = {};
  for (const p of myProtections) activeByKind[p.kind] = p;

  const purchase = async (product: ProtectionProductPublic) => {
    if (busyId) return;
    const current = activeByKind[product.kind];
    const permanent = product.mode === 'permanent';
    const stacking = current && product.mode !== 'permanent' && (current.expires_at !== null || current.permanent);
    const note = permanent
      ? current?.permanent
        ? 'لديك حماية دائمة من هذا النوع بالفعل.'
        : 'حماية دائمة — بلا تاريخ انتهاء.'
      : stacking
        ? 'ستُمدد مدة حمايتك الحالية من تاريخ انتهائها.'
        : 'حماية لفترة محدودة تبدأ من الآن.';
    Alert.alert(
      `شراء ${product.name_ar}`,
      `السعر: ${product.price_coins.toLocaleString()} كوين.\n${note}`,
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'تأكيد الشراء',
          style: 'default',
          onPress: () => void confirmPurchase(product),
        },
      ],
    );
  };

  const confirmPurchase = async (product: ProtectionProductPublic) => {
    if (busyId) return;
    setBusyId(product.id);
    try {
      if (purchaseAttempt.current?.productId !== product.id) {
        purchaseAttempt.current = {
          productId: product.id,
          key: `prot-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`,
        };
      }
      const result = await callFunction<{ success?: boolean; error?: string; message?: string }>(
        'protection-purchase',
        { product_id: product.id },
        purchaseAttempt.current.key,
      );
      if (!result?.success) {
        throw new Error(result?.message || 'تعذر إتمام الشراء.');
      }
      purchaseAttempt.current = null;
      await Promise.all([loadProtections(), loadProfile()]);
      Alert.alert('تم تأكيد الطلب', `تم تفعيل ${product.name_ar}.`);
    } catch (caught: unknown) {
      Alert.alert('تعذر شراء الحماية', caught instanceof Error ? caught.message : 'حاول مرة أخرى.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} accessibilityLabel="رجوع">
          <ArrowLeft size={20} color={palette.text} />
        </TouchableOpacity>
        <Text style={styles.title}>حمايات الغرف</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}><ShieldCheck size={24} color={palette.teal} /></View>
          <Text style={styles.heroTitle}>أدوات الحماية المدفوعة</Text>
          <Text style={styles.heroCopy}>
            مانع الطرد ومانع الحظر — دائم أو اشتراك أو باقة، تُشترى بكوين من محفظتك فقط. تمنع إدارة الغرفة (المالك والمشرفين) فقط؛ لا تنفع ضد قرار الإدارة والمخالفات الجسيمة.
          </Text>
        </View>

        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>رصيد Coin المتاح</Text>
          <Text style={styles.balance}>{balance.toLocaleString()}</Text>
        </View>

        {myProtections.length > 0 ? (
          <View style={styles.activeCard}>
            {myProtections.map((p, index) => (
              <View key={p.kind} style={index > 0 ? styles.activeRow : undefined}>
                <Check size={16} color={p.active ? palette.teal : palette.muted} />
                <Text style={styles.activeTitle}>
                  {kindLabels[p.kind] ?? p.kind} —{' '}
                  {p.active
                    ? p.permanent
                      ? 'دائم'
                      : `ينتهي في ${new Date(p.expires_at as string).toLocaleDateString('ar', { year: 'numeric', month: 'long', day: 'numeric' })}`
                    : 'منتهي'}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity onPress={() => void loadProtections()}><Text style={styles.retry}>إعادة المحاولة</Text></TouchableOpacity>
          </View>
        ) : null}

        <View style={styles.sectionHeading}>
          <Text style={styles.sectionTitle}>المنتجات المتاحة</Text>
          <Text style={styles.sectionSubtitle}>الأسعار تحددها إدارة Wattar</Text>
        </View>

        {loading ? (
          <View style={styles.state}><ActivityIndicator color={palette.primary} /></View>
        ) : products.length === 0 && !error ? (
          <View style={styles.state}><Text style={styles.emptyText}>لا توجد منتجات متاحة حاليًا.</Text></View>
        ) : (
          products.map((product) => {
            const busy = busyId === product.id;
            const canAfford = balance >= product.price_coins;
            const current = activeByKind[product.kind];
            const alreadyPermanent = product.mode === 'permanent' && current?.permanent;
            return (
              <View key={product.id} style={styles.planCard}>
                <View style={styles.planHeading}>
                  <View style={styles.planIcon}><ShieldCheck size={18} color={palette.teal} /></View>
                  <View style={styles.planCopy}>
                    <Text style={styles.planName}>{product.name_ar}</Text>
                    <Text style={styles.planDuration}>
                      {product.mode === 'permanent'
                        ? 'دائم — بلا تاريخ انتهاء'
                        : `${product.duration_days} يومًا · تُمدد من تاريخ الانتهاء`}
                    </Text>
                  </View>
                  <Text style={styles.price}>{product.price_coins.toLocaleString()} Coin</Text>
                </View>
                <Text style={styles.kindDesc}>{kindDescriptions[product.kind] ?? ''}</Text>
                <TouchableOpacity
                  style={[styles.buyButton, (!canAfford || busyId !== null || alreadyPermanent) && styles.buyDisabled]}
                  disabled={!canAfford || busyId !== null || alreadyPermanent}
                  onPress={() => void purchase(product)}
                  accessibilityRole="button"
                >
                  {busy ? <ActivityIndicator size="small" color={palette.background} /> : null}
                  <Text style={styles.buyText}>
                    {busy
                      ? 'جارٍ إتمام الطلب...'
                      : alreadyPermanent
                        ? 'لديك حماية دائمة من هذا النوع'
                        : canAfford
                          ? 'شراء بعملة Coin'
                          : 'رصيد Coin غير كافٍ'}
                  </Text>
                </TouchableOpacity>
                {busyId !== null && !busy ? (
                  <View style={styles.busyNote}><X size={12} color={palette.muted} /><Text style={styles.busyText}>انتظر انتهاء الطلب الجاري.</Text></View>
                ) : null}
              </View>
            );
          })
        )}
        <Text style={styles.disclaimer}>
          الحمايات تُشترى حصراً بكوين من محفظتك ولا تتضمن أي دفع حقيقي عبر متجر التطبيقات. قرار الإدارة والمخالفات الجسيمة يتجاوز كل الحمايات.
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
  hero: { alignItems: 'center', padding: 21, borderRadius: 22, backgroundColor: palette.surface, borderWidth: 1, borderColor: '#1E5148' },
  heroIcon: { width: 52, height: 52, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#11251F' },
  heroTitle: { color: palette.text, fontSize: 20, fontWeight: '800', marginTop: 13 },
  heroCopy: { color: palette.muted, fontSize: 12, lineHeight: 20, textAlign: 'center', marginTop: 8 },
  balanceCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, marginTop: 12, borderRadius: 16, backgroundColor: palette.elevated, borderWidth: 1, borderColor: palette.border },
  balanceLabel: { color: palette.muted, fontSize: 12 },
  balance: { color: palette.gold, fontSize: 18, fontWeight: '800' },
  activeCard: { padding: 14, marginTop: 12, borderRadius: 16, backgroundColor: '#11251F', borderWidth: 1, borderColor: '#2A6657', gap: 8 },
  activeRow: { marginTop: 8 },
  activeTitle: { color: palette.teal, fontSize: 13, fontWeight: '700', flex: 1, textAlign: 'right' },
  sectionHeading: { marginTop: 22, marginBottom: 10 },
  sectionTitle: { color: palette.text, fontSize: 16, fontWeight: '800', textAlign: 'right' },
  sectionSubtitle: { color: palette.muted, fontSize: 11, marginTop: 4, textAlign: 'right' },
  planCard: { padding: 15, marginBottom: 11, borderRadius: 18, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  planHeading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  planIcon: { width: 39, height: 39, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#11251F' },
  planCopy: { flex: 1 },
  planName: { color: palette.text, fontSize: 14, fontWeight: '800', textAlign: 'right' },
  planDuration: { color: palette.muted, fontSize: 10, marginTop: 5, textAlign: 'right' },
  kindDesc: { color: palette.muted, fontSize: 11, lineHeight: 18, marginTop: 10, textAlign: 'right' },
  price: { color: palette.gold, fontSize: 12, fontWeight: '800' },
  buyButton: { minHeight: 43, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 14, borderRadius: 12, backgroundColor: palette.teal },
  buyDisabled: { opacity: 0.55 },
  buyText: { color: palette.background, fontSize: 12, fontWeight: '800' },
  busyNote: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 },
  busyText: { color: palette.muted, fontSize: 10 },
  state: { alignItems: 'center', padding: 25 },
  emptyText: { color: palette.muted, fontSize: 12 },
  errorCard: { padding: 13, marginTop: 12, borderRadius: 14, backgroundColor: '#311622' },
  errorText: { color: palette.danger, fontSize: 12, textAlign: 'right' },
  retry: { color: palette.gold, marginTop: 8, textAlign: 'right' },
  disclaimer: { color: palette.muted, fontSize: 10, lineHeight: 17, textAlign: 'center', marginTop: 12, paddingHorizontal: 4 },
});
