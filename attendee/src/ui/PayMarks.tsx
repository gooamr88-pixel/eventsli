import { StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { Text } from './Text';
import { colors, fonts, radius } from './theme';

/**
 * The mockup's row of ways to pay — Visa, Mastercard, Apple Pay, Google Pay —
 * as small neutral tiles. They name what Stripe's page will accept; the app
 * itself never sees a card number.
 */
export function PayMarks() {
  return (
    <View style={styles.row} accessible accessibilityLabel="Visa, Mastercard, Apple Pay and Google Pay accepted">
      <View style={styles.tile}><Text style={[styles.word, styles.visa]}>VISA</Text></View>
      <View style={styles.tile}>
        <Svg width={30} height={18} viewBox="0 0 30 18">
          <Circle cx={11} cy={9} r={8} fill="#eb001b" />
          <Circle cx={19} cy={9} r={8} fill="#f79e1b" fillOpacity={0.9} />
        </Svg>
      </View>
      <View style={styles.tile}><Text style={styles.word}>Apple Pay</Text></View>
      <View style={styles.tile}><Text style={styles.word}>Google Pay</Text></View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { height: 34, minWidth: 54, paddingHorizontal: 10, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  word: { fontFamily: fonts.bold, fontSize: 12, color: colors.text },
  visa: { fontStyle: 'italic', fontSize: 14, color: '#1a1f71', letterSpacing: 0.5 },
});
