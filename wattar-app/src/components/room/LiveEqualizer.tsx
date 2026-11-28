/**
 * LiveEqualizer — أعمدة صوت نابضة تُستخدم في شارة «صوت مباشر» وفي المقاعد.
 * كل الأعمدة على السائق الأصلي (Reanimated) وتتوقف عند reduceMotion.
 */
import React, { useEffect } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { colors } from '@/lib/theme';
import { usePreferencesStore } from '@/store/preferences';

const DELAYS = [0, 110, 220, 70, 160];
const DURATIONS = [540, 700, 480, 620, 760];

function Bar({
  index,
  height,
  width,
  color,
  active,
  reduceMotion,
}: {
  index: number;
  height: number;
  width: number;
  color: string;
  active: boolean;
  reduceMotion: boolean;
}) {
  const progress = useSharedValue(0.35);

  useEffect(() => {
    if (!active || reduceMotion) {
      progress.value = withTiming(0.35, { duration: 160 });
      return;
    }
    progress.value = withDelay(
      DELAYS[index % DELAYS.length],
      withRepeat(
        withSequence(
          withTiming(1, { duration: DURATIONS[index % DURATIONS.length], easing: Easing.inOut(Easing.quad) }),
          withTiming(0.28, { duration: DURATIONS[index % DURATIONS.length], easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
        true,
      ),
    );
  }, [active, index, progress, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => ({
    height: height * progress.value,
    opacity: 0.55 + progress.value * 0.45,
  }));

  return (
    <Animated.View
      style={[
        { width, borderRadius: width / 2, backgroundColor: color },
        animatedStyle,
      ]}
    />
  );
}

export function LiveEqualizer({
  bars = 4,
  height = 12,
  width = 2.5,
  gap = 2,
  color = colors.teal,
  active = true,
  style,
}: {
  bars?: number;
  height?: number;
  width?: number;
  gap?: number;
  color?: string;
  active?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const reduceMotion = usePreferencesStore((state) => state.reduceMotion);
  return (
    <View
      pointerEvents="none"
      style={[{ flexDirection: 'row', alignItems: 'center', height, gap }, style]}
    >
      {Array.from({ length: bars }).map((_, index) => (
        <Bar
          key={index}
          index={index}
          height={height}
          width={width}
          color={color}
          active={active}
          reduceMotion={reduceMotion}
        />
      ))}
    </View>
  );
}
