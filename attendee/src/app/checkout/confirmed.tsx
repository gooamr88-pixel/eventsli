import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Rect } from 'react-native-svg';

import { useToken } from '@/auth/session';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Text } from '@/ui/Text';
import { colors, space } from '@/ui/theme';

/** The mockup's confetti, in the brand's three colours. Decorative. */
const CONFETTI = [
  [40, 30, colors.coral500, 20], [300, 50, colors.highlight, -15], [80, 140, colors.highlight, 40],
  [270, 150, colors.coral500, 60], [160, 20, '#22a35a', 10], [330, 110, '#22a35a', -30], [20, 90, colors.night, 30],
] as const;

/**
 * Booking Confirmed. Reached only after the API said the order exists — never
 * on the strength of the browser closing. Signed in, the tickets are in My
 * Tickets now; as a guest, they are in the email the order was placed with.
 */
export default function Confirmed() {
  const insets = useSafeAreaInsets();
  const token = useToken();
  const qc = useQueryClient();

  useEffect(() => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    void qc.invalidateQueries({ queryKey: ['tickets'] });
    void qc.invalidateQueries({ queryKey: ['notifications'] });
  }, [qc]);

  return (
    <View style={[styles.root, { paddingTop: insets.top + space.xxl, paddingBottom: insets.bottom + space.xl }]}>
      <View style={styles.art} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Svg width={360} height={200} viewBox="0 0 360 200" style={StyleSheet.absoluteFill}>
          {CONFETTI.map(([x, y, c, r]) => (
            <Rect key={`${x}-${y}`} x={x} y={y} width={12} height={5} rx={2} fill={c} transform={`rotate(${r} ${x} ${y})`} />
          ))}
        </Svg>
        <View style={styles.tick}><Icon name="tick" size={56} color={colors.white} strokeWidth={2.6} /></View>
      </View>
      <View style={styles.words}>
        <Text variant="display" align="center" accessibilityRole="header">Booking Confirmed!</Text>
        <Text variant="body" color={colors.muted} align="center">
          {token ? 'Your tickets are ready. Enjoy the event!' : 'Your tickets are on their way to your email. Enjoy the event!'}
        </Text>
      </View>
      <View style={styles.actions}>
        {token ? <Button label="View My Tickets" onPress={() => router.replace('/(tabs)/tickets')} /> : null}
        <Button label="Back to Home" variant="secondary" onPress={() => router.replace('/(tabs)')} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface, paddingHorizontal: space.xl },
  art: { height: 200, alignItems: 'center', justifyContent: 'center' },
  tick: { width: 110, height: 110, borderRadius: 55, backgroundColor: colors.successStrong, alignItems: 'center', justifyContent: 'center' },
  words: { gap: space.md, marginTop: space.xl },
  actions: { flex: 1, justifyContent: 'flex-end', gap: space.md },
});
