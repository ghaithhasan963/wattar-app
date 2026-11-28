/**
 * Button — زر واحد لكل التطبيق: 5 أنماط × 3 أحجام، ضغط مرن + اهتزاز خفيف.
 */
import React from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { colors, fonts, glow, gradients, motion, radius } from '@/lib/theme';
import { AppText } from './AppText';

export type ButtonVariant = 'primary' | 'gold' | 'teal' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface VariantStyle {
  gradient?: readonly [string, string, ...string[]];
  text: string;
  border: string;
  glowColor?: string;
}

const VARIANTS: Record<ButtonVariant, VariantStyle> = {
  primary: { gradient: gradients.primary, text: colors.text, border: colors.borderLight, glowColor: colors.primaryGlow },
  gold: { gradient: gradients.gold, text: colors.inkGold, border: colors.borderLight, glowColor: colors.goldGlow },
  teal: { gradient: gradients.teal, text: colors.inkTeal, border: colors.borderLight, glowColor: colors.tealGlow },
  danger: { gradient: gradients.danger, text: colors.text, border: colors.borderLight, glowColor: colors.dangerGlow },
  ghost: { text: colors.text, border: colors.borderStrong },
};

const SIZES: Record<ButtonSize, { height: number; padding: number; fontSize: number; gap: number }> = {
  sm: { height: 38, padding: 14, fontSize: 12, gap: 6 },
  md: { height: 46, padding: 18, fontSize: 14, gap: 8 },
  lg: { height: 54, padding: 22, fontSize: 15, gap: 9 },
};

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: React.ReactNode;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  haptic?: 'none' | 'light' | 'medium';
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  disabled = false,
  loading = false,
  fullWidth = false,
  haptic = 'light',
  style,
  accessibilityLabel,
}: ButtonProps) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const config = VARIANTS[variant];
  const dimensions = SIZES[size];
  const inactive = disabled || loading;

  const triggerHaptic = () => {
    if (haptic === 'none' || Platform.OS === 'web') return;
    const style = haptic === 'medium' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light;
    void Haptics.impactAsync(style).catch(() => {
      // Haptics are best-effort only.
    });
  };

  const content = (
    <View style={[styles.content, { gap: dimensions.gap }]}>
      {loading ? (
        <ActivityIndicator size="small" color={config.text} />
      ) : (
        <>
          <AppText
            style={{ color: config.text, fontFamily: fonts.bold, fontSize: dimensions.fontSize }}
            numberOfLines={1}
          >
            {label}
          </AppText>
          {icon}
        </>
      )}
    </View>
  );

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: inactive, busy: loading }}
      onPressIn={() => {
        scale.value = withSpring(motion.press, motion.spring);
        triggerHaptic();
      }}
      onPressOut={() => {
        scale.value = withSpring(1, motion.spring);
      }}
      style={fullWidth ? styles.fullWidth : undefined}
    >
      <Animated.View
        style={[
          { alignSelf: fullWidth ? 'stretch' : 'flex-start' },
          config.glowColor && !inactive ? glow(config.glowColor, 14) : null,
          inactive ? styles.inactive : null,
          animatedStyle,
          style,
        ]}
      >
        {config.gradient ? (
          <LinearGradient
            colors={config.gradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[
              styles.base,
              {
                height: dimensions.height,
                paddingHorizontal: dimensions.padding,
                borderRadius: size === 'sm' ? radius.sm : radius.md,
                borderColor: config.border,
              },
            ]}
          >
            {content}
          </LinearGradient>
        ) : (
          <View
            style={[
              styles.base,
              styles.ghost,
              {
                height: dimensions.height,
                paddingHorizontal: dimensions.padding,
                borderRadius: size === 'sm' ? radius.sm : radius.md,
                borderColor: config.border,
              },
            ]}
          >
            {content}
          </View>
        )}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fullWidth: { alignSelf: 'stretch' },
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    overflow: 'hidden',
  },
  ghost: { backgroundColor: colors.surfaceGlass },
  content: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  inactive: { opacity: 0.45 },
});
