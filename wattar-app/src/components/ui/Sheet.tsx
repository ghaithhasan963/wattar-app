/**
 * Sheet — لوحة سفلية موحّدة (خلفية معتمة + مقبض سحب بصري + إغلاق باللمس خارجها).
 * لا تستخدم إيماءات حتى تبقى متوافقة مع كل الشاشات دون GestureHandlerRootView.
 */
import React from 'react';
import { Modal, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, gradients, radius, space } from '@/lib/theme';
import { AppText } from './AppText';

export function Sheet({
  visible,
  onClose,
  title,
  subtitle,
  children,
  footer,
  maxHeight = '80%',
  style,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxHeight?: `${number}%`;
  style?: StyleProp<ViewStyle>;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="إغلاق اللوحة" />
        <LinearGradient
          colors={gradients.sheet}
          style={[styles.panel, { maxHeight, paddingBottom: Math.max(insets.bottom, space.lg) }, style]}
        >
          <View style={styles.handle} />
          {title ? (
            <View style={styles.header}>
              <View style={{ flex: 1 }}>
                <AppText variant="h2" align="right">{title}</AppText>
                {subtitle ? (
                  <AppText variant="caption" align="right" style={{ marginTop: 2 }}>{subtitle}</AppText>
                ) : null}
              </View>
            </View>
          ) : null}
          <View style={styles.body}>{children}</View>
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </LinearGradient>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: colors.overlay,
  },
  panel: {
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.borderStrong,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
  },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    marginBottom: space.md,
  },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: space.md },
  body: { flexShrink: 1 },
  footer: { marginTop: space.md },
});
