import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft,
  BadgeCheck,
  ImagePlus,
  LockKeyhole,
  MessageCircle,
  Mic,
  Plus,
  Trash2,
  UserCheck,
  UserPlus,
  UserRoundX,
  Users,
} from 'lucide-react-native';
import { supabase, uploadPrivateMedia } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';

const POST_BUCKET = 'wattar-posts';
const IMAGE_LIMIT = 10 * 1024 * 1024;

interface WattarProfile {
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  is_private: boolean;
  is_friend: boolean;
  is_following: boolean;
  is_verified_host?: boolean;
  is_host_program_member?: boolean;
}

interface SocialProgress {
  level: number;
  experience_points: number;
  follower_count: number;
  following_count: number;
}

interface ProfilePost {
  post_id: string;
  user_id: string;
  caption: string;
  media_path: string;
  created_at: string;
  media_url: string;
}

export default function UserProfileScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuthStore();
  const [profile, setProfile] = useState<WattarProfile | null>(null);
  const [progress, setProgress] = useState<SocialProgress | null>(null);
  const [posts, setPosts] = useState<ProfilePost[]>([]);
  const [caption, setCaption] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isOwnProfile = user?.id === id;

  const loadProfile = useCallback(async () => {
    if (!id) {
      setLoading(false);
      setError('رابط الملف الشخصي غير صالح.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { data: profileData, error: profileError } = await supabase.rpc('get_wattar_profile', {
        p_user_id: id,
      });
      if (profileError) throw profileError;
      const profileRow = Array.isArray(profileData) ? profileData[0] : profileData;
      if (!profileRow || typeof profileRow !== 'object') {
        setProfile(null);
        setPosts([]);
        setProgress(null);
        return;
      }

      const [hostResult, hostProgramResult] = await Promise.all([
        supabase
          .from('verified_hosts')
          .select('user_id')
          .eq('user_id', id)
          .eq('status', 'active')
          .maybeSingle(),
        supabase.rpc('is_wattar_host_program_member', { p_user_id: id }),
      ]);
      if (hostResult.error) throw hostResult.error;
      if (hostProgramResult.error) throw hostProgramResult.error;

      const loadedProfile = {
        ...(profileRow as WattarProfile),
        is_verified_host: Boolean(hostResult.data),
        is_host_program_member: hostProgramResult.data === true,
      };
      setProfile(loadedProfile);
      if (loadedProfile.is_private) {
        setPosts([]);
        setProgress(null);
        return;
      }

      const [postsResult, progressResult] = await Promise.all([
        supabase.rpc('list_wattar_profile_posts', { p_user_id: id }),
        supabase.rpc('get_wattar_progress', { p_user_id: id }),
      ]);
      if (postsResult.error) throw postsResult.error;
      if (progressResult.error) throw progressResult.error;

      const postRows = (postsResult.data ?? []) as Omit<ProfilePost, 'media_url'>[];
      const signedPosts = await Promise.all(postRows.map(async (post) => {
        const { data: signedUrl, error: signedUrlError } = await supabase.storage
          .from(POST_BUCKET)
          .createSignedUrl(post.media_path, 3600);
        if (signedUrlError) throw signedUrlError;
        return { ...post, media_url: signedUrl.signedUrl };
      }));
      const progressRow = Array.isArray(progressResult.data)
        ? progressResult.data[0]
        : progressResult.data;
      setPosts(signedPosts);
      setProgress(progressRow && typeof progressRow === 'object'
        ? progressRow as SocialProgress
        : null);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'تعذر تحميل الملف الشخصي.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const sendFriendRequest = async () => {
    if (!profile || busy) return;
    setBusy(true);
    try {
      const { error: requestError } = await supabase.rpc('send_friend_request', {
        p_recipient_id: profile.user_id,
      });
      if (requestError) throw requestError;
      Alert.alert('تم إرسال الطلب', `أرسلنا طلب صداقة إلى @${profile.username}.`);
    } catch (caught: unknown) {
      Alert.alert('تعذر إرسال الطلب', caught instanceof Error ? caught.message : 'حاول مرة أخرى.');
    } finally {
      setBusy(false);
    }
  };

  const openConversation = async () => {
    if (!profile || busy) return;
    setBusy(true);
    try {
      const { data, error: conversationError } = await supabase.rpc('create_private_conversation', {
        p_other_user_id: profile.user_id,
      });
      if (conversationError) throw conversationError;
      if (!data) throw new Error('لم يتم إنشاء المحادثة.');
      router.push(`/messages/${data}`);
    } catch (caught: unknown) {
      Alert.alert('تعذر فتح المحادثة', caught instanceof Error ? caught.message : 'حاول مرة أخرى.');
    } finally {
      setBusy(false);
    }
  };

  const toggleFollow = async () => {
    if (!profile || busy) return;
    const wasFollowing = profile.is_following;
    setBusy(true);
    try {
      const { error: followError } = await supabase.rpc(
        wasFollowing ? 'unfollow_wattar_user' : 'follow_wattar_user',
        { p_user_id: profile.user_id },
      );
      if (followError) throw followError;
      setProfile((current) => current
        ? { ...current, is_following: !wasFollowing }
        : current);
      setProgress((current) => current
        ? { ...current, follower_count: Math.max(0, current.follower_count + (wasFollowing ? -1 : 1)) }
        : current);
    } catch (caught: unknown) {
      Alert.alert('تعذر تحديث المتابعة', caught instanceof Error ? caught.message : 'حاول مرة أخرى.');
    } finally {
      setBusy(false);
    }
  };

  const blockUser = () => {
    if (!profile || busy) return;
    Alert.alert(
      'حظر المستخدم؟',
      'لن تتمكنا من مراسلة أو متابعة بعضكما، وستُلغى طلبات الصداقة المعلّقة والدعوات.',
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'حظر',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              const { error: blockError } = await supabase.rpc('block_wattar_user', {
                p_user_id: profile.user_id,
              });
              if (blockError) throw blockError;
              Alert.alert('تم الحظر', 'لن يظهر لك هذا المستخدم بعد الآن. يمكنك إلغاء الحظر من الإعدادات.');
              router.back();
            } catch (caught: unknown) {
              Alert.alert('تعذر حظر المستخدم', caught instanceof Error ? caught.message : 'حاول مرة أخرى.');
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  const createPost = async () => {
    if (!user?.id || uploading) return;
    setUploading(true);
    let uploadedPath: string | null = null;
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('إذن الصور مطلوب', 'اسمح بالوصول إلى الصور لاختيار صورة للمنشور.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.85,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      const contentType = asset.mimeType ?? 'image/jpeg';
      const extensions: Record<string, string> = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
      };
      const extension = extensions[contentType];
      if (!extension) {
        Alert.alert('صيغة غير مدعومة', 'اختر صورة JPG أو PNG أو WebP.');
        return;
      }
      if (asset.fileSize && asset.fileSize > IMAGE_LIMIT) {
        Alert.alert('حجم الصورة كبير', 'الحد الأقصى للصورة 10 ميغابايت.');
        return;
      }

      uploadedPath = `${user.id}/post-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extension}`;
      await uploadPrivateMedia(asset.uri, POST_BUCKET, uploadedPath, contentType, IMAGE_LIMIT);
      const { error: postError } = await supabase.rpc('create_my_post', {
        p_media_path: uploadedPath,
        p_caption: caption.trim(),
      });
      if (postError) throw postError;
      uploadedPath = null;
      setCaption('');
      await loadProfile();
      Alert.alert('تم نشر الصورة', 'أُضيفت الصورة إلى ملفك الشخصي.');
    } catch (caught: unknown) {
      if (uploadedPath) {
        const { error: cleanupError } = await supabase.storage.from(POST_BUCKET).remove([uploadedPath]);
        if (cleanupError) console.warn('[Wattar] Post upload cleanup failed:', cleanupError.message);
      }
      Alert.alert('تعذر نشر الصورة', caught instanceof Error ? caught.message : 'حاول مرة أخرى.');
    } finally {
      setUploading(false);
    }
  };

  const deletePost = async (post: ProfilePost) => {
    try {
      const { data: mediaPath, error: deleteError } = await supabase.rpc('delete_my_post', {
        p_post_id: post.post_id,
      });
      if (deleteError) throw deleteError;
      if (typeof mediaPath !== 'string') throw new Error('لم يتم إرجاع مسار الصورة');
      const { error: storageError } = await supabase.storage.from(POST_BUCKET).remove([mediaPath]);
      if (storageError) throw storageError;
      await loadProfile();
    } catch (caught: unknown) {
      Alert.alert('تعذر حذف المنشور', caught instanceof Error ? caught.message : 'حاول مرة أخرى.');
    }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} accessibilityLabel="رجوع">
          <ArrowLeft size={20} color={palette.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>الملف الشخصي</Text>
      </View>

      {loading ? (
        <View style={styles.state}><ActivityIndicator color={palette.primary} /></View>
      ) : error ? (
        <View style={styles.state}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={() => void loadProfile()}><Text style={styles.retryText}>إعادة المحاولة</Text></TouchableOpacity>
        </View>
      ) : !profile ? (
        <View style={styles.state}><Text style={styles.mutedText}>هذا الحساب غير متاح.</Text></View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.profileCard}>
            <View style={styles.avatar}>
              {profile.avatar_url
                ? <Image source={{ uri: profile.avatar_url }} style={styles.avatarImage} />
                : <Text style={styles.avatarInitial}>{(profile.display_name || profile.username).slice(0, 1).toUpperCase()}</Text>}
            </View>
            <Text style={styles.displayName}>{profile.display_name || profile.username}</Text>
            <Text style={styles.username}>@{profile.username}</Text>
            {profile.is_verified_host && (
              <View style={styles.hostBadge}>
                <BadgeCheck size={13} color={palette.gold} />
                <Text style={styles.hostBadgeText}>حساب موثّق</Text>
              </View>
            )}
            {profile.is_host_program_member && (
              <View style={[styles.hostBadge, styles.hostProgramBadge]}>
                <Mic size={13} color={palette.primary} />
                <Text style={styles.hostProgramBadgeText}>عضوة برنامج المضيفات</Text>
              </View>
            )}
            {!isOwnProfile && (
              <TouchableOpacity style={styles.messageButton} onPress={() => void openConversation()} disabled={busy}>
                {busy ? <ActivityIndicator size="small" color={palette.text} /> : <MessageCircle size={16} color={palette.text} />}
                <Text style={styles.primaryButtonText}>مراسلة</Text>
              </TouchableOpacity>
            )}
            {!profile.is_private && profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}
            {profile.is_private ? (
              <View style={styles.privateNotice}>
                <LockKeyhole size={17} color={palette.gold} />
                <Text style={styles.privateText}>هذا الملف مقيّد الخصوصية</Text>
              </View>
            ) : (
              <>
                <View style={styles.stats}>
                  <Users size={16} color={palette.primary} />
                  <Text style={styles.statsText}>{progress?.follower_count ?? 0} متابع · {progress?.following_count ?? 0} يتابع</Text>
                </View>
                {!isOwnProfile && (
                  <View style={styles.actions}>
                    {!profile.is_friend && (
                      <TouchableOpacity style={styles.secondaryButton} onPress={() => void sendFriendRequest()} disabled={busy}>
                        <UserPlus size={16} color={palette.text} />
                        <Text style={styles.secondaryButtonText}>إضافة صديق</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity style={styles.primaryButton} onPress={() => void toggleFollow()} disabled={busy}>
                      {busy
                        ? <ActivityIndicator size="small" color={palette.text} />
                        : profile.is_following
                          ? <UserCheck size={16} color={palette.text} />
                          : <UserPlus size={16} color={palette.text} />}
                      <Text style={styles.primaryButtonText}>{profile.is_following ? 'إلغاء المتابعة' : 'متابعة'}</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </>
            )}
            {!isOwnProfile && (
              <TouchableOpacity
                style={styles.blockButton}
                onPress={blockUser}
                disabled={busy}
                accessibilityLabel="حظر المستخدم"
              >
                <UserRoundX size={15} color={palette.danger} />
                <Text style={styles.blockButtonText}>حظر المستخدم</Text>
              </TouchableOpacity>
            )}
          </View>

          {profile.is_private ? (
            <View style={styles.emptyCard}>
              <LockKeyhole size={27} color={palette.gold} />
              <Text style={styles.emptyTitle}>الصور غير متاحة</Text>
              <Text style={styles.mutedText}>قد تكون متاحة للأصدقاء فقط. أرسل طلب صداقة إن كان صاحب الملف يعرفك.</Text>
              {!profile.is_friend && !isOwnProfile && (
                <TouchableOpacity style={styles.primaryButton} onPress={() => void sendFriendRequest()} disabled={busy}>
                  <UserPlus size={16} color={palette.text} />
                  <Text style={styles.primaryButtonText}>إرسال طلب صداقة</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <>
              {isOwnProfile && (
                <View style={styles.createCard}>
                  <Text style={styles.sectionTitle}>شارك صورة</Text>
                  <TextInput
                    style={styles.captionInput}
                    value={caption}
                    onChangeText={setCaption}
                    placeholder="اكتب تعليقًا (اختياري)"
                    placeholderTextColor={palette.muted}
                    maxLength={500}
                    multiline
                    textAlign="right"
                  />
                  <TouchableOpacity style={styles.primaryButton} onPress={() => void createPost()} disabled={uploading}>
                    {uploading ? <ActivityIndicator size="small" color={palette.text} /> : <Plus size={17} color={palette.text} />}
                    <Text style={styles.primaryButtonText}>{uploading ? 'جارٍ النشر...' : 'نشر صورة'}</Text>
                    <ImagePlus size={17} color={palette.text} />
                  </TouchableOpacity>
                  <Text style={styles.limitText}>صور JPG أو PNG أو WebP، حتى 10 ميغابايت. الحد اليومي 10 منشورات.</Text>
                </View>
              )}
              <Text style={styles.sectionTitle}>المنشورات</Text>
              {posts.length ? posts.map((post) => (
                <View key={post.post_id} style={styles.postCard}>
                  <Image source={{ uri: post.media_url }} style={styles.postImage} resizeMode="cover" />
                  <View style={styles.postFooter}>
                    <Text style={styles.postDate}>{new Date(post.created_at).toLocaleDateString('ar')}</Text>
                    {isOwnProfile && (
                      <TouchableOpacity onPress={() => void deletePost(post)} accessibilityLabel="حذف المنشور">
                        <Trash2 size={17} color={palette.danger} />
                      </TouchableOpacity>
                    )}
                  </View>
                  {post.caption ? <Text style={styles.postCaption}>{post.caption}</Text> : null}
                </View>
              )) : (
                <View style={styles.emptyCard}>
                  <ImagePlus size={27} color={palette.primary} />
                  <Text style={styles.emptyTitle}>لا توجد منشورات بعد</Text>
                  <Text style={styles.mutedText}>{isOwnProfile ? 'شارك أول صورة من ملفك.' : 'لم يشارك هذا المستخدم صورًا بعد.'}</Text>
                </View>
              )}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const palette = {
  background: '#090611',
  surface: '#171128',
  elevated: '#211638',
  border: '#352449',
  text: '#F8F3FF',
  muted: '#B2A6C3',
  primary: '#B44BFF',
  gold: '#F4BD55',
  danger: '#FF718E',
} as const;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background },
  header: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  backButton: { position: 'absolute', left: 16, padding: 8 },
  headerTitle: { color: palette.text, fontSize: 19, fontWeight: '800' },
  content: { paddingHorizontal: 18, paddingBottom: 36 },
  state: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  profileCard: {
    alignItems: 'center',
    padding: 22,
    borderRadius: 23,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
  },
  avatar: {
    width: 94,
    height: 94,
    borderRadius: 47,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.elevated,
    borderWidth: 2,
    borderColor: palette.primary,
    overflow: 'hidden',
  },
  avatarImage: { width: '100%', height: '100%' },
  avatarInitial: { color: palette.gold, fontSize: 32, fontWeight: '900' },
  displayName: { color: palette.text, fontSize: 22, fontWeight: '900', marginTop: 13 },
  username: { color: palette.muted, fontSize: 13, marginTop: 3 },
  hostBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 9, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 99, backgroundColor: '#F4BD5518', borderWidth: 1, borderColor: '#F4BD5533' },
  hostBadgeText: { color: palette.gold, fontSize: 11, fontWeight: '800' },
  hostProgramBadge: { backgroundColor: '#292044', borderColor: '#62428A' },
  hostProgramBadgeText: { color: palette.primary, fontSize: 11, fontWeight: '800' },
  bio: { color: palette.text, fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 12 },
  privateNotice: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 13 },
  privateText: { color: palette.gold, fontSize: 13, fontWeight: '700' },
  stats: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 15 },
  statsText: { color: palette.muted, fontSize: 12 },
  actions: { flexDirection: 'row', gap: 9, marginTop: 17 },
  messageButton: { minHeight: 43, marginTop: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 15, borderRadius: 13, backgroundColor: palette.primary },
  primaryButton: {
    minHeight: 43,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 15,
    borderRadius: 13,
    backgroundColor: palette.primary,
  },
  primaryButtonText: { color: palette.text, fontSize: 13, fontWeight: '800' },
  secondaryButton: {
    minHeight: 43,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 15,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.elevated,
  },
  secondaryButtonText: { color: palette.text, fontSize: 13, fontWeight: '700' },
  blockButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 16,
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: '#FF718E55',
    backgroundColor: '#FF718E14',
  },
  blockButtonText: { color: palette.danger, fontSize: 12, fontWeight: '700' },
  sectionTitle: { color: palette.text, fontSize: 16, fontWeight: '800', textAlign: 'right', marginTop: 22, marginBottom: 12 },
  createCard: { marginTop: 18, padding: 15, borderRadius: 18, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  captionInput: {
    minHeight: 48,
    maxHeight: 110,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: palette.background,
    color: palette.text,
    fontSize: 13,
    marginBottom: 11,
  },
  limitText: { color: palette.muted, fontSize: 10, lineHeight: 16, textAlign: 'right', marginTop: 8 },
  postCard: { overflow: 'hidden', borderRadius: 18, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, marginBottom: 14 },
  postImage: { width: '100%', aspectRatio: 1, backgroundColor: palette.elevated },
  postFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 13, paddingTop: 12 },
  postDate: { color: palette.muted, fontSize: 11 },
  postCaption: { color: palette.text, fontSize: 13, lineHeight: 20, textAlign: 'right', paddingHorizontal: 13, paddingVertical: 10 },
  emptyCard: { alignItems: 'center', gap: 10, padding: 22, borderRadius: 18, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  emptyTitle: { color: palette.text, fontSize: 15, fontWeight: '800' },
  mutedText: { color: palette.muted, fontSize: 12, lineHeight: 19, textAlign: 'center' },
  errorText: { color: palette.danger, fontSize: 13, textAlign: 'center' },
  retryText: { color: palette.primary, fontSize: 13, fontWeight: '800' },
});
