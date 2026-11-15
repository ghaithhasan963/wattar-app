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
import { colors } from '@/lib/theme';
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
      Alert.alert('تعذر تحميل الجلسات', error instanceof Error ? error.message : 'حاول مرة أخرى.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const revokeOthers = () => {
    Alert.alert(
      'إنهاء الجلسات الأخرى',
      'سيتم تسجيل الخروج من جميع الأجهزة الأخرى المرتبطة بحسابك. يبقى هذا الجهاز مسجّلًا.',
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'إنهاء الجلسات الأخرى',
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
                  'تعذر إنهاء الجلسات',
                  error instanceof Error ? error.message : 'حاول مرة أخرى.',
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
    Alert.alert('تسجيل الخروج', 'هل تريد تسجيل الخروج من هذا الجهاز؟', [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'تسجيل الخروج',
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
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} accessibilityLabel="رجوع">
          <ChevronLeft size={22} color={colors.textSecondary} />
        </TouchableOpacity>
        <Text style={styles.title}>الأجهزة والجلسات</Text>
      </View>

      <View style={styles.noteCard}>
        <ShieldCheck size={20} color={colors.primary} />
        <Text style={styles.noteText}>
          هذه الأجهزة سجّلت الدخول إلى حسابك. إنهاء جميع الجلسات الأخرى يخرجها فعليًا،
          بينما إنهاء جهاز واحد يُبعده عن هذه القائمة فقط.
        </Text>
      </View>

      {loading && sessions.length === 0 ? (
        <ActivityIndicator size="large" color={colors.primary} style={styles.loader} />
      ) : sessions.length === 0 ? (
        <Text style={styles.empty}>لا توجد جلسات مسجّلة بعد.</Text>
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
                    {current && <View style={styles.badge}><Text style={styles.badgeText}>هذا الجهاز</Text></View>}
                  </View>
                  <Text style={styles.rowDescription}>{getDeviceSubtitle(session)}</Text>
                  <Text style={styles.rowMeta}>
                    {session.is_active ? 'نشطة' : 'منتهية'} · آخر استخدام {formatLastUsed(session.last_used_at)}
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
          {revoking ? 'جارٍ إنهاء الجلسات...' : 'إنهاء جميع الجلسات الأخرى'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.signOutButton} onPress={signOutThisDevice} accessibilityRole="button">
        <LogOut size={18} color={colors.danger} />
        <Text style={styles.signOutText}>تسجيل الخروج من هذا الجهاز</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 20, paddingTop: 58, paddingBottom: 36 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  backButton: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  title: { color: colors.text, fontSize: 24, fontWeight: '700' },
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
  rowLabel: { color: colors.text, fontSize: 14, fontWeight: '700' },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: colors.primarySoft },
  badgeText: { color: colors.primary, fontSize: 10, fontWeight: '700' },
  rowDescription: { color: colors.textSecondary, fontSize: 11 },
  rowMeta: { color: colors.textSecondary, fontSize: 11 },
  secondaryButton: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginTop: 22 },
  secondaryText: { color: colors.text, fontSize: 14, fontWeight: '700' },
  disabledButton: { opacity: 0.6 },
  signOutButton: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, borderRadius: 16, backgroundColor: colors.dangerSoft, marginTop: 12 },
  signOutText: { color: colors.danger, fontSize: 14, fontWeight: '700' },
});
