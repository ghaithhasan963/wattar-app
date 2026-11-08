import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { Camera, ChevronRight, Save, User } from 'lucide-react-native';
import { useAuthStore } from '@/store/auth';
import { uploadImage } from '@/lib/supabase';
import { colors } from '@/lib/theme';

const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,30}$/;

export default function EditProfileScreen() {
  const router = useRouter();
  const { profile, user, updateProfile } = useAuthStore();
  const [username, setUsername] = useState(profile?.username ?? '');
  const [displayName, setDisplayName] = useState(profile?.display_name ?? '');
  const [bio, setBio] = useState(profile?.bio ?? '');
  const [avatarUri, setAvatarUri] = useState<string | null>(profile?.avatar_url ?? null);
  const [localAvatarUri, setLocalAvatarUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setUsername(profile?.username ?? '');
    setDisplayName(profile?.display_name ?? '');
    setBio(profile?.bio ?? '');
    setAvatarUri(profile?.avatar_url ?? null);
  }, [profile]);

  const pickAvatar = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      if (!result.canceled) {
        setLocalAvatarUri(result.assets[0].uri);
      }
    } catch (error: unknown) {
      Alert.alert('تعذر فتح الصور', error instanceof Error ? error.message : 'حاول مرة أخرى.');
    }
  };

  const save = async () => {
    const normalizedUsername = username.trim().toLowerCase();
    const normalizedDisplayName = displayName.trim();
    const normalizedBio = bio.trim();

    if (!USERNAME_PATTERN.test(normalizedUsername)) {
      Alert.alert('اسم مستخدم غير صالح', 'استخدم 3 إلى 30 حرفًا أو رقمًا أو شرطة سفلية فقط.');
      return;
    }
    if (normalizedDisplayName.length > 80) {
      Alert.alert('الاسم طويل', 'يجب ألا يتجاوز الاسم 80 حرفًا.');
      return;
    }
    if (normalizedBio.length > 160) {
      Alert.alert('النبذة طويلة', 'يجب ألا تتجاوز النبذة 160 حرفًا.');
      return;
    }
    if (!user?.id) {
      Alert.alert('تعذر الحفظ', 'انتهت جلسة تسجيل الدخول. سجّل الدخول مجددًا.');
      return;
    }

    setSaving(true);
    try {
      let nextAvatarUrl = avatarUri;
      if (localAvatarUri) {
        nextAvatarUrl = await uploadImage(localAvatarUri, 'avatars', `${user.id}/avatar`);
      }

      await updateProfile({
        username: normalizedUsername,
        displayName: normalizedDisplayName,
        bio: normalizedBio,
        avatarUrl: nextAvatarUrl,
      });
      router.back();
    } catch (error: unknown) {
      Alert.alert(
        'تعذر حفظ الملف الشخصي',
        error instanceof Error ? error.message : 'تحقق من اتصال الإنترنت وحاول مجددًا.',
      );
    } finally {
      setSaving(false);
    }
  };

  const displayedAvatar = localAvatarUri ?? avatarUri;

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="رجوع"
          >
            <ChevronRight size={22} color={colors.textSecondary} />
          </TouchableOpacity>
          <Text style={styles.title}>تعديل الملف الشخصي</Text>
        </View>

        <TouchableOpacity
          style={styles.avatarPicker}
          onPress={pickAvatar}
          disabled={saving}
          accessibilityRole="button"
          accessibilityLabel="اختيار صورة شخصية"
        >
          <View style={styles.avatar}>
            {displayedAvatar ? (
              <Image source={{ uri: displayedAvatar }} style={styles.avatarImage} />
            ) : (
              <User size={38} color={colors.primary} />
            )}
          </View>
          <View style={styles.cameraBadge}><Camera size={16} color="#FFFFFF" /></View>
          <Text style={styles.avatarHint}>تغيير الصورة</Text>
        </TouchableOpacity>

        <View style={styles.form}>
          <Text style={styles.label}>الاسم الظاهر</Text>
          <TextInput
            style={styles.input}
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="اكتب الاسم الذي يظهر للآخرين"
            placeholderTextColor={colors.textSecondary}
            maxLength={80}
            editable={!saving}
            returnKeyType="next"
          />

          <Text style={styles.label}>اسم المستخدم</Text>
          <TextInput
            style={styles.input}
            value={username}
            onChangeText={(value) => setUsername(value.replace(/\s/g, '').toLowerCase())}
            placeholder="username"
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={30}
            editable={!saving}
            returnKeyType="next"
          />
          <Text style={styles.helper}>3 إلى 30 حرفًا، أرقام أو شرطة سفلية.</Text>

          <Text style={styles.label}>نبذة عنك</Text>
          <TextInput
            style={[styles.input, styles.bioInput]}
            value={bio}
            onChangeText={setBio}
            placeholder="اكتب نبذة قصيرة عنك"
            placeholderTextColor={colors.textSecondary}
            multiline
            maxLength={160}
            editable={!saving}
            textAlignVertical="top"
          />
          <Text style={styles.counter}>{bio.length}/160</Text>
        </View>

        <TouchableOpacity
          style={[styles.saveButton, saving && styles.disabledButton]}
          onPress={save}
          disabled={saving}
          accessibilityRole="button"
        >
          {saving ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <>
              <Save size={18} color="#FFFFFF" />
              <Text style={styles.saveText}>حفظ التغييرات</Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, paddingHorizontal: 20, paddingBottom: 32 },
  header: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: Platform.OS === 'android' ? 8 : 24,
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { color: colors.text, fontSize: 19, fontWeight: '700' },
  avatarPicker: { alignItems: 'center', marginTop: 22, marginBottom: 28 },
  avatar: {
    width: 104,
    height: 104,
    borderRadius: 52,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
    borderWidth: 2,
    borderColor: colors.primary,
    overflow: 'hidden',
  },
  avatarImage: { width: '100%', height: '100%' },
  cameraBadge: {
    position: 'absolute',
    top: 72,
    left: '50%',
    marginLeft: 26,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.background,
  },
  avatarHint: { color: colors.primary, fontSize: 13, fontWeight: '600', marginTop: 12 },
  form: { gap: 9 },
  label: { color: colors.text, fontSize: 14, fontWeight: '600', marginTop: 8 },
  input: {
    minHeight: 50,
    color: colors.text,
    fontSize: 15,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
  },
  helper: { color: colors.textSecondary, fontSize: 12, marginTop: -3 },
  bioInput: { minHeight: 112, paddingTop: 13 },
  counter: { color: colors.textSecondary, fontSize: 12, textAlign: 'left', marginTop: -4 },
  saveButton: {
    minHeight: 52,
    marginTop: 28,
    borderRadius: 15,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 9,
  },
  disabledButton: { opacity: 0.7 },
  saveText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});
