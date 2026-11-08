/**
 * Wattar App — عميل الصوت الحي (LiveKit)
 *
 * - تسجيل globals الـ WebRTC مرة واحدة (مطلوب في React Native)
 * - الاتصال بغرفة صوتية عبر توكن من Edge Function (livekit-token)
 * - تفعيل/كتم الميكروفون
 *
 * إذا كان LiveKit غير مفعّل على الخادم (501) تعيد joinVoice configured:false
 * ويستمر التطبيق بشكل طبيعي (شات + مقاعد) بدون صوت.
 *
 * @version 1.0.0
 */
import { Platform } from 'react-native';
import type { Room } from 'livekit-client';
import { callFunction } from './supabase';

let globalsRegistered = false;
let liveKitModule: typeof import('@livekit/react-native') | null = null;
let audioSessionStarted = false;

/** يجب استدعاؤها مرة قبل تهيئة اتصال الصوت */
export function ensureWebRtcGlobals(): boolean {
  if (Platform.OS === 'web' || globalsRegistered) return true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    liveKitModule = require('@livekit/react-native') as typeof import('@livekit/react-native');
    const { registerGlobals } = liveKitModule;
    if (typeof registerGlobals !== 'function') {
      console.warn('[Wattar] LiveKit globals registration is unavailable');
      return false;
    }
    registerGlobals();
    globalsRegistered = true;
    return true;
  } catch (e) {
    console.warn('[Wattar] LiveKit globals registration failed:', e);
    return false;
  }
}

interface LiveTokenResponse {
  url: string;
  token: string;
  room: string;
  identity: string;
}

export interface JoinResult {
  room: Room | null;
  configured: boolean;
}

/** الاتصال بالصوت الخاص بغرفة Wattar */
export async function joinVoice(roomId: string): Promise<JoinResult> {
  if (Platform.OS === 'web') return { room: null, configured: false };

  let res: LiveTokenResponse;
  try {
    res = await callFunction<LiveTokenResponse>('livekit-token', { room_id: roomId });
  } catch (e: unknown) {
    const msg = String((e as Error)?.message ?? e ?? '');
    if (msg.includes('LIVEKIT_NOT_CONFIGURED')) return { room: null, configured: false };
    throw e;
  }

  if (!ensureWebRtcGlobals()) return { room: null, configured: false };

  // Load LiveKit only after native WebRTC globals are registered; Hermes does not
  // provide DOMException during initial app startup.
  const { Room } = require('livekit-client') as typeof import('livekit-client');
  const room = new Room({
    adaptiveStream: false,
    dynacast: false,
  });

  try {
    if (!liveKitModule) throw new Error('تعذر تهيئة مكتبة الصوت على هذا الجهاز.');
    await liveKitModule.AudioSession.startAudioSession();
    audioSessionStarted = true;
    await room.connect(res.url, res.token);
    return { room, configured: true };
  } catch (error: unknown) {
    try {
      if (room.state !== 'disconnected') await room.disconnect();
    } catch (cleanupError: unknown) {
      console.warn('[Wattar] LiveKit room cleanup failed:', cleanupError);
    }
    if (audioSessionStarted && liveKitModule) {
      try {
        await liveKitModule.AudioSession.stopAudioSession();
        audioSessionStarted = false;
      } catch (cleanupError: unknown) {
        console.warn('[Wattar] LiveKit audio session cleanup failed:', cleanupError);
      }
    }
    throw error;
  }
}

/** تفعيل أو كتم الميكروفون (يبقى النشر قائمًا عند الكتم لتجنّب إعادة طلب الإذن) */
export async function setMicEnabled(room: Room | null, enabled: boolean): Promise<void> {
  if (!room || room.state !== 'connected') return;
  try {
    await room.localParticipant.setMicrophoneEnabled(enabled);
  } catch (e) {
    console.warn('[Wattar] setMicrophoneEnabled failed:', e);
    throw e;
  }
}

/** قطع الاتصال بأمان */
export async function leaveVoice(room: Room | null): Promise<void> {
  try {
    if (room && room.state !== 'disconnected') await room.disconnect();
  } catch (error: unknown) {
    console.warn('[Wattar] voice disconnect failed:', error);
  } finally {
    if (audioSessionStarted && liveKitModule) {
      try {
        await liveKitModule.AudioSession.stopAudioSession();
        audioSessionStarted = false;
      } catch (error: unknown) {
        console.warn('[Wattar] voice audio session stop failed:', error);
      }
    }
  }
}
