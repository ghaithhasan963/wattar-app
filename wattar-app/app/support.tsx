import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { ChevronLeft, CircleHelp, Plus, Send, TicketCheck } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';

interface SupportTicket {
  ticket_id: string;
  subject: string;
  category: string;
  status: string;
  priority: string;
  created_at: string;
  updated_at: string;
  last_message: string;
}

const categories = [
  { id: 'account', label: 'الحساب' },
  { id: 'deposit', label: 'الشحن' },
  { id: 'withdrawal', label: 'السحب' },
  { id: 'technical', label: 'مشكلة تقنية' },
  { id: 'report', label: 'بلاغ' },
  { id: 'other', label: 'أخرى' },
] as const;

const ticketStatus = (status: string) => {
  if (status === 'in_progress') return 'قيد المتابعة';
  if (status === 'resolved') return 'تم الحل';
  if (status === 'closed') return 'مغلق';
  return 'مفتوح';
};

export default function SupportScreen() {
  const router = useRouter();
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createVisible, setCreateVisible] = useState(false);
  const [category, setCategory] = useState<(typeof categories)[number]['id']>('other');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadTickets = useCallback(async (showLoader = true) => {
    if (showLoader) setLoading(true);
    setError(null);
    try {
      const { data, error: queryError } = await supabase.rpc('list_my_support_tickets', {
        p_limit: 50,
        p_offset: 0,
      });
      if (queryError) throw queryError;
      setTickets((data ?? []) as SupportTicket[]);
    } catch (loadError: unknown) {
      const message = loadError instanceof Error ? loadError.message : 'تعذر تحميل طلبات الدعم.';
      setError(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void loadTickets();
  }, [loadTickets]));

  const submitTicket = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const { data, error: createError } = await supabase.rpc('create_support_ticket', {
        p_category: category,
        p_subject: subject.trim(),
        p_body: body.trim(),
      });
      if (createError) throw createError;
      const result = data as { ticket_id?: string } | null;
      if (!result?.ticket_id) throw new Error('لم يصل رقم طلب الدعم.');
      setCreateVisible(false);
      setSubject('');
      setBody('');
      router.push(`/support/${result.ticket_id}`);
    } catch (createError: unknown) {
      setError(createError instanceof Error ? createError.message : 'تعذر إرسال طلب الدعم.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} accessibilityLabel="رجوع">
          <ChevronLeft size={22} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>WATTAR · مساعدة مباشرة</Text>
          <Text style={styles.title}>مركز الدعم</Text>
        </View>
        <View style={styles.headerIcon}><CircleHelp size={22} color={colors.teal} /></View>
      </View>

      <View style={styles.introCard}>
        <View style={styles.introIcon}><TicketCheck size={20} color={colors.primary} /></View>
        <View style={styles.introCopy}>
          <Text style={styles.introTitle}>نحن هنا لمساعدتك</Text>
          <Text style={styles.introText}>أنشئ طلبًا مع وصف واضح، وتابع الردود وحالة المعالجة من هنا.</Text>
        </View>
      </View>

      <View style={styles.sectionHeading}>
        <View>
          <Text style={styles.sectionTitle}>طلباتي</Text>
          <Text style={styles.sectionHint}>متابعة خاصة بينك وبين فريق الدعم</Text>
        </View>
        <TouchableOpacity style={styles.newButton} onPress={() => setCreateVisible(true)} accessibilityRole="button">
          <Plus size={17} color="#fff" />
          <Text style={styles.newButtonText}>طلب جديد</Text>
        </TouchableOpacity>
      </View>

      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
      {loading ? (
        <View style={styles.loading}><ActivityIndicator color={colors.primary} size="large" /></View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => {
            setRefreshing(true);
            void loadTickets(false);
          }} tintColor={colors.primary} />}
        >
          {tickets.map((ticket) => (
            <TouchableOpacity
              key={ticket.ticket_id}
              style={styles.ticketCard}
              onPress={() => router.push(`/support/${ticket.ticket_id}`)}
              accessibilityRole="button"
              accessibilityLabel={`طلب ${ticket.subject}، الحالة ${ticketStatus(ticket.status)}`}
            >
              <View style={styles.ticketTop}>
                <View style={[styles.statusPill, ticket.status === 'resolved' && styles.statusResolved]}>
                  <Text style={styles.statusText}>{ticketStatus(ticket.status)}</Text>
                </View>
                <Text style={styles.ticketDate}>
                  {new Date(ticket.updated_at).toLocaleDateString('ar', { day: 'numeric', month: 'short' })}
                </Text>
              </View>
              <Text style={styles.ticketSubject}>{ticket.subject}</Text>
              <Text style={styles.ticketPreview} numberOfLines={2}>{ticket.last_message}</Text>
              <Text style={styles.ticketCategory}>
                {categories.find((item) => item.id === ticket.category)?.label ?? 'أخرى'}
              </Text>
            </TouchableOpacity>
          ))}
          {tickets.length === 0 && (
            <View style={styles.empty}>
              <TicketCheck size={28} color={colors.textSecondary} />
              <Text style={styles.emptyTitle}>لا توجد طلبات بعد</Text>
              <Text style={styles.emptyText}>سيظهر طلبك هنا بمجرد إرساله.</Text>
            </View>
          )}
        </ScrollView>
      )}

      <Modal visible={createVisible} animationType="slide" transparent onRequestClose={() => setCreateVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>فتح طلب دعم</Text>
              <TouchableOpacity onPress={() => setCreateVisible(false)} accessibilityLabel="إغلاق">
                <Text style={styles.cancelText}>إلغاء</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.fieldLabel}>التصنيف</Text>
            <View style={styles.categoryGrid}>
              {categories.map((item) => (
                <TouchableOpacity
                  key={item.id}
                  style={[styles.categoryChip, category === item.id && styles.categoryChipActive]}
                  onPress={() => setCategory(item.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: category === item.id }}
                >
                  <Text style={[styles.categoryText, category === item.id && styles.categoryTextActive]}>{item.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.fieldLabel}>عنوان الطلب</Text>
            <TextInput
              style={styles.modalInput}
              value={subject}
              onChangeText={setSubject}
              placeholder="مثال: مشكلة في طلب الشحن"
              placeholderTextColor={colors.textSecondary}
              maxLength={120}
            />
            <Text style={styles.fieldLabel}>اشرح المشكلة</Text>
            <TextInput
              style={[styles.modalInput, styles.bodyInput]}
              value={body}
              onChangeText={setBody}
              placeholder="اكتب التفاصيل التي تساعدنا على فهم المشكلة..."
              placeholderTextColor={colors.textSecondary}
              multiline
              textAlignVertical="top"
              maxLength={3000}
            />
            <Text style={styles.privacyNote}>لا تكتب كلمة المرور أو رمز التحقق أو بيانات بطاقتك.</Text>
            <TouchableOpacity
              style={[styles.submitButton, submitting && styles.disabled]}
              onPress={() => void submitTicket()}
              disabled={submitting || subject.trim().length < 5 || body.trim().length < 10}
              accessibilityRole="button"
            >
              {submitting ? <ActivityIndicator color="#fff" /> : <Send size={17} color="#fff" />}
              <Text style={styles.submitText}>{submitting ? 'جارٍ الإرسال...' : 'إرسال الطلب'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingTop: 58, paddingBottom: 16 },
  backButton: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  headerCopy: { flex: 1 },
  eyebrow: { color: colors.teal, fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  title: { color: colors.text, fontSize: 23, fontWeight: '900', marginTop: 3 },
  headerIcon: { width: 42, height: 42, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.tealSoft },
  introCard: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  introIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: colors.primarySoft },
  introCopy: { flex: 1, gap: 4 },
  introTitle: { color: colors.text, fontSize: 13, fontWeight: '900', textAlign: 'right' },
  introText: { color: colors.textSecondary, fontSize: 10, lineHeight: 16, textAlign: 'right' },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: 18, marginTop: 24, marginBottom: 12 },
  sectionTitle: { color: colors.text, fontSize: 17, fontWeight: '900', textAlign: 'right' },
  sectionHint: { color: colors.textSecondary, fontSize: 10, marginTop: 4, textAlign: 'right' },
  newButton: { minHeight: 40, paddingHorizontal: 12, borderRadius: 13, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.primary },
  newButtonText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  list: { paddingHorizontal: 16, paddingBottom: 28, gap: 10 },
  ticketCard: { padding: 14, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  ticketTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statusPill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: colors.primarySoft },
  statusResolved: { backgroundColor: colors.successSoft },
  statusText: { color: colors.teal, fontSize: 9, fontWeight: '800' },
  ticketDate: { color: colors.textSecondary, fontSize: 10 },
  ticketSubject: { color: colors.text, fontSize: 14, fontWeight: '800', textAlign: 'right', marginTop: 10 },
  ticketPreview: { color: colors.textSecondary, fontSize: 11, lineHeight: 17, textAlign: 'right', marginTop: 5 },
  ticketCategory: { color: colors.gold, fontSize: 10, fontWeight: '700', textAlign: 'right', marginTop: 9 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  error: { marginHorizontal: 18, marginBottom: 8, color: colors.danger, fontSize: 11, textAlign: 'right' },
  empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 48, gap: 8 },
  emptyTitle: { color: colors.text, fontSize: 14, fontWeight: '800' },
  emptyText: { color: colors.textSecondary, fontSize: 11 },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0009' },
  modal: { padding: 18, paddingBottom: 28, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 15 },
  modalTitle: { color: colors.text, fontSize: 17, fontWeight: '900' },
  cancelText: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  fieldLabel: { color: colors.text, fontSize: 11, fontWeight: '800', textAlign: 'right', marginTop: 11, marginBottom: 7 },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  categoryChip: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
  categoryChipActive: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  categoryText: { color: colors.textSecondary, fontSize: 10, fontWeight: '700' },
  categoryTextActive: { color: colors.text },
  modalInput: { minHeight: 46, paddingHorizontal: 12, borderRadius: 12, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, color: colors.text, textAlign: 'right', fontSize: 12 },
  bodyInput: { minHeight: 96, paddingTop: 12 },
  privacyNote: { color: colors.gold, fontSize: 10, lineHeight: 15, textAlign: 'right', marginTop: 8 },
  submitButton: { minHeight: 48, borderRadius: 14, marginTop: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.primary },
  submitText: { color: '#fff', fontSize: 13, fontWeight: '900' },
  disabled: { opacity: 0.5 },
});
