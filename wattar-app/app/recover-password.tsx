import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LockKeyhole, ShieldAlert } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { colors, fonts } from '@/lib/theme';
import { describeAuthError } from '@/lib/authMessages';
import {
  clearSessionMark,
  isRecoverySessionFresh,
  readSessionMark,
  validateNewPassword,
} from '@/lib/recovery';

type Gate = 'checking' | 'ready' | 'blocked';

export default function RecoverPasswordScreen() {
  const router = useRouter();
  const [gate, setGate] = useState<Gate>('checking');
  const [gateMessage, setGateMessage] = useState('ط¬ط§ط±ظچ ط§ظ„طھط­ظ‚ظ‚ ظ…ظ† ط±ط§ط¨ط· ط§ظ„ط§ط³طھط¹ط§ط¯ط©...');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ط¨ظˆط§ط¨ط© ط¥ظ„ط²ط§ظ…ظٹط©: ظ„ط§ طھظڈظ‚ط¨ظ„ ط¥ط¹ط§ط¯ط© ط§ظ„طھط¹ظٹظٹظ† ط¥ظ„ط§ ظ…ظ† ط±ط§ط¨ط· ط§ط³طھط¹ط§ط¯ط© ط­ط¯ظٹط« ظ„ظ†ظپط³ ط§ظ„ظ…ط³طھط®ط¯ظ….
  useEffect(() => {
    let active = true;
    const verify = async () => {
      try {
        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        const session = data.session;
        if (!session?.user) {
          if (active) {
            setGate('blocked');
            setGateMessage('ظ„ط§ طھظˆط¬ط¯ ط¬ظ„ط³ط© ط§ط³طھط¹ط§ط¯ط©. ط§ظپطھط­ ط±ط§ط¨ط· ط¥ط¹ط§ط¯ط© ط§ظ„طھط¹ظٹظٹظ† ط§ظ„ط°ظٹ ظˆطµظ„ظƒ ط¨ط§ظ„ط¨ط±ظٹط¯طŒ ط£ظˆ ط§ط·ظ„ط¨ ط±ط§ط¨ط·ط§ظ‹ ط¬ط¯ظٹط¯ط§ظ‹.');
          }
          return;
        }
        const mark = await readSessionMark(AsyncStorage);
        if (!isRecoverySessionFresh(mark, Date.now()) || mark.userId !== session.user.id) {
          if (active) {
            setGate('blocked');
            setGateMessage('ظ‡ط°ظ‡ ط§ظ„ط´ط§ط´ط© طھظڈظپطھط­ ظ…ظ† ط±ط§ط¨ط· ط¥ط¹ط§ط¯ط© ط§ظ„طھط¹ظٹظٹظ† ظپظ‚ط·. ط§ط·ظ„ط¨ ط±ط§ط¨ط·ط§ظ‹ ط¬ط¯ظٹط¯ط§ظ‹ ظ„ظ„ظ…طھط§ط¨ط¹ط©.');
          }
          return;
        }
        if (active) setGate('ready');
      } catch (caught: unknown) {
        if (active) {
          setGate('blocked');
          setGateMessage(describeAuthError(caught, 'طھط¹ط°ط± ط§ظ„طھط­ظ‚ظ‚ ظ…ظ† ط¬ظ„ط³ط© ط§ظ„ط§ط³طھط¹ط§ط¯ط©. ط­ط§ظˆظ„ ظ…ظ† ط¬ط¯ظٹط¯.'));
        }
      }
    };
    void verify();
    return () => {
      active = false;
    };
  }, []);

  const updatePassword = async () => {
    const validation = validateNewPassword(password, confirmation);
    if (!validation.ok) {
      setError(validation.message);
      return;
    }

    setError(null);
    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      await clearSessionMark(AsyncStorage).catch(() => undefined);
      Alert.alert('طھظ… طھط­ط¯ظٹط« ظƒظ„ظ…ط© ط§ظ„ظ…ط±ظˆط±', 'ظٹظ…ظƒظ†ظƒ ط§ظ„ط¢ظ† ط§ظ„ظ…طھط§ط¨ط¹ط© ط¨ط§ط³طھط®ط¯ط§ظ… ظƒظ„ظ…ط© ط§ظ„ظ…ط±ظˆط± ط§ظ„ط¬ط¯ظٹط¯ط©.');
      router.replace('/(tabs)');
    } catch (caught: unknown) {
      setError(describeAuthError(caught));
    } finally {
      setLoading(false);
    }
  };

  if (gate === 'checking') {
    return (
      <View style={styles.screen}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.gateText}>{gateMessage}</Text>
      </View>
    );
  }

  if (gate === 'blocked') {
    return (
      <View style={styles.screen}>
        <View style={styles.card}>
          <View style={styles.icon}><ShieldAlert size={23} color={colors.danger} /></View>
          <Text style={styles.title}>ط±ط§ط¨ط· ط¥ط¹ط§ط¯ط© ط§ظ„طھط¹ظٹظٹظ† ط؛ظٹط± طµط§ظ„ط­</Text>
          <Text style={styles.description}>{gateMessage}</Text>
          <TouchableOpacity
            style={styles.button}
            onPress={() => router.replace('/(auth)/email')}
            accessibilityRole="button"
          >
            <Text style={styles.buttonText}>ط·ظ„ط¨ ط±ط§ط¨ط· ط¬ط¯ظٹط¯</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.card}>
        <View style={styles.icon}><LockKeyhole size={23} color={colors.primary} /></View>
        <Text style={styles.title}>ط§ط®طھظٹط§ط± ظƒظ„ظ…ط© ظ…ط±ظˆط± ط¬ط¯ظٹط¯ط©</Text>
        <Text style={styles.description}>ط£ظ†ط´ط¦ ظƒظ„ظ…ط© ظ…ط±ظˆط± ظ‚ظˆظٹط© ظ„ط§ طھظ‚ظ„ ط¹ظ† 8 ط£ط­ط±ظپ.</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={(value) => { setPassword(value); setError(null); }}
          placeholder="ظƒظ„ظ…ط© ط§ظ„ظ…ط±ظˆط± ط§ظ„ط¬ط¯ظٹط¯ط©"
          placeholderTextColor={colors.textSecondary}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="new-password"
          textContentType="newPassword"
          editable={!loading}
        />
        <TextInput
          style={styles.input}
          value={confirmation}
          onChangeText={(value) => { setConfirmation(value); setError(null); }}
          placeholder="طھط£ظƒظٹط¯ ظƒظ„ظ…ط© ط§ظ„ظ…ط±ظˆط±"
          placeholderTextColor={colors.textSecondary}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="new-password"
          textContentType="newPassword"
          editable={!loading}
        />
        {error && <Text style={styles.error}>{error}</Text>}
        <TouchableOpacity
          style={[styles.button, loading && styles.disabled]}
          onPress={() => void updatePassword()}
          disabled={loading}
          accessibilityRole="button"
        >
          {loading
            ? <ActivityIndicator color={colors.background} />
            : <Text style={styles.buttonText}>ط­ظپط¸ ظƒظ„ظ…ط© ط§ظ„ظ…ط±ظˆط±</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', backgroundColor: colors.background, padding: 20 },
  card: { padding: 22, borderRadius: 24, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  icon: { width: 48, height: 48, borderRadius: 16, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  title: { color: colors.text, fontSize: 20, fontFamily: fonts.bold, textAlign: 'right' },
  description: { color: colors.textSecondary, fontSize: 13, textAlign: 'right', lineHeight: 20, marginTop: 8, marginBottom: 18 },
  gateText: { color: colors.textSecondary, fontSize: 14, textAlign: 'center', marginTop: 16, lineHeight: 21 },
  input: { minHeight: 52, borderRadius: 15, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 15, color: colors.text, fontSize: 15, marginBottom: 12, textAlign: 'right' },
  error: { color: colors.danger, fontSize: 13, textAlign: 'right', marginBottom: 10 },
  button: { minHeight: 52, borderRadius: 15, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  disabled: { opacity: 0.5 },
  buttonText: { color: colors.background, fontSize: 15, fontFamily: fonts.bold },
});
