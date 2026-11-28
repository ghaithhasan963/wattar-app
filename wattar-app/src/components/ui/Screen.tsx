/**
 * Screen — خلفية متدرجة + منطقة آمنة، تُستخدم كجذر لكل شاشة جديدة.
 */
import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, gradients } from '@/lib/theme';

export function Screen({
  children,
  style,
  topInset = true,
  bottomInset = false,
  gradient = gradients.screen,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  topInset?: boolean;
  bottomInset?: boolean;
  gradient?: readonly [string, string, ...string[]];
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, style]}>
      <LinearGradient
        colors={gradient}
        locations={gradient.length >= 3 ? [0, 0.45, 1] : undefined}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <View
        style={{
          flex: 1,
          paddingTop: topInset ? insets.top : 0,
          paddingBottom: bottomInset ? insets.bottom : 0,
        }}
      >
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.backgroundDeep },
});
