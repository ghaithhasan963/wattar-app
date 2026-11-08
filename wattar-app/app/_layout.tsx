/**
 * Wattar App — التخطيط الرئيسي (Root Layout)
 */
import { Href, Stack, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Animated, AppState, Easing, PermissionsAndroid, Platform, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { useAuthStore } from '@/store/auth';
import { usePreferencesStore } from '@/store/preferences';
import { supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const STARTUP_PERMISSIONS_KEY = 'wattar-startup-permissions-requested';

export default function RootLayout() {
  const router = useRouter();
  const { init, initialized, session } = useAuthStore();
  const { hydrate, hydrated, reduceMotion } = usePreferencesStore();
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    init();
    hydrate();
  }, [init, hydrate]);

  useEffect(() => {
    if (!initialized || !hydrated || !session || Platform.OS !== 'android') return;

    let active = true;
    const requestMicrophonePermission = async () => {
      try {
        const alreadyRequested = await AsyncStorage.getItem(STARTUP_PERMISSIONS_KEY);
        if (alreadyRequested === '1') return;

        const audioPermission = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          {
            title: 'إذن الميكروفون',
            message: 'يحتاج Wattar إلى إذن الميكروفون عند المشاركة في الغرف الصوتية.',
            buttonPositive: 'السماح',
            buttonNegative: 'لاحقًا',
          },
        );
        if (audioPermission !== PermissionsAndroid.RESULTS.GRANTED) {
          console.info('[Wattar] Microphone permission was not granted during bootstrap');
        }
        if (active) await AsyncStorage.setItem(STARTUP_PERMISSIONS_KEY, '1');
      } catch (error: unknown) {
        console.warn('[Wattar] Microphone permission request failed:', error);
      }
    };

    void requestMicrophonePermission();

    return () => {
      active = false;
    };
  }, [hydrated, initialized, session]);

  useEffect(() => {
    if (!initialized || !session) return;
    let lastHandledNotificationId: string | null = null;
    const openNotificationRoute = (route: unknown) => {
      if (typeof route !== 'string') return;
      if (route === '/(tabs)/friends') {
        router.push('/(tabs)/friends');
        return;
      }
      const messageMatch = route.match(/^\/messages\/([0-9a-f-]{36})$/i);
      if (messageMatch) {
        router.push(`/messages/${messageMatch[1]}` as Href);
        return;
      }
      const roomMatch = route.match(/^\/room\/([0-9a-f-]{36})$/i);
      if (roomMatch) router.push(`/room/${roomMatch[1]}` as Href);
    };
    const handleNotificationResponse = (response: Notifications.NotificationResponse) => {
      const identifier = response.notification.request.identifier;
      if (identifier === lastHandledNotificationId) return;
      lastHandledNotificationId = identifier;
      openNotificationRoute(response.notification.request.content.data?.route);
    };

    const responseSubscription = Notifications.addNotificationResponseReceivedListener(handleNotificationResponse);
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) handleNotificationResponse(response);
    }).catch((error: unknown) => {
      console.warn('[Wattar] Failed to read last notification response:', error);
    });

    return () => responseSubscription.remove();
  }, [initialized, router, session?.user.id]);

  useEffect(() => {
    if (!session) return;
    let active = true;
    const updatePresence = () => {
      if (AppState.currentState !== 'active') return;
      supabase.rpc('set_my_presence').then(({ error }) => {
        if (error && active) console.warn('[Wattar] Presence update failed:', error.message);
      });
    };
    updatePresence();
    const interval = setInterval(updatePresence, 60_000);
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') updatePresence();
    });
    return () => {
      active = false;
      clearInterval(interval);
      appStateSubscription.remove();
    };
  }, [session?.user.id]);

  useEffect(() => {
    if ((initialized && hydrated) || reduceMotion) return;
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [hydrated, initialized, pulse, reduceMotion]);

  if (!initialized || !hydrated) {
    return (
      <View style={styles.loading}>
        <StatusBar style="light" />
        <Animated.Image
          source={require('../assets/wattar-icon.png')}
          resizeMode="contain"
          style={[
            styles.brandImage,
            {
              opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.78, 1] }),
              transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1.06] }) }],
            },
          ]}
        />
        <Text style={styles.loadingText}>نجهّز مساحتك الصوتية...</Text>
        <View style={styles.loadingTrack}>
          <Animated.View
            style={[
              styles.loadingBar,
              { transform: [{ translateX: pulse.interpolate({ inputRange: [0, 1], outputRange: [-42, 42] }) }] },
            ]}
          />
        </View>
      </View>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="room" />
        <Stack.Screen name="game" />
      </Stack>
    </>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: colors.roomBackground,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  brandImage: { width: 260, height: 260, borderRadius: 28 },
  loadingText: { color: '#94A3B8', fontSize: 14, marginTop: 8 },
  loadingTrack: { width: 92, height: 3, borderRadius: 2, overflow: 'hidden', backgroundColor: colors.roomElevated, marginTop: 24 },
  loadingBar: { width: 46, height: 3, borderRadius: 2, backgroundColor: colors.roomTeal },
});
