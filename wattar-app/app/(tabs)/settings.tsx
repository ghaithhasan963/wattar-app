import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Bell, ChevronLeft, Globe, HelpCircle, KeyRound, LogOut, MessageCircle, Shield, ShieldAlert, Smartphone, Sparkles, Trash2, User } from 'lucide-react-native';
import { useAuthStore } from '@/store/auth';
import { ChatTextSize, usePreferencesStore } from '@/store/preferences';
import { colors, fonts } from '@/lib/theme';
import { callFunction, supabase } from '@/lib/supabase';
import {
  disableSocialPushNotifications,
  enableSocialPushNotifications,
  getSocialPushEnabled,
} from '@/lib/notifications';

export default function SettingsScreen() {
  const router = useRouter();
  const { profile, signOut } = useAuthStore();
  const { reduceMotion, chatTextSize, setReduceMotion, setChatTextSize } = usePreferencesStore();
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [hostOutreachOptOut, setHostOutreachOptOut] = useState<boolean | null>(null);
  const [deletingAccount, setDeletingAccount] = useState(false);

  useEffect(() => {
    getSocialPushEnabled().then(setNotificationsEnabled).catch((error: unknown) => {
      console.warn('[Wattar] Failed to check notification settings:', error);
    });
  }, []);

  useEffect(() => {
    void supabase.rpc('get_my_host_outreach_preference').then(
      ({ data, error }) => {
        if (error) {
          console.warn('[Wattar] Failed to load host outreach preference:', error.message);
          return;
        }
        setHostOutreachOptOut(data === true);
      },
      (error: unknown) => {
        console.warn('[Wattar] Failed to load host outreach preference:', error);
      },
    );
  }, []);

  const updateMotionPreference = async (enabled: boolean) => {
    try {
      await setReduceMotion(enabled);
    } catch (error: unknown) {
      Alert.alert('طھط¹ط°ط± ط­ظپط¸ ط§ظ„ط¥ط¹ط¯ط§ط¯', error instanceof Error ? error.message : 'ط­ط§ظˆظ„ ظ…ط±ط© ط£ط®ط±ظ‰.');
    }
  };

  const updateChatTextSize = async (size: ChatTextSize) => {
    try {
      await setChatTextSize(size);
    } catch (error: unknown) {
      Alert.alert('طھط¹ط°ط± ط­ظپط¸ ط§ظ„ط¥ط¹ط¯ط§ط¯', error instanceof Error ? error.message : 'ط­ط§ظˆظ„ ظ…ط±ط© ط£ط®ط±ظ‰.');
    }
  };

  const updateNotifications = async (enabled: boolean) => {
    try {
      if (enabled) await enableSocialPushNotifications();
      else await disableSocialPushNotifications();
      setNotificationsEnabled(enabled);
    } catch (error: unknown) {
      Alert.alert('طھط¹ط°ط± طھط­ط¯ظٹط« ط§ظ„ط¥ط´ط¹ط§ط±ط§طھ', error instanceof Error ? error.message : 'ط­ط§ظˆظ„ ظ…ط±ط© ط£ط®ط±ظ‰.');
    }
  };

  const updateHostOutreach = async (enabled: boolean) => {
    try {
      const { error } = await supabase.rpc('set_my_host_outreach_preference', {
        p_opt_out: !enabled,
      });
      if (error) throw error;
      setHostOutreachOptOut(!enabled);
    } catch (error: unknown) {
      Alert.alert('طھط¹ط°ط± طھط­ط¯ظٹط« ط§ظ„ط®طµظˆطµظٹط©', error instanceof Error ? error.message : 'ط­ط§ظˆظ„ ظ…ط±ط© ط£ط®ط±ظ‰.');
    }
  };

  const handleSignOut = () => {
    Alert.alert('طھط³ط¬ظٹظ„ ط§ظ„ط®ط±ظˆط¬', 'ظ‡ظ„ طھط±ظٹط¯ طھط³ط¬ظٹظ„ ط§ظ„ط®ط±ظˆط¬ ظ…ظ† ط­ط³ط§ط¨ظƒطں', [
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

  const handleDeleteAccount = () => {
    Alert.alert(
      'ط­ط°ظپ ط§ظ„ط­ط³ط§ط¨ ظ†ظ‡ط§ط¦ظٹظ‹ط§',
      'ط³طھظڈط²ط§ظ„ ط¨ظٹط§ظ†ط§طھ ط§ظ„ط¯ط®ظˆظ„ ظˆط§ظ„ظˆط³ط§ط¦ط·طŒ ظˆظٹظڈط®ظپظ‰ ظ…ظ„ظپظƒ ظˆظ…ط­طھظˆط§ظƒ ط¹ظ† ط§ظ„ظ…ط³طھط®ط¯ظ…ظٹظ†. ط³طھظڈط­ظپط¸ ط³ط¬ظ„ط§طھ ط§ظ„ظ…ط¹ط§ظ…ظ„ط§طھ ط§ظ„ظ…ط§ظ„ظٹط© ط§ظ„ط¶ط±ظˆط±ظٹط©. ظ„ط§ ظٹظ…ظƒظ† ط§ظ„طھط±ط§ط¬ط¹ ط¹ظ† ظ‡ط°ط§ ط§ظ„ط¥ط¬ط±ط§ط،.',
      [
        { text: 'ط¥ظ„ط؛ط§ط،', style: 'cancel' },
        {
          text: 'ط­ط°ظپ ط­ط³ط§ط¨ظٹ',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setDeletingAccount(true);
              try {
                await callFunction('delete-account', { confirmation: 'DELETE' });
                await signOut('local');
                router.replace('/(auth)/login');
              } catch (error: unknown) {
                Alert.alert(
                  'طھط¹ط°ط± ط­ط°ظپ ط§ظ„ط­ط³ط§ط¨',
                  error instanceof Error ? error.message : 'طھط­ظ‚ظ‚ ظ…ظ† ط§طھطµط§ظ„ ط§ظ„ط¥ظ†طھط±ظ†طھ ظˆط­ط§ظˆظ„ ظ…ط¬ط¯ط¯ظ‹ط§.',
                );
              } finally {
                setDeletingAccount(false);
              }
            })();
          },
        },
      ],
    );
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} accessibilityLabel="ط±ط¬ظˆط¹">
          <ChevronLeft size={22} color={colors.textSecondary} />
        </TouchableOpacity>
        <Text style={styles.title}>ط§ظ„ط¥ط¹ط¯ط§ط¯ط§طھ</Text>
      </View>

      <View style={styles.accountCard}>
        <View style={styles.accountIcon}><User size={22} color={colors.primary} /></View>
        <View style={styles.accountText}>
          <Text style={styles.accountName}>{profile?.display_name || profile?.username || 'ط­ط³ط§ط¨ظٹ'}</Text>
          <Text style={styles.accountMeta}>@{profile?.username || 'â€”'}</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>ط§ظ„طھط®طµظٹطµ</Text>
      <View style={styles.group}>
        <View style={[styles.row, styles.rowBorder]}>
          <View style={styles.rowIcon}><Sparkles size={18} color={colors.primary} /></View>
          <View style={styles.settingCopy}>
            <Text style={styles.rowLabel}>طھظ‚ظ„ظٹظ„ ط§ظ„ط­ط±ظƒط©</Text>
            <Text style={styles.rowDescription}>ط¥ظٹظ‚ط§ظپ ط§ظ„ط­ط±ظƒط§طھ ط§ظ„ط§ظ†طھظ‚ط§ظ„ظٹط© ظ„طھط¬ط±ط¨ط© ط£ظ‡ط¯ط£</Text>
          </View>
          <Switch
            value={reduceMotion}
            onValueChange={updateMotionPreference}
            trackColor={{ false: colors.border, true: colors.primary }}
            thumbColor={colors.text}
            accessibilityLabel="طھظ‚ظ„ظٹظ„ ط§ظ„ط­ط±ظƒط©"
          />
        </View>
        <View style={[styles.row, styles.rowBorder]}>
          <View style={styles.rowIcon}><Bell size={18} color={colors.primary} /></View>
          <View style={styles.settingCopy}>
            <Text style={styles.rowLabel}>ط§ظ„ط¥ط´ط¹ط§ط±ط§طھ</Text>
            <Text style={styles.rowDescription}>
              {notificationsEnabled
                ? 'ظ…ظپط¹ظ„ط© ط¹ظ„ظ‰ ظ‡ط°ط§ ط§ظ„ط¬ظ‡ط§ط². ظپط¹ظ‘ظ„ظ‡ط§ ط£ظٹط¶ظ‹ط§ ط¹ظ„ظ‰ ط§ظ„ط¬ظ‡ط§ط² ط§ظ„ط°ظٹ طھط±ظٹط¯ ط§ط³طھظ‚ط¨ط§ظ„ ط§ظ„ط¥ط´ط¹ط§ط±ط§طھ ط¹ظ„ظٹظ‡.'
                : 'ظپط¹ظ‘ظ„ظ‡ط§ ط¹ظ„ظ‰ ط¬ظ‡ط§ط² ظƒظ„ ط­ط³ط§ط¨ ظ„ط§ط³طھظ‚ط¨ط§ظ„ ط·ظ„ط¨ط§طھ ط§ظ„طµط¯ط§ظ‚ط© ظˆط§ظ„ط±ط³ط§ط¦ظ„ ظˆط¯ط¹ظˆط§طھ ط§ظ„ط؛ط±ظپ.'}
            </Text>
          </View>
          <Switch
            value={notificationsEnabled}
            onValueChange={updateNotifications}
            trackColor={{ false: colors.border, true: colors.primary }}
            thumbColor={colors.text}
            accessibilityLabel="ط¥ط´ط¹ط§ط±ط§طھ Wattar"
          />
        </View>
        <TouchableOpacity
          style={[styles.row, styles.rowBorder]}
          onPress={() => router.push('/notification-settings')}
          accessibilityRole="button"
        >
          <View style={styles.rowIcon}><Bell size={18} color={colors.primary} /></View>
          <View style={styles.settingCopy}>
            <Text style={styles.rowLabel}>ط£ظ†ظˆط§ط¹ ط§ظ„ط¥ط´ط¹ط§ط±ط§طھ</Text>
            <Text style={styles.rowDescription}>طھط­ظƒظ… ط¨ظ…ط§ ظٹطµظ„ظƒ ط¯ط§ط®ظ„ ط§ظ„طھط·ط¨ظٹظ‚ ظˆط¹ظ„ظ‰ ط¬ظ‡ط§ط²ظƒ ظ„ظƒظ„ ظ†ظˆط¹.</Text>
          </View>
          <ChevronLeft size={17} color={colors.textMuted} />
        </TouchableOpacity>
        <View style={[styles.row, styles.rowBorder]}>
          <View style={styles.rowIcon}><MessageCircle size={18} color={colors.primary} /></View>
          <View style={styles.settingCopy}>
            <Text style={styles.rowLabel}>ط±ط³ط§ط¦ظ„ ط§ظ„ظ…ط¶ظٹظپط§طھ ط§ظ„ط§ظپطھطھط§ط­ظٹط©</Text>
            <Text style={styles.rowDescription}>
              {hostOutreachOptOut === null
                ? 'ط¬ط§ط±ظچ طھط­ظ…ظٹظ„ طھظپط¶ظٹظ„ظƒ...'
                : hostOutreachOptOut
                  ? 'ظ…طھظˆظ‚ظپط©. ظ„ظ† طھط¨ط¯ط£ ط§ظ„ظ…ط¶ظٹظپط§طھ ظ…ط­ط§ط¯ط«ط§طھ ط¬ط¯ظٹط¯ط© ظ…ط¹ظƒ.'
                  : 'ظ‚ط¯ طھطµظ„ظƒ ط±ط³ط§ط¦ظ„ طھط¹ط§ط±ظپ ظ…ط­ط¯ظˆط¯ط©طŒ ظˆظٹظ…ظƒظ†ظƒ طھط¬ط§ظ‡ظ„ظ‡ط§ ط£ظˆ ط­ط¸ط± ط§ظ„ظ…ط±ط³ظ„.'}
            </Text>
          </View>
          <Switch
            value={hostOutreachOptOut === false}
            onValueChange={updateHostOutreach}
            disabled={hostOutreachOptOut === null}
            trackColor={{ false: colors.border, true: colors.primary }}
            thumbColor={colors.text}
            accessibilityLabel="ط±ط³ط§ط¦ظ„ ط§ظ„ظ…ط¶ظٹظپط§طھ ط§ظ„ط§ظپطھطھط§ط­ظٹط©"
          />
        </View>
        <View style={styles.fontSizeSection}>
          <Text style={styles.rowLabel}>ط­ط¬ظ… ظ†طµ ط§ظ„ظ…ط­ط§ط¯ط«ط©</Text>
          <View style={styles.sizeOptions}>
            {([
              ['small', 'طµط؛ظٹط±'],
              ['medium', 'ظ…طھظˆط³ط·'],
              ['large', 'ظƒط¨ظٹط±'],
            ] as const).map(([size, label]) => (
              <TouchableOpacity
                key={size}
                style={[styles.sizeOption, chatTextSize === size && styles.sizeOptionActive]}
                onPress={() => updateChatTextSize(size)}
                accessibilityRole="button"
                accessibilityState={{ selected: chatTextSize === size }}
              >
                <Text style={[styles.sizeOptionText, chatTextSize === size && styles.sizeOptionTextActive]}>
                  {label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>

      <Text style={[styles.sectionTitle, styles.accountSection]}>ط§ظ„ط­ط³ط§ط¨ ظˆط§ظ„ط¯ط¹ظ…</Text>
      <View style={styles.group}>
        <SettingRow
          icon={Shield}
          label="ط¥ط¹ط¯ط§ط¯ط§طھ ط§ظ„ط®طµظˆطµظٹط©"
          value="ط¥ط¯ط§ط±ط©"
          onPress={() => router.push('/privacy-settings')}
        />
        <SettingRow
          icon={KeyRound}
          label="ظƒظ„ظ…ط© ط§ظ„ظ…ط±ظˆط±"
          value="طھط؛ظٹظٹط±"
          onPress={() => router.push('/password')}
        />
        <SettingRow
          icon={Smartphone}
          label="ط§ظ„ط£ط¬ظ‡ط²ط© ظˆط§ظ„ط¬ظ„ط³ط§طھ"
          value="ط¥ط¯ط§ط±ط©"
          onPress={() => router.push('/sessions')}
        />
        <SettingRow
          icon={Shield}
          label="ط§ظ„ظ…ط³طھط®ط¯ظ…ظˆظ† ط§ظ„ظ…ط­ط¸ظˆط±ظˆظ†"
          value="ط¥ط¯ط§ط±ط©"
          onPress={() => router.push('/blocked-users')}
        />
        <SettingRow
          icon={ShieldAlert}
          label="ط§ظ„ظ…ط®ط§ظ„ظپط§طھ ظˆط§ظ„ط¹ظ‚ظˆط¨ط§طھ"
          value="ط³ط¬ظ„ظٹ"
          onPress={() => router.push('/moderation')}
        />
        <SettingRow
          icon={HelpCircle}
          label="ط§ظ„ظ…ط³ط§ط¹ط¯ط© ظˆط§ظ„ط¯ط¹ظ…"
          value="طھط°ط§ظƒط±ظٹ"
          onPress={() => router.push('/support')}
          last
        />
      </View>

      <TouchableOpacity
        style={[styles.deleteAccountButton, deletingAccount && styles.disabledButton]}
        onPress={handleDeleteAccount}
        disabled={deletingAccount}
        accessibilityRole="button"
        accessibilityState={{ disabled: deletingAccount }}
      >
        <Trash2 size={18} color={colors.danger} />
        <Text style={styles.deleteAccountText}>
          {deletingAccount ? 'ط¬ط§ط±ظچ ط­ط°ظپ ط§ظ„ط­ط³ط§ط¨...' : 'ط­ط°ظپ ط§ظ„ط­ط³ط§ط¨ ظ†ظ‡ط§ط¦ظٹظ‹ط§'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
        <LogOut size={18} color={colors.danger} />
        <Text style={styles.signOutText}>طھط³ط¬ظٹظ„ ط§ظ„ط®ط±ظˆط¬</Text>
      </TouchableOpacity>

      <Text style={styles.version}>Wattar آ· ظ†ط³ط®ط© طھط¬ط±ظٹط¨ظٹط© 1.0.0</Text>
    </ScrollView>
  );
}

function SettingRow({
  icon: Icon,
  label,
  value,
  onPress,
  last = false,
}: {
  icon: typeof Globe;
  label: string;
  value: string;
  onPress: () => void;
  last?: boolean;
}) {
  return (
    <TouchableOpacity style={[styles.row, !last && styles.rowBorder]} onPress={onPress}>
      <View style={styles.rowIcon}><Icon size={18} color={colors.primary} /></View>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
      <ChevronLeft size={17} color={colors.textMuted} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 20, paddingTop: 58, paddingBottom: 36 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 24 },
  backButton: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  title: { color: colors.text, fontSize: 24, fontFamily: fonts.semibold },
  accountCard: { flexDirection: 'row', alignItems: 'center', padding: 18, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginBottom: 28 },
  accountIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
  accountText: { marginLeft: 14, gap: 4 },
  accountName: { color: colors.text, fontSize: 16, fontFamily: fonts.semibold },
  accountMeta: { color: colors.textSecondary, fontSize: 13 },
  sectionTitle: { color: colors.textSecondary, fontSize: 13, fontFamily: fonts.semibold, marginBottom: 10, marginHorizontal: 4 },
  group: { overflow: 'hidden', borderRadius: 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  row: { minHeight: 62, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, gap: 10 },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
  rowLabel: { flex: 1, color: colors.text, fontSize: 14 },
  settingCopy: { flex: 1, gap: 4 },
  rowDescription: { color: colors.textSecondary, fontSize: 11 },
  rowValue: { color: colors.textSecondary, fontSize: 12 },
  fontSizeSection: { padding: 14, gap: 12 },
  sizeOptions: { flexDirection: 'row', gap: 8 },
  sizeOption: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 38, borderRadius: 11, backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.border },
  sizeOptionActive: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  sizeOptionText: { color: colors.textSecondary, fontSize: 12 },
  sizeOptionTextActive: { color: colors.primary, fontFamily: fonts.semibold },
  accountSection: { marginTop: 24 },
  signOutButton: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, borderRadius: 16, backgroundColor: colors.dangerSoft, marginTop: 28 },
  signOutText: { color: colors.danger, fontSize: 14, fontFamily: fonts.semibold },
  deleteAccountButton: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.danger, marginTop: 12 },
  deleteAccountText: { color: colors.danger, fontSize: 14, fontFamily: fonts.semibold },
  disabledButton: { opacity: 0.6 },
  version: { marginTop: 24, color: colors.textSecondary, textAlign: 'center', fontSize: 12 },
});
