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
import {
  BadgeCheck,
  ChevronLeft,
  Coins,
  Crown,
  Flame,
  Gem,
  Gift,
  Headset,
  ImagePlus,
  LockKeyhole,
  LogOut,
  Pencil,
  Settings,
  ShieldBan,
  ShieldCheck,
  Sparkles,
  Star,
  User,
  Users,
  Wallet,
} from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { NotificationBell } from '@/components/NotificationBell';
import { colors, fonts, radius } from '@/lib/theme';

interface SocialProgress {
  level: number;
  experience_points: number;
  follower_count: number;
  following_count: number;
  is_following: boolean;
}

const palette = {
  background: colors.background,
  surface: colors.surface,
  elevated: colors.surfaceElevated,
  border: colors.border,
  text: colors.text,
  muted: colors.textSecondary,
  primary: colors.primary,
  gold: colors.gold,
  teal: colors.teal,
  danger: colors.danger,
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
      setProgressError(error instanceof Error ? error.message : 'طھط¹ط°ط± طھط­ظ…ظٹظ„ ط§ظ„طھظ‚ط¯ظ… ط§ظ„ط§ط¬طھظ…ط§ط¹ظٹ.');
    }
  }, [profile?.id]);

  useEffect(() => {
    void loadProgress();
  }, [loadProgress]);

  const handleShare = async () => {
    if (!profile?.referral_code) return;
    try {
      await Share.share({
        message: `ط§ظ†ط¶ظ… ط¥ظ„ظ‰ Wattar ظ…ط¹ظٹ! ط§ط³طھط®ط¯ظ… ظƒظˆط¯ ط§ظ„ط¥ط­ط§ظ„ط©: ${profile.referral_code}`,
      });
    } catch (error: unknown) {
      Alert.alert('طھط¹ط°ط±طھ ط§ظ„ظ…ط´ط§ط±ظƒط©', error instanceof Error ? error.message : 'ط­ط§ظˆظ„ ظ…ط±ط© ط£ط®ط±ظ‰.');
    }
  };

  const handleSignOut = async () => {
    Alert.alert(
      'طھط³ط¬ظٹظ„ ط§ظ„ط®ط±ظˆط¬',
      'ظ‡ظ„ طھط±ظٹط¯ طھط³ط¬ظٹظ„ ط§ظ„ط®ط±ظˆط¬ ظ…ظ† ط­ط³ط§ط¨ظƒطں',
      [
        { text: 'ط¥ظ„ط؛ط§ط،', style: 'cancel' },
        {
          text: 'ط®ط±ظˆط¬',
          style: 'destructive',
          onPress: async () => {
            try {
              await signOut();
              router.replace('/(auth)/login');
            } catch (error: unknown) {
              Alert.alert('طھط¹ط°ط± طھط³ط¬ظٹظ„ ط§ظ„ط®ط±ظˆط¬', error instanceof Error ? error.message : 'ط­ط§ظˆظ„ ظ…ط±ط© ط£ط®ط±ظ‰.');
            }
          },
        },
      ],
    );
  };

  const toggleProfileVisibility = async () => {
    if (!profile || privacyBusy) return;
    const nextVisibility = profile.profile_visibility === 'friends' ? 'public' : 'friends';
    setPrivacyBusy(true);
    try {
      await updateProfileVisibility(nextVisibility);
    } catch (error: unknown) {
      Alert.alert('طھط¹ط°ط± طھط­ط¯ظٹط« ط§ظ„ط®طµظˆطµظٹط©', error instanceof Error ? error.message : 'ط­ط§ظˆظ„ ظ…ط±ط© ط£ط®ط±ظ‰.');
    } finally {
      setPrivacyBusy(false);
    }
  };

  const level = Math.max(1, progress?.level ?? profile?.level ?? 1);
  const levelBadgeColor = level >= 50 ? colors.primary : level >= 25 ? colors.teal : level >= 10 ? colors.textSecondary : palette.gold;
  const experience = Math.max(0, progress?.experience_points ?? profile?.experience_points ?? 0);
  const levelStart = (level - 1) ** 2 * 100;
  const nextLevelAt = level ** 2 * 100;
  const levelProgress = Math.max(0, Math.min(1, (experience - levelStart) / (nextLevelAt - levelStart)));
  const displayName = profile?.display_name || profile?.username || 'ظ…ط³طھط®ط¯ظ… Wattar';
  const isPrivate = profile?.profile_visibility === 'friends';
  const giftsSent = Number(profile?.total_gifts_sent ?? 0);
  const giftsReceived = Number(profile?.total_gifts_received ?? 0);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.topBar}>
        <View>
          <Text style={styles.pageTitle}>ظ…ظ„ظپظٹ ط§ظ„ط´ط®طµظٹ</Text>
          <Text style={styles.pageSubtitle}>ظ‡ظˆظٹطھظƒ ظˆظ…ظƒط§ظ†طھظƒ ط¯ط§ط®ظ„ Wattar</Text>
        </View>
        <View style={styles.topActions}>
          <NotificationBell />
          <TouchableOpacity style={styles.settingsButton} onPress={() => router.push('/settings')} accessibilityRole="button">
            <Settings size={19} color={palette.muted} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.profileCard}>
        <View style={styles.profileGlow} />
        <View style={styles.profileTopRow}>
          <View style={styles.visibilityPill}>
            {isPrivate ? <LockKeyhole size={11} color={palette.gold} /> : <Users size={11} color={palette.teal} />}
            <Text style={[styles.visibilityText, isPrivate && styles.visibilityTextPrivate]}>
              {isPrivate ? 'ط®ط§طµ ط¨ط§ظ„ط£طµط¯ظ‚ط§ط،' : 'ظ…ظ„ظپ ط¹ط§ظ…'}
            </Text>
          </View>
          <TouchableOpacity style={styles.editChip} onPress={() => router.push('/profile/edit')} accessibilityRole="button">
            <Pencil size={13} color={colors.text} />
            <Text style={styles.editChipText}>طھط¹ط¯ظٹظ„</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.avatarOuter}>
          <View style={styles.avatar}>
            {profile?.avatar_url ? (
              <Image source={{ uri: profile.avatar_url }} style={styles.avatarImage} />
            ) : (
              <User size={34} color={palette.gold} />
            )}
          </View>
          <View style={[styles.levelBadge, { backgroundColor: levelBadgeColor }]}>
            <Star size={12} color={colors.inkGold} fill={colors.inkGold} />
          </View>
        </View>

        <Text style={styles.displayName}>{displayName}</Text>
        <Text style={styles.username}>@{profile?.username}</Text>
        {profile?.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}

        <View style={styles.chipsRow}>
          <View style={styles.chip}>
            <Star size={11} color={palette.gold} />
            <Text style={styles.chipText}>ط§ظ„ظ…ط³طھظˆظ‰ {level}</Text>
          </View>
          {profile?.gender ? (
            <View style={styles.chip}>
              <User size={11} color={palette.muted} />
              <Text style={styles.chipText}>
                {profile.gender === 'female' ? 'ط£ظ†ط«ظ‰' : profile.gender === 'male' ? 'ط°ظƒط±' : 'ط¢ط®ط±'}
              </Text>
            </View>
          ) : null}
          <TouchableOpacity style={[styles.chip, styles.chipInteractive]} onPress={toggleProfileVisibility} disabled={privacyBusy}>
            <LockKeyhole size={11} color={palette.gold} />
            <Text style={styles.chipText}>{privacyBusy ? 'ط¬ط§ط±ظچ ط§ظ„ط­ظپط¸â€¦' : isPrivate ? 'ط£طµط¯ظ‚ط§ط،' : 'ط¹ط§ظ…'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.statsRow}>
        <TouchableOpacity style={styles.statCard} onPress={() => router.push('/(tabs)/friends')} activeOpacity={0.8}>
          <Text style={styles.statValue}>{(progress?.follower_count ?? 0).toLocaleString()}</Text>
          <Text style={styles.statLabel}>ظ…طھط§ط¨ط¹ظˆظ†</Text>
        </TouchableOpacity>
        <View style={styles.statDivider} />
        <TouchableOpacity style={styles.statCard} onPress={() => router.push('/(tabs)/friends')} activeOpacity={0.8}>
          <Text style={styles.statValue}>{(progress?.following_count ?? 0).toLocaleString()}</Text>
          <Text style={styles.statLabel}>ط£طھط§ط¨ط¹</Text>
        </TouchableOpacity>
        <View style={styles.statDivider} />
        <View style={styles.statCard}>
          <Text style={[styles.statValue, { color: palette.gold }]}>{giftsSent.toLocaleString()}</Text>
          <Text style={styles.statLabel}>ظ‡ط¯ط§ظٹط§ ط£ط±ط³ظ„طھ</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statCard}>
          <Text style={[styles.statValue, { color: palette.teal }]}>{giftsReceived.toLocaleString()}</Text>
          <Text style={styles.statLabel}>ظ‡ط¯ط§ظٹط§ ظˆطµظ„طھ</Text>
        </View>
      </View>

      <View style={styles.levelCard}>
        <View style={styles.levelTop}>
          <View style={styles.levelIcon}><Sparkles size={17} color={palette.gold} /></View>
          <View style={styles.levelCopy}>
            <Text style={styles.levelTitle}>ط§ظ„طھظ‚ط¯ظ… ط¥ظ„ظ‰ ط§ظ„ظ…ط³طھظˆظ‰ {level + 1}</Text>
            <Text style={styles.levelCaption}>ط§ظ„ظ…ط³طھظˆظٹط§طھ طھظڈظƒطھط³ط¨ ط¨ط§ظ„ظ†ط´ط§ط· ظˆط§ظ„ظ…ط´ط§ط±ظƒط© ظˆظ„ط§ طھظڈط´طھط±ظ‰</Text>
          </View>
          <Text style={styles.xpValue}>{experience.toLocaleString()} XP</Text>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.round(levelProgress * 100)}%` }]} />
        </View>
        <Text style={styles.nextLevelText}>
          {Math.max(0, nextLevelAt - experience).toLocaleString()} XP ظ…طھط¨ظ‚ظٹط© ظ„ظ„ظ…ط³طھظˆظ‰ ط§ظ„طھط§ظ„ظٹ
        </Text>
        {progressError ? <Text style={styles.progressError}>{progressError}</Text> : null}
      </View>

      <View style={styles.walletCard}>
        <View style={styles.walletHeading}>
          <Text style={styles.sectionTitle}>ط£ط±طµط¯طھظٹ</Text>
          <TouchableOpacity onPress={() => router.push('/(tabs)/wallet')} style={styles.walletLink}>
            <Text style={styles.walletLinkText}>ظپطھط­ ط§ظ„ظ…ط­ظپط¸ط©</Text>
            <ChevronLeft size={15} color={palette.gold} />
          </TouchableOpacity>
        </View>
        <View style={styles.balanceRow}>
          <View style={styles.balanceItem}>
            <View style={styles.coinsIcon}><Coins size={18} color={palette.gold} /></View>
            <View>
              <Text style={styles.balanceValue}>{Number(profile?.balance_gold ?? 0).toLocaleString()}</Text>
              <Text style={styles.balanceLabel}>Coin ظ„ظ„ط§ط³طھط®ط¯ط§ظ… ط¯ط§ط®ظ„ ط§ظ„طھط·ط¨ظٹظ‚</Text>
            </View>
          </View>
          <View style={styles.balanceDivider} />
          <View style={styles.balanceItem}>
            <View style={styles.gemsIcon}><Gem size={18} color={palette.teal} /></View>
            <View>
              <Text style={styles.balanceValue}>{Number(profile?.balance_diamond ?? 0).toLocaleString()}</Text>
              <Text style={styles.balanceLabel}>Diamond ظ‚ط§ط¨ظ„ ظ„ظ„طھط­ظˆظٹظ„ ط£ظˆ ط§ظ„ط³ط­ط¨</Text>
            </View>
          </View>
        </View>
        <View style={styles.walletActions}>
          <TouchableOpacity style={styles.walletAction} onPress={() => router.push('/(tabs)/wallet')}>
            <Wallet size={14} color={palette.gold} />
            <Text style={styles.walletActionText}>ط´ط­ظ† / طھط­ظˆظٹظ„</Text>
          </TouchableOpacity>
          {profile?.referral_code ? (
            <TouchableOpacity style={styles.walletAction} onPress={handleShare}>
              <Gift size={14} color={palette.teal} />
              <Text style={styles.walletActionText}>ط¯ط¹ظˆط© طµط¯ظٹظ‚</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      <View style={styles.quickGrid}>
        <QuickAction icon={ImagePlus} label="ظ…ظ„ظپظٹ ظˆط§ظ„ظ…ظ†ط´ظˆط±ط§طھ" color={palette.primary} onPress={() => profile?.id && router.push(`/user/${profile.id}`)} />
        <QuickAction icon={BadgeCheck} label="طھظˆط«ظٹظ‚ ط§ظ„ط­ط³ط§ط¨" color={palette.gold} onPress={() => router.push('/host-application')} />
        <QuickAction icon={LockKeyhole} label={isPrivate ? 'ط§ظ„ظ…ظ„ظپ ظ„ظ„ط£طµط¯ظ‚ط§ط،' : 'ط§ظ„ظ…ظ„ظپ ط¹ط§ظ…'} color={palette.teal} onPress={toggleProfileVisibility} />
        <QuickAction icon={Crown} label="ط¹ط¶ظˆظٹط© VIP" color={colors.gold} onPress={() => router.push('/membership')} />
        <QuickAction icon={ShieldCheck} label="ط­ظ…ط§ظٹط§طھ ط§ظ„ط؛ط±ظپ" color={colors.teal} onPress={() => router.push('/protection')} />
        <QuickAction icon={Flame} label="ط³ظ„ط³ظ„ط© ط§ظ„ظˆظ„ط§ط،" color={colors.gold} onPress={() => router.push('/loyalty')} />
      </View>

      {profile?.referral_code ? (
        <TouchableOpacity style={styles.referralCard} onPress={handleShare} activeOpacity={0.85}>
          <View style={styles.referralIcon}><Gift size={17} color={palette.gold} /></View>
          <View style={styles.referralCopy}>
            <Text style={styles.referralTitle}>ظƒظˆط¯ ط§ظ„ط¯ط¹ظˆط© ط§ظ„ط®ط§طµ ط¨ظƒ</Text>
            <Text style={styles.referralCode}>{profile.referral_code}</Text>
          </View>
          <View style={styles.referralShare}><Text style={styles.referralShareText}>ظ…ط´ط§ط±ظƒط©</Text></View>
        </TouchableOpacity>
      ) : null}

      <MenuSection title="ط§ظ„ط­ط³ط§ط¨ ظˆط§ظ„ط£ظ…ط§ظ†">
        <MenuItem icon={Settings} label="ط¥ط¹ط¯ط§ط¯ط§طھ ط§ظ„ط­ط³ط§ط¨" hint="ط§ظ„طھظپط¶ظٹظ„ط§طھ ظˆط§ظ„ط¥ط´ط¹ط§ط±ط§طھ" onPress={() => router.push('/settings')} />
        <MenuItem icon={LockKeyhole} label="ط§ظ„ط®طµظˆطµظٹط©" hint={isPrivate ? 'ط§ظ„ط£طµط¯ظ‚ط§ط، ظپظ‚ط·' : 'ط¹ط§ظ…'} onPress={() => router.push('/privacy-settings')} />
        <MenuItem icon={ShieldBan} label="ط§ظ„ظ…ط³طھط®ط¯ظ…ظˆظ† ط§ظ„ظ…ط­ط¸ظˆط±ظˆظ†" onPress={() => router.push('/blocked-users')} />
      </MenuSection>

      <MenuSection title="ط§ظ„ظ…ط¬طھظ…ط¹">
        <MenuItem icon={Users} label="ط§ظ„ط£طµط¯ظ‚ط§ط، ظˆط§ظ„ظ…طھط§ط¨ط¹ط©" onPress={() => router.push('/(tabs)/friends')} />
        <MenuItem icon={Wallet} label="ط§ظ„ظ…ط­ظپط¸ط© ظˆط³ط¬ظ„ ط§ظ„ظ…ط¹ط§ظ…ظ„ط§طھ" onPress={() => router.push('/(tabs)/wallet')} />
        <MenuItem icon={Headset} label="ط§ظ„ط¯ط¹ظ… ظˆط§ظ„ظ…ط³ط§ط¹ط¯ط©" onPress={() => router.push('/support')} />
      </MenuSection>

      <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
        <LogOut size={17} color={palette.danger} />
        <Text style={styles.signOutText}>طھط³ط¬ظٹظ„ ط§ظ„ط®ط±ظˆط¬</Text>
      </TouchableOpacity>
      <Text style={styles.version}>Wattar آ· ظ…ط¬طھظ…ط¹ ط§ظ„طµظˆطھ</Text>
    </ScrollView>
  );
}

function QuickAction({
  icon: Icon,
  label,
  color,
  onPress,
}: {
  icon: typeof Users;
  label: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.quickCard} onPress={onPress} activeOpacity={0.8}>
      <View style={[styles.quickIcon, { backgroundColor: `${color}1F` }]}>
        <Icon size={18} color={color} />
      </View>
      <Text style={styles.quickLabel} numberOfLines={2}>{label}</Text>
    </TouchableOpacity>
  );
}

function MenuSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.menuSection}>
      <Text style={styles.menuSectionTitle}>{title}</Text>
      <View style={styles.menuCard}>{children}</View>
    </View>
  );
}

function MenuItem({
  icon: Icon,
  label,
  hint,
  onPress,
}: {
  icon: typeof Settings;
  label: string;
  hint?: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.menuItem} onPress={onPress} accessibilityRole="button">
      <View style={styles.menuIcon}><Icon size={17} color={palette.gold} /></View>
      <View style={styles.menuCopy}>
        <Text style={styles.menuText}>{label}</Text>
        {hint ? <Text style={styles.menuHint}>{hint}</Text> : null}
      </View>
      <ChevronLeft size={17} color={palette.muted} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background },
  content: { paddingHorizontal: 16, paddingTop: 54, paddingBottom: 112 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pageTitle: { color: palette.text, fontSize: 23, fontFamily: fonts.black, textAlign: 'right' },
  pageSubtitle: { color: palette.muted, fontSize: 11, marginTop: 4, textAlign: 'right' },
  settingsButton: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  profileCard: { alignItems: 'center', overflow: 'hidden', padding: 18, borderRadius: radius.xl, backgroundColor: palette.surface, borderWidth: 1, borderColor: colors.borderStrong },
  profileGlow: { position: 'absolute', top: -95, width: 270, height: 170, borderRadius: 110, backgroundColor: colors.primaryHaze, opacity: 0.9 },
  profileTopRow: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  visibilityPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 20, backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: palette.border },
  visibilityText: { color: palette.teal, fontSize: 9, fontFamily: fonts.bold },
  visibilityTextPrivate: { color: palette.gold },
  editChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: palette.primary },
  editChipText: { color: colors.text, fontSize: 10, fontFamily: fonts.bold },
  avatarOuter: { width: 96, height: 96, borderRadius: radius.xxl, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: palette.gold, backgroundColor: colors.goldSoft, marginTop: 4 },
  avatar: { width: 84, height: 84, borderRadius: 27, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.elevated, overflow: 'hidden' },
  avatarImage: { width: '100%', height: '100%' },
  levelBadge: { position: 'absolute', bottom: -3, right: -3, width: 26, height: 26, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: palette.surface },
  displayName: { color: palette.text, fontSize: 20, fontFamily: fonts.black, marginTop: 12 },
  username: { color: palette.muted, fontSize: 12, marginTop: 4 },
  bio: { color: palette.muted, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 9, maxWidth: 290 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6, marginTop: 11 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: palette.border },
  chipInteractive: { backgroundColor: colors.goldSoft, borderColor: colors.goldLine },
  chipText: { color: palette.text, fontSize: 9.5, fontFamily: fonts.semibold },
  statsRow: { flexDirection: 'row', alignItems: 'center', marginTop: 11, paddingVertical: 13, borderRadius: 18, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  statCard: { flex: 1, alignItems: 'center' },
  statValue: { color: palette.text, fontSize: 16, fontFamily: fonts.black },
  statLabel: { color: palette.muted, fontSize: 8.5, marginTop: 4 },
  statDivider: { width: 1, height: 26, backgroundColor: palette.border },
  levelCard: { padding: 15, marginTop: 12, borderRadius: 19, backgroundColor: palette.surface, borderWidth: 1, borderColor: colors.goldLine },
  levelTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  levelIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.goldSoft },
  levelCopy: { flex: 1 },
  levelTitle: { color: palette.gold, fontSize: 13, fontFamily: fonts.bold, textAlign: 'right' },
  levelCaption: { color: palette.muted, fontSize: 9.5, marginTop: 3, textAlign: 'right' },
  xpValue: { color: palette.text, fontSize: 10.5, fontFamily: fonts.semibold },
  progressTrack: { height: 8, overflow: 'hidden', borderRadius: 8, backgroundColor: palette.elevated, marginTop: 13 },
  progressFill: { height: '100%', borderRadius: 8, backgroundColor: palette.gold },
  nextLevelText: { color: palette.muted, fontSize: 9.5, marginTop: 7, textAlign: 'right' },
  progressError: { color: palette.danger, fontSize: 10, marginTop: 8, textAlign: 'right' },
  walletCard: { padding: 15, marginTop: 12, borderRadius: 19, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  walletHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { color: palette.text, fontSize: 14, fontFamily: fonts.bold },
  walletLink: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  walletLinkText: { color: palette.gold, fontSize: 10.5, fontFamily: fonts.semibold },
  balanceRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14 },
  balanceItem: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 9 },
  coinsIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.goldSoft },
  gemsIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.tealSoft },
  balanceValue: { color: palette.text, fontSize: 14, fontFamily: fonts.black },
  balanceLabel: { color: palette.muted, fontSize: 8.5, marginTop: 3, maxWidth: 120 },
  balanceDivider: { width: 1, height: 32, backgroundColor: palette.border, marginHorizontal: 10 },
  walletActions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  walletAction: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 38, borderRadius: 12, backgroundColor: palette.elevated, borderWidth: 1, borderColor: palette.border },
  walletActionText: { color: palette.text, fontSize: 10.5, fontFamily: fonts.semibold },
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  quickCard: { width: '48.5%', flexDirection: 'row', alignItems: 'center', gap: 9, padding: 12, borderRadius: 16, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  quickIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  quickLabel: { flex: 1, color: palette.text, fontSize: 10.5, fontFamily: fonts.semibold, textAlign: 'right' },
  referralCard: { flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 12, padding: 13, borderRadius: 17, backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.goldLine },
  referralIcon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.goldSoft },
  referralCopy: { flex: 1 },
  referralTitle: { color: palette.muted, fontSize: 9, textAlign: 'right' },
  referralCode: { color: palette.gold, fontSize: 15, fontFamily: fonts.black, marginTop: 3, textAlign: 'right', letterSpacing: 1.5 },
  referralShare: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, backgroundColor: colors.goldSoft },
  referralShareText: { color: palette.gold, fontSize: 10, fontFamily: fonts.bold },
  menuSection: { marginTop: 15 },
  menuSectionTitle: { color: palette.muted, fontSize: 10, fontFamily: fonts.bold, textAlign: 'right', marginBottom: 7, paddingHorizontal: 4 },
  menuCard: { paddingHorizontal: 12, borderRadius: 18, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  menuItem: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.border },
  menuIcon: { width: 32, height: 32, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.elevated },
  menuCopy: { flex: 1, alignItems: 'flex-end' },
  menuText: { color: palette.text, fontSize: 12, textAlign: 'right' },
  menuHint: { color: palette.muted, fontSize: 9, marginTop: 2, textAlign: 'right' },
  signOutButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 46, marginTop: 16, borderRadius: 14, backgroundColor: colors.dangerSoft, borderWidth: 1, borderColor: colors.dangerGlow },
  signOutText: { color: palette.danger, fontSize: 12, fontFamily: fonts.semibold },
  version: { color: palette.muted, fontSize: 10, textAlign: 'center', marginTop: 15 },
});
