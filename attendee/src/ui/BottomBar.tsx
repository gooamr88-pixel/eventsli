import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Container } from './layout';
import { colors, radius, shadow, space } from './theme';

/**
 * The bar that carries a screen's one action — Select Tickets, Continue,
 * Pay Now — pinned to the bottom above the home indicator, with the same
 * centred width as the content above it on a tablet or in a browser.
 */
export function BottomBar({ children, style, inline = false }: { children: ReactNode; style?: ViewStyle; inline?: boolean }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[inline ? styles.inline : styles.bar, shadow.float, { paddingBottom: inline ? space.lg : insets.bottom + space.md }, style]}>
      <Container style={styles.inner}>{children}</Container>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingTop: space.md,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
  },
  inline: { paddingTop: space.lg, backgroundColor: colors.surface, borderRadius: radius.xl },
  inner: { gap: space.sm },
});
