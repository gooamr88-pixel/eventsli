import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import { colors } from './theme';

/**
 * The quiet city along the bottom of the sign-in screen. Drawn here, not
 * traced from anywhere: blocks, a tower, a soft hill, in the teal tints.
 */
export function Skyline({ width = 400, height = 150 }: { width?: number; height?: number }) {
  return (
    <Svg width={width} height={height} viewBox="0 0 400 150" preserveAspectRatio="xMidYMax slice" accessible={false}>
      <Defs>
        <LinearGradient id="hill" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={colors.teal100} />
          <Stop offset="1" stopColor={colors.teal50} />
        </LinearGradient>
      </Defs>
      {/* Far blocks */}
      <Path
        fill={colors.teal100}
        d="M0 150V112h18V98h14v14h10V90h16v22h12V104h10V84h18v28h14V96h12v16h16V78h20v34h12V92h14v20h18V100h12V86h16v26h14V98h12v14h16V88h18v24h14V102h12v10h18V94h14v18h12V150Z"
      />
      {/* The tower */}
      <Rect x="196" y="28" width="4" height="90" fill={colors.teal300} />
      <Path fill={colors.teal300} d="M190 70h16l-3 8h-10Z" />
      <Rect x="197" y="10" width="2" height="20" fill={colors.teal300} />
      {/* Near blocks */}
      <Path
        fill={colors.teal200}
        d="M0 150V126h22V114h12v12h14V108h18v18h10V120h16v6h12V112h14v14h20V118h14v8h16V106h12v20h14V116h16v10h12V110h18v16h14V120h12v6h16V112h14v14h12V118h18v8h12V150Z"
      />
      <Path fill="url(#hill)" d="M0 150V138c60-14 120-16 200-8s140 6 200-6V150Z" />
    </Svg>
  );
}
