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
import { colors, fonts } from '@/lib/theme';

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
      Alert.alert('طھط¹ط°ط± ظپطھط­ ط§ظ„طµظˆط±', error instanceof Error ? error.message : 'ط­ط§ظˆظ„ ظ…ط±ط© ط£ط®ط±ظ‰.');
    }
  };

  const save = async () => {
    const normalizedUsername = username.trim().toLowerCase();
    const normalizedDisplayName = displayName.trim();
    const normalizedBio = bio.trim();

    if (!USERNAME_PATTERN.test(normalizedUsername)) {
      Alert.alert('ط§ط³ظ… ظ…ط³طھط®ط¯ظ… ط؛ظٹط± طµط§ظ„ط­', 'ط§ط³طھط®ط¯ظ… 3 ط¥ظ„ظ‰ 30 ط­ط±ظپظ‹ط§ ط£ظˆ ط±ظ‚ظ…ظ‹ط§ ط£ظˆ ط´ط±ط·ط© ط³ظپظ„ظٹط© ظپظ‚ط·.');
      return;
    }
    if (normalizedDisplayName.length > 80) {
      Alert.alert('ط§ظ„ط§ط³ظ… ط·ظˆظٹظ„', 'ظٹط¬ط¨ ط£ظ„ط§ ظٹطھط¬ط§ظˆط² ط§ظ„ط§ط³ظ… 80 ط­ط±ظپظ‹ط§.');
      return;
    }
    if (normalizedBio.length > 160) {
      Alert.alert('ط§ظ„ظ†ط¨ط°ط© ط·ظˆظٹظ„ط©', 'ظٹط¬ط¨ ط£ظ„ط§ طھطھط¬ط§ظˆط² ط§ظ„ظ†ط¨ط°ط© 160 ط­ط±ظپظ‹ط§.');
      return;
    }
    if (!user?.id) {
      Alert.alert('طھط¹ط°ط± ط§ظ„ط­ظپط¸', 'ط§ظ†طھظ‡طھ ط¬ظ„ط³ط© طھط³ط¬ظٹظ„ ط§ظ„ط¯ط®ظˆظ„. ط³ط¬ظ‘ظ„ ط§ظ„ط¯ط®ظˆظ„ ظ…ط¬ط¯ط¯ظ‹ط§.');
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
        'طھط¹ط°ط± ط­ظپط¸ ط§ظ„ظ…ظ„ظپ ط§ظ„ط´ط®طµظٹ',
        error instanceof Error ? error.message : 'طھط­ظ‚ظ‚ ظ…ظ† ط§طھطµط§ظ„ ط§ظ„ط¥ظ†طھط±ظ†طھ ظˆط­ط§ظˆظ„ ظ…ط¬ط¯ط¯ظ‹ط§.',
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
            accessibilityLabel="ط±ط¬ظˆط¹"
          >
            <ChevronRight size={22} color={colors.textSecondary} />
          </TouchableOpacity>
          <Text style={styles.title}>طھط¹ط¯ظٹظ„ ط§ظ„ظ…ظ„ظپ ط§ظ„ط´ط®طµظٹ</Text>
        </View>

        <TouchableOpacity
          style={styles.avatarPicker}
          onPress={pickAvatar}
          disabled={saving}
          accessibilityRole="button"
          accessibilityLabel="ط§ط®طھظٹط§ط± طµظˆط±ط© ط´ط®طµظٹط©"
        >
          <View style={styles.avatar}>
            {displayedAvatar ? (
              <Image source={{ uri: displayedAvatar }} style={styles.avatarImage} />
            ) : (
              <User size={38} color={colors.primary} />
            )}
          </View>
          <View style={styles.cameraBadge}><Camera size={16} color={colors.text} /></View>
          <Text style={styles.avatarHint}>طھط؛ظٹظٹط± ط§ظ„طµظˆط±ط©</Text>
        </TouchableOpacity>

        <View style={styles.form}>
          <Text style={styles.label}>ط§ظ„ط§ط³ظ… ط§ظ„ط¸ط§ظ‡ط±</Text>
          <TextInput
            style={styles.input}
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="ط§ظƒطھط¨ ط§ظ„ط§ط³ظ… ط§ظ„ط°ظٹ ظٹط¸ظ‡ط± ظ„ظ„ط¢ط®ط±ظٹظ†"
            placeholderTextColor={colors.textSecondary}
            maxLength={80}
            editable={!saving}
            returnKeyType="next"
          />

          <Text style={styles.label}>ط§ط³ظ… ط§ظ„ظ…ط³طھط®ط¯ظ…</Text>
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
          <Text style={styles.helper}>3 ط¥ظ„ظ‰ 30 ط­ط±ظپظ‹ط§طŒ ط£ط±ظ‚ط§ظ… ط£ظˆ ط´ط±ط·ط© ط³ظپظ„ظٹط©.</Text>

          <Text style={styles.label}>ظ†ط¨ط°ط© ط¹ظ†ظƒ</Text>
          <TextInput
            style={[styles.input, styles.bioInput]}
            value={bio}
            onChangeText={setBio}
            placeholder="ط§ظƒطھط¨ ظ†ط¨ط°ط© ظ‚طµظٹط±ط© ط¹ظ†ظƒ"
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
            <ActivityIndicator color={colors.text} />
          ) : (
            <>
              <Save size={18} color={colors.text} />
              <Text style={styles.saveText}>ط­ظپط¸ ط§ظ„طھط؛ظٹظٹط±ط§طھ</Text>
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
  title: { color: colors.text, fontSize: 19, fontFamily: fonts.semibold },
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
  avatarHint: { color: colors.primary, fontSize: 13, fontFamily: fonts.semibold, marginTop: 12 },
  form: { gap: 9 },
  label: { color: colors.text, fontSize: 14, fontFamily: fonts.semibold, marginTop: 8 },
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
  saveText: { color: colors.text, fontSize: 15, fontFamily: fonts.semibold },
});
