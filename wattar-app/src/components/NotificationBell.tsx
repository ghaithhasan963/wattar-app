import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { colors, fonts } from '@/lib/theme';

export function NotificationBell() {
  const router = useRouter();
  const profileId = useAuthStore((state) => state.profile?.id);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!profileId) {
      setUnreadCount(0);
      return;
    }

    let active = true;
    const loadUnreadCount = async () => {
      const { count, error } = await supabase
        .from('user_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', profileId)
        .is('read_at', null);
      if (error) {
        console.warn('[Wattar] Failed to load unread notifications:', error.message);
        return;
      }
      if (active) setUnreadCount(count ?? 0);
    };

    const channel: RealtimeChannel = supabase
      .channel(`notification-count:${profileId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'user_notifications',
        filter: `user_id=eq.${profileId}`,
      }, () => { void loadUnreadCount(); })
      .subscribe();

    void loadUnreadCount();
    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [profileId]);

  return (
    <Pressable
      style={styles.button}
      onPress={() => router.push('/(tabs)/notifications')}
      accessibilityRole="button"
      accessibilityLabel={unreadCount > 0 ? `الإشعارات، ${unreadCount} غير مقروءة` : 'الإشعارات'}
    >
      <Bell size={19} color={colors.text} />
      {unreadCount > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: colors.surfaceGlass,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 17,
    height: 17,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
    backgroundColor: colors.danger,
    borderWidth: 1,
    borderColor: colors.background,
  },
  badgeText: { color: colors.text, fontSize: 9, fontFamily: fonts.black },
});
