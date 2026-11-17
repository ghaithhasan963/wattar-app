import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronRight, Send, Smile, UserRound } from 'lucide-react-native';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
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
  pending?: boolean;
}

const socialPalette = {
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

export default function PrivateMessageScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, profile } = useAuthStore();
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
  const listRef = useRef<FlatList<PrivateMessage>>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryMessageRef = useRef<{ body: string; key: string } | null>(null);

  const loadMessages = useCallback(async (showLoader = false) => {
    if (!id) return;
    if (showLoader) setLoading(true);
    setLoadError(null);
    try {
      const [messageResult, conversationsResult, quoteResult] = await Promise.all([
        supabase.rpc('list_private_messages', { p_conversation_id: id }),
        supabase.rpc('list_my_private_conversations'),
        supabase.rpc('get_private_message_quote', { p_conversation_id: id }),
      ]);
      if (messageResult.error) throw messageResult.error;
      if (conversationsResult.error) throw conversationsResult.error;
      if (quoteResult.error) throw quoteResult.error;
      setQuote(quoteResult.data as PrivateMessageQuote);
      const conversation = (conversationsResult.data ?? []).find(
        (item: { conversation_id: string }) => item.conversation_id === id,
      );
      if (conversation) {
        setPartnerUserId(conversation.user_id);
        setTitle(conversation.display_name || conversation.username);
        setPartnerAvatar(conversation.avatar_url ?? null);
        setPartnerOnline(conversation.is_online === true);
      }
      setMessages(((messageResult.data ?? []) as PrivateMessage[]).reverse());
      const { error: readError } = await supabase.rpc('mark_private_messages_read', {
        p_conversation_id: id,
      });
      if (readError) console.warn('[Wattar] Failed to mark private messages read:', readError.message);
    } catch (error: unknown) {
      setLoadError(error instanceof Error ? error.message : 'تحقق من اتصال الإنترنت وحاول مجددًا.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadMessages(true);
    if (!id) return;
    const channel = supabase
      .channel(`private-dm:${id}`, { config: { private: true } })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'private_messages',
        filter: `conversation_id=eq.${id}`,
      }, () => {
        void loadMessages();
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
  }, [id, loadMessages, user?.id]);

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
    setMessages((items) => [...items, {
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
      pending: true,
    }]);
    try {
      const { data, error } = await supabase.rpc('send_private_message', {
        p_conversation_id: id,
        p_body: body,
        p_idempotency_key: idempotencyKey,
        p_confirmed_price_coin: confirmedPrice,
      });
      if (error) throw error;
      // M2.5: رسالة اعترضها فلتر الكلمات — تُعاد بنجاح مع علم blocked (لا استثناء)
      const blockedResult = data as { blocked?: boolean; message?: string } | null;
      if (blockedResult?.blocked) {
        throw new Error(blockedResult.message ?? 'الرسالة تحتوي على كلمات غير مسموح بها');
      }
      retryMessageRef.current = null;
      const result = data as { message_id?: string; charged_coins?: number };
      if (result?.message_id) {
        void notifySocialEvent('private_message', result.message_id).catch((notificationError: unknown) => {
          console.warn('[Wattar] Private message push failed:', notificationError);
          Alert.alert('تعذر إرسال الإشعار', notificationError instanceof Error
            ? notificationError.message
            : 'أُرسلت الرسالة، لكن تعذر إرسال الإشعار.');
        });
      }
      await loadMessages();
    } catch (error: unknown) {
      setMessages((items) => items.filter((item) => item.message_id !== temporaryId));
      setMessage(body);
      await loadMessages();
      Alert.alert('تعذر إرسال الرسالة', error instanceof Error ? error.message : 'حاول مرة أخرى.');
    } finally {
      setSending(false);
    }
  };

  const ownAvatar = profile?.avatar_url;
  const ownLetter = (profile?.display_name || profile?.username || 'أ').slice(0, 1);

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      <View style={styles.backgroundGlowTop} />
      <View style={styles.backgroundGlowBottom} />

      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} accessibilityLabel="رجوع">
          <ChevronRight size={22} color={socialPalette.text} />
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
          onPress={() => partnerUserId && router.push(`/user/${partnerUserId}`)}
          disabled={!partnerUserId}
          accessibilityLabel="معلومات الحساب"
        >
          <UserRound size={19} color={socialPalette.muted} />
        </TouchableOpacity>
      </View>

      {loading && messages.length === 0 ? (
        <View style={styles.loading}><ActivityIndicator size="large" color={socialPalette.gold} /></View>
      ) : loadError && messages.length === 0 ? (
        <View style={styles.loadError}>
          <Text style={styles.loadErrorTitle}>تعذر تحميل المحادثة</Text>
          <Text style={styles.loadErrorText}>{loadError}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => void loadMessages(true)}>
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
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
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
                  <View style={[styles.messageBubble, ownMessage ? styles.ownBubble : styles.otherBubble]}>
                    {!ownMessage && !sameSender && <Text style={styles.senderName}>{senderLabel}</Text>}
                    <Text style={styles.messageText}>{item.body}</Text>
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
              <View style={styles.emptyIcon}><Send size={22} color={socialPalette.gold} /></View>
              <Text style={styles.emptyTitle}>لا رسائل بعد</Text>
              <Text style={styles.emptyText}>اكتب أول رسالة وابدأ المحادثة.</Text>
            </View>
          )}
          ListHeaderComponent={loadError ? (
            <Text style={styles.refreshWarning}>تعذر تحديث بعض الرسائل: {loadError}</Text>
          ) : null}
        />
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
        <View style={styles.inputShell}>
          <TextInput
            style={styles.input}
            value={message}
            onChangeText={updateTyping}
            onFocus={() => setShowEmojiPicker(false)}
            placeholder="اكتب رسالة..."
            placeholderTextColor={socialPalette.muted}
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
            <Smile size={20} color={showEmojiPicker ? socialPalette.gold : socialPalette.muted} />
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
  screen: { flex: 1, backgroundColor: socialPalette.background },
  backgroundGlowTop: { position: 'absolute', top: -120, right: -80, width: 260, height: 260, borderRadius: 130, backgroundColor: '#5B21A8', opacity: 0.16 },
  backgroundGlowBottom: { position: 'absolute', bottom: 90, left: -100, width: 240, height: 240, borderRadius: 120, backgroundColor: '#0E5E55', opacity: 0.12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 13, paddingBottom: 11, borderBottomWidth: 1, borderBottomColor: socialPalette.border, backgroundColor: 'rgba(17,12,26,0.85)' },
  backButton: { width: 42, height: 42, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: socialPalette.surface, borderWidth: 1, borderColor: socialPalette.border },
  partnerHeaderAction: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatarRing: { padding: 2, borderRadius: 26, borderWidth: 1, borderColor: '#F4BD5566' },
  partnerAvatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2A1940', overflow: 'hidden' },
  partnerAvatarImage: { width: '100%', height: '100%' },
  partnerAvatarText: { color: socialPalette.gold, fontSize: 17, fontWeight: '800' },
  headerCopy: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'flex-end' },
  title: { color: socialPalette.text, fontSize: 16, fontWeight: '800', textAlign: 'right', flexShrink: 1 },
  chatBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 7, backgroundColor: '#302312' },
  chatBadgeText: { color: socialPalette.gold, fontSize: 8, fontWeight: '800' },
  subtitle: { color: socialPalette.muted, fontSize: 10.5, marginTop: 3, textAlign: 'right' },
  typingText: { color: socialPalette.gold },
  onlineDot: { position: 'absolute', bottom: 1, right: 1, width: 12, height: 12, borderRadius: 6, backgroundColor: socialPalette.success, borderWidth: 2, borderColor: socialPalette.background },
  headerAction: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: socialPalette.surface, borderWidth: 1, borderColor: socialPalette.border },
  messageList: { flexGrow: 1, justifyContent: 'flex-end', paddingHorizontal: 12, paddingVertical: 14 },
  messageRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 7, maxWidth: '94%', marginBottom: 7 },
  messageRowTight: { marginTop: -3, marginBottom: 3 },
  ownMessageRow: { alignSelf: 'flex-end' },
  otherMessageRow: { alignSelf: 'flex-start' },
  messageAvatar: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2A1940', borderWidth: 1, borderColor: socialPalette.border, overflow: 'hidden' },
  avatarSpacer: { width: 30 },
  ownMessageAvatar: { backgroundColor: '#55209A', borderColor: '#8E3FD1' },
  messageAvatarImage: { width: '100%', height: '100%' },
  messageAvatarText: { color: socialPalette.text, fontSize: 12, fontWeight: '800' },
  messageBubble: { maxWidth: '88%', paddingHorizontal: 13, paddingVertical: 9, borderRadius: 18, borderWidth: 1 },
  ownBubble: { alignSelf: 'flex-end', backgroundColor: '#55209A', borderColor: '#8E3FD1', borderBottomRightRadius: 6 },
  otherBubble: { alignSelf: 'flex-start', backgroundColor: socialPalette.surface, borderColor: socialPalette.border, borderBottomLeftRadius: 6 },
  senderName: { color: socialPalette.gold, fontSize: 10.5, fontWeight: '800', marginBottom: 4 },
  messageText: { color: socialPalette.text, fontSize: 14.5, lineHeight: 22, textAlign: 'right' },
  billingChip: { alignSelf: 'flex-end', marginTop: 6, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 7, backgroundColor: 'rgba(244,189,85,0.12)' },
  billingNote: { color: socialPalette.gold, fontSize: 9, textAlign: 'right' },
  ownBillingNote: { color: '#FFE1A6' },
  messageMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 5, marginTop: 4 },
  messageTime: { color: socialPalette.muted, fontSize: 9 },
  ownMessageTime: { color: 'rgba(255,255,255,0.72)' },
  pendingMark: { opacity: 0.7 },
  dayDivider: { alignItems: 'center', marginVertical: 12 },
  dayPill: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20, backgroundColor: socialPalette.surface, borderWidth: 1, borderColor: socialPalette.border },
  dayLabel: { color: socialPalette.muted, fontSize: 10, fontWeight: '700' },
  typingBubbleRow: { alignSelf: 'flex-start', marginTop: 3, marginBottom: 7 },
  typingBubble: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 13, paddingVertical: 10, borderRadius: 16, backgroundColor: socialPalette.surface, borderWidth: 1, borderColor: socialPalette.border },
  typingDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: socialPalette.muted },
  typingDotMid: { opacity: 0.65 },
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 44, gap: 7 },
  emptyIcon: { width: 54, height: 54, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: '#302312' },
  emptyTitle: { color: socialPalette.text, fontSize: 16, fontWeight: '800' },
  emptyText: { color: socialPalette.muted, textAlign: 'center', marginVertical: 3, fontSize: 12.5 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadError: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, gap: 12 },
  loadErrorTitle: { color: socialPalette.text, fontSize: 18, fontWeight: '800' },
  loadErrorText: { color: socialPalette.muted, fontSize: 13, textAlign: 'center', lineHeight: 20 },
  retryButton: { paddingHorizontal: 18, paddingVertical: 11, borderRadius: 13, backgroundColor: socialPalette.primaryDeep },
  retryText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  refreshWarning: { color: '#FFC777', fontSize: 12, lineHeight: 18, marginBottom: 12, textAlign: 'center' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 12, paddingTop: 9, borderTopWidth: 1, borderTopColor: socialPalette.border, backgroundColor: 'rgba(9,6,17,0.96)' },
  pricingNotice: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: socialPalette.surface, borderTopWidth: 1, borderTopColor: socialPalette.border },
  pricingDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: socialPalette.gold },
  pricingText: { flex: 1, color: socialPalette.gold, fontSize: 10.5, textAlign: 'right' },
  inputShell: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', borderRadius: 22, borderWidth: 1, borderColor: socialPalette.border, backgroundColor: socialPalette.surface, paddingLeft: 4 },
  input: { flex: 1, minHeight: 46, maxHeight: 120, color: socialPalette.text, fontSize: 14, paddingHorizontal: 12, paddingVertical: 12, textAlign: 'right', backgroundColor: 'transparent' },
  sendButton: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 23, backgroundColor: socialPalette.primaryDeep },
  sendDisabled: { opacity: 0.5 },
  emojiToggle: { width: 42, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 21 },
  emojiToggleActive: { backgroundColor: '#3A2B48' },
  emojiTray: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 7, backgroundColor: socialPalette.surface, borderTopWidth: 1, borderTopColor: socialPalette.border },
  emojiTrayTitle: { color: socialPalette.muted, fontSize: 10, fontWeight: '700', marginBottom: 8, textAlign: 'right' },
  emojiGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 5 },
  emojiChoice: { minWidth: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#241B33' },
  emojiChoiceText: { fontSize: 21 },
});
