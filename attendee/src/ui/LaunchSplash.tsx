import { useEffect, useMemo } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { FadeOut, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import { Mark, Wordmark } from './Logo';
import { Text } from './Text';
import { colors, fonts, space } from './theme';

/** How long the launch frame stays once the app is ready underneath it. */
export const SPLASH_MS = 1300;

/**
 * THE MOCKUP'S FIRST FRAME (2026-11-28): white, the logo stacked — the card
 * above the word — "Discover. Experience." and a yellow "Be There.", and a
 * crowd with its hands up in warm stage light along the foot.
 *
 * The phone's own launch screen (expo-splash-screen) can only centre one
 * picture, so this is drawn by the app the moment it is ready, over the first
 * screen, and fades away after SPLASH_MS. Shown once per launch, never on the
 * way back from the background.
 *
 * The crowd is DRAWN, not photographed: it must be there before any network
 * answers, and a stock crowd would be somebody else's event (the same rule as
 * the welcome screen).
 */
export function LaunchSplash({ onDone, hold = false }: { onDone: () => void; hold?: boolean }) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const reduce = useReducedMotion();
  useEffect(() => {
    if (hold) return undefined; // a development render of this frame (dev/renderDemo.ts)
    const t = setTimeout(onDone, SPLASH_MS);
    return () => clearTimeout(t);
  }, [onDone, hold]);

  const markH = Math.min(150, Math.round(width * 0.36));
  const artH = Math.round(height * 0.4);

  return (
    <Animated.View
      exiting={reduce ? undefined : FadeOut.duration(320)}
      style={[StyleSheet.absoluteFill, styles.root]}
      accessible
      accessibilityRole="image"
      accessibilityLabel="eventsli. Discover. Experience. Be There."
    >
      <View style={[styles.art, { height: artH }]} pointerEvents="none">
        <Crowd />
      </View>
      <View style={[styles.centre, { paddingTop: insets.top, paddingBottom: artH * 0.55 }]}>
        <Mark size={markH} />
        <View style={{ marginTop: space.md }}>
          <Wordmark height={Math.round(markH * 0.5)} />
        </View>
        <Text style={styles.tagline} align="center">Discover. Experience.</Text>
        <View style={styles.highlight}>
          <Text style={[styles.tagline, styles.tight]} color={colors.onHighlight}>Be There.</Text>
        </View>
      </View>
    </Animated.View>
  );
}

/** A deterministic shuffle, so the crowd is the same on every launch. */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const f1 = (n: number) => n.toFixed(1);
const circle = (cx: number, cy: number, r: number) => `M${f1(cx - r)} ${f1(cy)}a${f1(r)} ${f1(r)} 0 1 0 ${f1(2 * r)} 0a${f1(r)} ${f1(r)} 0 1 0 ${f1(-2 * r)} 0`;

/**
 * One row of people as solid shapes: a torso with rounded shoulders rising
 * into the neck, a head on it, and for most of them an arm or two — slim and
 * tapered, a small hand at the end — raised toward the stage.
 *
 * Every shape is its own path: overlapping parts of ONE path wind against
 * each other and cut holes in the crowd.
 */
function row(n: number, top: number, scale: number, seed: number): string[] {
  const rand = seeded(seed);
  const W = 400;
  const step = (W + 40) / (n - 1);
  const torsos: string[] = [];
  const parts: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const x = -20 + i * step + (rand() - 0.5) * step * 0.35;
    const r = (11 + rand() * 2.5) * scale;
    const hy = top + rand() * 14 * scale;
    const neck = hy + r * 0.7;
    const sw = 27 * scale;
    // The torso: straight sides, shoulders curving up to the neck.
    torsos.push(
      `M${f1(x - sw)} 410L${f1(x - sw)} ${f1(neck + 30 * scale)}`
      + `C${f1(x - sw)} ${f1(neck + 4 * scale)} ${f1(x - 8 * scale)} ${f1(neck)} ${f1(x)} ${f1(neck)}`
      + `C${f1(x + 8 * scale)} ${f1(neck)} ${f1(x + sw)} ${f1(neck + 4 * scale)} ${f1(x + sw)} ${f1(neck + 30 * scale)}`
      + `L${f1(x + sw)} 410Z`,
    );
    parts.push(circle(x, hy, r));
    const lift = rand();
    if (lift < 0.4) continue;
    const sides = lift > 0.8 ? [-1, 1] : [rand() > 0.5 ? 1 : -1];
    for (const side of sides) {
      const angle = side * (0.05 + rand() * 0.28);
      const len = (40 + rand() * 22) * scale;
      const sx = x + side * 17 * scale;
      const sy = neck + 12 * scale;
      const ex = sx + Math.sin(angle) * len;
      const ey = sy - Math.cos(angle) * len;
      const nx = Math.cos(angle);
      const ny = Math.sin(angle);
      const w0 = 4.6 * scale;
      const w1 = 2.6 * scale;
      parts.push(
        `M${f1(sx - nx * w0)} ${f1(sy - ny * w0)}L${f1(ex - nx * w1)} ${f1(ey - ny * w1)}`
        + `L${f1(ex + nx * w1)} ${f1(ey + ny * w1)}L${f1(sx + nx * w0)} ${f1(sy + ny * w0)}Z`,
        circle(ex + Math.sin(angle) * 2 * scale, ey - 2.5 * scale, 4 * scale),
      );
    }
  }
  return [...torsos, ...parts];
}

function Crowd() {
  const back = useMemo(() => row(24, 200, 0.78, 11), []);
  const front = useMemo(() => row(15, 250, 1.12, 29), []);
  return (
    <Svg width="100%" height="100%" viewBox="0 0 400 400" preserveAspectRatio="xMidYMax slice">
      <Defs>
        <LinearGradient id="glow" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={colors.sun300} stopOpacity="0" />
          <Stop offset="0.3" stopColor={colors.sun400} stopOpacity="0.55" />
          <Stop offset="0.6" stopColor="#ff8a3d" stopOpacity="0.9" />
          <Stop offset="1" stopColor={colors.coral600} stopOpacity="1" />
        </LinearGradient>
        <LinearGradient id="haze" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={colors.coral300} stopOpacity="0.75" />
          <Stop offset="1" stopColor={colors.sun200} stopOpacity="0.1" />
        </LinearGradient>
        <LinearGradient id="front" x1="0" y1="230" x2="0" y2="400" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor="#2a1212" />
          <Stop offset="0.45" stopColor={colors.night} />
          <Stop offset="1" stopColor={colors.night} />
        </LinearGradient>
        <LinearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={colors.white} stopOpacity="1" />
          <Stop offset="1" stopColor={colors.white} stopOpacity="0" />
        </LinearGradient>
      </Defs>
      {/* Warm stage light behind the crowd, and a soft pink haze on the left. */}
      <Path d="M-10 140C70 100 160 110 240 160C300 195 350 190 410 150L410 400L-10 400Z" fill="url(#glow)" />
      <Path d="M-10 110C40 85 120 100 165 145C125 190 60 205 -10 215Z" fill="url(#haze)" />
      {/* The back row in the light's own colour, then the front row in shadow. */}
      <G opacity={0.7}>{back.map((d) => <Path key={d} d={d} fill="#5a1d14" />)}</G>
      <G>{front.map((d) => <Path key={d} d={d} fill="url(#front)" />)}</G>
      {/* The brand's coral sweeping in along the foot, as drawn. */}
      <Path d="M180 410C240 352 318 336 410 330L410 410Z" fill={colors.coral600} />
      <Path d="M262 410C310 378 356 370 410 370L410 410Z" fill={colors.coral500} opacity={0.85} />
      {/* Melt the top of the art into the white page. */}
      <Rect x="-10" y="0" width="420" height="140" fill="url(#fade)" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.white, zIndex: 100 },
  art: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xl },
  tagline: { fontFamily: fonts.bold, fontSize: 23, lineHeight: 30, color: colors.text, marginTop: space.xl },
  tight: { marginTop: 0 },
  highlight: { marginTop: space.sm, paddingHorizontal: 12, paddingVertical: 2, borderRadius: 8, backgroundColor: colors.highlight },
});
