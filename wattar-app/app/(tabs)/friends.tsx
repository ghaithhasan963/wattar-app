import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Keyboard,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Dices, MessageCircle, MoreHorizontal, Search, UserCheck, UserPlus, Users } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { notifySocialEvent } from '@/lib/notifications';
import { colors } from '@/lib/theme';

interface PublicUser {
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  bio?: string | null;
  is_online: boolean;
}

interface FriendRequest extends PublicUser {
  request_id: string;
  direction: 'incoming' | 'outgoing';
  status: string;
  created_at: string;
}

interface PrivateConversation extends PublicUser {
  conversation_id: string;
  last_message: string | null;
  last_message_at: string | null;
  unread_count: number;
}

interface RoomInvitation {
  invitation_id: string;
  room_id: string;
  room_name: string;
  sender_id: string;
  sender_name: string;
  sender_avatar: string | null;
  created_at: string;
}

interface DiceChallenge {
  challenge_id: string;
  game_type: string;
  max_players: 2 | 4;
  challenge_status: 'pending' | 'ready' | 'playing' | 'completed' | 'cancelled';
  my_status: 'pending' | 'accepted' | 'declined';
  my_roll: number | null;
  winner_id: string | null;
  created_at: string;
  participants: Array<{
    user_id: string;
    display_name: string;
    status: string;
    dice_roll: number | null;
  }>;
}

type SocialTab = 'friends' | 'following' | 'messages' | 'requests' | 'invites' | 'challenges';
type SocialSection = 'network' | 'inbox' | 'play';

const socialPalette = {
  background: '#090611',
  surface: '#171128',
  elevated: '#211638',
  border: '#352449',
  text: '#F8F3FF',
  muted: '#B2A6C3',
  primary: '#B44BFF',
  primaryDeep: '#7624D7',
  gold: '#F4BD55',
  online: '#43D69A',
} as const;

function formatRelativeTime(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const diffMinutes = Math.floor((Date.now() - date.getTime()) / 60000);
  if (diffMinutes < 1) return 'الآن';
  if (diffMinutes < 60) return `قبل ${diffMinutes} د`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `قبل ${diffHours} س`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `قبل ${diffDays} ي`;
  return date.toLocaleDateString('ar', { day: 'numeric', month: 'short' });
}

function SectionHeading({ text, count }: { text: string; count?: number }) {
  return (
    <View style={styles.sectionHeading}>
      <Text style={styles.sectionHeadingText}>{text}</Text>
      {typeof count === 'number' ? <Text style={styles.sectionHeadingCount}>{count}</Text> : null}
    </View>
  );
}

export default function FriendsScreen() {
  const router = useRouter();
  const currentUserId = useAuthStore((state) => state.user?.id);
  const [activeTab, setActiveTab] = useState<SocialTab>('friends');
  const [activeSection, setActiveSection] = useState<SocialSection>('network');
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PublicUser[]>([]);
  const [friends, setFriends] = useState<PublicUser[]>([]);
  const [following, setFollowing] = useState<PublicUser[]>([]);
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [conversations, setConversations] = useState<PrivateConversation[]>([]);
  const [invitations, setInvitations] = useState<RoomInvitation[]>([]);
  const [challenges, setChallenges] = useState<DiceChallenge[]>([]);
  const [challengePlayers, setChallengePlayers] = useState<2 | 4>(2);
  const [selectedOpponents, setSelectedOpponents] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadSocialData = useCallback(async () => {
    setLoading(true);
    try {
      const [friendsResult, requestsResult, conversationsResult, invitesResult, challengesResult, followingResult] = await Promise.all([
        supabase.rpc('list_my_friends'),
        supabase.rpc('list_my_friend_requests'),
        supabase.rpc('list_my_private_conversations'),
        supabase.rpc('list_my_room_invitations'),
        supabase.rpc('list_my_dice_challenges'),
        supabase.rpc('list_my_following'),
      ]);
      const firstError = friendsResult.error ?? requestsResult.error
        ?? conversationsResult.error ?? invitesResult.error ?? challengesResult.error ?? followingResult.error;
      if (firstError) throw firstError;
      setFriends((friendsResult.data ?? []) as PublicUser[]);
      setRequests((requestsResult.data ?? []) as FriendRequest[]);
      setConversations((conversationsResult.data ?? []) as PrivateConversation[]);
      setInvitations((invitesResult.data ?? []) as RoomInvitation[]);
      setChallenges((challengesResult.data ?? []) as DiceChallenge[]);
      setFollowing((followingResult.data ?? []) as PublicUser[]);
    } catch (error: unknown) {
      Alert.alert(
        'تعذر تحميل المجتمع',
        error instanceof Error ? error.message : 'تحقق من اتصال الإنترنت وحاول مجددًا.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSocialData();
  }, [loadSocialData]);

  useEffect(() => {
    const channel = supabase
      .channel('social-challenge-updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friend_requests' }, () => {
        loadSocialData().catch((error: unknown) => {
          console.error('[Wattar] Failed to refresh friend requests:', error);
        });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_invitations' }, () => {
        loadSocialData().catch((error: unknown) => {
          console.error('[Wattar] Failed to refresh room invitations:', error);
        });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_challenges' }, () => {
        loadSocialData().catch((error: unknown) => {
          console.error('[Wattar] Failed to refresh challenges:', error);
        });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_challenge_players' }, () => {
        loadSocialData().catch((error: unknown) => {
          console.error('[Wattar] Failed to refresh challenge participants:', error);
        });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [loadSocialData]);

  const searchUsers = async () => {
    Keyboard.dismiss();
    const term = query.trim();
    if (term.length < 2) {
      setSearchResults([]);
      setHasSearched(false);
      return;
    }
    setSearching(true);
    try {
      const { data, error } = await supabase.rpc('search_wattar_users', { p_query: term });
      if (error) throw error;
      setSearchResults((data ?? []) as PublicUser[]);
      setHasSearched(true);
    } catch (error: unknown) {
      Alert.alert(
        'تعذر البحث',
        error instanceof Error ? error.message : 'حاول مرة أخرى بعد قليل.',
      );
    } finally {
      setSearching(false);
    }
  };

  const sendRequest = async (target: PublicUser) => {
    setBusyId(target.user_id);
    try {
      const { data, error } = await supabase.rpc('send_friend_request', {
        p_recipient_id: target.user_id,
      });
      if (error) throw error;
      if (typeof data !== 'string') throw new Error('لم يتم إنشاء طلب الصداقة');
      void notifySocialEvent('friend_request', data).catch((notificationError: unknown) => {
        console.warn('[Wattar] Friend request push failed:', notificationError);
      });
      Alert.alert('تم إرسال الطلب', `أرسلنا طلب صداقة إلى ${target.display_name || target.username}.`);
      setSearchResults((items) => items.filter((item) => item.user_id !== target.user_id));
      await loadSocialData();
    } catch (error: unknown) {
      Alert.alert('تعذر إرسال الطلب', error instanceof Error ? error.message : 'حاول مرة أخرى.');
    } finally {
      setBusyId(null);
    }
  };

  const respondToRequest = async (request: FriendRequest, accept: boolean) => {
    setBusyId(request.request_id);
    try {
      const { error } = await supabase.rpc('respond_friend_request', {
        p_request_id: request.request_id,
        p_accept: accept,
      });
      if (error) throw error;
      if (accept) {
        void notifySocialEvent('friend_accepted', request.request_id).catch((notificationError: unknown) => {
          console.warn('[Wattar] Friend acceptance push failed:', notificationError);
        });
      }
      await loadSocialData();
    } catch (error: unknown) {
      Alert.alert('تعذر تحديث الطلب', error instanceof Error ? error.message : 'حاول مرة أخرى.');
    } finally {
      setBusyId(null);
    }
  };

  const openConversation = async (friend: PublicUser) => {
    setBusyId(friend.user_id);
    try {
      const { data, error } = await supabase.rpc('create_private_conversation', {
        p_other_user_id: friend.user_id,
      });
      if (error) throw error;
      if (!data) throw new Error('لم يتم إنشاء المحادثة');
      router.push(`/messages/${data}`);
    } catch (error: unknown) {
      Alert.alert('تعذر فتح المحادثة', error instanceof Error ? error.message : 'حاول مرة أخرى.');
    } finally {
      setBusyId(null);
    }
  };

  const toggleFollow = async (person: PublicUser) => {
    const isFollowing = following.some((item) => item.user_id === person.user_id);
    setBusyId(person.user_id);
    try {
      const { error } = await supabase.rpc(
        isFollowing ? 'unfollow_wattar_user' : 'follow_wattar_user',
        { p_user_id: person.user_id },
      );
      if (error) throw error;
      if (!isFollowing) {
        void notifySocialEvent('new_follower', person.user_id).catch((notificationError: unknown) => {
          console.warn('[Wattar] New follower push failed:', notificationError);
        });
      }
      setFollowing((current) => isFollowing
        ? current.filter((item) => item.user_id !== person.user_id)
        : [person, ...current]);
    } catch (error: unknown) {
      Alert.alert(
        isFollowing ? 'تعذر إلغاء المتابعة' : 'تعذرت المتابعة',
        error instanceof Error ? error.message : 'حاول مرة أخرى.',
      );
    } finally {
      setBusyId(null);
    }
  };

  const respondToInvitation = async (invitation: RoomInvitation, accept: boolean) => {
    setBusyId(invitation.invitation_id);
    try {
      const { data, error } = await supabase.rpc('respond_room_invitation', {
        p_invitation_id: invitation.invitation_id,
        p_accept: accept,
      });
      if (error) throw error;
      await loadSocialData();
      if (accept && data) router.push(`/room/${data}`);
    } catch (error: unknown) {
      Alert.alert('تعذر معالجة الدعوة', error instanceof Error ? error.message : 'حاول مرة أخرى.');
    } finally {
      setBusyId(null);
    }
  };

  const toggleOpponent = (userId: string) => {
    setSelectedOpponents((current) => current.includes(userId)
      ? current.filter((id) => id !== userId)
      : current.length < challengePlayers - 1 ? [...current, userId] : current);
  };

  const createChallenge = async () => {
    if (selectedOpponents.length !== challengePlayers - 1) {
      Alert.alert('اختر اللاعبين', challengePlayers === 2
        ? 'اختر صديقًا واحدًا للتحدي الثنائي.'
        : 'اختر ثلاثة أصدقاء للتحدي الرباعي.');
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('create_dice_challenge', {
        p_opponent_ids: selectedOpponents,
        p_max_players: challengePlayers,
      });
      if (error) throw error;
      if (typeof data !== 'string') throw new Error('لم يتم إنشاء التحدي');
      void notifySocialEvent('dice_challenge', data).catch((notificationError: unknown) => {
        console.warn('[Wattar] Dice challenge push failed:', notificationError);
      });
      setSelectedOpponents([]);
      Alert.alert('تم إرسال التحدي', 'التحدي مجاني ولا يستخدم رصيد الذهب.');
      await loadSocialData();
    } catch (error: unknown) {
      Alert.alert('تعذر إنشاء التحدي', error instanceof Error ? error.message : 'حاول مرة أخرى.');
    } finally {
      setLoading(false);
    }
  };

  const respondToChallenge = async (challenge: DiceChallenge, accept: boolean) => {
    setBusyId(challenge.challenge_id);
    try {
      const { error } = await supabase.rpc('respond_dice_challenge', {
        p_challenge_id: challenge.challenge_id,
        p_accept: accept,
      });
      if (error) throw error;
      await loadSocialData();
    } catch (error: unknown) {
      Alert.alert('تعذر تحديث التحدي', error instanceof Error ? error.message : 'حاول مرة أخرى.');
    } finally {
      setBusyId(null);
    }
  };

  const rollChallenge = async (challenge: DiceChallenge) => {
    setBusyId(challenge.challenge_id);
    try {
      const { error } = await supabase.rpc('roll_dice_challenge', {
        p_challenge_id: challenge.challenge_id,
      });
      if (error) throw error;
      await loadSocialData();
    } catch (error: unknown) {
      Alert.alert('تعذر رمي النرد', error instanceof Error ? error.message : 'حاول مرة أخرى.');
    } finally {
      setBusyId(null);
    }
  };

  const moderateUser = (person: PublicUser) => {
    Alert.alert(person.display_name || person.username, 'إدارة تفاعلك مع هذا المستخدم', [
      {
        text: 'إبلاغ',
        onPress: () => {
          Alert.alert('إرسال بلاغ', 'هل تريد الإبلاغ عن هذا الحساب بسبب سلوك غير مناسب؟', [
            { text: 'إلغاء', style: 'cancel' },
            {
              text: 'إرسال البلاغ',
              onPress: async () => {
                const { error } = await supabase.rpc('report_wattar_user', {
                  p_user_id: person.user_id,
                  p_reason: 'سلوك غير مناسب',
                });
                if (error) Alert.alert('تعذر إرسال البلاغ', error.message);
                else Alert.alert('تم استلام البلاغ', 'سيراجعه فريق Wattar.');
              },
            },
          ]);
        },
      },
      {
        text: 'حظر',
        style: 'destructive',
        onPress: () => Alert.alert('حظر المستخدم؟', 'لن تتمكنوا من مراسلة أو دعوة بعضكما.', [
          { text: 'إلغاء', style: 'cancel' },
          {
            text: 'حظر',
            style: 'destructive',
            onPress: async () => {
              const { error } = await supabase.rpc('block_wattar_user', { p_user_id: person.user_id });
              if (error) Alert.alert('تعذر حظر المستخدم', error.message);
              else await loadSocialData();
            },
          },
        ]),
      },
      { text: 'إلغاء', style: 'cancel' },
    ]);
  };

  const incomingRequestCount = requests.filter((request) => request.direction === 'incoming').length;
  const unreadMessageCount = conversations.reduce((total, conversation) => total + conversation.unread_count, 0);
  const sectionTabs: { key: SocialSection; label: string; count?: number }[] = [
    { key: 'network', label: 'شبكتي', count: friends.length },
    { key: 'inbox', label: 'الوارد', count: incomingRequestCount + invitations.length + unreadMessageCount },
    { key: 'play', label: 'التحديات' },
  ];
  const tabs: { key: SocialTab; label: string; count?: number }[] = activeSection === 'network'
    ? [
      { key: 'friends', label: 'أصدقائي', count: friends.length },
      { key: 'following', label: 'أتابع', count: following.length },
    ]
    : activeSection === 'inbox'
      ? [
        { key: 'messages', label: 'الرسائل', count: unreadMessageCount },
        { key: 'requests', label: 'طلبات الصداقة', count: incomingRequestCount },
        { key: 'invites', label: 'دعوات الغرف', count: invitations.length },
      ]
      : [{ key: 'challenges', label: 'تحديات النرد' }];

  const selectSection = (section: SocialSection) => {
    setActiveSection(section);
    setActiveTab(section === 'network' ? 'friends' : section === 'inbox' ? 'messages' : 'challenges');
    setQuery('');
    setSearchResults([]);
    setHasSearched(false);
    Keyboard.dismiss();
  };

  const activeTabLabel = tabs.find((tab) => tab.key === activeTab)?.label ?? '';
  const sectionDescription = activeSection === 'network'
    ? 'اكتشف أصدقاءك وتابع الحسابات التي تهمك.'
    : activeSection === 'inbox'
      ? 'رسائلك وطلبات التواصل ودعوات الغرف في مكان واحد.'
      : 'تحديات مجانية مع أصدقائك، بعيدًا عن أرصدة المحفظة.';

  const renderUser = (person: PublicUser, action: 'add' | 'message' | 'follow') => {
    const isFollowing = following.some((item) => item.user_id === person.user_id);
    return (
    <View key={person.user_id} style={styles.personRow}>
      <View style={styles.avatar}>
        {person.avatar_url
          ? <Image source={{ uri: person.avatar_url }} style={styles.avatarImage} />
          : <Text style={styles.avatarText}>{(person.display_name || person.username).slice(0, 1).toUpperCase()}</Text>}
      </View>
      <View style={styles.personDetails}>
        <TouchableOpacity
          onPress={() => router.push(`/user/${person.user_id}`)}
          accessibilityRole="button"
          accessibilityLabel={`عرض ملف ${person.display_name || person.username}`}
        >
          <Text style={styles.personName}>{person.display_name || person.username}</Text>
          <Text style={styles.personMeta}>
            @{person.username} · {person.is_online ? 'متصل الآن' : 'غير متصل'}
          </Text>
        </TouchableOpacity>
      </View>
      <TouchableOpacity
        style={styles.actionButton}
        onPress={() => action === 'add'
          ? sendRequest(person)
          : action === 'message'
            ? openConversation(person)
            : toggleFollow(person)}
        disabled={busyId === person.user_id}
        accessibilityRole="button"
        accessibilityLabel={action === 'add' ? 'إضافة صديق' : 'إرسال رسالة'}
      >
        {busyId === person.user_id
          ? <ActivityIndicator size="small" color={socialPalette.primary} />
          : action === 'add'
            ? <UserPlus size={16} color={socialPalette.primary} />
            : action === 'message'
              ? <MessageCircle size={16} color={socialPalette.primary} />
              : <UserCheck size={16} color={isFollowing ? socialPalette.gold : socialPalette.primary} />}
        <Text style={styles.actionLabel}>
          {action === 'add' ? 'إضافة' : action === 'message' ? 'مراسلة' : isFollowing ? 'متابَع' : 'متابعة'}
        </Text>
      </TouchableOpacity>
      {action === 'add' ? (
        <TouchableOpacity
          style={styles.followButton}
          onPress={() => toggleFollow(person)}
          disabled={busyId === person.user_id}
          accessibilityRole="button"
          accessibilityLabel={isFollowing ? 'إلغاء المتابعة' : 'متابعة المستخدم'}
        >
          {isFollowing
            ? <UserCheck size={16} color={socialPalette.gold} />
            : <UserPlus size={16} color={socialPalette.primary} />}
        </TouchableOpacity>
      ) : null}
      <TouchableOpacity
        style={styles.moreButton}
        onPress={() => moderateUser(person)}
        accessibilityRole="button"
        accessibilityLabel="خيارات الحظر والإبلاغ"
      >
        <MoreHorizontal size={19} color={socialPalette.muted} />
      </TouchableOpacity>
    </View>
    );
  };

  const renderContent = () => {
    if (activeTab === 'challenges') {
      return (
          <View>
            <View style={styles.challengeCreateCard}>
              <View style={styles.challengeHeading}>
                <Dices size={19} color={socialPalette.gold} />
                <Text style={styles.challengeTitle}>تحدٍ اجتماعي مجاني</Text>
              </View>
              <Text style={styles.challengeDescription}>النرد يدار على الخادم؛ لا يستخدم الذهب أو أي رصيد مالي.</Text>
              <View style={styles.playerCountRow}>
                {([2, 4] as const).map((count) => (
                  <TouchableOpacity
                    key={count}
                    style={[styles.playerCountButton, challengePlayers === count && styles.playerCountButtonActive]}
                    onPress={() => { setChallengePlayers(count); setSelectedOpponents([]); }}
                  >
                    <Text style={[styles.playerCountText, challengePlayers === count && styles.playerCountTextActive]}>
                      {count} لاعبين
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {friends.map((friend) => {
                const selected = selectedOpponents.includes(friend.user_id);
                return (
                  <TouchableOpacity
                    key={friend.user_id}
                    style={styles.opponentRow}
                    onPress={() => toggleOpponent(friend.user_id)}
                    disabled={!selected && selectedOpponents.length >= challengePlayers - 1}
                  >
                    <Text style={styles.personName}>{friend.display_name || friend.username}</Text>
                    <View style={[styles.checkbox, selected && styles.checkboxActive]}>
                      {selected && <Text style={styles.checkboxCheck}>✓</Text>}
                    </View>
                  </TouchableOpacity>
                );
              })}
              <TouchableOpacity
                style={[styles.createChallengeButton, (loading || !friends.length) && styles.disabledAction]}
                onPress={createChallenge}
                disabled={loading || !friends.length}
              >
                <Text style={styles.createChallengeText}>إرسال التحدي</Text>
              </TouchableOpacity>
            </View>
            {challenges.filter((challenge) => challenge.challenge_status !== 'cancelled').map((challenge) => (
              <View key={challenge.challenge_id} style={styles.challengeCard}>
                <View style={styles.challengeHeading}>
                  <Dices size={18} color={socialPalette.gold} />
                  <Text style={styles.challengeTitle}>{challenge.max_players} لاعبين · نرد</Text>
                </View>
                {challenge.participants.map((participant) => (
                  <View key={participant.user_id} style={styles.challengeParticipant}>
                    <Text style={styles.personMeta}>
                      {participant.display_name}{participant.user_id === challenge.winner_id ? ' · الفائز' : ''}
                    </Text>
                    <Text style={styles.challengeScore}>
                      {challenge.challenge_status === 'completed'
                        ? participant.dice_roll ?? 'تعادل'
                        : participant.status === 'accepted' && participant.user_id === currentUserId
                          ? challenge.my_roll ? `رميت ${challenge.my_roll}` : 'دورك'
                          : participant.status === 'pending' ? 'بانتظار القبول' : 'مستعد'}
                    </Text>
                  </View>
                ))}
                {challenge.my_status === 'pending' && challenge.challenge_status === 'pending' ? (
                  <View style={styles.inviteActions}>
                    <TouchableOpacity style={styles.acceptInviteButton} onPress={() => respondToChallenge(challenge, true)} disabled={busyId === challenge.challenge_id}>
                      <Text style={styles.acceptInviteText}>قبول</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.declineInviteButton} onPress={() => respondToChallenge(challenge, false)} disabled={busyId === challenge.challenge_id}>
                      <Text style={styles.declineText}>رفض</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
                {['ready', 'playing'].includes(challenge.challenge_status) && challenge.my_status === 'accepted' && challenge.my_roll === null ? (
                  <TouchableOpacity style={styles.rollButton} onPress={() => rollChallenge(challenge)} disabled={busyId === challenge.challenge_id}>
                    {busyId === challenge.challenge_id ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.acceptInviteText}>ارمِ النرد</Text>}
                  </TouchableOpacity>
                ) : null}
                {challenge.my_roll !== null && challenge.challenge_status !== 'completed' ? (
                  <Text style={styles.challengeDescription}>ظهرت لك {challenge.my_roll} · بانتظار بقية اللاعبين</Text>
                ) : null}
                {challenge.challenge_status === 'completed' ? (
                  <Text style={styles.challengeResult}>
                    {challenge.winner_id ? 'انتهى التحدي! الفائز صاحب أعلى نتيجة.' : 'انتهى التحدي بالتعادل.'}
                  </Text>
                ) : null}
              </View>
            ))}
            {!challenges.length && <EmptyState text="أرسل تحديًا مجانيًا للأصدقاء. التحديات لا تستخدم الذهب." />}
          </View>
      );
    }
    if (activeTab === 'friends') {
      return (
        <View>
          <View style={styles.searchRow}>
            <Search size={18} color={socialPalette.muted} />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="ابحث بالاسم أو اسم المستخدم"
              placeholderTextColor={socialPalette.muted}
              autoCapitalize="none"
              returnKeyType="search"
              onSubmitEditing={searchUsers}
            />
            {query.length > 0 && (
              <TouchableOpacity
                onPress={() => {
                  setQuery('');
                  setSearchResults([]);
                  setHasSearched(false);
                  Keyboard.dismiss();
                }}
                accessibilityRole="button"
                accessibilityLabel="مسح البحث"
              >
                <Text style={styles.clearSearchText}>مسح</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={searchUsers} disabled={searching} style={styles.searchButton}>
              {searching ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={styles.searchButtonText}>بحث</Text>}
            </TouchableOpacity>
          </View>
          {query.trim().length < 2 && (
            <Text style={styles.searchHint}>اكتب اسمًا أو اسم مستخدم من حرفين على الأقل، ثم اضغط بحث.</Text>
          )}
          {searchResults.map((person) => renderUser(person, 'add'))}
          {hasSearched && !searching && searchResults.length === 0 && (
            <EmptyState text="ما لقينا حسابًا مطابقًا. تأكد من الاسم وجرب مرة ثانية." />
          )}
          {searchResults.length > 0 && <View style={styles.divider} />}
          <SectionHeading text="أصدقائي" count={friends.length} />
          {friends.length
            ? friends.map((person) => renderUser(person, 'message'))
            : <EmptyState text="أضف أصدقاء لتبدأ المحادثة وتدعوهم إلى الغرف." />}
        </View>
      );
    }
    if (activeTab === 'messages') {
      const ordered = [...conversations].sort((a, b) => {
        const left = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
        const right = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
        return right - left;
      });
      return (
        <View>
          {ordered.length ? ordered.map((conversation) => (
            <TouchableOpacity
              key={conversation.conversation_id}
              style={[styles.personRow, conversation.unread_count > 0 && styles.unreadRow]}
              onPress={() => router.push(`/messages/${conversation.conversation_id}`)}
              accessibilityRole="button"
              accessibilityLabel={`فتح محادثة ${conversation.display_name || conversation.username}`}
            >
              <View style={styles.avatar}>
                {conversation.avatar_url
                  ? <Image source={{ uri: conversation.avatar_url }} style={styles.avatarImage} />
                  : <Text style={styles.avatarText}>{(conversation.display_name || conversation.username).slice(0, 1).toUpperCase()}</Text>}
                {conversation.is_online ? <View style={styles.onlineDot} /> : null}
              </View>
              <View style={styles.personDetails}>
                <View style={styles.conversationTitleRow}>
                  <Text style={styles.personName} numberOfLines={1}>{conversation.display_name || conversation.username}</Text>
                  <Text style={styles.conversationTime}>{formatRelativeTime(conversation.last_message_at)}</Text>
                </View>
                <Text
                  style={[styles.personMeta, conversation.unread_count > 0 && styles.unreadPreview]}
                  numberOfLines={1}
                >
                  {conversation.last_message || 'ابدأ المحادثة'}
                </Text>
              </View>
              {conversation.unread_count > 0 && (
                <View style={styles.unreadBadge}>
                  <Text style={styles.unreadText}>{conversation.unread_count > 99 ? '99+' : conversation.unread_count}</Text>
                </View>
              )}
            </TouchableOpacity>
          )) : <EmptyState text="لا توجد محادثات بعد. ابدأ محادثة من قائمة الأصدقاء." />}
        </View>
      );
    }
    if (activeTab === 'following') {
      return (
        <View>
          {following.length
            ? following.map((person) => renderUser(person, 'follow'))
            : <EmptyState text="لا تتابع أحدًا بعد. ابحث عن حساب في تبويب الأصدقاء واضغط متابعة." />}
        </View>
      );
    }
    if (activeTab === 'requests') {
      const incoming = requests.filter((request) => request.direction === 'incoming');
      const outgoing = requests.filter((request) => request.direction === 'outgoing');
      return (
        <View>
          {incoming.length ? (
            <View>
              <SectionHeading text="طلبات واردة" count={incoming.length} />
              {incoming.map((request) => (
                <View key={request.request_id} style={styles.personRow}>
                  <View style={styles.avatar}>
                    {request.avatar_url
                      ? <Image source={{ uri: request.avatar_url }} style={styles.avatarImage} />
                      : <Text style={styles.avatarText}>{(request.display_name || request.username).slice(0, 1).toUpperCase()}</Text>}
                  </View>
                  <View style={styles.personDetails}>
                    <TouchableOpacity
                      onPress={() => router.push(`/user/${request.user_id}`)}
                      accessibilityRole="button"
                      accessibilityLabel={`عرض ملف ${request.display_name || request.username}`}
                    >
                      <Text style={styles.personName}>{request.display_name || request.username}</Text>
                      <Text style={styles.personMeta}>@{request.username} أرسل طلب صداقة</Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity style={styles.acceptButton} onPress={() => respondToRequest(request, true)} disabled={busyId === request.request_id} accessibilityLabel="قبول طلب الصداقة">
                    {busyId === request.request_id
                      ? <ActivityIndicator size="small" color="#FFFFFF" />
                      : <UserCheck size={17} color="#FFFFFF" />}
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.declineButton} onPress={() => respondToRequest(request, false)} disabled={busyId === request.request_id} accessibilityLabel="رفض طلب الصداقة">
                    <Text style={styles.declineText}>رفض</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          ) : null}
          {outgoing.length ? (
            <View>
              <SectionHeading text="طلبات مرسلة" count={outgoing.length} />
              {outgoing.map((request) => (
                <View key={request.request_id} style={styles.personRow}>
                  <View style={styles.avatar}>
                    {request.avatar_url
                      ? <Image source={{ uri: request.avatar_url }} style={styles.avatarImage} />
                      : <Text style={styles.avatarText}>{(request.display_name || request.username).slice(0, 1).toUpperCase()}</Text>}
                  </View>
                  <View style={styles.personDetails}>
                    <Text style={styles.personName}>{request.display_name || request.username}</Text>
                    <Text style={styles.personMeta}>@{request.username} · بانتظار الرد</Text>
                  </View>
                  <View style={styles.pendingChip}>
                    <Text style={styles.pendingChipText}>قيد الانتظار</Text>
                  </View>
                </View>
              ))}
            </View>
          ) : null}
          {incoming.length === 0 && outgoing.length === 0
            ? <EmptyState text="ما عندك طلبات صداقة جديدة." />
            : null}
        </View>
      );
    }
    return (
      <View>
        {invitations.length ? invitations.map((invitation) => (
          <View key={invitation.invitation_id} style={styles.invitationCard}>
            <Text style={styles.personName}>{invitation.sender_name} دعاك إلى غرفة</Text>
            <Text style={styles.personMeta}>{invitation.room_name}</Text>
            <View style={styles.inviteActions}>
              <TouchableOpacity style={styles.acceptInviteButton} onPress={() => respondToInvitation(invitation, true)} disabled={busyId === invitation.invitation_id}>
                <Text style={styles.acceptInviteText}>انضمام</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.declineInviteButton} onPress={() => respondToInvitation(invitation, false)} disabled={busyId === invitation.invitation_id}>
                <Text style={styles.declineText}>تجاهل</Text>
              </TouchableOpacity>
            </View>
          </View>
        )) : <EmptyState text="ما عندك دعوات غرف حاليًا." />}
      </View>
    );
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <View style={styles.titleIcon}><Users size={20} color={socialPalette.gold} /></View>
          <View>
            <Text style={styles.title}>المجتمع</Text>
            <Text style={styles.subtitle}>أصدقاؤك ومتابعاتك ومحادثاتك</Text>
          </View>
        </View>
        <TouchableOpacity
          style={styles.agentGroupButton}
          onPress={() => router.push('/agent-group')}
          accessibilityRole="button"
        >
          <Users size={16} color={socialPalette.gold} />
          <Text style={styles.agentGroupButtonText}>مجموعة الوكيل</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.sectionTabs}>
        {sectionTabs.map((section) => (
          <TouchableOpacity
            key={section.key}
            style={[styles.sectionTab, activeSection === section.key && styles.activeSectionTab]}
            onPress={() => selectSection(section.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeSection === section.key }}
          >
            <Text style={[styles.sectionTabText, activeSection === section.key && styles.activeSectionTabText]}>
              {section.label}
            </Text>
            {section.count ? (
              <View style={[styles.sectionCount, activeSection === section.key && styles.activeSectionCount]}>
                <Text style={styles.sectionCountText}>{section.count > 99 ? '99+' : section.count}</Text>
              </View>
            ) : null}
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.subTabs}>
        {tabs.map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.subTab, activeTab === tab.key && styles.activeSubTab]}
            onPress={() => {
              setActiveTab(tab.key);
              setQuery('');
              setSearchResults([]);
              setHasSearched(false);
              Keyboard.dismiss();
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === tab.key }}
          >
            <Text style={[styles.subTabText, activeTab === tab.key && styles.activeSubTabText]}>{tab.label}</Text>
            {tab.count ? <Text style={styles.subTabCount}>{tab.count > 99 ? '99+' : tab.count}</Text> : null}
          </TouchableOpacity>
        ))}
      </View>
      <FlatList
        data={[{ key: activeTab }]}
        keyExtractor={(item) => item.key}
        renderItem={renderContent}
        ListHeaderComponent={(
          <View style={styles.listIntro}>
            <View style={styles.listIntroCopy}>
              <Text style={styles.listIntroTitle}>{activeTabLabel}</Text>
              <Text style={styles.listIntroText}>{sectionDescription}</Text>
            </View>
            {activeSection === 'network' ? (
              <View style={styles.networkStats}>
                <View style={styles.networkStat}>
                  <Text style={styles.networkStatValue}>{friends.length}</Text>
                  <Text style={styles.networkStatLabel}>أصدقاء</Text>
                </View>
                <View style={styles.networkStatDivider} />
                <View style={styles.networkStat}>
                  <Text style={styles.networkStatValue}>{following.length}</Text>
                  <Text style={styles.networkStatLabel}>متابعة</Text>
                </View>
              </View>
            ) : null}
          </View>
        )}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={loadSocialData} tintColor={socialPalette.gold} />}
        keyboardShouldPersistTaps="handled"
      />
    </View>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <View style={styles.emptyState}>
      <Users size={25} color={socialPalette.gold} />
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: socialPalette.background },
  header: { paddingHorizontal: 18, paddingTop: 54, paddingBottom: 18 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  titleIcon: { width: 46, height: 46, borderRadius: 16, backgroundColor: '#28153D', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#56306D' },
  title: { color: socialPalette.text, fontSize: 24, fontWeight: '800' },
  subtitle: { color: socialPalette.muted, fontSize: 13, marginTop: 4 },
  agentGroupButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 14, minHeight: 42, borderRadius: 14, backgroundColor: '#28153D', borderWidth: 1, borderColor: '#56306D' },
  agentGroupButtonText: { color: socialPalette.gold, fontSize: 12, fontWeight: '700' },
  sectionTabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingBottom: 9 },
  sectionTab: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 14, backgroundColor: socialPalette.surface, borderWidth: 1, borderColor: socialPalette.border },
  activeSectionTab: { backgroundColor: '#29183E', borderColor: '#8E42C1' },
  sectionTabText: { color: socialPalette.muted, fontSize: 12, fontWeight: '700' },
  activeSectionTabText: { color: socialPalette.text },
  sectionCount: { minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: 10, backgroundColor: socialPalette.elevated, alignItems: 'center', justifyContent: 'center' },
  activeSectionCount: { backgroundColor: socialPalette.primaryDeep },
  sectionCountText: { color: socialPalette.text, fontSize: 10, fontWeight: '800' },
  subTabs: { flexDirection: 'row', gap: 7, paddingHorizontal: 14, paddingBottom: 12 },
  subTab: { minHeight: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 12, borderRadius: 12, backgroundColor: 'transparent', borderWidth: 1, borderColor: socialPalette.border },
  activeSubTab: { backgroundColor: socialPalette.primaryDeep, borderColor: socialPalette.primaryDeep },
  subTabText: { color: socialPalette.muted, fontSize: 11, fontWeight: '700' },
  activeSubTabText: { color: '#FFFFFF' },
  subTabCount: { color: socialPalette.gold, fontSize: 10, fontWeight: '800' },
  listIntro: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: 14, marginBottom: 12, borderRadius: 18, borderWidth: 1, borderColor: socialPalette.border, backgroundColor: socialPalette.surface },
  listIntroCopy: { flex: 1 },
  listIntroTitle: { color: socialPalette.text, fontSize: 15, fontWeight: '800', textAlign: 'right' },
  listIntroText: { color: socialPalette.muted, fontSize: 11, lineHeight: 17, textAlign: 'right', marginTop: 4 },
  networkStats: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 13, backgroundColor: socialPalette.elevated },
  networkStat: { alignItems: 'center', minWidth: 38 },
  networkStatValue: { color: socialPalette.gold, fontSize: 14, fontWeight: '800' },
  networkStatLabel: { color: socialPalette.muted, fontSize: 9, marginTop: 2 },
  networkStatDivider: { width: 1, height: 26, backgroundColor: socialPalette.border },
  list: { paddingHorizontal: 14, paddingBottom: 104 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 9, minHeight: 54, paddingHorizontal: 13, marginBottom: 8, borderWidth: 1, borderColor: socialPalette.border, borderRadius: 17, backgroundColor: socialPalette.surface },
  searchInput: { flex: 1, color: socialPalette.text, fontSize: 14, paddingVertical: 9, textAlign: 'right' },
  searchHint: { color: socialPalette.muted, fontSize: 12, lineHeight: 19, marginHorizontal: 4, marginBottom: 12, textAlign: 'right' },
  clearSearchText: { color: socialPalette.muted, fontSize: 12, paddingHorizontal: 4 },
  searchButton: { minWidth: 58, alignItems: 'center', backgroundColor: socialPalette.primaryDeep, paddingHorizontal: 13, paddingVertical: 10, borderRadius: 12 },
  searchButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  personRow: { minHeight: 74, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 11, marginBottom: 9, borderWidth: 1, borderColor: socialPalette.border, borderRadius: 17, backgroundColor: socialPalette.surface },
  unreadRow: { borderColor: '#6B3A8F', backgroundColor: '#1D1330' },
  avatar: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2A1940', borderWidth: 1, borderColor: '#56306D', overflow: 'hidden' },
  onlineDot: { position: 'absolute', bottom: 0, right: 0, width: 11, height: 11, borderRadius: 6, backgroundColor: socialPalette.online, borderWidth: 2, borderColor: socialPalette.background },
  avatarImage: { width: '100%', height: '100%' },
  avatarText: { color: socialPalette.gold, fontSize: 16, fontWeight: '800' },
  personDetails: { flex: 1 },
  personName: { color: socialPalette.text, fontSize: 14, fontWeight: '700', textAlign: 'right' },
  personMeta: { color: socialPalette.muted, fontSize: 11, marginTop: 4, textAlign: 'right' },
  actionButton: { minWidth: 68, height: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 8, borderRadius: 13, backgroundColor: '#2A1940', borderWidth: 1, borderColor: '#52306C' },
  followButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2A1940', borderRadius: 12 },
  actionLabel: { color: socialPalette.text, fontSize: 11, fontWeight: '700' },
  moreButton: { width: 30, height: 38, alignItems: 'center', justifyContent: 'center' },
  acceptButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: '#168A67' },
  declineButton: { paddingHorizontal: 11, paddingVertical: 9, borderRadius: 11, backgroundColor: '#3B1A2A' },
  declineText: { color: '#FF9AAE', fontSize: 11, fontWeight: '700' },
  divider: { height: 1, backgroundColor: socialPalette.border, marginVertical: 12 },
  unreadBadge: { minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: socialPalette.primaryDeep },
  unreadText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  conversationTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  conversationTime: { color: socialPalette.muted, fontSize: 10 },
  unreadPreview: { color: socialPalette.text, fontWeight: '600' },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, marginBottom: 10, paddingHorizontal: 2 },
  sectionHeadingText: { color: socialPalette.text, fontSize: 13, fontWeight: '800' },
  sectionHeadingCount: { color: socialPalette.gold, fontSize: 11, fontWeight: '800', minWidth: 20, textAlign: 'center' },
  pendingChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 11, backgroundColor: '#2A1940', borderWidth: 1, borderColor: '#52306C' },
  pendingChipText: { color: socialPalette.muted, fontSize: 10, fontWeight: '700' },
  invitationCard: { padding: 15, marginBottom: 10, borderWidth: 1, borderColor: socialPalette.border, borderRadius: 17, backgroundColor: socialPalette.surface },
  inviteActions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  acceptInviteButton: { flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 12, backgroundColor: socialPalette.primaryDeep },
  acceptInviteText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  declineInviteButton: { flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 12, backgroundColor: '#3B1A2A' },
  emptyState: { alignItems: 'center', gap: 11, paddingHorizontal: 28, paddingVertical: 46, borderWidth: 1, borderColor: socialPalette.border, borderRadius: 18, backgroundColor: socialPalette.surface },
  emptyText: { color: socialPalette.muted, fontSize: 13, lineHeight: 21, textAlign: 'center' },
  challengeCreateCard: { padding: 15, marginBottom: 12, borderWidth: 1, borderColor: socialPalette.border, borderRadius: 18, backgroundColor: socialPalette.surface },
  challengeCard: { padding: 15, marginBottom: 10, borderWidth: 1, borderColor: socialPalette.border, borderRadius: 17, backgroundColor: socialPalette.surface },
  challengeHeading: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 7 },
  challengeTitle: { color: socialPalette.text, fontSize: 14, fontWeight: '700' },
  challengeDescription: { color: socialPalette.muted, fontSize: 11, lineHeight: 17, marginBottom: 10 },
  playerCountRow: { flexDirection: 'row', gap: 8, marginVertical: 7 },
  playerCountButton: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10, backgroundColor: socialPalette.elevated },
  playerCountButtonActive: { backgroundColor: socialPalette.primaryDeep },
  playerCountText: { color: socialPalette.muted, fontSize: 12, fontWeight: '600' },
  playerCountTextActive: { color: '#FFFFFF' },
  opponentRow: { minHeight: 43, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: socialPalette.border },
  checkbox: { width: 21, height: 21, borderRadius: 7, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: socialPalette.muted },
  checkboxActive: { backgroundColor: socialPalette.primaryDeep, borderColor: socialPalette.primaryDeep },
  checkboxCheck: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  createChallengeButton: { alignItems: 'center', paddingVertical: 11, marginTop: 12, borderRadius: 11, backgroundColor: socialPalette.primaryDeep },
  createChallengeText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  disabledAction: { opacity: 0.55 },
  challengeParticipant: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: socialPalette.border },
  challengeScore: { color: socialPalette.gold, fontSize: 11, fontWeight: '600' },
  rollButton: { alignItems: 'center', justifyContent: 'center', minHeight: 42, marginTop: 12, borderRadius: 11, backgroundColor: socialPalette.primaryDeep },
  challengeResult: { color: socialPalette.online, fontSize: 12, fontWeight: '700', marginTop: 10 },
});
