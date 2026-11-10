import React from 'react';
import { Coins, Gem, Sparkles } from 'lucide-react-native';
import { View, StyleSheet } from 'react-native';

type Currency = 'point' | 'coin' | 'diamond';

const currencyStyles = {
  point: { background: '#2A1B50', border: '#8757E8', icon: '#C4A5FF' },
  coin: { background: '#3B2A12', border: '#B9862F', icon: '#FFD36B' },
  diamond: { background: '#123A3D', border: '#3D9D9A', icon: '#78E4D7' },
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
