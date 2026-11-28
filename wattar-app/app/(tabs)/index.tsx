/**
 * Wattar App — الصفحة الرئيسية (M10.1)
 * غرف مباشرة + تصنيفات + اختصارات، على نظام التصميم الموحّد.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ChevronLeft,
  CirclePlay,
  Lock,
  Mic,
  Plus,
  ShoppingBag,
  Target,
  Users,
} from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { colors, fonts, gradients, radius, shadow, space } from '@/lib/theme';
import { NotificationBell } from '@/components/NotificationBell';
import { CurrencyIcon } from '@/components/CurrencyIcon';
import {
  AppText,
  Avatar,
  Button,
  Card,
  Chip,
  EmptyState,
  IconButton,
  LevelBadge,
  LiveDot,
  Reveal,
  SectionHeader,
  Skeleton,
} from '@/components/ui';

interface Room {
  id: string;
  name: string;
  description: string | null;
  cover_url: string | null;
  seat_count: number;
  is_private: boolean;
  status: string;
  listeners_count: number;
  speakers_count: number;
  category: string | null;
  owner: { username: string; display_name: string | null; avatar_url: string | null; level: number | null } | null;
}

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile } = useAuthStore();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const categories = useMemo(() => Array.from(new Set(rooms
    .map((room) => room.category?.trim())
    .filter((category): category is string => Boolean(category)))), [rooms]);

  const visibleRooms = selectedCategory
    ? rooms.filter((room) => room.category?.trim() === selectedCategory)
    : rooms;

  const totals = useMemo(() => rooms.reduce(
    (acc, room) => ({
      live: acc.live + (room.status === 'live' ? 1 : 0),
      speakers: acc.speakers + (room.speakers_count ?? 0),
      listeners: acc.listeners + (room.listeners_count ?? 0),
    }),
    { live: 0, speakers: 0, listeners: 0 },
  ), [rooms]);

  useEffect(() => {
    void loadRooms();
  }, []);

  const loadRooms = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { data, error } = await supabase
        .from('rooms')
        .select(`
          id, name, description, cover_url, seat_count, is_private,
          status, listeners_count, speakers_count, category,
          owner:users!rooms_owner_id_fkey(username, display_name, avatar_url, level)
        `)
        .neq('status', 'closed')
        .order('listeners_count', { ascending: false })
        .limit(50);
      if (error) throw error;
      setRooms(((data ?? []) as any[]).map(r => ({
        ...r,
        owner: Array.isArray(r.owner) ? r.owner[0] ?? null : r.owner,
      })));
    } catch (error: unknown) {
      setLoadError(error instanceof Error ? error.message : 'تعذر تحميل الغرف');
    } finally {
      setLoading(false);
    }
  };

  const openPrimaryRoom = () => {
    if (rooms.length) router.push(`/room/${rooms[0].id}`);
    else router.push('/room/create');
  };

  const header = (
    <View>
      {/* Hero */}
      <View style={styles.hero}>
        <LinearGradient
          colors={gradients.hero}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <View pointerEvents="none" style={styles.heroOrb} />
        <View pointerEvents="none" style={styles.heroOrbSmall} />
        <Image source={require('../../assets/wattar-adaptive-icon.png')} style={styles.heroArt} />

        <View style={styles.heroTopRow}>
          <View style={styles.livePill}>
            <LiveDot size={6} />
            <AppText variant="micro" color={colors.success}>مباشر الآن</AppText>
          </View>
          <AppText variant="micro" color={colors.textMuted}>
            {totals.live} غرفة · {totals.listeners} مستمع
          </AppText>
        </View>

        <AppText variant="display" style={styles.heroTitle}>صوتك يلاقي مجتمعه</AppText>
        <AppText variant="caption" style={styles.heroCaption}>
          انضم إلى جلسة حيّة، أو افتح غرفتك وخلي أصحابك يسمعوك.
        </AppText>

        <View style={styles.heroActions}>
          <Button
            label={rooms.length ? 'استكشف الغرف' : 'أنشئ أول غرفة'}
            variant="gold"
            size="md"
            icon={<ChevronLeft size={16} color={colors.inkGold} />}
            onPress={openPrimaryRoom}
          />
          <IconButton size={46} accessibilityLabel="إنشاء غرفة" onPress={() => router.push('/room/create')}>
            <Plus size={18} color={colors.text} />
          </IconButton>
        </View>
      </View>

      {/* Stats strip */}
      <View style={styles.statsStrip}>
        <StatBlock value={totals.live} label="غرف مباشرة" color={colors.success} />
        <View style={styles.statDivider} />
        <StatBlock value={totals.speakers} label="على المنصة" color={colors.teal} />
        <View style={styles.statDivider} />
        <StatBlock value={totals.listeners} label="مستمع" color={colors.primary} />
      </View>

      {/* Stories */}
      <Card
        onPress={() => router.push('/stories')}
        padded={false}
        radiusSize="lg"
        style={styles.storiesCard}
        accessibilityLabel="قصص المجتمع"
      >
        <View style={styles.storiesRow}>
          <LinearGradient colors={gradients.gold} style={styles.storiesIcon}>
            <CirclePlay size={20} color={colors.inkGold} />
          </LinearGradient>
          <View style={styles.storiesCopy}>
            <AppText variant="bodyStrong">قصص المجتمع</AppText>
            <AppText variant="caption" style={{ marginTop: 1 }}>صور تختفي بعد ٢٤ ساعة</AppText>
          </View>
          <ChevronLeft size={18} color={colors.textMuted} />
        </View>
      </Card>

      {/* Quick links */}
      <View style={styles.featureRow}>
        <FeatureLink
          title="متجر الهدايا"
          caption="أرسل دعمك للمجتمع"
          icon={<ShoppingBag size={18} color={colors.gold} />}
          tint={colors.goldSoft}
          onPress={() => router.push('/store')}
        />
        <FeatureLink
          title="مهمات اليوم"
          caption="اجمع Coin وXP"
          icon={<Target size={18} color={colors.primary} />}
          tint={colors.primarySoft}
          onPress={() => router.push('/missions')}
        />
      </View>

      <SectionHeader
        title="الغرف الآن"
        caption={rooms.length ? `${rooms.length} جلسة متاحة للانضمام` : 'انضم إلى جلسة أو ابدأ جلستك'}
        accentColor={colors.gold}
        style={styles.sectionHeader}
      />

      {categories.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoryList}
        >
          <Chip label="الكل" selected={selectedCategory === null} onPress={() => setSelectedCategory(null)} />
          {categories.map((category) => (
            <Chip
              key={category}
              label={category}
              selected={selectedCategory === category}
              onPress={() => setSelectedCategory(category)}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );

  return (
    <View style={styles.root}>
      <LinearGradient colors={gradients.screen} locations={[0, 0.45, 1]} style={StyleSheet.absoluteFill} />

      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <View style={styles.brandLine}>
          <LinearGradient colors={gradients.primary} style={styles.brandRing}>
            <Image source={require('../../assets/wattar-icon.png')} style={styles.brandIcon} />
          </LinearGradient>
          <View style={styles.brandCopy}>
            <AppText variant="title" numberOfLines={1}>
              أهلًا <AppText variant="title" color={colors.gold}>{profile?.display_name ?? profile?.username ?? 'صديقي'}</AppText>
            </AppText>
            <AppText variant="caption" numberOfLines={1}>جاهز تسمع شي حلو اليوم؟</AppText>
          </View>
        </View>

        <View style={styles.topActions}>
          <NotificationBell />
          <IconButton
            size={42}
            accessibilityLabel="إنشاء غرفة"
            onPress={() => router.push('/room/create')}
            active
          >
            <Plus size={20} color={colors.text} />
          </IconButton>
        </View>
      </View>

      <View style={styles.balanceRow}>
        <View style={styles.balancePill}>
          <CurrencyIcon currency="coin" size={20} />
          <AppText style={styles.balanceValue}>{(profile?.balance_gold ?? 0).toLocaleString()}</AppText>
          <AppText variant="micro" color={colors.textMuted}>Coin</AppText>
        </View>
        {typeof profile?.level === 'number' && <LevelBadge level={profile.level} size="md" />}
      </View>

      <FlatList
        data={visibleRooms}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => (
          <Reveal index={index} style={styles.roomCardWrap}>
            <RoomCard room={item} onPress={() => router.push(`/room/${item.id}`)} />
          </Reveal>
        )}
        ListHeaderComponent={header}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={loadRooms} tintColor={colors.gold} colors={[colors.gold]} />}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        ListEmptyComponent={(
          <View style={styles.emptyWrap}>
            {loading ? (
              <>
                <Skeleton height={92} borderRadius={radius.lg} style={{ width: '100%' }} />
                <Skeleton height={92} borderRadius={radius.lg} style={{ width: '100%', marginTop: 10 }} />
                <Skeleton height={92} borderRadius={radius.lg} style={{ width: '100%', marginTop: 10 }} />
              </>
            ) : loadError ? (
              <EmptyState
                icon={<Mic size={24} color={colors.danger} />}
                title="ما قدرنا نحمّل الغرف"
                caption={loadError}
                actionLabel="إعادة المحاولة"
                onAction={loadRooms}
              />
            ) : (
              <EmptyState
                icon={<Mic size={24} color={colors.primary} />}
                title="ما في غرف مفتوحة حاليًا"
                caption={selectedCategory ? 'ما في غرف بهالتصنيف الآن.' : 'ابدأ أول جلسة وخلي أصحابك ينضموا إليك.'}
                actionLabel="أنشئ أول غرفة"
                onAction={() => router.push('/room/create')}
              />
            )}
          </View>
        )}
      />
    </View>
  );
}

function StatBlock({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <View style={styles.statBlock}>
      <AppText variant="numeric" color={color}>{value.toLocaleString()}</AppText>
      <AppText variant="micro" color={colors.textMuted}>{label}</AppText>
    </View>
  );
}

function FeatureLink({
  title,
  caption,
  icon,
  tint,
  onPress,
}: {
  title: string;
  caption: string;
  icon: React.ReactNode;
  tint: string;
  onPress: () => void;
}) {
  return (
    <Card onPress={onPress} padded={false} radiusSize="lg" style={styles.featureCard}>
      <View style={styles.featureInner}>
        <View style={[styles.featureIcon, { backgroundColor: tint }]}>{icon}</View>
        <View style={styles.featureCopy}>
          <AppText variant="bodyStrong" numberOfLines={1}>{title}</AppText>
          <AppText variant="micro" color={colors.textMuted} numberOfLines={1}>{caption}</AppText>
        </View>
        <ChevronLeft size={15} color={colors.textMuted} />
      </View>
    </Card>
  );
}

function RoomCard({ room, onPress }: { room: Room; onPress: () => void }) {
  const isLive = room.status === 'live';
  const ownerName = room.owner?.display_name ?? room.owner?.username ?? 'غرفة مجتمعية';

  return (
    <Card
      onPress={onPress}
      padded={false}
      radiusSize="lg"
      borderColor={isLive ? colors.borderStrong : colors.borderSoft}
      glowColor={isLive ? colors.primaryGlow : undefined}
      accessibilityLabel={`دخول غرفة ${room.name}`}
    >
      <View style={styles.roomRow}>
        <View style={styles.roomCover}>
          {room.cover_url ? (
            <Image source={{ uri: room.cover_url }} style={styles.coverImage} />
          ) : (
            <LinearGradient colors={gradients.cardGlow} style={styles.coverFallback}>
              <Mic size={26} color={colors.primary} />
            </LinearGradient>
          )}
          <LinearGradient colors={gradients.cover} style={StyleSheet.absoluteFill} />
          {isLive && (
            <View style={styles.coverLive}>
              <LiveDot size={5} color={colors.text} />
              <AppText style={styles.coverLiveText}>مباشر</AppText>
            </View>
          )}
        </View>

        <View style={styles.roomBody}>
          <View style={styles.roomTitleRow}>
            <AppText variant="title" numberOfLines={1} style={{ flex: 1 }}>{room.name}</AppText>
            {room.is_private && <Lock size={13} color={colors.gold} />}
          </View>

          <View style={styles.ownerRow}>
            <Avatar size={18} uri={room.owner?.avatar_url} name={ownerName} />
            <AppText variant="caption" numberOfLines={1} style={{ flexShrink: 1 }}>{ownerName}</AppText>
            {typeof room.owner?.level === 'number' && <LevelBadge level={room.owner.level} />}
          </View>

          <View style={styles.roomStats}>
            <View style={styles.statChip}>
              <Mic size={11} color={colors.teal} />
              <AppText variant="micro" color={colors.textSecondary}>{room.speakers_count}/{room.seat_count}</AppText>
            </View>
            <View style={styles.statChip}>
              <Users size={11} color={colors.primary} />
              <AppText variant="micro" color={colors.textSecondary}>{room.listeners_count}</AppText>
            </View>
            {room.category ? (
              <View style={styles.categoryTag}>
                <AppText variant="micro" color={colors.textMuted} numberOfLines={1}>{room.category}</AppText>
              </View>
            ) : null}
          </View>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.backgroundDeep },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingTop: 8,
    gap: space.sm,
  },
  brandLine: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  brandRing: {
    width: 46,
    height: 46,
    borderRadius: 16,
    padding: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.card,
  },
  brandIcon: { width: 43, height: 43, borderRadius: 14 },
  brandCopy: { flex: 1 },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },

  balanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    paddingHorizontal: space.lg,
    paddingTop: 10,
  },
  balancePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 32,
    paddingHorizontal: 11,
    borderRadius: radius.pill,
    backgroundColor: colors.goldSoft,
    borderWidth: 1,
    borderColor: colors.goldLine,
  },
  balanceValue: { fontFamily: fonts.black, fontSize: 13, lineHeight: 18, color: colors.gold },

  hero: {
    marginHorizontal: space.lg,
    marginTop: 14,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.heroSurface,
    padding: 18,
    overflow: 'hidden',
    ...shadow.raised,
  },
  heroOrb: {
    position: 'absolute',
    top: -90,
    right: -60,
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: colors.primaryGlow,
  },
  heroOrbSmall: {
    position: 'absolute',
    bottom: -70,
    left: -40,
    width: 170,
    height: 170,
    borderRadius: 85,
    backgroundColor: colors.tealHaze,
  },
  heroArt: {
    position: 'absolute',
    left: -26,
    bottom: -30,
    width: 170,
    height: 170,
    opacity: 0.30,
    borderRadius: 24,
  },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingRight: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.successSoft,
    borderWidth: 1,
    borderColor: colors.successLine,
  },
  heroTitle: { marginTop: 12 },
  heroCaption: { marginTop: 4, maxWidth: 250 },
  heroActions: { flexDirection: 'row', gap: 9, marginTop: 16 },

  statsStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: space.lg,
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceGlass,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  statBlock: { flex: 1, alignItems: 'center', gap: 1 },
  statDivider: { width: 1, height: 26, backgroundColor: colors.borderSoft },

  storiesCard: { marginHorizontal: space.lg, marginTop: 12 },
  storiesRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  storiesIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  storiesCopy: { flex: 1 },

  featureRow: { flexDirection: 'row', gap: 10, marginHorizontal: space.lg, marginTop: 10 },
  featureCard: { flex: 1 },
  featureInner: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: 12 },
  featureIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  featureCopy: { flex: 1 },

  sectionHeader: { marginTop: 22, marginBottom: 10 },
  categoryList: { flexDirection: 'row', gap: 8, paddingHorizontal: space.lg, paddingBottom: 10 },

  list: { paddingBottom: 118 },
  roomCardWrap: { paddingHorizontal: space.lg },
  roomRow: { flexDirection: 'row', alignItems: 'center', padding: 9, gap: 12 },
  roomCover: {
    width: 94,
    height: 94,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.primarySoft,
  },
  coverImage: { width: '100%', height: '100%' },
  coverFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  coverLive: {
    position: 'absolute',
    top: 6,
    right: 6,
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 6,
    paddingVertical: 1,
    borderRadius: radius.pill,
    backgroundColor: colors.overlay,
  },
  coverLiveText: { color: colors.text, fontFamily: fonts.bold, fontSize: 8, lineHeight: 13 },
  roomBody: { flex: 1, gap: 4 },
  roomTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ownerRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  roomStats: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  statChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.xs,
    backgroundColor: colors.surfaceGlass,
  },
  categoryTag: {
    maxWidth: 96,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },

  emptyWrap: { paddingHorizontal: space.lg, paddingTop: 8 },
});
