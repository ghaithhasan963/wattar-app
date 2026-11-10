import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Bell, CheckCheck, ChevronLeft, Users } from 'lucide-react-native';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { colors } from '@/lib/theme';

interface NotificationRow {
  id: string;
  event_type: string;
  title: string;
  body: string;
  route: string | null;
  read_at: string | null;
  created_at: string;
}

const eventColors: Record<string, string> = {
  friend_request: '#B44BFF',
  friend_accepted: '#72DCCA',
  private_message: '#74A7FF',
  room_invitation: '#F4BD55',
  new_follower: '#B44BFF',
  gift_received: '#F4BD55',
  deposit_update: '#72DCCA',
  withdrawal_update: '#74A7FF',
  host_earning: '#72DCCA',
};

export default function NotificationsScreen() {
  const router = useRouter();
  const profileId = useAuthStore((state) => state.profile?.id);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  const loadNotifications = useCallback(async (showLoader = false) => {
    if (!profileId) return;
    if (showLoader) setLoading(true);
    setLoadError(null);
    try {
      const { data, error } = await supabase
        .from('user_notifications')
        .select('id, event_type, title, body, route, read_at, created_at')
        .eq('user_id', profileId)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      setNotifications((data ?? []) as NotificationRow[]);
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
          <Text style={styles.subtitle}>تحديثات حسابك ومجتمعك</Text>
        </View>
        <Pressable
          style={[styles.markAllButton, markingAll && styles.disabled]}
          onPress={() => void markAllRead()}
          disabled={markingAll || !notifications.some((item) => !item.read_at)}
          accessibilityRole="button"
          accessibilityLabel="تعليم الكل كمقروء"
        >
          {markingAll ? <ActivityIndicator size="small" color={colors.primary} /> : <CheckCheck size={19} color={colors.primary} />}
        </Pressable>
      </View>

      {loadError ? (
        <Pressable style={styles.errorCard} onPress={() => void loadNotifications(true)}>
          <Text style={styles.errorText}>{loadError}</Text>
          <Text style={styles.retryText}>اضغط لإعادة المحاولة</Text>
        </Pressable>
      ) : null}

      {loading && notifications.length === 0 ? (
        <View style={styles.state}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : notifications.length === 0 ? (
        <View style={styles.state}>
          <View style={styles.emptyIcon}><Bell size={26} color={colors.primary} /></View>
          <Text style={styles.emptyTitle}>لا توجد إشعارات بعد</Text>
          <Text style={styles.emptyCopy}>سنُظهر هنا طلبات الأصدقاء والرسائل والهدايا وتحديثات المعاملات.</Text>
        </View>
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          onRefresh={() => void loadNotifications(true)}
          refreshing={loading}
          renderItem={({ item }) => (
            <Pressable
              style={[styles.notification, !item.read_at && styles.unread]}
              onPress={() => void openNotification(item)}
              accessibilityRole="button"
            >
              <View style={[styles.notificationIcon, { backgroundColor: `${eventColors[item.event_type] ?? colors.primary}22` }]}>
                <Users size={18} color={eventColors[item.event_type] ?? colors.primary} />
              </View>
              <View style={styles.notificationCopy}>
                <View style={styles.notificationTitleRow}>
                  <Text style={styles.notificationTitle}>{item.title}</Text>
                  {!item.read_at && <View style={styles.unreadDot} />}
                </View>
                <Text style={styles.notificationBody}>{item.body}</Text>
                <Text style={styles.timestamp}>{new Date(item.created_at).toLocaleString('ar')}</Text>
              </View>
              <ChevronLeft size={16} color={colors.textSecondary} />
            </Pressable>
          )}
        />
      )}
    </View>
  );
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
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 58, paddingBottom: 15, gap: 12 },
  backButton: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  headerCopy: { flex: 1 },
  title: { color: colors.text, fontSize: 20, fontWeight: '900', textAlign: 'right' },
  subtitle: { color: colors.textSecondary, fontSize: 11, marginTop: 3, textAlign: 'right' },
  markAllButton: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  disabled: { opacity: 0.4 },
  list: { padding: 14, paddingBottom: 34, gap: 9 },
  notification: { minHeight: 82, flexDirection: 'row', alignItems: 'center', gap: 11, padding: 13, borderRadius: 17, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  unread: { borderColor: '#B44BFF77', backgroundColor: '#21142F' },
  notificationIcon: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  notificationCopy: { flex: 1, alignItems: 'flex-end' },
  notificationTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  notificationTitle: { color: colors.text, fontSize: 13, fontWeight: '800', textAlign: 'right' },
  unreadDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary },
  notificationBody: { color: colors.textSecondary, fontSize: 11, lineHeight: 17, marginTop: 4, textAlign: 'right' },
  timestamp: { color: colors.textSecondary, fontSize: 9, marginTop: 5, textAlign: 'right' },
  state: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  emptyIcon: { width: 58, height: 58, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft, marginBottom: 13 },
  emptyTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  emptyCopy: { color: colors.textSecondary, fontSize: 12, lineHeight: 19, textAlign: 'center', marginTop: 7, maxWidth: 280 },
  errorCard: { marginHorizontal: 16, padding: 12, borderRadius: 12, backgroundColor: '#4C1824', borderWidth: 1, borderColor: colors.danger },
  errorText: { color: colors.danger, fontSize: 11, textAlign: 'right' },
  retryText: { color: colors.text, fontSize: 11, marginTop: 5, textAlign: 'right' },
});
