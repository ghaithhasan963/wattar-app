/**
 * عناصر تحكم صغيرة: Chip للتصنيفات، IconButton للأزرار الدائرية.
 */
import React from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, fonts, gradients, radius } from '@/lib/theme';
import { AppText } from './AppText';

export function Chip({
  label,
  selected = false,
  onPress,
  icon,
  style,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const content = (
    <View style={styles.chipContent}>
      {icon}
      <AppText
        variant="label"
        style={{ color: selected ? colors.text : colors.textSecondary, fontFamily: fonts.semibold }}
      >
        {label}
      </AppText>
    </View>
  );

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      style={style}
    >
      {selected ? (
        <LinearGradient
          colors={gradients.primary}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.chip, styles.chipSelected]}
        >
          {content}
        </LinearGradient>
      ) : (
        <View style={[styles.chip, styles.chipIdle]}>{content}</View>
      )}
    </Pressable>
  );
}

export function IconButton({
  children,
  onPress,
  badge,
  size = 42,
  active = false,
  style,
  accessibilityLabel,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  badge?: number;
  size?: number;
  active?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.iconButton,
        {
          width: size,
          height: size,
          borderRadius: size * 0.36,
          backgroundColor: active ? colors.primarySoft : colors.surfaceGlass,
          borderColor: active ? colors.borderStrong : colors.borderSoft,
          opacity: pressed ? 0.75 : 1,
        },
        style,
      ]}
    >
      {children}
      {typeof badge === 'number' && badge > 0 ? (
        <View style={styles.badge}>
          <AppText style={styles.badgeText}>{badge > 9 ? '9+' : String(badge)}</AppText>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: 36,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipSelected: { borderColor: colors.borderLight },
  chipIdle: { borderColor: colors.borderSoft, backgroundColor: colors.surfaceGlass },
  chipContent: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  iconButton: { alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  badge: {
    position: 'absolute',
    top: -5,
    left: -5,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.inkDanger,
  },
  badgeText: { color: colors.text, fontFamily: fonts.bold, fontSize: 9, lineHeight: 12 },
});
