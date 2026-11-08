/**
 * Wattar App — صفحة إنشاء غرفة صوتية جديدة
 */
import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { supabase, callFunction } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { Mic, Lock, Globe } from 'lucide-react-native';
import { colors } from '@/lib/theme';

export default function CreateRoomScreen() {
  const router = useRouter();
  const { profile } = useAuthStore();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [seatCount, setSeatCount] = useState<4 | 8>(8);
  const [isPrivate, setIsPrivate] = useState(false);
  const [password, setPassword] = useState('');
  const [category, setCategory] = useState('chat');
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (loading) return;
    if (!profile?.id) {
      Alert.alert('تعذر إنشاء الغرفة', 'لم يكتمل تحميل حسابك. أعد فتح الصفحة وحاول مرة أخرى.');
      return;
    }
    if (!name.trim()) {
      Alert.alert('تنبيه', 'أدخل اسم الغرفة');
      return;
    }
    if (isPrivate && !password) {
      Alert.alert('تنبيه', 'أدخل كلمة مرور للغرفة الخاصة');
      return;
    }

    setLoading(true);
    try {
      // إنشاء غرفة LiveKit (هذا يتطلب LiveKit API server-side)
      // للتبسيط ننشئ معرفًا عشوائيًا
      const livekitRoomId = `wattar_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      const { data, error } = await supabase
        .from('rooms')
        .insert({
          name: name.trim(),
          description: description.trim() || null,
          owner_id: profile.id,
          seat_count: seatCount,
          is_private: isPrivate,
          password: isPrivate ? password : null,
          livekit_room_id: livekitRoomId,
          status: 'waiting',
          category,
        })
        .select()
        .single();

      if (error) throw error;
      router.replace(`/room/${data.id}`);
    } catch (err: any) {
      Alert.alert('خطأ', err.message);
    } finally {
      setLoading(false);
    }
  };

  const categories = [
    { id: 'chat', label: 'دردشة', icon: '💬' },
    { id: 'music', label: 'موسيقى', icon: '🎵' },
    { id: 'games', label: 'ألعاب', icon: '🎮' },
    { id: 'serious', label: 'جاد', icon: '🧠' },
    { id: 'sleep', label: 'نوم', icon: '😴' },
  ];

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>إنشاء غرفة جديدة</Text>
        <Text style={styles.subtitle}>أنشئ غرفتك وادعو أصدقاءك</Text>
      </View>

      <View style={styles.formCard}>
        <Text style={styles.label}>اسم الغرفة *</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="مثال: جلسة مسائية"
          placeholderTextColor="#666"
          maxLength={100}
        />

        <Text style={styles.label}>الوصف (اختياري)</Text>
        <TextInput
          style={[styles.input, styles.textarea]}
          value={description}
          onChangeText={setDescription}
          placeholder="عن ماذا الغرفة؟"
          placeholderTextColor="#666"
          multiline
          numberOfLines={3}
          maxLength={200}
        />

        <Text style={styles.label}>عدد المقاعد</Text>
        <View style={styles.seatsRow}>
          {[4, 8].map(n => (
            <TouchableOpacity
              key={n}
              style={[styles.seatBtn, seatCount === n && styles.seatBtnActive]}
              onPress={() => setSeatCount(n as 4 | 8)}
            >
              <Mic size={18} color={seatCount === n ? '#fff' : '#9CA3AF'} />
              <Text style={[styles.seatText, seatCount === n && styles.seatTextActive]}>{n} مقاعد</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>التصنيف</Text>
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

        <Text style={styles.label}>نوع الغرفة</Text>
        <View style={styles.typeRow}>
          <TouchableOpacity
            style={[styles.typeBtn, !isPrivate && styles.typeBtnActive]}
            onPress={() => setIsPrivate(false)}
          >
            <Globe size={18} color={!isPrivate ? '#fff' : '#9CA3AF'} />
            <Text style={[styles.typeText, !isPrivate && styles.typeTextActive]}>عامة</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.typeBtn, isPrivate && styles.typeBtnActive]}
            onPress={() => setIsPrivate(true)}
          >
            <Lock size={18} color={isPrivate ? '#fff' : '#9CA3AF'} />
            <Text style={[styles.typeText, isPrivate && styles.typeTextActive]}>خاصة</Text>
          </TouchableOpacity>
        </View>

        {isPrivate && (
          <>
            <Text style={styles.label}>كلمة المرور</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="••••"
              placeholderTextColor="#666"
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
            {loading ? 'جاري الإنشاء...' : 'إنشاء الغرفة'}
          </Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { padding: 16, paddingTop: 60, paddingBottom: 24 },
  title: { color: colors.text, fontSize: 24, fontWeight: 'bold' },
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
  seatTextActive: { color: '#fff', fontWeight: '600' },
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
  catTextActive: { color: '#fff' },
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
  typeTextActive: { color: '#fff', fontWeight: '600' },
  createButton: {
    backgroundColor: colors.primary,
    height: 52,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  createButtonDisabled: { opacity: 0.5 },
  createButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
});
