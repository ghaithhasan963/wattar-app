import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Bell, ChevronLeft, Globe, HelpCircle, KeyRound, LogOut, MessageCircle, Shield, User, Sparkles, Trash2 } from 'lucide-react-native';
import { useAuthStore } from '@/store/auth';
import { ChatTextSize, usePreferencesStore } from '@/store/preferences';
import { colors } from '@/lib/theme';
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
      Alert.alert('تعذر حفظ الإعداد', error instanceof Error ? error.message : 'حاول مرة أخرى.');
    }
  };

  const updateChatTextSize = async (size: ChatTextSize) => {
    try {
      await setChatTextSize(size);
    } catch (error: unknown) {
      Alert.alert('تعذر حفظ الإعداد', error instanceof Error ? error.message : 'حاول مرة أخرى.');
    }
  };

  const updateNotifications = async (enabled: boolean) => {
    try {
      if (enabled) await enableSocialPushNotifications();
      else await disableSocialPushNotifications();
      setNotificationsEnabled(enabled);
    } catch (error: unknown) {
      Alert.alert('تعذر تحديث الإشعارات', error instanceof Error ? error.message : 'حاول مرة أخرى.');
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
      Alert.alert('تعذر تحديث الخصوصية', error instanceof Error ? error.message : 'حاول مرة أخرى.');
    }
  };

  const handleSignOut = () => {
    Alert.alert('تسجيل الخروج', 'هل تريد تسجيل الخروج من حسابك؟', [
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

  const handleDeleteAccount = () => {
    Alert.alert(
      'حذف الحساب نهائيًا',
      'ستُزال بيانات الدخول والوسائط، ويُخفى ملفك ومحتواك عن المستخدمين. ستُحفظ سجلات المعاملات المالية الضرورية. لا يمكن التراجع عن هذا الإجراء.',
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'حذف حسابي',
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
                  'تعذر حذف الحساب',
                  error instanceof Error ? error.message : 'تحقق من اتصال الإنترنت وحاول مجددًا.',
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
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} accessibilityLabel="رجوع">
          <ChevronLeft size={22} color={colors.textSecondary} />
        </TouchableOpacity>
        <Text style={styles.title}>الإعدادات</Text>
      </View>

      <View style={styles.accountCard}>
        <View style={styles.accountIcon}><User size={22} color={colors.primary} /></View>
        <View style={styles.accountText}>
          <Text style={styles.accountName}>{profile?.display_name || profile?.username || 'حسابي'}</Text>
          <Text style={styles.accountMeta}>@{profile?.username || '—'}</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>التخصيص</Text>
      <View style={styles.group}>
        <View style={[styles.row, styles.rowBorder]}>
          <View style={styles.rowIcon}><Sparkles size={18} color={colors.primary} /></View>
          <View style={styles.settingCopy}>
            <Text style={styles.rowLabel}>تقليل الحركة</Text>
            <Text style={styles.rowDescription}>إيقاف الحركات الانتقالية لتجربة أهدأ</Text>
          </View>
          <Switch
            value={reduceMotion}
            onValueChange={updateMotionPreference}
            trackColor={{ false: colors.border, true: colors.primary }}
            thumbColor="#F8FAFC"
            accessibilityLabel="تقليل الحركة"
          />
        </View>
        <View style={[styles.row, styles.rowBorder]}>
          <View style={styles.rowIcon}><Bell size={18} color={colors.primary} /></View>
          <View style={styles.settingCopy}>
            <Text style={styles.rowLabel}>الإشعارات</Text>
            <Text style={styles.rowDescription}>
              {notificationsEnabled
                ? 'مفعلة على هذا الجهاز. فعّلها أيضًا على الجهاز الذي تريد استقبال الإشعارات عليه.'
                : 'فعّلها على جهاز كل حساب لاستقبال طلبات الصداقة والرسائل ودعوات الغرف.'}
            </Text>
          </View>
          <Switch
            value={notificationsEnabled}
            onValueChange={updateNotifications}
            trackColor={{ false: colors.border, true: colors.primary }}
            thumbColor="#F8FAFC"
            accessibilityLabel="إشعارات Wattar"
          />
        </View>
        <View style={[styles.row, styles.rowBorder]}>
          <View style={styles.rowIcon}><MessageCircle size={18} color={colors.primary} /></View>
          <View style={styles.settingCopy}>
            <Text style={styles.rowLabel}>رسائل المضيفات الافتتاحية</Text>
            <Text style={styles.rowDescription}>
              {hostOutreachOptOut === null
                ? 'جارٍ تحميل تفضيلك...'
                : hostOutreachOptOut
                  ? 'متوقفة. لن تبدأ المضيفات محادثات جديدة معك.'
                  : 'قد تصلك رسائل تعارف محدودة، ويمكنك تجاهلها أو حظر المرسل.'}
            </Text>
          </View>
          <Switch
            value={hostOutreachOptOut === false}
            onValueChange={updateHostOutreach}
            disabled={hostOutreachOptOut === null}
            trackColor={{ false: colors.border, true: colors.primary }}
            thumbColor="#F8FAFC"
            accessibilityLabel="رسائل المضيفات الافتتاحية"
          />
        </View>
        <View style={styles.fontSizeSection}>
          <Text style={styles.rowLabel}>حجم نص المحادثة</Text>
          <View style={styles.sizeOptions}>
            {([
              ['small', 'صغير'],
              ['medium', 'متوسط'],
              ['large', 'كبير'],
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

      <Text style={[styles.sectionTitle, styles.accountSection]}>الحساب والدعم</Text>
      <View style={styles.group}>
        <SettingRow
          icon={Shield}
          label="الخصوصية والأمان"
          value="نصائح"
          onPress={() => Alert.alert('الخصوصية والأمان', 'لا تشارك كلمة المرور أو رمز التحقق مع أي شخص.')}
        />
        <SettingRow
          icon={KeyRound}
          label="كلمة المرور"
          value="تغيير"
          onPress={() => router.push('/password')}
        />
        <SettingRow
          icon={Shield}
          label="المستخدمون المحظورون"
          value="إدارة"
          onPress={() => router.push('/blocked-users')}
        />
        <SettingRow
          icon={HelpCircle}
          label="المساعدة والدعم"
          value="مساعدة"
          onPress={() => Alert.alert('الدعم', 'للمساعدة، أرسل وصف المشكلة عبر قناة دعم Wattar الرسمية.')}
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
          {deletingAccount ? 'جارٍ حذف الحساب...' : 'حذف الحساب نهائيًا'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
        <LogOut size={18} color={colors.danger} />
        <Text style={styles.signOutText}>تسجيل الخروج</Text>
      </TouchableOpacity>

      <Text style={styles.version}>Wattar · نسخة تجريبية 1.0.0</Text>
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
      <ChevronLeft size={17} color="#64748B" />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 20, paddingTop: 58, paddingBottom: 36 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 24 },
  backButton: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  title: { color: colors.text, fontSize: 24, fontWeight: '700' },
  accountCard: { flexDirection: 'row', alignItems: 'center', padding: 18, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginBottom: 28 },
  accountIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
  accountText: { marginLeft: 14, gap: 4 },
  accountName: { color: colors.text, fontSize: 16, fontWeight: '700' },
  accountMeta: { color: colors.textSecondary, fontSize: 13 },
  sectionTitle: { color: colors.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 10, marginHorizontal: 4 },
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
  sizeOptionTextActive: { color: colors.primary, fontWeight: '700' },
  accountSection: { marginTop: 24 },
  signOutButton: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, borderRadius: 16, backgroundColor: colors.dangerSoft, marginTop: 28 },
  signOutText: { color: colors.danger, fontSize: 14, fontWeight: '700' },
  deleteAccountButton: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.danger, marginTop: 12 },
  deleteAccountText: { color: colors.danger, fontSize: 14, fontWeight: '700' },
  disabledButton: { opacity: 0.6 },
  version: { marginTop: 24, color: colors.textSecondary, textAlign: 'center', fontSize: 12 },
});
