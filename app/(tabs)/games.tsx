/**
 * Wattar App — صفحة الألعاب
 * قائمة الألعاب الأربعة: عجلة الحظ، نرد، Aviator، Plinko
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { ArrowLeft, Gamepad2, Dice5, Plane, ChevronDown, Users } from 'lucide-react-native';
import { useAuthStore } from '@/store/auth';
import { usePreferencesStore } from '@/store/preferences';
import { colors } from '@/lib/theme';

const games = [
  {
    id: 'wheel',
    name: 'عجلة الحظ',
    description: 'أدر العجلة واربح حتى x50',
    icon: Gamepad2,
    color: '#7C3AED',
    bgGradient: ['#7C3AED', '#5B21B6'],
    maxMult: 'x50',
  },
  {
    id: 'aviator',
    name: 'طيارة المضاعفات',
    description: 'اسحب قبل ما تطير',
    icon: Plane,
    color: '#3B82F6',
    bgGradient: ['#3B82F6', '#1D4ED8'],
    maxMult: 'x100',
  },
  {
    id: 'plinko',
    name: 'بلانغو',
    description: 'الكرة تسقط وتربح',
    icon: ChevronDown,
    color: '#F59E0B',
    bgGradient: ['#F59E0B', '#B45309'],
    maxMult: 'x1000',
  },
  {
    id: 'dice',
    name: 'نرد',
    description: 'اختر الهدف واراهن',
    icon: Dice5,
    color: '#10B981',
    bgGradient: ['#10B981', '#047857'],
    maxMult: 'x10',
  },
];

export default function GamesScreen() {
  const router = useRouter();
  const { profile } = useAuthStore();
  const { reduceMotion } = usePreferencesStore();
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

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>الألعاب</Text>
        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>رصيدك</Text>
          <Text style={styles.balanceValue}>{profile?.balance_gold?.toLocaleString()} ذهب</Text>
        </View>
      </View>

      <Animated.View style={[styles.communityCard, entranceStyle]}>
        <View style={styles.communityIcon}><Users size={22} color={colors.primary} /></View>
        <View style={styles.communityCopy}>
          <Text style={styles.communityTitle}>تحديات الأصدقاء</Text>
          <Text style={styles.communityDescription}>نرد مجاني لشخصين أو أربعة — بدون ذهب</Text>
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
        <Text style={styles.statsTitle}>إحصائياتك</Text>
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{profile?.total_wagered?.toLocaleString?.() ?? 0}</Text>
            <Text style={styles.statLabel}>إجمالي الرهانات</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{profile?.total_won?.toLocaleString?.() ?? 0}</Text>
            <Text style={styles.statLabel}>إجمالي الأرباح</Text>
          </View>
        </View>
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
  statsRow: { flexDirection: 'row', gap: 16 },
  statItem: { flex: 1 },
  statValue: { color: colors.primary, fontSize: 20, fontWeight: 'bold' },
  statLabel: { color: colors.textSecondary, fontSize: 11, marginTop: 4 },
});
