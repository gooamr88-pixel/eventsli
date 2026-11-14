import Svg, { Path } from 'react-native-svg';

import { ICON_PATHS } from './iconPaths';
import { colors } from './theme';

/** Glyphs the door app needs that the website's shell never did. Same 24 x 24 stroke style. */
const APP_PATHS = {
  back: ['M19.5 12h-14', 'M11 6.5 5.5 12l5.5 5.5'],
  bolt: ['M13 2.5 5 13.5h6.5L11 21.5l8-11h-6.5L13 2.5z'],
  offline: ['M3 3l18 18', 'M8.6 16.2a5 5 0 0 1 6.8 0', 'M12 19.5h.01', 'M5.2 12.4a10 10 0 0 1 4.3-2.3', 'M18.8 12.4a10 10 0 0 0-2-1.4', 'M2 8.8a15 15 0 0 1 3.4-2.1', 'M22 8.8a15 15 0 0 0-8.6-3.7'],
  keypad: ['M6 5h.01', 'M12 5h.01', 'M18 5h.01', 'M6 11h.01', 'M12 11h.01', 'M18 11h.01', 'M6 17h.01', 'M12 17h.01', 'M18 17h.01'],
  // The redesign (mobile/README: the screens follow the owner's mockup).
  eyeOff: ['M3 3l18 18', 'M10.6 5.1A9.9 9.9 0 0 1 12 5c5 0 9 4.5 10 7a12.5 12.5 0 0 1-2.4 3.5', 'M6.6 6.6C4.4 8 2.9 10.1 2 12c1 2.5 5 7 10 7 1.8 0 3.4-.6 4.8-1.4', 'M9.9 9.9a3 3 0 0 0 4.2 4.2'],
  cameraFlip: ['M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z', 'M9.3 14a3 3 0 0 0 5.3 1', 'M14.7 12a3 3 0 0 0-5.3-1', 'M14.9 16.4V15h-1.4', 'M9.1 9.6V11h1.4'],
  history: ['M3.5 12a8.5 8.5 0 1 0 2.5-6', 'M3 3.5v4h4', 'M12 7.5V12l3 2'],
  cloudUpload: ['M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 8.5a4 4 0 0 1-.5 9.5', 'M12 12v8', 'M9 15l3-3 3 3'],
  seat: ['M7 11V5.5A1.5 1.5 0 0 1 8.5 4h7A1.5 1.5 0 0 1 17 5.5V11', 'M5 11h14v4H5z', 'M7 15v5', 'M17 15v5'],
  more: ['M5 12a1 1 0 1 0 2 0 1 1 0 1 0-2 0', 'M11 12a1 1 0 1 0 2 0 1 1 0 1 0-2 0', 'M17 12a1 1 0 1 0 2 0 1 1 0 1 0-2 0'],
  logs: ['M8 4h8', 'M9 3h6v3H9z', 'M6 5h12v16H6z', 'M9 11h6', 'M9 15h4'],
} as const;

const PATHS = { ...ICON_PATHS, ...APP_PATHS };
export type IconName = keyof typeof PATHS;

type Props = { name: IconName; size?: number; color?: string; strokeWidth?: number };

/** The site's stroke icons. Decorative: every icon sits beside a text label. */
export function Icon({ name, size = 22, color = colors.text, strokeWidth = 1.8 }: Props) {
  const wide = name === 'keypad' ? 3 : strokeWidth;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
      {PATHS[name].map((d) => (
        <Path
          key={d}
          d={d}
          fill="none"
          stroke={color}
          strokeWidth={wide}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </Svg>
  );
}
