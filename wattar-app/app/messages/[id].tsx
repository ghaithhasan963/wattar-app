import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronRight, Coins, Gift, Send, Smile, Sticker, UserRound } from 'lucide-react-native';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { callFunction, supabase } from '@/lib/supabase';
import { notifySocialEvent } from '@/lib/notifications';
import {
  createIdempotencyKey,
  getConversationSubtitle,
  getPriceConfirmationText,
  getPricingNotice,
  requiresPriceConfirmation,
  type MessageQuote as PrivateMessageQuote,
} from '@/lib/messagePricing';
import { useAuthStore } from '@/store/auth';
import { colors } from '@/lib/theme';

interface PrivateMessage {
  message_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  read_at: string | null;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  charged_coins: number;
  host_commission_diamonds: number;
  message_kind: 'text' | 'sticker' | 'gift';
  gift_transaction_id: string | null;
  sticker_id: string | null;
  gift_name: string | null;
  gift_emoji: string | null;
  gift_icon_url: string | null;
  sticker_emoji: string | null;
  sticker_image_url: string | null;
  sticker_animation_url: string | null;
  pending?: boolean;
}

interface StickerItem {
  id: string;
  code: string;
  emoji: string | null;
  image_url: string | null;
  animation_url: string | null;
  sort_order: number;
}

interface StickerPack {
  id: string;
  key: string;
  name: string;
  name_ar: string | null;
  icon_emoji: string;
  stickers: StickerItem[];
}

interface GiftItem {
  id: string;
  name: string;
  name_ar: string | null;
  icon_url: string;
  icon_emoji: string;
  price: number;
  base_price: number;
  discount_percent: number;
  rarity: string;
  available: boolean;
  unavailable_reason: string | null;
}

const PAGE_SIZE = 30;

const palette = {
  background: '#090611',
  surface: '#171128',
  elevated: '#1F1630',
  border: '#352449',
  text: '#F8F3FF',
  muted: '#B2A6C3',
  primary: '#B44BFF',
  primaryDeep: '#7624D7',
  gold: '#F4BD55',
  teal: '#72DCCA',
  success: '#43D69A',
} as const;

const CHAT_EMOJIS = ['😀', '😂', '🥰', '😍', '🤩', '😎', '🥳', '😭', '👏', '🔥', '❤️', '🌹', '🎉', '✨', '💎', '🎁'];

const rarityColors: Record<string, string> = {
  common: '#C9B8E0',
  uncommon: '#4ADE80',
  rare: '#60A5FA',
  epic: '#C084FC',
  legendary: '#FBBF24',
};

function dayKey(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function formatDayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'اليوم';
  if (date.toDateString() === yesterday.toDateString()) return 'أمس';
  return date.toLocaleDateString('ar', { day: 'numeric', month: 'long', year: 'numeric' });
}

function sortMessages(items: PrivateMessage[]): PrivateMessage[] {
  return [...items].sort((a, b) => {
    if (a.created_at === b.created_at) return a.message_id.localeCompare(b.message_id);
    return a.created_at.localeCompare(b.created_at);
  });
}

function mergeMessages(current: PrivateMessage[], incoming: PrivateMessage[]): PrivateMessage[] {
  const map = new Map(current.map((item) => [item.message_id, item]));
  incoming.forEach((item) => map.set(item.message_id, item));
  return sortMessages(Array.from(map.values()));
}

export default function PrivateMessageScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, profile, loadProfile } = useAuthStore();

  const [messages, setMessages] = useState<PrivateMessage[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [partnerTyping, setPartnerTyping] = useState(false);
  const [title, setTitle] = useState('محادثة');
  const [partnerUserId, setPartnerUserId] = useState<string | null>(null);
  const [partnerAvatar, setPartnerAvatar] = useState<string | null>(null);
  const [partnerOnline, setPartnerOnline] = useState(false);
  const [quote, setQuote] = useState<PrivateMessageQuote | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [panel, setPanel] = useState<'none' | 'stickers' | 'gifts'>('none');
  const [stickerPacks, setStickerPacks] = useState<StickerPack[]>([]);
  const [activePack, setActivePack] = useState<string | null>(null);
  const [sendingSticker, setSendingSticker] = useState<string | null>(null);
  const [gifts, setGifts] = useState<GiftItem[]>([]);
  const [sendingGift, setSendingGift] = useState<string | null>(null);

  const listRef = useRef<FlatList<PrivateMessage>>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryMessageRef = useRef<{ body: string; key: string } | null>(null);
  const loadingOlderRef = useRef(false);

  const fetchPage = useCallback(async (before: string | null, beforeId: string | null) => {
    if (!id) return [] as PrivateMessage[];
    const { data, error } = await supabase.rpc('list_private_messages', {
      p_conversation_id: id,
      p_before: before,
      p_before_id: beforeId,
      p_limit: PAGE_SIZE,
    });
    if (error) throw error;
    return ((data ?? []) as PrivateMessage[]).slice().reverse();
  }, [id]);

  const refreshQuote = useCallback(async () => {
    if (!id) return;
    const { data, error } = await supabase.rpc('get_private_message_quote', { p_conversation_id: id });
    if (error) throw error;
    setQuote(data as PrivateMessageQuote);
  }, [id]);

  const loadLatest = useCallback(async (showLoader = false) => {
    if (!id) return;
    if (showLoader) setLoading(true);
    setLoadError(null);
    try {
      const [page, conversationsResult] = await Promise.all([
        fetchPage(null, null),
        supabase.rpc('list_my_private_conversations'),
      ]);
      if (conversationsResult.error) throw conversationsResult.error;
      const conversation = (conversationsResult.data ?? []).find(
        (item: { conversation_id: string }) => item.conversation_id === id,
      );
      if (conversation) {
        setPartnerUserId(conversation.user_id);
        setTitle(conversation.display_name || conversation.username);
        setPartnerAvatar(conversation.avatar_url ?? null);
        setPartnerOnline(conversation.is_online === true);
      }
      setMessages((current) => mergeMessages(current, page));
      setHasMore(page.length === PAGE_SIZE);
      await refreshQuote().catch((quoteError: unknown) => {
        setLoadError(quoteError instanceof Error ? quoteError.message : 'تعذر جلب قواعد المراسلة.');
      });
      const { error: readError } = await supabase.rpc('mark_private_messages_read', {
        p_conversation_id: id,
      });
      if (readError) console.warn('[Wattar] Failed to mark private messages read:', readError.message);
    } catch (error: unknown) {
      setLoadError(error instanceof Error ? error.message : 'تحقق من اتصال الإنترنت وحاول مجددًا.');
    } finally {
      setLoading(false);
    }
  }, [fetchPage, id, refreshQuote]);

  const loadOlder = useCallback(async () => {
    if (!id || loadingOlderRef.current || !hasMore || messages.length === 0) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const oldest = messages[0];
      const page = await fetchPage(oldest.created_at, oldest.message_id);
      setMessages((current) => mergeMessages(current, page));
      setHasMore(page.length === PAGE_SIZE);
    } catch (error: unknown) {
      console.warn('[Wattar] Failed to load older messages:', error);
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [fetchPage, hasMore, id, messages]);

  const loadPanels = useCallback(async () => {
    try {
      const [packsResult, giftsResult] = await Promise.all([
        supabase.rpc('get_public_sticker_packs'),
        supabase.rpc('get_public_gift_store'),
      ]);
      if (packsResult.error) throw packsResult.error;
      if (giftsResult.error) throw giftsResult.error;
      const packs = (packsResult.data ?? []) as StickerPack[];
      setStickerPacks(packs);
      setActivePack((current) => current ?? packs[0]?.id ?? null);
      setGifts(((giftsResult.data ?? []) as GiftItem[]).map((gift) => ({
        ...gift,
        price: Number(gift.price),
        base_price: Number(gift.base_price),
        discount_percent: Number(gift.discount_percent),
      })));
    } catch (error: unknown) {
      console.warn('[Wattar] Failed to load chat panels:', error);
    }
  }, []);

  useEffect(() => {
    void loadLatest(true);
    void loadPanels();
    if (!id) return;
    const channel = supabase
      .channel(`private-dm:${id}`, { config: { private: true } })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'private_messages',
        filter: `conversation_id=eq.${id}`,
      }, () => {
        void loadLatest();
      })
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (payload?.user_id === user?.id) return;
        const typing = payload?.is_typing === true;
        setPartnerTyping(typing);
        if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
        if (typing) {
          typingTimerRef.current = setTimeout(() => setPartnerTyping(false), 3500);
        }
      })
      .subscribe();
    channelRef.current = channel;
    return () => {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      setPartnerTyping(false);
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [id, loadLatest, loadPanels, user?.id]);

  const updateTyping = (value: string) => {
    setMessage(value);
    if (retryMessageRef.current && retryMessageRef.current.body !== value.trim()) {
      retryMessageRef.current = null;
    }
    const channel = channelRef.current;
    if (!channel || !user?.id) return;
    void channel.send({
      type: 'broadcast',
      event: 'typing',
      payload: { user_id: user.id, is_typing: value.trim().length > 0 },
    }).catch((error: unknown) => {
      console.warn('[Wattar] Failed to send typing state:', error);
    });
  };

  const confirmCharge = (amount: number, extra?: string) => new Promise<boolean>((resolve) => {
    Alert.alert(
      'رسالة مدفوعة',
      `ستُخصم ${amount.toLocaleString()} Coin من رصيدك.${extra ?? ''}`,
      [
        { text: 'إلغاء', style: 'cancel', onPress: () => resolve(false) },
        { text: 'إرسال', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });

  const send = async () => {
    const body = message.trim();
    if (!body || sending || !id || !user?.id) return;
    if (!quote) {
      Alert.alert('تعذر التحقق من السعر', 'حدّث المحادثة قبل إرسال الرسالة.');
      return;
    }
    let confirmedPrice = 0;
    if (requiresPriceConfirmation(quote)) {
      const confirmed = await new Promise<boolean>((resolve) => {
        Alert.alert(
          'رسالة مدفوعة',
          getPriceConfirmationText(quote),
          [
            { text: 'إلغاء', style: 'cancel', onPress: () => resolve(false) },
            { text: 'إرسال', onPress: () => resolve(true) },
          ],
          { cancelable: true, onDismiss: () => resolve(false) },
        );
      });
      if (!confirmed) return;
      confirmedPrice = quote.price_coin;
    }
    const temporaryId = `pending-${Date.now()}`;
    const idempotencyKey = retryMessageRef.current?.body === body
      ? retryMessageRef.current.key
      : createIdempotencyKey();
    retryMessageRef.current = { body, key: idempotencyKey };
    setMessage('');
    setSending(true);
    setMessages((items) => sortMessages([...items, {
      message_id: temporaryId,
      sender_id: user.id,
      body,
      created_at: new Date().toISOString(),
      read_at: null,
      username: profile?.username ?? '',
      display_name: profile?.display_name ?? null,
      avatar_url: profile?.avatar_url ?? null,
      charged_coins: 0,
      host_commission_diamonds: 0,
      message_kind: 'text',
      gift_transaction_id: null,
      sticker_id: null,
      gift_name: null,
      gift_emoji: null,
      gift_icon_url: null,
      sticker_emoji: null,
      sticker_image_url: null,
      sticker_animation_url: null,
      pending: true,
    }]));
    try {
      const { data, error } = await supabase.rpc('send_private_message', {
        p_conversation_id: id,
        p_body: body,
        p_idempotency_key: idempotencyKey,
        p_confirmed_price_coin: confirmedPrice,
      });
      if (error) throw error;
      const blockedResult = data as { blocked?: boolean; message?: string } | null;
      if (blockedResult?.blocked) {
        throw new Error(blockedResult.message ?? 'الرسالة تحتوي على كلمات غير مسموح بها');
      }
      retryMessageRef.current = null;
      const result = data as { message_id?: string };
      if (result?.message_id) {
        void notifySocialEvent('private_message', result.message_id).catch((notificationError: unknown) => {
          console.warn('[Wattar] Private message push failed:', notificationError);
        });
      }
      await loadLatest();
    } catch (error: unknown) {
      setMessages((items) => items.filter((item) => item.message_id !== temporaryId));
      setMessage(body);
      await loadLatest().catch(() => undefined);
      Alert.alert('تعذر إرسال الرسالة', error instanceof Error ? error.message : 'حاول مرة أخرى.');
    } finally {
      setSending(false);
    }
  };

  const sendSticker = async (sticker: StickerItem) => {
    if (!id || sendingSticker) return;
    const price = quote?.price_coin ?? 0;
    if (price > 0) {
      const ok = await confirmCharge(price, quote?.recipient_is_host
        ? `\nعمولة المضيفة ${quote.host_commission_percent}% Diamond.`
        : '');
      if (!ok) return;
    }
    setSendingSticker(sticker.id);
    try {
      const { data, error } = await supabase.rpc('send_sticker_message', {
        p_conversation_id: id,
        p_sticker_id: sticker.id,
        p_idempotency_key: createIdempotencyKey(),
        p_confirmed_price_coin: price,
      });
      if (error) throw error;
      const result = data as { message_id?: string };
      if (result?.message_id) {
        void notifySocialEvent('private_message', result.message_id).catch(() => undefined);
      }
      await loadLatest();
      setPanel('none');
    } catch (error: unknown) {
      await refreshQuote().catch(() => undefined);
      Alert.alert('تعذر إرسال الملصق', error instanceof Error ? error.message : 'حاول مرة أخرى.');
    } finally {
      setSendingSticker(null);
    }
  };

  const sendGift = async (gift: GiftItem) => {
    if (!id || !partnerUserId || sendingGift) return;
    if (!gift.available) {
      Alert.alert('الهدية غير متاحة', gift.unavailable_reason ?? 'حاول لاحقاً.');
      return;
    }
    const ok = await confirmCharge(gift.price, `\nالهدية: ${gift.name_ar || gift.name}`);
    if (!ok) return;
    setSendingGift(gift.id);
    try {
      const result = await callFunction<{ gift_transaction?: { id?: string } }>('gift-send', {
        to_user_id: partnerUserId,
        gift_id: gift.id,
        quantity: 1,
        funding_currency: 'gold',
      }, createIdempotencyKey());
      const transactionId = result.gift_transaction?.id;
      if (!transactionId) throw new Error('لم تُسجَّل عملية الهدية');
      const { error: attachError } = await supabase.rpc('attach_gift_message', {
        p_conversation_id: id,
        p_gift_transaction_id: transactionId,
      });
      if (attachError) throw attachError;
      void notifySocialEvent('gift_received', transactionId).catch((notificationError: unknown) => {
        console.warn('[Wattar] Gift push failed:', notificationError);
      });
      await loadProfile().catch(() => undefined);
      await loadLatest();
      setPanel('none');
    } catch (error: unknown) {
      Alert.alert('تعذر إرسال الهدية', error instanceof Error ? error.message : 'حاول مرة أخرى.');
    } finally {
      setSendingGift(null);
    }
  };

  const ownAvatar = profile?.avatar_url;
  const ownLetter = (profile?.display_name || profile?.username || 'أ').slice(0, 1);
  const activeStickers = useMemo(
    () => stickerPacks.find((pack) => pack.id === activePack)?.stickers ?? [],
    [stickerPacks, activePack],
  );

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      <View style={styles.glowTop} />
      <View style={styles.glowBottom} />

      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} accessibilityLabel="رجوع">
          <ChevronRight size={22} color={palette.text} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.partnerHeaderAction}
          onPress={() => partnerUserId && router.push(`/user/${partnerUserId}`)}
          disabled={!partnerUserId}
          accessibilityRole="button"
          accessibilityLabel="فتح الملف الشخصي"
        >
          <View style={styles.avatarRing}>
            <View style={styles.partnerAvatar}>
              {partnerAvatar
                ? <Image source={{ uri: partnerAvatar }} style={styles.partnerAvatarImage} />
                : <Text style={styles.partnerAvatarText}>{title.slice(0, 1).toUpperCase()}</Text>}
            </View>
            {partnerOnline ? <View style={styles.onlineDot} /> : null}
          </View>
          <View style={styles.headerCopy}>
            <View style={styles.titleRow}>
              <Text style={styles.title} numberOfLines={1}>{title}</Text>
              <View style={styles.chatBadge}><Text style={styles.chatBadgeText}>خاص</Text></View>
            </View>
            <Text style={[styles.subtitle, partnerTyping && styles.typingText]} numberOfLines={1}>
              {partnerTyping ? 'يكتب الآن…' : partnerOnline ? 'متصل الآن' : getConversationSubtitle(quote)}
            </Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.headerAction}
          onPress={() => { setPanel(panel === 'gifts' ? 'none' : 'gifts'); setShowEmojiPicker(false); }}
          accessibilityLabel="إرسال هدية"
        >
          <Gift size={18} color={panel === 'gifts' ? palette.gold : palette.muted} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.headerAction}
          onPress={() => partnerUserId && router.push(`/user/${partnerUserId}`)}
          disabled={!partnerUserId}
          accessibilityLabel="معلومات الحساب"
        >
          <UserRound size={18} color={palette.muted} />
        </TouchableOpacity>
      </View>

      {loading && messages.length === 0 ? (
        <View style={styles.loading}><ActivityIndicator size="large" color={palette.gold} /></View>
      ) : loadError && messages.length === 0 ? (
        <View style={styles.loadError}>
          <Text style={styles.loadErrorTitle}>تعذر تحميل المحادثة</Text>
          <Text style={styles.loadErrorText}>{loadError}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => void loadLatest(true)}>
            <Text style={styles.retryText}>إعادة المحاولة</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.message_id}
          contentContainerStyle={styles.messageList}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          onEndReachedThreshold={0.4}
          onScroll={({ nativeEvent }) => {
            if (nativeEvent.contentOffset.y < 40) void loadOlder();
          }}
          scrollEventThrottle={120}
          ListHeaderComponent={(
            <View>
              {loadingOlder ? <ActivityIndicator color={palette.muted} style={styles.olderLoader} /> : null}
              {!hasMore && messages.length > 0 ? (
                <Text style={styles.startOfChat}>بداية المحادثة</Text>
              ) : null}
              {loadError ? <Text style={styles.refreshWarning}>{loadError}</Text> : null}
            </View>
          )}
          ListFooterComponent={partnerTyping ? (
            <View style={styles.typingBubbleRow}>
              <View style={styles.typingBubble}>
                <View style={styles.typingDot} />
                <View style={[styles.typingDot, styles.typingDotMid]} />
                <View style={styles.typingDot} />
              </View>
            </View>
          ) : null}
          renderItem={({ item, index }) => {
            const previous = messages[index - 1];
            const showDay = !previous || dayKey(previous.created_at) !== dayKey(item.created_at);
            const sameSender = Boolean(previous) && !showDay && previous.sender_id === item.sender_id;
            const ownMessage = item.sender_id === user?.id;
            const senderLabel = item.display_name || item.username || 'عضو';
            const avatar = ownMessage ? ownAvatar : item.avatar_url;
            const avatarLetter = ownMessage ? ownLetter : senderLabel.slice(0, 1);
            const isGift = item.message_kind === 'gift';
            const isSticker = item.message_kind === 'sticker';
            return (
              <React.Fragment key={item.message_id}>
                {showDay && (
                  <View style={styles.dayDivider}>
                    <View style={styles.dayPill}>
                      <Text style={styles.dayLabel}>{formatDayLabel(item.created_at)}</Text>
                    </View>
                  </View>
                )}
                <View style={[styles.messageRow, ownMessage ? styles.ownMessageRow : styles.otherMessageRow, sameSender && styles.messageRowTight]}>
                  {!ownMessage && (
                    sameSender ? <View style={styles.avatarSpacer} /> : (
                      <View style={styles.messageAvatar}>
                        {avatar
                          ? <Image source={{ uri: avatar }} style={styles.messageAvatarImage} />
                          : <Text style={styles.messageAvatarText}>{avatarLetter}</Text>}
                      </View>
                    )
                  )}
                  <View style={[
                    styles.messageBubble,
                    ownMessage ? styles.ownBubble : styles.otherBubble,
                    (isGift || isSticker) && styles.mediaBubble,
                  ]}>
                    {!ownMessage && !sameSender && <Text style={styles.senderName}>{senderLabel}</Text>}

                    {isGift ? (
                      <View style={styles.giftCard}>
                        <View style={styles.giftArt}>
                          {item.gift_icon_url && /^https:\/\//i.test(item.gift_icon_url)
                            ? <Image source={{ uri: item.gift_icon_url }} style={styles.giftImage} resizeMode="contain" />
                            : <Text style={styles.giftEmoji}>{item.gift_emoji || '🎁'}</Text>}
                        </View>
                        <Text style={styles.giftTitle}>{item.gift_name || item.body}</Text>
                        <Text style={styles.giftCaption}>أرسل هدية</Text>
                      </View>
                    ) : isSticker ? (
                      item.sticker_image_url && /^https:\/\//i.test(item.sticker_image_url) ? (
                        <Image source={{ uri: item.sticker_image_url }} style={styles.stickerImage} resizeMode="contain" />
                      ) : (
                        <Text style={styles.stickerEmoji}>{item.sticker_emoji || item.body}</Text>
                      )
                    ) : (
                      <Text style={styles.messageText}>{item.body}</Text>
                    )}

                    {item.charged_coins > 0 && (
                      <View style={styles.billingChip}>
                        <Text style={[styles.billingNote, ownMessage && styles.ownBillingNote]}>
                          {item.charged_coins.toLocaleString()} Coin
                          {item.host_commission_diamonds > 0
                            ? ` · ${item.host_commission_diamonds.toLocaleString()} Diamond للمضيفة`
                            : ''}
                        </Text>
                      </View>
                    )}
                    <View style={styles.messageMeta}>
                      <Text style={[styles.messageTime, ownMessage && styles.ownMessageTime]}>
                        {new Date(item.created_at).toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' })}
                      </Text>
                      {ownMessage && (
                        <Text style={[styles.messageTime, styles.ownMessageTime, item.pending && styles.pendingMark]}>
                          {item.pending ? '···' : item.read_at ? '✓✓' : '✓'}
                        </Text>
                      )}
                    </View>
                  </View>
                  {ownMessage && (
                    sameSender ? <View style={styles.avatarSpacer} /> : (
                      <View style={[styles.messageAvatar, styles.ownMessageAvatar]}>
                        {avatar
                          ? <Image source={{ uri: avatar }} style={styles.messageAvatarImage} />
                          : <Text style={styles.messageAvatarText}>{avatarLetter}</Text>}
                      </View>
                    )
                  )}
                </View>
              </React.Fragment>
            );
          }}
          ListEmptyComponent={(
            <View style={styles.emptyState}>
              <View style={styles.emptyIcon}><Send size={22} color={palette.gold} /></View>
              <Text style={styles.emptyTitle}>لا رسائل بعد</Text>
              <Text style={styles.emptyText}>اكتب أول رسالة أو أرسل ملصقاً أو هدية.</Text>
            </View>
          )}
        />
      )}

      {panel === 'stickers' && (
        <View style={styles.panel}>
          <View style={styles.panelHeader}>
            <Text style={styles.panelTitle}>الملصقات</Text>
            <TouchableOpacity onPress={() => setPanel('none')}><Text style={styles.cancel}>إغلاق</Text></TouchableOpacity>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.packTabs}>
            {stickerPacks.map((pack) => (
              <TouchableOpacity
                key={pack.id}
                onPress={() => setActivePack(pack.id)}
                style={[styles.packTab, activePack === pack.id && styles.packTabActive]}
              >
                <Text style={styles.packTabEmoji}>{pack.icon_emoji}</Text>
                <Text style={[styles.packTabText, activePack === pack.id && styles.packTabTextActive]} numberOfLines={1}>
                  {pack.name_ar || pack.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <ScrollView contentContainerStyle={styles.stickerGrid} keyboardShouldPersistTaps="handled">
            {activeStickers.map((sticker) => (
              <TouchableOpacity
                key={sticker.id}
                style={styles.stickerCell}
                onPress={() => void sendSticker(sticker)}
                disabled={sendingSticker !== null}
              >
                {sendingSticker === sticker.id
                  ? <ActivityIndicator color={palette.gold} />
                  : sticker.image_url && /^https:\/\//i.test(sticker.image_url)
                    ? <Image source={{ uri: sticker.image_url }} style={styles.stickerCellImage} resizeMode="contain" />
                    : <Text style={styles.stickerCellEmoji}>{sticker.emoji ?? '🙂'}</Text>}
              </TouchableOpacity>
            ))}
            {activeStickers.length === 0 ? <Text style={styles.emptyTitle}>لا ملصقات في هذه الحزمة.</Text> : null}
          </ScrollView>
        </View>
      )}

      {panel === 'gifts' && (
        <View style={styles.panel}>
          <View style={styles.panelHeader}>
            <Text style={styles.panelTitle}>أرسل هدية</Text>
            <TouchableOpacity onPress={() => setPanel('none')}><Text style={styles.cancel}>إغلاق</Text></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.giftGrid} keyboardShouldPersistTaps="handled">
            {gifts.map((gift) => {
              const tint = rarityColors[gift.rarity] ?? rarityColors.common;
              return (
                <TouchableOpacity
                  key={gift.id}
                  style={[styles.giftCell, !gift.available && styles.giftCellDisabled]}
                  disabled={sendingGift !== null}
                  onPress={() => void sendGift(gift)}
                >
                  <View style={styles.giftArt}>
                    {/^https:\/\//i.test(gift.icon_url)
                      ? <Image source={{ uri: gift.icon_url }} style={styles.giftImage} resizeMode="contain" />
                      : <Text style={styles.giftEmoji}>{gift.icon_emoji}</Text>}
                  </View>
                  <Text style={styles.giftCellName} numberOfLines={1}>{gift.name_ar || gift.name}</Text>
                  <View style={styles.giftPriceRow}>
                    <Coins size={11} color={palette.gold} />
                    <Text style={[styles.giftCellPrice, { color: tint }]}>{gift.price.toLocaleString()}</Text>
                  </View>
                  {sendingGift === gift.id ? <ActivityIndicator color={palette.gold} /> : null}
                </TouchableOpacity>
              );
            })}
            {gifts.length === 0 ? <Text style={styles.emptyTitle}>لا هدايا متاحة الآن.</Text> : null}
          </ScrollView>
        </View>
      )}

      {showEmojiPicker && (
        <View style={styles.emojiTray}>
          <Text style={styles.emojiTrayTitle}>أضف تعبيرًا</Text>
          <View style={styles.emojiGrid}>
            {CHAT_EMOJIS.map((emoji) => (
              <TouchableOpacity
                key={emoji}
                style={styles.emojiChoice}
                onPress={() => updateTyping(`${message}${emoji}`.slice(0, 2000))}
                accessibilityRole="button"
                accessibilityLabel={`إضافة ${emoji}`}
              >
                <Text style={styles.emojiChoiceText}>{emoji}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {quote && (
        <View style={styles.pricingNotice}>
          <View style={styles.pricingDot} />
          <Text style={styles.pricingText}>{getPricingNotice(quote)}</Text>
        </View>
      )}

      <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <TouchableOpacity
          style={[styles.toolButton, panel === 'stickers' && styles.toolButtonActive]}
          onPress={() => { setPanel(panel === 'stickers' ? 'none' : 'stickers'); setShowEmojiPicker(false); }}
          accessibilityLabel="الملصقات"
        >
          <Sticker size={19} color={panel === 'stickers' ? palette.gold : palette.muted} />
        </TouchableOpacity>
        <View style={styles.inputShell}>
          <TextInput
            style={styles.input}
            value={message}
            onChangeText={updateTyping}
            onFocus={() => { setShowEmojiPicker(false); setPanel('none'); }}
            placeholder="اكتب رسالة..."
            placeholderTextColor={palette.muted}
            multiline
            maxLength={2000}
            editable={!sending && quote !== null}
          />
          <TouchableOpacity
            style={[styles.emojiToggle, showEmojiPicker && styles.emojiToggleActive]}
            onPress={() => setShowEmojiPicker((visible) => !visible)}
            accessibilityRole="button"
            accessibilityLabel={showEmojiPicker ? 'إغلاق لوحة الإيموجي' : 'فتح لوحة الإيموجي'}
          >
            <Smile size={20} color={showEmojiPicker ? palette.gold : palette.muted} />
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          style={[styles.sendButton, (!message.trim() || sending) && styles.sendDisabled]}
          onPress={send}
          disabled={!message.trim() || sending || quote === null}
          accessibilityRole="button"
          accessibilityLabel="إرسال الرسالة"
        >
          {sending ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Send size={19} color="#FFFFFF" />}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background },
  glowTop: { position: 'absolute', top: -120, right: -80, width: 260, height: 260, borderRadius: 130, backgroundColor: '#5B21A8', opacity: 0.16 },
  glowBottom: { position: 'absolute', bottom: 90, left: -100, width: 240, height: 240, borderRadius: 120, backgroundColor: '#0E5E55', opacity: 0.12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingBottom: 11, borderBottomWidth: 1, borderBottomColor: palette.border, backgroundColor: 'rgba(17,12,26,0.9)' },
  backButton: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  partnerHeaderAction: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 9 },
  avatarRing: { padding: 2, borderRadius: 26, borderWidth: 1, borderColor: '#F4BD5566' },
  partnerAvatar: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2A1940', overflow: 'hidden' },
  partnerAvatarImage: { width: '100%', height: '100%' },
  partnerAvatarText: { color: palette.gold, fontSize: 16, fontWeight: '800' },
  headerCopy: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'flex-end' },
  title: { color: palette.text, fontSize: 15.5, fontWeight: '800', textAlign: 'right', flexShrink: 1 },
  chatBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 7, backgroundColor: '#302312' },
  chatBadgeText: { color: palette.gold, fontSize: 8, fontWeight: '800' },
  subtitle: { color: palette.muted, fontSize: 10.5, marginTop: 3, textAlign: 'right' },
  typingText: { color: palette.gold },
  onlineDot: { position: 'absolute', bottom: 1, right: 1, width: 11, height: 11, borderRadius: 6, backgroundColor: palette.success, borderWidth: 2, borderColor: palette.background },
  headerAction: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  messageList: { flexGrow: 1, justifyContent: 'flex-end', paddingHorizontal: 12, paddingVertical: 14 },
  messageRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 7, maxWidth: '94%', marginBottom: 7 },
  messageRowTight: { marginTop: -3, marginBottom: 3 },
  ownMessageRow: { alignSelf: 'flex-end' },
  otherMessageRow: { alignSelf: 'flex-start' },
  messageAvatar: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2A1940', borderWidth: 1, borderColor: palette.border, overflow: 'hidden' },
  avatarSpacer: { width: 30 },
  ownMessageAvatar: { backgroundColor: '#55209A', borderColor: '#8E3FD1' },
  messageAvatarImage: { width: '100%', height: '100%' },
  messageAvatarText: { color: palette.text, fontSize: 12, fontWeight: '800' },
  messageBubble: { maxWidth: '88%', paddingHorizontal: 13, paddingVertical: 9, borderRadius: 18, borderWidth: 1 },
  mediaBubble: { paddingHorizontal: 10, paddingVertical: 10 },
  ownBubble: { alignSelf: 'flex-end', backgroundColor: '#55209A', borderColor: '#8E3FD1', borderBottomRightRadius: 6 },
  otherBubble: { alignSelf: 'flex-start', backgroundColor: palette.surface, borderColor: palette.border, borderBottomLeftRadius: 6 },
  senderName: { color: palette.gold, fontSize: 10.5, fontWeight: '800', marginBottom: 4 },
  messageText: { color: palette.text, fontSize: 14.5, lineHeight: 22, textAlign: 'right' },
  giftCard: { alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, minWidth: 128 },
  giftArt: { width: 52, height: 52, borderRadius: 16, backgroundColor: '#2A1940', alignItems: 'center', justifyContent: 'center' },
  giftImage: { width: 40, height: 40 },
  giftEmoji: { fontSize: 28 },
  giftTitle: { color: palette.text, fontSize: 13, fontWeight: '800', marginTop: 7, textAlign: 'center' },
  giftCaption: { color: palette.gold, fontSize: 9.5, marginTop: 3 },
  stickerEmoji: { fontSize: 62, lineHeight: 74 },
  stickerImage: { width: 108, height: 108 },
  billingChip: { alignSelf: 'flex-end', marginTop: 6, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 7, backgroundColor: 'rgba(244,189,85,0.12)' },
  billingNote: { color: palette.gold, fontSize: 9, textAlign: 'right' },
  ownBillingNote: { color: '#FFE1A6' },
  messageMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 5, marginTop: 4 },
  messageTime: { color: palette.muted, fontSize: 9 },
  ownMessageTime: { color: 'rgba(255,255,255,0.72)' },
  pendingMark: { opacity: 0.7 },
  dayDivider: { alignItems: 'center', marginVertical: 12 },
  dayPill: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  dayLabel: { color: palette.muted, fontSize: 10, fontWeight: '700' },
  typingBubbleRow: { alignSelf: 'flex-start', marginTop: 3, marginBottom: 7 },
  typingBubble: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 13, paddingVertical: 10, borderRadius: 16, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  typingDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: palette.muted },
  typingDotMid: { opacity: 0.65 },
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 44, gap: 7 },
  emptyIcon: { width: 54, height: 54, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: '#302312' },
  emptyTitle: { color: palette.text, fontSize: 15, fontWeight: '800', textAlign: 'center' },
  emptyText: { color: palette.muted, textAlign: 'center', marginVertical: 3, fontSize: 12.5 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadError: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, gap: 12 },
  loadErrorTitle: { color: palette.text, fontSize: 18, fontWeight: '800' },
  loadErrorText: { color: palette.muted, fontSize: 13, textAlign: 'center', lineHeight: 20 },
  retryButton: { paddingHorizontal: 18, paddingVertical: 11, borderRadius: 13, backgroundColor: palette.primaryDeep },
  retryText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  refreshWarning: { color: '#FFC777', fontSize: 12, lineHeight: 18, marginBottom: 12, textAlign: 'center' },
  olderLoader: { marginVertical: 10 },
  startOfChat: { color: palette.muted, fontSize: 10, textAlign: 'center', marginVertical: 10 },
  panel: { maxHeight: 300, backgroundColor: palette.surface, borderTopWidth: 1, borderTopColor: palette.border, paddingTop: 10 },
  panelHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, marginBottom: 8 },
  panelTitle: { color: palette.text, fontSize: 14, fontWeight: '800' },
  cancel: { color: palette.muted, fontSize: 12, padding: 5 },
  packTabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingBottom: 8 },
  packTab: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: palette.elevated, borderWidth: 1, borderColor: palette.border },
  packTabActive: { backgroundColor: '#3A2350', borderColor: palette.primary },
  packTabEmoji: { fontSize: 15 },
  packTabText: { color: palette.muted, fontSize: 11, fontWeight: '700', maxWidth: 90 },
  packTabTextActive: { color: palette.text },
  stickerGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 14, paddingBottom: 16 },
  stickerCell: { width: 62, height: 62, alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: palette.elevated, borderWidth: 1, borderColor: palette.border },
  stickerCellEmoji: { fontSize: 30 },
  stickerCellImage: { width: 44, height: 44 },
  giftGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 14, paddingBottom: 16 },
  giftCell: { width: 86, alignItems: 'center', paddingVertical: 9, borderRadius: 16, backgroundColor: palette.elevated, borderWidth: 1, borderColor: palette.border },
  giftCellDisabled: { opacity: 0.45 },
  giftCellName: { color: palette.text, fontSize: 10.5, fontWeight: '700', marginTop: 5, maxWidth: 78 },
  giftPriceRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 3 },
  giftCellPrice: { fontSize: 10.5, fontWeight: '900' },
  emojiTray: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 7, backgroundColor: palette.surface, borderTopWidth: 1, borderTopColor: palette.border },
  emojiTrayTitle: { color: palette.muted, fontSize: 10, fontWeight: '700', marginBottom: 8, textAlign: 'right' },
  emojiGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 5 },
  emojiChoice: { minWidth: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#241B33' },
  emojiChoiceText: { fontSize: 21 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 7, paddingHorizontal: 10, paddingTop: 9, borderTopWidth: 1, borderTopColor: palette.border, backgroundColor: 'rgba(9,6,17,0.96)' },
  pricingNotice: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: palette.surface, borderTopWidth: 1, borderTopColor: palette.border },
  pricingDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: palette.gold },
  pricingText: { flex: 1, color: palette.gold, fontSize: 10.5, textAlign: 'right' },
  toolButton: { width: 42, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 21, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  toolButtonActive: { borderColor: palette.gold, backgroundColor: '#2E2415' },
  inputShell: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', borderRadius: 22, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, paddingLeft: 4 },
  input: { flex: 1, minHeight: 46, maxHeight: 120, color: palette.text, fontSize: 14, paddingHorizontal: 12, paddingVertical: 12, textAlign: 'right', backgroundColor: 'transparent' },
  sendButton: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 23, backgroundColor: palette.primaryDeep },
  sendDisabled: { opacity: 0.5 },
  emojiToggle: { width: 42, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 21 },
  emojiToggleActive: { backgroundColor: '#3A2B48' },
});
