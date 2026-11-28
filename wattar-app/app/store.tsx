import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { ArrowLeft, Coins, Gift, Sparkles } from 'lucide-react-native';
import { callFunction, supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { colors, fonts } from '@/lib/theme';
import { CurrencyIcon } from '@/components/CurrencyIcon';
import { GiftEffectOverlay, GiftEffectPayload } from '@/components/GiftEffectOverlay';

interface GiftItem {
  id: string;
  name: string;
  name_ar: string | null;
  icon_url: string;
  icon_emoji: string;
  animation_url: string | null;
  sound_url: string | null;
  effect_key: string | null;
  display_duration_ms: number;
  gift_type: string;
  rarity: string;
  category: string | null;
  is_premium: boolean;
  recipient_diamond_ratio: number;
  base_price: number;
  price: number;
  discount_percent: number;
  campaign: string | null;
  daily_limit_per_user: number | null;
  stock_remaining: number | null;
  available: boolean;
  unavailable_reason: string | null;
}

interface FollowedUser {
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
}

interface GiftSendResult {
  gift_transaction?: { id?: string };
  sent_coins?: number;
  gift_name?: string;
}

const rarityLabels: Record<string, string> = {
  common: 'ط´ط§ط¦ط¹ط©',
  uncommon: 'ط؛ظٹط± ط´ط§ط¦ط¹ط©',
  rare: 'ظ†ط§ط¯ط±ط©',
  epic: 'ظ…ظ„ط­ظ…ظٹط©',
  legendary: 'ط£ط³ط·ظˆط±ظٹط©',
};

const rarityColors: Record<string, string> = {
  common: colors.textSecondary,
  uncommon: colors.success,
  rare: colors.primaryLight,
  epic: colors.primary,
  legendary: colors.gold,
};

const typeLabels: Record<string, string> = {
  normal: 'ط¹ط§ط¯ظٹط©',
  animated: 'ظ…طھط­ط±ظƒط©',
  entry: 'ط¯ط®ظˆظ„',
  huge: 'ط¶ط®ظ…ط©',
  seasonal: 'ظ…ظˆط³ظ…ظٹط©',
  rare: 'ظ†ط§ط¯ط±ط©',
  collective: 'ط¬ظ…ط§ط¹ظٹط©',
  occasion: 'ظ…ظ†ط§ط³ط¨ط§طھ',
};

export default function StoreScreen() {
  const router = useRouter();
  const { profile, loadProfile } = useAuthStore();
  const [gifts, setGifts] = useState<GiftItem[]>([]);
  const [following, setFollowing] = useState<FollowedUser[]>([]);
  const [selectedGift, setSelectedGift] = useState<GiftItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyUser, setBusyUser] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [effect, setEffect] = useState<GiftEffectPayload | null>(null);
  const sendAttempt = useRef<{ fingerprint: string; key: string } | null>(null);

  const loadStore = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [storeResult, followingResult] = await Promise.all([
        supabase.rpc('get_public_gift_store'),
        supabase.rpc('list_my_following'),
      ]);
      if (storeResult.error) throw storeResult.error;
      if (followingResult.error) throw followingResult.error;
      setGifts(((storeResult.data ?? []) as GiftItem[]).map((gift) => ({
        ...gift,
        price: Number(gift.price),
        base_price: Number(gift.base_price),
        discount_percent: Number(gift.discount_percent),
        display_duration_ms: Number(gift.display_duration_ms ?? 4000),
        available: Boolean(gift.available),
      })));
      setFollowing((followingResult.data ?? []) as FollowedUser[]);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'طھط¹ط°ط± طھط­ظ…ظٹظ„ ط§ظ„ظ…طھط¬ط±.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStore();
  }, [loadStore]);

  const balance = profile?.balance_gold ?? 0;

  const categories = useMemo(() => {
    const unique = Array.from(new Set(gifts.map((gift) => gift.category).filter((value): value is string => !!value)));
    return unique.sort((a, b) => a.localeCompare(b));
  }, [gifts]);

  const visibleGifts = useMemo(
    () => (category ? gifts.filter((gift) => gift.category === category) : gifts),
    [gifts, category],
  );

  const activeCampaign = useMemo(
    () => gifts.find((gift) => gift.campaign && gift.discount_percent > 0) ?? null,
    [gifts],
  );

  const clearEffect = useCallback(() => setEffect(null), []);

  const sendGift = async (recipient: FollowedUser) => {
    if (!selectedGift || busyUser) return;
    const giftSnapshot = selectedGift;
    setBusyUser(recipient.user_id);
    try {
      const fingerprint = `${recipient.user_id}:${giftSnapshot.id}:gold`;
      if (sendAttempt.current?.fingerprint !== fingerprint) {
        sendAttempt.current = {
          fingerprint,
          key: `gift-store-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`,
        };
      }
      const idempotencyKey = sendAttempt.current.key;
      const giftResult = await callFunction<GiftSendResult>('gift-send', {
        to_user_id: recipient.user_id,
        gift_id: giftSnapshot.id,
        quantity: 1,
        funding_currency: 'gold',
      }, idempotencyKey);
      sendAttempt.current = null;
      const sentGiftName = giftSnapshot.name_ar || giftSnapshot.name;
      setSelectedGift(null);
      setEffect({
        giftId: giftSnapshot.id,
        name: sentGiftName,
        emoji: giftSnapshot.icon_emoji || 'ًںژپ',
        iconUrl: giftSnapshot.icon_url ?? '',
        animationUrl: giftSnapshot.animation_url ?? null,
        soundUrl: giftSnapshot.sound_url ?? null,
        effectKey: giftSnapshot.effect_key ?? null,
        durationMs: Math.min(Math.max(giftSnapshot.display_duration_ms, 1000), 30000),
        giftType: giftSnapshot.gift_type ?? 'normal',
        rarity: giftSnapshot.rarity ?? 'common',
        price: Number(giftResult.sent_coins ?? giftSnapshot.price),
        senderName: profile?.display_name || profile?.username || 'ط£ظ†طھ',
        receiverName: recipient.display_name || recipient.username,
      });
      try {
        await loadProfile();
      } catch (refreshError: unknown) {
        console.warn('[Wattar] Gift sent but wallet refresh failed:', refreshError);
        Alert.alert('طھظ… ط¥ط±ط³ط§ظ„ ط§ظ„ظ‡ط¯ظٹط©', 'ط£ظڈط±ط³ظ„طھ ط§ظ„ظ‡ط¯ظٹط©طŒ ظ„ظƒظ† طھط¹ط°ط± طھط­ط¯ظٹط« ط§ظ„ط£ط±طµط¯ط© ط§ظ„ط¢ظ†. ط§ط³ط­ط¨ ط§ظ„ط´ط§ط´ط© ظ„ظ„طھط­ط¯ظٹط«.');
      }
    } catch (caught: unknown) {
      Alert.alert('طھط¹ط°ط± ط¥ط±ط³ط§ظ„ ط§ظ„ظ‡ط¯ظٹط©', caught instanceof Error ? caught.message : 'ط­ط§ظˆظ„ ظ…ط±ط© ط£ط®ط±ظ‰.');
    } finally {
      setBusyUser(null);
    }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} accessibilityLabel="ط±ط¬ظˆط¹">
          <ArrowLeft size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>ظ…طھط¬ط± ط§ظ„ظ‡ط¯ط§ظٹط§</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}><Gift size={22} color={colors.gold} /></View>
          <Text style={styles.heroTitle}>ط§ط®طھظژط± ظ‡ط¯ظٹط© ظˆط´ط§ط±ظƒظ‡ط§</Text>
          <Text style={styles.heroCopy}>ط§ط¯ظپط¹ Coins ط¹ظ†ط¯ ط§ظ„ط¥ط±ط³ط§ظ„ ظپظ‚ط·. ط§ظ„ظ‡ط¯ط§ظٹط§ طھظڈط³ظˆظ‘ظ‰ ط¨ط£ظ…ط§ظ†طŒ ظˆظ„ط§ ظٹظˆط¬ط¯ طھط­ظˆظٹظ„ ط¨ظٹظ† ط¹ظ…ظ„ط© ط§ظ„ظ„ط¹ط¨ ظˆط±طµظٹط¯ Coin.</Text>
        </View>

        <View style={styles.walletCard}>
          <View style={styles.walletHeader}>
            <View style={styles.currencyCopy}>
              <Text style={styles.walletTitle}>ط±طµظٹط¯ Coin</Text>
              <Text style={styles.currencyBalance}>{balance.toLocaleString()}</Text>
            </View>
            <CurrencyIcon currency="coin" size={40} />
          </View>
          <Text style={styles.walletNote}>Coin ظ„ظ„ط´ط­ظ† ظˆط§ظ„ظ‡ط¯ط§ظٹط§ ظˆط§ظ„ط£ظ„ط¹ط§ط¨ ط¯ط§ط®ظ„ WattarطŒ ظˆظ„ط§ طھظڈط³ط­ط¨ ظ†ظ‚ط¯ظ‹ط§.</Text>
        </View>

        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity onPress={() => void loadStore()}><Text style={styles.retry}>ط¥ط¹ط§ط¯ط© ط§ظ„ظ…ط­ط§ظˆظ„ط©</Text></TouchableOpacity>
          </View>
        ) : null}

        {activeCampaign ? (
          <View style={styles.campaignCard}>
            <Sparkles size={16} color={colors.gold} />
            <Text style={styles.campaignText} numberOfLines={2}>
              {activeCampaign.campaign} â€” ط®طµظ… {activeCampaign.discount_percent}% ط¹ظ„ظ‰ ط§ظ„ظ‡ط¯ط§ظٹط§ ط§ظ„ظ…ط´ط§ط±ظƒط©
            </Text>
          </View>
        ) : null}

        <View style={styles.sectionHeading}>
          <Text style={styles.sectionTitle}>ط§ظ„ظ‡ط¯ط§ظٹط§ ط§ظ„ظ…طھط§ط­ط©</Text>
          <Text style={styles.sectionSubtitle}>ط§ظ„ط£ط³ط¹ط§ط± ط¨ظˆط­ط¯ط© Coins ظ„ظƒظ„ ظ‡ط¯ظٹط© â€” طھظڈط®طµظ… ط¹ظ†ط¯ ط§ظ„ط¥ط±ط³ط§ظ„</Text>
        </View>

        {categories.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            <TouchableOpacity
              onPress={() => setCategory(null)}
              style={[styles.chip, category === null && styles.chipActive]}
            >
              <Text style={[styles.chipText, category === null && styles.chipTextActive]}>ط§ظ„ظƒظ„</Text>
            </TouchableOpacity>
            {categories.map((item) => (
              <TouchableOpacity
                key={item}
                onPress={() => setCategory(item)}
                style={[styles.chip, category === item && styles.chipActive]}
              >
                <Text style={[styles.chipText, category === item && styles.chipTextActive]}>{item}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        ) : null}

        {loading ? (
          <View style={styles.state}><ActivityIndicator color={colors.primary} /></View>
        ) : visibleGifts.length === 0 && !error ? (
          <View style={styles.state}><Text style={styles.emptyTitle}>ظ„ط§ طھظˆط¬ط¯ ظ‡ط¯ط§ظٹط§ ظ†ط´ط·ط© ط§ظ„ط¢ظ†</Text></View>
        ) : (
          <View style={styles.giftGrid}>
            {visibleGifts.map((gift) => {
              const canAfford = balance >= gift.price;
              const sendable = gift.available && canAfford;
              const remoteIcon = /^https:\/\//i.test(gift.icon_url) ? gift.icon_url : null;
              const tint = rarityColors[gift.rarity] ?? rarityColors.common;
              return (
                <View key={gift.id} style={[styles.giftCard, !gift.available && styles.giftCardDisabled]}>
                  <View style={styles.giftArt}>
                    {remoteIcon ? (
                      <Image source={{ uri: remoteIcon }} style={styles.giftImage} resizeMode="contain" />
                    ) : (
                      <Text style={styles.giftEmoji}>{gift.icon_emoji}</Text>
                    )}
                  </View>
                  <View style={styles.badges}>
                    <Text style={[styles.rarityBadge, { color: tint, borderColor: tint }]}>
                      {rarityLabels[gift.rarity] ?? gift.rarity}
                    </Text>
                    {gift.gift_type !== 'normal' ? (
                      <Text style={styles.typeBadge}>{typeLabels[gift.gift_type] ?? gift.gift_type}</Text>
                    ) : null}
                    {gift.is_premium ? <Text style={styles.premiumBadge}>ظ…ظ…ظٹط²ط©</Text> : null}
                  </View>
                  <Text style={styles.giftName} numberOfLines={1}>{gift.name_ar || gift.name}</Text>
                  <View style={styles.priceLine}>
                    <Coins size={13} color={colors.gold} />
                    <Text style={styles.giftPrice}>{gift.price.toLocaleString()}</Text>
                    {gift.discount_percent > 0 ? (
                      <Text style={styles.basePrice}>{gift.base_price.toLocaleString()}</Text>
                    ) : null}
                  </View>
                  {gift.discount_percent > 0 ? (
                    <Text style={styles.discountText}>ط®طµظ… {gift.discount_percent}%</Text>
                  ) : null}
                  {gift.stock_remaining !== null ? (
                    <Text style={styles.stockText}>ظ…طھط¨ظ‚ظچ {gift.stock_remaining}</Text>
                  ) : null}
                  {gift.daily_limit_per_user !== null ? (
                    <Text style={styles.stockText}>ط­ط¯ ظٹظˆظ…ظٹ {gift.daily_limit_per_user}</Text>
                  ) : null}
                  <TouchableOpacity
                    style={[styles.sendButton, !sendable && styles.sendDisabled]}
                    disabled={!sendable}
                    onPress={() => setSelectedGift(gift)}
                  >
                    <Text style={styles.sendButtonText} numberOfLines={2}>
                      {!gift.available
                        ? (gift.unavailable_reason ?? 'ط؛ظٹط± ظ…طھط§ط­ط©')
                        : canAfford ? 'ط¥ط±ط³ط§ظ„ ظ‡ط¯ظٹط©' : 'ط§ظ„ط±طµظٹط¯ ط؛ظٹط± ظƒط§ظپظچ'}
                    </Text>
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
              <Text style={styles.modalTitle}>ط¥ظ„ظ‰ ظ…ظ† طھط±ط³ظ„ ط§ظ„ظ‡ط¯ظٹط©طں</Text>
              <TouchableOpacity onPress={() => setSelectedGift(null)}><Text style={styles.cancel}>ط¥ظ„ط؛ط§ط،</Text></TouchableOpacity>
            </View>
            <Text style={styles.modalSubtitle}>
              {selectedGift ? `${selectedGift.name_ar || selectedGift.name} آ· ${selectedGift.price.toLocaleString()} Coins` : ''}
            </Text>
            {following.length === 0 ? (
              <View style={styles.noFollowing}>
                <Text style={styles.emptyTitle}>طھط§ط¨ط¹ ط£ط´ط®ط§طµظ‹ط§ ط£ظˆظ„ظ‹ط§ ظ„ط¥ط±ط³ط§ظ„ ظ‡ط¯ظٹط© ظ…ظ† ط§ظ„ظ…طھط¬ط±.</Text>
                <TouchableOpacity style={styles.communityButton} onPress={() => { setSelectedGift(null); router.push('/(tabs)/friends'); }}>
                  <Text style={styles.communityButtonText}>ط§ظƒطھط´ط§ظپ ط§ظ„ظ…ط¬طھظ…ط¹</Text>
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

      <GiftEffectOverlay effect={effect} onDone={clearEffect} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, paddingTop: 54 },
  header: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 20, marginBottom: 14 },
  backButton: { position: 'absolute', left: 16, padding: 8 },
  title: { color: colors.text, fontSize: 20, fontFamily: fonts.bold },
  content: { paddingHorizontal: 16, paddingBottom: 40, gap: 13 },
  hero: { padding: 17, borderRadius: 22, backgroundColor: colors.heroSurface, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'flex-end' },
  heroIcon: { width: 42, height: 42, borderRadius: 15, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginBottom: 11 },
  heroTitle: { color: colors.text, fontSize: 17, fontFamily: fonts.black },
  heroCopy: { color: colors.textSecondary, textAlign: 'right', lineHeight: 20, fontSize: 12, marginTop: 7 },
  walletCard: { padding: 15, borderRadius: 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  walletHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 7 },
  walletTitle: { color: colors.text, fontFamily: fonts.bold, fontSize: 13 },
  currencyCopy: { alignItems: 'flex-end' },
  currencyBalance: { color: colors.gold, fontSize: 18, fontFamily: fonts.black, marginTop: 4 },
  walletNote: { color: colors.textSecondary, fontSize: 10, lineHeight: 16, textAlign: 'right', marginTop: 10 },
  errorCard: { padding: 14, borderRadius: 14, backgroundColor: colors.dangerSoft, gap: 8 },
  errorText: { color: colors.danger, textAlign: 'right' },
  retry: { color: colors.gold, textAlign: 'right', fontFamily: fonts.bold },
  campaignCard: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, padding: 12, borderRadius: 14, backgroundColor: colors.goldSoft, borderWidth: 1, borderColor: colors.goldLine },
  campaignText: { flex: 1, color: colors.gold, fontSize: 11, textAlign: 'right', lineHeight: 17 },
  sectionHeading: { alignItems: 'flex-end', marginTop: 3 },
  sectionTitle: { color: colors.text, fontSize: 16, fontFamily: fonts.black },
  sectionSubtitle: { color: colors.textSecondary, fontSize: 11, marginTop: 4 },
  chips: { flexDirection: 'row', gap: 8, paddingVertical: 2 },
  chip: { paddingHorizontal: 13, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textSecondary, fontSize: 11, fontFamily: fonts.semibold },
  chipTextActive: { color: colors.text },
  state: { minHeight: 160, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { color: colors.textSecondary, textAlign: 'center', fontSize: 12, lineHeight: 18 },
  giftGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  giftCard: { width: '48%', minHeight: 196, padding: 12, borderRadius: 18, alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  giftCardDisabled: { opacity: 0.55 },
  giftArt: { width: 66, height: 66, borderRadius: 20, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  giftImage: { width: 48, height: 48 },
  giftEmoji: { fontSize: 32 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 4, marginTop: 6 },
  rarityBadge: { fontSize: 9, fontFamily: fonts.bold, borderWidth: 1, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1 },
  typeBadge: { fontSize: 9, fontFamily: fonts.semibold, color: colors.textSecondary, borderWidth: 1, borderColor: colors.border, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1 },
  premiumBadge: { color: colors.gold, fontSize: 9, fontFamily: fonts.bold },
  giftName: { color: colors.text, fontSize: 12, fontFamily: fonts.bold, marginTop: 6, maxWidth: '100%' },
  priceLine: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 5 },
  giftPrice: { color: colors.gold, fontSize: 12, fontFamily: fonts.black },
  basePrice: { color: colors.textSecondary, fontSize: 10, textDecorationLine: 'line-through' },
  discountText: { color: colors.success, fontSize: 9, fontFamily: fonts.bold, marginTop: 3 },
  stockText: { color: colors.textSecondary, fontSize: 9, marginTop: 3 },
  sendButton: { minHeight: 34, width: '100%', alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: colors.primary, marginTop: 9, paddingHorizontal: 4 },
  sendDisabled: { backgroundColor: colors.surfaceMuted },
  sendButtonText: { color: colors.text, fontSize: 10, fontFamily: fonts.bold, textAlign: 'center' },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlay },
  modalCard: { maxHeight: '75%', paddingHorizontal: 18, paddingTop: 20, paddingBottom: 28, borderTopLeftRadius: 25, borderTopRightRadius: 25, backgroundColor: colors.surface },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { color: colors.text, fontSize: 16, fontFamily: fonts.black },
  cancel: { color: colors.textSecondary, fontSize: 12, padding: 5 },
  modalSubtitle: { color: colors.gold, fontSize: 11, textAlign: 'right', marginTop: 6, marginBottom: 10 },
  recipientList: { maxHeight: 400 },
  recipient: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.border },
  recipientAvatar: { width: 42, height: 42, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
  avatarImage: { width: '100%', height: '100%', borderRadius: 15 },
  avatarLetter: { color: colors.text, fontFamily: fonts.black },
  recipientCopy: { flex: 1, alignItems: 'flex-end' },
  recipientName: { color: colors.text, fontSize: 12, fontFamily: fonts.bold },
  recipientUsername: { color: colors.textSecondary, fontSize: 10, marginTop: 3 },
  noFollowing: { alignItems: 'center', gap: 14, paddingVertical: 28 },
  communityButton: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, backgroundColor: colors.primary },
  communityButtonText: { color: colors.text, fontSize: 11, fontFamily: fonts.bold },
});
