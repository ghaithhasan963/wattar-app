/**
 * Wattar App — الصفحة الرئيسية (قائمة الغرف)
 */
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Image,
  Animated,
  Easing,
  Pressable,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { usePreferencesStore } from '@/store/preferences';
import { Mic, Users, Lock, Plus, ChevronLeft, Sparkles, CirclePlay } from 'lucide-react-native';
import { colors } from '@/lib/theme';

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
  owner: { username: string; display_name: string | null; avatar_url: string | null } | null;
}

export default function HomeScreen() {
  const router = useRouter();
  const { profile } = useAuthStore();
  const { reduceMotion } = usePreferencesStore();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [entrance] = useState(() => new Animated.Value(0));
  const categories = Array.from(new Set(rooms
    .map((room) => room.category?.trim())
    .filter((category): category is string => Boolean(category))));
  const visibleRooms = selectedCategory
    ? rooms.filter((room) => room.category?.trim() === selectedCategory)
    : rooms;

  useEffect(() => {
    loadRooms();
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      entrance.setValue(1);
      return;
    }
    entrance.setValue(0);
    Animated.timing(entrance, {
      toValue: 1,
      duration: 520,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [entrance, reduceMotion]);

  const loadRooms = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { data, error } = await supabase
        .from('rooms')
        .select(`
          id, name, description, cover_url, seat_count, is_private,
          status, listeners_count, speakers_count, category,
          owner:users!rooms_owner_id_fkey(username, display_name, avatar_url)
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

  const renderRoom = ({ item }: { item: Room }) => (
    <TouchableOpacity
      style={styles.roomCard}
      onPress={() => router.push(`/room/${item.id}`)}
    >
      <View style={styles.roomCover}>
        {item.cover_url ? (
          <Image source={{ uri: item.cover_url }} style={styles.coverImage} />
        ) : (
          <View style={styles.coverPlaceholder}>
            <Mic size={28} color="#7C3AED" />
          </View>
        )}
      </View>
      <View style={styles.roomInfo}>
        <View style={styles.roomHeader}>
          <Text style={styles.roomName} numberOfLines={1}>{item.name}</Text>
          {item.is_private && <Lock size={14} color="#F59E0B" />}
        </View>
        <Text style={styles.roomOwner}>{item.owner?.display_name ?? item.owner?.username ?? 'غرفة مجتمعية'}</Text>
        <View style={styles.roomStats}>
          <View style={styles.statItem}>
            <Mic size={12} color={colors.textSecondary} />
            <Text style={styles.statText}>{item.speakers_count}/{item.seat_count}</Text>
          </View>
          <View style={styles.statItem}>
            <Users size={12} color={colors.textSecondary} />
            <Text style={styles.statText}>{item.listeners_count}</Text>
          </View>
          {item.status === 'live' && <Text style={styles.liveBadge}>مباشر</Text>}
        </View>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.brandLine}>
          <Image source={require('../../assets/wattar-icon.png')} style={styles.brandIcon} />
          <View style={styles.greetingCopy}>
            <Text style={styles.brandName}>Wattar <Text style={styles.brandArabic}>| وتر</Text></Text>
            <Text style={styles.greeting}>أهلًا {profile?.display_name ?? profile?.username ?? 'صديقي'}</Text>
          </View>
        </View>
        <View style={styles.headerActions}>
          <View style={styles.balancePill}>
            <Text style={styles.balanceValue}>{(profile?.balance_gold ?? 0).toLocaleString()}</Text>
            <Text style={styles.balanceUnit}>Coins</Text>
          </View>
          <TouchableOpacity style={styles.createIconButton} onPress={() => router.push('/room/create')} accessibilityLabel="إنشاء غرفة">
            <Plus size={22} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.heroCard}>
        <View style={styles.heroCopy}>
          <View style={styles.heroEyebrow}><Sparkles size={13} color={colors.gold} /><Text style={styles.heroEyebrowText}>مساحتك تبدأ بصوت</Text></View>
          <Text style={styles.heroTitle}>صوت يجمعنا</Text>
          <Text style={styles.heroCaption}>انضم إلى جلسة حية أو ابدأ غرفتك مع أصدقائك.</Text>
          <TouchableOpacity
            style={styles.heroButton}
            onPress={() => rooms.length ? router.push(`/room/${rooms[0].id}`) : router.push('/room/create')}
          >
            <Text style={styles.heroButtonText}>{rooms.length ? 'اكتشف الغرف' : 'أنشئ أول غرفة'}</Text>
            <ChevronLeft size={16} color="#1A0B26" />
          </TouchableOpacity>
        </View>
        <Image source={require('../../assets/wattar-adaptive-icon.png')} style={styles.heroArt} />
        <View pointerEvents="none" style={styles.heroGlow} />
      </View>

      <TouchableOpacity style={styles.storiesButton} onPress={() => router.push('/stories')}>
        <View style={styles.storiesIcon}><CirclePlay size={20} color={colors.gold} /></View>
        <View style={styles.storiesCopy}>
          <Text style={styles.storiesTitle}>قصص المجتمع</Text>
          <Text style={styles.storiesCaption}>صور وفيديوهات تختفي بعد 24 ساعة</Text>
        </View>
        <ChevronLeft size={18} color={colors.textSecondary} />
      </TouchableOpacity>

      <View style={styles.sectionHeader}>
        <View>
          <Text style={styles.sectionTitle}>الغرف الآن</Text>
          <Text style={styles.sectionCaption}>{rooms.length ? `${rooms.length} جلسة متاحة للانضمام` : 'انضم إلى جلسة أو ابدأ جلستك'}</Text>
        </View>
        <View style={styles.onlinePill}><View style={styles.onlineDot} /><Text style={styles.onlineText}>مباشر</Text></View>
      </View>

      {categories.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryList}>
          {[{ value: null, label: 'الكل' }, ...categories.map((category) => ({ value: category, label: category }))].map((category) => (
            <TouchableOpacity
              key={category.value ?? 'all'}
              style={[styles.categoryChip, selectedCategory === category.value && styles.categoryChipActive]}
              onPress={() => setSelectedCategory(category.value)}
              accessibilityRole="button"
              accessibilityState={{ selected: selectedCategory === category.value }}
            >
              <Text style={[styles.categoryText, selectedCategory === category.value && styles.categoryTextActive]}>{category.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      <FlatList
        data={visibleRooms}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => (
          <Animated.View style={{
            opacity: entrance,
            transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [12 + index * 3, 0] }) }],
          }}>
            {renderRoom({ item })}
          </Animated.View>
        )}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={loadRooms} tintColor={colors.gold} />}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        ListEmptyComponent={() => (
          <View style={styles.emptyState}>
            {loading ? (
              <>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={styles.emptyTitle}>نبحث عن غرف مناسبة...</Text>
              </>
            ) : loadError ? (
              <>
                <Text style={styles.emptyTitle}>ما قدرنا نحمّل الغرف</Text>
                <Text style={styles.emptyCaption}>{loadError}</Text>
                <Pressable onPress={loadRooms} style={styles.retryButton}><Text style={styles.retryText}>إعادة المحاولة</Text></Pressable>
              </>
            ) : (
              <>
                <View style={styles.emptyIcon}><Mic size={26} color={colors.primary} /></View>
                <Text style={styles.emptyTitle}>ما في غرف مفتوحة حاليًا</Text>
                <Text style={styles.emptyCaption}>{selectedCategory ? 'ما في غرف بهالتصنيف الآن.' : 'ابدأ أول جلسة وخلي أصحابك ينضموا إليك.'}</Text>
                <Pressable onPress={() => router.push('/room/create')} style={styles.retryButton}><Text style={styles.retryText}>أنشئ أول غرفة</Text></Pressable>
              </>
            )}
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginHorizontal: 17,
    marginTop: 54,
    marginBottom: 17,
  },
  brandLine: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  brandIcon: { width: 49, height: 49, borderRadius: 16, borderWidth: 1, borderColor: '#684193' },
  greetingCopy: { flex: 1 },
  brandName: { color: colors.text, fontSize: 16, fontWeight: '900' },
  brandArabic: { color: colors.gold, fontSize: 13, fontWeight: '700' },
  greeting: { color: colors.textSecondary, fontSize: 12, marginTop: 4 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  balancePill: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 11, borderRadius: 14, backgroundColor: colors.goldSoft, borderWidth: 1, borderColor: '#66491D' },
  balanceValue: { color: colors.gold, fontSize: 13, fontWeight: '800' },
  balanceUnit: { color: colors.textSecondary, fontSize: 10 },
  createIconButton: {
    width: 42,
    height: 42,
    backgroundColor: colors.primary,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#CA79FF',
  },
  heroCard: {
    minHeight: 178,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
    marginHorizontal: 16,
    paddingHorizontal: 18,
    paddingVertical: 17,
    borderRadius: 24,
    backgroundColor: '#1C1030',
    borderWidth: 1,
    borderColor: '#5B3477',
  },
  heroCopy: { flex: 1, zIndex: 1, alignItems: 'flex-start' },
  heroEyebrow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  heroEyebrowText: { color: colors.gold, fontSize: 11, fontWeight: '700' },
  heroTitle: { color: '#FFFFFF', fontSize: 24, fontWeight: '900', marginTop: 10 },
  heroCaption: { maxWidth: 230, color: '#D5C9E4', fontSize: 12, lineHeight: 19, marginTop: 5, textAlign: 'left' },
  heroButton: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 13, paddingHorizontal: 13, paddingVertical: 9, borderRadius: 12, backgroundColor: colors.gold },
  heroButtonText: { color: '#1A0B26', fontSize: 11, fontWeight: '800' },
  heroArt: { position: 'absolute', right: -12, width: 168, height: 168, opacity: 0.38, borderRadius: 24 },
  heroGlow: { position: 'absolute', right: 68, top: -34, width: 160, height: 160, borderRadius: 80, backgroundColor: '#7822A5', opacity: 0.22 },
  storiesButton: {
    marginHorizontal: 16, marginTop: 16, minHeight: 66, paddingHorizontal: 14, borderRadius: 18,
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
  },
  storiesIcon: { width: 40, height: 40, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  storiesCopy: { flex: 1, gap: 4 },
  storiesTitle: { color: colors.text, fontSize: 14, fontWeight: '800' },
  storiesCaption: { color: colors.textSecondary, fontSize: 11 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 24, paddingBottom: 10 },
  sectionTitle: { color: colors.text, fontSize: 19, fontWeight: '800' },
  sectionCaption: { color: colors.textSecondary, fontSize: 12, marginTop: 4 },
  onlinePill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: colors.successSoft },
  onlineDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.success },
  onlineText: { color: colors.success, fontSize: 11, fontWeight: '700' },
  categoryList: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  categoryChip: { minHeight: 36, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, borderRadius: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  categoryChipActive: { backgroundColor: colors.primary, borderColor: '#C577FF' },
  categoryText: { color: colors.textSecondary, fontSize: 11, fontWeight: '700' },
  categoryTextActive: { color: '#FFFFFF' },
  list: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 104, flexGrow: 1 },
  roomCard: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  roomCover: { width: 98, height: 98 },
  coverImage: { width: '100%', height: '100%' },
  coverPlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roomInfo: { flex: 1, paddingHorizontal: 14, paddingVertical: 12, justifyContent: 'center' },
  roomHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  roomName: { color: colors.text, fontSize: 15, fontWeight: '800', flex: 1, textAlign: 'right' },
  roomOwner: { color: colors.textSecondary, fontSize: 12, marginTop: 5, textAlign: 'right' },
  roomStats: { flexDirection: 'row', gap: 12, marginTop: 8 },
  statItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statText: { color: colors.textSecondary, fontSize: 11 },
  liveBadge: { color: colors.success, fontSize: 10, fontWeight: '800', backgroundColor: colors.successSoft, overflow: 'hidden', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  emptyState: { flex: 1, minHeight: 260, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 12 },
  emptyIcon: { width: 60, height: 60, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
  emptyTitle: { color: colors.text, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  emptyCaption: { color: colors.textSecondary, fontSize: 13, lineHeight: 20, textAlign: 'center' },
  retryButton: { backgroundColor: colors.primary, borderRadius: 13, paddingHorizontal: 18, paddingVertical: 11, marginTop: 2 },
  retryText: { color: '#fff', fontSize: 13, fontWeight: '700' },
});
