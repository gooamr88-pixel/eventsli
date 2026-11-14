import { StyleSheet, View, useWindowDimensions } from 'react-native';

import { ScannerMark, SkylineScene } from './ScannerMark';
import { Text } from './Text';
import { colors, space } from './theme';

/**
 * The opening screen from the mockup, shown while the app reads its fonts and
 * its stored sign-in: the mark, "Eventsli Scanner", the tagline and the city.
 */
export function Splash() {
  const { width, height } = useWindowDimensions();
  return (
    <View style={styles.screen} accessible accessibilityLabel="Eventsli Scanner. Event check-in made simple.">
      <View style={styles.brand}>
        <ScannerMark size={78} />
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
  word: { fontFamily: 'DMSans_700Bold', fontSize: 46, lineHeight: 54, marginTop: space.lg },
  scanner: { fontSize: 24, lineHeight: 28, marginTop: -2 },
  tagline: { marginTop: space.xl, fontSize: 17, lineHeight: 24 },
  scene: { position: 'absolute', left: 0, right: 0, bottom: 0 },
});
