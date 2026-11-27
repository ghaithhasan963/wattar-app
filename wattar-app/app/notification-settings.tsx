/**
 * Wattar — تفضيلات الإشعارات (M9.3)
 * كل القراءة والكتابة عبر RPCs: get_my_notification_preferences /
 * set_my_notification_preference / reset_my_notification_preferences.
 * الأنواع تأتي من كتالوج الخادم، فأي نوع جديد يظهر هنا بلا تعديل كود.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Bell, ChevronLeft, RotateCcw } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';

interface NotificationPreference {
  event_type: string;
  category: string;
  label_ar: string;
  description_ar: string | null;
  can_disable_in_app: boolean;
  in_app: boolean;
  push: boolean;
  is_default: boolean;
}

const CATEGORY_ORDER = ['messages', 'social', 'gifts', 'wallet', 'account', 'support', 'marketing'] as const;

const CATEGORY_LABELS: Record<string, string> = {
  messages: 'الرسائل والدعوات',
  social: 'المجتمع والأصدقاء',
  gifts: 'الهدايا',
  wallet: 'المحفظة والأرباح',
  account: 'الحساب والعضويات',
  support: 'الدعم والإشراف',
  marketing: 'إعلانات Wattar',
};

export default function NotificationSettingsScreen() {
  const router = useRouter();
  const [items, setItems] = useState<NotificationPreference[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const { data, error } = await supabase.rpc('get_my_notification_preferences');
    if (error) {
      setLoadError(error.message);
      setItems([]);
    } else {
      setItems(Array.isArray(data) ? (data as NotificationPreference[]) : []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const applyPreference = useCallback(
    async (item: NotificationPreference, nextInApp: boolean, nextPush: boolean) => {
      setSaving(item.event_type);
      // تحديث متفائل حتى تكون الاستجابة فورية، ونرجع للحالة السابقة عند الفشل
      setItems((prev) =>
        prev.map((row) =>
          row.event_type === item.event_type ? { ...row, in_app: nextInApp, push: nextPush, is_default: false } : row,
        ),
      );
      const { error } = await supabase.rpc('set_my_notification_preference', {
        p_event_type: item.event_type,
        p_in_app: nextInApp,
        p_push: nextPush,
      });
      setSaving(null);
      if (error) {
        setItems((prev) =>
          prev.map((row) =>
            row.event_type === item.event_type ? { ...row, in_app: item.in_app, push: item.push, is_default: item.is_default } : row,
          ),
        );
        Alert.alert('تعذر حفظ التفضيل', error.message);
      }
    },
    [],
  );

  const toggleInApp = (item: NotificationPreference, value: boolean) => {
    void applyPreference(item, value, item.push);
  };

  const togglePush = (item: NotificationPreference, value: boolean) => {
    void applyPreference(item, item.in_app, value);
  };

  const resetAll = () => {
    Alert.alert(
      'استعادة الافتراضي',
      'ستُعاد كل تفضيلات الإشعارات إلى الوضع الافتراضي. هل تريد المتابعة؟',
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'استعادة',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setResetting(true);
              const { error } = await supabase.rpc('reset_my_notification_preferences');
              setResetting(false);
              if (error) {
                Alert.alert('تعذر الاستعادة', error.message);
                return;
              }
              await load();
            })();
          },
        },
      ],
    );
  };

  const grouped = CATEGORY_ORDER.map((category) => ({
    category,
    label: CATEGORY_LABELS[category] ?? category,
    rows: items.filter((item) => item.category === category),
  })).filter((group) => group.rows.length > 0);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} accessibilityLabel="رجوع">
          <ChevronLeft size={22} color={colors.textSecondary} />
        </TouchableOpacity>
        <Text style={styles.title}>الإشعارات</Text>
      </View>

      <View style={styles.descCard}>
        <Bell size={20} color={colors.primary} />
        <Text style={styles.descText}>
          اختر لكل نوع من الإشعارات إن كان يظهر داخل التطبيق أو يصل كإشعار على جهازك.
          إشعارات الأمان والعمليات المالية تبقى داخل التطبيق دائماً.
        </Text>
      </View>

      {loading ? (
        <View style={styles.loader}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.loaderText}>جارٍ تحميل تفضيلاتك…</Text>
        </View>
      ) : loadError ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>{loadError}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => void load()}>
            <Text style={styles.retryText}>إعادة المحاولة</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          {grouped.map((group) => (
            <View key={group.category} style={styles.section}>
              <Text style={styles.sectionTitle}>{group.label}</Text>
              <View style={styles.group}>
                {group.rows.map((item, index) => {
                  const isLast = index === group.rows.length - 1;
                  const busy = saving === item.event_type;
                  return (
                    <View key={item.event_type} style={[styles.row, !isLast && styles.rowBorder]}>
                      <View style={styles.rowCopy}>
                        <Text style={styles.rowLabel}>{item.label_ar}</Text>
                        {item.description_ar ? (
                          <Text style={styles.rowDescription}>{item.description_ar}</Text>
                        ) : null}
                        <View style={styles.switchLine}>
                          <View style={styles.switchItem}>
                            <Text style={styles.switchLabel}>داخل التطبيق</Text>
                            <Switch
                              value={item.in_app}
                              onValueChange={(value) => toggleInApp(item, value)}
                              disabled={busy || !item.can_disable_in_app}
                              trackColor={{ false: colors.border, true: colors.primary }}
                              thumbColor="#F8FAFC"
                              accessibilityLabel={`${item.label_ar} داخل التطبيق`}
                            />
                          </View>
                          <View style={styles.switchItem}>
                            <Text style={styles.switchLabel}>على الجهاز</Text>
                            <Switch
                              value={item.push}
                              onValueChange={(value) => togglePush(item, value)}
                              disabled={busy}
                              trackColor={{ false: colors.border, true: colors.primary }}
                              thumbColor="#F8FAFC"
                              accessibilityLabel={`${item.label_ar} على الجهاز`}
                            />
                          </View>
                        </View>
                        {!item.can_disable_in_app ? (
                          <Text style={styles.mandatoryHint}>إشعار إلزامي — يبقى داخل التطبيق دائماً.</Text>
                        ) : null}
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          ))}

          {grouped.length === 0 ? (
            <Text style={styles.emptyText}>لا توجد أنواع إشعارات متاحة حالياً.</Text>
          ) : (
            <TouchableOpacity
              style={[styles.resetButton, resetting && styles.disabledButton]}
              onPress={resetAll}
              disabled={resetting}
              accessibilityRole="button"
            >
              <RotateCcw size={17} color={colors.textSecondary} />
              <Text style={styles.resetText}>{resetting ? 'جارٍ الاستعادة…' : 'استعادة الإعداد الافتراضي'}</Text>
            </TouchableOpacity>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 20, paddingTop: 58, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  backButton: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  title: { color: colors.text, fontSize: 24, fontWeight: '700' },
  descCard: { flexDirection: 'row', gap: 10, padding: 16, borderRadius: 18, backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: colors.border, marginBottom: 22 },
  descText: { flex: 1, color: colors.textSecondary, fontSize: 12, lineHeight: 19 },
  loader: { alignItems: 'center', gap: 10, paddingVertical: 40 },
  loaderText: { color: colors.textSecondary, fontSize: 13 },
  errorCard: { padding: 16, borderRadius: 16, backgroundColor: colors.dangerSoft, borderWidth: 1, borderColor: colors.danger, gap: 12 },
  errorText: { color: colors.danger, fontSize: 13 },
  retryButton: { alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: colors.surface },
  retryText: { color: colors.text, fontSize: 12, fontWeight: '600' },
  section: { marginBottom: 20 },
  sectionTitle: { color: colors.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 10, marginHorizontal: 4 },
  group: { overflow: 'hidden', borderRadius: 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  row: { paddingHorizontal: 14, paddingVertical: 14 },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowCopy: { gap: 6 },
  rowLabel: { color: colors.text, fontSize: 14, fontWeight: '600' },
  rowDescription: { color: colors.textSecondary, fontSize: 11, lineHeight: 17 },
  switchLine: { flexDirection: 'row', gap: 22, marginTop: 4 },
  switchItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  switchLabel: { color: colors.textSecondary, fontSize: 11 },
  mandatoryHint: { color: colors.gold, fontSize: 10, marginTop: 2 },
  emptyText: { color: colors.textSecondary, fontSize: 13, textAlign: 'center', paddingVertical: 30 },
  resetButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 50, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginTop: 4 },
  resetText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  disabledButton: { opacity: 0.6 },
});
