import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, View } from 'react-native';
import { useAudioPlayer } from 'expo-audio';
import { useVideoPlayer, VideoView } from 'expo-video';
import { colors } from '@/lib/theme';

export interface GiftEffectPayload {
  giftId: string;
  name: string;
  emoji: string;
  iconUrl: string;
  animationUrl: string | null;
  soundUrl: string | null;
  effectKey: string | null;
  durationMs: number;
  giftType: string;
  rarity: string;
  price: number;
  senderName: string;
  receiverName: string;
}

interface Props {
  effect: GiftEffectPayload | null;
  onDone: () => void;
}

const rarityColors: Record<string, string> = {
  common: '#C9B8E0',
  uncommon: '#4ADE80',
  rare: '#60A5FA',
  epic: '#C084FC',
  legendary: '#FBBF24',
};

function isVideoUrl(url: string) {
  return /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url);
}

function isRemote(url: string | null): url is string {
  return !!url && /^https:\/\//i.test(url);
}

function particleEmoji(effectKey: string | null, fallback: string) {
  const key = (effectKey ?? '').toLowerCase();
  if (key.includes('snow')) return '❄️';
  if (key.includes('heart')) return '💖';
  if (key.includes('firework')) return '🎆';
  if (key.includes('fire')) return '🔥';
  if (key.includes('confetti')) return '🎉';
  if (key.includes('star')) return '⭐';
  if (key.includes('flower') || key.includes('rose')) return '🌹';
  if (key.includes('sparkle') || key.includes('glow')) return '✨';
  return fallback;
}

function GiftMedia({ effect }: { effect: GiftEffectPayload }) {
  const animation = effect.animationUrl;
  if (isRemote(animation) && isVideoUrl(animation)) {
    return <GiftVideo uri={animation} />;
  }
  if (isRemote(animation)) {
    return <Image source={{ uri: animation }} style={styles.mediaImage} resizeMode="contain" />;
  }
  if (isRemote(effect.iconUrl)) {
    return <Image source={{ uri: effect.iconUrl }} style={styles.mediaImage} resizeMode="contain" />;
  }
  return <Text style={styles.mediaEmoji}>{effect.emoji}</Text>;
}

function GiftVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = false;
    instance.muted = true;
    instance.play();
  });
  return (
    <VideoView
      player={player}
      style={styles.mediaImage}
      nativeControls={false}
      contentFit="contain"
    />
  );
}

function GiftSound({ uri }: { uri: string }) {
  const player = useAudioPlayer({ uri });
  useEffect(() => {
    try {
      player.play();
    } catch (caught: unknown) {
      console.warn('[Wattar] Gift sound failed:', caught);
    }
  }, [player]);
  return null;
}

function Particle({ emoji, angle, distance, delay, duration }: {
  emoji: string;
  angle: number;
  distance: number;
  delay: number;
  duration: number;
}) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration,
      delay,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [duration, delay, progress]);

  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(angle) * distance] });
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [0, Math.sin(angle) * distance] });
  const opacity = progress.interpolate({ inputRange: [0, 0.15, 0.7, 1], outputRange: [0, 1, 1, 0] });
  const scale = progress.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0.4, 1.1, 0.7] });

  return (
    <Animated.Text style={[styles.particle, { opacity, transform: [{ translateX }, { translateY }, { scale }] }]}>
      {emoji}
    </Animated.Text>
  );
}

export function GiftEffectOverlay({ effect, onDone }: Props) {
  const scale = useRef(new Animated.Value(0.4)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;

  const duration = effect?.durationMs ?? 4000;

  useEffect(() => {
    if (!effect) return;
    scale.setValue(0.4);
    opacity.setValue(0);
    glow.setValue(0);

    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, friction: 5, tension: 70, useNativeDriver: true }),
      Animated.loop(
        Animated.sequence([
          Animated.timing(glow, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(glow, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
      ),
    ]).start();

    const fadeOut = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 260, useNativeDriver: true }).start(() => onDone());
    }, Math.max(duration - 300, 800));

    return () => clearTimeout(fadeOut);
  }, [effect, duration, opacity, scale, glow, onDone]);

  const particles = useMemo(() => {
    if (!effect) return [];
    const emoji = particleEmoji(effect.effectKey, effect.emoji);
    return Array.from({ length: 14 }, (_, index) => {
      const angle = (Math.PI * 2 * index) / 14 + Math.random() * 0.5;
      return {
        id: `${effect.giftId}-${index}`,
        emoji,
        angle,
        distance: 110 + Math.random() * 90,
        delay: Math.random() * 350,
        duration: Math.max(duration - 600, 1400) + Math.random() * 400,
      };
    });
  }, [effect, duration]);

  if (!effect) return null;

  const tint = rarityColors[effect.rarity] ?? rarityColors.common;
  const isHuge = effect.giftType === 'huge' || effect.giftType === 'entry';

  return (
    <View pointerEvents="none" style={styles.overlay}>
      <Animated.View
        style={[
          styles.card,
          isHuge && styles.cardHuge,
          { opacity, borderColor: tint, transform: [{ scale }] },
        ]}
      >
        <View style={styles.particleField}>
          {particles.map((particle) => (
            <Particle key={particle.id} {...particle} />
          ))}
        </View>

        <Animated.View
          style={[
            styles.glow,
            {
              backgroundColor: tint,
              opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0.12, 0.34] }),
              transform: [{ scale: glow.interpolate({ inputRange: [0, 1], outputRange: [1, 1.14] }) }],
            },
          ]}
        />

        <View style={styles.mediaBox}>
          <GiftMedia effect={effect} />
        </View>

        <Text style={styles.giftName} numberOfLines={2}>{effect.name}</Text>
        <Text style={styles.route} numberOfLines={1}>
          {effect.senderName} → {effect.receiverName}
        </Text>
        <Text style={[styles.price, { color: tint }]}>
          {effect.price.toLocaleString()} Coins
        </Text>

        {isRemote(effect.soundUrl) ? <GiftSound uri={effect.soundUrl} /> : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#05000866',
    zIndex: 50,
  },
  card: {
    width: 280,
    paddingHorizontal: 22,
    paddingVertical: 24,
    borderRadius: 28,
    alignItems: 'center',
    backgroundColor: '#160B24F2',
    borderWidth: 1.5,
    overflow: 'hidden',
  },
  cardHuge: { width: 320, paddingVertical: 34, borderRadius: 34 },
  particleField: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  particle: { position: 'absolute', fontSize: 22 },
  glow: { position: 'absolute', width: 190, height: 190, borderRadius: 95 },
  mediaBox: { width: 116, height: 116, alignItems: 'center', justifyContent: 'center' },
  mediaImage: { width: 116, height: 116 },
  mediaEmoji: { fontSize: 66 },
  giftName: { color: colors.text, fontSize: 17, fontWeight: '900', textAlign: 'center', marginTop: 10 },
  route: { color: colors.textSecondary, fontSize: 12, marginTop: 7, textAlign: 'center' },
  price: { fontSize: 14, fontWeight: '900', marginTop: 6 },
});
