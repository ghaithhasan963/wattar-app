/**
 * AppText — كل نص في التطبيق يمر من هنا حتى يبقى الخط والمقاس موحّدين.
 */
import React from 'react';
import { Text, type TextProps, type TextStyle } from 'react-native';
import { typeScale, type TextVariant } from '@/lib/theme';

export interface AppTextProps extends TextProps {
  variant?: TextVariant;
  color?: string;
  align?: TextStyle['textAlign'];
}

export function AppText({ variant = 'body', color, align, style, ...rest }: AppTextProps) {
  return (
    <Text
      {...rest}
      style={[
        typeScale[variant],
        color ? { color } : null,
        align ? { textAlign: align } : null,
        style,
      ]}
    />
  );
}
