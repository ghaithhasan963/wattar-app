/**
 * عناصر اختيار الهدية: بطاقة هدية بضغط مرن ووهج عند الاختيار، وشريحة مستلم بصورة رمزية.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Reanimated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { Avatar } from '@/components/ui';
import { colors, fonts, glow, gradients, motion, radius } from '@/lib/theme';

export interface GiftRecord {
  id: string;
  name: string;
  name_ar?: string | null;
  icon_emoji?: string | null;
  icon_url?: string | null;
  animation_url?: string | null;
  price_gold: number;
  is_premium?: boolean | null;
  category?: string | null;
  /** هدية رمزية من الحقيبة: لا تُشترى ولا تتحول لعملات، تنتقل بين الحقائب. */
  is_symbolic?: boolean | null;
}

export function GiftCard({
  gift,
  selected,
  onPress,
}: {
  gift: GiftRecord;
  selected: boolean;
  onPress: () => void;
}) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${gift.name_ar ?? gift.name}، ${Number(gift.price_gold).toLocaleString()} Coin`}
      onPressIn={() => {
        scale.value = withSpring(0.94, motion.spring);
      }}
      onPressOut={() => {
        scale.value = withSpring(1, motion.spring);
      }}
    >
      <Reanimated.View
        style={[
          styles.card,
          selected && styles.cardSelected,
          selected && glow(colors.gold, 12),
          animatedStyle,
        ]}
      >
        {selected && (
          <LinearGradient
            colors={['rgba(244,189,85,0.26)', 'rgba(169,71,245,0.10)', 'rgba(0,0,0,0)']}
            style={StyleSheet.absoluteFill}
          />
        )}
        <Text style={styles.emoji}>{gift.icon_emoji ?? '🎁'}</Text>
        <Text style={styles.name} numberOfLines={1}>{gift.name_ar ?? gift.name}</Text>
        <View style={[styles.pricePill, selected && styles.pricePillActive, gift.is_symbolic && styles.symbolicPill]}>
          <Text style={[styles.price, selected && styles.priceActive, gift.is_symbolic && styles.symbolicPrice]}>
            {gift.is_symbolic ? 'رمزية' : Number(gift.price_gold).toLocaleString()}
          </Text>
        </View>
      </Reanimated.View>
    </Pressable>
  );
}

export function RecipientChip({
  name,
  avatarUrl,
  selected,
  disabled,
  onPress,
}: {
  name: string;
  avatarUrl?: string | null;
  selected?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}
      accessibilityLabel={`إهداء ${name}`}
      style={({ pressed }) => [
        styles.recipient,
        selected && styles.recipientSelected,
        disabled && styles.recipientDisabled,
        pressed && { opacity: 0.8 },
      ]}
    >
      <Avatar size={26} uri={avatarUrl} name={name} />
      <Text style={styles.recipientName} numberOfLines={1}>{name}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 82,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: 'transparent',
    backgroundColor: colors.glass,
    alignItems: 'center',
    overflow: 'hidden',
  },
  cardSelected: {
    borderColor: colors.gold,
    backgroundColor: colors.goldHaze,
  },
  emoji: { fontSize: 27, lineHeight: 34 },
  name: {
    color: colors.text,
    fontFamily: fonts.medium,
    fontSize: 10,
    lineHeight: 16,
    marginTop: 2,
    textAlign: 'center',
  },
  pricePill: {
    marginTop: 5,
    paddingHorizontal: 7,
    paddingVertical: 1,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceGlass,
  },
  pricePillActive: { backgroundColor: colors.gold },
  symbolicPill: { backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: colors.borderSoft },
  price: { color: colors.gold, fontFamily: fonts.black, fontSize: 9, lineHeight: 14 },
  priceActive: { color: colors.inkGold },
  symbolicPrice: { color: colors.primaryLight },
  recipient: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    maxWidth: 150,
  },
  recipientSelected: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  recipientDisabled: { opacity: 0.45 },
  recipientName: { color: colors.text, fontFamily: fonts.semibold, fontSize: 11, flexShrink: 1 },
});
