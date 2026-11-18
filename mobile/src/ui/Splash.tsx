import { StyleSheet, View, useWindowDimensions } from 'react-native';

import { BREAKPOINT } from './responsive';
import { ScannerMark, SkylineScene } from './ScannerMark';
import { Text } from './Text';
import { colors, space } from './theme';

/**
 * The opening screen from the mockup, shown while the app reads its fonts and
 * its stored sign-in: the mark, "Eventsli Scanner", the tagline and the city.
 */
export function Splash() {
  const { width, height } = useWindowDimensions();
  // The brand is lifted clear of the skyline. A phone keeps the mockup's 42 %
  // (of the width, which is how React Native reads a percentage padding); an
  // iPad, often sideways, measures from the height so the brand stays above
  // the city in landscape too.
  const tablet = width >= BREAKPOINT.regular;
  return (
    <View style={styles.screen} accessible accessibilityLabel="Eventsli Scanner. Event check-in made simple.">
      <View style={[styles.brand, tablet && { paddingBottom: height * 0.42 }]}>
        <ScannerMark size={tablet ? 96 : 78} />
        <Text style={styles.word} color={colors.text}>Eventsli</Text>
        <Text variant="title" weight="medium" color={colors.muted} style={styles.scanner}>Scanner</Text>
        <Text variant="body" color={colors.muted} align="center" style={styles.tagline}>{'Event Check-in\nMade Simple'}</Text>
      </View>
      <View pointerEvents="none" style={styles.scene}>
        <SkylineScene width={width} height={height * 0.46} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  brand: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: '42%' },
  word: { fontFamily: 'Urbanist_900Black', fontSize: 46, lineHeight: 54, marginTop: space.lg },
  scanner: { fontSize: 24, lineHeight: 28, marginTop: -2 },
  tagline: { marginTop: space.xl, fontSize: 17, lineHeight: 24 },
  scene: { position: 'absolute', left: 0, right: 0, bottom: 0 },
});
