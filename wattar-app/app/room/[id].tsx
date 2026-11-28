/**
 * Wattar App — صفحة الغرفة الصوتية
 * مقاعد + شات + هدايا + صوت حي عبر LiveKit
 *
 * الصوت يُفعّل تلقائيًا إذا ضُبطت أسرار LiveKit على الخادم
 * (LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET)؛
 * وإلا تعمل الغرفة بشكل كامل (شات + مقاعد) بدون صوت.
 */
import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList, TextInput, ScrollView, Alert, Image, ActivityIndicator,
  PermissionsAndroid, Platform, Modal, AppState,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Reanimated, {
  Easing as ReanimatedEasing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { supabase, callFunction } from '@/lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { useAuthStore } from '@/store/auth';
import { usePreferencesStore } from '@/store/preferences';
import { CurrencyIcon } from '@/components/CurrencyIcon';
import { Avatar, LevelBadge } from '@/components/ui';
import { GiftCelebration, type GiftCelebrationData } from '@/components/room/GiftCelebration';
import { GiftScene } from '@/components/room/GiftScene';
import { GiftCard, RecipientChip, type GiftRecord } from '@/components/room/GiftPicker';
import { GiftTicker, type GiftFeedEntry } from '@/components/room/GiftTicker';
import { LiveEqualizer } from '@/components/room/LiveEqualizer';
import { MessageEntrance } from '@/components/room/MessageEntrance';
import { flagEmoji } from '@/lib/flags';
import { RoomAmbience } from '@/components/room/RoomAmbience';
import { colors, fonts, gradients, radius, shadow } from '@/lib/theme';
import { StatusBar } from 'expo-status-bar';
import { joinVoice, leaveVoice, setMicEnabled } from '@/lib/livekit';
import type { Room } from 'livekit-client';
import {
  Mic, MicOff, X, Send, Gift, Crown, Lock, Shield, LogOut, Users, Volume2, VolumeX, UserPlus, Smile, Search,
} from 'lucide-react-native';

const VOICE_OFF = 'off' as const;
const VOICE_CONNECTING = 'connecting' as const;
const VOICE_ON = 'on' as const;
const VOICE_UNAVAILABLE = 'unavailable' as const;
type VoiceState = typeof VOICE_OFF | typeof VOICE_CONNECTING | typeof VOICE_ON | typeof VOICE_UNAVAILABLE;
const CHAT_EMOJIS = ['😀', '😂', '🥰', '😍', '🤩', '😎', '🥳', '😭', '👏', '🔥', '❤️', '🌹', '🎉', '✨', '💎', '🎁'];

interface Seat {
  id: string;
  seat_index: number;
  user_id: string | null;
  status: string;
  is_mic_on: boolean;
  is_owner_seat: boolean;
  user?: { username: string; display_name: string | null; avatar_url: string | null; level?: number | null } | null;
}

interface Message {
  id: string;
  user_id: string;
  message: string;
  is_system: boolean;
  created_at: string;
  pending?: boolean;
  user?: { username: string; display_name: string | null; avatar_url: string | null; level?: number | null; country_code?: string | null } | null;
}

export default function RoomScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile } = useAuthStore();
  const chatTextSize = usePreferencesStore(state => state.chatTextSize);
  const chatFontSize = chatTextSize === 'small' ? 12 : chatTextSize === 'large' ? 17 : 14;
  const [room, setRoom] = useState<any>(null);
  const [roomLoading, setRoomLoading] = useState(true);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [showGifts, setShowGifts] = useState(false);
  const [giftCelebration, setGiftCelebration] = useState<GiftCelebrationData | null>(null);
  const [showRoomInvites, setShowRoomInvites] = useState(false);
  const [inviteFriends, setInviteFriends] = useState<Array<{ user_id: string; username: string; display_name: string | null }>>([]);
  const [invitesLoading, setInvitesLoading] = useState(false);
  const [invitingUserId, setInvitingUserId] = useState<string | null>(null);
  const [mySeat, setMySeat] = useState<number | null>(null);
  const [listenersCount, setListenersCount] = useState(0);
  const [voiceState, setVoiceState] = useState<VoiceState>(VOICE_CONNECTING);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [micLoading, setMicLoading] = useState(false);
  const [moderatingUserId, setModeratingUserId] = useState<string | null>(null);
  // M6: صلاحيات إدارة الغرفة وبوابة كلمة المرور وطلبات الصعود
  const [myRole, setMyRole] = useState<string | null>(null);
  const [voiceGate, setVoiceGate] = useState<'unknown' | 'required' | 'open'>('unknown');
  const [passwordPromptVisible, setPasswordPromptVisible] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordChecking, setPasswordChecking] = useState(false);
  const [manageSheetVisible, setManageSheetVisible] = useState(false);
  const [requestsSheetVisible, setRequestsSheetVisible] = useState(false);
  const [auditSheetVisible, setAuditSheetVisible] = useState(false);
  const [pendingRequests, setPendingRequests] = useState<Array<{
    id: string; user_id: string; requested_at: string;
    user: { username: string; display_name: string | null; avatar_url: string | null } | null;
  }>>([]);
  const [myPendingRequest, setMyPendingRequest] = useState(false);
  const [requestingSeat, setRequestingSeat] = useState(false);
  const [moderatorIds, setModeratorIds] = useState<string[]>([]);
  const [auditLog, setAuditLog] = useState<Array<{
    action: string; actor_role: string; created_at: string; duration_minutes: number | null; reason: string | null;
    actor: { username: string; display_name: string | null } | null;
    target: { username: string; display_name: string | null } | null;
  }>>([]);
  const voicePasswordRef = useRef<string | null>(null);
  const chatListRef = useRef<FlatList>(null);
  const lkRoomRef = useRef<Room | null>(null);
  const seatsRef = useRef<Seat[]>([]);
  const participantProfilesRef = useRef<Record<string, { username: string; display_name: string | null; avatar_url: string | null }>>({});
  const closedRoomNoticeRef = useRef(false);
  // إصلاحات الأداء والاتصال الفوري
  const myRoleRef = useRef<string | null>(null);
  const realtimeOkRef = useRef(false);
  const mainChannelRef = useRef<RealtimeChannel | null>(null);
  const lastMessageAtRef = useRef<string | null>(null);
  const resubscribeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const channelsRef = useRef<RealtimeChannel[]>([]);
  // كشف الحضور (مالك/طاقم الغرفة)
  const [attendees, setAttendees] = useState<Array<{
    user_id: string; username: string; display_name: string | null; avatar_url: string | null;
    role: string; is_speaker: boolean; is_mic_on: boolean; is_owner: boolean; joined_at: string;
  }>>([]);
  const [attendanceVisible, setAttendanceVisible] = useState(false);
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [giftCombo, setGiftCombo] = useState(1);
  const [giftFeed, setGiftFeed] = useState<GiftFeedEntry[]>([]);
  const lastGiftAtRef = useRef(0);
  // مواقع المقاعد على الشاشة (حسب user_id) — تُستخدم لتحريك الهدية نحو المستلم عند انتهاء المشهد.
  const seatPositionsRef = useRef<Record<string, { x: number; y: number }>>({});
  const [giftTarget, setGiftTarget] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    myRoleRef.current = myRole;
  }, [myRole]);
  const speakersCount = seats.filter(seat => seat.status === 'occupied' && seat.user_id).length;
  const isRoomOwner = room?.owner_id === profile?.id;
  // الأدوار: المالك/المدير الثاني/مشرف/إدارة عليا لهم إدارة كاملة؛ الوكالة نطاقها محدود
  const isFullManager = myRole === 'owner' || myRole === 'second_admin' || myRole === 'moderator' || myRole === 'admin';
  const canManage = myRole !== null;
  const canManageModerators = myRole === 'owner' || myRole === 'second_admin' || myRole === 'admin';
  const canTransferOwnership = myRole === 'owner' || myRole === 'admin';

  useEffect(() => {
    if (room?.status !== 'closed' || closedRoomNoticeRef.current) return;
    closedRoomNoticeRef.current = true;
    const liveRoom = lkRoomRef.current;
    lkRoomRef.current = null;
    void leaveVoice(liveRoom);
    Alert.alert('انتهت الغرفة', 'أغلق مالك الغرفة هذه الجلسة. بقي سجل الغرفة محفوظًا.', [
      { text: 'موافق', onPress: () => router.back() },
    ], { cancelable: false });
  }, [room?.status, router]);

  // رسائل نظام دورية: تذكير بالاحترام والمراقبة، محلية للعرض (لا تُكتب في قاعدة البيانات).
  useEffect(() => {
    const notices = [
      'تواصلوا باحترام ولطف — مجتمع وتر يرحّب بالجميع 🤍',
      'فريق وتر يراقب الغرف على مدار الساعة لضمان بيئة آمنة.',
      'أي إساءة أو مخالفة؟ استخدم الإبلاغ وسنتعامل معها فورًا.',
      'استمتعوا بوقّتكم، وخلّوا الحوار راقياً وممتعاً للجميع.',
    ];
    let index = 0;
    const pushNotice = () => {
      const text = notices[index % notices.length];
      index += 1;
      const localNotice: Message = {
        id: `sys-local-${Date.now()}-${index}`,
        user_id: 'system',
        message: text,
        is_system: true,
        created_at: new Date().toISOString(),
      };
      setMessages((previous) => {
        const next = [...previous, localNotice];
        return next.length > 120 ? next.slice(next.length - 120) : next;
      });
    };
    // أول رسالة بعد دقيقة، ثم كل 8 دقائق.
    const first = setTimeout(pushNotice, 60_000);
    const interval = setInterval(pushNotice, 8 * 60_000);
    return () => { clearTimeout(first); clearInterval(interval); };
  }, []);

  /** إضافة هدية إلى الشريط الحيّ وإزالتها تلقائيًا بعد ٨ ثوانٍ. */
  const pushGiftFeed = (entry: Omit<GiftFeedEntry, 'id'>) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setGiftFeed((previous) => [{ ...entry, id }, ...previous].slice(0, 3));
    setTimeout(() => {
      setGiftFeed((previous) => previous.filter((item) => item.id !== id));
    }, 8000);
  };

  /** إرسال هدية: نُظهر الاحتفال ونحسب الكومبو إذا تكرر الإهداء خلال ٥ ثوانٍ. */
  const handleGiftSent = (gift: GiftCelebrationData) => {
    const now = Date.now();
    const withinCombo = now - lastGiftAtRef.current < 5000;
    lastGiftAtRef.current = now;
    setGiftCombo((previous) => (withinCombo ? Math.min(previous + 1, 99) : 1));
    // هدف الحركة: مقعد المستلم إن وُجد، وإلا وسط الشاشة.
    setGiftTarget(gift.recipientId ? seatPositionsRef.current[gift.recipientId] ?? null : null);
    setGiftCelebration(gift);
    const sender = profile?.display_name ?? profile?.username ?? null;
    pushGiftFeed({
      emoji: gift.emoji,
      name: gift.name,
      sender,
      recipient: gift.recipient,
    });
    // بث الهدية لكل من في الغرفة كي يرى الجميع لحظة الإهداء
    void mainChannelRef.current
      ?.send({
        type: 'broadcast',
        event: 'gift',
        payload: {
          emoji: gift.emoji,
          name: gift.name,
          recipient: gift.recipient,
          sender,
          premium: Boolean(gift.premium),
        },
      })
      .catch(() => {
        // البث تحسين اختياري؛ فشله لا يمنع إتمام الهدية.
      });
  };

  useEffect(() => {
    if (!id) return;
    const presenceSessionId = `room-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
    loadRoom().catch((error: unknown) => {
      setRoomError(error instanceof Error ? error.message : 'تعذر تحميل الغرفة');
    });
    const unsubscribe = subscribeToRoom();

    let cancelled = false;
    let presenceQueue: Promise<void> = Promise.resolve();
    const updatePresence = (functionName: 'room-join' | 'room-leave', notifyError = false) => {
      presenceQueue = presenceQueue.then(async () => {
        try {
          const result = await callFunction<{ listener_count: number }>(functionName, {
            room_id: id,
            session_id: presenceSessionId,
          });
          if (!cancelled && Number.isInteger(result.listener_count) && result.listener_count >= 0) {
            setListenersCount(result.listener_count);
          }
        } catch (error: unknown) {
          console.warn(`[Wattar] ${functionName} presence request failed:`, error);
          if (notifyError && !cancelled) {
            Alert.alert('تعذر تسجيل الحضور', error instanceof Error ? error.message : 'حاول تحديث الغرفة.');
          }
        }
      });
      return presenceQueue;
    };
    void updatePresence('room-join', true);
    const presenceHeartbeat = setInterval(() => {
      void updatePresence('room-join');
    }, 30_000);

    return () => {
      cancelled = true;
      unsubscribe?.();
      const lk = lkRoomRef.current;
      lkRoomRef.current = null;
      leaveVoice(lk);
      clearInterval(presenceHeartbeat);
      void presenceQueue.then(() => updatePresence('room-leave')).catch((error: unknown) => {
        console.warn('[Wattar] Room presence cleanup failed:', error);
      });
    };
  }, [id]);

  // شبكة أمان للرسائل: مزامنة دورية خفيفة + استئناف فوري عند العودة للتطبيق
  useEffect(() => {
    if (!id) return;
    const poll = setInterval(() => {
      void syncNewMessages();
      if (attendanceVisible) void loadAttendance(false);
    }, realtimeOkRef.current ? 15000 : 4000);
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void syncNewMessages();
      void loadSeats().catch(() => undefined);
    });
    return () => {
      clearInterval(poll);
      appStateSub.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, attendanceVisible]);

  // M6: بوابة كلمة المرور — الغرفة المحمية تتطلب كلمة مرور قبل الاتصال الصوتي
  // (الطاقم: المالك/المدير الثاني/المشرف/الإدارة/الوكالة المعنية يدخلون بلا كلمة مرور)
  useEffect(() => {
    if (!room || !profile) return;
    if (room.status === 'closed') return;
    const privileged = myRole !== null || room.owner_id === profile.id;
    if (room.has_password && !privileged) {
      setVoiceGate((current) => (current === 'open' ? current : 'required'));
    } else {
      setVoiceGate('open');
    }
  }, [room?.id, room?.has_password, room?.status, myRole, profile?.id]);

  // الاتصال الصوتي بعد اجتياز البوابة (M6: كلمة المرور تُمرر للتحقق الخادمي)
  useEffect(() => {
    if (!id || voiceGate !== 'open') return;
    let cancelled = false;
    (async () => {
      try {
        setVoiceState(VOICE_CONNECTING);
        setVoiceError(null);
        const { room: lkRoom, configured } = await joinVoice(id, voicePasswordRef.current ?? undefined);
        if (cancelled) {
          await leaveVoice(lkRoom);
          return;
        }
        if (!configured || !lkRoom) {
          await leaveVoice(lkRoom);
          setVoiceError('خدمة الصوت الحي غير مهيأة على الخادم.');
          setVoiceState(VOICE_UNAVAILABLE);
          return;
        }
        lkRoomRef.current = lkRoom;
        lkRoom.on('connected', () => setVoiceState(VOICE_ON));
        lkRoom.on('disconnected', () => {
          if (!cancelled) setVoiceState(VOICE_OFF);
        });
        setVoiceState(lkRoom.state === 'connected' ? VOICE_ON : VOICE_CONNECTING);
      } catch (e) {
        console.warn('[Wattar] voice join failed:', e);
        if (!cancelled) {
          const message = e instanceof Error ? e.message : 'تعذر الاتصال بخدمة الصوت.';
          if (message.includes('WRONG_ROOM_PASSWORD') || message.includes('ROOM_PASSWORD_REQUIRED')) {
            setPasswordPromptVisible(true);
            setVoiceGate('required');
            setVoiceState(VOICE_OFF);
            setVoiceError(null);
            Alert.alert('كلمة المرور', message.includes('WRONG_ROOM_PASSWORD')
              ? 'كلمة مرور الغرفة غير صحيحة. حاول مجدداً.'
              : 'هذه الغرفة محمية بكلمة مرور.');
            return;
          }
          if (message.includes('ROOM_PASSWORD_LOCKED')) {
            setVoiceGate('required');
            setVoiceState(VOICE_OFF);
            setVoiceError(null);
            Alert.alert('محاولات كثيرة', 'أُقفلت محاولات الدخول مؤقتاً بسبب كلمات مرور خاطئة متكررة. انتظر عشر دقائق ثم أعد المحاولة.');
            return;
          }
          if (message.includes('ROOM_BANNED')) {
            setVoiceState(VOICE_OFF);
            setVoiceError('أنت محظور من هذه الغرفة.');
            Alert.alert('محظور', 'لا يمكنك الانضمام إلى هذه الغرفة.', [
              { text: 'موافق', onPress: () => router.back() },
            ], { cancelable: false });
            return;
          }
          setVoiceError(message);
          setVoiceState(VOICE_UNAVAILABLE);
        }
      }
    })();
    return () => {
      cancelled = true;
      const lk = lkRoomRef.current;
      lkRoomRef.current = null;
      leaveVoice(lk);
    };
  }, [id, voiceGate]);

  const loadParticipantProfiles = async () => {
    try {
      const { data, error } = await supabase.rpc('get_room_participant_profiles', { p_room_id: id });
      if (error) throw error;
      const profiles = ((data ?? []) as Array<{
        user_id: string;
        username: string;
        display_name: string | null;
        avatar_url: string | null;
      }>).reduce<Record<string, { username: string; display_name: string | null; avatar_url: string | null }>>(
        (map, row) => {
          map[row.user_id] = {
            username: row.username,
            display_name: row.display_name,
            avatar_url: row.avatar_url,
          };
          return map;
        },
        {},
      );
      participantProfilesRef.current = profiles;
      return profiles;
    } catch (error: unknown) {
      console.warn('[Wattar] Failed to load room participant profiles:', error);
      return participantProfilesRef.current;
    }
  };

  const loadRoom = async () => {
    setRoomLoading(true);
    setRoomError(null);
    const [roomResult, seatsResult, messagesResult, profiles] = await Promise.all([
      supabase
      .from('rooms')
      .select(`
        id, name, owner_id, seat_count, status, speakers_count,
        has_password, second_admin_id, seats_locked, audience_muted,
        owner:users!rooms_owner_id_fkey(username, display_name, avatar_url)
      `)
      .eq('id', id)
      .single(),
      supabase
      .from('room_seats')
      .select(`
        *,
        user:users(username, display_name, avatar_url, level, country_code)
      `)
      .eq('room_id', id)
      .order('seat_index', { ascending: true }),
      supabase
      .from('room_messages')
      .select(`
        *,
        user:users(username, display_name, avatar_url, level, country_code)
      `)
      .eq('room_id', id)
      .order('created_at', { ascending: true })
      .limit(100),
      loadParticipantProfiles(),
    ]);

    const queryError = roomResult.error ?? seatsResult.error ?? messagesResult.error;
    if (queryError) {
      setRoomLoading(false);
      throw queryError;
    }
    if (!roomResult.data) {
      setRoomLoading(false);
      throw new Error('الغرفة غير موجودة أو لا تملك صلاحية الدخول إليها.');
    }
    setRoom(roomResult.data);
    const loadedSeats = (seatsResult.data ?? []).map((seat) => ({
      ...(seat as Seat),
      user: seat.user_id
        ? { ...(seat as Seat).user, ...(profiles[seat.user_id] ?? {}) }
        : (seat as Seat).user,
    }));
    seatsRef.current = loadedSeats;
    setSeats(loadedSeats);
    const myOccupiedSeat = loadedSeats.find(
      seat => seat.user_id === profile?.id && seat.status === 'occupied',
    );
    setMySeat(myOccupiedSeat?.seat_index ?? null);
    const loadedMessages = (messagesResult.data ?? []).map((item) => ({
      ...(item as Message),
      user: item.user_id ? profiles[item.user_id] ?? (item as Message).user : (item as Message).user,
    }));
    setMessages(loadedMessages);
    const latestAt = loadedMessages.length
      ? loadedMessages[loadedMessages.length - 1].created_at
      : null;
    if (latestAt && (!lastMessageAtRef.current || latestAt > lastMessageAtRef.current)) {
      lastMessageAtRef.current = latestAt;
    }
    setRoomLoading(false);
    if (profile?.id) {
      void loadMyRoomPermissions();
    }
  };

  // M6: دوري في الغرفة + قائمة المشرفين + طلب الصعود الخاص بي
  const loadMyRoomPermissions = async () => {
    if (!profile?.id) return;
    const [roleResult, modsResult, myRequestResult] = await Promise.all([
      supabase.rpc('room_actor_role', { p_room_id: id, p_user_id: profile.id }),
      supabase
        .from('room_moderators')
        .select('user_id')
        .eq('room_id', id),
      supabase
        .from('room_seat_requests')
        .select('id')
        .eq('room_id', id)
        .eq('user_id', profile.id)
        .eq('status', 'pending')
        .limit(1),
    ]);
    if (roleResult.error) throw roleResult.error;
    setMyRole((roleResult.data as string | null) ?? null);
    setModeratorIds((modsResult.data ?? []).map((row: { user_id: string }) => row.user_id));
    setMyPendingRequest((myRequestResult.data ?? []).length > 0);
    if (roleResult.data) {
      // طاقم الغرفة: حمّل طلبات الصعود فوراً (كانت لا تظهر إلا عبر حدث فوري)
      void loadPendingRequests();
    }
  };

  // M6: طلبات الصعود المعلقة (تظهر لإدارة الغرفة) — عبر دالة خادمية سريعة
  const loadPendingRequests = async () => {
    const { data, error } = await supabase.rpc('list_room_seat_requests', { p_room_id: id });
    if (error || !data) return;
    setPendingRequests((data as Array<{
      request_id: string; user_id: string; username: string;
      display_name: string | null; avatar_url: string | null; requested_at: string;
    }>).map((row) => ({
      id: row.request_id,
      user_id: row.user_id,
      requested_at: row.requested_at,
      user: { username: row.username, display_name: row.display_name, avatar_url: row.avatar_url },
    })));
  };

  // كشف الحضور: من في الغرفة الآن (متحدثون + مستمعون)
  const loadAttendance = async (showSpinner = true) => {
    if (showSpinner) setAttendanceLoading(true);
    try {
      const { data, error } = await supabase.rpc('list_room_attendees', { p_room_id: id });
      if (error) throw error;
      setAttendees((data ?? []) as typeof attendees);
    } catch (error: unknown) {
      if (showSpinner) {
        Alert.alert('تعذر تحميل الحضور', error instanceof Error ? error.message : 'حاول مرة أخرى.');
      }
    } finally {
      if (showSpinner) setAttendanceLoading(false);
    }
  };

  // M6: سجل تغييرات إدارة الغرفة (المدير الثاني/التسليم/كل الإجراءات)
  const loadAuditLog = async () => {
    const { data, error } = await supabase
      .from('room_moderation_audit')
      .select(`
        action, actor_role, created_at, duration_minutes, reason,
        actor:users!room_moderation_audit_actor_id_fkey(username, display_name),
        target:users!room_moderation_audit_target_user_id_fkey(username, display_name)
      `)
      .eq('room_id', id)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) return;
    setAuditLog((data ?? []).map((row: any) => ({
      ...row,
      actor: Array.isArray(row.actor) ? row.actor[0] ?? null : row.actor,
      target: Array.isArray(row.target) ? row.target[0] ?? null : row.target,
    })));
  };

  const loadSeats = async () => {
    const [seatsResponse, profiles] = await Promise.all([
      supabase
        .from('room_seats')
        .select(`
          *,
          user:users(username, display_name, avatar_url, level, country_code)
        `)
        .eq('room_id', id)
        .order('seat_index', { ascending: true }),
      loadParticipantProfiles(),
    ]);

    if (seatsResponse.error) throw seatsResponse.error;
    const loadedSeats = (seatsResponse.data ?? []).map((seat) => ({
      ...(seat as Seat),
      user: seat.user_id
        ? { ...(seat as Seat).user, ...(profiles[seat.user_id] ?? {}) }
        : (seat as Seat).user,
    }));
    seatsRef.current = loadedSeats;
    setSeats(loadedSeats);
    const occupiedSeat = loadedSeats.find(
      seat => seat.user_id === profile?.id && seat.status === 'occupied',
    );
    setMySeat(occupiedSeat?.seat_index ?? null);
    return loadedSeats;
  };

  // Keep realtime seat notices local; persisting them would duplicate a single event per room member.
  const addSeatSystemMessage = (eventId: string, message: string) => {
    setMessages(previous => {
      if (previous.some(item => item.id === eventId)) return previous;
      return [...previous, {
        id: eventId,
        user_id: '',
        message,
        is_system: true,
        created_at: new Date().toISOString(),
      }];
    });
    setTimeout(() => chatListRef.current?.scrollToEnd(), 100);
  };

  const subscribeToRoom = () => {
    let disposed = false;

    const buildChannels = () => {
      if (disposed) return;
      // مفتاح الاتصال الفوري: بدون توكن يقيَّم RLS كزائر مجهول فلا تصل أي أحداث
      void supabase.auth.getSession().then(({ data }) => {
        const token = data.session?.access_token;
        if (token) {
          try { supabase.realtime.setAuth(token); } catch (error) {
            console.warn('[Wattar] realtime setAuth failed:', error);
          }
        }
      });

      const onRealtimeStatus = (status: string) => {
        const healthy = status === 'SUBSCRIBED';
        realtimeOkRef.current = healthy;
        if (!healthy && !disposed) {
          console.warn('[Wattar] room realtime status:', status);
          scheduleResubscribe();
        }
      };

      const scheduleResubscribe = () => {
        if (resubscribeTimerRef.current || disposed) return;
        resubscribeTimerRef.current = setTimeout(() => {
          resubscribeTimerRef.current = null;
          if (disposed) return;
          channelsRef.current.forEach((channel) => { try { supabase.removeChannel(channel); } catch { /* noop */ } });
          channelsRef.current = [];
          buildChannels();
        }, 3000);
      };

      const mainChannel = supabase
        .channel(`room:${id}`, { config: { broadcast: { self: false } } })
        .on('broadcast',
          { event: 'gift' },
          ({ payload }) => {
            const incoming = payload as Partial<GiftCelebrationData> | null;
            if (!incoming || typeof incoming.emoji !== 'string') return;
            const incomingRecipientId = typeof incoming.recipientId === 'string' ? incoming.recipientId : null;
            setGiftTarget(incomingRecipientId ? seatPositionsRef.current[incomingRecipientId] ?? null : null);
            setGiftCelebration({
              emoji: incoming.emoji,
              name: typeof incoming.name === 'string' ? incoming.name : 'هدية',
              recipient: typeof incoming.recipient === 'string' ? incoming.recipient : '',
              recipientId: incomingRecipientId,
              sender: typeof incoming.sender === 'string' ? incoming.sender : null,
              premium: Boolean(incoming.premium),
            });
            const feedId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            const feedEntry: GiftFeedEntry = {
              id: feedId,
              emoji: incoming.emoji,
              name: typeof incoming.name === 'string' ? incoming.name : 'هدية',
              recipient: typeof incoming.recipient === 'string' ? incoming.recipient : '',
              sender: typeof incoming.sender === 'string' ? incoming.sender : null,
            };
            setGiftFeed((previous) => [feedEntry, ...previous].slice(0, 3));
            setTimeout(() => {
              setGiftFeed((previous) => previous.filter((item) => item.id !== feedId));
            }, 8000);
          }
        )
        .on('postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'room_messages', filter: `room_id=eq.${id}` },
          (payload) => {
            const incoming = payload.new as Message;
            if (incoming.is_system && incoming.message === 'أغلق مالك الغرفة هذه الغرفة.') {
              setRoom((current: typeof room) => current ? { ...current, status: 'closed' } : current);
            }
            mergeIncomingMessages([incoming]);
          }
        )
        .on('postgres_changes',
          { event: '*', schema: 'public', table: 'room_seats', filter: `room_id=eq.${id}` },
          (payload) => {
            applySeatPayload(payload.new as Seat);
          }
        )
        .on('postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${id}` },
          (payload) => {
            const updatedRoom = payload.new as typeof room;
            setRoom((current: typeof room) => current ? { ...current, ...updatedRoom } : current);
          }
        )
        .subscribe((status) => { if (status !== 'SUBSCRIBED') onRealtimeStatus(status); else realtimeOkRef.current = true; });

      // قناة مستقلة لطلبات الصعود كي لا يعطّل أي خلل فيها بقية أحداث الغرفة
      const requestsChannel = supabase
        .channel(`room-requests:${id}`)
        .on('postgres_changes',
          { event: '*', schema: 'public', table: 'room_seat_requests', filter: `room_id=eq.${id}` },
          () => {
            if (myRoleRef.current) void loadPendingRequests();
            void refreshMyPendingRequest();
          }
        )
        .subscribe();

      channelsRef.current = [mainChannel, requestsChannel];
      mainChannelRef.current = mainChannel;
    };

    buildChannels();

    return () => {
      disposed = true;
      if (resubscribeTimerRef.current) {
        clearTimeout(resubscribeTimerRef.current);
        resubscribeTimerRef.current = null;
      }
      channelsRef.current.forEach((channel) => { try { supabase.removeChannel(channel); } catch { /* noop */ } });
      channelsRef.current = [];
    };
  };

  // دمج رسائل واردة (اتصال فوري أو مزامنة دورية) بلا تكرار
  const mergeIncomingMessages = (incoming: Message[]) => {
    if (!incoming.length) return;
    setMessages(prev => {
      let next = prev;
      for (const raw of incoming) {
        const savedMessage: Message = {
          ...raw,
          user: raw.user_id === profile?.id
            ? {
                username: profile.username,
                display_name: profile.display_name,
                avatar_url: profile.avatar_url,
              }
            : (raw.user ?? participantProfilesRef.current[raw.user_id] ?? null),
        };
        const withoutPending = next.filter(
          (message) => !(message.pending && message.user_id === savedMessage.user_id && message.message === savedMessage.message),
        );
        const existingIndex = withoutPending.findIndex((message) => message.id === savedMessage.id);
        if (existingIndex >= 0) {
          next = withoutPending.map((message, index) => index === existingIndex ? savedMessage : message);
        } else {
          next = [...withoutPending, savedMessage];
        }
      }
      return next;
    });
    const latest = incoming[incoming.length - 1]?.created_at;
    if (latest && (!lastMessageAtRef.current || latest > lastMessageAtRef.current)) {
      lastMessageAtRef.current = latest;
    }
    setTimeout(() => chatListRef.current?.scrollToEnd(), 100);
  };

  // تطبيق تحديث مقعد واحد محلياً (بدل إعادة تحميل كل المقاعد والأسماء)
  const applySeatPayload = (nextSeat: Seat) => {
    const previousSeat = seatsRef.current.find(seat => seat.id === nextSeat.id);
    const previousUserId = previousSeat?.user_id ?? null;
    const nextUserId = nextSeat.user_id ?? null;
    const userChanged = previousSeat && previousUserId !== nextUserId;

    const normalized: Seat = {
      ...nextSeat,
      user: nextUserId
        ? (participantProfilesRef.current[nextUserId] ?? previousSeat?.user ?? null)
        : null,
    };
    const nextSeats = seatsRef.current.some(seat => seat.id === normalized.id)
      ? seatsRef.current.map(seat => (seat.id === normalized.id ? normalized : seat))
      : [...seatsRef.current, normalized].sort((a, b) => a.seat_index - b.seat_index);
    seatsRef.current = nextSeats;
    setSeats(nextSeats);
    const myOccupied = nextSeats.find(
      seat => seat.user_id === profile?.id && seat.status === 'occupied',
    );
    setMySeat(myOccupied?.seat_index ?? null);

    if (userChanged) {
      const eventId = `seat-event-${nextSeat.id}-${previousUserId ?? 'empty'}-${nextUserId ?? 'empty'}`;
      if (previousUserId) {
        const previousName = previousSeat.user?.display_name ?? previousSeat.user?.username ?? 'أحد المتحدثين';
        addSeatSystemMessage(eventId, `غادر ${previousName} المنصة الصوتية.`);
      }
      if (nextUserId) {
        const joinedName = normalized.user?.display_name ?? normalized.user?.username ?? 'متحدث جديد';
        addSeatSystemMessage(`${eventId}-join`, `صعد ${joinedName} إلى المنصة الصوتية.`);
        // اسم غير معروف بعد؟ نجلب ملفات المشاركين مرة واحدة
        if (!participantProfilesRef.current[nextUserId]) {
          void loadParticipantProfiles().then((profiles) => {
            if (!profiles[nextUserId]) return;
            seatsRef.current = seatsRef.current.map(seat =>
              seat.user_id === nextUserId ? { ...seat, user: profiles[nextUserId] } : seat,
            );
            setSeats(seatsRef.current);
          });
        }
      }
    }
  };

  // مزامنة دورية خفيفة: تضمن وصول الرسائل حتى لو تعطل الاتصال الفوري
  const syncNewMessages = async () => {
    if (!id) return;
    try {
      let query = supabase
        .from('room_messages')
        .select(`
          id, room_id, user_id, message, is_system, created_at,
          user:users(username, display_name, avatar_url, level, country_code)
        `)
        .eq('room_id', id)
        .order('created_at', { ascending: true })
        .limit(200);
      if (lastMessageAtRef.current) {
        query = query.gt('created_at', lastMessageAtRef.current);
      }
      const { data, error } = await query;
      if (error) return;
      const rows = (data ?? []) as unknown as Array<Message & { user: Message['user'] }>;
      if (!rows.length) return;
      mergeIncomingMessages(rows.map((row) => ({
        ...row,
        user: Array.isArray(row.user) ? row.user[0] ?? null : row.user,
      })));
    } catch (error: unknown) {
      console.warn('[Wattar] message sync failed:', error);
    }
  };

  // طلب الصعود الخاص بي (مزامنة سريعة بعد أي تغيير)
  const refreshMyPendingRequest = async () => {
    if (!profile?.id) return;
    const { data } = await supabase
      .from('room_seat_requests')
      .select('id')
      .eq('room_id', id)
      .eq('user_id', profile.id)
      .eq('status', 'pending')
      .limit(1);
    setMyPendingRequest((data ?? []).length > 0);
  };

  const sendMessage = async () => {
    if (!newMessage.trim() || !profile) return;
    const msg = newMessage.trim();
    const optimisticId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimisticMessage: Message = {
      id: optimisticId,
      user_id: profile.id,
      message: msg,
      is_system: false,
      created_at: new Date().toISOString(),
      pending: true,
      user: {
        username: profile.username,
        display_name: profile.display_name,
        avatar_url: profile.avatar_url,
      },
    };
    setMessages(prev => [...prev, optimisticMessage]);
    setNewMessage('');
    setTimeout(() => chatListRef.current?.scrollToEnd(), 50);

    const { data, error } = await supabase.rpc('send_room_message', {
      p_room_id: id,
      p_message: msg,
    });

    if (error) {
      setMessages(prev => prev.filter(message => message.id !== optimisticId));
      setNewMessage(msg);
      Alert.alert('تعذر إرسال الرسالة', error.message);
      return;
    }

    // M2.5: رسالة اعترضها فلتر الكلمات — تُعاد بنجاح مع علم blocked (لا استثناء)
    const blockedResult = data as { blocked?: boolean; message?: string } | null;
    if (blockedResult?.blocked) {
      setMessages(prev => prev.filter(message => message.id !== optimisticId));
      setNewMessage(msg);
      Alert.alert('تعذر إرسال الرسالة', blockedResult.message ?? 'الرسالة تحتوي على كلمات غير مسموح بها');
      return;
    }
    const savedMessage: Message = {
      ...(data as unknown as Omit<Message, 'user' | 'pending'>),
      user: optimisticMessage.user,
    };
    setMessages(prev => {
      const withoutPending = prev.filter(message => message.id !== optimisticId);
      const existingIndex = withoutPending.findIndex(message => message.id === savedMessage.id);
      if (existingIndex >= 0) {
        return withoutPending.map((message, index) => index === existingIndex ? savedMessage : message);
      }
      return [...withoutPending, savedMessage];
    });
  };



  const leaveSeat = async () => {
    if (!profile || mySeat === null) return;
    const seat = seats.find(s => s.seat_index === mySeat);
    if (!seat) return;

    const { error } = await supabase.rpc('leave_room_seat', { p_room_id: id });
    if (error) {
      Alert.alert('خطأ', error.message || 'تعذر ترك المقعد. حاول مرة أخرى.');
      return;
    }
    setMySeat(null);
  };

  const requestMySeat = async () => {
    if (!profile) return;
    setRequestingSeat(true);
    try {
      const { error } = await supabase.rpc('request_room_seat', { p_room_id: id });
      if (error) throw new Error(error.message);
      setMyPendingRequest(true);
      Alert.alert('أُرسل الطلب', 'أُبلغ طاقم الغرفة بطلبك للصعود إلى المنصة.');
    } catch (error: unknown) {
      Alert.alert('تعذر إرسال طلب الصعود', error instanceof Error ? error.message : 'حاول مرة أخرى.');
    } finally {
      setRequestingSeat(false);
    }
  };

  const cancelMySeatRequest = async () => {
    if (!profile) return;
    setRequestingSeat(true);
    try {
      const { error } = await supabase.rpc('cancel_room_seat_request', { p_room_id: id });
      if (error) throw new Error(error.message);
      setMyPendingRequest(false);
    } catch (error: unknown) {
      Alert.alert('تعذر إلغاء الطلب', error instanceof Error ? error.message : 'حاول مرة أخرى.');
    } finally {
      setRequestingSeat(false);
    }
  };

  const toggleMic = async () => {
    if (mySeat === null || micLoading) return;
    const seat = seats.find(s => s.seat_index === mySeat);
    if (!seat) return;

    const newMute = !isMuted;
    if (!newMute && (!lkRoomRef.current || voiceState !== VOICE_ON)) {
      Alert.alert('الصوت غير متاح', 'يجب تفعيل خدمة الصوت الحي على الخادم قبل استخدام الميكروفون.');
      return;
    }

    if (!newMute && Platform.OS === 'android') {
      const permission = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        {
          title: 'إذن الميكروفون',
          message: 'يحتاج Wattar إلى إذن الميكروفون لتتمكن من التحدث داخل الغرف الصوتية.',
          buttonPositive: 'السماح',
          buttonNegative: 'إلغاء',
        },
      );
      if (permission !== PermissionsAndroid.RESULTS.GRANTED) {
        Alert.alert('إذن الميكروفون مطلوب', 'اسمح باستخدام الميكروفون من إعدادات الجهاز للمشاركة بالصوت.');
        return;
      }
    }

    setMicLoading(true);
    try {
      await setMicEnabled(lkRoomRef.current, !newMute);
      const { error } = await supabase.rpc('set_room_mic', {
        p_room_id: id,
        p_enabled: !newMute,
      });
      if (error) throw error;
      setIsMuted(newMute);
    } catch (error: unknown) {
      Alert.alert('تعذر تغيير الميكروفون', error instanceof Error ? error.message : 'تحقق من الإذن وحاول مرة أخرى.');
    } finally {
      setMicLoading(false);
    }
  };

  const leaveRoom = async () => {
    if (mySeat !== null) await leaveSeat();
    router.back();
  };

  const submitRoomPassword = async () => {
    setPasswordChecking(true);
    try {
      await callFunction<{ url?: string; token?: string }>('livekit-token', {
        room_id: id!,
        password: passwordInput.trim(),
      });
      voicePasswordRef.current = passwordInput.trim();
      setVoiceGate('open');
      setPasswordPromptVisible(false);
      setPasswordInput('');
    } catch (error: unknown) {
      const cause: any = (error as any)?.cause;
      const code: string = cause?.error ?? (error as Error)?.message ?? '';
      if (code === 'LIVEKIT_NOT_CONFIGURED' || String(code).includes('LIVEKIT_NOT_CONFIGURED')) {
        voicePasswordRef.current = passwordInput.trim();
        setVoiceGate('open');
        setPasswordPromptVisible(false);
        setPasswordInput('');
        Alert.alert(
          'تم التحقق من كلمة المرور',
          'كلمة المرور صحيحة. خدمة الصوت الحي غير مضبوطة على الخادم، تعمل الغرفة بدون صوت.',
        );
        return;
      }
      if (code === 'WRONG_ROOM_PASSWORD') {
        Alert.alert('كلمة مرور غير صحيحة', 'كلمة مرور الغرفة غير صحيحة. حاول مجدداً.');
        return;
      }
      if (code === 'ROOM_PASSWORD_LOCKED') {
        Alert.alert('محاولات كثيرة', 'أُقفلت محاولات الدخول مؤقتاً بسبب كلمات مرور خاطئة متكررة. انتظر عشر دقائق ثم أعد المحاولة.');
        return;
      }
      Alert.alert('خطأ', code || 'تعذر التحقق من كلمة المرور. حاول مرة أخرى.');
    } finally {
      setPasswordChecking(false);
    }
  };

  const performManageAction = async (
    action: string,
    targetUserId?: string | null,
    durationMinutes?: number,
    password?: string,
  ) => {
    if (!profile || !room) return;
    if (targetUserId && targetUserId === profile.id) {
      Alert.alert('إجراء غير صالح', 'لا يمكنك تطبيق الإجراء على نفسك.');
      return;
    }
    setModeratingUserId(targetUserId ?? 'room');
    try {
      const response = await callFunction<{
        audio_kick?: 'applied' | 'not_configured' | 'failed' | null;
        audio_mute?: 'applied' | 'not_configured' | 'failed' | null;
      }>('room-manage-action', {
        room_id: id,
        action,
        ...(targetUserId ? { target_user_id: targetUserId } : {}),
        ...(durationMinutes !== undefined ? { duration_minutes: durationMinutes } : {}),
        ...(password !== undefined ? { password } : {}),
      });
      if (action === 'close_room') setRoom((current: typeof room) => current ? { ...current, status: 'closed' } : current);
      else if (action === 'reopen_room') setRoom((current: typeof room) => current ? { ...current, status: 'live' } : current);
      else if (action === 'lock_seats') setRoom((current: typeof room) => current ? { ...current, seats_locked: true } : current);
      else if (action === 'unlock_seats') setRoom((current: typeof room) => current ? { ...current, seats_locked: false } : current);
      else if (action === 'mute_audience') setRoom((current: typeof room) => current ? { ...current, audience_muted: true } : current);
      else if (action === 'unmute_audience') setRoom((current: typeof room) => current ? { ...current, audience_muted: false } : current);
      else if (action === 'set_password') setRoom((current: typeof room) => current ? { ...current, has_password: true } : current);
      else if (action === 'clear_password') setRoom((current: typeof room) => current ? { ...current, has_password: false } : current);
      // تحديث موجه بعد الإجراء (بدل إعادة تحميل الغرفة كاملة — أسرع بكثير)
      await Promise.all([
        loadSeats().catch(() => undefined),
        action === 'accept_seat_request' || action === 'reject_seat_request'
          ? loadPendingRequests()
          : Promise.resolve(),
        attendanceVisible ? loadAttendance(false) : Promise.resolve(),
      ]);
      if (['appoint_moderator', 'remove_moderator', 'appoint_second_admin', 'remove_second_admin', 'handover_owner', 'kick_user', 'ban_user'].includes(action)) {
        await loadMyRoomPermissions().catch(() => undefined);
        await loadAttendance(false).catch(() => undefined);
      }

      if (action === 'lower_user') Alert.alert('تمت الإزالة', 'تم إنزال المتحدث من المنصة.');
      else if (action === 'kick_user') {
        const kicked = response.audio_kick === 'applied' ? 'تم فصله من الصوت المباشر.'
          : response.audio_kick === 'not_configured' ? 'تم إخلاء المقعد، لكن خدمة الصوت غير مهيأة.'
          : response.audio_kick === 'failed' ? 'تم إخلاء المقعد، وتعذر فصله من الصوت.'
          : '';
        Alert.alert('تم طرد المستخدم', kicked ? kicked : 'تم طرد المستخدم من الغرفة.');
      } else if (action === 'ban_user') Alert.alert('تم الحظر', 'تم حظر المستخدم من الغرفة.');
      else if (action === 'unban_user') Alert.alert('تم الرفع', 'تم رفع الحظر عن المستخدم.');
      else if (action === 'mute_mic') Alert.alert('تم الكتم', 'ميكروفون المتحدث مكتوم.');
      else if (action === 'unmute_mic') Alert.alert('تم التفعيل', 'ميكروفون المتحدث مفعل.');
      else if (action === 'mute_chat') Alert.alert('تم كتم المحادثة', `لن يتمكن المستخدم من إرسال الرسائل لمدة ${durationMinutes} دقيقة.`);
      else if (action === 'unmute_chat') Alert.alert('تم الإلغاء', 'تم إلغاء كتم محادثة المستخدم.');
      else if (action === 'appoint_moderator') Alert.alert('تم التعيين', 'تم تعيين المستخدم مشرفاً على الغرفة.');
      else if (action === 'remove_moderator') Alert.alert('تم الإزالة', 'تمت إزالة المستخدم من إشراف الغرفة.');
      else if (action === 'appoint_second_admin') Alert.alert('تم التعيين', 'تم تعيين مدير ثاني للغرفة.');
      else if (action === 'remove_second_admin') Alert.alert('تم الإزالة', 'تمت إزالة صلاحيات المدير الثاني.');
      else if (action === 'handover_owner') Alert.alert('تم التسليم', 'تم تسليم إدارة الغرفة للمستخدم الجديد.');
      else if (action === 'accept_seat_request') Alert.alert('تم القبول', 'تم قبول طلب الصعود.');
      else if (action === 'reject_seat_request') Alert.alert('تم الرفض', 'تم رفض طلب الصعود.');
    } catch (error: unknown) {
      Alert.alert('تعذر تنفيذ الإجراء', error instanceof Error ? error.message : 'حاول مرة أخرى.');
    } finally {
      setModeratingUserId(null);
    }
  };

  const openKickConfirm = (userId: string | null, name: string) => {
    Alert.alert('طرد من الغرفة؟', `سيتم طرد ${name} وإخلاء مقعده.`, [
      { text: 'تأكيد الطرد', style: 'destructive', onPress: () => userId && performManageAction('kick_user', userId) },
      { text: 'إلغاء', style: 'cancel' },
    ]);
  };

  const openBanDialog = (userId: string | null, name: string) => {
    Alert.alert('حظر من الغرفة؟', `اختر مدة الحظر لـ ${name}:`, [
      { text: 'دائم', style: 'destructive', onPress: () => userId && performManageAction('ban_user', userId) },
      { text: 'ساعة واحدة', onPress: () => userId && performManageAction('ban_user', userId, 60) },
      { text: 'يوم واحد', onPress: () => userId && performManageAction('ban_user', userId, 1440) },
      { text: 'إلغاء', style: 'cancel' },
    ]);
  };

  const openMuteChatDialog = (userId: string | null, name: string) => {
    Alert.alert('كتم المحادثة؟', `سيتم كتم محادثة ${name}. اختر المدة:`, [
      { text: '15 دقيقة', onPress: () => userId && performManageAction('mute_chat', userId, 15) },
      { text: 'ساعة واحدة', onPress: () => userId && performManageAction('mute_chat', userId, 60) },
      { text: 'إلغاء', style: 'cancel' },
    ]);
  };

  const openHandoverConfirm = (userId: string | null, name: string) => {
    Alert.alert('تسليم الإدارة؟', `سيتم نقل إدارة الغرفة إلى ${name} وتصبح عضواً عادياً.`, [
      { text: 'تأكيد التسليم', style: 'destructive', onPress: () => userId && performManageAction('handover_owner', userId) },
      { text: 'إلغاء', style: 'cancel' },
    ]);
  };

  const openMemberActions = (seat: Seat) => {
    if (!seat.user_id || seat.user_id === profile?.id || !room || seat.is_owner_seat) return;
    const memberName = seat.user?.display_name ?? seat.user?.username ?? 'هذا المستخدم';
    const isMod = moderatorIds.includes(seat.user_id);
    const options: Array<{ text: string; style?: 'destructive' | 'cancel'; onPress?: () => void }> = [];
    options.push({ text: 'إنزال من المنصة', style: 'destructive', onPress: () => performManageAction('lower_user', seat.user_id) });
    options.push({ text: 'طرد من الغرفة', style: 'destructive', onPress: () => openKickConfirm(seat.user_id, memberName) });
    options.push({ text: 'حظر من الغرفة', onPress: () => openBanDialog(seat.user_id, memberName) });
    if (canManageModerators) {
      options.push(isMod ? { text: 'إزالة من الإشراف', onPress: () => performManageAction('remove_moderator', seat.user_id) }
        : { text: 'تعيين مشرفاً', onPress: () => performManageAction('appoint_moderator', seat.user_id) });
    }
    options.push(seat.is_mic_on ? { text: 'كتم الميكروفون', onPress: () => performManageAction('mute_mic', seat.user_id) }
      : { text: 'تشغيل الميكروفون', onPress: () => performManageAction('unmute_mic', seat.user_id) });
    options.push({ text: 'كتم المحادثة', onPress: () => openMuteChatDialog(seat.user_id, memberName) });
    if ((myRole === 'owner' || myRole === 'admin') && !isMod) {
      if (room.second_admin_id === seat.user_id) {
        options.push({ text: 'إزالة المدير الثاني', onPress: () => performManageAction('remove_second_admin', seat.user_id) });
      } else {
        options.push({ text: 'تعيين مدير ثاني', onPress: () => performManageAction('appoint_second_admin', seat.user_id) });
      }
      options.push({ text: 'تسليم الإدارة', onPress: () => openHandoverConfirm(seat.user_id, memberName) });
    }
    options.push({ text: 'إلغاء', style: 'cancel' });
    Alert.alert(`إدارة ${memberName}`, 'اختر الإجراء المطلوب:',
      options.map(o => ({ text: o.text, style: o.style, onPress: o.onPress })));
  };

  const closeRoom = () => {
    if (!room) return;
    Alert.alert('إغلاق الغرفة؟', 'سيتم إنهاء الجلسة وإخلاء المقاعد. ستبقى الغرفة وسجلها محفوظين.', [
      { text: 'إغلاق الغرفة', style: 'destructive', onPress: () => performManageAction('close_room') },
      { text: 'إلغاء', style: 'cancel' },
    ]);
  };

  const reopenRoom = () => performManageAction('reopen_room');

  const toggleSeatsLock = () => performManageAction(room.seats_locked ? 'unlock_seats' : 'lock_seats');
  const toggleAudience = () => performManageAction(room.audience_muted ? 'unmute_audience' : 'mute_audience');

  const openPasswordManager = () => {
    setManageSheetVisible(false);
    if (room.has_password) {
      Alert.alert('كلمة مرور الغرفة', 'توجد كلمة مرور على الغرفة حالياً.', [
        { text: 'إزالة كلمة المرور', style: 'destructive', onPress: () => performManageAction('clear_password') },
        { text: 'تغيير كلمة المرور', onPress: () => setPasswordPromptVisible(true) },
        { text: 'إلغاء', style: 'cancel' },
      ]);
    } else {
      setPasswordPromptVisible(true);
    }
  };

  const openRequestsSheet = () => {
    setManageSheetVisible(false);
    setRequestsSheetVisible(true);
    void loadPendingRequests();
  };
  const openAuditSheet = () => {
    setManageSheetVisible(false);
    setAuditSheetVisible(true);
    void loadAuditLog();
  };
  const openAttendance = () => {
    setManageSheetVisible(false);
    setAttendanceVisible(true);
    void loadAttendance();
  };

  // إجراءات على حاضر (متحدث أو مستمع) من قائمة الحضور
  const openAttendeeActions = (attendee: typeof attendees[number]) => {
    if (attendee.user_id === profile?.id || attendee.is_owner) return;
    const memberName = attendee.display_name ?? attendee.username;
    if (!canManage) {
      router.push(`/user/${attendee.user_id}`);
      return;
    }
    const options: Array<{ text: string; style?: 'destructive' | 'cancel'; onPress?: () => void }> = [];
    if (attendee.is_speaker) {
      options.push({ text: 'إنزال من المنصة', style: 'destructive', onPress: () => performManageAction('lower_user', attendee.user_id) });
    }
    options.push({ text: 'طرد من الغرفة', style: 'destructive', onPress: () => openKickConfirm(attendee.user_id, memberName) });
    options.push({ text: 'حظر من الغرفة', onPress: () => openBanDialog(attendee.user_id, memberName) });
    options.push({ text: 'كتم المحادثة', onPress: () => openMuteChatDialog(attendee.user_id, memberName) });
    if (canManageModerators) {
      const isMod = moderatorIds.includes(attendee.user_id);
      options.push(isMod
        ? { text: 'إزالة من الإشراف', onPress: () => performManageAction('remove_moderator', attendee.user_id) }
        : { text: 'تعيين مشرفاً', onPress: () => performManageAction('appoint_moderator', attendee.user_id) });
    }
    if ((myRole === 'owner' || myRole === 'admin') && !moderatorIds.includes(attendee.user_id)) {
      if (room?.second_admin_id === attendee.user_id) {
        options.push({ text: 'إزالة المدير الثاني', onPress: () => performManageAction('remove_second_admin', attendee.user_id) });
      } else {
        options.push({ text: 'تعيين مدير ثاني', onPress: () => performManageAction('appoint_second_admin', attendee.user_id) });
      }
    }
    options.push({ text: 'عرض الملف الشخصي', onPress: () => router.push(`/user/${attendee.user_id}`) });
    options.push({ text: 'إلغاء', style: 'cancel' });
    Alert.alert(`إدارة ${memberName}`, 'اختر الإجراء المطلوب:',
      options.map(o => ({ text: o.text, style: o.style, onPress: o.onPress })));
  };

  // المودال المتعرّف automatisch lorsque la porte du mot de passe est requise
  useEffect(() => {
    setPasswordPromptVisible(voiceGate === 'required');
  }, [voiceGate]);

  const takeSeat = async (seatIndex: number) => {
    if (!profile) return;
    const seat = seats.find(s => s.seat_index === seatIndex);
    if (!seat) return;
    if (seat.status === 'locked') {
      if (mySeat === null) {
        Alert.alert('المقاعد مقفلة', 'المقاعد مقفلة حالياً؛ لا يمكن الانضمام مباشرة إلى المنصة.', [
          myPendingRequest
            ? { text: 'إلغاء طلبي', onPress: cancelMySeatRequest }
            : { text: 'إرسال طلب صعود', onPress: requestMySeat },
          { text: 'إلغاء', style: 'cancel' },
        ]);
      } else {
        Alert.alert('المقاعد مقفلة', 'لا يمكنك تغيير المقاعد بينما المقاعد مقفلة.');
      }
      return;
    }
    if (seat.status !== 'empty') return;

    const { error } = await supabase.rpc('claim_room_seat', {
      p_room_id: id,
      p_seat_index: seatIndex,
    });

    if (error) {
      Alert.alert('خطأ', error.message || 'فشل احتلال المقعد');
    } else {
      setMySeat(seatIndex);
    }
  };

  const openRoomInvites = async () => {
    setShowRoomInvites(true);
    setInvitesLoading(true);
    try {
      const { data, error } = await supabase.rpc('list_my_friends');
      if (error) throw error;
      setInviteFriends((data ?? []) as Array<{ user_id: string; username: string; display_name: string | null }>);
    } catch (error: unknown) {
      setShowRoomInvites(false);
      Alert.alert('تعذر تحميل الأصدقاء', error instanceof Error ? error.message : 'حاول مرة أخرى.');
    } finally {
      setInvitesLoading(false);
    }
  };

  const sendRoomInvite = async (target: { user_id: string; username: string; display_name: string | null }) => {
    setInvitingUserId(target.user_id);
    try {
      const { data, error } = await supabase.rpc('send_room_invitation', {
        p_room_id: id,
        p_recipient_id: target.user_id,
      });
      if (error) throw error;
      if (typeof data !== 'string') throw new Error('لم يتم إنشاء الدعوة');
      Alert.alert('تم إرسال الدعوة', `دعوت ${target.display_name || target.username} إلى الغرفة.`);
      setInviteFriends((items) => items.filter((item) => item.user_id !== target.user_id));
    } catch (error: unknown) {
      Alert.alert('تعذر إرسال الدعوة', error instanceof Error ? error.message : 'حاول مرة أخرى.');
    } finally {
      setInvitingUserId(null);
    }
  };

  if (!room && roomLoading) {
    return (
      <View style={styles.loading}>
        <StatusBar style="light" />
        <LinearGradient colors={gradients.screen} style={StyleSheet.absoluteFill} pointerEvents="none" />
        <ActivityIndicator size="large" color={colors.roomTeal} />
        <Text style={styles.loadingHint}>جاري تجهيز غرفتك...</Text>
      </View>
    );
  }
  if (!room) {
    return (
      <View style={styles.loading}>
        <StatusBar style="light" />
        <LinearGradient colors={gradients.screen} style={StyleSheet.absoluteFill} pointerEvents="none" />
        <Text style={styles.loadErrorTitle}>ما قدرنا نفتح الغرفة</Text>
        <Text style={styles.loadErrorMessage}>{roomError ?? 'حدث خطأ غير متوقع.'}</Text>
        <TouchableOpacity
          style={styles.retryButton}
          onPress={() => loadRoom().catch((error: unknown) => {
            setRoomError(error instanceof Error ? error.message : 'تعذر تحميل الغرفة');
          })}
        >
          <Text style={styles.retryButtonText}>إعادة المحاولة</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>العودة</Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (room.status === 'closed') {
    return (
      <View style={styles.loading}>
        <StatusBar style="light" />
        <LinearGradient colors={gradients.screen} style={StyleSheet.absoluteFill} pointerEvents="none" />
        <Text style={styles.loadErrorTitle}>الغرفة مغلقة</Text>
        <Text style={styles.loadErrorMessage}>انتهت الجلسة. الغرفة وسجلها محفوظان ولا يمكن إرسال رسائل أو الانضمام إلى المقاعد.</Text>
        {canManage && (
          <TouchableOpacity style={styles.retryButton} onPress={reopenRoom}>
            <Text style={styles.retryButtonText}>إعادة فتح الغرفة</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.retryButton} onPress={() => router.back()}>
          <Text style={styles.retryButtonText}>العودة</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <RoomAmbience coverUrl={room.cover_url} />
      <StatusBar style="light" />
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          onPress={leaveRoom}
          style={styles.iconBtn}
          accessibilityRole="button"
          accessibilityLabel="مغادرة الغرفة"
        >
          <LogOut size={20} color={colors.roomMuted} />
        </TouchableOpacity>
        <View style={styles.roomInfo}>
          <View style={styles.roomTitleRow}>
            <Text style={styles.roomName} numberOfLines={1}>{room.name}</Text>
            {voiceState === VOICE_ON && (
              <View style={styles.liveBadge}>
                <LiveEqualizer bars={4} height={9} width={2} gap={1.5} color={colors.inkDark} />
              </View>
            )}
          </View>
          <View style={styles.roomMeta}>
            <TouchableOpacity
              style={styles.listenersChip}
              onPress={openAttendance}
              accessibilityRole="button"
              accessibilityLabel={`عرض الحضور: ${listenersCount} مستمع و${speakersCount} متحدث`}
            >
              <View style={styles.speakerStack}>
                {seats
                  .filter(seat => seat.status === 'occupied' && seat.user_id)
                  .slice(0, 3)
                  .map((seat, index) => (
                    <View key={seat.id} style={[styles.speakerStackItem, index > 0 && styles.speakerStackOverlap]}>
                      <Avatar
                        size={15}
                        uri={seat.user?.avatar_url}
                        name={seat.user?.display_name ?? seat.user?.username}
                      />
                    </View>
                  ))}
              </View>
              <Text style={styles.roomMetaText}>{listenersCount} مستمع · {speakersCount} متحدث</Text>
            </TouchableOpacity>
            {/* مؤشر حالة الصوت الحي */}
            {voiceState === VOICE_ON && (
              <View style={styles.voiceChipOn}>
                <Text style={styles.voiceChipText}>صوت مباشر</Text>
              </View>
            )}
            {voiceState === VOICE_CONNECTING && (
              <View style={styles.voiceChipWait}>
                <Text style={styles.voiceChipText}>…جاري الاتصال</Text>
              </View>
            )}
            {voiceState === VOICE_UNAVAILABLE && (
              <TouchableOpacity
                style={styles.voiceChipOff}
                onPress={() => Alert.alert('الصوت غير متاح', voiceError ?? 'تعذر الاتصال بخدمة الصوت.')}
                accessibilityRole="button"
                accessibilityLabel="عرض سبب عدم توفر الصوت"
              >
                <VolumeX size={10} color={colors.roomMuted} />
                <Text style={styles.voiceChipTextDim}>الصوت غير متاح</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={openRoomInvites}
          accessibilityRole="button"
          accessibilityLabel="دعوة الأصدقاء"
        >
          <UserPlus size={20} color={colors.roomPrimary} />
        </TouchableOpacity>
        {isFullManager ? (
          <TouchableOpacity
            style={[styles.iconBtn, styles.ownerCloseBtn]}
            onPress={() => setManageSheetVisible(true)}
            disabled={moderatingUserId === 'room'}
            accessibilityRole="button"
            accessibilityLabel="إدارة الغرفة"
          >
            {moderatingUserId === 'room'
              ? <ActivityIndicator size="small" color={colors.roomPrimary} />
              : <Shield size={20} color={colors.roomPrimary} />}
            {pendingRequests.length > 0 && moderatingUserId !== 'room' && (
              <View style={styles.requestBadge}>
                <Text style={styles.requestBadgeText}>
                  {pendingRequests.length > 9 ? '9+' : pendingRequests.length}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        ) : canManage ? (
          <TouchableOpacity
            style={[styles.iconBtn, styles.ownerCloseBtn]}
            onPress={closeRoom}
            disabled={moderatingUserId === 'room'}
            accessibilityRole="button"
            accessibilityLabel="إغلاق الغرفة"
          >
            {moderatingUserId === 'room'
              ? <ActivityIndicator size="small" color={colors.danger} />
              : <X size={20} color={colors.danger} />}
          </TouchableOpacity>
        ) : null}
      </View>

      <GiftTicker entries={giftFeed} />

      {/* Seats Grid */}
      <View style={styles.seatsContainer}>
        <LinearGradient
          colors={['rgba(169,71,245,0.10)', 'rgba(88,214,193,0.03)', 'rgba(10,7,18,0)']}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <View style={styles.sectionHeading}>
          <View style={styles.sectionTitleWrap}>
            <View style={styles.sectionAccent} />
            <Text style={styles.sectionTitle}>المنصة الصوتية</Text>
          </View>
          <Text style={styles.sectionCount}>{seats.filter(seat => seat.status === 'occupied').length}/{room.seat_count}</Text>
        </View>
        <ScrollView contentContainerStyle={styles.seatsGrid}>
          {seats.map(seat => (
            <SeatView
              key={seat.id}
              seat={seat}
              mySeat={mySeat}
              isOwner={room.owner_id === profile?.id}
              isFullManager={isFullManager}
              seatsLocked={!!room.seats_locked}
              canModerate={canManage && seat.user_id !== profile?.id && !seat.is_owner_seat}
              onTake={() => takeSeat(seat.seat_index)}
              onProfile={() => {
                if (seat.user_id && seat.user_id !== profile?.id) router.push(`/user/${seat.user_id}`);
              }}
              onModerate={() => openMemberActions(seat)}
              moderationDisabled={moderatingUserId === seat.user_id}
              onSeatPosition={(userId, pos) => { seatPositionsRef.current[userId] = pos; }}
            />
          ))}
        </ScrollView>
      </View>

      {/* Chat */}
      <View style={styles.chatContainer}>
        <View style={styles.chatHeading}>
          <View style={styles.sectionTitleWrap}>
            <View style={[styles.sectionAccent, styles.chatAccent]} />
            <Text style={styles.sectionTitle}>محادثة الغرفة</Text>
          </View>
          <Text style={styles.chatHeadingHint}>تواصل بأدب واحترام</Text>
        </View>
        <FlatList
          ref={chatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            item.is_system ? (
              <MessageEntrance>
                <View style={styles.systemMessage} accessibilityRole="text">
                  <View style={styles.systemMessageRule} />
                  <Text style={styles.systemMessageText}>{item.message}</Text>
                  <View style={styles.systemMessageRule} />
                </View>
              </MessageEntrance>
            ) : (() => {
              const isMine = item.user_id === profile?.id;
              return (
                <MessageEntrance>
                  <View style={[styles.messageItem, isMine ? styles.ownMessageItem : styles.otherMessageItem]}>
                  <View style={[styles.messageAvatar, isMine && styles.ownMessageAvatar]}>
                    <Text style={styles.messageAvatarText}>
                      {(item.user?.display_name ?? item.user?.username ?? 'م')[0]?.toUpperCase()}
                    </Text>
                  </View>
                  <View style={[styles.messageBubble, isMine ? styles.ownMessageBubble : styles.otherMessageBubble]}>
                    <View style={styles.messageMeta}>
                      <View style={styles.messageUserRow}>
                        <Text style={[styles.messageUser, isMine && styles.ownMessageUser]} numberOfLines={1}>
                          {item.user?.display_name ?? item.user?.username ?? 'عضو'}
                        </Text>
                        {typeof item.user?.level === 'number' && item.user.level > 0 && (
                          <LevelBadge level={item.user.level} />
                        )}
                        {flagEmoji(item.user?.country_code) ? (
                          <Text style={styles.messageFlag}>{flagEmoji(item.user?.country_code)}</Text>
                        ) : null}
                      </View>
                      <Text style={styles.messageTime}>
                        {new Date(item.created_at).toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' })}
                      </Text>
                    </View>
                    <Text style={[
                      styles.messageText,
                      { fontSize: chatFontSize },
                      item.pending && styles.pendingMessage,
                    ]}>
                      {item.message}
                    </Text>
                    {item.pending && <Text style={styles.pendingLabel}>يُرسل...</Text>}
                  </View>
                </View>
                </MessageEntrance>
              );
            })()
          )}
          contentContainerStyle={[styles.chatList, messages.length === 0 && styles.chatListEmpty]}
          ListEmptyComponent={(
            <View style={styles.chatEmpty}>
              <View style={styles.chatEmptyIcon}><Users size={20} color={colors.gold} /></View>
              <Text style={styles.chatEmptyTitle}>ابدأ الحديث</Text>
              <Text style={styles.chatEmptyHint}>كن أول من يشارك رسالة مع أهل الغرفة</Text>
            </View>
          )}
          onContentSizeChange={() => chatListRef.current?.scrollToEnd()}
          accessibilityLabel="رسائل محادثة الغرفة"
        />
      </View>

      {/* M6: طلب الصعود — زر دائم لجمهور الغرفة */}
      {mySeat === null && !canManage && (
        <View style={styles.seatRequestBar}>
          {myPendingRequest ? (
            <>
              <Text style={styles.seatRequestPending}>طلبك قيد مراجعة طاقم الغرفة</Text>
              <TouchableOpacity
                style={styles.seatRequestCancel}
                onPress={cancelMySeatRequest}
                disabled={requestingSeat}
                accessibilityRole="button"
                accessibilityLabel="إلغاء طلب الصعود"
              >
                <Text style={styles.seatRequestCancelText}>إلغاء</Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity
              style={styles.seatRequestBtn}
              onPress={requestMySeat}
              disabled={requestingSeat}
              accessibilityRole="button"
              accessibilityLabel="إرسال طلب صعود إلى المنصة"
            >
              {requestingSeat
                ? <ActivityIndicator size="small" color={colors.inkGold} />
                : <Text style={styles.seatRequestBtnText}>رفع اليد للصعود إلى المنصة</Text>}
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Input Bar */}
      {showEmojiPicker && (
        <View style={styles.emojiTray}>
          <Text style={styles.emojiTrayTitle}>أضف تعبيرًا</Text>
          <View style={styles.emojiGrid}>
            {CHAT_EMOJIS.map((emoji) => (
              <TouchableOpacity
                key={emoji}
                style={styles.emojiChoice}
                onPress={() => setNewMessage((current) => `${current}${emoji}`.slice(0, 500))}
                accessibilityRole="button"
                accessibilityLabel={`إضافة ${emoji}`}
              >
                <Text style={styles.emojiChoiceText}>{emoji}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}
      <View style={[styles.inputBar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
        <TouchableOpacity
          style={styles.giftBtn}
          onPress={() => setShowGifts(true)}
          accessibilityRole="button"
          accessibilityLabel="إرسال هدية"
        >
          <Gift size={22} color={colors.gold} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.emojiToggle, showEmojiPicker && styles.emojiToggleActive]}
          onPress={() => setShowEmojiPicker((visible) => !visible)}
          accessibilityRole="button"
          accessibilityLabel={showEmojiPicker ? 'إغلاق لوحة الإيموجي' : 'فتح لوحة الإيموجي'}
        >
          <Smile size={20} color={showEmojiPicker ? colors.gold : colors.roomMuted} />
        </TouchableOpacity>
        <TextInput
          style={styles.messageInput}
          value={newMessage}
          onChangeText={setNewMessage}
          onFocus={() => setShowEmojiPicker(false)}
          placeholder="اكتب رسالة..."
          placeholderTextColor={colors.roomMuted}
          onSubmitEditing={sendMessage}
          returnKeyType="send"
          maxLength={500}
          accessibilityLabel="اكتب رسالة في محادثة الغرفة"
        />
        <TouchableOpacity
          style={[styles.sendBtn, !newMessage.trim() && styles.sendBtnIdle]}
          onPress={sendMessage}
          accessibilityRole="button"
          accessibilityLabel="إرسال الرسالة"
        >
          <Send size={18} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Mic Control */}
      {mySeat !== null && (
        <View style={[styles.micControls, { paddingBottom: Math.max(insets.bottom, 10) }]}>
          <TouchableOpacity
            style={[styles.micBtn, isMuted ? styles.micMuted : styles.micActive, micLoading && styles.controlDisabled]}
            onPress={toggleMic}
            disabled={micLoading}
            accessibilityRole="button"
            accessibilityLabel={micLoading ? 'جارٍ تحديث الميكروفون' : isMuted ? 'تشغيل الميكروفون' : 'كتم الميكروفون'}
            accessibilityState={{ disabled: micLoading }}
          >
            {micLoading
              ? <ActivityIndicator size="small" color="#fff" />
              : isMuted ? <MicOff size={22} color="#fff" /> : <Mic size={22} color="#fff" />}
            <Text style={styles.micText}>{micLoading ? 'جارٍ التحديث...' : isMuted ? 'مكتوم' : 'تتحدث'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.leaveSeatBtn}
            onPress={leaveSeat}
            accessibilityRole="button"
            accessibilityLabel="ترك مقعد المتحدث"
          >
            <Text style={styles.leaveSeatText}>ترك المقعد</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Gifts Modal */}
      {showGifts && (
        <GiftsModal
          roomId={id}
          seats={seats}
          onClose={() => setShowGifts(false)}
          onGiftSent={handleGiftSent}
        />
      )}
      {giftCelebration && (
        giftCelebration.premium ? (
          <GiftScene
            gift={giftCelebration}
            combo={giftCombo}
            target={giftTarget}
            onDone={() => setGiftCelebration(null)}
          />
        ) : (
          <GiftCelebration
            gift={giftCelebration}
            combo={giftCombo}
            target={giftTarget}
            onDone={() => setGiftCelebration(null)}
          />
        )
      )}
      <Modal
        visible={showRoomInvites}
        transparent
        animationType="slide"
        onRequestClose={() => setShowRoomInvites(false)}
      >
        <View style={styles.inviteModalOverlay}>
          <View style={styles.inviteModal}>
            <View style={styles.inviteModalHeader}>
              <Text style={styles.inviteModalTitle}>دعوة صديق إلى الغرفة</Text>
              <TouchableOpacity onPress={() => setShowRoomInvites(false)} accessibilityLabel="إغلاق">
                <X size={21} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            {invitesLoading ? (
              <ActivityIndicator color={colors.roomTeal} style={styles.inviteLoading} />
            ) : inviteFriends.length ? (
              <ScrollView>
                {inviteFriends.map((friend) => (
                  <TouchableOpacity
                    key={friend.user_id}
                    style={styles.inviteFriendRow}
                    onPress={() => sendRoomInvite(friend)}
                    disabled={invitingUserId !== null}
                  >
                    <View style={styles.inviteFriendAvatar}>
                      <Text style={styles.inviteFriendInitial}>
                        {(friend.display_name || friend.username).slice(0, 1).toUpperCase()}
                      </Text>
                    </View>
                    <View style={styles.inviteFriendCopy}>
                      <Text style={styles.inviteFriendName}>{friend.display_name || friend.username}</Text>
                      <Text style={styles.inviteFriendUsername}>@{friend.username}</Text>
                    </View>
                    {invitingUserId === friend.user_id
                      ? <ActivityIndicator size="small" color={colors.roomPrimary} />
                      : <UserPlus size={18} color={colors.roomPrimary} />}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            ) : (
              <Text style={styles.inviteEmpty}>أضف أصدقاء أولًا من صفحة المجتمع لتتمكن من دعوتهم.</Text>
            )}
          </View>
        </View>
      </Modal>
      {/* M6: لوحة الإدارة السريعة */}
      <Modal visible={manageSheetVisible} transparent animationType="slide" onRequestClose={() => setManageSheetVisible(false)}>
        <View style={styles.manageModalOverlay}>
          <View style={styles.manageModal}>
            <Text style={styles.manageModalTitle}>إدارة الغرفة</Text>
            <TouchableOpacity style={styles.manageRow} onPress={toggleSeatsLock} activeOpacity={0.8}>
              <Lock size={18} color={room.seats_locked ? colors.gold : colors.roomMuted} />
              <Text style={styles.manageRowText}>{room.seats_locked ? 'فتح المقاعد' : 'قفل المقاعد'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.manageRow} onPress={toggleAudience} activeOpacity={0.8}>
              {room.audience_muted ? <Volume2 size={18} color={colors.roomMuted} /> : <VolumeX size={18} color={colors.roomPrimary} />}
              <Text style={styles.manageRowText}>{room.audience_muted ? 'إلغاء كتم الجمهور' : 'كتم الجمهور'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.manageRow} onPress={openPasswordManager} activeOpacity={0.8}>
              <Lock size={18} color={room.has_password ? colors.gold : colors.roomMuted} />
              <Text style={styles.manageRowText}>{room.has_password ? 'إدارة كلمة المرور' : 'تعيين كلمة مرور'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.manageRow} onPress={openAttendance} activeOpacity={0.8}>
              <Users size={18} color={colors.roomTeal} />
              <Text style={styles.manageRowText}>الحضور في الغرفة</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.manageRow} onPress={openRequestsSheet} activeOpacity={0.8}>
              <Users size={18} color={colors.roomPrimary} />
              <Text style={styles.manageRowText}>طلبات الصعود{pendingRequests.length > 0 ? ` (${pendingRequests.length})` : ''}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.manageRow} onPress={openAuditSheet} activeOpacity={0.8}>
              <Users size={18} color={colors.roomMuted} />
              <Text style={styles.manageRowText}>سجل التغييرات</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.manageRow} onPress={room.status === 'closed' ? reopenRoom : closeRoom} activeOpacity={0.8}>
              <X size={18} color={colors.danger} />
              <Text style={styles.manageRowText}>{room.status === 'closed' ? 'إعادة فتح الغرفة' : 'إغلاق الغرفة'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.manageRow, styles.manageCloseRow]} onPress={() => setManageSheetVisible(false)} activeOpacity={0.8}>
              <Text style={styles.manageRowText}>إغلاق القائمة</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      {/* مودال كلمة مرور الغرفة */}
      <Modal visible={passwordPromptVisible} transparent animationType="fade" onRequestClose={() => setPasswordPromptVisible(false)}>
        <View style={styles.passwordOverlay}>
          <View style={styles.passwordModal}>
            <Text style={styles.manageModalTitle}>{room.has_password ? 'تغيير كلمة مرور الغرفة' : 'تعيين كلمة مرور الغرفة'}</Text>
            <TextInput
              style={styles.passwordInput}
              value={passwordInput}
              onChangeText={setPasswordInput}
              secureTextEntry
              placeholder="كلمة المرور (من 4 إلى 50 حرف)"
              placeholderTextColor={colors.roomMuted}
            />
            <View style={styles.passwordActions}>
              <TouchableOpacity style={styles.passwordCancel} onPress={() => setPasswordPromptVisible(false)} activeOpacity={0.8}>
                <Text style={styles.passwordCancelText}>إلغاء</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.passwordConfirm} onPress={submitRoomPassword} activeOpacity={0.8} disabled={passwordChecking}>
                <Text style={styles.passwordConfirmText}>{passwordChecking ? 'جارٍ التحقق...' : 'تأكيد'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      {/* مودال طلبات الصعود */}
      <Modal visible={requestsSheetVisible} transparent animationType="slide" onRequestClose={() => setRequestsSheetVisible(false)}>
        <View style={styles.manageModalOverlay}>
          <View style={styles.manageModal}>
            <Text style={styles.manageModalTitle}>طلبات الصعود ({pendingRequests.length})</Text>
            {pendingRequests.length === 0 ? (
              <Text style={styles.manageRowText}>لا توجد طلبات قيد الانتظار.</Text>
            ) : pendingRequests.map((req) => (
              <React.Fragment key={req.id}>
                <TouchableOpacity style={styles.requestRow} onPress={() => performManageAction('accept_seat_request', req.user_id)} activeOpacity={0.8}>
                  <Text style={styles.requestRowName}>{req.user?.display_name ?? req.user?.username ?? 'مستخدم'}</Text>
                  <Text style={styles.requestRowTime}>{new Date(req.requested_at).toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' })}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.rejectBtn} onPress={() => performManageAction('reject_seat_request', req.user_id)} activeOpacity={0.8}>
                  <Text style={styles.rejectText}>رفض</Text>
                </TouchableOpacity>
              </React.Fragment>
            ))}
            <TouchableOpacity style={[styles.manageRow, styles.manageCloseRow]} onPress={() => setRequestsSheetVisible(false)} activeOpacity={0.8}>
              <Text style={styles.manageRowText}>إغلاق</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      {/* مودال الحضور في الغرفة */}
      <Modal visible={attendanceVisible} transparent animationType="slide" onRequestClose={() => setAttendanceVisible(false)}>
        <View style={styles.manageModalOverlay}>
          <View style={styles.manageModal}>
            <Text style={styles.manageModalTitle}>الحضور في الغرفة ({attendees.length})</Text>
            {attendanceLoading && attendees.length === 0 ? (
              <ActivityIndicator color={colors.roomTeal} style={{ marginVertical: 18 }} />
            ) : attendees.length === 0 ? (
              <Text style={styles.manageRowText}>لا يوجد أحد في الغرفة حالياً.</Text>
            ) : (
              <ScrollView nestedScrollEnabled>
                {attendees.map((attendee) => {
                  const roleLabel = attendee.is_owner ? 'المالك'
                    : attendee.role === 'second_admin' ? 'المدير الثاني'
                    : attendee.role === 'moderator' ? 'مشرف'
                    : attendee.role === 'admin' ? 'الإدارة'
                    : attendee.role === 'agency_manager' || attendee.role === 'agency_agent' ? 'الوكالة'
                    : attendee.is_speaker ? 'متحدث' : 'مستمع';
                  return (
                    <TouchableOpacity
                      key={attendee.user_id}
                      style={styles.attendeeRow}
                      onPress={() => openAttendeeActions(attendee)}
                      activeOpacity={0.8}
                    >
                      <View style={styles.inviteFriendAvatar}>
                        {attendee.avatar_url ? (
                          <Image source={{ uri: attendee.avatar_url }} style={styles.seatAvatarImg} />
                        ) : (
                          <Text style={styles.inviteFriendInitial}>
                            {(attendee.display_name ?? attendee.username).slice(0, 1).toUpperCase()}
                          </Text>
                        )}
                      </View>
                      <View style={styles.inviteFriendCopy}>
                        <Text style={styles.inviteFriendName}>{attendee.display_name ?? attendee.username}</Text>
                        <Text style={styles.attendeeRole}>
                          {roleLabel}
                          {attendee.is_speaker ? (attendee.is_mic_on ? ' · يتحدث' : ' · ميكروفون مقفل') : ''}
                        </Text>
                      </View>
                      {attendee.user_id === profile?.id && (
                        <Text style={styles.attendeeSelf}>أنت</Text>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
            <TouchableOpacity style={[styles.manageRow, styles.manageCloseRow]} onPress={() => setAttendanceVisible(false)} activeOpacity={0.8}>
              <Text style={styles.manageRowText}>إغلاق</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      {/* مودل سجل التغييرات */}
      <Modal visible={auditSheetVisible} transparent animationType="slide" onRequestClose={() => setAuditSheetVisible(false)}>
        <View style={styles.manageModalOverlay}>
          <View style={styles.manageModal}>
            <Text style={styles.manageModalTitle}>سجل تغييرات الغرفة</Text>
            {auditLog.length === 0 ? (
              <Text style={styles.manageRowText}>لا توجد تغييرات مسجلة.</Text>
            ) : auditLog.map((entry) => (
              <View key={`${entry.created_at}-${entry.action}-${entry.target?.username ?? ''}`} style={styles.auditRow}>
                <Text style={styles.auditAction}>{entry.action}</Text>
                <Text style={styles.auditActor}>{entry.actor?.display_name ?? entry.actor?.username ?? '—'}</Text>
                <Text style={styles.auditTime}>{new Date(entry.created_at).toLocaleString('ar', { hour: '2-digit', minute: '2-digit' })}</Text>
              </View>
            ))}
            <TouchableOpacity style={[styles.manageRow, styles.manageCloseRow]} onPress={() => setAuditSheetVisible(false)} activeOpacity={0.8}>
              <Text style={styles.manageRowText}>إغلاق</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function SeatView({
  seat,
  mySeat,
  isOwner,
  isFullManager,
  seatsLocked,
  canModerate,
  onTake,
  onProfile,
  onModerate,
  moderationDisabled,
  onSeatPosition,
}: {
  seat: Seat;
  mySeat: number | null;
  isOwner: boolean;
  isFullManager: boolean;
  seatsLocked: boolean;
  canModerate: boolean;
  onTake: () => void;
  onProfile: () => void;
  onModerate: () => void;
  moderationDisabled: boolean;
  onSeatPosition?: (userId: string, pos: { x: number; y: number }) => void;
}) {
  const reduceMotion = usePreferencesStore((state) => state.reduceMotion);
  const isOccupied = seat.status === 'occupied' && seat.user_id;
  const isLocked = seat.status === 'locked';
  const canTake = !isOccupied && (!isLocked || isFullManager) && (mySeat === null || mySeat === seat.seat_index);
  const seatRef = useRef<View>(null);

  const reportSeatPosition = () => {
    if (!seat.user_id || !onSeatPosition) return;
    // قياس موقع المقعد على الشاشة لتحريك الهدية نحوه عند نهاية المشهد.
    requestAnimationFrame(() => {
      seatRef.current?.measureInWindow((x, y, width, height) => {
        if (width > 0 && height > 0) {
          onSeatPosition(seat.user_id!, { x: x + width / 2, y: y + height / 2 });
        }
      });
    });
  };

  useEffect(() => {
    reportSeatPosition();
    // نُعيد القياس عند تغيّر الإشغال لأن المكان قد يتبدّل بصريًا.
  }, [seat.user_id, seat.status]);

  /* دخول المقاعد واحدًا بعد الآخر */
  const appear = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    if (reduceMotion) {
      appear.value = 1;
      return;
    }
    appear.value = withDelay(
      Math.min(seat.seat_index, 9) * 45,
      withTiming(1, { duration: 380, easing: ReanimatedEasing.out(ReanimatedEasing.cubic) }),
    );
  }, [appear, reduceMotion, seat.seat_index]);
  const appearStyle = useAnimatedStyle(() => ({
    opacity: appear.value,
    transform: [
      { translateY: (1 - appear.value) * 14 },
      { scale: 0.9 + appear.value * 0.1 },
    ],
  }));

  /* حلقات المتحدث: موجتان متتاليتان */
  const ringA = useSharedValue(0);
  const ringB = useSharedValue(0);
  useEffect(() => {
    if (!seat.is_mic_on || reduceMotion) {
      ringA.value = 0;
      ringB.value = 0;
      return;
    }
    const wave = withRepeat(
      withTiming(1, { duration: 1500, easing: ReanimatedEasing.out(ReanimatedEasing.quad) }),
      -1,
      false,
    );
    ringA.value = wave;
    ringB.value = withDelay(750, wave);
  }, [reduceMotion, ringA, ringB, seat.is_mic_on]);

  const ringAStyle = useAnimatedStyle(() => ({
    opacity: 0.5 * (1 - ringA.value),
    transform: [{ scale: 1 + ringA.value * 0.8 }],
  }));
  const ringBStyle = useAnimatedStyle(() => ({
    opacity: 0.4 * (1 - ringB.value),
    transform: [{ scale: 1 + ringB.value * 0.8 }],
  }));

  return (
    <Reanimated.View
      ref={seatRef}
      collapsable={false}
      onLayout={reportSeatPosition}
      style={[styles.seatWrap, appearStyle]}
    >
      <TouchableOpacity
        style={[
          styles.seat,
          isOccupied && styles.seatOccupied,
          isOwner && seat.is_owner_seat && styles.seatOwner,
          isOccupied && seat.is_mic_on && styles.seatSpeaking,
        ]}
        onPress={isOccupied ? onProfile : canTake ? onTake : undefined}
        disabled={!isOccupied && !canTake}
        accessibilityRole="button"
        accessibilityLabel={isOccupied
          ? `المقعد ${seat.seat_index + 1}، ${seat.user?.display_name ?? seat.user?.username ?? 'متحدث'}${seat.is_mic_on ? '، يتحدث' : '، الميكروفون مكتوم'}`
          : isLocked ? `المقعد ${seat.seat_index + 1}، مقفل` : `انضم إلى المقعد ${seat.seat_index + 1}`}
        accessibilityHint={isOccupied ? 'اضغط لعرض الملف الشخصي' : canTake ? 'اضغط للانضمام إلى المنصة الصوتية' : undefined}
        accessibilityState={{ disabled: !isOccupied && !canTake }}
      >
        {isOccupied ? (
          <>
            <View style={styles.seatAvatarWrap}>
              {seat.is_mic_on && !reduceMotion && (
                <>
                  <Reanimated.View pointerEvents="none" style={[styles.speakerHalo, ringAStyle]} />
                  <Reanimated.View pointerEvents="none" style={[styles.speakerHalo, ringBStyle]} />
                </>
              )}
              {seat.is_owner_seat ? (
                <LinearGradient
                  colors={gradients.gold}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.seatAvatarGradient}
                >
                  <View style={styles.seatAvatarInner}>
                    <Avatar
                      size={42}
                      uri={seat.user?.avatar_url}
                      name={seat.user?.display_name ?? seat.user?.username}
                    />
                  </View>
                </LinearGradient>
              ) : (
                <View style={[
                  styles.seatAvatarRing,
                  seat.is_mic_on && styles.seatAvatarRingLive,
                ]}>
                  <Avatar
                    size={42}
                    uri={seat.user?.avatar_url}
                    name={seat.user?.display_name ?? seat.user?.username}
                  />
                </View>
              )}
              {seat.is_owner_seat && (
                <View style={styles.ownerCrown}>
                  <Crown size={11} color={colors.inkGold} />
                </View>
              )}
              {typeof seat.user?.level === 'number' && (
                <View style={styles.seatLevel}>
                  <LevelBadge level={seat.user.level} />
                </View>
              )}
            </View>
            <Text style={styles.seatName} numberOfLines={1}>
              {seat.user?.display_name ?? seat.user?.username ?? ''}
            </Text>
            {seat.is_mic_on ? (
              <View style={styles.seatWavePill}>
                <LiveEqualizer bars={3} height={9} width={2} gap={1.5} color={colors.roomTeal} />
              </View>
            ) : (
              <View style={[styles.micIcon, styles.micOff]}>
                <MicOff size={9} color={colors.roomMuted} />
              </View>
            )}
            {canModerate && seat.user_id && (
              <TouchableOpacity
                style={styles.seatModerationButton}
                onPress={onModerate}
                disabled={moderationDisabled}
                accessibilityRole="button"
                accessibilityLabel={`إدارة ${seat.user?.display_name ?? seat.user?.username ?? 'المتحدث'}`}
              >
                {moderationDisabled
                  ? <ActivityIndicator size="small" color={colors.gold} />
                  : <VolumeX size={11} color={colors.gold} />}
              </TouchableOpacity>
            )}
          </>
        ) : isLocked ? (
          <View style={styles.seatEmpty}>
            <View style={styles.seatEmptyIconDim}>
              <Lock size={16} color={colors.textMuted} />
            </View>
            <Text style={styles.seatLockedText}>{seat.seat_index + 1}</Text>
          </View>
        ) : (
          <View style={styles.seatEmpty}>
            <View style={styles.seatAddIcon}>
              <Mic size={18} color={colors.roomText} />
            </View>
            <Text style={styles.seatEmptyText}>{seat.seat_index + 1}</Text>
          </View>
        )}
      </TouchableOpacity>
    </Reanimated.View>
  );
}

function GiftsModal({
  roomId,
  seats,
  onClose,
  onGiftSent,
}: {
  roomId: string;
  seats: Seat[];
  onClose: () => void;
  onGiftSent: (gift: GiftCelebrationData) => void;
}) {
  const { profile, loadProfile } = useAuthStore();
  const [gifts, setGifts] = useState<any[]>([]);
  const [selectedGift, setSelectedGift] = useState<string | null>(null);
  const [giftSearch, setGiftSearch] = useState('');
  const [receiver, setReceiver] = useState<{ id: string; name: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [giftsLoading, setGiftsLoading] = useState(true);
  const [giftsError, setGiftsError] = useState<string | null>(null);
  const [giftAttempt, setGiftAttempt] = useState<{ fingerprint: string; key: string } | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('gifts')
          .select('*')
          .eq('is_active', true)
          .order('sort_order');
        if (error) throw error;
        if (active) setGifts(data ?? []);
      } catch (error: unknown) {
        if (active) {
          setGiftsError(error instanceof Error ? error.message : 'تعذر تحميل قائمة الهدايا.');
        }
      } finally {
        if (active) setGiftsLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  // المستلمون الممكنون: جميع أصحاب المقاعد عدا أنا
  const recipients = seats
    .filter(s => s.status === 'occupied' && s.user_id && s.user_id !== profile?.id)
    .map(s => ({ id: s.user_id!, name: s.user?.display_name ?? s.user?.username ?? 'عضو' }));
  const selectedGiftRecord = gifts.find(gift => gift.id === selectedGift);
  const filteredGifts = gifts.filter((gift) => {
    const query = giftSearch.trim().toLocaleLowerCase();
    return !query || `${gift.name_ar ?? ''} ${gift.name ?? ''}`.toLocaleLowerCase().includes(query);
  });
  const availableBalance = profile?.balance_gold ?? 0;
  const giftPrice = Number(selectedGiftRecord?.price_gold ?? 0);
  const canAffordGift = giftPrice <= availableBalance;

  const sendGift = async () => {
    if (!selectedGift || !receiver || sending) return;
    if (!canAffordGift) {
      Alert.alert('رصيد Coin غير كافٍ', 'اشحن رصيد Coin أو اختر هدية أقل سعرًا.');
      return;
    }
    setSending(true);
    try {
      const fingerprint = `${receiver.id}:${selectedGift}:${roomId}:gold`;
      const idempotencyKey = giftAttempt?.fingerprint === fingerprint
        ? giftAttempt.key
        : `gift-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      setGiftAttempt({ fingerprint, key: idempotencyKey });
      await callFunction<{ gift_transaction?: { id?: string } }>('gift-send', {
        to_user_id: receiver.id,
        gift_id: selectedGift,
        room_id: roomId,
        quantity: 1,
        funding_currency: 'gold',
      }, idempotencyKey);
      setGiftAttempt(null);
      onGiftSent({
        emoji: selectedGiftRecord?.icon_emoji ?? '🎁',
        name: selectedGiftRecord?.name_ar ?? selectedGiftRecord?.name ?? 'هدية',
        recipient: receiver.name,
        recipientId: receiver.id,
        premium: Boolean(selectedGiftRecord?.is_premium) || Number(selectedGiftRecord?.price_gold ?? 0) >= 5000,
      });
      let profileRefreshFailed = false;
      try {
        await loadProfile();
      } catch (profileError: unknown) {
        console.warn('[Wattar] Gift sent but wallet refresh failed:', profileError);
        profileRefreshFailed = true;
      }
      onClose();
      // لا نُظهر تنبيهًا عند النجاح: احتفال الهدية هو التأكيد البصري.
      if (profileRefreshFailed) {
        Alert.alert('تم إرسال الهدية', 'نجح الإرسال، لكن تعذر تحديث الرصيد المعروض. اسحب الشاشة للتحديث.');
      }
    } catch (e: unknown) {
      Alert.alert('خطأ', e instanceof Error ? e.message : 'فشل إرسال الهدية');
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={styles.giftsModal}>
      <View style={styles.giftsContent}>
        <View style={styles.giftsHeader}>
          <View style={styles.giftsHeadingCopy}>
            <Text style={styles.giftsTitle}>{receiver ? 'تأكيد الهدية' : 'هدايا الغرفة'}</Text>
            <Text style={styles.giftsSubtitle}>
              {receiver ? `إلى ${receiver.name}` : 'اختر هدية ثم حدد المستلم'}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => {
              if (receiver) setReceiver(null);
              else onClose();
            }}
          >
            <X size={20} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        {!receiver ? (
          <>
            <View style={styles.giftBalanceCard}>
              <View>
                <View style={styles.giftBalanceTitle}>
                  <Text style={styles.giftBalanceLabel}>رصيد Coin المتاح</Text>
                  <CurrencyIcon currency="coin" size={27} />
                </View>
                <Text style={styles.giftBalanceValue}>{availableBalance.toLocaleString()}</Text>
              </View>
            </View>

            <Text style={styles.stepHint}>اختر هدية</Text>
            {giftsLoading ? (
              <ActivityIndicator color={colors.gold} style={styles.giftLoading} />
            ) : giftsError ? (
              <Text style={styles.giftError}>تعذر تحميل الهدايا: {giftsError}</Text>
            ) : gifts.length === 0 ? (
              <Text style={styles.noRecipients}>لا توجد هدايا متاحة حاليًا.</Text>
            ) : (
              <>
                <View style={styles.giftSearchWrap}>
                  <Search size={16} color={colors.roomMuted} />
                  <TextInput
                    value={giftSearch}
                    onChangeText={setGiftSearch}
                    placeholder="ابحث عن هدية..."
                    placeholderTextColor={colors.roomMuted}
                    style={styles.giftSearchInput}
                    accessibilityLabel="البحث في الهدايا"
                  />
                </View>
                <ScrollView style={styles.giftList} contentContainerStyle={styles.giftsGrid} nestedScrollEnabled>
                  {filteredGifts.map(gift => (
                    <GiftCard
                      key={gift.id}
                      gift={gift as GiftRecord}
                      selected={selectedGift === gift.id}
                      onPress={() => setSelectedGift(gift.id)}
                    />
                  ))}
                  {filteredGifts.length === 0 && (
                    <Text style={styles.noRecipients}>ما لقينا هدية بهذا الاسم.</Text>
                  )}
                </ScrollView>
              </>
            )}

            <View style={styles.stepRow}>
              <Text style={styles.stepHint}>اختر المستلم من المنصة</Text>
              {selectedGift && <Text style={styles.comboHint}>أرسل هدايا متتالية لتفعيل الكومبو</Text>}
            </View>
            {recipients.length === 0 ? (
              <Text style={styles.noRecipients}>لا يوجد مستلمون حاليًا؛ يجب أن يكون شخص آخر على مقعد.</Text>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.recipientsRow}>
                {recipients.map(recipient => {
                  const seat = seats.find(s => s.user_id === recipient.id);
                  return (
                    <RecipientChip
                      key={recipient.id}
                      name={recipient.name}
                      avatarUrl={seat?.user?.avatar_url}
                      disabled={!selectedGift}
                      onPress={() => selectedGift && setReceiver(recipient)}
                    />
                  );
                })}
              </ScrollView>
            )}
            {selectedGiftRecord && (
              <View style={styles.giftSelectionSummary}>
                <Text style={styles.giftSelectionText}>
                  {selectedGiftRecord.icon_emoji ?? '🎁'} {selectedGiftRecord.name_ar ?? selectedGiftRecord.name}
                </Text>
                <Text style={[styles.giftSelectionPrice, !canAffordGift && styles.giftUnaffordable]}>
                  {giftPrice.toLocaleString()} Coins
                </Text>
              </View>
            )}
            <Text style={styles.balanceText}>الهدايا تُدفع بعملة Coin فقط، وCoin تُشحن بالدولار (1$ = 3000 Coin).</Text>
          </>
        ) : (
          <>
            <View style={styles.giftConfirmCard}>
              <Text style={styles.giftConfirmEmoji}>{selectedGiftRecord?.icon_emoji ?? '🎁'}</Text>
              <View style={styles.giftConfirmCopy}>
                <Text style={styles.giftConfirmName}>{selectedGiftRecord?.name_ar ?? selectedGiftRecord?.name ?? 'هدية'}</Text>
                <Text style={styles.giftConfirmRecipient}>إلى {receiver.name}</Text>
              </View>
              <Text style={[styles.giftConfirmPrice, !canAffordGift && styles.giftUnaffordable]}>
                {giftPrice.toLocaleString()} Coins
              </Text>
            </View>
            <View style={styles.giftPaymentSummary}>
              <Text style={styles.giftPaymentLabel}>الدفع من</Text>
              <Text style={styles.giftPaymentValue}>Coin</Text>
              <Text style={styles.giftPaymentLabel}>بعد الإهداء</Text>
              <Text style={styles.giftPaymentValue}>
                {Math.max(0, availableBalance - giftPrice).toLocaleString()} Coins
              </Text>
            </View>
            {!canAffordGift && <Text style={styles.giftError}>رصيد Coin غير كافٍ لهذه الهدية. اشحن رصيدك أو اختر هدية أقل سعرًا.</Text>}
            <TouchableOpacity
              style={[styles.sendGiftBtn, (!selectedGift || sending || !canAffordGift) && styles.sendGiftDisabled]}
              disabled={!selectedGift || sending || !canAffordGift}
              onPress={sendGift}
              accessibilityRole="button"
              accessibilityLabel="إرسال الهدية الآن"
            >
              <LinearGradient
                colors={gradients.gold}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
              {sending
                ? <ActivityIndicator color={colors.inkGold} />
                : <Text style={styles.sendGiftText}>إرسال الهدية الآن 🎁</Text>}
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.roomBackground },
  loading: { flex: 1, backgroundColor: colors.roomBackground, alignItems: 'center', justifyContent: 'center', padding: 24 },
  loadingHint: { color: colors.roomMuted, fontFamily: fonts.medium, fontSize: 12, marginTop: 14 },
  loadErrorTitle: { color: colors.roomText, fontFamily: fonts.bold, fontSize: 20, lineHeight: 30, marginBottom: 8, textAlign: 'center' },
  loadErrorMessage: { color: colors.roomMuted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 21, textAlign: 'center', marginHorizontal: 18 },
  retryButton: { backgroundColor: colors.roomPrimary, borderRadius: radius.sm, paddingHorizontal: 22, paddingVertical: 12, marginTop: 18 },
  retryButtonText: { color: colors.text, fontFamily: fonts.bold, fontSize: 13 },
  backButton: { padding: 14, marginTop: 2 },
  backButtonText: { color: colors.roomMuted, fontFamily: fonts.medium, fontSize: 13 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingBottom: 12,
    gap: 8,
    backgroundColor: colors.bar,
    borderBottomWidth: 1,
    borderBottomColor: colors.glassLine,
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceGlass,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  ownerCloseBtn: { marginLeft: 0 },
  roomInfo: { flex: 1, marginHorizontal: 4 },
  roomName: { color: colors.roomText, fontFamily: fonts.bold, fontSize: 17, lineHeight: 26, textAlign: 'right' },
  roomMeta: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2, flexWrap: 'wrap' },
  roomMetaText: { color: colors.roomMuted, fontFamily: fonts.regular, fontSize: 10, lineHeight: 16 },
  listenersChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surfaceGlass,
    borderRadius: radius.xs,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },

  seatsContainer: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12,
  },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 11 },
  sectionTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  sectionAccent: { width: 3, height: 16, borderRadius: 2, backgroundColor: colors.gold },
  sectionTitle: { color: colors.roomText, fontFamily: fonts.bold, fontSize: 13, lineHeight: 20, textAlign: 'right' },
  sectionCount: {
    color: colors.roomMuted,
    fontFamily: fonts.semibold,
    fontSize: 10,
    lineHeight: 15,
    backgroundColor: colors.surfaceGlass,
    borderRadius: radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 3,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  seatsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 2,
  },

  seat: {
    position: 'relative',
    width: 74,
    height: 92,
    backgroundColor: 'transparent',
    borderWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  },
  seatOccupied: { backgroundColor: 'transparent' },
  seatOwner: { backgroundColor: 'transparent' },
  seatSpeaking: { backgroundColor: 'transparent' },
  seatEmpty: { alignItems: 'center', gap: 4 },
  seatAddIcon: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.22)',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  seatEmptyIconDim: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  seatEmptyText: {
    color: colors.roomText,
    fontFamily: fonts.semibold,
    fontSize: 10,
    lineHeight: 15,
    textShadowColor: 'rgba(0,0,0,0.75)',
    textShadowRadius: 4,
  },
  seatLockedText: {
    color: colors.roomMuted,
    fontFamily: fonts.medium,
    fontSize: 10,
    lineHeight: 15,
    textShadowColor: 'rgba(0,0,0,0.75)',
    textShadowRadius: 4,
  },
  seatAvatarWrap: { width: 54, height: 54, alignItems: 'center', justifyContent: 'center' },
  speakerHalo: {
    position: 'absolute',
    width: 54,
    height: 54,
    borderRadius: 27,
    borderWidth: 2,
    borderColor: colors.roomTeal,
  },
  seatAvatarRing: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.borderSoft,
    backgroundColor: colors.surfaceMuted,
  },
  seatAvatarRingLive: { borderColor: colors.teal, backgroundColor: colors.tealHaze },
  seatAvatarRingOwner: { borderColor: colors.gold },
  seatAvatarImg: { width: '100%', height: '100%', borderRadius: 24 },
  seatLevel: { position: 'absolute', top: -5, left: -7 },
  ownerCrown: {
    position: 'absolute',
    top: -3,
    right: -3,
    backgroundColor: colors.gold,
    borderRadius: 8,
    width: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.inkShadow,
  },
  seatName: {
    color: colors.roomText,
    fontFamily: fonts.semibold,
    fontSize: 10,
    lineHeight: 16,
    marginTop: 3,
    maxWidth: 70,
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowRadius: 5,
  },
  micIcon: {
    position: 'absolute',
    bottom: 3,
    right: 3,
    width: 15,
    height: 15,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seatModerationButton: {
    position: 'absolute',
    bottom: 2,
    left: 2,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.goldHaze,
    borderWidth: 1,
    borderColor: colors.goldLine,
  },
  micOn: { backgroundColor: colors.roomTeal },
  micOff: { backgroundColor: colors.glassStrong },

  voiceChipOn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: colors.roomTeal, borderRadius: radius.xs, paddingHorizontal: 6, paddingVertical: 2,
  },
  voiceChipWait: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: colors.gold, borderRadius: radius.xs, paddingHorizontal: 6, paddingVertical: 2,
  },
  voiceChipOff: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: colors.surfaceGlass, borderRadius: radius.xs, paddingHorizontal: 6, paddingVertical: 2,
    borderWidth: 1, borderColor: colors.borderSoft,
  },
  voiceChipText: { color: colors.inkDark, fontFamily: fonts.bold, fontSize: 9, lineHeight: 13 },
  voiceChipTextDim: { color: colors.roomMuted, fontFamily: fonts.bold, fontSize: 9, lineHeight: 13 },

  chatContainer: { flex: 1, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 2 },
  chatHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    paddingBottom: 8,
  },
  chatAccent: { backgroundColor: colors.roomPrimary },
  chatHeadingHint: { color: colors.roomMuted, fontFamily: fonts.regular, fontSize: 9, lineHeight: 14, textAlign: 'right' },
  chatList: { gap: 3, paddingBottom: 6 },
  chatListEmpty: { flexGrow: 1, justifyContent: 'center' },
  chatEmpty: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 18 },
  chatEmptyIcon: {
    width: 46, height: 46, borderRadius: 16,
    backgroundColor: colors.goldSoft,
    borderWidth: 1, borderColor: colors.goldLine,
    alignItems: 'center', justifyContent: 'center', marginBottom: 9,
  },
  chatEmptyTitle: { color: colors.roomText, fontFamily: fonts.bold, fontSize: 13, lineHeight: 20, textAlign: 'center' },
  chatEmptyHint: { color: colors.roomMuted, fontFamily: fonts.regular, fontSize: 10, lineHeight: 16, marginTop: 3, textAlign: 'center' },

  messageItem: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, maxWidth: '90%', marginBottom: 6 },
  ownMessageItem: { alignSelf: 'flex-end' },
  otherMessageItem: { alignSelf: 'flex-start' },
  messageAvatar: {
    width: 28, height: 28, borderRadius: 10,
    backgroundColor: colors.glassLine,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.borderSoft,
  },
  ownMessageAvatar: { backgroundColor: colors.primaryHaze, borderColor: colors.primaryGlow },
  messageAvatarText: { color: colors.roomText, fontFamily: fonts.bold, fontSize: 11 },
  messageBubble: {
    maxWidth: '88%',
    minWidth: 90,
    paddingHorizontal: 11,
    paddingTop: 7,
    paddingBottom: 8,
    borderRadius: 15,
    borderWidth: 1,
  },
  ownMessageBubble: {
    backgroundColor: colors.primaryHaze,
    borderColor: colors.primaryGlow,
    borderBottomRightRadius: 5,
  },
  otherMessageBubble: {
    backgroundColor: colors.glass,
    borderColor: colors.glassLine,
    borderBottomLeftRadius: 5,
  },
  messageMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  messageUserRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
  messageFlag: { fontSize: 10, lineHeight: 14 },
  messageUser: { color: colors.roomTeal, fontFamily: fonts.semibold, fontSize: 10, lineHeight: 15, flexShrink: 1, textAlign: 'right' },
  ownMessageUser: { color: colors.primaryLight },
  messageTime: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 8, lineHeight: 13 },
  messageText: { color: colors.roomText, fontFamily: fonts.regular, marginTop: 3, lineHeight: 21, textAlign: 'right' },
  pendingMessage: { opacity: 0.65 },
  pendingLabel: { color: colors.roomMuted, fontFamily: fonts.regular, fontSize: 9, marginTop: 2 },
  systemMessage: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    alignSelf: 'center',
    maxWidth: '94%',
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  systemMessageRule: { flex: 1, height: 1, backgroundColor: colors.glass },
  systemMessageText: {
    color: colors.textSecondary,
    backgroundColor: colors.surfaceGlass,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontFamily: fonts.medium,
    fontSize: 10,
    lineHeight: 16,
    textAlign: 'center',
    overflow: 'hidden',
  },

  seatRequestBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 6,
  },
  seatRequestBtn: {
    backgroundColor: colors.gold,
    borderRadius: radius.sm,
    paddingHorizontal: 20,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  seatRequestBtnText: { color: colors.inkGold, fontFamily: fonts.bold, fontSize: 12, lineHeight: 18 },
  seatRequestPending: { color: colors.roomMuted, fontFamily: fonts.medium, fontSize: 11, flex: 1, textAlign: 'right' },
  seatRequestCancel: { backgroundColor: colors.surfaceGlass, borderRadius: radius.sm, paddingHorizontal: 16, paddingVertical: 8, borderWidth: 1, borderColor: colors.borderSoft },
  seatRequestCancelText: { color: colors.roomText, fontFamily: fonts.semibold, fontSize: 11 },

  emojiTray: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 7,
    backgroundColor: colors.bar,
    borderTopWidth: 1,
    borderTopColor: colors.glassLine,
  },
  emojiTrayTitle: { color: colors.roomMuted, fontFamily: fonts.semibold, fontSize: 10, marginBottom: 8, textAlign: 'right' },
  emojiGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 5 },
  emojiChoice: { minWidth: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: colors.surfaceGlass },
  emojiChoiceText: { fontSize: 21 },

  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 8,
    backgroundColor: colors.bar,
    borderTopWidth: 1,
    borderTopColor: colors.glassLine,
    gap: 7,
  },
  giftBtn: {
    width: 38,
    height: 38,
    borderRadius: 13,
    backgroundColor: colors.goldHaze,
    borderWidth: 1,
    borderColor: colors.goldLine,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiToggle: { width: 36, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: colors.surfaceGlass },
  emojiToggleActive: { backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: colors.borderStrong },
  messageInput: {
    flex: 1,
    backgroundColor: colors.glass,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 9,
    color: colors.roomText,
    fontFamily: fonts.regular,
    fontSize: 13,
    textAlign: 'right',
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.roomPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
  },
  sendBtnIdle: { opacity: 0.55 },

  micControls: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingTop: 8,
    backgroundColor: colors.bar,
    borderTopWidth: 1,
    borderTopColor: colors.glassLine,
    gap: 8,
  },
  micBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: radius.sm,
  },
  micMuted: { backgroundColor: colors.danger },
  micActive: { backgroundColor: colors.roomTeal },
  micText: { color: colors.inkDark, fontFamily: fonts.bold, fontSize: 13 },
  controlDisabled: { opacity: 0.6 },
  leaveSeatBtn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceGlass,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  leaveSeatText: { color: colors.roomMuted, fontFamily: fonts.medium, fontSize: 13 },

  giftsModal: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    top: 0,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  giftsContent: {
    backgroundColor: colors.sheet,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.borderStrong,
    padding: 16,
    maxHeight: '74%',
  },
  giftsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  giftsHeadingCopy: { flex: 1 },
  giftsTitle: { color: colors.roomText, fontFamily: fonts.bold, fontSize: 17, lineHeight: 26, textAlign: 'right' },
  giftsSubtitle: { color: colors.roomMuted, fontFamily: fonts.regular, fontSize: 10, marginTop: 2, textAlign: 'right' },
  giftBalanceCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 12, borderRadius: radius.md,
    backgroundColor: colors.goldHaze,
    borderWidth: 1, borderColor: colors.goldLine,
  },
  giftBalanceTitle: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  giftBalanceLabel: { color: colors.roomMuted, fontFamily: fonts.regular, fontSize: 10 },
  giftBalanceValue: { color: colors.gold, fontFamily: fonts.black, fontSize: 16, lineHeight: 22, marginTop: 2 },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  comboHint: {
    color: colors.primaryLight,
    fontFamily: fonts.semibold,
    fontSize: 9,
    lineHeight: 14,
  },
  stepHint: { color: colors.textSecondary, fontFamily: fonts.semibold, fontSize: 11, marginTop: 12, marginBottom: 7, textAlign: 'right' },
  noRecipients: { color: colors.roomMuted, fontFamily: fonts.regular, fontSize: 11, lineHeight: 18, textAlign: 'center', paddingVertical: 8 },
  giftSearchWrap: {
    minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 11, marginBottom: 8, borderRadius: radius.sm,
    backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.borderSoft,
  },
  giftSearchInput: { flex: 1, color: colors.roomText, fontFamily: fonts.regular, fontSize: 12, paddingVertical: 8, textAlign: 'right' },
  giftList: { maxHeight: 170 },
  giftsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  giftCard: {
    width: 80,
    backgroundColor: colors.glass,
    borderRadius: radius.sm,
    padding: 9,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  giftCardActive: { borderColor: colors.gold, backgroundColor: colors.goldHaze },
  giftIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  giftIconActive: { backgroundColor: colors.goldHaze, borderRadius: 12 },
  giftIconText: { fontSize: 24 },
  giftName: { color: colors.roomText, fontFamily: fonts.medium, fontSize: 10, lineHeight: 16, marginTop: 3, textAlign: 'center' },
  giftPrice: { color: colors.gold, fontFamily: fonts.bold, fontSize: 11, lineHeight: 16, marginTop: 1 },
  giftLoading: { marginVertical: 22 },
  giftError: { color: colors.danger, fontFamily: fonts.regular, fontSize: 10, lineHeight: 17, textAlign: 'center', marginTop: 8 },
  recipientsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  recipientChip: {
    backgroundColor: colors.glass, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 8,
    borderWidth: 1, borderColor: colors.borderSoft,
  },
  recipientChipActive: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  recipientText: { color: colors.roomText, fontFamily: fonts.semibold, fontSize: 11 },
  giftSelectionSummary: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: 9, padding: 11, borderRadius: radius.sm,
    backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.borderSoft,
  },
  giftSelectionText: { color: colors.roomText, fontFamily: fonts.semibold, fontSize: 11 },
  giftSelectionPrice: { color: colors.gold, fontFamily: fonts.black, fontSize: 12 },
  giftUnaffordable: { color: colors.danger },
  giftConfirmCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radius.md,
    backgroundColor: colors.goldHaze, borderWidth: 1, borderColor: colors.goldLine,
  },
  giftConfirmEmoji: { fontSize: 36 },
  giftConfirmCopy: { flex: 1 },
  giftConfirmName: { color: colors.roomText, fontFamily: fonts.bold, fontSize: 13, textAlign: 'right' },
  giftConfirmRecipient: { color: colors.roomMuted, fontFamily: fonts.regular, fontSize: 10, marginTop: 2, textAlign: 'right' },
  giftConfirmPrice: { color: colors.gold, fontFamily: fonts.black, fontSize: 12 },
  giftPaymentSummary: {
    flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 6,
    marginTop: 12, padding: 12, borderRadius: radius.sm,
    backgroundColor: colors.glassFaint, borderWidth: 1, borderColor: colors.borderSoft,
  },
  giftPaymentLabel: { width: '48%', color: colors.roomMuted, fontFamily: fonts.regular, fontSize: 10, textAlign: 'right' },
  giftPaymentValue: { width: '48%', color: colors.roomText, fontFamily: fonts.semibold, fontSize: 11, textAlign: 'right' },
  sendGiftBtn: {
    backgroundColor: colors.gold, borderRadius: radius.sm, paddingVertical: 13,
    alignItems: 'center', marginTop: 14, borderWidth: 1, borderColor: colors.borderLight,
  },
  sendGiftDisabled: { opacity: 0.4 },
  sendGiftText: { color: colors.inkGold, fontFamily: fonts.bold, fontSize: 13 },
  balanceText: { color: colors.roomMuted, fontFamily: fonts.regular, fontSize: 10, lineHeight: 17, textAlign: 'center', marginTop: 12 },
  giftFundingOptions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  giftFundingOption: { flex: 1, paddingVertical: 9, paddingHorizontal: 5, borderRadius: radius.xs, backgroundColor: colors.surfaceGlass, borderWidth: 1, borderColor: colors.borderSoft },
  giftFundingOptionActive: { borderColor: colors.roomPrimary, backgroundColor: colors.primarySoft },
  giftFundingText: { color: colors.textSecondary, fontFamily: fonts.semibold, fontSize: 10, textAlign: 'center' },

  seatWrap: { alignItems: 'center' },
  seatAvatarGradient: {
    width: 50,
    height: 50,
    borderRadius: 25,
    padding: 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.gold,
    shadowOpacity: 0.45,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  seatAvatarInner: {
    flex: 1,
    alignSelf: 'stretch',
    borderRadius: 23,
    backgroundColor: colors.roomSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seatWavePill: {
    marginTop: 4,
    height: 14,
    paddingHorizontal: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.tealHaze,
    borderWidth: 1,
    borderColor: colors.tealEdge,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roomTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  liveBadge: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.teal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speakerStack: { flexDirection: 'row', alignItems: 'center' },
  speakerStackItem: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.roomSurface,
    overflow: 'hidden',
  },
  speakerStackOverlap: { marginLeft: -5 },

  inviteModalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlay },
  inviteModal: {
    maxHeight: '72%', padding: 18,
    borderTopLeftRadius: radius.xxl, borderTopRightRadius: radius.xxl,
    backgroundColor: colors.sheet, borderWidth: 1, borderBottomWidth: 0, borderColor: colors.borderStrong,
  },
  inviteModalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  inviteModalTitle: { color: colors.roomText, fontFamily: fonts.bold, fontSize: 16, lineHeight: 25 },
  inviteLoading: { marginVertical: 26 },
  inviteFriendRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.glass },
  inviteFriendAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceGlass, borderWidth: 1, borderColor: colors.borderSoft },
  inviteFriendInitial: { color: colors.roomPrimary, fontFamily: fonts.bold, fontSize: 15 },
  inviteFriendCopy: { flex: 1 },
  inviteFriendName: { color: colors.roomText, fontFamily: fonts.semibold, fontSize: 13, textAlign: 'right' },
  inviteFriendUsername: { color: colors.roomMuted, fontFamily: fonts.regular, fontSize: 10, marginTop: 2, textAlign: 'right' },
  inviteEmpty: { color: colors.roomMuted, fontFamily: fonts.regular, fontSize: 12, lineHeight: 20, textAlign: 'center', paddingVertical: 24 },

  manageModalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlay },
  manageModal: {
    backgroundColor: colors.sheet,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    borderWidth: 1, borderBottomWidth: 0, borderColor: colors.borderStrong,
    padding: 16,
    maxHeight: '78%',
  },
  manageModalTitle: { color: colors.roomText, fontFamily: fonts.bold, fontSize: 16, lineHeight: 25, marginBottom: 12, textAlign: 'right' },
  manageRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: colors.glass },
  manageRowText: { color: colors.roomText, fontFamily: fonts.medium, fontSize: 13, flex: 1, textAlign: 'right' },
  manageCloseRow: { borderBottomWidth: 0, justifyContent: 'center' },

  passwordOverlay: { flex: 1, backgroundColor: colors.overlayStrong, justifyContent: 'center', alignItems: 'center' },
  passwordModal: {
    backgroundColor: colors.sheet, borderRadius: radius.lg, padding: 20, width: '88%', maxWidth: 420,
    borderWidth: 1, borderColor: colors.borderStrong,
  },
  passwordInput: {
    backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.borderSoft,
    borderRadius: radius.sm, paddingHorizontal: 14, paddingVertical: 12,
    color: colors.roomText, fontFamily: fonts.regular, fontSize: 13, textAlign: 'right', marginBottom: 16,
  },
  passwordActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  passwordCancel: { paddingHorizontal: 18, paddingVertical: 10 },
  passwordCancelText: { color: colors.roomMuted, fontFamily: fonts.medium, fontSize: 13 },
  passwordConfirm: { backgroundColor: colors.roomPrimary, borderRadius: radius.sm, paddingHorizontal: 24, paddingVertical: 10 },
  passwordConfirmText: { color: colors.text, fontFamily: fonts.bold, fontSize: 13 },

  requestRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.glass },
  requestRowName: { color: colors.roomText, fontFamily: fonts.medium, fontSize: 13 },
  requestRowTime: { color: colors.roomMuted, fontFamily: fonts.regular, fontSize: 10 },
  rejectBtn: { backgroundColor: colors.surfaceGlass, borderRadius: radius.xs, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: colors.borderSoft, marginTop: 4 },
  rejectText: { color: colors.danger, fontFamily: fonts.bold, fontSize: 12 },
  auditRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.glass },
  auditAction: { color: colors.roomText, fontFamily: fonts.semibold, fontSize: 12, flex: 1, textAlign: 'right' },
  auditActor: { color: colors.roomMuted, fontFamily: fonts.regular, fontSize: 11 },
  auditTime: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 9 },

  requestBadge: {
    position: 'absolute',
    top: -4,
    left: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 1,
    borderColor: colors.inkDanger,
  },
  requestBadgeText: { color: colors.text, fontFamily: fonts.bold, fontSize: 9 },

  attendeeRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.glass, gap: 10 },
  attendeeRole: { color: colors.roomMuted, fontFamily: fonts.regular, fontSize: 10, marginTop: 2, textAlign: 'right' },
  attendeeSelf: { color: colors.roomPrimary, fontFamily: fonts.bold, fontSize: 10 },
});
