import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Image,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronRight, Send, Smile } from 'lucide-react-native';
import type { RealtimeChannel } from '@supabase/supabase-js';
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
  border: '#352449',
  text: '#F8F3FF',
  muted: '#B2A6C3',
  primaryDeep: '#7624D7',
  gold: '#F4BD55',
} as const;
const CHAT_EMOJIS = ['😀', '😂', '🥰', '😍', '🤩', '😎', '🥳', '😭', '👏', '🔥', '❤️', '🌹', '🎉', '✨', '💎', '🎁'];

export default function PrivateMessageScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
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

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 84 : 0}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} accessibilityLabel="رجوع">
          <ChevronRight size={22} color={colors.textSecondary} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.partnerHeaderAction}
          onPress={() => partnerUserId && router.push(`/user/${partnerUserId}`)}
          disabled={!partnerUserId}
          accessibilityRole="button"
          accessibilityLabel="فتح الملف الشخصي"
        >
        <View style={styles.partnerAvatar}>
          {partnerAvatar
            ? <Image source={{ uri: partnerAvatar }} style={styles.partnerAvatarImage} />
            : <Text style={styles.partnerAvatarText}>{title.slice(0, 1).toUpperCase()}</Text>}
        </View>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>
            {partnerTyping ? 'يكتب الآن...' : partnerOnline ? 'متصل الآن' : getConversationSubtitle(quote)}
          </Text>
        </View>
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
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          renderItem={({ item }) => {
            const ownMessage = item.sender_id === user?.id;
            return (
              <View style={[styles.messageRow, ownMessage && styles.ownMessageRow]}>
                {!ownMessage && (
                  <View style={styles.messageAvatar}>
                    {item.avatar_url
                      ? <Image source={{ uri: item.avatar_url }} style={styles.messageAvatarImage} />
                      : <Text style={styles.messageAvatarText}>{(item.display_name || item.username || '؟').slice(0, 1)}</Text>}
                  </View>
                )}
                <View style={[styles.messageBubble, ownMessage ? styles.ownBubble : styles.otherBubble]}>
                  {!ownMessage && <Text style={styles.senderName}>{item.display_name || item.username}</Text>}
                  <Text style={styles.messageText}>{item.body}</Text>
                  {item.charged_coins > 0 && (
                    <Text style={[styles.billingNote, ownMessage && styles.ownMessageTime]}>
                      {item.charged_coins.toLocaleString()} Coin
                      {item.host_commission_diamonds > 0
                        ? ` · ${item.host_commission_diamonds.toLocaleString()} Diamond للمضيفة`
                        : ''}
                    </Text>
                  )}
                  <Text style={[styles.messageTime, ownMessage && styles.ownMessageTime]}>
                    {new Date(item.created_at).toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' })}
                    {ownMessage && item.pending ? ' · جارٍ الإرسال' : ownMessage && item.read_at ? ' · تمت القراءة' : ownMessage ? ' · أُرسلت' : ''}
                  </Text>
                </View>
                {ownMessage && (
                  <View style={[styles.messageAvatar, styles.ownMessageAvatar]}>
                    {profile?.avatar_url
                      ? <Image source={{ uri: profile.avatar_url }} style={styles.messageAvatarImage} />
                      : <Text style={styles.messageAvatarText}>{(profile?.display_name || profile?.username || 'أ').slice(0, 1)}</Text>}
                  </View>
                )}
              </View>
            );
          }}
          ListEmptyComponent={<Text style={styles.emptyText}>ابدأ أول محادثة بينكما.</Text>}
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
          <Text style={styles.pricingText}>
            {getPricingNotice(quote)}
          </Text>
        </View>
      )}
      <View style={styles.composer}>
        <TouchableOpacity
          style={[styles.emojiToggle, showEmojiPicker && styles.emojiToggleActive]}
          onPress={() => setShowEmojiPicker((visible) => !visible)}
          accessibilityRole="button"
          accessibilityLabel={showEmojiPicker ? 'إغلاق لوحة الإيموجي' : 'فتح لوحة الإيموجي'}
        >
          <Smile size={19} color={showEmojiPicker ? socialPalette.gold : socialPalette.muted} />
        </TouchableOpacity>
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
          style={[styles.sendButton, (!message.trim() || sending) && styles.sendDisabled]}
          onPress={send}
          disabled={!message.trim() || sending || quote === null}
          accessibilityRole="button"
          accessibilityLabel="إرسال الرسالة"
        >
          {sending ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Send size={18} color="#FFFFFF" />}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: socialPalette.background },
  header: { minHeight: 82, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 15, paddingTop: Platform.OS === 'android' ? 8 : 24, borderBottomWidth: 1, borderBottomColor: socialPalette.border },
  backButton: { width: 42, height: 42, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: socialPalette.surface },
  partnerHeaderAction: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 11 },
  partnerAvatar: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2A1940', borderWidth: 1, borderColor: socialPalette.gold, overflow: 'hidden' },
  partnerAvatarImage: { width: '100%', height: '100%' },
  partnerAvatarText: { color: socialPalette.gold, fontSize: 17, fontWeight: '800' },
  headerCopy: { flex: 1 },
  title: { color: socialPalette.text, fontSize: 17, fontWeight: '800', textAlign: 'right' },
  subtitle: { color: socialPalette.muted, fontSize: 11, marginTop: 4, textAlign: 'right' },
  messageList: { flexGrow: 1, justifyContent: 'flex-end', paddingHorizontal: 14, paddingVertical: 18, gap: 10 },
  messageRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 7, maxWidth: '94%', alignSelf: 'flex-start' },
  ownMessageRow: { alignSelf: 'flex-end' },
  messageAvatar: { width: 29, height: 29, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2A1940', borderWidth: 1, borderColor: socialPalette.border, overflow: 'hidden' },
  ownMessageAvatar: { backgroundColor: '#55209A', borderColor: '#8E3FD1' },
  messageAvatarImage: { width: '100%', height: '100%' },
  messageAvatarText: { color: socialPalette.text, fontSize: 12, fontWeight: '800' },
  messageBubble: { maxWidth: '88%', paddingHorizontal: 14, paddingVertical: 11, borderRadius: 18, borderWidth: 1 },
  ownBubble: { alignSelf: 'flex-end', backgroundColor: '#55209A', borderColor: '#8E3FD1', borderBottomRightRadius: 5 },
  otherBubble: { alignSelf: 'flex-start', backgroundColor: socialPalette.surface, borderColor: socialPalette.border, borderBottomLeftRadius: 5 },
  senderName: { color: socialPalette.gold, fontSize: 11, fontWeight: '700', marginBottom: 4 },
  messageText: { color: socialPalette.text, fontSize: 15, lineHeight: 22, textAlign: 'right' },
  billingNote: { color: socialPalette.gold, fontSize: 10, textAlign: 'right', marginTop: 5 },
  messageTime: { color: socialPalette.muted, fontSize: 10, textAlign: 'right', marginTop: 6 },
  ownMessageTime: { color: 'rgba(255,255,255,0.75)' },
  emptyText: { color: socialPalette.muted, textAlign: 'center', marginVertical: 32, fontSize: 13 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadError: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, gap: 12 },
  loadErrorTitle: { color: socialPalette.text, fontSize: 18, fontWeight: '800' },
  loadErrorText: { color: socialPalette.muted, fontSize: 13, textAlign: 'center', lineHeight: 20 },
  retryButton: { paddingHorizontal: 18, paddingVertical: 11, borderRadius: 13, backgroundColor: socialPalette.primaryDeep },
  retryText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  refreshWarning: { color: '#FFC777', fontSize: 12, lineHeight: 18, marginBottom: 12, textAlign: 'center' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 9, paddingHorizontal: 12, paddingVertical: 11, borderTopWidth: 1, borderTopColor: socialPalette.border, backgroundColor: socialPalette.background },
  pricingNotice: { paddingHorizontal: 14, paddingVertical: 7, backgroundColor: socialPalette.surface, borderTopWidth: 1, borderTopColor: socialPalette.border },
  pricingText: { color: socialPalette.gold, fontSize: 11, textAlign: 'right' },
  input: { flex: 1, minHeight: 48, maxHeight: 120, color: socialPalette.text, fontSize: 14, paddingHorizontal: 14, paddingVertical: 11, textAlign: 'right', borderWidth: 1, borderColor: socialPalette.border, borderRadius: 16, backgroundColor: socialPalette.surface },
  sendButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: socialPalette.primaryDeep },
  sendDisabled: { opacity: 0.55 },
  emojiTray: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 7, backgroundColor: socialPalette.surface, borderTopWidth: 1, borderTopColor: socialPalette.border },
  emojiTrayTitle: { color: socialPalette.muted, fontSize: 10, fontWeight: '700', marginBottom: 8, textAlign: 'right' },
  emojiGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 5 },
  emojiChoice: { minWidth: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#241B33' },
  emojiChoiceText: { fontSize: 21 },
  emojiToggle: { width: 42, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 15, backgroundColor: socialPalette.surface },
  emojiToggleActive: { backgroundColor: '#3A2B48' },
});
