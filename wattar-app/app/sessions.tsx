import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronLeft, LogOut, ShieldCheck, Smartphone } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { colors, fonts } from '@/lib/theme';
import { deviceIdentity } from '@/lib/device';
import {
  formatLastUsed,
  getDeviceSubtitle,
  getPlatformLabel,
  isThisDevice,
  toSessionDevices,
  type SessionDevice,
} from '@/lib/sessions';

export default function SessionsScreen() {
  const router = useRouter();
  const { signOut } = useAuthStore();
  const [sessions, setSessions] = useState<SessionDevice[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const id = await deviceIdentity.getId();
      setDeviceId(id);
      const { data, error } = await supabase.rpc('list_my_sessions');
      if (error) throw error;
      setSessions(toSessionDevices(data));
    } catch (error: unknown) {
      Alert.alert('طھط¹ط°ط± طھط­ظ…ظٹظ„ ط§ظ„ط¬ظ„ط³ط§طھ', error instanceof Error ? error.message : 'ط­ط§ظˆظ„ ظ…ط±ط© ط£ط®ط±ظ‰.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const revokeOthers = () => {
    Alert.alert(
      'ط¥ظ†ظ‡ط§ط، ط§ظ„ط¬ظ„ط³ط§طھ ط§ظ„ط£ط®ط±ظ‰',
      'ط³ظٹطھظ… طھط³ط¬ظٹظ„ ط§ظ„ط®ط±ظˆط¬ ظ…ظ† ط¬ظ…ظٹط¹ ط§ظ„ط£ط¬ظ‡ط²ط© ط§ظ„ط£ط®ط±ظ‰ ط§ظ„ظ…ط±طھط¨ط·ط© ط¨ط­ط³ط§ط¨ظƒ. ظٹط¨ظ‚ظ‰ ظ‡ط°ط§ ط§ظ„ط¬ظ‡ط§ط² ظ…ط³ط¬ظ‘ظ„ظ‹ط§.',
      [
        { text: 'ط¥ظ„ط؛ط§ط،', style: 'cancel' },
        {
          text: 'ط¥ظ†ظ‡ط§ط، ط§ظ„ط¬ظ„ط³ط§طھ ط§ظ„ط£ط®ط±ظ‰',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setRevoking(true);
              try {
                await signOut('others');
                const { error } = await supabase.rpc('revoke_all_my_sessions', {
                  p_keep_device_id: deviceId,
                });
                if (error) throw error;
                await load();
              } catch (error: unknown) {
                Alert.alert(
                  'طھط¹ط°ط± ط¥ظ†ظ‡ط§ط، ط§ظ„ط¬ظ„ط³ط§طھ',
                  error instanceof Error ? error.message : 'ط­ط§ظˆظ„ ظ…ط±ط© ط£ط®ط±ظ‰.',
                );
              } finally {
                setRevoking(false);
              }
            })();
          },
        },
      ],
    );
  };

  const signOutThisDevice = () => {
    Alert.alert('طھط³ط¬ظٹظ„ ط§ظ„ط®ط±ظˆط¬', 'ظ‡ظ„ طھط±ظٹط¯ طھط³ط¬ظٹظ„ ط§ظ„ط®ط±ظˆط¬ ظ…ظ† ظ‡ط°ط§ ط§ظ„ط¬ظ‡ط§ط²طں', [
      { text: 'ط¥ظ„ط؛ط§ط،', style: 'cancel' },
      {
        text: 'طھط³ط¬ظٹظ„ ط§ظ„ط®ط±ظˆط¬',
        style: 'destructive',
        onPress: async () => {
          await signOut();
          router.replace('/(auth)/login');
        },
      },
    ]);
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} />}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} accessibilityLabel="ط±ط¬ظˆط¹">
          <ChevronLeft size={22} color={colors.textSecondary} />
        </TouchableOpacity>
        <Text style={styles.title}>ط§ظ„ط£ط¬ظ‡ط²ط© ظˆط§ظ„ط¬ظ„ط³ط§طھ</Text>
      </View>

      <View style={styles.noteCard}>
        <ShieldCheck size={20} color={colors.primary} />
        <Text style={styles.noteText}>
          ظ‡ط°ظ‡ ط§ظ„ط£ط¬ظ‡ط²ط© ط³ط¬ظ‘ظ„طھ ط§ظ„ط¯ط®ظˆظ„ ط¥ظ„ظ‰ ط­ط³ط§ط¨ظƒ. ط¥ظ†ظ‡ط§ط، ط¬ظ…ظٹط¹ ط§ظ„ط¬ظ„ط³ط§طھ ط§ظ„ط£ط®ط±ظ‰ ظٹط®ط±ط¬ظ‡ط§ ظپط¹ظ„ظٹظ‹ط§طŒ
          ط¨ظٹظ†ظ…ط§ ط¥ظ†ظ‡ط§ط، ط¬ظ‡ط§ط² ظˆط§ط­ط¯ ظٹظڈط¨ط¹ط¯ظ‡ ط¹ظ† ظ‡ط°ظ‡ ط§ظ„ظ‚ط§ط¦ظ…ط© ظپظ‚ط·.
        </Text>
      </View>

      {loading && sessions.length === 0 ? (
        <ActivityIndicator size="large" color={colors.primary} style={styles.loader} />
      ) : sessions.length === 0 ? (
        <Text style={styles.empty}>ظ„ط§ طھظˆط¬ط¯ ط¬ظ„ط³ط§طھ ظ…ط³ط¬ظ‘ظ„ط© ط¨ط¹ط¯.</Text>
      ) : (
        <View style={styles.group}>
          {sessions.map((session, index) => {
            const current = isThisDevice(session, deviceId);
            return (
              <View
                key={session.id}
                style={[styles.row, index < sessions.length - 1 && styles.rowBorder]}
              >
                <View style={styles.rowIcon}>
                  <Smartphone size={18} color={colors.primary} />
                </View>
                <View style={styles.rowCopy}>
                  <View style={styles.nameLine}>
                    <Text style={styles.rowLabel}>{getPlatformLabel(session)}</Text>
                    {current && <View style={styles.badge}><Text style={styles.badgeText}>ظ‡ط°ط§ ط§ظ„ط¬ظ‡ط§ط²</Text></View>}
                  </View>
                  <Text style={styles.rowDescription}>{getDeviceSubtitle(session)}</Text>
                  <Text style={styles.rowMeta}>
                    {session.is_active ? 'ظ†ط´ط·ط©' : 'ظ…ظ†طھظ‡ظٹط©'} آ· ط¢ط®ط± ط§ط³طھط®ط¯ط§ظ… {formatLastUsed(session.last_used_at)}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      )}

      <TouchableOpacity
        style={[styles.secondaryButton, revoking && styles.disabledButton]}
        onPress={revokeOthers}
        disabled={revoking || loading}
        accessibilityRole="button"
        accessibilityState={{ disabled: revoking || loading }}
      >
        <LogOut size={18} color={colors.text} />
        <Text style={styles.secondaryText}>
          {revoking ? 'ط¬ط§ط±ظچ ط¥ظ†ظ‡ط§ط، ط§ظ„ط¬ظ„ط³ط§طھ...' : 'ط¥ظ†ظ‡ط§ط، ط¬ظ…ظٹط¹ ط§ظ„ط¬ظ„ط³ط§طھ ط§ظ„ط£ط®ط±ظ‰'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.signOutButton} onPress={signOutThisDevice} accessibilityRole="button">
        <LogOut size={18} color={colors.danger} />
        <Text style={styles.signOutText}>طھط³ط¬ظٹظ„ ط§ظ„ط®ط±ظˆط¬ ظ…ظ† ظ‡ط°ط§ ط§ظ„ط¬ظ‡ط§ط²</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 20, paddingTop: 58, paddingBottom: 36 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  backButton: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  title: { color: colors.text, fontSize: 24, fontFamily: fonts.semibold },
  noteCard: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', padding: 14, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginBottom: 18 },
  noteText: { flex: 1, color: colors.textSecondary, fontSize: 12, lineHeight: 19 },
  loader: { marginTop: 40 },
  empty: { color: colors.textSecondary, textAlign: 'center', marginTop: 40, fontSize: 13 },
  group: { overflow: 'hidden', borderRadius: 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  row: { minHeight: 74, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, gap: 10 },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
  rowCopy: { flex: 1, gap: 3 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowLabel: { color: colors.text, fontSize: 14, fontFamily: fonts.semibold },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: colors.primarySoft },
  badgeText: { color: colors.primary, fontSize: 10, fontFamily: fonts.semibold },
  rowDescription: { color: colors.textSecondary, fontSize: 11 },
  rowMeta: { color: colors.textSecondary, fontSize: 11 },
  secondaryButton: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginTop: 22 },
  secondaryText: { color: colors.text, fontSize: 14, fontFamily: fonts.semibold },
  disabledButton: { opacity: 0.6 },
  signOutButton: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, borderRadius: 16, backgroundColor: colors.dangerSoft, marginTop: 12 },
  signOutText: { color: colors.danger, fontSize: 14, fontFamily: fonts.semibold },
});
