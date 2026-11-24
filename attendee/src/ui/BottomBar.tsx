import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Container } from './layout';
import { colors, space } from './theme';

/**
 * The bar that carries a screen's one action — Select Tickets, Continue,
 * Pay Now — pinned to the bottom above the home indicator, white and flat as
 * on the mockup, with the same centred width as the content above it.
 */
export function BottomBar({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingBottom: insets.bottom + space.md }, style]}>
      <Container style={styles.inner}>{children}</Container>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingTop: space.md,
    backgroundColor: colors.surface,
  },
  inner: { gap: space.md },
});
