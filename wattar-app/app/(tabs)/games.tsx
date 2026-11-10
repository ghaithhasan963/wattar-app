/**
 * Wattar App — صفحة الألعاب
 * قائمة الألعاب الأربعة: عجلة الحظ، نرد، Aviator، Plinko
 */
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Animated, Easing, View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { ArrowLeft, Gamepad2, Dice5, Plane, ChevronDown, Users, Gift, Gem } from 'lucide-react-native';
import { useAuthStore } from '@/store/auth';
import { usePreferencesStore } from '@/store/preferences';
import { supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import { CurrencyIcon } from '@/components/CurrencyIcon';

const games = [
  {
    id: 'wheel',
    name: 'عجلة الحظ',
    description: 'اختر معاملًا ودع العجلة تحدد الخانة',
    icon: Gamepad2,
    color: '#7C3AED',
  },
  {
    id: 'aviator',
    name: 'طيارة المضاعفات',
    description: 'حدّد هدف السحب وشاهد مسار الرحلة',
    icon: Plane,
    color: '#3B82F6',
  },
  {
    id: 'plinko',
    name: 'بلانغو',
    description: 'اختر المخاطرة وتابع سقوط الكرة',
    icon: ChevronDown,
    color: '#F59E0B',
  },
  {
    id: 'dice',
    name: 'نرد',
    description: 'توقع رقمًا أعلى أو أدنى من حدك',
    icon: Dice5,
    color: '#10B981',
  },
  {
    id: 'slots',
    name: 'Slots',
    description: 'طابق الرموز الثلاثة في البكرات',
    icon: Gem,
    color: '#C026D3',
  },
];

export default function GamesScreen() {
  const router = useRouter();
  const { profile } = useAuthStore();
  const loadProfile = useAuthStore((state) => state.loadProfile);
  const { reduceMotion } = usePreferencesStore();
  const [claimingPoints, setClaimingPoints] = useState(false);
  const entrance = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;

  useEffect(() => {
    if (reduceMotion) {
      entrance.setValue(1);
      return;
    }
    Animated.timing(entrance, {
      toValue: 1,
      duration: 360,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [entrance, reduceMotion]);

  const entranceStyle = {
    opacity: entrance,
    transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
  };

  const claimDailyPoints = async () => {
    if (claimingPoints) return;
    setClaimingPoints(true);
    try {
      const { data, error } = await supabase.rpc('claim_daily_game_points');
      if (error) throw error;
      if (data?.claimed) {
        await loadProfile();
        Alert.alert('تمت الإضافة', `أضفنا ${Number(data.granted).toLocaleString()} Point إلى رصيد الألعاب.`);
      } else if (data?.at_cap) {
        Alert.alert('رصيد Point ممتلئ', 'يمكنك المطالبة برصيد يومي بعد استخدام بعض نقاطك.');
      } else {
        Alert.alert('تم استخدام المطالبة اليومية', 'يمكنك المطالبة برصيد Point مرة أخرى بعد مرور 24 ساعة.');
      }
    } catch (error: unknown) {
      Alert.alert('تعذرت المطالبة بالنقاط', error instanceof Error ? error.message : 'حاول مرة أخرى.');
    } finally {
      setClaimingPoints(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>الألعاب</Text>
        <View style={styles.balanceCard}>
          <View style={styles.balanceHeading}>
            <CurrencyIcon currency="point" size={30} />
            <Text style={styles.balanceLabel}>رصيد Point للألعاب</Text>
          </View>
          <Text style={styles.balanceValue}>{profile?.game_points?.toLocaleString() ?? 0}</Text>
        </View>
      </View>

      <TouchableOpacity
        style={styles.claimButton}
        onPress={claimDailyPoints}
        disabled={claimingPoints}
        accessibilityRole="button"
      >
        {claimingPoints
          ? <ActivityIndicator size="small" color={colors.background} />
          : <Gift size={18} color={colors.background} />}
        <Text style={styles.claimButtonText}>
          {claimingPoints ? 'جاري جلب الرصيد...' : 'استلام Point اليومي'}
        </Text>
      </TouchableOpacity>
      <Text style={styles.pointsNotice}>النقاط داخل الألعاب فقط؛ لا تُشترى ولا تُحوّل ولا تُسحب نقدًا.</Text>

      <Animated.View style={[styles.communityCard, entranceStyle]}>
        <View style={styles.communityIcon}><Users size={22} color={colors.primary} /></View>
        <View style={styles.communityCopy}>
          <Text style={styles.communityTitle}>تحديات الأصدقاء</Text>
          <Text style={styles.communityDescription}>نرد مجاني لشخصين أو أربعة — بدون عملات</Text>
        </View>
        <TouchableOpacity
          style={styles.communityButton}
          onPress={() => router.push('/(tabs)/friends')}
          accessibilityRole="button"
          accessibilityLabel="افتح تحديات الأصدقاء"
        >
          <ArrowLeft size={18} color="#FFFFFF" />
        </TouchableOpacity>
      </Animated.View>

      <View style={styles.sectionHeading}>
        <View>
          <Text style={styles.sectionTitle}>اختر لعبتك</Text>
          <Text style={styles.sectionSubtitle}>جولات سريعة برصيد Point فقط</Text>
        </View>
        <View style={styles.gamesCount}>
          <Text style={styles.gamesCountText}>{games.length} ألعاب</Text>
        </View>
      </View>

      <Animated.View style={[styles.gamesGrid, entranceStyle]}>
        {games.map(game => (
          <TouchableOpacity
            key={game.id}
            style={[styles.gameCard, { borderTopColor: game.color }]}
            onPress={() => router.push(`/game/${game.id}`)}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={`افتح لعبة ${game.name}`}
          >
            <View style={styles.gameCardTop}>
              <View style={[styles.gameIconBg, { backgroundColor: `${game.color}22` }]}>
                <game.icon size={25} color={game.color} />
              </View>
              <ArrowLeft size={17} color={colors.textSecondary} />
            </View>
            <View style={styles.gameInfo}>
              <Text style={styles.gameName}>{game.name}</Text>
              <Text style={styles.gameDesc} numberOfLines={2}>{game.description}</Text>
              <View style={styles.gameBadge}>
                <CurrencyIcon currency="point" size={18} />
                <Text style={styles.gameBadgeText}>Point فقط</Text>
              </View>
            </View>
          </TouchableOpacity>
        ))}
      </Animated.View>

      <Animated.View style={[styles.statsCard, entranceStyle]}>
        <Text style={styles.statsTitle}>العب بأمان</Text>
        <Text style={styles.pointsNotice}>الألعاب تستخدم Point فقط. لا يمكن شراء Point أو تحويلها إلى Coin أو Diamond أو سحبها.</Text>
      </Animated.View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingBottom: 104 },
  header: { padding: 16, paddingTop: 60, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: colors.text, fontSize: 24, fontWeight: 'bold' },
  balanceCard: { backgroundColor: colors.surface, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12 },
  balanceHeading: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  balanceLabel: { color: colors.textSecondary, fontSize: 11 },
  balanceValue: { color: '#C4A5FF', fontSize: 15, fontWeight: 'bold', marginTop: 5, textAlign: 'right' },
  claimButton: {
    marginHorizontal: 16, marginTop: 2, minHeight: 48, borderRadius: 14, paddingHorizontal: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9,
    backgroundColor: colors.gold,
  },
  claimButtonText: { color: colors.background, fontSize: 13, fontWeight: '800' },
  pointsNotice: { color: colors.textSecondary, fontSize: 12, lineHeight: 19, textAlign: 'right', marginHorizontal: 18, marginTop: 8 },
  communityCard: { marginHorizontal: 16, marginTop: 4, padding: 14, borderRadius: 16, flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  communityIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  communityCopy: { flex: 1, gap: 4 },
  communityTitle: { color: colors.text, fontSize: 14, fontWeight: '700' },
  communityDescription: { color: colors.textSecondary, fontSize: 11 },
  communityButton: { width: 34, height: 34, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  sectionHeading: { marginHorizontal: 18, marginTop: 22, marginBottom: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: '900' },
  sectionSubtitle: { color: colors.textSecondary, fontSize: 11, marginTop: 4 },
  gamesCount: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  gamesCountText: { color: colors.teal, fontSize: 10, fontWeight: '800' },
  gamesGrid: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12 },
  gameCard: {
    width: '48%',
    minHeight: 174,
    borderRadius: 19,
    padding: 13,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderTopWidth: 3,
  },
  gameCardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  gameIconBg: {
    width: 44,
    height: 44,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gameInfo: { flex: 1, justifyContent: 'flex-end', marginTop: 10 },
  gameName: { color: colors.text, fontSize: 15, fontWeight: '900', textAlign: 'right' },
  gameDesc: { minHeight: 32, color: colors.textSecondary, fontSize: 10, lineHeight: 15, marginTop: 4, textAlign: 'right' },
  gameBadge: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 5, marginTop: 8, paddingVertical: 4, paddingHorizontal: 7, borderRadius: 9, backgroundColor: colors.background },
  gameBadgeText: { color: colors.textSecondary, fontSize: 9, fontWeight: '800' },
  statsCard: {
    margin: 16,
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 16,
  },
  statsTitle: { color: colors.text, fontSize: 16, fontWeight: 'bold', marginBottom: 12 },
});
