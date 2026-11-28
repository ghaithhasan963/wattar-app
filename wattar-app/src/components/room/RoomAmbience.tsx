/**
 * RoomAmbience — أجواء الغرفة: هالات بنفسجية/تركوازية تسبح ببطء + وهج منصة علوي.
 * كل الحركة على السائق الأصلي وتُعطَّل تلقائيًا مع reduceMotion.
 */
import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { colors, gradients } from '@/lib/theme';
import { usePreferencesStore } from '@/store/preferences';

function Orb({
  size,
  color,
  top,
  left,
  drift,
  duration,
  reduceMotion,
  delay = 0,
}: {
  size: number;
  color: string;
  top: number;
  left: number;
  drift: number;
  duration: number;
  reduceMotion: boolean;
  delay?: number;
}) {
  const progress = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      progress.value = 0.5;
      return;
    }
    progress.value = withRepeat(
      withTiming(1, { duration, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
  }, [duration, progress, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => {
    const p = progress.value;
    return {
      transform: [
        { translateX: drift * p },
        { translateY: drift * 0.6 * (1 - p) },
        { scale: 0.92 + p * 0.16 },
      ],
      opacity: 0.55 + p * 0.35,
    };
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          top,
          left,
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
        },
        animatedStyle,
      ]}
      // تأخير بصري بسيط بين الهالات
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      key={delay}
    />
  );
}

export function RoomAmbience() {
  const reduceMotion = usePreferencesStore((state) => state.reduceMotion);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <LinearGradient
        colors={gradients.screen}
        locations={[0, 0.38, 1]}
        style={StyleSheet.absoluteFill}
      />
      {/* وهج المنصة */}
      <LinearGradient
        colors={[colors.primaryHaze, 'rgba(169,71,245,0.05)', 'rgba(10,7,18,0)']}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={styles.stageGlow}
      />
      <Orb size={230} color="rgba(169,71,245,0.16)" top={-70} left={-70} drift={34} duration={9000} reduceMotion={reduceMotion} />
      <Orb size={190} color="rgba(88,214,193,0.10)" top={150} left={250} drift={-28} duration={11000} reduceMotion={reduceMotion} delay={1} />
      <Orb size={260} color="rgba(169,71,245,0.09)" top={430} left={-90} drift={26} duration={13000} reduceMotion={reduceMotion} delay={2} />
      <Orb size={170} color="rgba(244,189,85,0.07)" top={620} left={230} drift={-22} duration={10000} reduceMotion={reduceMotion} delay={3} />
    </View>
  );
}

const styles = StyleSheet.create({
  stageGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 320,
  },
});
