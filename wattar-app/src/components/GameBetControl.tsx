import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { colors } from '@/lib/theme';

const QUICK_BETS = [25, 50, 100, 250];

interface GameBetControlProps {
  value: string;
  balance: number;
  disabled?: boolean;
  onChange: (value: string) => void;
}

export function parseValidGameBet(value: string, balance: number): number | null {
  const amount = Number(value);
  const available = Number.isFinite(balance) ? Math.max(0, Math.trunc(balance)) : 0;
  return Number.isSafeInteger(amount) && amount >= 1 && amount <= available ? amount : null;
}

export function GameBetControl({ value, balance, disabled = false, onChange }: GameBetControlProps) {
  const available = Number.isFinite(balance) ? Math.max(0, Math.trunc(balance)) : 0;
  const amount = Number(value);
  const hasInput = value.length > 0;
  const invalid = hasInput && parseValidGameBet(value, available) === null;

  return (
    <View style={styles.container}>
      <View style={styles.heading}>
        <Text style={styles.label}>مبلغ الجولة</Text>
        <Text style={styles.balance}>المتاح {available.toLocaleString('ar')} Coin</Text>
      </View>
      <View style={styles.inputRow}>
        <TextInput
          style={[styles.input, invalid && styles.inputInvalid]}
          value={value}
          onChangeText={(nextValue) => onChange(nextValue.replace(/[^\d]/g, ''))}
          keyboardType="number-pad"
          placeholder="اكتب المبلغ"
          placeholderTextColor={colors.textSecondary}
          editable={!disabled}
          accessibilityLabel="عدد عملات اللعب للجولة"
          accessibilityHint="أدخل مبلغًا صحيحًا لا يتجاوز رصيدك المتاح"
        />
        <View style={styles.unit}>
          <Text style={styles.unitText}>COIN</Text>
        </View>
      </View>
      <View style={styles.quickBets}>
        {QUICK_BETS.map((preset) => {
          const selected = amount === preset;
          const unavailable = disabled || preset > available;
          return (
            <TouchableOpacity
              key={preset}
              style={[styles.quickBet, selected && styles.quickBetSelected, unavailable && styles.quickBetDisabled]}
              onPress={() => onChange(String(preset))}
              disabled={unavailable}
              accessibilityRole="button"
              accessibilityState={{ selected, disabled: unavailable }}
            >
              <Text style={[styles.quickBetText, selected && styles.quickBetTextSelected]}>
                {preset.toLocaleString('ar')}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={[styles.hint, invalid && styles.hintInvalid]}>
        {invalid
          ? Number.isSafeInteger(amount) && amount > available
            ? 'المبلغ أكبر من رصيد Coin المتاح.'
            : 'أدخل عددًا صحيحًا من Coin يبدأ من 1.'
          : 'الرهان يُخصم من Coin ويُعاد احتساب الرصيد بعد الجولة.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: 12 },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  label: { color: colors.text, fontSize: 13, fontWeight: '800' },
  balance: { color: colors.textSecondary, fontSize: 10, fontWeight: '700' },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  input: { flex: 1, minWidth: 0, height: 50, paddingHorizontal: 14, color: colors.text, fontSize: 17, fontWeight: '800', textAlign: 'center' },
  inputInvalid: { color: colors.danger },
  unit: { alignSelf: 'stretch', justifyContent: 'center', paddingHorizontal: 12, borderLeftWidth: 1, borderLeftColor: colors.border },
  unitText: { color: colors.teal, fontSize: 9, fontWeight: '900', letterSpacing: 0.6 },
  quickBets: { flexDirection: 'row', gap: 7, marginTop: 9 },
  quickBet: {
    flex: 1,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  quickBetSelected: { backgroundColor: '#30204A', borderColor: colors.primary },
  quickBetDisabled: { opacity: 0.35 },
  quickBetText: { color: colors.textSecondary, fontSize: 11, fontWeight: '800' },
  quickBetTextSelected: { color: colors.text },
  hint: { color: colors.textSecondary, fontSize: 10, lineHeight: 15, marginTop: 8, textAlign: 'right' },
  hintInvalid: { color: colors.danger },
});
