import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { ArrowRight, Check, Clock3, Flag, Send, Shield, Users } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';

interface AgentGroup {
  group_id: string;
  agent_id: string;
  agent_name: string;
  group_name: string;
  membership_id: string | null;
  membership_status: 'pending' | 'active' | null;
  is_agent?: boolean;
}

interface GroupMessage {
  message_id: string;
  sender_id: string;
  sender_name: string;
  sender_avatar: string | null;
  body: string;
  created_at: string;
}

interface GroupMember {
  membership_id: string;
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  membership_status: 'pending' | 'active' | string;
  requested_at: string;
  muted_until: string | null;
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
  success: '#43D69A',
  danger: '#FF718E',
} as const;

export default function AgentGroupScreen() {
  const router = useRouter();
  const [groups, setGroups] = useState<AgentGroup[]>([]);
  const [availableGroups, setAvailableGroups] = useState<AgentGroup[]>([]);
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedGroup = groups.find((group) => group.group_id === selectedGroupId)
    ?? groups.find((group) => group.membership_status === 'active' || group.is_agent)
    ?? null;

  const loadScreen = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const [myGroupsResult, availableResult] = await Promise.all([
        supabase.rpc('list_my_agent_groups'),
        supabase.rpc('list_available_agent_groups'),
      ]);
      if (myGroupsResult.error) throw myGroupsResult.error;
      if (availableResult.error) throw availableResult.error;

      const myGroups = (myGroupsResult.data ?? []) as AgentGroup[];
      const available = (availableResult.data ?? []) as AgentGroup[];
      setGroups(myGroups);
      setAvailableGroups(available);

      const preferredGroup = myGroups.find((group) => group.is_agent)
        ?? myGroups.find((group) => group.membership_status === 'active');
      const groupId = myGroups.some((group) => group.group_id === selectedGroupId)
        ? selectedGroupId
        : preferredGroup?.group_id ?? null;
      setSelectedGroupId(groupId);

      if (!groupId) {
        setMessages([]);
        setMembers([]);
        return;
      }

      const group = myGroups.find((item) => item.group_id === groupId);
      const messagesResult = await supabase.rpc('list_agent_group_messages', {
        p_group_id: groupId,
        p_before: null,
      });
      if (messagesResult.error) throw messagesResult.error;
      setMessages(((messagesResult.data ?? []) as GroupMessage[]).reverse());

      if (group?.is_agent) {
        const membersResult = await supabase.rpc('list_agent_group_members', {
          p_group_id: groupId,
        });
        if (membersResult.error) throw membersResult.error;
        setMembers((membersResult.data ?? []) as GroupMember[]);
      } else {
        setMembers([]);
      }
    } catch (loadError: unknown) {
      const message = loadError instanceof Error ? loadError.message : 'تعذر تحميل مجموعة الوكيل.';
      setError(message);
      if (showLoading) Alert.alert('تعذر تحميل المجموعة', message);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [selectedGroupId]);

  useEffect(() => {
    void loadScreen();
    const timer = setInterval(() => {
      void loadScreen(false).catch((refreshError: unknown) => {
        console.error('[Wattar] Failed to refresh agent group:', refreshError);
      });
    }, 10000);
    return () => clearInterval(timer);
  }, [loadScreen]);

  const requestMembership = async (agentId: string) => {
    setBusy(true);
    try {
      const { error: requestError } = await supabase.rpc('request_agent_group_membership', {
        p_agent_id: agentId,
      });
      if (requestError) throw requestError;
      Alert.alert('تم إرسال الطلب', 'بانتظار موافقة الوكيل أو الإدارة.');
      await loadScreen();
    } catch (requestError: unknown) {
      Alert.alert('تعذر إرسال الطلب', requestError instanceof Error ? requestError.message : 'حاول مرة أخرى.');
    } finally {
      setBusy(false);
    }
  };

  const reviewMembership = async (membershipId: string, accept: boolean) => {
    setBusy(true);
    try {
      const { error: reviewError } = await supabase.rpc('review_agent_group_membership', {
        p_membership_id: membershipId,
        p_accept: accept,
      });
      if (reviewError) throw reviewError;
      await loadScreen();
    } catch (reviewError: unknown) {
      Alert.alert('تعذر تحديث الطلب', reviewError instanceof Error ? reviewError.message : 'حاول مرة أخرى.');
    } finally {
      setBusy(false);
    }
  };

  const moderateMember = async (member: GroupMember, action: 'mute' | 'unmute' | 'remove') => {
    setBusy(true);
    try {
      const { error: moderationError } = await supabase.rpc('moderate_agent_group_member', {
        p_membership_id: member.membership_id,
        p_action: action,
      });
      if (moderationError) throw moderationError;
      await loadScreen();
    } catch (moderationError: unknown) {
      Alert.alert('تعذر تنفيذ الإجراء', moderationError instanceof Error ? moderationError.message : 'حاول مرة أخرى.');
    } finally {
      setBusy(false);
    }
  };

  const reportMessage = (message: GroupMessage) => {
    Alert.alert('الإبلاغ عن الرسالة', 'سيصل البلاغ إلى فريق الإشراف.', [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'إبلاغ',
        style: 'destructive',
        onPress: async () => {
          const { error: reportError } = await supabase.rpc('report_agent_group_message', {
            p_message_id: message.message_id,
            p_reason: 'محتوى غير مناسب',
          });
          if (reportError) Alert.alert('تعذر إرسال البلاغ', reportError.message);
          else Alert.alert('تم استلام البلاغ', 'سيراجعه فريق Wattar.');
        },
      },
    ]);
  };

  const sendMessage = async () => {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      const { error: sendError } = await supabase.rpc('send_agent_group_message', {
        p_body: body,
      });
      if (sendError) throw sendError;
      setDraft('');
      await loadScreen(false);
    } catch (sendError: unknown) {
      Alert.alert('تعذر إرسال الرسالة', sendError instanceof Error ? sendError.message : 'حاول مرة أخرى.');
    } finally {
      setBusy(false);
    }
  };

  const myPendingAgentIds = new Set(
    groups.filter((group) => group.membership_status === 'pending').map((group) => group.agent_id),
  );
  const hasActiveGroup = Boolean(
    selectedGroup && (selectedGroup.membership_status === 'active' || selectedGroup.is_agent),
  );

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} accessibilityRole="button">
          <ArrowRight size={20} color={palette.text} />
        </TouchableOpacity>
        <View style={styles.titleIcon}><Users size={20} color={palette.gold} /></View>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>مجموعة الوكيل</Text>
          <Text style={styles.subtitle}>مجموعة خاصة ومحادثة بإشراف الوكيل</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => loadScreen()} tintColor={palette.gold} />}
      >
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {selectedGroup && hasActiveGroup ? (
          <View style={styles.card}>
            <View style={styles.groupHeading}>
              <View style={styles.groupIcon}><Shield size={19} color={palette.gold} /></View>
              <View style={styles.headerCopy}>
                <Text style={styles.cardTitle}>{selectedGroup.group_name}</Text>
                <Text style={styles.meta}>بإشراف {selectedGroup.agent_name}</Text>
              </View>
              <View style={styles.privateBadge}><Text style={styles.privateText}>خاصة</Text></View>
            </View>

            <View style={styles.messageList}>
              {messages.length ? messages.map((message) => (
                <View key={message.message_id} style={styles.messageRow}>
                  {message.sender_avatar
                    ? <Image source={{ uri: message.sender_avatar }} style={styles.avatar} />
                    : <View style={[styles.avatar, styles.avatarFallback]}><Text style={styles.avatarLetter}>{message.sender_name.slice(0, 1)}</Text></View>}
                  <View style={styles.messageBody}>
                    <View style={styles.messageTop}>
                      <Text style={styles.sender}>{message.sender_name}</Text>
                      <Text style={styles.time}>{new Date(message.created_at).toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' })}</Text>
                    </View>
                    <Text style={styles.messageText}>{message.body}</Text>
                  </View>
                  {!selectedGroup.is_agent ? (
                    <TouchableOpacity onPress={() => reportMessage(message)} accessibilityLabel="الإبلاغ عن الرسالة">
                      <Flag size={16} color={palette.muted} />
                    </TouchableOpacity>
                  ) : null}
                </View>
              )) : <Text style={styles.empty}>لا توجد رسائل بعد. ابدأ الحديث مع مجموعتك.</Text>}
            </View>

            <View style={styles.composer}>
              <TextInput
                style={styles.input}
                value={draft}
                onChangeText={setDraft}
                placeholder="اكتب رسالة للمجموعة..."
                placeholderTextColor={palette.muted}
                maxLength={2000}
                multiline
              />
              <TouchableOpacity
                style={[styles.sendButton, (!draft.trim() || busy) && styles.disabled]}
                onPress={sendMessage}
                disabled={!draft.trim() || busy}
                accessibilityRole="button"
                accessibilityLabel="إرسال الرسالة"
              >
                {busy ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Send size={17} color="#FFFFFF" />}
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {selectedGroup?.membership_status === 'pending' && !hasActiveGroup ? (
          <View style={styles.statusCard}>
            <Clock3 size={20} color={palette.gold} />
            <View style={styles.headerCopy}>
              <Text style={styles.cardTitle}>طلبك قيد المراجعة</Text>
              <Text style={styles.meta}>ستظهر المجموعة بعد موافقة الوكيل أو الإدارة.</Text>
            </View>
          </View>
        ) : null}

        {!hasActiveGroup ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>اختر وكيلًا للانضمام</Text>
            <Text style={styles.sectionHint}>المحفظة والشحن يتاحان بعد قبول طلبك من وكيل نشط.</Text>
            {availableGroups.map((group) => {
              const isPending = group.membership_status === 'pending' || myPendingAgentIds.has(group.agent_id);
              const isActive = group.membership_status === 'active';
              return (
                <View key={group.group_id} style={styles.agentCard}>
                  <View style={styles.groupIcon}><Users size={18} color={palette.primary} /></View>
                  <View style={styles.headerCopy}>
                    <Text style={styles.cardTitle}>{group.agent_name}</Text>
                    <Text style={styles.meta}>{group.group_name} · مجموعة خاصة</Text>
                  </View>
                  {isActive ? (
                    <Text style={styles.activeText}>عضو</Text>
                  ) : (
                    <TouchableOpacity
                      style={[styles.requestButton, (isPending || busy) && styles.disabled]}
                      onPress={() => requestMembership(group.agent_id)}
                      disabled={isPending || busy}
                    >
                      <Text style={styles.requestText}>{isPending ? 'قيد المراجعة' : 'طلب انضمام'}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
            {!availableGroups.length && !loading ? (
              <Text style={styles.empty}>لا يوجد وكلاء نشطون متاحون حاليًا.</Text>
            ) : null}
          </View>
        ) : null}

        {selectedGroup?.is_agent ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>إدارة الأعضاء والطلبات</Text>
            {members.map((member) => (
              <View key={member.membership_id} style={styles.memberRow}>
                <View style={styles.headerCopy}>
                  <Text style={styles.cardTitle}>{member.display_name || member.username}</Text>
                  <Text style={styles.meta}>
                    {member.membership_status === 'pending' ? 'طلب انضمام جديد' : `@${member.username}`}
                  </Text>
                </View>
                {member.membership_status === 'pending' ? (
                  <>
                    <TouchableOpacity onPress={() => reviewMembership(member.membership_id, true)} disabled={busy} style={styles.iconAction}>
                      <Check size={18} color={palette.success} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => reviewMembership(member.membership_id, false)} disabled={busy} style={styles.iconAction}>
                      <Text style={styles.decline}>رفض</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    <TouchableOpacity
                      onPress={() => moderateMember(member, member.muted_until ? 'unmute' : 'mute')}
                      disabled={busy}
                      style={styles.iconAction}
                    >
                      <Text style={styles.decline}>{member.muted_until ? 'إلغاء الكتم' : 'كتم 24س'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => Alert.alert('إزالة العضو؟', 'سيحتاج إلى طلب جديد للانضمام مرة أخرى.', [
                        { text: 'إلغاء', style: 'cancel' },
                        { text: 'إزالة', style: 'destructive', onPress: () => { void moderateMember(member, 'remove'); } },
                      ])}
                      disabled={busy}
                      style={styles.iconAction}
                    >
                      <Text style={styles.decline}>إزالة</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            ))}
            {!members.length ? <Text style={styles.empty}>لا توجد طلبات أو أعضاء لعرضهم.</Text> : null}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingTop: 54, paddingBottom: 16 },
  backButton: { width: 38, height: 38, borderRadius: 13, backgroundColor: palette.surface, alignItems: 'center', justifyContent: 'center' },
  titleIcon: { width: 44, height: 44, borderRadius: 15, backgroundColor: '#28153D', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#56306D' },
  headerCopy: { flex: 1 },
  title: { color: palette.text, fontSize: 21, fontWeight: '800', textAlign: 'right' },
  subtitle: { color: palette.muted, fontSize: 12, marginTop: 3, textAlign: 'right' },
  content: { paddingHorizontal: 14, paddingBottom: 40, gap: 16 },
  card: { backgroundColor: palette.surface, borderRadius: 20, borderWidth: 1, borderColor: palette.border, padding: 14 },
  groupHeading: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: palette.border },
  groupIcon: { width: 40, height: 40, borderRadius: 14, backgroundColor: palette.elevated, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { color: palette.text, fontSize: 14, fontWeight: '700', textAlign: 'right' },
  meta: { color: palette.muted, fontSize: 11, marginTop: 3, textAlign: 'right' },
  privateBadge: { backgroundColor: '#302312', borderRadius: 10, paddingHorizontal: 9, paddingVertical: 5 },
  privateText: { color: palette.gold, fontSize: 10, fontWeight: '700' },
  messageList: { gap: 12, paddingVertical: 14 },
  messageRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  avatar: { width: 34, height: 34, borderRadius: 17 },
  avatarFallback: { backgroundColor: palette.elevated, alignItems: 'center', justifyContent: 'center' },
  avatarLetter: { color: palette.gold, fontWeight: '700' },
  messageBody: { flex: 1, backgroundColor: palette.elevated, borderRadius: 13, padding: 10 },
  messageTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 },
  sender: { color: palette.gold, fontSize: 11, fontWeight: '700' },
  time: { color: palette.muted, fontSize: 9 },
  messageText: { color: palette.text, fontSize: 13, lineHeight: 19, textAlign: 'right' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 9, borderTopWidth: 1, borderTopColor: palette.border, paddingTop: 12 },
  input: { flex: 1, minHeight: 42, maxHeight: 100, backgroundColor: palette.elevated, borderRadius: 13, paddingHorizontal: 12, paddingVertical: 10, color: palette.text, textAlign: 'right', fontSize: 13 },
  sendButton: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.primary },
  disabled: { opacity: 0.5 },
  section: { backgroundColor: palette.surface, borderRadius: 20, borderWidth: 1, borderColor: palette.border, padding: 14, gap: 10 },
  sectionTitle: { color: palette.text, fontSize: 15, fontWeight: '800', textAlign: 'right' },
  sectionHint: { color: palette.muted, fontSize: 12, lineHeight: 18, textAlign: 'right', marginBottom: 4 },
  agentCard: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 11, borderRadius: 15, backgroundColor: palette.elevated },
  requestButton: { backgroundColor: palette.primary, paddingHorizontal: 11, paddingVertical: 9, borderRadius: 11 },
  requestText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  activeText: { color: palette.success, fontSize: 11, fontWeight: '700' },
  statusCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 15, backgroundColor: palette.surface, borderRadius: 17, borderWidth: 1, borderColor: palette.border },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: palette.border },
  iconAction: { padding: 7, minHeight: 34, justifyContent: 'center' },
  decline: { color: palette.danger, fontSize: 10, fontWeight: '700' },
  empty: { color: palette.muted, fontSize: 12, lineHeight: 18, textAlign: 'center', paddingVertical: 18 },
  error: { color: palette.danger, fontSize: 12, textAlign: 'center' },
});
