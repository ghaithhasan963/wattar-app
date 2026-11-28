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
import { colors, fonts } from '@/lib/theme';

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

const kindLabels: Record<string, string> = {
  anti_kick: 'ظ…ط§ظ†ط¹ ط§ظ„ط·ط±ط¯',
  anti_ban: 'ظ…ط§ظ†ط¹ ط§ظ„ط­ط¸ط±',
};

const kindDescriptions: Record<string, string> = {
  anti_kick: 'ظٹظ…ظ†ط¹ ط¥ط¯ط§ط±ط© ط§ظ„ط؛ط±ظپط© (ط§ظ„ظ…ط§ظ„ظƒ ظˆط§ظ„ظ…ط´ط±ظپظˆظ†) ظ…ظ† ط·ط±ط¯ظƒ ظ…ظ† ط§ظ„ط؛ط±ظپط©.',
  anti_ban: 'ظٹظ…ظ†ط¹ ط¥ط¯ط§ط±ط© ط§ظ„ط؛ط±ظپط© (ط§ظ„ظ…ط§ظ„ظƒ ظˆط§ظ„ظ…ط´ط±ظپظˆظ†) ظ…ظ† ط­ط¸ط±ظƒ ظ…ظ† ط§ظ„ط؛ط±ظپط©.',
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
      setError(caught instanceof Error ? caught.message : 'طھط¹ط°ط± طھط­ظ…ظٹظ„ ظ…ظ†طھط¬ط§طھ ط§ظ„ط­ظ…ط§ظٹط©.');
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
        ? 'ظ„ط¯ظٹظƒ ط­ظ…ط§ظٹط© ط¯ط§ط¦ظ…ط© ظ…ظ† ظ‡ط°ط§ ط§ظ„ظ†ظˆط¹ ط¨ط§ظ„ظپط¹ظ„.'
        : 'ط­ظ…ط§ظٹط© ط¯ط§ط¦ظ…ط© â€” ط¨ظ„ط§ طھط§ط±ظٹط® ط§ظ†طھظ‡ط§ط،.'
      : stacking
        ? 'ط³طھظڈظ…ط¯ط¯ ظ…ط¯ط© ط­ظ…ط§ظٹطھظƒ ط§ظ„ط­ط§ظ„ظٹط© ظ…ظ† طھط§ط±ظٹط® ط§ظ†طھظ‡ط§ط¦ظ‡ط§.'
        : 'ط­ظ…ط§ظٹط© ظ„ظپطھط±ط© ظ…ط­ط¯ظˆط¯ط© طھط¨ط¯ط£ ظ…ظ† ط§ظ„ط¢ظ†.';
    Alert.alert(
      `ط´ط±ط§ط، ${product.name_ar}`,
      `ط§ظ„ط³ط¹ط±: ${product.price_coins.toLocaleString()} ظƒظˆظٹظ†.\n${note}`,
      [
        { text: 'ط¥ظ„ط؛ط§ط،', style: 'cancel' },
        {
          text: 'طھط£ظƒظٹط¯ ط§ظ„ط´ط±ط§ط،',
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
        throw new Error(result?.message || 'طھط¹ط°ط± ط¥طھظ…ط§ظ… ط§ظ„ط´ط±ط§ط،.');
      }
      purchaseAttempt.current = null;
      await Promise.all([loadProtections(), loadProfile()]);
      Alert.alert('طھظ… طھط£ظƒظٹط¯ ط§ظ„ط·ظ„ط¨', `طھظ… طھظپط¹ظٹظ„ ${product.name_ar}.`);
    } catch (caught: unknown) {
      Alert.alert('طھط¹ط°ط± ط´ط±ط§ط، ط§ظ„ط­ظ…ط§ظٹط©', caught instanceof Error ? caught.message : 'ط­ط§ظˆظ„ ظ…ط±ط© ط£ط®ط±ظ‰.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} accessibilityLabel="ط±ط¬ظˆط¹">
          <ArrowLeft size={20} color={palette.text} />
        </TouchableOpacity>
        <Text style={styles.title}>ط­ظ…ط§ظٹط§طھ ط§ظ„ط؛ط±ظپ</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}><ShieldCheck size={24} color={palette.teal} /></View>
          <Text style={styles.heroTitle}>ط£ط¯ظˆط§طھ ط§ظ„ط­ظ…ط§ظٹط© ط§ظ„ظ…ط¯ظپظˆط¹ط©</Text>
          <Text style={styles.heroCopy}>
            ظ…ط§ظ†ط¹ ط§ظ„ط·ط±ط¯ ظˆظ…ط§ظ†ط¹ ط§ظ„ط­ط¸ط± â€” ط¯ط§ط¦ظ… ط£ظˆ ط§ط´طھط±ط§ظƒ ط£ظˆ ط¨ط§ظ‚ط©طŒ طھظڈط´طھط±ظ‰ ط¨ظƒظˆظٹظ† ظ…ظ† ظ…ط­ظپط¸طھظƒ ظپظ‚ط·. طھظ…ظ†ط¹ ط¥ط¯ط§ط±ط© ط§ظ„ط؛ط±ظپط© (ط§ظ„ظ…ط§ظ„ظƒ ظˆط§ظ„ظ…ط´ط±ظپظٹظ†) ظپظ‚ط·ط› ظ„ط§ طھظ†ظپط¹ ط¶ط¯ ظ‚ط±ط§ط± ط§ظ„ط¥ط¯ط§ط±ط© ظˆط§ظ„ظ…ط®ط§ظ„ظپط§طھ ط§ظ„ط¬ط³ظٹظ…ط©.
          </Text>
        </View>

        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>ط±طµظٹط¯ Coin ط§ظ„ظ…طھط§ط­</Text>
          <Text style={styles.balance}>{balance.toLocaleString()}</Text>
        </View>

        {myProtections.length > 0 ? (
          <View style={styles.activeCard}>
            {myProtections.map((p, index) => (
              <View key={p.kind} style={index > 0 ? styles.activeRow : undefined}>
                <Check size={16} color={p.active ? palette.teal : palette.muted} />
                <Text style={styles.activeTitle}>
                  {kindLabels[p.kind] ?? p.kind} â€”{' '}
                  {p.active
                    ? p.permanent
                      ? 'ط¯ط§ط¦ظ…'
                      : `ظٹظ†طھظ‡ظٹ ظپظٹ ${new Date(p.expires_at as string).toLocaleDateString('ar', { year: 'numeric', month: 'long', day: 'numeric' })}`
                    : 'ظ…ظ†طھظ‡ظٹ'}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity onPress={() => void loadProtections()}><Text style={styles.retry}>ط¥ط¹ط§ط¯ط© ط§ظ„ظ…ط­ط§ظˆظ„ط©</Text></TouchableOpacity>
          </View>
        ) : null}

        <View style={styles.sectionHeading}>
          <Text style={styles.sectionTitle}>ط§ظ„ظ…ظ†طھط¬ط§طھ ط§ظ„ظ…طھط§ط­ط©</Text>
          <Text style={styles.sectionSubtitle}>ط§ظ„ط£ط³ط¹ط§ط± طھط­ط¯ط¯ظ‡ط§ ط¥ط¯ط§ط±ط© Wattar</Text>
        </View>

        {loading ? (
          <View style={styles.state}><ActivityIndicator color={palette.primary} /></View>
        ) : products.length === 0 && !error ? (
          <View style={styles.state}><Text style={styles.emptyText}>ظ„ط§ طھظˆط¬ط¯ ظ…ظ†طھط¬ط§طھ ظ…طھط§ط­ط© ط­ط§ظ„ظٹظ‹ط§.</Text></View>
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
                        ? 'ط¯ط§ط¦ظ… â€” ط¨ظ„ط§ طھط§ط±ظٹط® ط§ظ†طھظ‡ط§ط،'
                        : `${product.duration_days} ظٹظˆظ…ظ‹ط§ آ· طھظڈظ…ط¯ط¯ ظ…ظ† طھط§ط±ظٹط® ط§ظ„ط§ظ†طھظ‡ط§ط،`}
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
                      ? 'ط¬ط§ط±ظچ ط¥طھظ…ط§ظ… ط§ظ„ط·ظ„ط¨...'
                      : alreadyPermanent
                        ? 'ظ„ط¯ظٹظƒ ط­ظ…ط§ظٹط© ط¯ط§ط¦ظ…ط© ظ…ظ† ظ‡ط°ط§ ط§ظ„ظ†ظˆط¹'
                        : canAfford
                          ? 'ط´ط±ط§ط، ط¨ط¹ظ…ظ„ط© Coin'
                          : 'ط±طµظٹط¯ Coin ط؛ظٹط± ظƒط§ظپظچ'}
                  </Text>
                </TouchableOpacity>
                {busyId !== null && !busy ? (
                  <View style={styles.busyNote}><X size={12} color={palette.muted} /><Text style={styles.busyText}>ط§ظ†طھط¸ط± ط§ظ†طھظ‡ط§ط، ط§ظ„ط·ظ„ط¨ ط§ظ„ط¬ط§ط±ظٹ.</Text></View>
                ) : null}
              </View>
            );
          })
        )}
        <Text style={styles.disclaimer}>
          ط§ظ„ط­ظ…ط§ظٹط§طھ طھظڈط´طھط±ظ‰ ط­طµط±ط§ظ‹ ط¨ظƒظˆظٹظ† ظ…ظ† ظ…ط­ظپط¸طھظƒ ظˆظ„ط§ طھطھط¶ظ…ظ† ط£ظٹ ط¯ظپط¹ ط­ظ‚ظٹظ‚ظٹ ط¹ط¨ط± ظ…طھط¬ط± ط§ظ„طھط·ط¨ظٹظ‚ط§طھ. ظ‚ط±ط§ط± ط§ظ„ط¥ط¯ط§ط±ط© ظˆط§ظ„ظ…ط®ط§ظ„ظپط§طھ ط§ظ„ط¬ط³ظٹظ…ط© ظٹطھط¬ط§ظˆط² ظƒظ„ ط§ظ„ط­ظ…ط§ظٹط§طھ.
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
  hero: { alignItems: 'center', padding: 21, borderRadius: 22, backgroundColor: palette.surface, borderWidth: 1, borderColor: colors.tealEdge },
  heroIcon: { width: 52, height: 52, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.tealSoft },
  heroTitle: { color: palette.text, fontSize: 20, fontFamily: fonts.bold, marginTop: 13 },
  heroCopy: { color: palette.muted, fontSize: 12, lineHeight: 20, textAlign: 'center', marginTop: 8 },
  balanceCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, marginTop: 12, borderRadius: 16, backgroundColor: palette.elevated, borderWidth: 1, borderColor: palette.border },
  balanceLabel: { color: palette.muted, fontSize: 12 },
  balance: { color: palette.gold, fontSize: 18, fontFamily: fonts.bold },
  activeCard: { padding: 14, marginTop: 12, borderRadius: 16, backgroundColor: colors.tealSoft, borderWidth: 1, borderColor: colors.tealEdge, gap: 8 },
  activeRow: { marginTop: 8 },
  activeTitle: { color: palette.teal, fontSize: 13, fontFamily: fonts.semibold, flex: 1, textAlign: 'right' },
  sectionHeading: { marginTop: 22, marginBottom: 10 },
  sectionTitle: { color: palette.text, fontSize: 16, fontFamily: fonts.bold, textAlign: 'right' },
  sectionSubtitle: { color: palette.muted, fontSize: 11, marginTop: 4, textAlign: 'right' },
  planCard: { padding: 15, marginBottom: 11, borderRadius: 18, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  planHeading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  planIcon: { width: 39, height: 39, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.tealSoft },
  planCopy: { flex: 1 },
  planName: { color: palette.text, fontSize: 14, fontFamily: fonts.bold, textAlign: 'right' },
  planDuration: { color: palette.muted, fontSize: 10, marginTop: 5, textAlign: 'right' },
  kindDesc: { color: palette.muted, fontSize: 11, lineHeight: 18, marginTop: 10, textAlign: 'right' },
  price: { color: palette.gold, fontSize: 12, fontFamily: fonts.bold },
  buyButton: { minHeight: 43, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 14, borderRadius: 12, backgroundColor: palette.teal },
  buyDisabled: { opacity: 0.55 },
  buyText: { color: palette.background, fontSize: 12, fontFamily: fonts.bold },
  busyNote: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 },
  busyText: { color: palette.muted, fontSize: 10 },
  state: { alignItems: 'center', padding: 25 },
  emptyText: { color: palette.muted, fontSize: 12 },
  errorCard: { padding: 13, marginTop: 12, borderRadius: 14, backgroundColor: colors.dangerSoft },
  errorText: { color: palette.danger, fontSize: 12, textAlign: 'right' },
  retry: { color: palette.gold, marginTop: 8, textAlign: 'right' },
  disclaimer: { color: palette.muted, fontSize: 10, lineHeight: 17, textAlign: 'center', marginTop: 12, paddingHorizontal: 4 },
});
