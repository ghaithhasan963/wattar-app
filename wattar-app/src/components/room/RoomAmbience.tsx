/**
 * RoomAmbience — خلفية الغرفة: غلاف الغرفة كامل الشاشة + هالات تسبح ببطء + وهج منصة.
 * الغلاف يمنح كل غرفة هوية بصرية خاصة (تخصيص الغرفة)، والهالات تُضيف حياة.
 * كل الحركة على السائق الأصلي وتُعطَّل تلقائيًا مع reduceMotion.
 */
import React, { useEffect } from 'react';
import { Image, StyleSheet, View } from 'react-native';
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
}: {
  size: number;
  color: string;
  top: number;
  left: number;
  drift: number;
  duration: number;
  reduceMotion: boolean;
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
      opacity: 0.45 + p * 0.3,
    };
  });

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
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
    />
  );
}

export function RoomAmbience({ coverUrl }: { coverUrl?: string | null }) {
  const reduceMotion = usePreferencesStore((state) => state.reduceMotion);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {/* غلاف الغرفة كامل الشاشة: هوية بصرية خاصة لكل غرفة */}
      {coverUrl ? (
        <Image source={{ uri: coverUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <LinearGradient colors={gradients.screen} locations={[0, 0.38, 1]} style={StyleSheet.absoluteFill} />
      )}

      {/* تعتيم متدرّج: خفيف في المنتصف كي يظهر الغلاف، أقوى أعلى وأسفل لوضوح النصوص */}
      <LinearGradient
        colors={gradients.scrim}
        locations={[0, 0.22, 0.52, 1]}
        style={StyleSheet.absoluteFill}
      />

      {/* وهج المنصة */}
      <LinearGradient
        colors={gradients.stageGlow}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={styles.stageGlow}
      />

      <Orb size={230} color={colors.primaryOrb} top={-70} left={-70} drift={34} duration={9000} reduceMotion={reduceMotion} />
      <Orb size={190} color={colors.tealOrb} top={150} left={250} drift={-28} duration={11000} reduceMotion={reduceMotion} />
      <Orb size={260} color={colors.primaryOrbFaint} top={430} left={-90} drift={26} duration={13000} reduceMotion={reduceMotion} />
      <Orb size={170} color={colors.goldOrb} top={620} left={230} drift={-22} duration={10000} reduceMotion={reduceMotion} />
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
