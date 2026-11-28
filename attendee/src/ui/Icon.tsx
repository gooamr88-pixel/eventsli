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
  sliders: ['M4 7h9', 'M17 7h3', 'M15 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', 'M4 17h3', 'M11 17h9', 'M9 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z'],
  seat: ['M7 11V5.5A1.5 1.5 0 0 1 8.5 4h7A1.5 1.5 0 0 1 17 5.5V11', 'M5 11h14v4H5z', 'M7 15v5', 'M17 15v5'],
  signOut: ['M15 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-2', 'M10 12h11', 'M18 9l3 3-3 3'],
  palette: ['M12 21a9 9 0 1 1 9-9c0 2-1.5 3-3.5 3H16a2 2 0 0 0-1.5 3.3A1.6 1.6 0 0 1 12 21z', 'M7.5 11.5h.01', 'M10.5 7.5h.01', 'M15 8h.01'],
  // The event categories' own pictures (ui/categoryLook.ts), for tiles with no photo.
  music: ['M9 18V5l12-2v13', 'M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M18 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
  mic: ['M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z', 'M19 10v2a7 7 0 0 1-14 0v-2', 'M12 19v3'],
  glass: ['M8 22h8', 'M12 11v11', 'M5 3h14l-7 8z'],
  ball: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M2 12h20', 'M12 2a15 15 0 0 1 0 20', 'M12 2a15 15 0 0 0 0 20'],
  film: ['M3 4h18v16H3z', 'M7 4v16', 'M17 4v16', 'M3 9h4', 'M3 15h4', 'M17 9h4', 'M17 15h4'],
  leaf: ['M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z', 'M2 21c0-3 1.85-5.36 5.08-6'],
  food: ['M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2', 'M7 2v20', 'M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7'],
  gift: ['M20 12v10H4V12', 'M2 7h20v5H2z', 'M12 22V7', 'M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z', 'M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z'],
  shirt: ['M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z'],
  smile: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M8 14s1.5 2 4 2 4-2 4-2', 'M9 9h.01', 'M15 9h.01'],
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
