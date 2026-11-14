import { View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import { Text } from './Text';
import { colors } from './theme';

/**
 * The scanner's mark from the owner's mockup: a teal rounded square around a
 * white rounded-square frame. The same drawing is exported to the native
 * splash image (assets/images/splash-icon.png, scripts/splash-icon.js).
 */
export const SCANNER_MARK_SVG = (fill: string) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect x="0" y="0" width="100" height="100" rx="24" fill="${fill}"/>
  <rect x="27" y="27" width="46" height="46" rx="11" fill="none" stroke="#ffffff" stroke-width="10"/>
</svg>`;

export function ScannerMark({ size = 48, color = colors.accent }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" accessible={false}>
      <Rect x={0} y={0} width={100} height={100} rx={24} fill={color} />
      <Rect x={27} y={27} width={46} height={46} rx={11} fill="none" stroke={colors.white} strokeWidth={10} />
    </Svg>
  );
}

/** "[mark] Eventsli" — the small lockup at the top of sign-in. */
export function ScannerLockup({ size = 28 }: { size?: number }) {
  return (
    <View accessible accessibilityRole="image" accessibilityLabel="Eventsli" style={{ flexDirection: 'row', alignItems: 'center', gap: size * 0.32 }}>
      <ScannerMark size={size} />
      <Text variant="title" weight="bold" style={{ fontSize: size * 0.82, lineHeight: size * 1.05 }}>Eventsli</Text>
    </View>
  );
}

/**
 * The city at dusk across the bottom of the opening screen: a sunset sky in a
 * wave, the skyline with its tower, the water, and the mint waves over it.
 * Drawn here; not traced from anything.
 */
export function SkylineScene({ width, height }: { width: number; height: number }) {
  return (
    <Svg width={width} height={height} viewBox="0 0 400 380" preserveAspectRatio="xMidYMax slice" accessible={false}>
      <Defs>
        <LinearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#dff1ef" />
          <Stop offset="0.55" stopColor="#f7dccb" />
          <Stop offset="1" stopColor="#f1c6ad" />
        </LinearGradient>
        <LinearGradient id="water" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#2c6b6e" />
          <Stop offset="1" stopColor="#0b3d40" />
        </LinearGradient>
        <LinearGradient id="wave" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#b3d8d9" />
          <Stop offset="1" stopColor="#dff1ef" />
        </LinearGradient>
      </Defs>
      {/* The sky, inside the big wave */}
      <Path d="M0 120C80 60 170 70 240 110c60 34 110 30 160 0v270H0z" fill="url(#sky)" />
      {/* The skyline */}
      <Path
        fill="#24575b"
        d="M0 300V262h14v-14h10v-20h12v20h8v-34h14v34h10v-12h12v-26h16v38h8v-18h10v-30h18v30h8v14h10V218h14v-22h6v22h12v34h10v-40h14v40h8v-26h12v-18h12v18h10v40h10v-30h16v30h6v-22h14v22h10v-48h12v48h8v-16h14v16h10v-28h14v28h8v-12h12v12h10v-26h14v26h12v38z"
      />
      {/* The tower */}
      <Path fill="#24575b" d="M196 262V150h4v112z" />
      <Path fill="#24575b" d="M190 190h16l-3 10h-10z" />
      <Path fill="#24575b" d="M194 204h8l-1 6h-6z" />
      <Path fill="#24575b" d="M197.2 130h1.6v20h-1.6z" />
      {/* Lit windows */}
      <Path fill="#f6c27a" opacity={0.75} d="M30 250h3v3h-3zM58 236h3v3h-3zM96 244h3v3h-3zM134 232h3v3h-3zM232 238h3v3h-3zM268 250h3v3h-3zM306 236h3v3h-3zM350 254h3v3h-3z" />
      {/* The water */}
      <Path d="M0 300h400v80H0z" fill="url(#water)" />
      <Path fill="#f1c6ad" opacity={0.35} d="M150 312h100v2H150zM120 326h160v2H120zM170 340h60v2h-60z" />
      {/* The mint waves over everything */}
      <Path d="M0 150C60 110 120 112 180 140s110 26 150 6c30-14 50-20 70-20V96c-40 4-70 22-110 36-50 18-110 6-160-20C90 92 40 96 0 120z" fill="url(#wave)" opacity={0.9} />
      <Path d="M0 120c50-28 100-30 150-10 40 16 80 18 120 4 50-18 90-40 130-40V0H0z" fill="#ffffff" />
    </Svg>
  );
}
