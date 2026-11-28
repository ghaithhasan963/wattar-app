import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Image, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronRight, UserRoundX } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { colors, fonts } from '@/lib/theme';

interface BlockedUser {
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
}

export default function BlockedUsersScreen() {
  const router = useRouter();
  const [users, setUsers] = useState<BlockedUser[]>([]);
  const [loading, setLoading] = useState(true);

  const loadBlockedUsers = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('list_my_blocked_users');
      if (error) throw error;
      setUsers((data ?? []) as BlockedUser[]);
    } catch (error: unknown) {
      Alert.alert('تعذر تحميل القائمة', error instanceof Error ? error.message : 'حاول مرة أخرى.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBlockedUsers();
  }, [loadBlockedUsers]);

  const unblock = (user: BlockedUser) => {
    Alert.alert('إلغاء الحظر', `هل تريد إلغاء حظر ${user.display_name || user.username}؟`, [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'إلغاء الحظر',
        onPress: async () => {
          const { error } = await supabase.rpc('unblock_wattar_user', { p_user_id: user.user_id });
          if (error) {
            Alert.alert('تعذر إلغاء الحظر', error.message);
            return;
          }
          setUsers((current) => current.filter((item) => item.user_id !== user.user_id));
        },
      },
    ]);
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()} accessibilityLabel="رجوع">
          <ChevronRight size={22} color={colors.textSecondary} />
        </TouchableOpacity>
        <View>
          <Text style={styles.title}>المستخدمون المحظورون</Text>
          <Text style={styles.subtitle}>يمكنك إلغاء الحظر في أي وقت</Text>
        </View>
      </View>
      <ScrollView
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={loadBlockedUsers} tintColor={colors.primary} />}
      >
        {users.map((user) => (
          <View key={user.user_id} style={styles.row}>
            <View style={styles.avatar}>
              {user.avatar_url
                ? <Image source={{ uri: user.avatar_url }} style={styles.avatarImage} />
                : <UserRoundX size={20} color={colors.primary} />}
            </View>
            <View style={styles.userDetails}>
              <Text style={styles.name}>{user.display_name || user.username}</Text>
              <Text style={styles.username}>@{user.username}</Text>
            </View>
            <TouchableOpacity style={styles.unblockButton} onPress={() => unblock(user)}>
              <Text style={styles.unblockText}>إلغاء الحظر</Text>
            </TouchableOpacity>
          </View>
        ))}
        {!loading && users.length === 0 && (
          <Text style={styles.empty}>لا يوجد مستخدمون محظورون.</Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingTop: 54, paddingBottom: 18 },
  backButton: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  title: { color: colors.text, fontSize: 18, fontFamily: fonts.semibold },
  subtitle: { color: colors.textSecondary, fontSize: 11, marginTop: 3 },
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  row: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 12, marginBottom: 8, borderWidth: 1, borderColor: colors.border, borderRadius: 15, backgroundColor: colors.surface },
  avatar: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft, overflow: 'hidden' },
  avatarImage: { width: '100%', height: '100%' },
  userDetails: { flex: 1 },
  name: { color: colors.text, fontSize: 14, fontFamily: fonts.semibold },
  username: { color: colors.textSecondary, fontSize: 11, marginTop: 4 },
  unblockButton: { paddingHorizontal: 11, paddingVertical: 8, borderRadius: 10, backgroundColor: colors.primarySoft },
  unblockText: { color: colors.primary, fontSize: 11, fontFamily: fonts.semibold },
  empty: { color: colors.textSecondary, textAlign: 'center', marginTop: 42, fontSize: 13 },
});
