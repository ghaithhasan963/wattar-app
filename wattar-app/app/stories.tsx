import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { VideoView, useVideoPlayer } from 'expo-video';
import { ArrowLeft, CirclePlay, ImagePlus, Plus, Trash2, Video } from 'lucide-react-native';
import { colors, fonts } from '@/lib/theme';
import { supabase, uploadPrivateMedia } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';

const STORY_BUCKET = 'wattar-stories';
const IMAGE_LIMIT = 10 * 1024 * 1024;
const VIDEO_LIMIT = 20 * 1024 * 1024;

interface Story {
  story_id: string;
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  caption: string;
  media_path: string;
  media_type: 'image' | 'video';
  created_at: string;
  expires_at: string;
  media_url: string;
}

export default function StoriesScreen() {
  const router = useRouter();
  const { profile, user } = useAuthStore();
  const [stories, setStories] = useState<Story[]>([]);
  const [caption, setCaption] = useState('');
  const [selectedStory, setSelectedStory] = useState<Story | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStories = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: storiesError } = await supabase.rpc('list_active_stories');
      if (storiesError) throw storiesError;

      const activeStories = (data ?? []) as Omit<Story, 'media_url'>[];
      const signedStories = await Promise.all(activeStories.map(async (story) => {
        const remainingSeconds = Math.floor((new Date(story.expires_at).getTime() - Date.now()) / 1000);
        if (remainingSeconds <= 0) return null;
        const { data: signedUrl, error: signedUrlError } = await supabase.storage
          .from(STORY_BUCKET)
          .createSignedUrl(story.media_path, Math.min(3600, remainingSeconds));
        if (signedUrlError) throw signedUrlError;
        return { ...story, media_url: signedUrl.signedUrl };
      }));
      setStories(signedStories.filter((story): story is Story => story !== null));
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'طھط¹ط°ط± طھط­ظ…ظٹظ„ ط§ظ„ظ‚طµطµ.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStories();
  }, [loadStories]);

  const createStory = async () => {
    if (!user?.id || uploading) return;
    setUploading(true);
    let uploadedPath: string | null = null;
    let storyCreated = false;
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('ط¥ط°ظ† ط§ظ„طµظˆط± ظ…ط·ظ„ظˆط¨', 'ط§ط³ظ…ط­ ط¨ط§ظ„ظˆطµظˆظ„ ط¥ظ„ظ‰ ط§ظ„طµظˆط± ظˆط§ظ„ظپظٹط¯ظٹظˆظ‡ط§طھ ظ„ط§ط®طھظٹط§ط± ظ‚طµط©.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.All,
        allowsEditing: false,
        quality: 0.8,
        videoMaxDuration: 30,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      const isVideo = asset.type === 'video' || asset.mimeType?.startsWith('video/') === true;
      const mediaType: Story['media_type'] = isVideo ? 'video' : 'image';
      const contentType = asset.mimeType ?? (isVideo ? 'video/mp4' : 'image/jpeg');
      const extensions: Record<string, string> = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
        'video/mp4': 'mp4',
        'video/quicktime': 'mov',
      };
      const extension = extensions[contentType];
      if (!extension) {
        Alert.alert('طµظٹط؛ط© ط؛ظٹط± ظ…ط¯ط¹ظˆظ…ط©', 'ط§ط®طھط± طµظˆط±ط© JPG ط£ظˆ PNG ط£ظˆ WebPطŒ ط£ظˆ ظپظٹط¯ظٹظˆ MP4 ط£ظˆ MOV.');
        return;
      }
      if (asset.fileSize && asset.fileSize > (isVideo ? VIDEO_LIMIT : IMAGE_LIMIT)) {
        Alert.alert('ط­ط¬ظ… ط§ظ„ظ…ظ„ظپ ظƒط¨ظٹط±', isVideo ? 'ط§ظ„ط­ط¯ ط§ظ„ط£ظ‚طµظ‰ ظ„ظ„ظپظٹط¯ظٹظˆ 20 ظ…ظٹط؛ط§ط¨ط§ظٹطھ.' : 'ط§ظ„ط­ط¯ ط§ظ„ط£ظ‚طµظ‰ ظ„ظ„طµظˆط±ط© 10 ظ…ظٹط؛ط§ط¨ط§ظٹطھ.');
        return;
      }

      const fileId = `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
      uploadedPath = `${user.id}/story-${fileId}.${extension}`;
      await uploadPrivateMedia(
        asset.uri,
        STORY_BUCKET,
        uploadedPath,
        contentType,
        isVideo ? VIDEO_LIMIT : IMAGE_LIMIT,
      );

      const { error: createError } = await supabase.rpc('create_my_story', {
        p_media_path: uploadedPath,
        p_media_type: mediaType,
        p_caption: caption.trim(),
      });
      if (createError) throw createError;
      storyCreated = true;
      uploadedPath = null;
      setCaption('');
      await loadStories();
      Alert.alert('طھظ… ظ†ط´ط± ط§ظ„ظ‚طµط©', 'ط³طھط¨ظ‚ظ‰ ظ‚طµطھظƒ ظ…طھط§ط­ط© ظ„ظ…ط¯ط© 24 ط³ط§ط¹ط©.');
    } catch (caught: unknown) {
      if (uploadedPath && !storyCreated) {
        const { error: cleanupError } = await supabase.storage.from(STORY_BUCKET).remove([uploadedPath]);
        if (cleanupError) console.warn('[Wattar] Story upload cleanup failed:', cleanupError.message);
      }
      Alert.alert('طھط¹ط°ط± ظ†ط´ط± ط§ظ„ظ‚طµط©', caught instanceof Error ? caught.message : 'ط­ط§ظˆظ„ ظ…ط±ط© ط£ط®ط±ظ‰.');
    } finally {
      setUploading(false);
    }
  };

  const deleteStory = async (story: Story) => {
    try {
      const { data: mediaPath, error: deleteError } = await supabase.rpc('delete_my_story', {
        p_story_id: story.story_id,
      });
      if (deleteError) throw deleteError;
      if (typeof mediaPath !== 'string') throw new Error('ظ„ظ… ظٹطھظ… ط¥ط±ط¬ط§ط¹ ظ…ط³ط§ط± ظ…ظ„ظپ ط§ظ„ظ‚طµط©');
      const { error: storageError } = await supabase.storage.from(STORY_BUCKET).remove([mediaPath]);
      if (storageError) throw storageError;
      setSelectedStory(null);
      await loadStories();
    } catch (caught: unknown) {
      Alert.alert('طھط¹ط°ط± ط­ط°ظپ ط§ظ„ظ‚طµط©', caught instanceof Error ? caught.message : 'ط­ط§ظˆظ„ ظ…ط±ط© ط£ط®ط±ظ‰.');
    }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerButton} accessibilityLabel="ط±ط¬ظˆط¹">
          <ArrowLeft size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>ظ‚طµطµ ط§ظ„ظ…ط¬طھظ…ط¹</Text>
      </View>

      <View style={styles.createCard}>
        <View style={styles.createCopy}>
          <Text style={styles.createTitle}>ط´ط§ط±ظƒ ظ„ط­ط¸طھظƒ</Text>
          <Text style={styles.createDescription}>طµظˆط±ط© ط£ظˆ ظپظٹط¯ظٹظˆ ط­طھظ‰ 30 ط«ط§ظ†ظٹط©. طھط®طھظپظٹ ط§ظ„ظ‚طµط© ط¨ط¹ط¯ 24 ط³ط§ط¹ط©.</Text>
        </View>
        <TextInput
          style={styles.captionInput}
          value={caption}
          onChangeText={setCaption}
          placeholder="ط£ط¶ظپ طھط¹ظ„ظٹظ‚ظ‹ط§ (ط§ط®طھظٹط§ط±ظٹ)"
          placeholderTextColor={colors.textSecondary}
          maxLength={160}
          textAlign="right"
        />
        <TouchableOpacity style={styles.createButton} onPress={createStory} disabled={uploading}>
          {uploading ? <ActivityIndicator color={colors.background} /> : <Plus size={19} color={colors.background} />}
          <Text style={styles.createButtonText}>{uploading ? 'ط¬ط§ط±ظٹ ط§ظ„ظ†ط´ط±...' : 'ط§ط®طھظٹط§ط± طµظˆط±ط© ط£ظˆ ظپظٹط¯ظٹظˆ'}</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionTitle}>ط§ظ„ظ‚طµطµ ط§ظ„ظ†ط´ط·ط©</Text>
      {loading ? (
        <View style={styles.state}><ActivityIndicator color={colors.primary} /></View>
      ) : error ? (
        <View style={styles.state}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={() => void loadStories()}><Text style={styles.retryText}>ط¥ط¹ط§ط¯ط© ط§ظ„ظ…ط­ط§ظˆظ„ط©</Text></TouchableOpacity>
        </View>
      ) : stories.length === 0 ? (
        <View style={styles.empty}>
          <CirclePlay size={30} color={colors.primary} />
          <Text style={styles.emptyTitle}>ظ„ط§ طھظˆط¬ط¯ ظ‚طµطµ ظ†ط´ط·ط© ط¨ط¹ط¯</Text>
          <Text style={styles.emptyDescription}>ط§ظ†ط´ط± ط£ظˆظ„ ظ‚طµط© ظ„طھط¨ط¯ط£ ط§ظ„ظ…ط´ط§ط±ظƒط© ظ…ط¹ ط§ظ„ظ…ط¬طھظ…ط¹.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.storyList}>
          {stories.map((story) => (
            <TouchableOpacity key={story.story_id} style={styles.storyCard} onPress={() => setSelectedStory(story)}>
              <View style={styles.avatarRing}>
                {story.avatar_url
                  ? <Image source={{ uri: story.avatar_url }} style={styles.avatar} />
                  : <View style={[styles.avatar, styles.avatarPlaceholder]}><Text style={styles.avatarInitial}>{(story.display_name ?? story.username).slice(0, 1)}</Text></View>}
              </View>
              <View style={styles.storyCopy}>
                <Text style={styles.storyName} numberOfLines={1}>{story.display_name || story.username}</Text>
                <Text style={styles.storyCaption} numberOfLines={2}>{story.caption || 'ط´ط§ط±ظƒ ظ‚طµط© ط¬ط¯ظٹط¯ط©'}</Text>
                <Text style={styles.storyExpiry}>طھظ†طھظ‡ظٹ {new Date(story.expires_at).toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' })}</Text>
              </View>
              {story.media_type === 'video'
                ? <Video size={18} color={colors.primary} />
                : <ImagePlus size={18} color={colors.primary} />}
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      <Modal visible={selectedStory !== null} transparent animationType="fade" onRequestClose={() => setSelectedStory(null)}>
        {selectedStory && (
          <View style={styles.viewer}>
            <View style={styles.viewerHeader}>
              <View style={styles.viewerUser}>
                <Text style={styles.viewerName}>{selectedStory.display_name || selectedStory.username}</Text>
                <Text style={styles.viewerExpiry}>طھظ†طھظ‡ظٹ {new Date(selectedStory.expires_at).toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' })}</Text>
              </View>
              {selectedStory.user_id === user?.id && (
                <TouchableOpacity onPress={() => void deleteStory(selectedStory)} style={styles.viewerAction} accessibilityLabel="ط­ط°ظپ ط§ظ„ظ‚طµط©">
                  <Trash2 size={19} color={colors.text} />
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={() => setSelectedStory(null)} style={styles.viewerAction} accessibilityLabel="ط¥ط؛ظ„ط§ظ‚ ط§ظ„ظ‚طµط©">
                <ArrowLeft size={19} color={colors.text} />
              </TouchableOpacity>
            </View>
            <View style={styles.mediaFrame}>
              <StoryMedia key={selectedStory.story_id} story={selectedStory} />
            </View>
            {selectedStory.caption ? <Text style={styles.viewerCaption}>{selectedStory.caption}</Text> : null}
          </View>
        )}
      </Modal>
    </View>
  );
}

function StoryMedia({ story }: { story: Story }) {
  if (story.media_type === 'image') {
    return <Image source={{ uri: story.media_url }} style={styles.media} resizeMode="contain" />;
  }
  return <StoryVideo uri={story.media_url} />;
}

function StoryVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (videoPlayer) => {
    videoPlayer.loop = false;
    videoPlayer.play();
  });
  return <VideoView player={player} style={styles.media} contentFit="contain" nativeControls />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, paddingTop: 54 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, marginBottom: 18 },
  headerButton: { position: 'absolute', left: 16, padding: 8 },
  title: { color: colors.text, fontSize: 20, fontFamily: fonts.bold },
  createCard: { marginHorizontal: 18, padding: 16, borderRadius: 22, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  createCopy: { gap: 5, marginBottom: 13 },
  createTitle: { color: colors.text, fontSize: 16, fontFamily: fonts.bold, textAlign: 'right' },
  createDescription: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, textAlign: 'right' },
  captionInput: { minHeight: 46, paddingHorizontal: 13, borderRadius: 13, color: colors.text, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
  createButton: { minHeight: 48, borderRadius: 14, marginTop: 12, backgroundColor: colors.gold, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  createButtonText: { color: colors.background, fontSize: 13, fontFamily: fonts.bold },
  sectionTitle: { color: colors.text, fontSize: 16, fontFamily: fonts.bold, textAlign: 'right', marginHorizontal: 20, marginTop: 24, marginBottom: 12 },
  storyList: { paddingHorizontal: 16, paddingBottom: 24, gap: 10 },
  storyCard: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  avatarRing: { width: 48, height: 48, borderRadius: 24, padding: 2, borderWidth: 2, borderColor: colors.primary },
  avatar: { width: '100%', height: '100%', borderRadius: 24 },
  avatarPlaceholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
  avatarInitial: { color: colors.text, fontSize: 18, fontFamily: fonts.bold },
  storyCopy: { flex: 1, gap: 3 },
  storyName: { color: colors.text, fontSize: 13, fontFamily: fonts.bold, textAlign: 'right' },
  storyCaption: { color: colors.textSecondary, fontSize: 12, textAlign: 'right' },
  storyExpiry: { color: colors.gold, fontSize: 10, textAlign: 'right' },
  state: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  errorText: { color: colors.danger, textAlign: 'center', fontSize: 13 },
  retryText: { color: colors.primary, fontFamily: fonts.semibold },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 10 },
  emptyTitle: { color: colors.text, fontSize: 15, fontFamily: fonts.bold },
  emptyDescription: { color: colors.textSecondary, fontSize: 12, textAlign: 'center', lineHeight: 19 },
  viewer: { flex: 1, backgroundColor: colors.backgroundDeep, paddingTop: 54, paddingHorizontal: 12, paddingBottom: 24 },
  viewerHeader: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 10 },
  viewerUser: { flex: 1, gap: 3 },
  viewerName: { color: colors.text, fontSize: 14, fontFamily: fonts.bold, textAlign: 'right' },
  viewerExpiry: { color: colors.textSecondary, fontSize: 11, textAlign: 'right' },
  viewerAction: { padding: 10 },
  mediaFrame: { flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  media: { width: '100%', height: '100%' },
  viewerCaption: { color: colors.text, fontSize: 14, textAlign: 'center', paddingVertical: 16 },
});
