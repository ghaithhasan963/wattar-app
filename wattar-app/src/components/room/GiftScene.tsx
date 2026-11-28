/**
 * GiftScene — احتفال الهدايا الكبيرة بمشهد سينمائي كامل الشاشة (شبيه بالفيديو).
 * سفينة شراعية تُبحر عبر الشاشة فوق موج متلألئ، مع أشعة ضوء، شظايا نجمية،
 * وشريط يذكر المرسل والهدية والمستلم. مبني على Reanimated + SVG بلا فيديو خارجي.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { Platform, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, {
  Defs,
  LinearGradient as SvgGradient,
  Path,
  Polygon,
  Stop,
} from 'react-native-svg';
import Animated, {
  Easing,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { colors, fonts, glow, radius } from '@/lib/theme';
import { usePreferencesStore } from '@/store/preferences';

export interface GiftSceneData {
  emoji: string;
  name: string;
  recipient: string;
  sender?: string | null;
}

const STAR_COUNT = 22;

function Star({
  index,
  progress,
  width,
  height,
}: {
  index: number;
  progress: SharedValue<number>;
  width: number;
  height: number;
}) {
  const seed = index * 137.508;
  const x = ((Math.sin(seed) + 1) / 2) * width;
  const y = ((Math.cos(seed * 1.7) + 1) / 2) * height * 0.8;
  const size = 3 + (index % 4) * 2.4;
  const delay = (index % 7) * 0.09;
  const drift = 18 + (index % 5) * 9;

  const style = useAnimatedStyle(() => {
    const p = Math.max(0, Math.min(1, (progress.value - delay) / (1 - delay)));
    return {
      opacity: p <= 0 ? 0 : Math.sin(p * Math.PI) * 0.95,
      transform: [
        { translateY: -p * drift },
        { scale: 0.4 + Math.sin(p * Math.PI) * 0.9 },
      ],
    };
  });

  return (
    <Animated.Text
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          left: x,
          top: y,
          fontSize: size + 5,
          color: index % 3 === 0 ? colors.gold : index % 3 === 1 ? '#BFEFFF' : '#FFFFFF',
          fontFamily: fonts.bold,
          textShadowColor: colors.gold,
          textShadowRadius: 7,
        },
        style,
      ]}
    >
      ✦
    </Animated.Text>
  );
}

/** السفينة: هيكل + ثلاثة صواري بأشرعة مثلثة متدرجة + منافذ مضيئة. */
function Ship({ size }: { size: number }) {
  return (
    <Svg width={size} height={size * 0.95} viewBox="0 0 200 190">
      <Defs>
        <SvgGradient id="sail" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#F2FBFF" stopOpacity="0.99" />
          <Stop offset="0.3" stopColor="#B6DDF7" stopOpacity="0.97" />
          <Stop offset="0.62" stopColor="#F6C9E9" stopOpacity="0.95" />
          <Stop offset="1" stopColor="#A6EFDD" stopOpacity="0.97" />
        </SvgGradient>
        <SvgGradient id="sailShade" x1="1" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#C9B6E8" stopOpacity="0.95" />
          <Stop offset="1" stopColor="#8FB6D8" stopOpacity="0.92" />
        </SvgGradient>
        <SvgGradient id="hull" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#AFC3E4" stopOpacity="0.98" />
          <Stop offset="0.5" stopColor="#63739F" stopOpacity="0.98" />
          <Stop offset="1" stopColor="#242C4C" stopOpacity="1" />
        </SvgGradient>
        <SvgGradient id="deck" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#E0C994" stopOpacity="0.98" />
          <Stop offset="1" stopColor="#8A6A3A" stopOpacity="0.98" />
        </SvgGradient>
      </Defs>

      {/* الصواري */}
      <Path d="M58 40 L58 134" stroke="#EAF1FF" strokeWidth="2.6" strokeLinecap="round" />
      <Path d="M100 20 L100 138" stroke="#F7FAFF" strokeWidth="3" strokeLinecap="round" />
      <Path d="M142 44 L142 134" stroke="#EAF1FF" strokeWidth="2.6" strokeLinecap="round" />

      {/* الشراع الأمامي (يسار) */}
      <Path d="M58 42 C34 62 30 100 40 128 L58 128 Z" fill="url(#sail)" opacity="0.95" />
      <Path d="M58 42 C80 64 84 102 74 128 L58 128 Z" fill="url(#sailShade)" opacity="0.85" />

      {/* الشراع الرئيسي (وسط) — أكبر */}
      <Path d="M100 22 C66 52 58 102 70 134 L100 134 Z" fill="url(#sail)" />
      <Path d="M100 22 C134 52 142 102 130 134 L100 134 Z" fill="url(#sailShade)" opacity="0.9" />

      {/* الشراع الخلفي (يمين) */}
      <Path d="M142 46 C122 66 118 102 126 130 L142 130 Z" fill="url(#sail)" opacity="0.94" />
      <Path d="M142 46 C160 68 164 104 156 130 L142 130 Z" fill="url(#sailShade)" opacity="0.78" />

      {/* العلم */}
      <Path d="M100 20 L120 27 L100 34 Z" fill={colors.gold} />

      {/* سطح السفينة */}
      <Path d="M28 134 L172 134 L164 144 L36 144 Z" fill="url(#deck)" />

      {/* الهيكل */}
      <Path
        d="M24 145 C38 172 76 184 100 184 C126 184 162 172 176 145 Z"
        fill="url(#hull)"
      />
      {/* خط مضيء على الهيكل */}
      <Path
        d="M38 150 C56 162 80 168 100 168 C120 168 146 162 162 150"
        stroke="#D6E8FF"
        strokeWidth="1.5"
        strokeOpacity="0.6"
        fill="none"
      />
      {/* منافذ مضيئة */}
      <Polygon points="64,152 71,152 70,159 65,159" fill="#FFE6A6" opacity="0.92" />
      <Polygon points="95,154 102,154 101,162 96,162" fill="#FFE6A6" opacity="0.92" />
      <Polygon points="127,152 134,152 133,159 128,159" fill="#FFE6A6" opacity="0.92" />
    </Svg>
  );
}

export function GiftScene({
  gift,
  combo = 1,
  target,
  onDone,
}: {
  gift: GiftSceneData;
  combo?: number;
  /** موقع مقعد المستلم على الشاشة؛ عند الانتهاء تنكمش الهدية وتتحرك نحوه. */
  target?: { x: number; y: number } | null;
  onDone: () => void;
}) {
  const reduceMotion = usePreferencesStore((state) => state.reduceMotion);
  const { width, height } = useWindowDimensions();
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  const travel = useSharedValue(reduceMotion ? 0.5 : 0);
  const bob = useSharedValue(0);
  const sweep = useSharedValue(0);
  const stars = useSharedValue(0);
  const banner = useSharedValue(reduceMotion ? 1 : 0);
  const exitProgress = useSharedValue(0);

  const shipSize = Math.min(width * 0.66, 300);
  const starsArr = useMemo(() => Array.from({ length: STAR_COUNT }), []);

  useEffect(() => {
    if (Platform.OS !== 'web') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {
        // الاهتزاز تحسين اختياري.
      });
    }
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      travel.value = 0.5;
      banner.value = 1;
      stars.value = 1;
      return;
    }
    travel.value = withTiming(1, { duration: 4200, easing: Easing.inOut(Easing.quad) });
    banner.value = withSequence(
      withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) }),
      withDelay(3200, withTiming(0, { duration: 420, easing: Easing.in(Easing.cubic) })),
    );
    bob.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 1100, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      true,
    );
    sweep.value = withRepeat(
      withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.quad) }),
      -1,
      false,
    );
    stars.value = withTiming(1, { duration: 2000, easing: Easing.out(Easing.cubic) });
    exitProgress.value = withDelay(
      3900,
      withTiming(1, { duration: 950, easing: Easing.inOut(Easing.cubic) }),
    );

    const timeout = setTimeout(() => doneRef.current(), 5000);
    return () => clearTimeout(timeout);
  }, [banner, bob, exitProgress, reduceMotion, stars, sweep, travel]);

  const targetX = (target?.x ?? width / 2) - width / 2;
  const targetY = (target?.y ?? height * 0.45) - (height * 0.62);

  const shipStyle = useAnimatedStyle(() => {
    const exit = exitProgress.value;
    return {
      opacity: 1 - exit * 0.12,
      transform: [
        { translateX: (0.5 - travel.value) * (width + shipSize) * (1 - exit) + targetX * exit },
        { translateY: (Math.sin(bob.value * Math.PI) * 9 - 6) * (1 - exit) + targetY * exit },
        { scale: 1 - exit * 0.88 },
        { rotate: `${Math.sin(bob.value * Math.PI) * 2.4 * (1 - exit)}deg` },
      ],
    };
  });

  const sweepStyle = useAnimatedStyle(() => ({
    opacity: 0.18 + Math.sin(sweep.value * Math.PI) * 0.22,
    transform: [{ rotate: `${-18 + sweep.value * 26}deg` }],
  }));

  const bannerStyle = useAnimatedStyle(() => ({
    opacity: banner.value * (1 - exitProgress.value),
    transform: [
      { translateY: (1 - banner.value) * -14 },
      { scale: 0.94 + banner.value * 0.06 },
    ],
  }));

  const exitFadeStyle = useAnimatedStyle(() => ({
    opacity: 1 - exitProgress.value,
  }));

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <LinearGradient
        colors={['rgba(6,10,22,0.55)', 'rgba(8,14,30,0.78)', 'rgba(4,8,18,0.9)']}
        style={StyleSheet.absoluteFill}
      />

      {/* أشعة ضوء من الأعلى */}
      <Animated.View style={[styles.rays, sweepStyle, exitFadeStyle]}>
        <LinearGradient
          colors={['rgba(255,236,180,0.42)', 'rgba(255,236,180,0)']}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>

      {/* النجوم */}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, exitFadeStyle]}>
        {starsArr.map((_, index) => (
          <Star key={index} index={index} progress={stars} width={width} height={height} />
        ))}
      </Animated.View>

      {/* شريط الرسالة */}
      <Animated.View style={[styles.banner, bannerStyle]}>
        <View style={styles.bannerRow}>
          <Text style={styles.bannerEmoji}>{gift.emoji}</Text>
          <View style={styles.bannerCopy}>
            <Text style={styles.bannerTitle} numberOfLines={1}>
              {gift.sender ?? 'عضو'} أهدى {gift.name}
            </Text>
            <Text style={styles.bannerSub} numberOfLines={1}>إلى {gift.recipient}</Text>
          </View>
          {combo > 1 && (
            <View style={styles.comboPill}>
              <Text style={styles.comboText}>×{combo}</Text>
            </View>
          )}
        </View>
      </Animated.View>

      {/* الموج */}
      <Animated.View style={[styles.water, exitFadeStyle]} pointerEvents="none">
        <LinearGradient
          colors={['rgba(72,158,214,0.42)', 'rgba(24,74,124,0.72)', 'rgba(8,26,48,0.92)']}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.waterLine1} />
        <View style={styles.waterLine2} />
      </Animated.View>

      {/* السفينة */}
      <Animated.View style={[styles.ship, shipStyle]}>
        <Ship size={shipSize} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  rays: {
    position: 'absolute',
    top: -60,
    left: -40,
    right: -40,
    height: '70%',
  },
  banner: {
    position: 'absolute',
    top: '16%',
    alignSelf: 'center',
    maxWidth: '86%',
  },
  bannerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(12,18,34,0.72)',
    borderWidth: 1,
    borderColor: colors.goldLine,
    ...glow(colors.gold, 22),
  },
  bannerEmoji: { fontSize: 22, lineHeight: 30 },
  bannerCopy: { flexShrink: 1 },
  bannerTitle: { color: colors.gold, fontFamily: fonts.black, fontSize: 13, lineHeight: 21 },
  bannerSub: { color: colors.textSecondary, fontFamily: fonts.semibold, fontSize: 10, lineHeight: 16 },
  comboPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  comboText: { color: colors.primaryLight, fontFamily: fonts.black, fontSize: 11, lineHeight: 16 },
  water: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '46%',
  },
  waterLine1: {
    position: 'absolute',
    top: 6,
    left: 0,
    right: 0,
    height: 1.5,
    backgroundColor: 'rgba(190,240,255,0.35)',
  },
  waterLine2: {
    position: 'absolute',
    top: 22,
    left: '12%',
    right: '20%',
    height: 1,
    backgroundColor: 'rgba(190,240,255,0.18)',
  },
  ship: {
    position: 'absolute',
    bottom: '20%',
    alignSelf: 'center',
    ...glow('#7FC8FF', 30),
  },
});
