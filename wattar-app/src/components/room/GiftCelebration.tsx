/**
 * GiftCelebration — احتفال الهدية: حلقات تتوسّع، شظايا ملوّنة تتطاير،
 * قلب الهدية ينبض، وشريط كومبو عند تكرار الإهداء السريع.
 * مبني بالكامل على Reanimated (سائق أصلي) بلا مكتبات إضافية.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  Easing,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';
import { colors, fonts, glow, gradients, radius, shadow } from '@/lib/theme';
import { usePreferencesStore } from '@/store/preferences';

export interface GiftCelebrationData {
  emoji: string;
  name: string;
  recipient: string;
  recipientAvatar?: string | null;
  sender?: string | null;
  /** هدية كبيرة: تُعرض بمشهد سينمائي كامل الشاشة بدل بطاقة الاحتفال. */
  premium?: boolean;
}

const PARTICLE_COUNT = 16;
const PARTICLE_COLORS = ['#F4BD55', '#A947F5', '#58D6C1', '#FF718E', '#FFFFFF', '#FFD98A'];
const PARTICLE_SHAPES = ['✦', '●', '◆', '✧'];

function Particle({
  index,
  progress,
  spread,
}: {
  index: number;
  progress: SharedValue<number>;
  spread: number;
}) {
  const angle = (Math.PI * 2 * index) / PARTICLE_COUNT + (index % 3) * 0.12;
  const distance = spread * (0.55 + ((index * 37) % 45) / 100);
  const dx = Math.cos(angle) * distance;
  const dy = Math.sin(angle) * distance - 18;
  const size = 7 + (index % 4) * 3;
  const color = PARTICLE_COLORS[index % PARTICLE_COLORS.length];
  const shape = PARTICLE_SHAPES[index % PARTICLE_SHAPES.length];

  const animatedStyle = useAnimatedStyle(() => {
    const p = progress.value;
    return {
      opacity: p < 0.75 ? 1 - p * 0.9 : Math.max(0, 1 - (p - 0.75) * 4),
      transform: [
        { translateX: dx * p },
        { translateY: dy * p + 70 * p * p },
        { scale: 0.5 + p * 0.9 },
        { rotate: `${p * (index % 2 === 0 ? 260 : -260)}deg` },
      ],
    };
  });

  return (
    <Animated.Text
      style={[
        {
          position: 'absolute',
          color,
          fontSize: size + 6,
          fontFamily: fonts.bold,
          textShadowColor: color,
          textShadowRadius: 8,
        },
        animatedStyle,
      ]}
    >
      {shape}
    </Animated.Text>
  );
}

function Ring({ progress, delay, color }: { progress: SharedValue<number>; delay: number; color: string }) {
  const animatedStyle = useAnimatedStyle(() => {
    const p = progress.value;
    return {
      opacity: p <= 0 ? 0 : Math.max(0, 0.55 - p * 0.6),
      transform: [{ scale: 0.4 + p * 1.5 }],
    };
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.ring,
        { borderColor: color, marginLeft: delay },
        animatedStyle,
      ]}
    />
  );
}

export function GiftCelebration({
  gift,
  combo = 1,
  onDone,
}: {
  gift: GiftCelebrationData;
  combo?: number;
  onDone: () => void;
}) {
  const reduceMotion = usePreferencesStore((state) => state.reduceMotion);
  const { width } = useWindowDimensions();
  const cardProgress = useSharedValue(reduceMotion ? 1 : 0);
  const emojiProgress = useSharedValue(reduceMotion ? 1 : 0);
  const particleProgress = useSharedValue(reduceMotion ? 1 : 0);
  const ringProgress = useSharedValue(reduceMotion ? 1 : 0);
  const glowPulse = useSharedValue(0);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  const spread = Math.min(width * 0.42, 190);
  const particles = useMemo(() => Array.from({ length: PARTICLE_COUNT }), []);

  useEffect(() => {
    if (Platform.OS !== 'web') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {
        // الاهتزاز تحسين اختياري.
      });
    }
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      cardProgress.value = 1;
      emojiProgress.value = 1;
      particleProgress.value = 1;
      ringProgress.value = 1;
    } else {
      cardProgress.value = withSpring(1, { damping: 14, stiffness: 130 });
      emojiProgress.value = withSequence(
        withSpring(1.18, { damping: 8, stiffness: 180 }),
        withSpring(1, { damping: 10, stiffness: 150 }),
      );
      particleProgress.value = withDelay(90, withTiming(1, { duration: 1150, easing: Easing.out(Easing.cubic) }));
      ringProgress.value = withTiming(1, { duration: 1000, easing: Easing.out(Easing.quad) });
      glowPulse.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 620, easing: Easing.inOut(Easing.quad) }),
          withTiming(0, { duration: 620, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
        true,
      );
    }

    const timeout = setTimeout(() => doneRef.current(), reduceMotion ? 1400 : 2600);
    return () => clearTimeout(timeout);
  }, [cardProgress, emojiProgress, particleProgress, reduceMotion, ringProgress, glowPulse]);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: cardProgress.value,
    transform: [
      { scale: 0.72 + cardProgress.value * 0.28 },
      { translateY: (1 - cardProgress.value) * 26 },
    ],
  }));

  const emojiStyle = useAnimatedStyle(() => ({
    transform: [{ scale: emojiProgress.value }],
  }));

  const auraStyle = useAnimatedStyle(() => ({
    opacity: 0.35 + glowPulse.value * 0.45,
    transform: [{ scale: 1 + glowPulse.value * 0.12 }],
  }));

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {/* عتمة خفيفة تُبرز الاحتفال دون حجب الغرفة */}
      <LinearGradient
        colors={['rgba(6,4,10,0)', 'rgba(6,4,10,0.45)', 'rgba(6,4,10,0.72)']}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.stage}>
        <View style={styles.ringsWrap}>
          <Ring progress={ringProgress} delay={0} color={colors.gold} />
          <Ring progress={ringProgress} delay={14} color={colors.primary} />
          <Ring progress={ringProgress} delay={28} color={colors.teal} />
        </View>

        <Animated.View style={[styles.aura, auraStyle]} />

        <Animated.View style={[styles.card, cardStyle]}>
          <LinearGradient
            colors={gradients.sheet}
            style={StyleSheet.absoluteFill}
          />
          <LinearGradient
            colors={['rgba(244,189,85,0.22)', 'rgba(169,71,245,0.10)', 'rgba(0,0,0,0)']}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.cardTop}>
            <View style={styles.senderPill}>
              <Text style={styles.senderPillText} numberOfLines={1}>
                {gift.sender ? `${gift.sender} أهدى` : 'هدية جديدة'}
              </Text>
            </View>
            {combo > 1 && (
              <View style={styles.comboPill}>
                <Text style={styles.comboText}>×{combo} كومبو</Text>
              </View>
            )}
          </View>

          <Animated.Text style={[styles.giftEmoji, emojiStyle]}>{gift.emoji}</Animated.Text>

          <Text style={styles.giftName} numberOfLines={1}>{gift.name}</Text>
          <View style={styles.toRow}>
            <View style={styles.toAvatar}>
              <Text style={styles.toAvatarText}>
                {(gift.recipient || '?').trim().charAt(0).toUpperCase()}
              </Text>
            </View>
            <Text style={styles.toText} numberOfLines={1}>
              إلى {gift.recipient}
            </Text>
          </View>

          <View style={styles.sparkRow}>
            <View style={styles.sparkLine} />
            <Text style={styles.sparkText}>✦ ✦ ✦</Text>
            <View style={styles.sparkLine} />
          </View>
        </Animated.View>

        {/* الشظايا تنطلق من مركز البطاقة */}
        <View style={styles.particles} pointerEvents="none">
          {particles.map((_, index) => (
            <Particle key={index} index={index} progress={particleProgress} spread={spread} />
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringsWrap: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    width: 190,
    height: 190,
    borderRadius: 95,
    borderWidth: 1.5,
  },
  aura: {
    position: 'absolute',
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: colors.goldHaze,
    ...glow(colors.gold, 46),
  },
  card: {
    width: 244,
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 16,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.goldEdge,
    overflow: 'hidden',
    alignItems: 'center',
    ...shadow.raised,
    shadowColor: colors.gold,
    shadowOpacity: 0.45,
    shadowRadius: 26,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    alignSelf: 'stretch',
    marginBottom: 6,
  },
  senderPill: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.goldHaze,
    borderWidth: 1,
    borderColor: colors.goldLine,
    maxWidth: 130,
  },
  senderPillText: { color: colors.gold, fontFamily: fonts.bold, fontSize: 9, lineHeight: 14 },
  comboPill: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  comboText: { color: colors.primaryLight, fontFamily: fonts.black, fontSize: 10, lineHeight: 15 },
  giftEmoji: { fontSize: 64, lineHeight: 78, marginTop: 2 },
  giftName: {
    color: colors.text,
    fontFamily: fonts.black,
    fontSize: 17,
    lineHeight: 26,
    textAlign: 'center',
    marginTop: 2,
  },
  toRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  toAvatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toAvatarText: { color: colors.primaryLight, fontFamily: fonts.bold, fontSize: 10 },
  toText: { color: colors.textSecondary, fontFamily: fonts.semibold, fontSize: 11, lineHeight: 18 },
  sparkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, alignSelf: 'stretch' },
  sparkLine: { flex: 1, height: 1, backgroundColor: colors.goldLine },
  sparkText: { color: colors.gold, fontSize: 8, letterSpacing: 2 },
  particles: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
