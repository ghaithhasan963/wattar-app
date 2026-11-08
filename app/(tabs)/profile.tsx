/**
 * Wattar App — صفحة الملف الشخصي
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Share, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '@/store/auth';
import { LogOut, Gift, Settings, ChevronLeft, User, Pencil } from 'lucide-react-native';
import { colors } from '@/lib/theme';

export default function ProfileScreen() {
  const router = useRouter();
  const { profile, signOut } = useAuthStore();

  const handleShare = async () => {
    if (!profile?.referral_code) return;
    await Share.share({
      message: `انضم إلى Wattar معي! استخدم كود الإحالة: ${profile.referral_code}`,
    });
  };

  const handleSignOut = async () => {
    await signOut();
    router.replace('/(auth)/login');
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View style={styles.avatarContainer}>
          <View style={styles.avatar}>
            {profile?.avatar_url ? (
              <Image source={{ uri: profile.avatar_url }} style={styles.avatarImage} />
            ) : (
              <User size={32} color="#7C3AED" />
            )}
          </View>
        </View>
        <Text style={styles.displayName}>{profile?.display_name ?? profile?.username}</Text>
        <Text style={styles.username}>@{profile?.username}</Text>
        {profile?.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}
        <TouchableOpacity
          style={styles.editButton}
          onPress={() => router.push('/profile/edit')}
          accessibilityRole="button"
        >
          <Pencil size={16} color="#EDE9FE" />
          <Text style={styles.editButtonText}>تعديل الملف الشخصي</Text>
        </TouchableOpacity>
        <View style={styles.codeRow}>
          <Text style={styles.codeLabel}>كود الإحالة:</Text>
          <Text style={styles.codeValue}>{profile?.referral_code}</Text>
        </View>
      </View>

      <View style={styles.statsGrid}>
        <StatBox label="إجمالي الشحن" value={profile?.total_deposited ?? 0} unit="$" color="#10B981" />
        <StatBox label="إجمالي السحب" value={profile?.total_withdrawn ?? 0} unit="$" color="#EF4444" />
        <StatBox label="إجمالي الرهانات" value={profile?.total_wagered ?? 0} unit="ذهب" color="#7C3AED" />
        <StatBox label="إجمالي الأرباح" value={profile?.total_won ?? 0} unit="ذهب" color="#F59E0B" />
      </View>

      <View style={styles.menuSection}>
        <MenuItem icon={Gift} label="دعوة الأصدقاء" onPress={handleShare} color="#F59E0B" />
        <MenuItem icon={Settings} label="الإعدادات" onPress={() => router.push('/settings')} color="#9CA3AF" />
      </View>

      <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
        <LogOut size={18} color="#EF4444" />
        <Text style={styles.signOutText}>تسجيل خروج</Text>
      </TouchableOpacity>

      <Text style={styles.version}>Wattar v1.0.0</Text>
    </ScrollView>
  );
}

function StatBox({ label, value, unit, color }: { label: string; value: number; unit: string; color: string }) {
  return (
    <View style={styles.statBox}>
      <Text style={[styles.statValue, { color }]}>{value.toLocaleString()}</Text>
      <Text style={styles.statUnit}>{unit}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function MenuItem({ icon: Icon, label, onPress, color }: any) {
  return (
    <TouchableOpacity style={styles.menuItem} onPress={onPress}>
      <View style={[styles.menuIcon, { backgroundColor: color + '20' }]}>
        <Icon size={18} color={color} />
      </View>
      <Text style={styles.menuText}>{label}</Text>
      <ChevronLeft size={18} color="#6B7280" />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingBottom: 104 },
  header: {
    alignItems: 'center',
    paddingTop: 60,
    paddingBottom: 24,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  avatarContainer: { marginBottom: 12 },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.primary,
    overflow: 'hidden',
  },
  avatarImage: { width: '100%', height: '100%' },
  displayName: { color: colors.text, fontSize: 20, fontWeight: 'bold' },
  username: { color: colors.textSecondary, fontSize: 14, marginTop: 4 },
  bio: { color: colors.textSecondary, fontSize: 13, marginTop: 8, maxWidth: 280, textAlign: 'center' },
  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.primary,
    borderRadius: 12,
  },
  editButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
  codeLabel: { color: colors.textSecondary, fontSize: 12 },
  codeValue: { color: colors.primary, fontSize: 14, fontWeight: 'bold' },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 16,
    gap: 12,
  },
  statBox: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
  },
  statValue: { fontSize: 20, fontWeight: 'bold' },
  statUnit: { color: colors.textSecondary, fontSize: 11, marginTop: 2 },
  statLabel: { color: colors.textSecondary, fontSize: 11, marginTop: 6 },
  menuSection: { padding: 16, gap: 8 },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 14,
    gap: 12,
  },
  menuIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  menuText: { flex: 1, color: colors.text, fontSize: 14 },
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    margin: 16,
    padding: 14,
    backgroundColor: '#EF444415',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#EF444430',
  },
  signOutText: { color: '#EF4444', fontSize: 14, fontWeight: '600' },
  version: { color: colors.textSecondary, fontSize: 11, textAlign: 'center', paddingBottom: 24 },
});
