/**
 * GiftScene — مشغل المشهد السينمائي الموحد لكل الهدايا.
 * - إذا كان للهدية أصل 3D مُصيّر مسبقًا (فيديو) يُشغّل بملء الشاشة.
 * - وإلا يُعرض مشهد إجرائي متدرّج حسب فئة/قيمة الهدية.
 * السلوك الموحد: ~5 ثوانٍ، ثم انكماش وتحرك نحو مقعد المستلم، ثم إخفاء (والشات يعرض الحدث).
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { Platform, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient as SvgGradient, Path, Polygon, Stop } from 'react-native-svg';
import Animated, {
  Easing,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useVideoPlayer, VideoView } from 'expo-video';
import { art, colors, fonts, glow, radius } from '@/lib/theme';
import { getGiftTier, type GiftTierConfig } from '@/lib/giftTiers';
import { usePreferencesStore } from '@/store/preferences';
import type { GiftCelebrationData } from './GiftCelebration';

export type GiftSceneData = GiftCelebrationData;

const DURATION_MS = 5000;
const EXIT_START_MS = 3900;
const EXIT_MS = 950;

function isVideoUrl(url?: string | null): url is string {
  return !!url && /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url);
}

function isRemoteUrl(url?: string | null): url is string {
  return !!url && /^https?:\/\//i.test(url);
}

function Star({
  index,
  progress,
  width,
  height,
  tint,
}: {
  index: number;
  progress: SharedValue<number>;
  width: number;
  height: number;
  tint: string;
}) {
  const seed = index * 137.508;
  const x = ((Math.sin(seed) + 1) / 2) * width;
  const y = ((Math.cos(seed * 1.7) + 1) / 2) * height * 0.8;
  const size = 3 + (index % 4) * 2.4;
  const delay = (index % 7) * 0.09;
  const drift = 18 + (index % 5) * 9;

  const style = useAnimatedStyle(() => {
    const p = Math.max(0, Math.min(1, (progress.value - delay) / (1 - delay)));
    return {
      opacity: p <= 0 ? 0 : Math.sin(p * Math.PI) * 0.95,
      transform: [{ translateY: -p * drift }, { scale: 0.4 + Math.sin(p * Math.PI) * 0.9 }],
    };
  });

  return (
    <Animated.Text
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          left: x,
          top: y,
          fontSize: size + 5,
          color: index % 3 === 0 ? tint : index % 3 === 1 ? art.starCool : art.starWarm,
          fontFamily: fonts.bold,
          textShadowColor: tint,
          textShadowRadius: 7,
        },
        style,
      ]}
    >
      ✦
    </Animated.Text>
  );
}

function Ship({ size }: { size: number }) {
  return (
    <Svg width={size} height={size * 0.95} viewBox="0 0 200 190">
      <Defs>
        <SvgGradient id="sail" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={art.sailTop} stopOpacity="0.99" />
          <Stop offset="0.3" stopColor={art.sailMid} stopOpacity="0.97" />
          <Stop offset="0.62" stopColor={art.sailRose} stopOpacity="0.95" />
          <Stop offset="1" stopColor={art.sailMint} stopOpacity="0.97" />
        </SvgGradient>
        <SvgGradient id="sailShade" x1="1" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={art.sailShadeHigh} stopOpacity="0.95" />
          <Stop offset="1" stopColor={art.sailShadeLow} stopOpacity="0.92" />
        </SvgGradient>
        <SvgGradient id="hull" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={art.hullHigh} stopOpacity="0.98" />
          <Stop offset="0.5" stopColor={art.hullMid} stopOpacity="0.98" />
          <Stop offset="1" stopColor={art.hullLow} stopOpacity="1" />
        </SvgGradient>
        <SvgGradient id="deck" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={art.deckHigh} stopOpacity="0.98" />
          <Stop offset="1" stopColor={art.deckLow} stopOpacity="0.98" />
        </SvgGradient>
      </Defs>
      <Path d="M58 40 L58 134" stroke={art.mast} strokeWidth="2.6" strokeLinecap="round" />
      <Path d="M100 20 L100 138" stroke={art.mastMain} strokeWidth="3" strokeLinecap="round" />
      <Path d="M142 44 L142 134" stroke={art.mast} strokeWidth="2.6" strokeLinecap="round" />
      <Path d="M58 42 C34 62 30 100 40 128 L58 128 Z" fill="url(#sail)" opacity="0.95" />
      <Path d="M58 42 C80 64 84 102 74 128 L58 128 Z" fill="url(#sailShade)" opacity="0.85" />
      <Path d="M100 22 C66 52 58 102 70 134 L100 134 Z" fill="url(#sail)" />
      <Path d="M100 22 C134 52 142 102 130 134 L100 134 Z" fill="url(#sailShade)" opacity="0.9" />
      <Path d="M142 46 C122 66 118 102 126 130 L142 130 Z" fill="url(#sail)" opacity="0.94" />
      <Path d="M142 46 C160 68 164 104 156 130 L142 130 Z" fill="url(#sailShade)" opacity="0.78" />
      <Path d="M100 20 L120 27 L100 34 Z" fill={colors.gold} />
      <Path d="M28 134 L172 134 L164 144 L36 144 Z" fill="url(#deck)" />
      <Path d="M24 145 C38 172 76 184 100 184 C126 184 162 172 176 145 Z" fill="url(#hull)" />
      <Path d="M38 150 C56 162 80 168 100 168 C120 168 146 162 162 150" stroke={art.hullHighlight} strokeWidth="1.5" strokeOpacity="0.6" fill="none" />
      <Polygon points="64,152 71,152 70,159 65,159" fill={art.portholes} opacity="0.92" />
      <Polygon points="95,154 102,154 101,162 96,162" fill={art.portholes} opacity="0.92" />
      <Polygon points="127,152 134,152 133,159 128,159" fill={art.portholes} opacity="0.92" />
    </Svg>
  );
}

function GiftBanner({ gift, combo, style }: { gift: GiftSceneData; combo: number; style: any }) {
  return (
    <Animated.View style={[styles.banner, style]}>
      <View style={styles.bannerRow}>
        <Text style={styles.bannerEmoji}>{gift.emoji}</Text>
        <View style={styles.bannerCopy}>
          <Text style={styles.bannerTitle} numberOfLines={1}>
            {gift.sender ?? 'عضو'} أهدى {gift.name}
          </Text>
          <Text style={styles.bannerSub} numberOfLines={1}>إلى {gift.recipient}</Text>
        </View>
        {combo > 1 && (
          <View style={styles.comboPill}>
            <Text style={styles.comboText}>×{combo}</Text>
          </View>
        )}
      </View>
    </Animated.View>
  );
}

function ProceduralGift({
  gift,
  combo,
  target,
  onDone,
}: {
  gift: GiftSceneData;
  combo: number;
  target?: { x: number; y: number } | null;
  onDone: () => void;
}) {
  const reduceMotion = usePreferencesStore((s) => s.reduceMotion);
  const { width, height } = useWindowDimensions();
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const tier = getGiftTier(gift.priceGold ?? 0, !!gift.premium);

  const travel = useSharedValue(reduceMotion ? 0.5 : 0);
  const bob = useSharedValue(0);
  const sweep = useSharedValue(0);
  const stars = useSharedValue(0);
  const banner = useSharedValue(reduceMotion ? 1 : 0);
  const exitProgress = useSharedValue(0);
  const pulse = useSharedValue(0);

  const isShip = tier.tier === 'legendary' || tier.tier === 'epic';
  const shipSize = Math.min(width * 0.66, 300);
  const starsArr = useMemo(() => Array.from({ length: tier.particleCount }), [tier.particleCount]);

  useEffect(() => {
    if (Platform.OS !== 'web') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      travel.value = 0.5;
      banner.value = 1;
      stars.value = 1;
      return;
    }
    travel.value = withTiming(1, { duration: 4200, easing: Easing.inOut(Easing.quad) });
    banner.value = withSequence(
      withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) }),
      withDelay(3200, withTiming(0, { duration: 420, easing: Easing.in(Easing.cubic) })),
    );
    bob.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 1100, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      true,
    );
    sweep.value = withRepeat(withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.quad) }), -1, false);
    stars.value = withTiming(1, { duration: 2000, easing: Easing.out(Easing.cubic) });
    pulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 700, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 700, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      true,
    );
    exitProgress.value = withDelay(EXIT_START_MS, withTiming(1, { duration: EXIT_MS, easing: Easing.inOut(Easing.cubic) }));
    const timeout = setTimeout(() => doneRef.current(), DURATION_MS);
    return () => clearTimeout(timeout);
  }, [banner, bob, exitProgress, pulse, reduceMotion, stars, sweep, travel]);

  const targetX = (target?.x ?? width / 2) - width / 2;
  const targetY = (target?.y ?? height * 0.45) - (height * 0.62);

  const heroStyle = useAnimatedStyle(() => {
    const exit = exitProgress.value;
    const baseX = isShip ? (0.5 - travel.value) * (width + shipSize) * (1 - exit) : 0;
    const baseY = (Math.sin(bob.value * Math.PI) * 10 - 6) * (1 - exit);
    const scale = isShip ? 1 - exit * 0.88 : 0.9 + Math.sin(pulse.value * Math.PI) * 0.08 * (1 - exit) - exit * 0.88;
    return {
      opacity: 1 - exit * 0.12,
      transform: [
        { translateX: baseX + targetX * exit },
        { translateY: baseY + targetY * exit },
        { scale },
        { rotate: isShip ? `${Math.sin(bob.value * Math.PI) * 2.4 * (1 - exit)}deg` : '0deg' },
      ],
    };
  });

  const sweepStyle = useAnimatedStyle(() => ({
    opacity: (0.14 + Math.sin(sweep.value * Math.PI) * 0.2) * (1 - exitProgress.value),
    transform: [{ rotate: `${-18 + sweep.value * 26}deg` }],
  }));
  const bannerStyle = useAnimatedStyle(() => ({
    opacity: banner.value * (1 - exitProgress.value),
    transform: [{ translateY: (1 - banner.value) * -14 }, { scale: 0.94 + banner.value * 0.06 }],
  }));
  const exitFadeStyle = useAnimatedStyle(() => ({ opacity: 1 - exitProgress.value }));

  const bg = tier.tier === 'legendary' || tier.tier === 'epic'
    ? [art.sceneSky, art.sceneSkyMid, art.sceneSkyLow]
    : [`${tier.colors[2]}22`, `${tier.colors[1]}33`, art.sceneSkyLow];

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <LinearGradient colors={bg as [string, string, string]} style={StyleSheet.absoluteFill} />
      <Animated.View style={[styles.rays, sweepStyle]}>
        <LinearGradient
          colors={[`${tier.colors[0]}66`, `${tier.colors[0]}00`]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, exitFadeStyle]}>
        {starsArr.map((_, index) => (
          <Star key={index} index={index} progress={stars} width={width} height={height} tint={tier.colors[0]} />
        ))}
      </Animated.View>
      <GiftBanner gift={gift} combo={combo} style={bannerStyle} />
      {isShip && (
        <Animated.View style={[styles.water, exitFadeStyle]} pointerEvents="none">
          <LinearGradient
            colors={[art.waterTop, art.waterMid, art.waterLow]}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.waterLine1} />
          <View style={styles.waterLine2} />
        </Animated.View>
      )}
      <Animated.View style={[styles.hero, heroStyle]}>
        {isShip ? (
          <Ship size={shipSize} />
        ) : (
          <TierHero gift={gift} tier={tier} />
        )}
      </Animated.View>
    </View>
  );
}

function TierHero({ gift, tier }: { gift: GiftSceneData; tier: GiftTierConfig }) {
  const size = 130 + tier.intensity * 90;
  const glowColor = tier.colors[1];
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ position: 'absolute', width: size * 2, height: size * 2, borderRadius: size, backgroundColor: glowColor, opacity: 0.16 }} />
      <View style={{ position: 'absolute', width: size * 1.35, height: size * 1.35, borderRadius: size, borderWidth: 1.5, borderColor: `${tier.colors[0]}66`, backgroundColor: `${tier.colors[2]}18` }} />
      {tier.tier === 'rare' ? <CrownShape size={size} c={tier.colors} /> :
       tier.tier === 'special' ? <CrystalShape size={size} c={tier.colors} /> :
       <OrbShape size={size} emoji={gift.emoji || '🎁'} c={tier.colors} />}
      <Text style={{ color: colors.text, fontFamily: fonts.black, fontSize: 13, marginTop: 14, textShadowColor: glowColor, textShadowRadius: 10 }}>
        {gift.name}
      </Text>
    </View>
  );
}

function OrbShape({ size, emoji, c }: { size: number; emoji: string; c: [string, string, string] }) {
  return (
    <LinearGradient
      colors={[`${c[0]}66`, `${c[1]}44`, `${c[2]}22`]}
      style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: `${c[0]}AA` }}
    >
      <Text style={{ fontSize: size * 0.4, lineHeight: size * 0.48 }}>{emoji}</Text>
    </LinearGradient>
  );
}

function CrystalShape({ size, c }: { size: number; c: [string, string, string] }) {
  const s = size * 0.95;
  return (
    <Svg width={s} height={s} viewBox="0 0 100 100">
      <Defs>
        <SvgGradient id="crys" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={c[0]} stopOpacity="0.95" />
          <Stop offset="1" stopColor={c[2]} stopOpacity="0.9" />
        </SvgGradient>
      </Defs>
      <Polygon points="50,5 90,35 75,90 25,90 10,35" fill="url(#crys)" stroke={c[0]} strokeWidth="1.5" />
      <Polygon points="50,5 75,90 25,90" fill={`${c[1]}55`} />
      <Path d="M50 5 L50 90 M10 35 L90 35 M25 90 L50 35 L75 90" stroke={art.outline} strokeOpacity="0.35" strokeWidth="1" />
    </Svg>
  );
}

function CrownShape({ size, c }: { size: number; c: [string, string, string] }) {
  const s = size * 1.05;
  return (
    <Svg width={s} height={s * 0.8} viewBox="0 0 120 96">
      <Defs>
        <SvgGradient id="crwn" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={c[0]} stopOpacity="1" />
          <Stop offset="1" stopColor={c[2]} stopOpacity="0.95" />
        </SvgGradient>
      </Defs>
      <Path d="M12 74 L22 28 L42 50 L60 18 L78 50 L98 28 L108 74 Z" fill="url(#crwn)" stroke={`${c[0]}CC`} strokeWidth="1.5" />
      <Path d="M16 74 L104 74 L100 86 L20 86 Z" fill={c[1]} stroke={`${c[0]}99`} strokeWidth="1" />
      <Circle cx="22" cy="26" r="4" fill={art.gem} />
      <Circle cx="60" cy="16" r="5" fill={art.gem} />
      <Circle cx="98" cy="26" r="4" fill={art.gem} />
      <Circle cx="60" cy="58" r="6" fill={`${c[0]}88`} stroke={art.gem} strokeWidth="1" />
    </Svg>
  );
}

function VideoGiftScene({
  gift,
  combo,
  target,
  onDone,
  uri,
}: {
  gift: GiftSceneData;
  combo: number;
  target?: { x: number; y: number } | null;
  onDone: () => void;
  uri: string;
}) {
  const reduceMotion = usePreferencesStore((s) => s.reduceMotion);
  const { width, height } = useWindowDimensions();
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const exitProgress = useSharedValue(0);
  const banner = useSharedValue(reduceMotion ? 1 : 0);

  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = false;
    instance.muted = true;
    instance.play();
  });

  useEffect(() => {
    if (Platform.OS !== 'web') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    if (!reduceMotion) {
      banner.value = withSequence(
        withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) }),
        withDelay(3200, withTiming(0, { duration: 420, easing: Easing.in(Easing.cubic) })),
      );
      exitProgress.value = withDelay(EXIT_START_MS, withTiming(1, { duration: EXIT_MS, easing: Easing.inOut(Easing.cubic) }));
    }
    const timeout = setTimeout(() => doneRef.current(), DURATION_MS);
    return () => clearTimeout(timeout);
  }, [banner, exitProgress, reduceMotion]);

  const targetX = (target?.x ?? width / 2) - width / 2;
  const targetY = (target?.y ?? height * 0.45) - height / 2;
  const containerStyle = useAnimatedStyle(() => {
    const exit = exitProgress.value;
    return {
      opacity: 1 - exit * 0.1,
      transform: [
        { translateX: targetX * exit },
        { translateY: targetY * exit },
        { scale: 1 - exit * 0.88 },
      ],
    };
  });
  const bannerStyle = useAnimatedStyle(() => ({
    opacity: banner.value * (1 - exitProgress.value),
    transform: [{ translateY: (1 - banner.value) * -14 }, { scale: 0.94 + banner.value * 0.06 }],
  }));

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <LinearGradient colors={[art.sceneSky, art.sceneSkyMid, art.sceneSkyLow]} style={StyleSheet.absoluteFill} />
      <Animated.View style={[StyleSheet.absoluteFill, containerStyle]}>
        <VideoView player={player} style={StyleSheet.absoluteFill} nativeControls={false} contentFit="contain" />
      </Animated.View>
      <GiftBanner gift={gift} combo={combo} style={bannerStyle} />
    </View>
  );
}

export function GiftScene({
  gift,
  combo = 1,
  target,
  onDone,
}: {
  gift: GiftSceneData;
  combo?: number;
  target?: { x: number; y: number } | null;
  onDone: () => void;
}) {
  const videoUri = isRemoteUrl(gift.animationUrl) && isVideoUrl(gift.animationUrl) ? gift.animationUrl : null;
  if (videoUri) {
    return <VideoGiftScene gift={gift} combo={combo} target={target} onDone={onDone} uri={videoUri} />;
  }
  return <ProceduralGift gift={gift} combo={combo} target={target} onDone={onDone} />;
}

const styles = StyleSheet.create({
  rays: { position: 'absolute', top: -60, left: -40, right: -40, height: '70%' },
  banner: { position: 'absolute', top: '16%', alignSelf: 'center', maxWidth: '86%' },
  bannerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radius.pill,
    backgroundColor: art.bannerGlass,
    borderWidth: 1,
    borderColor: colors.goldLine,
    ...glow(colors.gold, 22),
  },
  bannerEmoji: { fontSize: 22, lineHeight: 30 },
  bannerCopy: { flexShrink: 1 },
  bannerTitle: { color: colors.gold, fontFamily: fonts.black, fontSize: 13, lineHeight: 21 },
  bannerSub: { color: colors.textSecondary, fontFamily: fonts.semibold, fontSize: 10, lineHeight: 16 },
  comboPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  comboText: { color: colors.primaryLight, fontFamily: fonts.black, fontSize: 11, lineHeight: 16 },
  water: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '46%' },
  waterLine1: { position: 'absolute', top: 6, left: 0, right: 0, height: 1.5, backgroundColor: art.waterLine },
  waterLine2: { position: 'absolute', top: 22, left: '12%', right: '20%', height: 1, backgroundColor: art.waterLineFaint },
  hero: { position: 'absolute', bottom: '20%', alignSelf: 'center' },
  ship: { position: 'absolute', bottom: '20%', alignSelf: 'center', ...glow(colors.roomTeal, 30) },
});
