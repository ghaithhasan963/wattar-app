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
  PermissionsAndroid, Platform, Modal,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { supabase, callFunction } from '@/lib/supabase';
import { notifySocialEvent } from '@/lib/notifications';
import { useAuthStore } from '@/store/auth';
import { usePreferencesStore } from '@/store/preferences';
import { colors } from '@/lib/theme';
import { StatusBar } from 'expo-status-bar';
import { joinVoice, leaveVoice, setMicEnabled } from '@/lib/livekit';
import type { Room } from 'livekit-client';
import {
  Mic, MicOff, X, Send, Gift, Crown, Lock, LogOut, Users, Volume2, VolumeX, UserPlus,
} from 'lucide-react-native';

const VOICE_OFF = 'off' as const;
const VOICE_CONNECTING = 'connecting' as const;
const VOICE_ON = 'on' as const;
const VOICE_UNAVAILABLE = 'unavailable' as const;
type VoiceState = typeof VOICE_OFF | typeof VOICE_CONNECTING | typeof VOICE_ON | typeof VOICE_UNAVAILABLE;

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
  const [isMuted, setIsMuted] = useState(true);
  const [showGifts, setShowGifts] = useState(false);
  const [showRoomInvites, setShowRoomInvites] = useState(false);
  const [inviteFriends, setInviteFriends] = useState<Array<{ user_id: string; username: string; display_name: string | null }>>([]);
  const [invitesLoading, setInvitesLoading] = useState(false);
  const [invitingUserId, setInvitingUserId] = useState<string | null>(null);
  const [mySeat, setMySeat] = useState<number | null>(null);
  const [listenersCount, setListenersCount] = useState(0);
  const [voiceState, setVoiceState] = useState<VoiceState>(VOICE_CONNECTING);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [micLoading, setMicLoading] = useState(false);
  const chatListRef = useRef<FlatList>(null);
  const lkRoomRef = useRef<Room | null>(null);
  const seatsRef = useRef<Seat[]>([]);
  const speakersCount = seats.filter(seat => seat.status === 'occupied' && seat.user_id).length;

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
          await callFunction(functionName, { room_id: id, session_id: presenceSessionId });
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

    (async () => {
      try {
        setVoiceState(VOICE_CONNECTING);
        setVoiceError(null);
        const { room, configured } = await joinVoice(id);
        if (cancelled) {
          await leaveVoice(room);
          return;
        }
        if (!configured || !room) {
          await leaveVoice(room);
          setVoiceError('خدمة الصوت الحي غير مهيأة على الخادم.');
          setVoiceState(VOICE_UNAVAILABLE);
          return;
        }
        lkRoomRef.current = room;
        room.on('connected', () => setVoiceState(VOICE_ON));
        room.on('disconnected', () => {
          if (!cancelled) setVoiceState(VOICE_OFF);
        });
        setVoiceState(room.state === 'connected' ? VOICE_ON : VOICE_CONNECTING);
      } catch (e) {
        console.warn('[Wattar] voice join failed:', e);
        if (!cancelled) {
          setVoiceError(e instanceof Error ? e.message : 'تعذر الاتصال بخدمة الصوت.');
          setVoiceState(VOICE_UNAVAILABLE);
        }
      }
    })();

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

  const loadRoom = async () => {
    setRoomLoading(true);
    setRoomError(null);
    const [roomResult, seatsResult, messagesResult] = await Promise.all([
      supabase
      .from('rooms')
      .select(`
        id, name, owner_id, seat_count, status, listeners_count, speakers_count,
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
    setListenersCount(roomResult.data.listeners_count);
    const loadedSeats = seatsResult.data ?? [];
    seatsRef.current = loadedSeats as Seat[];
    setSeats(loadedSeats);
    const myOccupiedSeat = loadedSeats.find(
      seat => seat.user_id === profile?.id && seat.status === 'occupied',
    );
    setMySeat(myOccupiedSeat?.seat_index ?? null);
    setMessages(messagesResult.data ?? []);
    setRoomLoading(false);
  };

  const loadSeats = async () => {
    const { data, error } = await supabase
      .from('room_seats')
      .select(`
        *,
        user:users(username, display_name, avatar_url)
      `)
      .eq('room_id', id)
      .order('seat_index', { ascending: true });

    if (error) throw error;
    const loadedSeats = (data ?? []) as Seat[];
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
                : undefined,
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
          setListenersCount(updatedRoom.listeners_count ?? 0);
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

    const { data, error } = await supabase
      .from('room_messages')
      .insert({
        room_id: id,
        user_id: profile.id,
        message: msg,
      })
      .select('id, user_id, message, is_system, created_at')
      .single();

    if (error) {
      setMessages(prev => prev.filter(message => message.id !== optimisticId));
      setNewMessage(msg);
      Alert.alert('تعذر إرسال الرسالة', error.message);
      return;
    }
    const savedMessage: Message = { ...data, user: optimisticMessage.user };
    setMessages(prev => {
      const withoutPending = prev.filter(message => message.id !== optimisticId);
      const existingIndex = withoutPending.findIndex(message => message.id === savedMessage.id);
      if (existingIndex >= 0) {
        return withoutPending.map((message, index) => index === existingIndex ? savedMessage : message);
      }
      return [...withoutPending, savedMessage];
    });
  };

  const takeSeat = async (seatIndex: number) => {
    if (!profile) return;
    const seat = seats.find(s => s.seat_index === seatIndex);
    if (!seat || seat.status !== 'empty') return;

    const { data: claimedSeats, error } = await supabase
      .from('room_seats')
      .update({
        user_id: profile.id,
        status: 'occupied',
        is_mic_on: false,
        joined_at: new Date().toISOString(),
      })
      .eq('id', seat.id)
      .eq('status', 'empty')
      .is('user_id', null)
      .select('id');

    if (error) {
      Alert.alert('خطأ', 'فشل احتلال المقعد');
    } else if (!claimedSeats?.length) {
      Alert.alert('المقعد مشغول', 'سبق مستخدم آخر إلى هذا المقعد. حدّث الغرفة واختر مقعدًا آخر.');
      await loadRoom();
    } else {
      setMySeat(seatIndex);
    }
  };

  const leaveSeat = async () => {
    if (!profile || mySeat === null) return;
    const seat = seats.find(s => s.seat_index === mySeat);
    if (!seat) return;

    const { error } = await supabase
      .from('room_seats')
      .update({
        user_id: null,
        status: 'empty',
        is_mic_on: false,
        joined_at: null,
      })
      .eq('id', seat.id);
    if (error) {
      Alert.alert('خطأ', 'تعذر ترك المقعد. حاول مرة أخرى.');
      return;
    }
    setMySeat(null);
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
      // الكتم/التفعيل الفعلي على الصوت الحي
      await setMicEnabled(lkRoomRef.current, !newMute);
      const { error } = await supabase
        .from('room_seats')
        .update({ is_mic_on: !newMute })
        .eq('id', seat.id);
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
        Alert.alert('تعذر إرسال الإشعار', notificationError instanceof Error
          ? notificationError.message
          : 'أُرسلت الدعوة، لكن تعذر إرسال الإشعار.');
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
              onTake={() => takeSeat(seat.seat_index)}
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
                        {item.user?.display_name ?? item.user?.username ?? 'مستخدم'}
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
      <View style={styles.inputBar}>
        <TouchableOpacity
          style={styles.giftBtn}
          onPress={() => setShowGifts(true)}
          accessibilityRole="button"
          accessibilityLabel="إرسال هدية"
        >
          <Gift size={22} color={colors.gold} />
        </TouchableOpacity>
        <TextInput
          style={styles.messageInput}
          value={newMessage}
          onChangeText={setNewMessage}
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
        />
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
    </View>
  );
}

function SeatView({
  seat,
  mySeat,
  isOwner,
  onTake,
}: {
  seat: Seat;
  mySeat: number | null;
  isOwner: boolean;
  onTake: () => void;
}) {
  const isOccupied = seat.status === 'occupied' && seat.user_id;
  const isLocked = seat.status === 'locked';
  const canTake = !isOccupied && !isLocked && (mySeat === null || mySeat === seat.seat_index);

  return (
    <TouchableOpacity
      style={[styles.seat, isOwner && seat.is_owner_seat && styles.seatOwner]}
      onPress={canTake ? onTake : undefined}
      disabled={!canTake}
      accessibilityRole="button"
      accessibilityLabel={isOccupied
        ? `المقعد ${seat.seat_index + 1}، ${seat.user?.display_name ?? seat.user?.username ?? 'متحدث'}${seat.is_mic_on ? '، يتحدث' : '، الميكروفون مكتوم'}`
        : isLocked ? `المقعد ${seat.seat_index + 1}، مقفل` : `انضم إلى المقعد ${seat.seat_index + 1}`}
      accessibilityHint={canTake ? 'اضغط للانضمام إلى المنصة الصوتية' : undefined}
      accessibilityState={{ disabled: !canTake }}
    >
      {isOccupied ? (
        <>
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
          <Text style={styles.seatName} numberOfLines={1}>
            {seat.user?.display_name ?? seat.user?.username}
          </Text>
          <View style={[styles.micIcon, seat.is_mic_on ? styles.micOn : styles.micOff]}>
            {seat.is_mic_on ? <Mic size={10} color="#fff" /> : <MicOff size={10} color="#fff" />}
          </View>
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

function GiftsModal({ roomId, seats, onClose }: { roomId: string; seats: Seat[]; onClose: () => void }) {
  const { profile, loadProfile } = useAuthStore();
  const [gifts, setGifts] = useState<any[]>([]);
  const [selectedGift, setSelectedGift] = useState<string | null>(null);
  const [receiver, setReceiver] = useState<{ id: string; name: string } | null>(null);
  const [fundingCurrency, setFundingCurrency] = useState<'gold' | 'conv_gold'>('gold');
  const [sending, setSending] = useState(false);
  const [giftAttempt, setGiftAttempt] = useState<{ fingerprint: string; key: string } | null>(null);

  useEffect(() => {
    supabase.from('gifts').select('*').eq('is_active', true).order('sort_order').then(({ data }) => setGifts(data ?? []));
  }, []);

  // المستلمون الممكنون: جميع أصحاب المقاعد عدا أنا
  const recipients = seats
    .filter(s => s.status === 'occupied' && s.user_id && s.user_id !== profile?.id)
    .map(s => ({ id: s.user_id!, name: s.user?.display_name ?? s.user?.username ?? 'مستخدم' }));
  const selectedGiftRecord = gifts.find(gift => gift.id === selectedGift);

  const sendGift = async () => {
    if (!selectedGift || !receiver || sending) return;
    const balance = fundingCurrency === 'gold'
      ? profile?.balance_gold ?? 0
      : profile?.balance_converted_coins ?? 0;
    if (balance < Number(selectedGiftRecord?.price_gold ?? 0)) {
      Alert.alert('رصيد غير كافٍ', 'اختر نوع رصيد آخر أو اشحن Coins مدفوعة.');
      return;
    }
    setSending(true);
    try {
      const fingerprint = `${receiver.id}:${selectedGift}:${roomId}:${fundingCurrency}`;
      const idempotencyKey = giftAttempt?.fingerprint === fingerprint
        ? giftAttempt.key
        : `gift-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      setGiftAttempt({ fingerprint, key: idempotencyKey });
      await callFunction('gift-send', {
        to_user_id: receiver.id,
        gift_id: selectedGift,
        room_id: roomId,
        quantity: 1,
        funding_currency: fundingCurrency,
      }, idempotencyKey);
      setGiftAttempt(null);
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
      Alert.alert('خطأ', String((e as Error)?.message ?? 'فشل إرسال الهدية'));
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={styles.giftsModal}>
      <View style={styles.giftsContent}>
        <View style={styles.giftsHeader}>
          <Text style={styles.giftsTitle}>{receiver ? 'هدية إلى: ' + receiver.name : 'إرسال هدية'}</Text>
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
            <View style={styles.giftsGrid}>
              {gifts.map(g => (
                <TouchableOpacity
                  key={g.id}
                  style={[styles.giftCard, selectedGift === g.id && styles.giftCardActive]}
                  onPress={() => setSelectedGift(g.id)}
                >
                  <View style={styles.giftIcon}>
                    <Text style={styles.giftIconText}>{g.icon_emoji ?? '🎁'}</Text>
                  </View>
                  <Text style={styles.giftName}>{g.name_ar ?? g.name}</Text>
                  <Text style={styles.giftPrice}>{g.price_gold} Coins</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.stepHint}>اختر المستلم من الجالسين على المقاعد:</Text>
            {recipients.length === 0 ? (
              <Text style={styles.noRecipients}>لا يوجد مستلمون حالياً — لا بد من مستخدم آخر على مقعد</Text>
            ) : (
              <View style={styles.recipientsRow}>
                {recipients.map(r => (
                  <TouchableOpacity
                    key={r.id}
                    style={styles.recipientChip}
                    onPress={() => setReceiver(r)}
                  >
                    <Text style={styles.recipientText}>{r.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <TouchableOpacity
              style={[styles.sendGiftBtn, (!selectedGift || !receiver && recipients.length === 0 || !receiver) && styles.sendGiftDisabled]}
              disabled={!selectedGift || !receiver}
              onPress={() => {
                // إذا لم يُختر مستلم بعد ولا يوجد سوى مستلم واحد نختاره تلقائياً
                if (!receiver && recipients.length === 1) setReceiver(recipients[0]);
              }}
            >
              <Text style={styles.sendGiftText}>
                {selectedGift ? (recipients.length === 1 ? 'إرسال مباشر' : 'اختر المستلم ثم اضغط إرسال') : 'اختر هدية أولاً'}
              </Text>
            </TouchableOpacity>

            <View style={styles.giftFundingOptions}>
              {([
                { currency: 'gold' as const, label: `مدفوعة · ${profile?.balance_gold?.toLocaleString() ?? 0}` },
                { currency: 'conv_gold' as const, label: `محوّلة · ${profile?.balance_converted_coins?.toLocaleString() ?? 0}` },
              ]).map((option) => (
                <TouchableOpacity
                  key={option.currency}
                  style={[styles.giftFundingOption, fundingCurrency === option.currency && styles.giftFundingOptionActive]}
                  onPress={() => setFundingCurrency(option.currency)}
                >
                  <Text style={styles.giftFundingText}>{option.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.balanceText}>Coins المجانية للألعاب منفصلة ولا يمكن استخدامها لهدايا الدعم.</Text>
          </>
        ) : (
          <>
            <Text style={styles.stepHint}>تأكيد الإرسال:</Text>
            <TouchableOpacity
              style={[styles.sendGiftBtn, (!selectedGift || sending) && styles.sendGiftDisabled]}
              disabled={!selectedGift || sending}
              onPress={sendGift}
            >
              <Text style={styles.sendGiftText}>{sending ? '…جاري الإرسال' : 'تأكيد الإرسال 🎁'}</Text>
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
    backgroundColor: colors.roomPrimary, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7,
  },
  recipientText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  sendGiftBtn: {
    backgroundColor: colors.gold, borderRadius: 12, paddingVertical: 13,
    alignItems: 'center', marginTop: 14,
  },
  sendGiftDisabled: { opacity: 0.4 },
  sendGiftText: { color: '#fff', fontSize: 14, fontWeight: '800' },
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
});
