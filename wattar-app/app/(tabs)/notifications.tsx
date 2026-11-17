import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  BadgeCheck,
  Bell,
  CheckCheck,
  ChevronLeft,
  Gift,
  MessageCircle,
  Mic,
  UserCheck,
  UserPlus,
  Wallet,
} from 'lucide-react-native';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { colors } from '@/lib/theme';

interface NotificationRow {
  id: string;
  event_type: string;
  actor_id: string | null;
  title: string;
  body: string;
  route: string | null;
  read_at: string | null;
  created_at: string;
  actor_name?: string | null;
  actor_avatar?: string | null;
}

interface ActorRow {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
}

type FilterKey = 'all' | 'unread' | 'messages' | 'gifts' | 'transactions' | 'community';

const filters: Array<{ key: FilterKey; label: string }> = [
  { key: 'all', label: 'الكل' },
  { key: 'unread', label: 'غير مقروء' },
  { key: 'messages', label: 'رسائل' },
  { key: 'gifts', label: 'هدايا' },
  { key: 'transactions', label: 'معاملات' },
  { key: 'community', label: 'مجتمع' },
];

const eventColors: Record<string, string> = {
  friend_request: '#B44BFF',
  friend_accepted: '#72DCCA',
  private_message: '#74A7FF',
  room_invitation: '#F4BD55',
  new_follower: '#B44BFF',
  gift_received: '#F4BD55',
  deposit_update: '#72DCCA',
  withdrawal_update: '#74A7FF',
  host_update: '#72DCCA',
  membership_update: '#F4BD55',
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

function matchesFilter(item: NotificationRow, filter: FilterKey): boolean {
  if (filter === 'all') return true;
  if (filter === 'unread') return !item.read_at;
  if (filter === 'messages') return item.event_type === 'private_message';
  if (filter === 'gifts') return item.event_type === 'gift_received';
  if (filter === 'transactions') {
    return item.event_type === 'deposit_update' || item.event_type === 'withdrawal_update';
  }
  return ['friend_request', 'friend_accepted', 'new_follower', 'room_invitation', 'host_update']
    .includes(item.event_type);
}

export default function NotificationsScreen() {
  const router = useRouter();
  const profileId = useAuthStore((state) => state.profile?.id);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [filter, setFilter] = useState<FilterKey>('all');

  const loadNotifications = useCallback(async (showLoader = false) => {
    if (!profileId) return;
    if (showLoader) setLoading(true);
    setLoadError(null);
    try {
      const { data, error } = await supabase
        .from('user_notifications')
        .select('id, event_type, actor_id, title, body, route, read_at, created_at')
        .eq('user_id', profileId)
        .order('created_at', { ascending: false })
        .limit(120);
      if (error) throw error;
      const rows = (data ?? []) as NotificationRow[];
      const actorIds = Array.from(new Set(rows.map((row) => row.actor_id).filter(Boolean))) as string[];
      let actors: Record<string, ActorRow> = {};
      if (actorIds.length) {
        const { data: actorRows } = await supabase
          .from('users')
          .select('id, username, display_name, avatar_url')
          .in('id', actorIds);
        actors = ((actorRows ?? []) as ActorRow[]).reduce<Record<string, ActorRow>>((map, actor) => {
          map[actor.id] = actor;
          return map;
        }, {});
      }
      setNotifications(rows.map((row) => {
        const actor = row.actor_id ? actors[row.actor_id] : undefined;
        return {
          ...row,
          actor_name: actor ? (actor.display_name || actor.username) : null,
          actor_avatar: actor?.avatar_url ?? null,
        };
      }));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'تعذر تحميل الإشعارات.';
      setLoadError(message);
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  useEffect(() => {
    void loadNotifications(true);
    if (!profileId) return;
    const channel: RealtimeChannel = supabase
      .channel(`notifications:${profileId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'user_notifications',
        filter: `user_id=eq.${profileId}`,
      }, () => { void loadNotifications(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [loadNotifications, profileId]);

  const unreadCount = notifications.filter((item) => !item.read_at).length;

  const sections = useMemo(() => {
    const filtered = notifications.filter((item) => matchesFilter(item, filter));
    const grouped: Array<{ title: string; data: NotificationRow[] }> = [];
    filtered.forEach((item) => {
      const key = dayKey(item.created_at);
      const last = grouped[grouped.length - 1];
      if (last && last.title === key) last.data.push(item);
      else grouped.push({ title: key, data: [item] });
    });
    return grouped;
  }, [filter, notifications]);

  const markAllRead = async () => {
    if (!profileId || markingAll) return;
    const unreadIds = notifications.filter((item) => !item.read_at).map((item) => item.id);
    if (!unreadIds.length) return;
    setMarkingAll(true);
    try {
      const { error } = await supabase
        .from('user_notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('user_id', profileId)
        .is('read_at', null);
      if (error) throw error;
      await loadNotifications();
    } catch (error: unknown) {
      setLoadError(error instanceof Error ? error.message : 'تعذر تحديث الإشعارات.');
    } finally {
      setMarkingAll(false);
    }
  };

  const openNotification = async (item: NotificationRow) => {
    if (!profileId) return;
    if (!item.read_at) {
      const { error } = await supabase
        .from('user_notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', item.id)
        .eq('user_id', profileId);
      if (error) {
        setLoadError(error.message);
        return;
      }
      setNotifications((current) => current.map((notification) =>
        notification.id === item.id ? { ...notification, read_at: new Date().toISOString() } : notification));
    }
    const route = resolveNotificationRoute(item.route);
    if (route) router.push(route);
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={() => router.back()} accessibilityLabel="رجوع">
          <ChevronLeft size={21} color={colors.text} />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>الإشعارات</Text>
          <Text style={styles.subtitle}>
            {unreadCount > 0 ? `${unreadCount} إشعار غير مقروء` : 'كل شيء مقروء'}
          </Text>
        </View>
        <Pressable
          style={[styles.markAllButton, markingAll && styles.disabled]}
          onPress={() => void markAllRead()}
          disabled={markingAll || unreadCount === 0}
          accessibilityRole="button"
          accessibilityLabel="تعليم الكل كمقروء"
        >
          {markingAll ? <ActivityIndicator size="small" color={colors.primary} /> : <CheckCheck size={19} color={colors.primary} />}
        </Pressable>
      </View>

      <View style={styles.filterWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          {filters.map((item) => {
            const active = filter === item.key;
            return (
              <Pressable
                key={item.key}
                style={[styles.filterChip, active && styles.filterChipActive]}
                onPress={() => setFilter(item.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.filterText, active && styles.filterTextActive]}>{item.label}</Text>
                {item.key === 'unread' && unreadCount > 0 ? (
                  <View style={styles.filterBadge}><Text style={styles.filterBadgeText}>{unreadCount}</Text></View>
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {loadError ? (
        <Pressable style={styles.errorCard} onPress={() => void loadNotifications(true)}>
          <Text style={styles.errorText}>{loadError}</Text>
          <Text style={styles.retryText}>اضغط لإعادة المحاولة</Text>
        </Pressable>
      ) : null}

      {loading && notifications.length === 0 ? (
        <View style={styles.state}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : sections.length === 0 ? (
        <View style={styles.state}>
          <View style={styles.emptyIcon}><Bell size={26} color={colors.primary} /></View>
          <Text style={styles.emptyTitle}>
            {filter === 'all' ? 'لا توجد إشعارات بعد' : 'لا توجد إشعارات في هذا القسم'}
          </Text>
          <Text style={styles.emptyCopy}>
            سنُظهر هنا أسماء المرسلين وتفاصيل الرسائل والهدايا وتحديثات المعاملات.
          </Text>
        </View>
      ) : (
        <SectionList
          sections={sections.map((section) => ({ ...section, title: section.title }))}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          stickySectionHeadersEnabled={false}
          onRefresh={() => void loadNotifications(true)}
          refreshing={loading}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <View style={styles.sectionLine} />
              <Text style={styles.sectionLabel}>{formatDayLabel(section.data[0]?.created_at ?? new Date().toISOString())}</Text>
              <View style={styles.sectionLine} />
            </View>
          )}
          renderItem={({ item }) => (
            <Pressable
              style={[styles.notification, !item.read_at && styles.unread]}
              onPress={() => void openNotification(item)}
              accessibilityRole="button"
            >
              <View style={[styles.notificationIcon, { backgroundColor: `${eventColors[item.event_type] ?? colors.primary}22` }]}>
                {item.actor_avatar ? (
                  <Image source={{ uri: item.actor_avatar }} style={styles.actorAvatar} />
                ) : (
                  <EventIcon type={item.event_type} />
                )}
              </View>
              <View style={styles.notificationCopy}>
                <View style={styles.notificationTitleRow}>
                  <Text style={styles.notificationTitle} numberOfLines={1}>{item.title}</Text>
                  {!item.read_at && <View style={styles.unreadDot} />}
                </View>
                <Text style={styles.notificationBody} numberOfLines={2}>{item.body}</Text>
                <View style={styles.metaRow}>
                  {item.actor_name ? (
                    <Text style={styles.actorName} numberOfLines={1}>{item.actor_name}</Text>
                  ) : null}
                  <Text style={styles.timestamp}>
                    {new Date(item.created_at).toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </View>
              </View>
              <ChevronLeft size={16} color={colors.textSecondary} />
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

function EventIcon({ type }: { type: string }) {
  const color = eventColors[type] ?? colors.primary;
  if (type === 'private_message') return <MessageCircle size={19} color={color} />;
  if (type === 'gift_received') return <Gift size={19} color={color} />;
  if (type === 'room_invitation') return <Mic size={19} color={color} />;
  if (type === 'new_follower') return <UserPlus size={19} color={color} />;
  if (type === 'friend_request' || type === 'friend_accepted') return <UserCheck size={19} color={color} />;
  if (type === 'deposit_update' || type === 'withdrawal_update') return <Wallet size={19} color={color} />;
  if (type === 'host_update') return <BadgeCheck size={19} color={color} />;
  return <Bell size={19} color={color} />;
}

function resolveNotificationRoute(route: string | null): '/(tabs)/friends' | '/(tabs)/wallet' | '/(tabs)/profile' | '/membership' | '/host-application' | `/messages/${string}` | `/room/${string}` | null {
  if (route === '/(tabs)/friends' || route === '/(tabs)/wallet') return route;
  if (route === '/(tabs)/profile' || route === '/membership' || route === '/host-application') return route;
  if (!route) return null;
  const match = route.match(/^\/(messages|room)\/([0-9a-f]{8}-[0-9a-f-]{27})$/i);
  if (!match) return null;
  return `/${match[1]}/${match[2]}` as `/messages/${string}` | `/room/${string}`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 58, paddingBottom: 12, gap: 12 },
  backButton: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  headerCopy: { flex: 1 },
  title: { color: colors.text, fontSize: 20, fontWeight: '900', textAlign: 'right' },
  subtitle: { color: colors.textSecondary, fontSize: 11, marginTop: 3, textAlign: 'right' },
  markAllButton: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  disabled: { opacity: 0.4 },
  filterWrap: { paddingBottom: 10 },
  filterRow: { paddingHorizontal: 14, gap: 7 },
  filterChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 13, minHeight: 35, borderRadius: 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  filterChipActive: { backgroundColor: '#3A2054', borderColor: colors.primary },
  filterText: { color: colors.textSecondary, fontSize: 11, fontWeight: '700' },
  filterTextActive: { color: '#FFFFFF' },
  filterBadge: { minWidth: 17, height: 17, paddingHorizontal: 4, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
  filterBadgeText: { color: '#FFFFFF', fontSize: 9, fontWeight: '800' },
  list: { paddingHorizontal: 14, paddingBottom: 34 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, marginBottom: 9, paddingHorizontal: 4 },
  sectionLine: { flex: 1, height: 1, backgroundColor: colors.border },
  sectionLabel: { color: colors.textSecondary, fontSize: 10, fontWeight: '700' },
  notification: { minHeight: 82, flexDirection: 'row', alignItems: 'center', gap: 11, padding: 13, borderRadius: 17, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginBottom: 8 },
  unread: { borderColor: '#B44BFF77', backgroundColor: '#21142F' },
  notificationIcon: { width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  actorAvatar: { width: '100%', height: '100%' },
  notificationCopy: { flex: 1, alignItems: 'flex-end' },
  notificationTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%' },
  notificationTitle: { color: colors.text, fontSize: 13, fontWeight: '800', textAlign: 'right', flexShrink: 1 },
  unreadDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary },
  notificationBody: { color: colors.textSecondary, fontSize: 11, lineHeight: 17, marginTop: 4, textAlign: 'right' },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6, marginTop: 5 },
  actorName: { color: colors.gold, fontSize: 9, fontWeight: '700', maxWidth: 120 },
  timestamp: { color: colors.textSecondary, fontSize: 9 },
  state: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  emptyIcon: { width: 58, height: 58, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft, marginBottom: 13 },
  emptyTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  emptyCopy: { color: colors.textSecondary, fontSize: 12, lineHeight: 19, textAlign: 'center', marginTop: 7, maxWidth: 280 },
  errorCard: { marginHorizontal: 16, padding: 12, borderRadius: 12, backgroundColor: '#4C1824', borderWidth: 1, borderColor: colors.danger },
  errorText: { color: colors.danger, fontSize: 11, textAlign: 'right' },
  retryText: { color: colors.text, fontSize: 11, marginTop: 5, textAlign: 'right' },
});
