/**
 * Card — سطح زجاجي متدرّج بحدود ناعمة، ونسخة قابلة للضغط بضغط مرن.
 */
import React from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, gradients, motion, radius } from '@/lib/theme';

export function Card({
  children,
  style,
  padded = true,
  onPress,
  glowColor,
  gradient = gradients.card,
  borderColor = colors.borderSoft,
  radiusSize = 'lg',
  accessibilityLabel,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  onPress?: () => void;
  glowColor?: string;
  gradient?: readonly [string, string, ...string[]];
  borderColor?: string;
  radiusSize?: keyof typeof radius;
  accessibilityLabel?: string;
}) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const borderRadius = radius[radiusSize];

  const surface = (
    <LinearGradient
      colors={gradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[
        styles.surface,
        {
          borderRadius,
          borderColor,
          padding: padded ? 16 : 0,
          shadowColor: glowColor ?? colors.shadowInk,
          shadowOpacity: glowColor ? 0.45 : 0.28,
          shadowRadius: glowColor ? 20 : 16,
          shadowOffset: { width: 0, height: glowColor ? 0 : 8 },
          elevation: glowColor ? 10 : 5,
        },
      ]}
    >
      {children}
    </LinearGradient>
  );

  if (!onPress) return <View style={style}>{surface}</View>;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={style}
      onPressIn={() => {
        scale.value = withSpring(0.978, motion.spring);
      }}
      onPressOut={() => {
        scale.value = withSpring(1, motion.spring);
      }}
    >
      <Animated.View style={animatedStyle}>{surface}</Animated.View>
    </Pressable>
  );
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.divider, style]} />;
}

const styles = StyleSheet.create({
  surface: {
    borderWidth: 1,
    overflow: 'hidden',
  },
  divider: { height: 1, backgroundColor: colors.borderSoft, opacity: 0.9 },
});
