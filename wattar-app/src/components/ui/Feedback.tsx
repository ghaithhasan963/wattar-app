/**
 * حالات الواجهة: دخول متدرّج، هيكل تحميل نابض، وحالة فراغ موحّدة.
 */
import React, { useEffect } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { colors, motion, radius, space } from '@/lib/theme';
import { usePreferencesStore } from '@/store/preferences';
import { AppText } from './AppText';
import { Button } from './Button';

export function Reveal({
  children,
  index = 0,
  style,
}: {
  children: React.ReactNode;
  index?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reduceMotion = usePreferencesStore((state) => state.reduceMotion);
  const progress = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    if (reduceMotion) {
      progress.value = 1;
      return;
    }
    const delay = Math.min(index, 8) * motion.stagger;
    progress.value = withDelay(
      delay,
      withTiming(1, { duration: motion.entrance, easing: Easing.out(Easing.cubic) }),
    );
  }, [index, progress, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 16 }],
  }));

  return <Animated.View style={[animatedStyle, style]}>{children}</Animated.View>;
}

export function Skeleton({
  width,
  height = 14,
  borderRadius = radius.xs,
  style,
}: {
  width?: number | `${number}%`;
  height?: number;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reduceMotion = usePreferencesStore((state) => state.reduceMotion);
  const shimmer = useSharedValue(0.3);

  useEffect(() => {
    if (reduceMotion) {
      shimmer.value = 0.5;
      return;
    }
    shimmer.value = withRepeat(
      withTiming(0.8, { duration: 900, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [reduceMotion, shimmer]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: shimmer.value }));

  return (
    <Animated.View
      style={[
        { width, height, borderRadius, backgroundColor: colors.surfaceMuted },
        animatedStyle,
        style,
      ]}
    />
  );
}

export function EmptyState({
  icon,
  title,
  caption,
  actionLabel,
  onAction,
  style,
}: {
  icon?: React.ReactNode;
  title: string;
  caption?: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.empty, style]}>
      {icon ? <View style={styles.emptyIcon}>{icon}</View> : null}
      <AppText variant="h2" align="center">{title}</AppText>
      {caption ? (
        <AppText variant="caption" align="center" style={styles.emptyCaption}>{caption}</AppText>
      ) : null}
      {actionLabel && onAction ? (
        <Button label={actionLabel} onPress={onAction} size="sm" variant="primary" style={styles.emptyAction} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xxl,
    paddingVertical: space.xxl,
    gap: 6,
  },
  emptyIcon: {
    width: 62,
    height: 62,
    borderRadius: 22,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  emptyCaption: { marginTop: 2, maxWidth: 260 },
  emptyAction: { marginTop: space.md },
});
