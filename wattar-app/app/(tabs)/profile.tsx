import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Image,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { BadgeCheck, ChevronLeft, Coins, Crown, Gem, Gift, ImagePlus, LockKeyhole, LogOut, Mic, Pencil, Settings, Star, User, Users, Wallet } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { NotificationBell } from '@/components/NotificationBell';

interface SocialProgress {
  level: number;
  experience_points: number;
  follower_count: number;
  following_count: number;
  is_following: boolean;
}

const palette = {
  background: '#090611',
  surface: '#171128',
  elevated: '#211638',
  border: '#352449',
  text: '#F8F3FF',
  muted: '#B2A6C3',
  primary: '#B44BFF',
  gold: '#F4BD55',
  teal: '#72DCCA',
  danger: '#FF718E',
} as const;

export default function ProfileScreen() {
  const router = useRouter();
  const { profile, signOut, updateProfileVisibility } = useAuthStore();
  const [progress, setProgress] = useState<SocialProgress | null>(null);
  const [progressError, setProgressError] = useState<string | null>(null);
  const [privacyBusy, setPrivacyBusy] = useState(false);

  const loadProgress = useCallback(async () => {
    if (!profile?.id) return;
    setProgressError(null);
    try {
      const { data, error } = await supabase.rpc('get_wattar_progress', {
        p_user_id: profile.id,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      setProgress(row && typeof row === 'object' ? row as SocialProgress : null);
    } catch (error: unknown) {
      setProgressError(error instanceof Error ? error.message : 'تعذر تحميل التقدم الاجتماعي.');
    }
  }, [profile?.id]);

  useEffect(() => {
    void loadProgress();
  }, [loadProgress]);

  const handleShare = async () => {
    if (!profile?.referral_code) return;
    try {
      await Share.share({
        message: `انضم إلى Wattar معي! استخدم كود الإحالة: ${profile.referral_code}`,
      });
    } catch (error: unknown) {
      Alert.alert('تعذرت المشاركة', error instanceof Error ? error.message : 'حاول مرة أخرى.');
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      router.replace('/(auth)/login');
    } catch (error: unknown) {
      Alert.alert('تعذر تسجيل الخروج', error instanceof Error ? error.message : 'حاول مرة أخرى.');
    }
  };

  const toggleProfileVisibility = async () => {
    if (!profile || privacyBusy) return;
    const nextVisibility = profile.profile_visibility === 'friends' ? 'public' : 'friends';
    setPrivacyBusy(true);
    try {
      await updateProfileVisibility(nextVisibility);
    } catch (error: unknown) {
      Alert.alert('تعذر تحديث الخصوصية', error instanceof Error ? error.message : 'حاول مرة أخرى.');
    } finally {
      setPrivacyBusy(false);
    }
  };

  const level = Math.max(1, progress?.level ?? profile?.level ?? 1);
  const levelBadgeColor = level >= 50 ? '#B44BFF' : level >= 25 ? '#72DCCA' : level >= 10 ? '#C4D0E0' : palette.gold;
  const experience = Math.max(0, progress?.experience_points ?? profile?.experience_points ?? 0);
  const levelStart = (level - 1) ** 2 * 100;
  const nextLevelAt = level ** 2 * 100;
  const levelProgress = Math.max(0, Math.min(1, (experience - levelStart) / (nextLevelAt - levelStart)));

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.topBar}>
        <Text style={styles.pageTitle}>ملفي الشخصي</Text>
        <View style={styles.topActions}>
          <NotificationBell />
          <TouchableOpacity style={styles.settingsButton} onPress={() => router.push('/settings')} accessibilityRole="button">
            <Settings size={19} color={palette.muted} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.profileCard}>
        <View style={styles.profileGlow} />
        <View style={styles.avatarOuter}>
          <View style={styles.avatar}>
            {profile?.avatar_url ? (
              <Image source={{ uri: profile.avatar_url }} style={styles.avatarImage} />
            ) : (
              <User size={34} color={palette.gold} />
            )}
          </View>
          <View style={[styles.levelBadge, { backgroundColor: levelBadgeColor }]}><Star size={12} color="#1B1026" fill="#1B1026" /></View>
        </View>
        <Text style={styles.displayName}>{profile?.display_name || profile?.username || 'مستخدم Wattar'}</Text>
        <Text style={styles.username}>@{profile?.username}</Text>
        {profile?.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}
        {profile?.gender ? (
          <Text style={styles.profileMeta}>
            {profile.gender === 'female' ? 'أنثى' : profile.gender === 'male' ? 'ذكر' : 'أفضل وصفًا آخر'}
          </Text>
        ) : null}
        <TouchableOpacity
          style={styles.editButton}
          onPress={() => router.push('/profile/edit')}
          accessibilityRole="button"
        >
          <Pencil size={15} color="#FFFFFF" />
          <Text style={styles.editButtonText}>تعديل الملف</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.postsButton}
          onPress={() => profile?.id && router.push(`/user/${profile.id}`)}
          accessibilityRole="button"
        >
          <ImagePlus size={15} color={palette.primary} />
          <Text style={styles.postsButtonText}>ملفي ومنشوراتي</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.hostProgramButton}
          onPress={() => router.push('/host-application')}
          accessibilityRole="button"
        >
          <Mic size={15} color={palette.gold} />
          <Text style={styles.hostProgramButtonText}>برنامج المضيفات وطلب التوثيق</Text>
          <BadgeCheck size={14} color={palette.gold} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.privacyButton}
          onPress={toggleProfileVisibility}
          disabled={privacyBusy}
          accessibilityRole="button"
          accessibilityLabel="تغيير خصوصية الملف الشخصي"
        >
          <LockKeyhole size={14} color={palette.gold} />
          <Text style={styles.privacyButtonText}>
            {privacyBusy ? 'جارٍ الحفظ...' : profile?.profile_visibility === 'friends' ? 'الملف للأصدقاء فقط' : 'الملف عام'}
          </Text>
        </TouchableOpacity>
        {profile?.referral_code ? (
          <TouchableOpacity style={styles.referral} onPress={handleShare} accessibilityRole="button">
            <Gift size={14} color={palette.gold} />
            <Text style={styles.referralText}>كود الدعوة: {profile.referral_code}</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={styles.levelCard}>
        <View style={styles.levelTop}>
          <View style={styles.levelIcon}><Star size={17} color={palette.gold} /></View>
          <View style={styles.levelCopy}>
            <Text style={styles.levelTitle}>المستوى {level}</Text>
            <Text style={styles.levelCaption}>المستويات تُكتسب بالنشاط ولا تُشترى</Text>
          </View>
          <Text style={styles.xpValue}>{experience.toLocaleString()} XP</Text>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${levelProgress * 100}%` }]} />
        </View>
        <Text style={styles.nextLevelText}>
          {Math.max(0, nextLevelAt - experience).toLocaleString()} XP للمستوى التالي
        </Text>
        {progressError ? <Text style={styles.progressError}>{progressError}</Text> : null}
      </View>

      <View style={styles.socialStats}>
        <StatCard
          icon={Users}
          label="المتابعون"
          value={progress?.follower_count ?? 0}
          color={palette.primary}
          onPress={() => router.push('/(tabs)/friends')}
        />
        <StatCard
          icon={Users}
          label="أتابع"
          value={progress?.following_count ?? 0}
          color={palette.gold}
          onPress={() => router.push('/(tabs)/friends')}
        />
      </View>

      <View style={styles.walletCard}>
        <View style={styles.walletHeading}>
          <Text style={styles.sectionTitle}>أرصدتي</Text>
          <TouchableOpacity onPress={() => router.push('/(tabs)/wallet')} style={styles.walletLink}>
            <Text style={styles.walletLinkText}>المحفظة</Text>
            <ChevronLeft size={15} color={palette.gold} />
          </TouchableOpacity>
        </View>
        <View style={styles.balanceRow}>
          <View style={styles.balanceItem}>
            <View style={styles.coinsIcon}><Coins size={16} color={palette.gold} /></View>
            <View>
              <Text style={styles.balanceValue}>{(profile?.balance_gold ?? 0).toLocaleString()}</Text>
              <Text style={styles.balanceLabel}>Coins مدفوعة</Text>
            </View>
          </View>
          <View style={styles.balanceDivider} />
          <View style={styles.balanceItem}>
            <View style={styles.gemsIcon}><Gem size={16} color={palette.teal} /></View>
            <View>
              <Text style={styles.balanceValue}>{(profile?.balance_diamond ?? 0).toLocaleString()}</Text>
              <Text style={styles.balanceLabel}>Diamonds</Text>
            </View>
          </View>
        </View>
        <Text style={styles.walletFootnote}>Diamonds القابلة للسحب تأتي من الهدايا الممولة بـCoins مدفوعة.</Text>
      </View>

      <View style={styles.menuCard}>
        <MenuItem icon={Users} label="المجتمع والمتابعة" onPress={() => router.push('/(tabs)/friends')} />
        <MenuItem icon={Wallet} label="المحفظة وسجل المعاملات" onPress={() => router.push('/(tabs)/wallet')} />
        <MenuItem icon={Crown} label="عضوية VIP" onPress={() => router.push('/membership')} />
        <MenuItem icon={Settings} label="إعدادات الحساب والأمان" onPress={() => router.push('/settings')} />
      </View>

      <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
        <LogOut size={17} color={palette.danger} />
        <Text style={styles.signOutText}>تسجيل الخروج</Text>
      </TouchableOpacity>
      <Text style={styles.version}>Wattar · مجتمع الصوت</Text>
    </ScrollView>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
  onPress,
}: {
  icon: typeof Users;
  label: string;
  value: number;
  color: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.statCard} onPress={onPress} accessibilityRole="button">
      <View style={[styles.statIcon, { backgroundColor: `${color}24` }]}><Icon size={16} color={color} /></View>
      <Text style={styles.statValue}>{value.toLocaleString()}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

function MenuItem({ icon: Icon, label, onPress }: { icon: typeof Settings; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.menuItem} onPress={onPress} accessibilityRole="button">
      <View style={styles.menuIcon}><Icon size={17} color={palette.gold} /></View>
      <Text style={styles.menuText}>{label}</Text>
      <ChevronLeft size={17} color={palette.muted} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background },
  content: { paddingHorizontal: 16, paddingTop: 54, paddingBottom: 112 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pageTitle: { color: palette.text, fontSize: 22, fontWeight: '800' },
  settingsButton: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  profileCard: { alignItems: 'center', overflow: 'hidden', padding: 20, borderRadius: 23, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  profileGlow: { position: 'absolute', top: -90, width: 250, height: 150, borderRadius: 100, backgroundColor: '#48215F', opacity: 0.35 },
  avatarOuter: { width: 94, height: 94, borderRadius: 32, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: palette.gold, backgroundColor: '#302312' },
  avatar: { width: 82, height: 82, borderRadius: 27, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.elevated, overflow: 'hidden' },
  avatarImage: { width: '100%', height: '100%' },
  levelBadge: { position: 'absolute', bottom: -3, right: -3, width: 25, height: 25, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.gold, borderWidth: 2, borderColor: palette.surface },
  displayName: { color: palette.text, fontSize: 20, fontWeight: '800', marginTop: 13 },
  username: { color: palette.muted, fontSize: 12, marginTop: 4 },
  bio: { color: palette.muted, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 9, maxWidth: 280 },
  profileMeta: { color: palette.muted, fontSize: 11, marginTop: 8 },
  editButton: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 15, paddingVertical: 10, borderRadius: 12, backgroundColor: palette.primary, marginTop: 14 },
  editButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  postsButton: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 13, paddingVertical: 9, borderRadius: 12, backgroundColor: palette.elevated, borderWidth: 1, borderColor: palette.border, marginTop: 8 },
  postsButtonText: { color: palette.text, fontSize: 11, fontWeight: '700' },
  hostProgramButton: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 13, paddingVertical: 9, borderRadius: 12, backgroundColor: '#F4BD5518', borderWidth: 1, borderColor: '#F4BD5533', marginTop: 8 },
  hostProgramButtonText: { color: palette.gold, fontSize: 11, fontWeight: '700' },
  privacyButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, minHeight: 34, paddingHorizontal: 12, marginTop: 8, borderRadius: 12, backgroundColor: '#211B2C', borderWidth: 1, borderColor: palette.border },
  privacyButtonText: { color: palette.gold, fontSize: 11, fontWeight: '700' },
  referral: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 13, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 10, backgroundColor: '#302312' },
  referralText: { color: palette.gold, fontSize: 11, fontWeight: '600' },
  levelCard: { padding: 15, marginTop: 13, borderRadius: 19, backgroundColor: palette.surface, borderWidth: 1, borderColor: '#5B4324' },
  levelTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  levelIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#382A14' },
  levelCopy: { flex: 1 },
  levelTitle: { color: palette.gold, fontSize: 14, fontWeight: '800', textAlign: 'right' },
  levelCaption: { color: palette.muted, fontSize: 10, marginTop: 3, textAlign: 'right' },
  xpValue: { color: palette.text, fontSize: 11, fontWeight: '700' },
  progressTrack: { height: 8, overflow: 'hidden', borderRadius: 8, backgroundColor: palette.elevated, marginTop: 14 },
  progressFill: { height: '100%', borderRadius: 8, backgroundColor: palette.gold },
  nextLevelText: { color: palette.muted, fontSize: 10, marginTop: 7, textAlign: 'right' },
  progressError: { color: palette.danger, fontSize: 10, marginTop: 8, textAlign: 'right' },
  socialStats: { flexDirection: 'row', gap: 10, marginTop: 12 },
  statCard: { flex: 1, alignItems: 'center', padding: 12, borderRadius: 17, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  statIcon: { width: 31, height: 31, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  statValue: { color: palette.text, fontSize: 19, fontWeight: '800', marginTop: 7 },
  statLabel: { color: palette.muted, fontSize: 10, marginTop: 3 },
  walletCard: { padding: 15, marginTop: 12, borderRadius: 18, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  walletHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { color: palette.text, fontSize: 14, fontWeight: '800' },
  walletLink: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  walletLinkText: { color: palette.gold, fontSize: 11, fontWeight: '700' },
  balanceRow: { flexDirection: 'row', alignItems: 'center', marginTop: 15 },
  balanceItem: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 9 },
  coinsIcon: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#382A14' },
  gemsIcon: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#153832' },
  balanceValue: { color: palette.text, fontSize: 14, fontWeight: '800' },
  balanceLabel: { color: palette.muted, fontSize: 10, marginTop: 2 },
  balanceDivider: { width: 1, height: 32, backgroundColor: palette.border, marginHorizontal: 12 },
  walletFootnote: { color: palette.muted, fontSize: 10, lineHeight: 15, marginTop: 12, textAlign: 'right' },
  menuCard: { marginTop: 13, paddingHorizontal: 12, borderRadius: 18, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  menuItem: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.border },
  menuIcon: { width: 32, height: 32, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.elevated },
  menuText: { flex: 1, color: palette.text, fontSize: 12, textAlign: 'right' },
  signOutButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 46, marginTop: 14, borderRadius: 14, backgroundColor: '#351727', borderWidth: 1, borderColor: '#5A2940' },
  signOutText: { color: palette.danger, fontSize: 12, fontWeight: '700' },
  version: { color: palette.muted, fontSize: 10, textAlign: 'center', marginTop: 15 },
});
