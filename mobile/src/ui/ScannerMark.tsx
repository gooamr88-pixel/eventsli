import { View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop, SvgXml } from 'react-native-svg';

import { MARK_FRAME, MARK_INITIAL, WORDMARK_EVENTS, WORDMARK_LI, WORDMARK_SPARK, WORDMARK_VIEWBOX } from './brandPaths';
import { colors } from './theme';

/**
 * THE APP'S MARK (2026-11-15): the brand's yellow E ticket inside four yellow
 * scanner brackets, on the near-black — the website's door-scanner icon, so
 * on a home screen the app is Eventsli AND the thing that scans. It replaced
 * an empty yellow frame drawn before the logo became the E ticket.
 *
 * One drawing for every use: the sign-in lockup, the opening screen, and the
 * native icons and splash (scripts/app-icons.js and splash-icon.js render the
 * same markup through scripts/brand-mark.js; test/brand.test.ts holds the two
 * equal). In a 512 box; the options are brand-mark.js's.
 */
type MarkOptions = {
  tile?: string | null; radius?: number; brackets?: string; ticket?: string; initial?: string;
  scale?: number; solid?: boolean;
};

/** The ticket card's own box inside the mark's viewBox (it shares its height with the word). */
const CARD = { cx: 59.5, cy: -39.5, w: 119 };

export function scannerMarkSvg({
  tile = '#111018', radius = 112, brackets = '#ffcc00', ticket = '#ffcc00', initial = '#111018',
  scale = 1, solid = false,
}: MarkOptions = {}): string {
  const k = (v: number) => +(v * scale + (1 - scale) * 256).toFixed(2);
  const q = +(28 * scale).toFixed(2);
  const corner = (d: string) => `<path d="${d}" fill="none" stroke="${brackets}" stroke-width="${+(26 * scale).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const marks = [
    `M${k(112)} ${k(196)}V${k(140)}a${q} ${q} 0 0 1 ${q} -${q}H${k(196)}`,
    `M${k(316)} ${k(112)}H${k(372)}a${q} ${q} 0 0 1 ${q} ${q}V${k(196)}`,
    `M${k(400)} ${k(316)}V${k(372)}a${q} ${q} 0 0 1 -${q} ${q}H${k(316)}`,
    `M${k(196)} ${k(400)}H${k(140)}a${q} ${q} 0 0 1 -${q} -${q}V${k(316)}`,
  ].map(corner).join('');
  const s = +((176 * scale) / CARD.w).toFixed(4);
  const card = solid
    ? `<path d="${MARK_FRAME}${MARK_INITIAL}" fill="${ticket}" fill-rule="evenodd"/>`
    : `<path d="${MARK_FRAME}" fill="${ticket}"/><path d="${MARK_INITIAL}" fill="${initial}"/>`;
  const back = tile ? `<rect width="512" height="512" rx="${radius}" fill="${tile}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${back}${marks}`
    + `<g transform="translate(256 256) scale(${s}) translate(${-CARD.cx} ${-CARD.cy})">${card}</g></svg>`;
}

export function ScannerMark({ size = 48, color = colors.night }: { size?: number; color?: string }) {
  return (
    <View accessible={false} style={{ width: size, height: size }}>
      <SvgXml xml={scannerMarkSvg({ tile: color })} width={size} height={size} />
    </View>
  );
}

/**
 * "[mark] eventsli" — the small lockup at the top of sign-in: the mark, then
 * the website's own wordmark (Urbanist, lowercase, the yellow spark over the
 * i), drawn from the same paths rather than typed.
 */
export function ScannerLockup({ size = 28 }: { size?: number }) {
  const [, , w, h] = WORDMARK_VIEWBOX.split(' ').map(Number);
  const wordH = size * 0.78;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel="Eventsli" style={{ flexDirection: 'row', alignItems: 'center', gap: size * 0.3 }}>
      <ScannerMark size={size} />
      <Svg width={(wordH * w) / h} height={wordH} viewBox={WORDMARK_VIEWBOX} accessible={false}>
        <Path d={WORDMARK_EVENTS} fill={colors.text} />
        <Path d={WORDMARK_LI} fill={colors.text} />
        <Path d={WORDMARK_SPARK} fill={colors.highlight} />
      </Svg>
    </View>
  );
}

/**
 * The city at dusk across the bottom of the opening screen: a sunset sky in a
 * wave, the skyline with its tower, the water, and the pale coral waves over it.
 * Drawn here; not traced from anything.
 */
export function SkylineScene({ width, height }: { width: number; height: number }) {
  return (
    <Svg width={width} height={height} viewBox="0 0 400 380" preserveAspectRatio="xMidYMax slice" accessible={false}>
      <Defs>
        <LinearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#fff3c4" />
          <Stop offset="0.55" stopColor="#ffd9c2" />
          <Stop offset="1" stopColor="#f1c6ad" />
        </LinearGradient>
        <LinearGradient id="water" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#3a2f4a" />
          <Stop offset="1" stopColor="#111018" />
        </LinearGradient>
        <LinearGradient id="wave" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#ffc2c6" />
          <Stop offset="1" stopColor="#fff1f2" />
        </LinearGradient>
      </Defs>
      {/* The sky, inside the big wave */}
      <Path d="M0 120C80 60 170 70 240 110c60 34 110 30 160 0v270H0z" fill="url(#sky)" />
      {/* The skyline */}
      <Path
        fill="#2a2438"
        d="M0 300V262h14v-14h10v-20h12v20h8v-34h14v34h10v-12h12v-26h16v38h8v-18h10v-30h18v30h8v14h10V218h14v-22h6v22h12v34h10v-40h14v40h8v-26h12v-18h12v18h10v40h10v-30h16v30h6v-22h14v22h10v-48h12v48h8v-16h14v16h10v-28h14v28h8v-12h12v12h10v-26h14v26h12v38z"
      />
      {/* The tower */}
      <Path fill="#2a2438" d="M196 262V150h4v112z" />
      <Path fill="#2a2438" d="M190 190h16l-3 10h-10z" />
      <Path fill="#2a2438" d="M194 204h8l-1 6h-6z" />
      <Path fill="#2a2438" d="M197.2 130h1.6v20h-1.6z" />
      {/* Lit windows */}
      <Path fill="#f6c27a" opacity={0.75} d="M30 250h3v3h-3zM58 236h3v3h-3zM96 244h3v3h-3zM134 232h3v3h-3zM232 238h3v3h-3zM268 250h3v3h-3zM306 236h3v3h-3zM350 254h3v3h-3z" />
      {/* The water */}
      <Path d="M0 300h400v80H0z" fill="url(#water)" />
      <Path fill="#f1c6ad" opacity={0.35} d="M150 312h100v2H150zM120 326h160v2H120zM170 340h60v2h-60z" />
      {/* The pale coral waves over everything */}
      <Path d="M0 150C60 110 120 112 180 140s110 26 150 6c30-14 50-20 70-20V96c-40 4-70 22-110 36-50 18-110 6-160-20C90 92 40 96 0 120z" fill="url(#wave)" opacity={0.9} />
      <Path d="M0 120c50-28 100-30 150-10 40 16 80 18 120 4 50-18 90-40 130-40V0H0z" fill="#ffffff" />
    </Svg>
  );
}
