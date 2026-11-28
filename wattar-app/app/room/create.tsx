/**
 * Wattar App â€” طµظپط­ط© ط¥ظ†ط´ط§ط، ط؛ط±ظپط© طµظˆطھظٹط© ط¬ط¯ظٹط¯ط©
 */
import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { supabase, callFunction } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { Mic, Lock, Globe } from 'lucide-react-native';
import { colors, fonts } from '@/lib/theme';

export default function CreateRoomScreen() {
  const router = useRouter();
  const { profile } = useAuthStore();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [seatOptions, setSeatOptions] = useState<number[]>([4, 8]);
  const [seatCount, setSeatCount] = useState<number>(8);
  const [isPrivate, setIsPrivate] = useState(false);
  const [password, setPassword] = useState('');
  const [category, setCategory] = useState('chat');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // ط®ظٹط§ط±ط§طھ ط§ظ„ظ…ظ‚ط§ط¹ط¯ ظٹط­ط¯ط¯ظ‡ط§ ط§ظ„ط£ط¯ظ…ظ† (M6.2) â€” ط§ظ„ظ‚ط±ط§ط،ط© ظ…ظ† ط§ظ„ط¥ط¹ط¯ط§ط¯ط§طھ ط§ظ„ط¹ط§ظ…ط©
    supabase
      .from('admin_settings')
      .select('value')
      .eq('key', 'room_seat_options')
      .eq('is_public', true)
      .maybeSingle()
      .then(({ data }: { data: { value: unknown } | null }) => {
        const value = data?.value;
        if (Array.isArray(value)) {
          const options = value
            .map(v => (typeof v === 'number' && Number.isInteger(v) ? v : Number(v)))
            .filter((n, i, arr) => Number.isInteger(n) && n >= 2 && n <= 16 && arr.indexOf(n) === i)
            .sort((a, b) => a - b);
          if (options.length > 0) {
            setSeatOptions(options);
            setSeatCount(current => (options.includes(current) ? current : options[0]));
          }
        }
      });
  }, []);

  const handleCreate = async () => {
    if (loading) return;
    if (!profile?.id) {
      Alert.alert('طھط¹ط°ط± ط¥ظ†ط´ط§ط، ط§ظ„ط؛ط±ظپط©', 'ظ„ظ… ظٹظƒطھظ…ظ„ طھط­ظ…ظٹظ„ ط­ط³ط§ط¨ظƒ. ط£ط¹ط¯ ظپطھط­ ط§ظ„طµظپط­ط© ظˆط­ط§ظˆظ„ ظ…ط±ط© ط£ط®ط±ظ‰.');
      return;
    }
    if (!name.trim()) {
      Alert.alert('طھظ†ط¨ظٹظ‡', 'ط£ط¯ط®ظ„ ط§ط³ظ… ط§ظ„ط؛ط±ظپط©');
      return;
    }
    if (isPrivate && !password) {
      Alert.alert('طھظ†ط¨ظٹظ‡', 'ط£ط¯ط®ظ„ ظƒظ„ظ…ط© ظ…ط±ظˆط± ظ„ظ„ط؛ط±ظپط© ط§ظ„ط®ط§طµط©');
      return;
    }

    setLoading(true);
    try {
      // M6.6: ط§ظ„ط¥ظ†ط´ط§ط، ط¹ط¨ط± ط¯ط§ظ„ط© ط®ط§ط¯ظ…ظٹط© â€” ظƒظ„ظ…ط© ط§ظ„ظ…ط±ظˆط± طھظڈط®ط²ظژظ‘ظ† ظ…ط´ظپط±ط© ظˆظ„ط§ طھظڈط±ط³ظ„ ظ†طµط§ظ‹ طµط±ظٹط­ط§ظ‹ ظ„ظ„ظ‚ط§ط¹ط¯ط©
      const { data: roomId, error } = await supabase.rpc('create_wattar_room', {
        p_name: name.trim(),
        p_description: description.trim() || null,
        p_seat_count: seatCount,
        p_is_private: isPrivate,
        p_password: isPrivate ? password : null,
        p_category: category,
      });

      if (error) throw error;
      router.replace(`/room/${roomId}`);
    } catch (err: any) {
      Alert.alert('ط®ط·ط£', err.message);
    } finally {
      setLoading(false);
    }
  };

  const categories = [
    { id: 'chat', label: 'ط¯ط±ط¯ط´ط©', icon: 'ًں’¬' },
    { id: 'music', label: 'ظ…ظˆط³ظٹظ‚ظ‰', icon: 'ًںژµ' },
    { id: 'games', label: 'ط£ظ„ط¹ط§ط¨', icon: 'ًںژ®' },
    { id: 'serious', label: 'ط¬ط§ط¯', icon: 'ًں§ ' },
    { id: 'sleep', label: 'ظ†ظˆظ…', icon: 'ًںک´' },
  ];

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>ط¥ظ†ط´ط§ط، ط؛ط±ظپط© ط¬ط¯ظٹط¯ط©</Text>
        <Text style={styles.subtitle}>ط£ظ†ط´ط¦ ط؛ط±ظپطھظƒ ظˆط§ط¯ط¹ظˆ ط£طµط¯ظ‚ط§ط،ظƒ</Text>
      </View>

      <View style={styles.formCard}>
        <Text style={styles.label}>ط§ط³ظ… ط§ظ„ط؛ط±ظپط© *</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="ظ…ط«ط§ظ„: ط¬ظ„ط³ط© ظ…ط³ط§ط¦ظٹط©"
          placeholderTextColor={colors.textMuted}
          maxLength={100}
        />

        <Text style={styles.label}>ط§ظ„ظˆطµظپ (ط§ط®طھظٹط§ط±ظٹ)</Text>
        <TextInput
          style={[styles.input, styles.textarea]}
          value={description}
          onChangeText={setDescription}
          placeholder="ط¹ظ† ظ…ط§ط°ط§ ط§ظ„ط؛ط±ظپط©طں"
          placeholderTextColor={colors.textMuted}
          multiline
          numberOfLines={3}
          maxLength={200}
        />

        <Text style={styles.label}>ط¹ط¯ط¯ ط§ظ„ظ…ظ‚ط§ط¹ط¯</Text>
        <View style={styles.seatsRow}>
          {seatOptions.map(n => (
            <TouchableOpacity
              key={n}
              style={[styles.seatBtn, seatCount === n && styles.seatBtnActive]}
              onPress={() => setSeatCount(n)}
            >
              <Mic size={18} color={seatCount === n ? colors.text : colors.textMuted} />
              <Text style={[styles.seatText, seatCount === n && styles.seatTextActive]}>{n} ظ…ظ‚ط§ط¹ط¯</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>ط§ظ„طھطµظ†ظٹظپ</Text>
        <View style={styles.categoriesRow}>
          {categories.map(c => (
            <TouchableOpacity
              key={c.id}
              style={[styles.catBtn, category === c.id && styles.catBtnActive]}
              onPress={() => setCategory(c.id)}
            >
              <Text style={styles.catIcon}>{c.icon}</Text>
              <Text style={[styles.catText, category === c.id && styles.catTextActive]}>{c.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>ظ†ظˆط¹ ط§ظ„ط؛ط±ظپط©</Text>
        <View style={styles.typeRow}>
          <TouchableOpacity
            style={[styles.typeBtn, !isPrivate && styles.typeBtnActive]}
            onPress={() => setIsPrivate(false)}
          >
            <Globe size={18} color={!isPrivate ? colors.text : colors.textMuted} />
            <Text style={[styles.typeText, !isPrivate && styles.typeTextActive]}>ط¹ط§ظ…ط©</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.typeBtn, isPrivate && styles.typeBtnActive]}
            onPress={() => setIsPrivate(true)}
          >
            <Lock size={18} color={isPrivate ? colors.text : colors.textMuted} />
            <Text style={[styles.typeText, isPrivate && styles.typeTextActive]}>ط®ط§طµط©</Text>
          </TouchableOpacity>
        </View>

        {isPrivate && (
          <>
            <Text style={styles.label}>ظƒظ„ظ…ط© ط§ظ„ظ…ط±ظˆط±</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="â€¢â€¢â€¢â€¢"
              placeholderTextColor={colors.textMuted}
              secureTextEntry
            />
          </>
        )}

        <TouchableOpacity
          style={[styles.createButton, loading && styles.createButtonDisabled]}
          onPress={handleCreate}
          disabled={loading}
        >
          <Text style={styles.createButtonText}>
            {loading ? 'ط¬ط§ط±ظٹ ط§ظ„ط¥ظ†ط´ط§ط،...' : 'ط¥ظ†ط´ط§ط، ط§ظ„ط؛ط±ظپط©'}
          </Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { padding: 16, paddingTop: 60, paddingBottom: 24 },
  title: { color: colors.text, fontSize: 24, fontFamily: fonts.bold },
  subtitle: { color: colors.textSecondary, fontSize: 14, marginTop: 4 },
  formCard: { padding: 16, gap: 12 },
  label: { color: colors.textSecondary, fontSize: 13, marginBottom: 4 },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 15,
  },
  textarea: { minHeight: 70, textAlignVertical: 'top' },
  seatsRow: { flexDirection: 'row', gap: 8 },
  seatBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  seatBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  seatText: { color: colors.textSecondary, fontSize: 14 },
  seatTextActive: { color: colors.text, fontFamily: fonts.semibold },
  categoriesRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  catBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  catBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  catIcon: { fontSize: 14 },
  catText: { color: colors.textSecondary, fontSize: 12 },
  catTextActive: { color: colors.text },
  typeRow: { flexDirection: 'row', gap: 8 },
  typeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  typeBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  typeText: { color: colors.textSecondary, fontSize: 14 },
  typeTextActive: { color: colors.text, fontFamily: fonts.semibold },
  createButton: {
    backgroundColor: colors.primary,
    height: 52,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  createButtonDisabled: { opacity: 0.5 },
  createButtonText: { color: colors.text, fontSize: 16, fontFamily: fonts.bold },
});
