import { ArrowRight } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CurrencyIcon } from '@/components/CurrencyIcon';
import { colors, fonts } from '@/lib/theme';

interface GameHeaderProps {
  title: string;
  subtitle: string;
  balance: number;
}

export function GameHeader({ title, subtitle, balance }: GameHeaderProps) {
  const router = useRouter();
  const coinBalance = Number.isFinite(balance) ? Math.max(0, Math.trunc(balance)) : 0;

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="ط§ظ„ط¹ظˆط¯ط© ط¥ظ„ظ‰ ط§ظ„ط£ظ„ط¹ط§ط¨"
        >
          <ArrowRight size={19} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.titleCopy}>
          <Text style={styles.eyebrow}>WATTAR آ· ط£ظ„ط¹ط§ط¨ COIN</Text>
          <Text style={styles.title}>{title}</Text>
        </View>
        <View style={styles.balanceCard} accessibilityLabel={`ط±طµظٹط¯ Coin ${coinBalance.toLocaleString('ar')}`}>
          <CurrencyIcon currency="coin" size={34} />
          <View style={styles.balanceCopy}>
            <Text style={styles.balanceLabel}>Coin</Text>
            <Text style={styles.balance}>{coinBalance.toLocaleString('ar')}</Text>
          </View>
        </View>
      </View>
      <Text style={styles.subtitle}>{subtitle}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
    padding: 14,
    borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  titleCopy: { flex: 1, minWidth: 0 },
  eyebrow: { color: colors.teal, fontSize: 9, fontFamily: fonts.bold, letterSpacing: 0.7 },
  title: { color: colors.text, fontSize: 19, fontFamily: fonts.black, marginTop: 3 },
  balanceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 13,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  balanceCopy: { alignItems: 'flex-end' },
  balanceLabel: { color: colors.textSecondary, fontSize: 9, fontFamily: fonts.semibold },
  balance: { color: colors.gold, fontSize: 13, fontFamily: fonts.black, marginTop: 1 },
  subtitle: { color: colors.textSecondary, fontSize: 11, lineHeight: 17, marginTop: 11, textAlign: 'right' },
});
