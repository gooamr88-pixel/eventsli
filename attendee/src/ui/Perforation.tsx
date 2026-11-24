import { StyleSheet, View } from 'react-native';

import { colors } from './theme';

/**
 * The tear line of a paper ticket: a notch bitten out of each edge and a
 * dashed rule between them. `ground` is the colour behind the card, so the
 * notches read as holes. Decorative.
 */
export function Perforation({ ground = colors.bg, size = 22 }: { ground?: string; size?: number }) {
  return (
    <View style={[styles.row, { height: size }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[styles.notch, { width: size, height: size, borderRadius: size / 2, backgroundColor: ground, marginLeft: -size / 2 }]} />
      <View style={styles.dash} />
      <View style={[styles.notch, { width: size, height: size, borderRadius: size / 2, backgroundColor: ground, marginRight: -size / 2 }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  notch: {},
  dash: { flex: 1, height: 0, borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: colors.border, marginHorizontal: 6 },
});
