import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { MARK_FRAME, MARK_STAR, MARK_VIEWBOX } from './brand/markPath';
import { WORDMARK_EVENTS, WORDMARK_LI, WORDMARK_VIEWBOX } from './brand/wordmarkPath';
import { Text } from './Text';
import { colors } from './theme';

const [, , WW, WH] = WORDMARK_VIEWBOX.split(' ').map(Number);

/** The framed star on its own. */
export function Mark({ size = 32, color = colors.accent }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={(size * 500) / 512} viewBox={MARK_VIEWBOX} accessible={false}>
      <Path fillRule="evenodd" d={MARK_FRAME} fill={color} />
      <Path d={MARK_STAR} fill={color} />
    </Svg>
  );
}

type Props = { height?: number; tagline?: boolean; inverse?: boolean };

/**
 * The lockup: mark, two-colour wordmark ("Events" ink, "li" teal), and the
 * tagline under it — the same vectors the website draws.
 */
export function Logo({ height = 36, tagline = false, inverse = false }: Props) {
  const ink = inverse ? colors.white : colors.text;
  const li = inverse ? colors.white : colors.accent;
  const mark = inverse ? colors.white : colors.accent;
  const wordWidth = (height * WW) / WH;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel="Eventsli" style={{ alignItems: 'center' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: height * 0.28 }}>
        <Mark size={height * 1.05} color={mark} />
        <Svg width={wordWidth} height={height} viewBox={WORDMARK_VIEWBOX}>
          <Path fillRule="evenodd" d={WORDMARK_EVENTS} fill={ink} />
          <Path fillRule="evenodd" d={WORDMARK_LI} fill={li} />
        </Svg>
      </View>
      {tagline && (
        <Text
          style={{
            marginTop: height * 0.18,
            fontSize: Math.max(10, height * 0.3),
            letterSpacing: height * 0.06,
            color: ink,
          }}
          weight="medium"
        >
          DISCOVER - BOOK - ENJOY
        </Text>
      )}
    </View>
  );
}
