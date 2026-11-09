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

const games = [
  {
    id: 'wheel',
    name: 'عجلة الحظ',
    description: 'العب بنقاط مجانية حتى x50',
    icon: Gamepad2,
    color: '#7C3AED',
    bgGradient: ['#7C3AED', '#5B21B6'],
    maxMult: 'x50',
  },
  {
    id: 'aviator',
    name: 'طيارة المضاعفات',
    description: 'العب بنقاط مجانية قبل الانهيار',
    icon: Plane,
    color: '#3B82F6',
    bgGradient: ['#3B82F6', '#1D4ED8'],
    maxMult: 'x100',
  },
  {
    id: 'plinko',
    name: 'بلانغو',
    description: 'العب بنقاط مجانية واكتشف النتيجة',
    icon: ChevronDown,
    color: '#F59E0B',
    bgGradient: ['#F59E0B', '#B45309'],
    maxMult: 'x1000',
  },
  {
    id: 'dice',
    name: 'نرد',
    description: 'اختر الهدف والعب بنقاط مجانية',
    icon: Dice5,
    color: '#10B981',
    bgGradient: ['#10B981', '#047857'],
    maxMult: 'x10',
  },
  {
    id: 'slots',
    name: 'Slots',
    description: 'ثلاث بكرات وجوائز بنقاط لعب مجانية',
    icon: Gem,
    color: '#C026D3',
    bgGradient: ['#C026D3', '#86198F'],
    maxMult: 'x10',
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
        Alert.alert('تمت الإضافة', `أضفنا ${Number(data.granted).toLocaleString()} نقطة مجانية إلى رصيد الألعاب.`);
      } else if (data?.at_cap) {
        Alert.alert('رصيدك ممتلئ', 'يمكنك المطالبة بالنقاط اليومية بعد استخدام بعض نقاطك.');
      } else {
        Alert.alert('تم استخدام المطالبة اليومية', 'يمكنك المطالبة بنقاط مجانية مرة أخرى بعد مرور 24 ساعة.');
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
          <Text style={styles.balanceLabel}>نقاط مجانية للألعاب</Text>
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
          {claimingPoints ? 'جاري جلب النقاط...' : 'استلام النقاط اليومية المجانية'}
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

      <Animated.View style={[styles.gamesGrid, entranceStyle]}>
        {games.map(game => (
          <TouchableOpacity
            key={game.id}
            style={[styles.gameCard, { backgroundColor: game.color }]}
            onPress={() => router.push(`/game/${game.id}`)}
            activeOpacity={0.85}
          >
            <View style={styles.gameIconBg}>
              <game.icon size={32} color="#fff" />
            </View>
            <View style={styles.gameInfo}>
              <Text style={styles.gameName}>{game.name}</Text>
              <Text style={styles.gameDesc}>{game.description}</Text>
              <View style={styles.maxMultBadge}>
                <Text style={styles.maxMultText}>حتى {game.maxMult}</Text>
              </View>
            </View>
          </TouchableOpacity>
        ))}
      </Animated.View>

      <Animated.View style={[styles.statsCard, entranceStyle]}>
        <Text style={styles.statsTitle}>العب بأمان</Text>
        <Text style={styles.pointsNotice}>نتائج هذه الألعاب تؤثر على نقاط اللعب المجانية فقط، ولا تغيّر رصيد Coins أو Diamonds في محفظتك.</Text>
      </Animated.View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingBottom: 104 },
  header: { padding: 16, paddingTop: 60, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: colors.text, fontSize: 24, fontWeight: 'bold' },
  balanceCard: { backgroundColor: colors.surface, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  balanceLabel: { color: colors.textSecondary, fontSize: 11 },
  balanceValue: { color: colors.gold, fontSize: 14, fontWeight: 'bold', marginTop: 2 },
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
  gamesGrid: { padding: 16, gap: 12 },
  gameCard: {
    borderRadius: 16,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  gameIconBg: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gameInfo: { flex: 1 },
  gameName: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  gameDesc: { color: 'rgba(255,255,255,0.85)', fontSize: 13, marginTop: 4 },
  maxMultBadge: {
    backgroundColor: 'rgba(0,0,0,0.3)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginTop: 6,
  },
  maxMultText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  statsCard: {
    margin: 16,
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 16,
  },
  statsTitle: { color: colors.text, fontSize: 16, fontWeight: 'bold', marginBottom: 12 },
});
