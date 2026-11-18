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
  PermissionsAndroid, Platform, Modal, Animated, Easing,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { supabase, callFunction } from '@/lib/supabase';
import { notifySocialEvent } from '@/lib/notifications';
import { useAuthStore } from '@/store/auth';
import { usePreferencesStore } from '@/store/preferences';
import { CurrencyIcon } from '@/components/CurrencyIcon';
import { colors } from '@/lib/theme';
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
  user?: { username: string; display_name: string | null; avatar_url: string | null } | null;
}

interface Message {
  id: string;
  user_id: string;
  message: string;
  is_system: boolean;
  created_at: string;
  pending?: boolean;
  user?: { username: string; display_name: string | null; avatar_url: string | null } | null;
}

export default function RoomScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
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
  const [giftCelebration, setGiftCelebration] = useState<{ emoji: string; name: string; recipient: string } | null>(null);
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
  const giftCelebrationAnim = useRef(new Animated.Value(0)).current;
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

  useEffect(() => {
    if (!giftCelebration) return;
    giftCelebrationAnim.setValue(0);
    const animation = Animated.sequence([
      Animated.spring(giftCelebrationAnim, {
        toValue: 1,
        speed: 15,
        bounciness: 12,
        useNativeDriver: true,
      }),
      Animated.delay(1800),
      Animated.timing(giftCelebrationAnim, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }),
    ]);
    animation.start(({ finished }) => {
      if (finished) setGiftCelebration(null);
    });
    return () => animation.stop();
  }, [giftCelebration, giftCelebrationAnim]);

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
        user:users(username, display_name, avatar_url)
      `)
      .eq('room_id', id)
      .order('seat_index', { ascending: true }),
      supabase
      .from('room_messages')
      .select(`
        *,
        user:users(username, display_name, avatar_url)
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
      user: seat.user_id ? profiles[seat.user_id] ?? (seat as Seat).user : (seat as Seat).user,
    }));
    seatsRef.current = loadedSeats;
    setSeats(loadedSeats);
    const myOccupiedSeat = loadedSeats.find(
      seat => seat.user_id === profile?.id && seat.status === 'occupied',
    );
    setMySeat(myOccupiedSeat?.seat_index ?? null);
    setMessages((messagesResult.data ?? []).map((item) => ({
      ...(item as Message),
      user: item.user_id ? profiles[item.user_id] ?? (item as Message).user : (item as Message).user,
    })));
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
  };

  // M6: طلبات الصعود المعلقة (تظهر لإدارة الغرفة)
  const loadPendingRequests = async () => {
    const { data, error } = await supabase
      .from('room_seat_requests')
      .select(`
        id, user_id, requested_at,
        user:users(username, display_name, avatar_url)
      `)
      .eq('room_id', id)
      .eq('status', 'pending')
      .order('requested_at', { ascending: true })
      .limit(50);
    if (error) return;
    setPendingRequests((data ?? []).map((row: any) => ({
      ...row,
      user: Array.isArray(row.user) ? row.user[0] ?? null : row.user,
    })));
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
          user:users(username, display_name, avatar_url)
        `)
        .eq('room_id', id)
        .order('seat_index', { ascending: true }),
      loadParticipantProfiles(),
    ]);

    if (seatsResponse.error) throw seatsResponse.error;
    const loadedSeats = (seatsResponse.data ?? []).map((seat) => ({
      ...(seat as Seat),
      user: seat.user_id ? profiles[seat.user_id] ?? (seat as Seat).user : (seat as Seat).user,
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
    const channel = supabase
      .channel(`room:${id}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'room_messages', filter: `room_id=eq.${id}` },
        (payload) => {
          const incoming = payload.new as Message;
          if (incoming.is_system && incoming.message === 'أغلق مالك الغرفة هذه الغرفة.') {
            setRoom((current: typeof room) => current ? { ...current, status: 'closed' } : current);
          }
          setMessages(prev => {
            const withoutPending = prev.filter(
              message => !(message.pending && message.user_id === incoming.user_id && message.message === incoming.message),
            );
            const existingIndex = withoutPending.findIndex(message => message.id === incoming.id);
            const savedMessage = {
              ...incoming,
              user: incoming.user_id === profile?.id
                ? {
                    username: profile.username,
                    display_name: profile.display_name,
                    avatar_url: profile.avatar_url,
                  }
                : participantProfilesRef.current[incoming.user_id],
            };
            if (existingIndex >= 0) {
              return withoutPending.map((message, index) => index === existingIndex ? savedMessage : message);
            }
            return [...withoutPending, savedMessage];
          });
          setTimeout(() => chatListRef.current?.scrollToEnd(), 100);
        }
      )
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'room_seats', filter: `room_id=eq.${id}` },
        (payload) => {
          const nextSeat = payload.new as Seat;
          const previousSeat = seatsRef.current.find(seat => seat.id === nextSeat.id);
          const previousUserId = previousSeat?.user_id ?? null;
          const nextUserId = nextSeat.user_id ?? null;
          const changedUser = previousSeat && previousUserId !== nextUserId;

          loadSeats().then(loadedSeats => {
            if (!changedUser) return;
            const eventId = `seat-event-${nextSeat.id}-${previousUserId ?? 'empty'}-${nextUserId ?? 'empty'}-${Date.now()}`;
            if (previousUserId) {
              const previousName = previousSeat.user?.display_name ?? previousSeat.user?.username ?? 'أحد المتحدثين';
              addSeatSystemMessage(eventId, `غادر ${previousName} المنصة الصوتية.`);
            }
            if (nextUserId) {
              const joinedSeat = loadedSeats.find(seat => seat.id === nextSeat.id);
              const joinedName = joinedSeat?.user?.display_name ?? joinedSeat?.user?.username ?? 'مستخدم جديد';
              addSeatSystemMessage(`${eventId}-join`, `انضم ${joinedName} إلى المنصة الصوتية.`);
            }
          }).catch((error: unknown) => {
            Alert.alert('تعذر تحديث المقاعد', error instanceof Error ? error.message : 'حاول تحديث الغرفة.');
          });
        }
      )
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${id}` },
        (payload) => {
          const updatedRoom = payload.new as typeof room;
          setRoom((current: typeof room) => current ? { ...current, ...updatedRoom } : current);
        }
      )
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'room_seat_requests', filter: `room_id=eq.${id}` },
        async () => {
          if (!canManage || !profile) return;
          await loadPendingRequests();
          const { data } = await supabase
            .from('room_seat_requests')
            .select('id')
            .eq('room_id', id)
            .eq('user_id', profile.id)
            .eq('status', 'pending')
            .limit(1);
          setMyPendingRequest((data ?? []).length > 0);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
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
      await supabase.rpc('request_room_seat', { p_room_id: id });
      setMyPendingRequest(true);
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
      await supabase.rpc('cancel_room_seat_request', { p_room_id: id });
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
      await loadRoom();

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

  const openRequestsSheet = () => { setManageSheetVisible(false); setRequestsSheetVisible(true); };
  const openAuditSheet = () => { setManageSheetVisible(false); setAuditSheetVisible(true); };

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
      void notifySocialEvent('room_invitation', data).catch((notificationError: unknown) => {
        console.warn('[Wattar] Room invitation push failed:', notificationError);
      });
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
        <ActivityIndicator size="large" color={colors.roomTeal} />
        <Text style={{ color: colors.roomMuted, marginTop: 14 }}>جاري تجهيز غرفتك...</Text>
      </View>
    );
  }
  if (!room) {
    return (
      <View style={styles.loading}>
        <StatusBar style="light" />
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
      <StatusBar style="light" />
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={leaveRoom}
          style={styles.iconBtn}
          accessibilityRole="button"
          accessibilityLabel="مغادرة الغرفة"
        >
          <LogOut size={20} color={colors.roomMuted} />
        </TouchableOpacity>
        <View style={styles.roomInfo}>
          <Text style={styles.roomName} numberOfLines={1}>{room.name}</Text>
          <View style={styles.roomMeta}>
            <Users size={12} color={colors.roomMuted} />
            <Text style={styles.roomMetaText}>{listenersCount} مستمع · {speakersCount} متحدث</Text>
            {/* مؤشر حالة الصوت الحي */}
            {voiceState === VOICE_ON && (
              <View style={styles.voiceChipOn}>
                <Volume2 size={10} color="#fff" />
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

      {/* Seats Grid */}
      <View style={styles.seatsContainer}>
        <View style={styles.sectionHeading}>
          <View style={styles.sectionTitleWrap}>
            <View style={styles.sectionAccent} />
            <Text style={styles.sectionTitle}>المنصة الصوتية</Text>
          </View>
          <Text style={styles.sectionCount}>{seats.filter(seat => seat.status === 'occupied').length} / {room.seat_count}</Text>
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
              <View style={styles.systemMessage} accessibilityRole="text">
                <View style={styles.systemMessageRule} />
                <Text style={styles.systemMessageText}>{item.message}</Text>
                <View style={styles.systemMessageRule} />
              </View>
            ) : (() => {
              const isMine = item.user_id === profile?.id;
              return (
                <View style={[styles.messageItem, isMine ? styles.ownMessageItem : styles.otherMessageItem]}>
                  <View style={[styles.messageAvatar, isMine && styles.ownMessageAvatar]}>
                    <Text style={styles.messageAvatarText}>
                      {(item.user?.display_name ?? item.user?.username ?? 'م')[0]?.toUpperCase()}
                    </Text>
                  </View>
                  <View style={[styles.messageBubble, isMine ? styles.ownMessageBubble : styles.otherMessageBubble]}>
                    <View style={styles.messageMeta}>
                      <Text style={[styles.messageUser, isMine && styles.ownMessageUser]} numberOfLines={1}>
                        {item.user?.display_name ?? item.user?.username ?? 'عضو'}
                      </Text>
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
      <View style={styles.inputBar}>
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
        <View style={styles.micControls}>
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
          onGiftSent={(gift) => setGiftCelebration(gift)}
        />
      )}
      {giftCelebration && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.giftCelebration,
            {
              opacity: giftCelebrationAnim,
              transform: [
                { scale: giftCelebrationAnim.interpolate({ inputRange: [0, 1], outputRange: [0.65, 1] }) },
                { translateY: giftCelebrationAnim.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) },
              ],
            },
          ]}
        >
          <Text style={styles.giftCelebrationEmoji}>{giftCelebration.emoji}</Text>
          <Text style={styles.giftCelebrationTitle}>وصلت هديتك!</Text>
          <Text style={styles.giftCelebrationSubtitle}>
            {giftCelebration.name} إلى {giftCelebration.recipient}
          </Text>
        </Animated.View>
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
                <X size={21} color="#CBD5E1" />
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
}) {
  const reduceMotion = usePreferencesStore((state) => state.reduceMotion);
  const pulse = useRef(new Animated.Value(0)).current;
  const isOccupied = seat.status === 'occupied' && seat.user_id;
  const isLocked = seat.status === 'locked';
  const canTake = !isOccupied && (!isLocked || isFullManager) && (mySeat === null || mySeat === seat.seat_index);

  useEffect(() => {
    if (!seat.is_mic_on || reduceMotion) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 650,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 650,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulse, reduceMotion, seat.is_mic_on]);

  const pulseScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.25] });
  const pulseOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.2, 0.65] });

  return (
    <TouchableOpacity
      style={[styles.seat, isOwner && seat.is_owner_seat && styles.seatOwner]}
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
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.speakerHalo,
                  { opacity: pulseOpacity, transform: [{ scale: pulseScale }] },
                ]}
              />
            )}
            <View style={styles.seatAvatar}>
              {seat.user?.avatar_url ? (
                <Image source={{ uri: seat.user.avatar_url }} style={styles.seatAvatarImg} />
              ) : (
                <Text style={styles.seatAvatarText}>
                  {(seat.user?.display_name ?? seat.user?.username ?? '?')[0]?.toUpperCase()}
                </Text>
              )}
              {seat.is_owner_seat && (
                <View style={styles.ownerCrown}>
                  <Crown size={12} color={colors.gold} />
                </View>
              )}
            </View>
          </View>
          <Text style={styles.seatName} numberOfLines={1}>
            {seat.user?.display_name ?? seat.user?.username ?? ''}
          </Text>
          <View style={[styles.micIcon, seat.is_mic_on ? styles.micOn : styles.micOff]}>
            {seat.is_mic_on ? <Mic size={10} color="#fff" /> : <MicOff size={10} color="#fff" />}
          </View>
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
                : <VolumeX size={12} color={colors.gold} />}
            </TouchableOpacity>
          )}
        </>
      ) : isLocked ? (
        <View style={styles.seatEmpty}>
          <Lock size={20} color="#6B7280" />
          <Text style={styles.seatLockedText}>مقفل</Text>
        </View>
      ) : (
        <View style={styles.seatEmpty}>
          <Mic size={20} color={colors.roomPrimary} />
          <Text style={styles.seatEmptyText}>انضم</Text>
        </View>
      )}
    </TouchableOpacity>
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
  onGiftSent: (gift: { emoji: string; name: string; recipient: string }) => void;
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
      const giftResult = await callFunction<{ gift_transaction?: { id?: string } }>('gift-send', {
        to_user_id: receiver.id,
        gift_id: selectedGift,
        room_id: roomId,
        quantity: 1,
        funding_currency: 'gold',
      }, idempotencyKey);
      const giftTransactionId = giftResult.gift_transaction?.id;
      if (giftTransactionId) {
        void notifySocialEvent('gift_received', giftTransactionId).catch((notificationError: unknown) => {
          console.warn('[Wattar] Room gift push failed:', notificationError);
        });
      }
      setGiftAttempt(null);
      onGiftSent({
        emoji: selectedGiftRecord?.icon_emoji ?? '🎁',
        name: selectedGiftRecord?.name_ar ?? selectedGiftRecord?.name ?? 'هدية',
        recipient: receiver.name,
      });
      let profileRefreshFailed = false;
      try {
        await loadProfile();
      } catch (profileError: unknown) {
        console.warn('[Wattar] Gift sent but wallet refresh failed:', profileError);
        profileRefreshFailed = true;
      }
      Alert.alert(
        profileRefreshFailed ? 'تم إرسال الهدية' : 'شكراً لك',
        profileRefreshFailed
          ? 'نجح الإرسال، لكن تعذر تحديث الرصيد المعروض. اسحب الشاشة للتحديث.'
          : `تم إرسال الهدية إلى ${receiver.name} 🎁`,
      );
      onClose();
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
            <X size={20} color="#9CA3AF" />
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
                    <TouchableOpacity
                      key={gift.id}
                      style={[styles.giftCard, selectedGift === gift.id && styles.giftCardActive]}
                      onPress={() => setSelectedGift(gift.id)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: selectedGift === gift.id }}
                    >
                      <View style={[styles.giftIcon, selectedGift === gift.id && styles.giftIconActive]}>
                        <Text style={styles.giftIconText}>{gift.icon_emoji ?? '🎁'}</Text>
                      </View>
                      <Text style={styles.giftName} numberOfLines={1}>{gift.name_ar ?? gift.name}</Text>
                      <Text style={styles.giftPrice}>{Number(gift.price_gold).toLocaleString()} Coins</Text>
                    </TouchableOpacity>
                  ))}
                  {filteredGifts.length === 0 && (
                    <Text style={styles.noRecipients}>ما لقينا هدية بهذا الاسم.</Text>
                  )}
                </ScrollView>
              </>
            )}

            <Text style={styles.stepHint}>اختر المستلم من المنصة</Text>
            {recipients.length === 0 ? (
              <Text style={styles.noRecipients}>لا يوجد مستلمون حاليًا؛ يجب أن يكون شخص آخر على مقعد.</Text>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.recipientsRow}>
                {recipients.map(recipient => (
                  <TouchableOpacity
                    key={recipient.id}
                    style={styles.recipientChip}
                    onPress={() => selectedGift && setReceiver(recipient)}
                    disabled={!selectedGift}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !selectedGift }}
                  >
                    <Text style={styles.recipientText}>{recipient.name}</Text>
                  </TouchableOpacity>
                ))}
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
            >
              {sending
                ? <ActivityIndicator color="#25140A" />
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
  loading: { flex: 1, backgroundColor: colors.roomBackground, alignItems: 'center', justifyContent: 'center' },
  loadErrorTitle: { color: colors.roomText, fontSize: 20, fontWeight: '700', marginBottom: 8 },
  loadErrorMessage: { color: colors.roomMuted, fontSize: 14, lineHeight: 21, textAlign: 'center', marginHorizontal: 28 },
  retryButton: { backgroundColor: colors.roomPrimary, borderRadius: 12, paddingHorizontal: 22, paddingVertical: 12, marginTop: 22 },
  retryButtonText: { color: colors.roomText, fontWeight: '700' },
  backButton: { padding: 14, marginTop: 4 },
  backButtonText: { color: colors.roomMuted },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 50,
    paddingBottom: 14,
    backgroundColor: colors.roomSurface,
    borderBottomWidth: 1,
    borderBottomColor: colors.roomElevated,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.roomElevated,
  },
  ownerCloseBtn: { marginLeft: 8 },
  roomInfo: { flex: 1, marginHorizontal: 12 },
  roomName: { color: colors.roomText, fontSize: 19, fontWeight: '800', textAlign: 'right' },
  roomMeta: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 5, flexWrap: 'wrap' },
  roomMetaText: { color: colors.roomMuted, fontSize: 12 },
  seatsContainer: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 15,
    backgroundColor: '#100B1A',
    borderBottomWidth: 1,
    borderBottomColor: colors.roomSurface,
  },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionAccent: { width: 3, height: 17, borderRadius: 2, backgroundColor: colors.gold },
  sectionTitle: { color: colors.roomText, fontSize: 14, fontWeight: '800', textAlign: 'right' },
  sectionCount: {
    color: colors.roomMuted,
    fontSize: 11,
    fontWeight: '700',
    backgroundColor: colors.roomElevated,
    borderRadius: 10,
    paddingHorizontal: 9,
    paddingVertical: 5,
    overflow: 'hidden',
  },
  seatsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 2,
  },
  seat: {
    position: 'relative',
    width: 80,
    height: 100,
    backgroundColor: '#1A1327',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#38264C',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
    elevation: 2,
  },
  seatOwner: { borderColor: colors.gold, backgroundColor: '#241B2D' },
  seatEmpty: { alignItems: 'center', gap: 4 },
  seatEmptyText: { color: colors.roomPrimary, fontSize: 11, marginTop: 4 },
  seatLockedText: { color: colors.roomMuted, fontSize: 11, marginTop: 4 },
  seatAvatarWrap: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
  speakerHalo: {
    position: 'absolute',
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: colors.roomTeal,
  },
  seatAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.roomElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seatAvatarImg: { width: '100%', height: '100%', borderRadius: 24 },
  seatAvatarText: { color: colors.roomText, fontSize: 18, fontWeight: 'bold' },
  ownerCrown: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: colors.gold,
    borderRadius: 8,
    width: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seatName: { color: colors.roomText, fontSize: 11, marginTop: 6, fontWeight: '500' },
  micIcon: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    width: 14,
    height: 14,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seatModerationButton: {
    position: 'absolute',
    bottom: 3,
    left: 3,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#382B45',
  },
  micOn: { backgroundColor: colors.roomTeal },
  micOff: { backgroundColor: colors.roomElevated },
  voiceChipOn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: colors.roomTeal, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2, marginLeft: 6,
  },
  voiceChipWait: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: colors.gold, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2, marginLeft: 6,
  },
  voiceChipOff: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: colors.roomElevated, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2, marginLeft: 6,
  },
  voiceChipText: { color: '#fff', fontSize: 9, fontWeight: '700' },
  voiceChipTextDim: { color: colors.roomMuted, fontSize: 9, fontWeight: '700' },
  stepHint: { color: colors.roomMuted, fontSize: 12, marginTop: 12, marginBottom: 8 },
  noRecipients: { color: colors.roomMuted, fontSize: 12, textAlign: 'center', paddingVertical: 8 },
  recipientsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  recipientChip: {
    backgroundColor: colors.roomElevated, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 9,
    borderWidth: 1, borderColor: '#49365C',
  },
  recipientChipActive: { backgroundColor: '#49305E', borderColor: colors.roomPrimary },
  recipientText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  sendGiftBtn: {
    backgroundColor: colors.gold, borderRadius: 12, paddingVertical: 13,
    alignItems: 'center', marginTop: 14,
  },
  sendGiftDisabled: { opacity: 0.4 },
  sendGiftText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  giftsHeadingCopy: { flex: 1 },
  giftsSubtitle: { color: colors.roomMuted, fontSize: 11, marginTop: 4 },
  giftBalanceCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12, borderRadius: 15, backgroundColor: '#21182D', borderWidth: 1, borderColor: '#382B45' },
  giftBalanceTitle: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  giftBalanceLabel: { color: colors.roomMuted, fontSize: 10 },
  giftBalanceValue: { color: colors.gold, fontSize: 15, fontWeight: '900', marginTop: 4 },
  giftList: { maxHeight: 168 },
  giftSearchWrap: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 11, marginBottom: 8, borderRadius: 12, backgroundColor: '#17111F', borderWidth: 1, borderColor: '#382B45' },
  giftSearchInput: { flex: 1, color: colors.roomText, fontSize: 12, paddingVertical: 8, textAlign: 'right' },
  giftLoading: { marginVertical: 24 },
  giftError: { color: colors.danger, fontSize: 11, lineHeight: 17, textAlign: 'center', marginTop: 9 },
  giftIconActive: { backgroundColor: '#4B3360' },
  giftSelectionSummary: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 9, padding: 11, borderRadius: 12, backgroundColor: '#21182D' },
  giftSelectionText: { color: colors.roomText, fontSize: 12, fontWeight: '700' },
  giftSelectionPrice: { color: colors.gold, fontSize: 12, fontWeight: '900' },
  giftUnaffordable: { color: colors.danger },
  giftConfirmCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, backgroundColor: '#21182D', borderWidth: 1, borderColor: '#49365C' },
  giftConfirmEmoji: { fontSize: 36 },
  giftConfirmCopy: { flex: 1 },
  giftConfirmName: { color: colors.roomText, fontSize: 14, fontWeight: '800' },
  giftConfirmRecipient: { color: colors.roomMuted, fontSize: 11, marginTop: 4 },
  giftConfirmPrice: { color: colors.gold, fontSize: 12, fontWeight: '900' },
  giftPaymentSummary: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 6, marginTop: 12, padding: 12, borderRadius: 13, backgroundColor: '#17111F' },
  giftPaymentLabel: { width: '48%', color: colors.roomMuted, fontSize: 11 },
  giftPaymentValue: { width: '48%', color: colors.roomText, fontSize: 11, fontWeight: '700', textAlign: 'right' },
  emojiTray: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 7, backgroundColor: colors.roomSurface, borderTopWidth: 1, borderTopColor: colors.roomElevated },
  emojiTrayTitle: { color: colors.roomMuted, fontSize: 10, fontWeight: '700', marginBottom: 8, textAlign: 'right' },
  emojiGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 5 },
  emojiChoice: { minWidth: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: colors.roomElevated },
  emojiChoiceText: { fontSize: 21 },
  emojiToggle: { width: 36, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: colors.roomElevated },
  emojiToggleActive: { backgroundColor: '#3A2B48' },
  chatContainer: { flex: 1, paddingHorizontal: 14, paddingTop: 13, paddingBottom: 5 },
  chatHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    paddingBottom: 10,
  },
  chatAccent: { backgroundColor: colors.roomPrimary },
  chatHeadingHint: { color: colors.roomMuted, fontSize: 10, textAlign: 'right' },
  chatList: { gap: 5, paddingBottom: 8 },
  chatListEmpty: { flexGrow: 1, justifyContent: 'center' },
  chatEmpty: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 20 },
  chatEmptyIcon: {
    width: 44, height: 44, borderRadius: 16,
    backgroundColor: colors.goldSoft,
    alignItems: 'center', justifyContent: 'center', marginBottom: 10,
  },
  chatEmptyTitle: { color: colors.roomText, fontSize: 14, fontWeight: '800', textAlign: 'center' },
  chatEmptyHint: { color: colors.roomMuted, fontSize: 11, marginTop: 4, textAlign: 'center' },
  messageItem: { flexDirection: 'row', alignItems: 'flex-end', gap: 7, maxWidth: '90%', marginBottom: 7 },
  ownMessageItem: { alignSelf: 'flex-end' },
  otherMessageItem: { alignSelf: 'flex-start' },
  messageAvatar: {
    width: 29, height: 29, borderRadius: 11,
    backgroundColor: '#342443',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#4A345E',
  },
  ownMessageAvatar: { backgroundColor: '#54306F', borderColor: '#7D49A2' },
  messageAvatarText: { color: colors.roomText, fontSize: 12, fontWeight: '800' },
  messageBubble: {
    maxWidth: '88%',
    minWidth: 92,
    paddingHorizontal: 11,
    paddingTop: 8,
    paddingBottom: 9,
    borderRadius: 16,
    borderWidth: 1,
  },
  ownMessageBubble: {
    backgroundColor: '#2A1938',
    borderColor: '#57356D',
    borderBottomRightRadius: 5,
  },
  otherMessageBubble: {
    backgroundColor: colors.roomSurface,
    borderColor: '#30243D',
    borderBottomLeftRadius: 5,
  },
  messageMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  messageUser: { color: colors.roomTeal, fontSize: 11, fontWeight: '700', flexShrink: 1, textAlign: 'right' },
  ownMessageUser: { color: '#D5A7F2' },
  messageTime: { color: '#8D819B', fontSize: 9 },
  messageText: { color: colors.roomText, fontSize: 14, marginTop: 4, lineHeight: 21, textAlign: 'right' },
  pendingMessage: { opacity: 0.65 },
  pendingLabel: { color: colors.roomMuted, fontSize: 10, marginTop: 2 },
  systemMessage: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    alignSelf: 'center',
    maxWidth: '94%',
    paddingVertical: 5,
    paddingHorizontal: 4,
  },
  systemMessageRule: { flex: 1, height: 1, backgroundColor: '#382B45' },
  systemMessageText: {
    color: '#C8B2D6',
    backgroundColor: '#21182D',
    borderWidth: 1,
    borderColor: '#382B45',
    borderRadius: 14,
    paddingHorizontal: 11,
    paddingVertical: 6,
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
    overflow: 'hidden',
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 11,
    backgroundColor: colors.roomSurface,
    borderTopWidth: 1,
    borderTopColor: colors.roomElevated,
    gap: 8,
  },
  giftBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#D99A2520',
    alignItems: 'center',
    justifyContent: 'center',
  },
  messageInput: {
    flex: 1,
    backgroundColor: colors.roomElevated,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: colors.roomText,
    fontSize: 14,
    textAlign: 'right',
    borderWidth: 1,
    borderColor: '#352644',
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.roomPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
  },
  sendBtnIdle: { opacity: 0.72 },
  micControls: {
    flexDirection: 'row',
    padding: 12,
    backgroundColor: colors.roomSurface,
    borderTopWidth: 1,
    borderTopColor: colors.roomElevated,
    gap: 8,
  },
  micBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
  },
  micMuted: { backgroundColor: colors.danger },
  micActive: { backgroundColor: colors.roomTeal },
  micText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  controlDisabled: { opacity: 0.65 },
  leaveSeatBtn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: colors.roomElevated,
  },
  leaveSeatText: { color: colors.roomMuted, fontSize: 14 },
  giftsModal: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    top: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  giftCelebration: {
    position: 'absolute',
    top: '35%',
    alignSelf: 'center',
    minWidth: 220,
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 18,
    borderRadius: 24,
    backgroundColor: '#281A35',
    borderWidth: 1,
    borderColor: colors.gold,
    zIndex: 10,
    elevation: 12,
  },
  giftCelebrationEmoji: { fontSize: 56 },
  giftCelebrationTitle: { color: colors.gold, fontSize: 17, fontWeight: '900', marginTop: 4 },
  giftCelebrationSubtitle: { color: colors.roomText, fontSize: 12, fontWeight: '700', marginTop: 5 },
  giftsContent: {
    backgroundColor: colors.roomSurface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 16,
    maxHeight: '70%',
  },
  giftsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  giftsTitle: { color: colors.roomText, fontSize: 18, fontWeight: 'bold' },
  giftsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  giftCard: {
    width: 80,
    backgroundColor: colors.roomElevated,
    borderRadius: 12,
    padding: 10,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  giftCardActive: { borderColor: colors.gold },
  giftIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  giftIconText: { fontSize: 24 },
  giftName: { color: colors.roomText, fontSize: 11, marginTop: 4 },
  giftPrice: { color: colors.gold, fontSize: 12, fontWeight: 'bold', marginTop: 2 },
  balanceText: { color: colors.roomMuted, fontSize: 12, textAlign: 'center', marginTop: 16 },
  giftFundingOptions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  giftFundingOption: { flex: 1, paddingVertical: 9, paddingHorizontal: 5, borderRadius: 10, backgroundColor: '#1F2937', borderWidth: 1, borderColor: '#374151' },
  giftFundingOptionActive: { borderColor: colors.roomPrimary, backgroundColor: '#2D1B3F' },
  giftFundingText: { color: '#E5E7EB', fontSize: 10, textAlign: 'center', fontWeight: '700' },
  inviteModalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.68)' },
  inviteModal: { maxHeight: '72%', padding: 18, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: colors.roomSurface },
  inviteModalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  inviteModalTitle: { color: colors.roomText, fontSize: 17, fontWeight: '700' },
  inviteLoading: { marginVertical: 28 },
  inviteFriendRow: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.roomElevated },
  inviteFriendAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.roomElevated },
  inviteFriendInitial: { color: colors.roomPrimary, fontSize: 15, fontWeight: '800' },
  inviteFriendCopy: { flex: 1 },
  inviteFriendName: { color: colors.roomText, fontSize: 14, fontWeight: '600' },
  inviteFriendUsername: { color: colors.roomMuted, fontSize: 11, marginTop: 3 },
  inviteEmpty: { color: colors.roomMuted, fontSize: 13, lineHeight: 20, textAlign: 'center', paddingVertical: 26 },
  manageModalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  manageModal: { backgroundColor: colors.roomSurface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16, maxHeight: '75%' },
  manageModalTitle: { color: colors.roomText, fontSize: 17, fontWeight: '800', marginBottom: 14, textAlign: 'right' },
  manageRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.roomElevated },
  manageRowText: { color: colors.roomText, fontSize: 14, flex: 1 },
  manageCloseRow: { borderBottomWidth: 0 },
  passwordOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', alignItems: 'center' },
  passwordModal: { backgroundColor: colors.roomSurface, borderRadius: 20, padding: 20, width: '88%', maxWidth: 420 },
  passwordInput: { backgroundColor: colors.roomElevated, borderWidth: 1, borderColor: '#352644', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: colors.roomText, fontSize: 14, textAlign: 'right', marginBottom: 16 },
  passwordActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  passwordCancel: { paddingHorizontal: 18, paddingVertical: 10 },
  passwordCancelText: { color: colors.roomMuted, fontSize: 14 },
  passwordConfirm: { backgroundColor: colors.roomPrimary, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 10 },
  passwordConfirmText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  requestRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.roomElevated },
  requestRowName: { color: colors.roomText, fontSize: 14 },
  requestRowTime: { color: colors.roomMuted, fontSize: 11 },
  rejectBtn: { backgroundColor: colors.roomElevated, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  rejectText: { color: colors.roomText, fontSize: 13, fontWeight: '800' },
  auditRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.roomElevated },
  auditAction: { color: colors.roomText, fontSize: 13, fontWeight: '700' },
  auditActor: { color: colors.roomMuted, fontSize: 13 },
  auditTime: { color: colors.roomMuted, fontSize: 11 },
});
