import Svg, { Path } from 'react-native-svg';

import { ICON_PATHS } from './iconPaths';
import { colors } from './theme';

/**
 * The website's stroke icons (iconPaths.ts is the check-in app's copy of the
 * site's set), plus the few this app needs that neither had.
 */
const APP_PATHS = {
  back: ['M19.5 12h-14', 'M11 6.5 5.5 12l5.5 5.5'],
  more: ['M5 12a1 1 0 1 0 2 0 1 1 0 1 0-2 0', 'M11 12a1 1 0 1 0 2 0 1 1 0 1 0-2 0', 'M17 12a1 1 0 1 0 2 0 1 1 0 1 0-2 0'],
  minus: ['M5 12h14'],
  eyeOff: ['M3 3l18 18', 'M10.6 5.1A9.9 9.9 0 0 1 12 5c5 0 9 4.5 10 7a12.5 12.5 0 0 1-2.4 3.5', 'M6.6 6.6C4.4 8 2.9 10.1 2 12c1 2.5 5 7 10 7 1.8 0 3.4-.6 4.8-1.4', 'M9.9 9.9a3 3 0 0 0 4.2 4.2'],
  compass: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M15.5 8.5l-2 5-5 2 2-5 5-2z'],
  seat: ['M7 11V5.5A1.5 1.5 0 0 1 8.5 4h7A1.5 1.5 0 0 1 17 5.5V11', 'M5 11h14v4H5z', 'M7 15v5', 'M17 15v5'],
  signOut: ['M15 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-2', 'M10 12h11', 'M18 9l3 3-3 3'],
  palette: ['M12 21a9 9 0 1 1 9-9c0 2-1.5 3-3.5 3H16a2 2 0 0 0-1.5 3.3A1.6 1.6 0 0 1 12 21z', 'M7.5 11.5h.01', 'M10.5 7.5h.01', 'M15 8h.01'],
} as const;

const PATHS = { ...ICON_PATHS, ...APP_PATHS };
export type IconName = keyof typeof PATHS;

type Props = {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
  /** Fills the shape too — the saved heart, the rating star. */
  fill?: string;
};

/** Decorative: every icon sits beside a label, or its button carries one. */
export function Icon({ name, size = 22, color = colors.text, strokeWidth = 1.8, fill }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
      {PATHS[name].map((d) => (
        <Path
          key={d}
          d={d}
          fill={fill ?? 'none'}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </Svg>
  );
}
