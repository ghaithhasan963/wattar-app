import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { colors, fonts } from '@/lib/theme';

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
        <Text style={styles.label}>ظ…ط¨ظ„ط؛ ط§ظ„ط¬ظˆظ„ط©</Text>
        <Text style={styles.balance}>ط§ظ„ظ…طھط§ط­ {available.toLocaleString('ar')} Coin</Text>
      </View>
      <View style={styles.inputRow}>
        <TextInput
          style={[styles.input, invalid && styles.inputInvalid]}
          value={value}
          onChangeText={(nextValue) => onChange(nextValue.replace(/[^\d]/g, ''))}
          keyboardType="number-pad"
          placeholder="ط§ظƒطھط¨ ط§ظ„ظ…ط¨ظ„ط؛"
          placeholderTextColor={colors.textSecondary}
          editable={!disabled}
          accessibilityLabel="ط¹ط¯ط¯ ط¹ظ…ظ„ط§طھ ط§ظ„ظ„ط¹ط¨ ظ„ظ„ط¬ظˆظ„ط©"
          accessibilityHint="ط£ط¯ط®ظ„ ظ…ط¨ظ„ط؛ظ‹ط§ طµط­ظٹط­ظ‹ط§ ظ„ط§ ظٹطھط¬ط§ظˆط² ط±طµظٹط¯ظƒ ط§ظ„ظ…طھط§ط­"
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
            ? 'ط§ظ„ظ…ط¨ظ„ط؛ ط£ظƒط¨ط± ظ…ظ† ط±طµظٹط¯ Coin ط§ظ„ظ…طھط§ط­.'
            : 'ط£ط¯ط®ظ„ ط¹ط¯ط¯ظ‹ط§ طµط­ظٹط­ظ‹ط§ ظ…ظ† Coin ظٹط¨ط¯ط£ ظ…ظ† 1.'
          : 'ط§ظ„ط±ظ‡ط§ظ† ظٹظڈط®طµظ… ظ…ظ† Coin ظˆظٹظڈط¹ط§ط¯ ط§ط­طھط³ط§ط¨ ط§ظ„ط±طµظٹط¯ ط¨ط¹ط¯ ط§ظ„ط¬ظˆظ„ط©.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: 12 },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  label: { color: colors.text, fontSize: 13, fontFamily: fonts.bold },
  balance: { color: colors.textSecondary, fontSize: 10, fontFamily: fonts.semibold },
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
  input: { flex: 1, minWidth: 0, height: 50, paddingHorizontal: 14, color: colors.text, fontSize: 17, fontFamily: fonts.bold, textAlign: 'center' },
  inputInvalid: { color: colors.danger },
  unit: { alignSelf: 'stretch', justifyContent: 'center', paddingHorizontal: 12, borderLeftWidth: 1, borderLeftColor: colors.border },
  unitText: { color: colors.teal, fontSize: 9, fontFamily: fonts.black, letterSpacing: 0.6 },
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
  quickBetSelected: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  quickBetDisabled: { opacity: 0.35 },
  quickBetText: { color: colors.textSecondary, fontSize: 11, fontFamily: fonts.bold },
  quickBetTextSelected: { color: colors.text },
  hint: { color: colors.textSecondary, fontSize: 10, lineHeight: 15, marginTop: 8, textAlign: 'right' },
  hintInvalid: { color: colors.danger },
});
