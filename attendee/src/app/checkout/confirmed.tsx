import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Rect } from 'react-native-svg';

import { useToken } from '@/auth/session';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { haptic } from '@/ui/motion';
import { Text } from '@/ui/Text';
import { colors, radius, space } from '@/ui/theme';

/** The mockup's confetti, in the brand's colours. Decorative. */
const CONFETTI = [
  [40, 30, colors.coral500, 20], [300, 50, colors.highlight, -15], [80, 140, colors.highlight, 40],
  [270, 150, colors.coral500, 60], [160, 20, '#22a35a', 10], [330, 110, '#22a35a', -30], [20, 90, colors.night, 30],
  [210, 170, colors.night, -50], [120, 60, colors.coral300, 75], [250, 15, colors.sun300, -60],
] as const;

/**
 * Booking Confirmed. Reached only after the API said the order exists — never
 * on the strength of the browser closing. Signed in, the tickets are in My
 * Tickets now (and open straight to this order); as a guest, they are in the
 * email the order was placed with.
 */
export default function Confirmed() {
  const insets = useSafeAreaInsets();
  const token = useToken();
  const qc = useQueryClient();
  const { orderId } = useLocalSearchParams<{ orderId?: string }>();

  useEffect(() => {
    haptic.success();
    void qc.invalidateQueries({ queryKey: ['tickets'] });
    void qc.invalidateQueries({ queryKey: ['notifications'] });
  }, [qc]);

  return (
    <View style={[styles.root, { paddingTop: insets.top + space.xxl, paddingBottom: insets.bottom + space.xl }]}>
      <View style={styles.art} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Animated.View entering={FadeInDown.delay(150).duration(500)} style={StyleSheet.absoluteFill}>
          <Svg width="100%" height={200} viewBox="0 0 360 200">
            {CONFETTI.map(([x, y, c, r]) => (
              <Rect key={`${x}-${y}`} x={x} y={y} width={12} height={5} rx={2} fill={c} transform={`rotate(${r} ${x} ${y})`} />
            ))}
          </Svg>
        </Animated.View>
        <Animated.View entering={ZoomIn.springify().damping(12)}>
          <View style={styles.tick}><Icon name="tick" size={54} color={colors.white} strokeWidth={2.8} /></View>
        </Animated.View>
      </View>
      <Animated.View entering={FadeInDown.delay(200).duration(360)} style={styles.words}>
        <Text variant="display" align="center" accessibilityRole="header">Booking Confirmed!</Text>
        <Text variant="title" weight="medium" align="center" style={{ lineHeight: 26 }}>
          {token ? 'Your tickets are ready.\nEnjoy the event!' : 'Your tickets are on their way\nto your email. Enjoy the event!'}
        </Text>
      </Animated.View>
      <Animated.View entering={FadeInDown.delay(320).duration(360)} style={styles.actions}>
        {token ? (
          <Button
            label="View My Tickets"
            onPress={() => {
              router.replace('/(tabs)/tickets');
              if (orderId) router.push({ pathname: '/ticket/[orderId]', params: { orderId } });
            }}
          />
        ) : null}
        <Button label="Back to Home" variant="secondary" onPress={() => router.replace('/(tabs)')} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface, paddingHorizontal: space.xl, alignItems: 'center' },
  art: { height: 200, width: '100%', maxWidth: 420, alignItems: 'center', justifyContent: 'center' },
  halo: { padding: 14, borderRadius: 80, backgroundColor: colors.successHalo },
  tick: { width: 110, height: 110, borderRadius: 55, backgroundColor: colors.successStrong, alignItems: 'center', justifyContent: 'center' },
  words: { gap: space.md, marginTop: space.xl, width: '100%', maxWidth: 420 },
  order: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: colors.bg, marginTop: space.sm },
  // As drawn: the buttons follow the message, not pinned to the foot.
  actions: { gap: space.md, width: '100%', maxWidth: 420, marginTop: space.xxl + space.lg },
});
