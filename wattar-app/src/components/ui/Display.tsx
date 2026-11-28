/**
 * عناصر عرض: رأس قسم، شارة مستوى، نقطة بث نابضة، صورة رمزية، حلقة تقدّم.
 */
import React, { useEffect } from 'react';
import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { colors, fonts, gradients, space } from '@/lib/theme';
import { usePreferencesStore } from '@/store/preferences';
import { AppText } from './AppText';

export function SectionHeader({
  title,
  caption,
  actionLabel,
  onAction,
  accentColor = colors.gold,
  style,
}: {
  title: string;
  caption?: string;
  actionLabel?: string;
  onAction?: () => void;
  accentColor?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.sectionHeader, style]}>
      <View style={styles.sectionTitleWrap}>
        <View style={[styles.sectionAccent, { backgroundColor: accentColor }]} />
        <View style={{ flexShrink: 1 }}>
          <AppText variant="h2" align="right">{title}</AppText>
          {caption ? (
            <AppText variant="caption" align="right" style={styles.sectionCaption}>{caption}</AppText>
          ) : null}
        </View>
      </View>
      {actionLabel && onAction ? (
        <AppText variant="label" color={colors.primary} onPress={onAction} suppressHighlighting>
          {actionLabel}
        </AppText>
      ) : null}
    </View>
  );
}

export function LevelBadge({ level, size = 'sm' }: { level: number; size?: 'sm' | 'md' }) {
  const isSmall = size === 'sm';
  return (
    <LinearGradient
      colors={gradients.gold}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[
        styles.levelBadge,
        {
          height: isSmall ? 16 : 20,
          paddingHorizontal: isSmall ? 5 : 7,
          borderRadius: isSmall ? 6 : 7,
        },
      ]}
    >
      <AppText
        style={{
          color: colors.inkGold,
          fontFamily: fonts.black,
          fontSize: isSmall ? 8 : 10,
          lineHeight: isSmall ? 12 : 14,
        }}
      >
        {`LV ${level}`}
      </AppText>
    </LinearGradient>
  );
}

export function LiveDot({ size = 7, color = colors.success }: { size?: number; color?: string }) {
  const reduceMotion = usePreferencesStore((state) => state.reduceMotion);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      progress.value = 0;
      return;
    }
    progress.value = withRepeat(
      withTiming(1, { duration: 1500, easing: Easing.out(Easing.quad) }),
      -1,
      false,
    );
  }, [progress, reduceMotion]);

  const haloStyle = useAnimatedStyle(() => ({
    opacity: 0.45 * (1 - progress.value),
    transform: [{ scale: 1 + progress.value * 1.9 }],
  }));

  return (
    <View style={{ width: size * 3, height: size * 3, alignItems: 'center', justifyContent: 'center' }}>
      {!reduceMotion ? (
        <Animated.View
          pointerEvents="none"
          style={[
            { position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: color },
            haloStyle,
          ]}
        />
      ) : null}
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
    </View>
  );
}

export function Avatar({
  uri,
  name,
  size = 44,
  ringColor,
  ringWidth = 2,
  level,
  style,
}: {
  uri?: string | null;
  name?: string | null;
  size?: number;
  ringColor?: string;
  ringWidth?: number;
  level?: number | null;
  style?: StyleProp<ViewStyle>;
}) {
  const initial = (name ?? '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <View style={[{ width: size, height: size }, style]}>
      <View
        style={[
          styles.avatarRing,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth: ringColor ? ringWidth : 0,
            borderColor: ringColor ?? 'transparent',
          },
        ]}
      >
        {uri ? (
          <Image source={{ uri }} style={{ width: '100%', height: '100%', borderRadius: size / 2 }} />
        ) : (
          <LinearGradient
            colors={gradients.primarySoft}
            style={[styles.avatarFallback, { borderRadius: size / 2 }]}
          >
            <AppText
              style={{
                fontFamily: fonts.bold,
                fontSize: Math.round(size * 0.36),
                lineHeight: Math.round(size * 0.5),
                color: colors.text,
              }}
            >
              {initial}
            </AppText>
          </LinearGradient>
        )}
      </View>
      {typeof level === 'number' ? (
        <View style={styles.avatarLevel}>
          <LevelBadge level={level} />
        </View>
      ) : null}
    </View>
  );
}

export function ProgressRing({
  progress,
  size = 64,
  stroke = 6,
  color = colors.primary,
  trackColor = colors.borderSoft,
  children,
}: {
  progress: number;
  size?: number;
  stroke?: number;
  color?: string;
  trackColor?: string;
  children?: React.ReactNode;
}) {
  const clamped = Math.min(1, Math.max(0, progress));
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={trackColor}
          strokeWidth={stroke}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={circumference * (1 - clamped)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    gap: space.md,
  },
  sectionTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 9, flex: 1 },
  sectionAccent: { width: 3, height: 22, borderRadius: 2 },
  sectionCaption: { marginTop: 2 },
  levelBadge: { alignItems: 'center', justifyContent: 'center' },
  avatarRing: { overflow: 'hidden', backgroundColor: colors.surfaceMuted },
  avatarFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  avatarLevel: { position: 'absolute', bottom: -4, alignSelf: 'center' },
});
