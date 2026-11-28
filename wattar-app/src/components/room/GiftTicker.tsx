/**
 * GiftTicker — شريط الهدايا الحيّة أعلى الغرفة.
 * كل هدية تدخل من اليمين بمرونة، وتبقى ٨ ثوانٍ ثم تختفي، ما يمنح الغرفة إحساسًا حيًّا
 * ويُظهر تخصيص الغرفة وتفاعل أهلها. الحركة على السائق الأصلي وتُعطَّل مع reduceMotion.
 */
import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { colors, fonts, gradients, radius } from '@/lib/theme';
import { usePreferencesStore } from '@/store/preferences';

export interface GiftFeedEntry {
  id: string;
  emoji: string;
  name: string;
  sender: string | null;
  recipient: string;
}

function TickerRow({ entry, index }: { entry: GiftFeedEntry; index: number }) {
  const reduceMotion = usePreferencesStore((state) => state.reduceMotion);
  const appear = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    if (reduceMotion) {
      appear.value = 1;
      return;
    }
    appear.value = withSequence(
      withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) }),
      withDelay(6200, withTiming(0, { duration: 320, easing: Easing.in(Easing.cubic) })),
    );
  }, [appear, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: appear.value,
    transform: [
      { translateX: (1 - appear.value) * 34 },
      { scale: 0.96 + appear.value * 0.04 },
    ],
  }));

  return (
    <Animated.View style={[styles.row, animatedStyle, index > 0 && styles.rowStacked]}>
      <LinearGradient
        colors={['rgba(244,189,85,0.20)', 'rgba(169,71,245,0.10)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
      <Text style={styles.emoji}>{entry.emoji}</Text>
      <Text style={styles.copy} numberOfLines={1}>
        <Text style={styles.sender}>{entry.sender ?? 'عضو'}</Text>
        <Text style={styles.muted}> أهدى </Text>
        <Text style={styles.gift}>{entry.name}</Text>
        <Text style={styles.muted}> إلى </Text>
        <Text style={styles.recipient}>{entry.recipient}</Text>
      </Text>
    </Animated.View>
  );
}

export function GiftTicker({ entries }: { entries: GiftFeedEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <View pointerEvents="none" style={styles.wrap}>
      {entries.slice(0, 2).map((entry, index) => (
        <TickerRow key={entry.id} entry={entry} index={index} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 5, paddingHorizontal: 14, paddingBottom: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.goldLine,
    backgroundColor: colors.goldHaze,
    overflow: 'hidden',
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  rowStacked: { opacity: 0.9 },
  emoji: { fontSize: 14, lineHeight: 20 },
  copy: { flexShrink: 1, fontFamily: fonts.semibold, fontSize: 10, lineHeight: 16 },
  sender: { color: colors.gold, fontFamily: fonts.bold },
  muted: { color: colors.textMuted },
  gift: { color: colors.primaryLight, fontFamily: fonts.bold },
  recipient: { color: colors.teal, fontFamily: fonts.bold },
});
