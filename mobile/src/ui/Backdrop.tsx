import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useLayout } from './responsive';
import { colors } from './theme';

/**
 * The soft coral and yellow waves in the mockup's corners: top right on every light
 * screen, and bottom left on the full-screen answers. Drawn behind
 * everything and never touched. Half as big again on an iPad, where the
 * phone-sized corners would look like a smudge.
 */
export function Backdrop({ bottom = false }: { bottom?: boolean }) {
  const k = useLayout().compact ? 1 : 1.5;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width={230 * k} height={190 * k} viewBox="0 0 230 190" style={styles.topRight} accessible={false}>
        <Path d="M230 0H92c8 38 40 58 78 70 38 12 52 46 60 92z" fill={colors.wash} opacity={0.75} />
        <Path d="M230 0h-66c6 26 26 40 46 48 12 5 18 14 20 26z" fill={colors.sun100} opacity={0.7} />
      </Svg>
      {bottom && (
        <Svg width={260 * k} height={170 * k} viewBox="0 0 260 170" style={styles.bottomLeft} accessible={false}>
          <Path d="M0 170h200c-14-30-48-46-90-54C64 108 22 86 0 40z" fill={colors.wash} opacity={0.7} />
          <Path d="M0 170h96c-10-18-30-28-54-34C24 132 8 120 0 100z" fill={colors.sun100} opacity={0.6} />
        </Svg>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  topRight: { position: 'absolute', top: 0, right: 0 },
  bottomLeft: { position: 'absolute', bottom: 0, left: 0 },
});
