import React, { useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronLeft, Lock, Shield, UserCheck, Users, MessageCircle, Mail, Eye, DoorOpen } from 'lucide-react-native';
import { colors, fonts } from '@/lib/theme';
import { usePrivacySettings } from '@/hooks/usePrivacySettings';
import {
  PRIVACY_LEVELS,
  PRIVACY_LABELS,
  PRIVACY_DESCRIPTIONS,
  PRIVACY_ACTIONS,
  type PrivacyLevel,
  type PrivacySettings,
} from '@/lib/privacy';

const ICONS: Record<keyof PrivacySettings, React.ComponentType<{ size: number; color: string }>> = {
  can_follow: UserCheck,
  can_message: MessageCircle,
  can_friend_request: Mail,
  can_view_stories: Eye,
  can_view_info: Shield,
  can_enter_rooms: DoorOpen,
};

export default function PrivacySettingsScreen() {
  const router = useRouter();
  const { settings, loading, error, update } = usePrivacySettings();
  const [saving, setSaving] = useState<keyof PrivacySettings | null>(null);

  const handleChange = async (key: keyof PrivacySettings, value: PrivacyLevel) => {
    setSaving(key);
    const ok = await update({ [key]: value });
    setSaving(null);
    if (!ok) {
      Alert.alert('تعذر الحفظ', error || 'حدث خطأ غير متوقع. حاول مرة أخرى.');
    }
  };

  const renderLevelButton = (key: keyof PrivacySettings, level: PrivacyLevel) => {
    const active = settings[key] === level;
    return (
      <TouchableOpacity
        style={[styles.levelBtn, active && styles.levelBtnActive]}
        onPress={() => handleChange(key, level)}
        disabled={saving === key}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
      >
        <Text style={[styles.levelBtnText, active && styles.levelBtnTextActive]}>{PRIVACY_LABELS[level]}</Text>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={styles.loader}>
        <Text style={styles.loaderText}>جاري تحميل إعدادات الخصوصية…</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} accessibilityLabel="رجوع">
          <ChevronLeft size={22} color={colors.textSecondary} />
        </TouchableOpacity>
        <Text style={styles.title}>إعدادات الخصوصية</Text>
      </View>

      <View style={styles.descCard}>
        <Lock size={20} color={colors.primary} />
        <Text style={styles.descText}>
          اختر من يستطيع تنفيذ كل إجراء على حسابك. التغيير فوري ويُحفظ على الخادم.
        </Text>
      </View>

      {PRIVACY_ACTIONS.map((action) => (
        <View key={action.key} style={styles.group}>
          <View style={[styles.row, styles.rowBorder]}>
            <View style={styles.rowIcon}>
              {(() => { const Icon = ICONS[action.key]; return <Icon size={18} color={colors.primary} />; })()}
            </View>
            <View style={styles.rowCopy}>
              <Text style={styles.rowLabel}>{action.label}</Text>
              <Text style={styles.rowDesc}>{action.description}</Text>
            </View>
          </View>
          <View style={styles.levelsRow}>
            {PRIVACY_LEVELS.map((level) => renderLevelButton(action.key, level))}
          </View>
        </View>
      ))}

      <View style={styles.noteCard}>
        <Shield size={18} color={colors.primary} />
        <Text style={styles.noteText}>
          «الأصدقاء فقط» = صداقة مقبولة من الطرفين. «لا أحد» = لا يستطيع أحد (حتى الأصدقاء).
          الحظر يتقدم على إعدادات الخصوصية دائماً.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 20, paddingTop: 58, paddingBottom: 36 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  backButton: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  title: { color: colors.text, fontSize: 24, fontFamily: fonts.semibold },
  descCard: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', padding: 14, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginBottom: 18 },
  descText: { flex: 1, color: colors.textSecondary, fontSize: 12, lineHeight: 19 },
  group: { overflow: 'hidden', borderRadius: 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginBottom: 14 },
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, gap: 10 },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
  rowCopy: { flex: 1, gap: 3 },
  rowLabel: { color: colors.text, fontSize: 14, fontFamily: fonts.semibold },
  rowDesc: { color: colors.textSecondary, fontSize: 11 },
  levelsRow: { flexDirection: 'row', gap: 6, padding: 10 },
  levelBtn: {
    flex: 1,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  levelBtnActive: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  levelBtnText: { color: colors.textSecondary, fontSize: 11, fontFamily: fonts.semibold },
  levelBtnTextActive: { color: colors.primary, fontFamily: fonts.semibold },
  noteCard: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', padding: 14, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginTop: 10 },
  noteText: { flex: 1, color: colors.textSecondary, fontSize: 11, lineHeight: 18 },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loaderText: { color: colors.textSecondary, marginTop: 10, fontSize: 13 },
});