/**
 * Wattar App â€” طµظپط­ط© ط§ظ„طھط­ظ‚ظ‚ OTP
 */
import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '@/store/auth';
import { getPendingPhone, clearPendingPhone } from '@/lib/pending';
import { colors, fonts } from '@/lib/theme';

export default function VerifyScreen() {
  const router = useRouter();
  const { verifyOtp, loading, error } = useAuthStore();
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [phone, setPhone] = useState<string | null>(null);
  const inputs = useRef<(TextInput | null)[]>([]);

  useEffect(() => {
    getPendingPhone().then(setPhone);
  }, []);

  const handleCodeChange = (index: number, value: string) => {
    if (value.length > 1) return;
    const newCode = [...code];
    newCode[index] = value;
    setCode(newCode);

    if (value && index < 5) {
      inputs.current[index + 1]?.focus();
    }

    // طھط­ظ‚ظ‚ طھظ„ظ‚ط§ط¦ظٹ ط¹ظ†ط¯ ط§ظƒطھظ…ط§ظ„ ط§ظ„ظƒظˆط¯
    if (index === 5 && value) {
      handleVerify(newCode.join(''));
    }
  };

  const handleVerify = async (fullCode?: string) => {
    const codeStr = fullCode ?? code.join('');
    if (codeStr.length !== 6 || !phone) {
      if (!phone) Alert.alert('ط®ط·ط£', 'ظ„ظ… ظٹطھظ… ط§ظ„ط¹ط«ظˆط± ط¹ظ„ظ‰ ط±ظ‚ظ… ط§ظ„ظ‡ط§طھظپطŒ ط­ط§ظˆظ„ ظ…ط±ط© ط£ط®ط±ظ‰');
      return;
    }

    try {
      await verifyOtp(phone, codeStr);
      await clearPendingPhone();
      router.replace('/(tabs)');
    } catch {
      // ط§ظ„ط®ط·ط£ ظ…ظˆط¬ظˆط¯ ظپظٹ store
    }
  };

  const handleResend = async () => {
    if (!phone) return;
    const { signInWithPhone } = useAuthStore.getState();
    try {
      await signInWithPhone(phone);
      Alert.alert('طھظ…', 'طھظ… ط¥ط¹ط§ط¯ط© ط¥ط±ط³ط§ظ„ ط§ظ„ط±ظ…ط²');
    } catch (err: any) {
      Alert.alert('ط®ط·ط£', err.message);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>ط±ظ…ط² ط§ظ„طھط­ظ‚ظ‚</Text>
      <Text style={styles.subtitle}>ط£ط±ط³ظ„ظ†ط§ ط±ظ…ط²ظ‹ط§ ط¥ظ„ظ‰ ط±ظ‚ظ…ظƒ{phone ? ` (${phone})` : ''}</Text>

      <View style={styles.codeContainer}>
        {code.map((digit, index) => (
          <TextInput
            key={index}
            ref={(ref) => { inputs.current[index] = ref; }}
            style={styles.codeInput}
            value={digit}
            onChangeText={(value) => handleCodeChange(index, value)}
            keyboardType="number-pad"
            maxLength={1}
            autoFocus={index === 0}
          />
        ))}
      </View>

      {error && <Text style={styles.errorText}>{error}</Text>}

      <TouchableOpacity
        style={styles.button}
        onPress={() => handleVerify()}
        disabled={loading || code.some(c => !c)}
      >
        {loading ? (
          <ActivityIndicator color={colors.text} />
        ) : (
          <Text style={styles.buttonText}>طھط£ظƒظٹط¯</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity onPress={handleResend}>
        <Text style={styles.resendText}>ط¥ط¹ط§ط¯ط© ط¥ط±ط³ط§ظ„ ط§ظ„ط±ظ…ط²</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: 24,
    justifyContent: 'center',
  },
  title: {
    fontSize: 28,
    fontFamily: fonts.bold,
    color: colors.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 32,
  },
  codeContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 32,
  },
  codeInput: {
    width: 48,
    height: 56,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 12,
    color: colors.text,
    fontSize: 24,
    fontFamily: fonts.bold,
    textAlign: 'center',
  },
  button: {
    backgroundColor: colors.primary,
    height: 56,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    color: colors.text,
    fontSize: 16,
    fontFamily: fonts.semibold,
  },
  errorText: {
    color: colors.danger,
    textAlign: 'center',
    marginBottom: 16,
  },
  resendText: {
    color: colors.primary,
    textAlign: 'center',
    marginTop: 16,
  },
});
