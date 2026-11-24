import { Platform, StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { Text } from './Text';
import { colors, fonts } from './theme';

/**
 * The mockup's Payment Method row — VISA, Mastercard, and the phone's own
 * wallet — as soft grey tiles. They name what Stripe's page accepts; the app
 * never sees a card number.
 */
export function PayMarks() {
  const wallet = Platform.OS === 'ios' ? 'Apple Pay' : 'Google Pay';
  return (
    <View style={styles.row} accessible accessibilityLabel={`Visa, Mastercard and ${wallet} accepted`}>
      <View style={styles.tile}><Text style={styles.visa}>VISA</Text></View>
      <View style={styles.tile}>
        <Svg width={34} height={22} viewBox="0 0 34 22">
          <Circle cx={13} cy={11} r={9} fill="#eb001b" />
          <Circle cx={21} cy={11} r={9} fill="#f79e1b" fillOpacity={0.9} />
        </Svg>
      </View>
      <View style={styles.tile}><Text style={styles.word}>{wallet}</Text></View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12 },
  tile: { flex: 1, height: 50, borderRadius: 12, backgroundColor: colors.bgSunken, alignItems: 'center', justifyContent: 'center' },
  word: { fontFamily: fonts.bold, fontSize: 14, color: colors.text },
  visa: { fontFamily: fonts.bold, fontStyle: 'italic', fontSize: 18, color: '#1a1f71', letterSpacing: 0.5 },
});
