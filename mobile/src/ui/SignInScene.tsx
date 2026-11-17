import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, RadialGradient, Stop } from 'react-native-svg';

import { colors } from './theme';

/**
 * THE SIGN-IN SCREEN'S ARTWORK, after the owner's mockup (2026-11-17) — in soft
 * colours on purpose. The mockup's deep crimson ribbons and black base became
 * pale blush, a hairline of gold and a warm linen band; its photo of a concert
 * is drawn here as a faded stage and crowd in light greys. Nothing is traced or
 * photographed. Every piece is decorative and never touched.
 */

const BLUSH = colors.coral200;
const BLUSH_PALE = colors.coral100;
const GOLD = '#f0c75e';
const LINEN = '#f7eeee';
const DOT = '#c9c9d1';

/** The waves in the top corners: grey on the left, blush on the right. */
export function SignInWaves({ width }: { width: number }) {
  const h = width * 0.75;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width={width} height={h} viewBox="0 0 400 300" accessible={false}>
        <Defs>
          <LinearGradient id="blush" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={BLUSH_PALE} stopOpacity={0.5} />
            <Stop offset="1" stopColor={BLUSH} stopOpacity={0.75} />
          </LinearGradient>
        </Defs>
        <Path d="M0 0H260C220 30 150 40 90 70 50 90 20 120 0 160Z" fill="#efeff2" opacity={0.8} />
        <Path d="M0 0H170C135 22 88 32 50 56 26 71 10 90 0 112Z" fill="#e8e8ed" opacity={0.6} />
        <Path d="M215 0H400V196C384 136 344 94 294 62 258 40 228 22 215 0Z" fill="url(#blush)" />
        <Path d="M300 0H400V126C386 86 362 58 332 38 316 27 306 14 300 0Z" fill={colors.coral300} opacity={0.28} />
        <Path d="M226 0C246 30 284 50 322 70 362 92 390 132 400 176" fill="none" stroke={colors.white} strokeWidth={2} opacity={0.9} />
      </Svg>
      <Dots style={styles.dotsTopLeft} cols={9} rows={7} from="topLeft" />
    </View>
  );
}

/** A small grid of dots fading away from one corner (the mockup's halftone). */
export function Dots({ style, cols, rows, from }: { style: object; cols: number; rows: number; from: 'topLeft' | 'topRight' }) {
  const gap = 9;
  const dots = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const fromCorner = from === 'topLeft' ? c + r : (cols - 1 - c) + r;
      const fade = 1 - fromCorner / (cols + rows - 2);
      if (fade <= 0.05) continue;
      dots.push(<Circle key={`${r}-${c}`} cx={c * gap + 3} cy={r * gap + 3} r={1.6} fill={DOT} opacity={fade * 0.9} />);
    }
  }
  return (
    <Svg pointerEvents="none" width={cols * gap} height={rows * gap} style={style} accessible={false}>
      {dots}
    </Svg>
  );
}

// ── The stage and the crowd ────────────────────────────────────────────────

/** Deterministic, so the crowd is the same crowd on every render. */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const W = 220;
const H = 240;

function crowd(seed: number, { y, spacing, w, r, armChance }: { y: number; spacing: number; w: number; r: number; armChance: number }) {
  const rnd = seeded(seed);
  let bodies = '';
  let arms = '';
  let hands = '';
  for (let cx = 6 + rnd() * spacing; cx < W + 10; cx += spacing * (0.8 + rnd() * 0.4)) {
    const sy = y + (rnd() - 0.5) * 10;
    const ww = w * (0.85 + rnd() * 0.3);
    const rr = r * (0.9 + rnd() * 0.2);
    const hy = sy - rr - 1;
    bodies += `M${cx - ww} ${H}V${sy + 5}Q${cx - ww} ${sy} ${cx - ww + 5} ${sy}H${cx + ww - 5}Q${cx + ww} ${sy} ${cx + ww} ${sy + 5}V${H}Z`;
    bodies += `M${cx - rr} ${hy}a${rr} ${rr} 0 1 0 ${2 * rr} 0a${rr} ${rr} 0 1 0 ${-2 * rr} 0Z`;
    // Hands up, as people do at a show: one arm, both, or none.
    const roll = rnd();
    const sides = roll < armChance * 0.4 ? [-1, 1] : roll < armChance ? [rnd() < 0.5 ? -1 : 1] : [];
    for (const side of sides) {
      const x0 = cx + side * (ww - 2);
      const x1 = cx + side * (ww + 4 + rnd() * 6);
      const y1 = sy - 22 - rnd() * 12;
      arms += `M${x0} ${sy + 3}L${x1} ${y1}`;
      hands += `M${x1 - 2.6} ${y1}a2.6 2.6 0 1 0 5.2 0a2.6 2.6 0 1 0 -5.2 0Z`;
    }
  }
  return { bodies, arms, hands };
}

const BACK = crowd(11, { y: 196, spacing: 11, w: 5, r: 4, armChance: 0.45 });
const FRONT = crowd(29, { y: 214, spacing: 16, w: 8, r: 6, armChance: 0.55 });

/** The truss: two rails rising to the right, braced with a zigzag. */
const RAIL = { x0: 34, y0: 96, x1: W, y1: 36, gap: 9 };
function truss() {
  const slope = (RAIL.y1 - RAIL.y0) / (RAIL.x1 - RAIL.x0);
  const at = (x: number) => RAIL.y0 + (x - RAIL.x0) * slope;
  let d = `M${RAIL.x0} ${at(RAIL.x0)}L${RAIL.x1} ${RAIL.y1}M${RAIL.x0} ${at(RAIL.x0) + RAIL.gap}L${RAIL.x1} ${RAIL.y1 + RAIL.gap}`;
  for (let x = RAIL.x0, up = true; x < RAIL.x1; x += 8, up = !up) {
    d += `M${x} ${at(x) + (up ? 0 : RAIL.gap)}L${x + 8} ${at(x + 8) + (up ? RAIL.gap : 0)}`;
  }
  return { d, at };
}
const TRUSS = truss();
const LIGHTS = [74, 112, 150, 188].map((x) => ({ x, y: TRUSS.at(x) + RAIL.gap + 4 }));

/**
 * The mockup's concert photo, drawn: stage lights on a truss shining down into
 * a haze, and a crowd with hands up — light greys, fading out to the left so
 * the title in front of it stays easy to read.
 */
export function ConcertScene({ width }: { width: number }) {
  return (
    <Svg width={width} height={(width * H) / W} viewBox={`0 0 ${W} ${H}`} accessible={false}>
      <Defs>
        <RadialGradient id="haze" cx="150" cy="110" r="140" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor="#dcdce3" stopOpacity={0.85} />
          <Stop offset="1" stopColor="#f4f4f6" stopOpacity={0} />
        </RadialGradient>
        <LinearGradient id="beam" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={colors.white} stopOpacity={0.9} />
          <Stop offset="1" stopColor={colors.white} stopOpacity={0} />
        </LinearGradient>
        <LinearGradient id="people" x1="0" y1="0" x2={W} y2="0" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor="#b9b9c2" stopOpacity={0} />
          <Stop offset="0.45" stopColor="#b9b9c2" stopOpacity={0.5} />
          <Stop offset="1" stopColor="#a8a8b2" stopOpacity={0.85} />
        </LinearGradient>
        <LinearGradient id="peopleBack" x1="0" y1="0" x2={W} y2="0" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor="#cfcfd6" stopOpacity={0} />
          <Stop offset="0.5" stopColor="#cfcfd6" stopOpacity={0.6} />
          <Stop offset="1" stopColor="#c4c4cc" stopOpacity={0.9} />
        </LinearGradient>
        <LinearGradient id="rig" x1="0" y1="0" x2={W} y2="0" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor="#b4b4be" stopOpacity={0} />
          <Stop offset="0.35" stopColor="#b4b4be" stopOpacity={0.8} />
          <Stop offset="1" stopColor="#a6a6b0" stopOpacity={0.9} />
        </LinearGradient>
        {/* The foot of the scene melts into the page instead of ending in an edge. */}
        <LinearGradient id="melt" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0.68" stopColor={colors.bg} stopOpacity={0} />
          <Stop offset="0.94" stopColor={colors.bg} stopOpacity={1} />
        </LinearGradient>
      </Defs>

      <Path d={`M0 0H${W}V${H}H0Z`} fill="url(#haze)" />
      {LIGHTS.map(({ x, y }, i) => (
        <Path key={`b${x}`} d={`M${x - 2} ${y}L${x + 2} ${y}L${x + 30 - i * 6} ${H}L${x - 26 - i * 4} ${H}Z`} fill="url(#beam)" opacity={0.55} />
      ))}
      <Path d={TRUSS.d} fill="none" stroke="url(#rig)" strokeWidth={1.1} />
      {LIGHTS.map(({ x, y }) => (
        <Circle key={`h${x}`} cx={x} cy={y} r={8} fill={colors.white} opacity={0.6} />
      ))}
      {LIGHTS.map(({ x, y }) => (
        <Circle key={`l${x}`} cx={x} cy={y} r={2.8} fill={colors.white} />
      ))}

      <Path d={BACK.bodies + BACK.hands} fill="url(#peopleBack)" />
      <Path d={BACK.arms} fill="none" stroke="url(#peopleBack)" strokeWidth={2.6} strokeLinecap="round" />
      <Path d={FRONT.bodies + FRONT.hands} fill="url(#people)" />
      <Path d={FRONT.arms} fill="none" stroke="url(#people)" strokeWidth={3.6} strokeLinecap="round" />
      <Path d={`M0 0H${W}V${H}H0Z`} fill="url(#melt)" />
    </Svg>
  );
}

// ── The footer band ────────────────────────────────────────────────────────

/** The bottom of the screen: a blush ribbon, a gold hairline, a linen band. */
export function FooterBand({ width }: { width: number }) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width={width} height={width * 0.5} viewBox="0 0 400 200" accessible={false}>
        <Defs>
          <LinearGradient id="ribbon" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={BLUSH} stopOpacity={0.7} />
            <Stop offset="1" stopColor={BLUSH_PALE} stopOpacity={0.45} />
          </LinearGradient>
        </Defs>
        <Path d="M0 18C70 58 150 88 230 98 300 106 360 98 400 78V200H0Z" fill="url(#ribbon)" />
        <Path d="M0 30C70 66 150 94 230 103" fill="none" stroke={colors.white} strokeWidth={1.6} opacity={0.85} />
        <Path d="M0 118C90 108 180 93 260 73 320 58 370 50 400 48V200H0Z" fill={LINEN} />
        <Path d="M0 118C90 108 180 93 260 73 320 58 370 50 400 48" fill="none" stroke={GOLD} strokeWidth={1.6} />
      </Svg>
      <View style={[styles.linen, { top: width * 0.5 - 1 }]} />
      <Dots style={styles.dotsRight} cols={8} rows={4} from="topRight" />
    </View>
  );
}

/** The mockup's sparkle between two fine lines, over the footer links. */
export function SparkleRule() {
  return (
    <View style={styles.rule} accessible={false}>
      <View style={styles.ruleLine} />
      <Svg width={22} height={22} viewBox="0 0 24 24">
        <Path d="M12 1.5l2.4 7.1 7.1 2.4-7.1 2.4L12 20.5l-2.4-7.1L2.5 11l7.1-2.4z" fill={colors.highlight} />
      </Svg>
      <View style={styles.ruleLine} />
    </View>
  );
}

export const footerColors = { band: LINEN, gold: GOLD };

const styles = StyleSheet.create({
  dotsTopLeft: { position: 'absolute', top: 54, left: 10 },
  dotsRight: { position: 'absolute', top: 0, right: 14 },
  linen: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: LINEN },
  rule: { flexDirection: 'row', alignItems: 'center', gap: 12, alignSelf: 'stretch', paddingHorizontal: 40 },
  ruleLine: { flex: 1, height: 1, backgroundColor: GOLD, opacity: 0.6 },
});
