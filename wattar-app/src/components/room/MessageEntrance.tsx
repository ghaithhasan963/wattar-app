/**
 * MessageEntrance — دخول ناعم لكل رسالة في المحادثة (شفافية + انزلاق بسيط).
 * يعمل على السائق الأصلي ويُعطَّل مع reduceMotion.
 */
import React, { useEffect } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { usePreferencesStore } from '@/store/preferences';

export function MessageEntrance({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const reduceMotion = usePreferencesStore((state) => state.reduceMotion);
  const progress = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    if (reduceMotion) {
      progress.value = 1;
      return;
    }
    progress.value = withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) });
  }, [progress, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 10 }],
  }));

  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}
