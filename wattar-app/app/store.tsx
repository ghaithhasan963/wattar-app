import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { ArrowLeft, Coins, Gift } from 'lucide-react-native';
import { callFunction, supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { colors } from '@/lib/theme';
import { CurrencyIcon } from '@/components/CurrencyIcon';

interface GiftItem {
  id: string;
  name: string;
  name_ar: string | null;
  icon_url: string;
  icon_emoji: string;
  price_gold: number;
  recipient_diamond_ratio: number;
  category: string | null;
  is_premium: boolean;
}

interface FollowedUser {
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
}

export default function StoreScreen() {
  const router = useRouter();
  const { profile, loadProfile } = useAuthStore();
  const [gifts, setGifts] = useState<GiftItem[]>([]);
  const [following, setFollowing] = useState<FollowedUser[]>([]);
  const [selectedGift, setSelectedGift] = useState<GiftItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyUser, setBusyUser] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sendAttempt = useRef<{ fingerprint: string; key: string } | null>(null);

  const loadStore = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [giftsResult, followingResult] = await Promise.all([
        supabase
          .from('gifts')
          .select('id, name, name_ar, icon_url, icon_emoji, price_gold, recipient_diamond_ratio, category, is_premium')
          .eq('is_active', true)
          .order('sort_order'),
        supabase.rpc('list_my_following'),
      ]);
      if (giftsResult.error) throw giftsResult.error;
      if (followingResult.error) throw followingResult.error;
      setGifts((giftsResult.data ?? []) as GiftItem[]);
      setFollowing((followingResult.data ?? []) as FollowedUser[]);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'تعذر تحميل المتجر.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStore();
  }, [loadStore]);

  const balance = profile?.balance_gold ?? 0;

  const sendGift = async (recipient: FollowedUser) => {
    if (!selectedGift || busyUser) return;
    setBusyUser(recipient.user_id);
    try {
      const fingerprint = `${recipient.user_id}:${selectedGift.id}:gold`;
      if (sendAttempt.current?.fingerprint !== fingerprint) {
        sendAttempt.current = {
          fingerprint,
          key: `gift-store-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`,
        };
      }
      const idempotencyKey = sendAttempt.current.key;
      await callFunction('gift-send', {
        to_user_id: recipient.user_id,
        gift_id: selectedGift.id,
        quantity: 1,
        funding_currency: 'gold',
      }, idempotencyKey);
      sendAttempt.current = null;
      const sentGiftName = selectedGift.name_ar || selectedGift.name;
      setSelectedGift(null);
      try {
        await loadProfile();
        Alert.alert('وصلت الهدية', `تم إرسال ${sentGiftName} بنجاح.`);
      } catch (refreshError: unknown) {
        console.warn('[Wattar] Gift sent but wallet refresh failed:', refreshError);
        Alert.alert('تم إرسال الهدية', 'أُرسلت الهدية، لكن تعذر تحديث الأرصدة الآن. اسحب الشاشة للتحديث.');
      }
    } catch (caught: unknown) {
      Alert.alert('تعذر إرسال الهدية', caught instanceof Error ? caught.message : 'حاول مرة أخرى.');
    } finally {
      setBusyUser(null);
    }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} accessibilityLabel="رجوع">
          <ArrowLeft size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>متجر الهدايا</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}><Gift size={22} color={colors.gold} /></View>
          <Text style={styles.heroTitle}>اختَر هدية وشاركها</Text>
          <Text style={styles.heroCopy}>ادفع Coins عند الإرسال فقط. الهدايا تُسوّى بأمان، ولا يوجد تحويل بين عملة اللعب ورصيد Coin.</Text>
        </View>

        <View style={styles.walletCard}>
          <View style={styles.walletHeader}>
            <View style={styles.currencyCopy}>
              <Text style={styles.walletTitle}>رصيد Coin</Text>
              <Text style={styles.currencyBalance}>{balance.toLocaleString()}</Text>
            </View>
            <CurrencyIcon currency="coin" size={40} />
          </View>
          <Text style={styles.walletNote}>Coin للشحن والهدايا والخدمات داخل Wattar، ولا تُسحب نقدًا ولا تتحول إلى Point.</Text>
        </View>

        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity onPress={() => void loadStore()}><Text style={styles.retry}>إعادة المحاولة</Text></TouchableOpacity>
          </View>
        ) : null}

        <View style={styles.sectionHeading}>
          <Text style={styles.sectionTitle}>الهدايا المتاحة</Text>
          <Text style={styles.sectionSubtitle}>الأسعار بوحدة Coins لكل هدية</Text>
        </View>

        {loading ? (
          <View style={styles.state}><ActivityIndicator color={colors.primary} /></View>
        ) : gifts.length === 0 && !error ? (
          <View style={styles.state}><Text style={styles.emptyTitle}>لا توجد هدايا نشطة الآن</Text></View>
        ) : (
          <View style={styles.giftGrid}>
            {gifts.map((gift) => {
              const canAfford = balance >= Number(gift.price_gold);
              const remoteIcon = gift.icon_url.startsWith('https://') ? gift.icon_url : null;
              return (
                <View key={gift.id} style={styles.giftCard}>
                  <View style={styles.giftArt}>
                    {remoteIcon ? (
                      <Image source={{ uri: remoteIcon }} style={styles.giftImage} resizeMode="contain" />
                    ) : (
                      <Text style={styles.giftEmoji}>{gift.icon_emoji}</Text>
                    )}
                  </View>
                  {gift.is_premium ? <Text style={styles.premiumBadge}>مميزة</Text> : null}
                  <Text style={styles.giftName} numberOfLines={1}>{gift.name_ar || gift.name}</Text>
                  <View style={styles.priceLine}>
                    <Coins size={13} color={colors.gold} />
                    <Text style={styles.giftPrice}>{Number(gift.price_gold).toLocaleString()}</Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.sendButton, !canAfford && styles.sendDisabled]}
                    disabled={!canAfford}
                    onPress={() => setSelectedGift(gift)}
                  >
                    <Text style={styles.sendButtonText}>{canAfford ? 'إرسال هدية' : 'الرصيد غير كافٍ'}</Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      <Modal visible={selectedGift !== null} transparent animationType="slide" onRequestClose={() => setSelectedGift(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>إلى من ترسل الهدية؟</Text>
              <TouchableOpacity onPress={() => setSelectedGift(null)}><Text style={styles.cancel}>إلغاء</Text></TouchableOpacity>
            </View>
            <Text style={styles.modalSubtitle}>
              {selectedGift ? `${selectedGift.name_ar || selectedGift.name} · ${Number(selectedGift.price_gold).toLocaleString()} Coins` : ''}
            </Text>
            {following.length === 0 ? (
              <View style={styles.noFollowing}>
                <Text style={styles.emptyTitle}>تابع أشخاصًا أولًا لإرسال هدية من المتجر.</Text>
                <TouchableOpacity style={styles.communityButton} onPress={() => { setSelectedGift(null); router.push('/(tabs)/friends'); }}>
                  <Text style={styles.communityButtonText}>اكتشاف المجتمع</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <FlatList
                data={following}
                keyExtractor={(item) => item.user_id}
                style={styles.recipientList}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.recipient}
                    onPress={() => void sendGift(item)}
                    disabled={busyUser !== null}
                  >
                    <View style={styles.recipientAvatar}>
                      {item.avatar_url
                        ? <Image source={{ uri: item.avatar_url }} style={styles.avatarImage} />
                        : <Text style={styles.avatarLetter}>{(item.display_name || item.username).slice(0, 1)}</Text>}
                    </View>
                    <View style={styles.recipientCopy}>
                      <Text style={styles.recipientName}>{item.display_name || item.username}</Text>
                      <Text style={styles.recipientUsername}>@{item.username}</Text>
                    </View>
                    {busyUser === item.user_id ? <ActivityIndicator color={colors.primary} /> : <Gift size={18} color={colors.gold} />}
                  </TouchableOpacity>
                )}
              />
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, paddingTop: 54 },
  header: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 20, marginBottom: 14 },
  backButton: { position: 'absolute', left: 16, padding: 8 },
  title: { color: colors.text, fontSize: 20, fontWeight: '800' },
  content: { paddingHorizontal: 16, paddingBottom: 40, gap: 13 },
  hero: { padding: 17, borderRadius: 22, backgroundColor: '#1C1030', borderWidth: 1, borderColor: '#5B3477', alignItems: 'flex-end' },
  heroIcon: { width: 42, height: 42, borderRadius: 15, backgroundColor: '#332044', alignItems: 'center', justifyContent: 'center', marginBottom: 11 },
  heroTitle: { color: colors.text, fontSize: 17, fontWeight: '900' },
  heroCopy: { color: colors.textSecondary, textAlign: 'right', lineHeight: 20, fontSize: 12, marginTop: 7 },
  walletCard: { padding: 15, borderRadius: 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  walletHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 7 },
  walletTitle: { color: colors.text, fontWeight: '800', fontSize: 13 },
  currencyCopy: { alignItems: 'flex-end' },
  currencyBalance: { color: colors.gold, fontSize: 18, fontWeight: '900', marginTop: 4 },
  walletNote: { color: colors.textSecondary, fontSize: 10, lineHeight: 16, textAlign: 'right', marginTop: 10 },
  errorCard: { padding: 14, borderRadius: 14, backgroundColor: '#321923', gap: 8 },
  errorText: { color: colors.danger, textAlign: 'right' },
  retry: { color: colors.gold, textAlign: 'right', fontWeight: '800' },
  sectionHeading: { alignItems: 'flex-end', marginTop: 3 },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: '900' },
  sectionSubtitle: { color: colors.textSecondary, fontSize: 11, marginTop: 4 },
  state: { minHeight: 160, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { color: colors.textSecondary, textAlign: 'center', fontSize: 12, lineHeight: 18 },
  giftGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  giftCard: { width: '48%', minHeight: 188, padding: 12, borderRadius: 18, alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  giftArt: { width: 66, height: 66, borderRadius: 20, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  giftImage: { width: 48, height: 48 },
  giftEmoji: { fontSize: 32 },
  premiumBadge: { color: colors.gold, fontSize: 9, fontWeight: '800', marginTop: 5 },
  giftName: { color: colors.text, fontSize: 12, fontWeight: '800', marginTop: 6, maxWidth: '100%' },
  priceLine: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 5 },
  giftPrice: { color: colors.gold, fontSize: 12, fontWeight: '900' },
  sendButton: { minHeight: 34, width: '100%', alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: colors.primary, marginTop: 9 },
  sendDisabled: { backgroundColor: '#342C3B' },
  sendButtonText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000099' },
  modalCard: { maxHeight: '75%', paddingHorizontal: 18, paddingTop: 20, paddingBottom: 28, borderTopLeftRadius: 25, borderTopRightRadius: 25, backgroundColor: colors.surface },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { color: colors.text, fontSize: 16, fontWeight: '900' },
  cancel: { color: colors.textSecondary, fontSize: 12, padding: 5 },
  modalSubtitle: { color: colors.gold, fontSize: 11, textAlign: 'right', marginTop: 6, marginBottom: 10 },
  recipientList: { maxHeight: 400 },
  recipient: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.border },
  recipientAvatar: { width: 42, height: 42, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
  avatarImage: { width: '100%', height: '100%', borderRadius: 15 },
  avatarLetter: { color: colors.text, fontWeight: '900' },
  recipientCopy: { flex: 1, alignItems: 'flex-end' },
  recipientName: { color: colors.text, fontSize: 12, fontWeight: '800' },
  recipientUsername: { color: colors.textSecondary, fontSize: 10, marginTop: 3 },
  noFollowing: { alignItems: 'center', gap: 14, paddingVertical: 28 },
  communityButton: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, backgroundColor: colors.primary },
  communityButtonText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
});
