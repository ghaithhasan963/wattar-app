import React from 'react';
import { Coins, Gem, Sparkles } from 'lucide-react-native';
import { View, StyleSheet } from 'react-native';
import { currency as currencyTheme } from '@/lib/theme';

type Currency = 'point' | 'coin' | 'diamond';

const currencyStyles = {
  point: currencyTheme.point,
  coin: currencyTheme.coin,
  diamond: currencyTheme.diamond,
} as const;

const currencyIcons = {
  point: Sparkles,
  coin: Coins,
  diamond: Gem,
} as const;

export function CurrencyIcon({ currency, size = 34 }: { currency: Currency; size?: number }) {
  const Icon = currencyIcons[currency];
  const palette = currencyStyles[currency];
  const iconSize = Math.round(size * 0.53);

  return (
    <View
      style={[
        styles.outer,
        {
          width: size,
          height: size,
          borderRadius: size * 0.34,
          backgroundColor: palette.background,
          borderColor: palette.border,
        },
      ]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Icon size={iconSize} color={palette.icon} strokeWidth={2.2} />
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
});
