import Svg, { Path } from 'react-native-svg';

import { ICON_PATHS } from './iconPaths';
import { colors } from './theme';

/** Glyphs the door app needs that the website's shell never did. Same 24 x 24 stroke style. */
const APP_PATHS = {
  back: ['M19.5 12h-14', 'M11 6.5 5.5 12l5.5 5.5'],
  bolt: ['M13 2.5 5 13.5h6.5L11 21.5l8-11h-6.5L13 2.5z'],
  offline: ['M3 3l18 18', 'M8.6 16.2a5 5 0 0 1 6.8 0', 'M12 19.5h.01', 'M5.2 12.4a10 10 0 0 1 4.3-2.3', 'M18.8 12.4a10 10 0 0 0-2-1.4', 'M2 8.8a15 15 0 0 1 3.4-2.1', 'M22 8.8a15 15 0 0 0-8.6-3.7'],
  keypad: ['M6 5h.01', 'M12 5h.01', 'M18 5h.01', 'M6 11h.01', 'M12 11h.01', 'M18 11h.01', 'M6 17h.01', 'M12 17h.01', 'M18 17h.01'],
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
