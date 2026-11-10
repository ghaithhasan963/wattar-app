import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft, RefreshCw, Send } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { colors } from '@/lib/theme';

interface TicketMessage {
  message_id: string;
  sender_id: string | null;
  sender_role: string;
  sender_name: string;
  body: string;
  created_at: string;
}

interface TicketDetails {
  ticket_id: string;
  subject: string;
  category: string;
  status: string;
  priority: string;
  created_at: string;
  updated_at: string;
  last_message: string;
}

const statusLabel = (status: string) => {
  if (status === 'in_progress') return 'قيد المتابعة';
  if (status === 'resolved') return 'تم الحل · أرسل ردًا لإعادة الفتح';
  if (status === 'closed') return 'مغلق · أرسل ردًا لإعادة الفتح';
  return 'مفتوح';
};

export default function SupportTicketScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const [ticket, setTicket] = useState<TicketDetails | null>(null);
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const loadTicket = useCallback(async (showLoader = true) => {
    if (!id) return;
    if (showLoader) setLoading(true);
    setError(null);
    try {
      const [ticketsResult, messagesResult] = await Promise.all([
        supabase.rpc('list_my_support_tickets', { p_limit: 50, p_offset: 0 }),
        supabase.rpc('list_support_ticket_messages', { p_ticket_id: id }),
      ]);
      if (ticketsResult.error) throw ticketsResult.error;
      if (messagesResult.error) throw messagesResult.error;
      const found = ((ticketsResult.data ?? []) as TicketDetails[])
        .find((item) => item.ticket_id === id) ?? null;
      if (!found) throw new Error('طلب الدعم غير موجود أو لم يعد متاحًا لحسابك.');
      setTicket(found);
      setMessages((messagesResult.data ?? []) as TicketMessage[]);
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : 'تعذر تحميل المحادثة.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => {
    void loadTicket();
  }, [loadTicket]));

  const sendMessage = async () => {
    const body = draft.trim();
    if (!body || sending || !id) return;
    setSending(true);
    try {
      const { error: sendError } = await supabase.rpc('send_support_ticket_message', {
        p_ticket_id: id,
        p_body: body,
      });
      if (sendError) throw sendError;
      setDraft('');
      await loadTicket(false);
    } catch (sendError: unknown) {
      setError(sendError instanceof Error ? sendError.message : 'تعذر إرسال الرد.');
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
          <ChevronLeft size={22} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>طلب دعم خاص</Text>
          <Text style={styles.title} numberOfLines={1}>{ticket?.subject ?? 'المحادثة'}</Text>
        </View>
        <TouchableOpacity
          style={styles.refreshButton}
          onPress={() => {
            void loadTicket(false);
          }}
          accessibilityRole="button"
          accessibilityLabel="تحديث المحادثة"
        >
          <RefreshCw size={17} color={colors.teal} />
        </TouchableOpacity>
      </View>

      {ticket && (
        <View style={styles.ticketStatus}>
          <View style={styles.statusDot} />
          <Text style={styles.statusText}>{statusLabel(ticket.status)}</Text>
        </View>
      )}

      {loading ? (
        <View style={styles.loading}><ActivityIndicator color={colors.primary} size="large" /></View>
      ) : (
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.messageList}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        >
          {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
          {messages.map((item) => {
            const ownMessage = item.sender_id === user?.id;
            return (
              <View key={item.message_id} style={[styles.messageRow, ownMessage && styles.ownMessageRow]}>
                <View style={[styles.bubble, ownMessage ? styles.ownBubble : styles.staffBubble]}>
                  <Text style={[styles.senderName, ownMessage && styles.ownSenderName]}>
                    {ownMessage ? 'أنت' : item.sender_name || 'فريق الدعم'}
                  </Text>
                  <Text style={styles.messageText}>{item.body}</Text>
                  <Text style={[styles.time, ownMessage && styles.ownTime]}>
                    {new Date(item.created_at).toLocaleString('ar', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}
                  </Text>
                </View>
              </View>
            );
          })}
          {messages.length === 0 && <Text style={styles.empty}>لا توجد رسائل في هذا الطلب.</Text>}
        </ScrollView>
      )}

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="اكتب ردًا لفريق الدعم..."
          placeholderTextColor={colors.textSecondary}
          multiline
          maxLength={3000}
          editable={!sending}
          accessibilityLabel="رسالة للدعم"
        />
        <TouchableOpacity
          style={[styles.sendButton, (!draft.trim() || sending) && styles.disabled]}
          onPress={() => void sendMessage()}
          disabled={!draft.trim() || sending}
          accessibilityRole="button"
          accessibilityLabel="إرسال الرد"
        >
          {sending ? <ActivityIndicator size="small" color="#fff" /> : <Send size={18} color="#fff" />}
        </TouchableOpacity>
      </View>
      <Text style={styles.privacyNote}>لا تشارك كلمات المرور أو رموز التحقق ضمن المحادثة.</Text>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 16, paddingTop: 58, paddingBottom: 14 },
  backButton: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  headerCopy: { flex: 1, minWidth: 0 },
  eyebrow: { color: colors.teal, fontSize: 9, fontWeight: '900' },
  title: { color: colors.text, fontSize: 16, fontWeight: '900', marginTop: 3 },
  refreshButton: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.tealSoft },
  ticketStatus: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, alignSelf: 'center', paddingHorizontal: 11, paddingVertical: 6, borderRadius: 11, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.teal },
  statusText: { color: colors.textSecondary, fontSize: 10, fontWeight: '700' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  messageList: { flexGrow: 1, padding: 16, paddingBottom: 24, gap: 11 },
  messageRow: { flexDirection: 'row', justifyContent: 'flex-start' },
  ownMessageRow: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '84%', padding: 12, borderRadius: 16, borderWidth: 1 },
  ownBubble: { backgroundColor: colors.primarySoft, borderColor: colors.primary, borderBottomRightRadius: 5 },
  staffBubble: { backgroundColor: colors.surface, borderColor: colors.border, borderBottomLeftRadius: 5 },
  senderName: { color: colors.teal, fontSize: 9, fontWeight: '900', textAlign: 'right', marginBottom: 5 },
  ownSenderName: { color: '#D8BCFF' },
  messageText: { color: colors.text, fontSize: 12, lineHeight: 19, textAlign: 'right' },
  time: { color: colors.textSecondary, fontSize: 9, textAlign: 'left', marginTop: 7 },
  ownTime: { textAlign: 'right' },
  empty: { color: colors.textSecondary, textAlign: 'center', marginTop: 24, fontSize: 12 },
  error: { color: colors.danger, fontSize: 11, textAlign: 'right', marginBottom: 10 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 9, paddingHorizontal: 14, paddingTop: 11, borderTopWidth: 1, borderTopColor: colors.border },
  input: { flex: 1, minHeight: 46, maxHeight: 120, paddingHorizontal: 13, paddingVertical: 11, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, color: colors.text, fontSize: 12, textAlign: 'right' },
  sendButton: { width: 45, height: 45, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
  disabled: { opacity: 0.45 },
  privacyNote: { color: colors.textSecondary, fontSize: 9, textAlign: 'center', paddingTop: 7, paddingBottom: 12 },
});
