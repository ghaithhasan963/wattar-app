/**
 * Wattar App — صفحة التبويبات الرئيسية (Layout)
 */
import { Redirect, Tabs } from 'expo-router';
import { Home, Gamepad2, Wallet, User, Users } from 'lucide-react-native';
import { ActivityIndicator, Animated, Easing, StyleSheet, View } from 'react-native';
import { useEffect, useRef } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/store/auth';
import { colors, fonts, gradients, shadow } from '@/lib/theme';

const ACTIVE_TINT = colors.text;
const INACTIVE_TINT = colors.textMuted;

export default function TabsLayout() {
  const { session, profile } = useAuthStore();
  const insets = useSafeAreaInsets();

  if (!session) {
    return <Redirect href="/(auth)/login" />;
  }

  if (!profile) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!profile.onboarding_completed_at || !profile.gender) {
    return <Redirect href="/(auth)/complete-profile" />;
  }

  if (!profile.adult_confirmed_at) {
    return <Redirect href="/(auth)/age-confirmation" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          position: 'absolute',
          left: 14,
          right: 14,
          bottom: Math.max(insets.bottom, 8),
          height: 68,
          paddingTop: 8,
          paddingBottom: 7,
          backgroundColor: colors.bar,
          borderTopWidth: 0,
          borderRadius: 26,
          ...shadow.raised,
          borderWidth: 1,
          borderColor: colors.borderStrong,
        },
        tabBarActiveTintColor: ACTIVE_TINT,
        tabBarInactiveTintColor: INACTIVE_TINT,
        tabBarLabelStyle: { fontFamily: fonts.semibold, fontSize: 10, marginTop: 1 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'الرئيسية',
          tabBarIcon: ({ focused }) => <TabIcon icon={Home} color={focused ? ACTIVE_TINT : INACTIVE_TINT} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="games"
        options={{
          title: 'الألعاب',
          tabBarIcon: ({ focused }) => <TabIcon icon={Gamepad2} color={focused ? ACTIVE_TINT : INACTIVE_TINT} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="friends"
        options={{
          title: 'الأصدقاء',
          tabBarIcon: ({ focused }) => <TabIcon icon={Users} color={focused ? ACTIVE_TINT : INACTIVE_TINT} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="wallet"
        options={{
          title: 'المحفظة',
          tabBarIcon: ({ focused }) => <TabIcon icon={Wallet} color={focused ? ACTIVE_TINT : INACTIVE_TINT} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'حسابي',
          tabBarIcon: ({ focused }) => <TabIcon icon={User} color={focused ? ACTIVE_TINT : INACTIVE_TINT} focused={focused} />,
        }}
      />
      <Tabs.Screen name="settings" options={{ href: null }} />
      <Tabs.Screen name="notifications" options={{ href: null }} />
    </Tabs>
  );
}

function TabIcon({
  icon: Icon,
  color,
  focused,
}: {
  icon: typeof Home;
  color: string;
  focused: boolean;
}) {
  const scale = useRef(new Animated.Value(focused ? 1 : 0.94)).current;

  useEffect(() => {
    Animated.timing(scale, {
      toValue: focused ? 1 : 0.94,
      duration: 180,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [focused, scale]);

  return (
    <Animated.View style={[styles.tabIcon, focused && styles.tabIconActive, { transform: [{ scale }] }]}>
      {focused && (
        <LinearGradient
          colors={gradients.primary}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      )}
      <Icon size={19} color={focused ? colors.text : color} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabIcon: {
    width: 38,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    overflow: 'hidden',
  },
  tabIconActive: { ...shadow.card },
});
