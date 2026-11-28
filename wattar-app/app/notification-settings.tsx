/**
 * Wattar â€” طھظپط¶ظٹظ„ط§طھ ط§ظ„ط¥ط´ط¹ط§ط±ط§طھ (M9.3)
 * ظƒظ„ ط§ظ„ظ‚ط±ط§ط،ط© ظˆط§ظ„ظƒطھط§ط¨ط© ط¹ط¨ط± RPCs: get_my_notification_preferences /
 * set_my_notification_preference / reset_my_notification_preferences.
 * ط§ظ„ط£ظ†ظˆط§ط¹ طھط£طھظٹ ظ…ظ† ظƒطھط§ظ„ظˆط¬ ط§ظ„ط®ط§ط¯ظ…طŒ ظپط£ظٹ ظ†ظˆط¹ ط¬ط¯ظٹط¯ ظٹط¸ظ‡ط± ظ‡ظ†ط§ ط¨ظ„ط§ طھط¹ط¯ظٹظ„ ظƒظˆط¯.
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
import { colors, fonts } from '@/lib/theme';

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
  messages: 'ط§ظ„ط±ط³ط§ط¦ظ„ ظˆط§ظ„ط¯ط¹ظˆط§طھ',
  social: 'ط§ظ„ظ…ط¬طھظ…ط¹ ظˆط§ظ„ط£طµط¯ظ‚ط§ط،',
  gifts: 'ط§ظ„ظ‡ط¯ط§ظٹط§',
  wallet: 'ط§ظ„ظ…ط­ظپط¸ط© ظˆط§ظ„ط£ط±ط¨ط§ط­',
  account: 'ط§ظ„ط­ط³ط§ط¨ ظˆط§ظ„ط¹ط¶ظˆظٹط§طھ',
  support: 'ط§ظ„ط¯ط¹ظ… ظˆط§ظ„ط¥ط´ط±ط§ظپ',
  marketing: 'ط¥ط¹ظ„ط§ظ†ط§طھ Wattar',
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
      // طھط­ط¯ظٹط« ظ…طھظپط§ط¦ظ„ ط­طھظ‰ طھظƒظˆظ† ط§ظ„ط§ط³طھط¬ط§ط¨ط© ظپظˆط±ظٹط©طŒ ظˆظ†ط±ط¬ط¹ ظ„ظ„ط­ط§ظ„ط© ط§ظ„ط³ط§ط¨ظ‚ط© ط¹ظ†ط¯ ط§ظ„ظپط´ظ„
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
        Alert.alert('طھط¹ط°ط± ط­ظپط¸ ط§ظ„طھظپط¶ظٹظ„', error.message);
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
      'ط§ط³طھط¹ط§ط¯ط© ط§ظ„ط§ظپطھط±ط§ط¶ظٹ',
      'ط³طھظڈط¹ط§ط¯ ظƒظ„ طھظپط¶ظٹظ„ط§طھ ط§ظ„ط¥ط´ط¹ط§ط±ط§طھ ط¥ظ„ظ‰ ط§ظ„ظˆط¶ط¹ ط§ظ„ط§ظپطھط±ط§ط¶ظٹ. ظ‡ظ„ طھط±ظٹط¯ ط§ظ„ظ…طھط§ط¨ط¹ط©طں',
      [
        { text: 'ط¥ظ„ط؛ط§ط،', style: 'cancel' },
        {
          text: 'ط§ط³طھط¹ط§ط¯ط©',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setResetting(true);
              const { error } = await supabase.rpc('reset_my_notification_preferences');
              setResetting(false);
              if (error) {
                Alert.alert('طھط¹ط°ط± ط§ظ„ط§ط³طھط¹ط§ط¯ط©', error.message);
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
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} accessibilityLabel="ط±ط¬ظˆط¹">
          <ChevronLeft size={22} color={colors.textSecondary} />
        </TouchableOpacity>
        <Text style={styles.title}>ط§ظ„ط¥ط´ط¹ط§ط±ط§طھ</Text>
      </View>

      <View style={styles.descCard}>
        <Bell size={20} color={colors.primary} />
        <Text style={styles.descText}>
          ط§ط®طھط± ظ„ظƒظ„ ظ†ظˆط¹ ظ…ظ† ط§ظ„ط¥ط´ط¹ط§ط±ط§طھ ط¥ظ† ظƒط§ظ† ظٹط¸ظ‡ط± ط¯ط§ط®ظ„ ط§ظ„طھط·ط¨ظٹظ‚ ط£ظˆ ظٹطµظ„ ظƒط¥ط´ط¹ط§ط± ط¹ظ„ظ‰ ط¬ظ‡ط§ط²ظƒ.
          ط¥ط´ط¹ط§ط±ط§طھ ط§ظ„ط£ظ…ط§ظ† ظˆط§ظ„ط¹ظ…ظ„ظٹط§طھ ط§ظ„ظ…ط§ظ„ظٹط© طھط¨ظ‚ظ‰ ط¯ط§ط®ظ„ ط§ظ„طھط·ط¨ظٹظ‚ ط¯ط§ط¦ظ…ط§ظ‹.
        </Text>
      </View>

      {loading ? (
        <View style={styles.loader}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.loaderText}>ط¬ط§ط±ظچ طھط­ظ…ظٹظ„ طھظپط¶ظٹظ„ط§طھظƒâ€¦</Text>
        </View>
      ) : loadError ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>{loadError}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => void load()}>
            <Text style={styles.retryText}>ط¥ط¹ط§ط¯ط© ط§ظ„ظ…ط­ط§ظˆظ„ط©</Text>
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
                            <Text style={styles.switchLabel}>ط¯ط§ط®ظ„ ط§ظ„طھط·ط¨ظٹظ‚</Text>
                            <Switch
                              value={item.in_app}
                              onValueChange={(value) => toggleInApp(item, value)}
                              disabled={busy || !item.can_disable_in_app}
                              trackColor={{ false: colors.border, true: colors.primary }}
                              thumbColor={colors.text}
                              accessibilityLabel={`${item.label_ar} ط¯ط§ط®ظ„ ط§ظ„طھط·ط¨ظٹظ‚`}
                            />
                          </View>
                          <View style={styles.switchItem}>
                            <Text style={styles.switchLabel}>ط¹ظ„ظ‰ ط§ظ„ط¬ظ‡ط§ط²</Text>
                            <Switch
                              value={item.push}
                              onValueChange={(value) => togglePush(item, value)}
                              disabled={busy}
                              trackColor={{ false: colors.border, true: colors.primary }}
                              thumbColor={colors.text}
                              accessibilityLabel={`${item.label_ar} ط¹ظ„ظ‰ ط§ظ„ط¬ظ‡ط§ط²`}
                            />
                          </View>
                        </View>
                        {!item.can_disable_in_app ? (
                          <Text style={styles.mandatoryHint}>ط¥ط´ط¹ط§ط± ط¥ظ„ط²ط§ظ…ظٹ â€” ظٹط¨ظ‚ظ‰ ط¯ط§ط®ظ„ ط§ظ„طھط·ط¨ظٹظ‚ ط¯ط§ط¦ظ…ط§ظ‹.</Text>
                        ) : null}
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          ))}

          {grouped.length === 0 ? (
            <Text style={styles.emptyText}>ظ„ط§ طھظˆط¬ط¯ ط£ظ†ظˆط§ط¹ ط¥ط´ط¹ط§ط±ط§طھ ظ…طھط§ط­ط© ط­ط§ظ„ظٹط§ظ‹.</Text>
          ) : (
            <TouchableOpacity
              style={[styles.resetButton, resetting && styles.disabledButton]}
              onPress={resetAll}
              disabled={resetting}
              accessibilityRole="button"
            >
              <RotateCcw size={17} color={colors.textSecondary} />
              <Text style={styles.resetText}>{resetting ? 'ط¬ط§ط±ظچ ط§ظ„ط§ط³طھط¹ط§ط¯ط©â€¦' : 'ط§ط³طھط¹ط§ط¯ط© ط§ظ„ط¥ط¹ط¯ط§ط¯ ط§ظ„ط§ظپطھط±ط§ط¶ظٹ'}</Text>
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
  title: { color: colors.text, fontSize: 24, fontFamily: fonts.semibold },
  descCard: { flexDirection: 'row', gap: 10, padding: 16, borderRadius: 18, backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: colors.border, marginBottom: 22 },
  descText: { flex: 1, color: colors.textSecondary, fontSize: 12, lineHeight: 19 },
  loader: { alignItems: 'center', gap: 10, paddingVertical: 40 },
  loaderText: { color: colors.textSecondary, fontSize: 13 },
  errorCard: { padding: 16, borderRadius: 16, backgroundColor: colors.dangerSoft, borderWidth: 1, borderColor: colors.danger, gap: 12 },
  errorText: { color: colors.danger, fontSize: 13 },
  retryButton: { alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: colors.surface },
  retryText: { color: colors.text, fontSize: 12, fontFamily: fonts.semibold },
  section: { marginBottom: 20 },
  sectionTitle: { color: colors.textSecondary, fontSize: 13, fontFamily: fonts.semibold, marginBottom: 10, marginHorizontal: 4 },
  group: { overflow: 'hidden', borderRadius: 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  row: { paddingHorizontal: 14, paddingVertical: 14 },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowCopy: { gap: 6 },
  rowLabel: { color: colors.text, fontSize: 14, fontFamily: fonts.semibold },
  rowDescription: { color: colors.textSecondary, fontSize: 11, lineHeight: 17 },
  switchLine: { flexDirection: 'row', gap: 22, marginTop: 4 },
  switchItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  switchLabel: { color: colors.textSecondary, fontSize: 11 },
  mandatoryHint: { color: colors.gold, fontSize: 10, marginTop: 2 },
  emptyText: { color: colors.textSecondary, fontSize: 13, textAlign: 'center', paddingVertical: 30 },
  resetButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 50, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginTop: 4 },
  resetText: { color: colors.textSecondary, fontSize: 13, fontFamily: fonts.semibold },
  disabledButton: { opacity: 0.6 },
});
