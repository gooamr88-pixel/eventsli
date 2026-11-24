import { Children, isValidElement, type ReactNode } from 'react';
import { StyleSheet, useWindowDimensions, View, type ViewStyle } from 'react-native';

import { space } from './theme';

/**
 * ONE APP, EVERY SCREEN SIZE.
 *
 * A small phone (320 pt), a large one (430), a tablet in either orientation
 * and a browser window all run this app (`supportsTablet`, and Expo's web
 * build). Before this, every screen was a single column stretched to the
 * window: on an iPad the event cards were 1,000 pt wide and the text lines
 * ran the full width. Now:
 *
 *   - content sits in a centred column no wider than MAX_CONTENT;
 *   - lists become grids whose column count follows the room available
 *     (`columns(min)`), never a fixed "2 on tablet";
 *   - `wide` screens (tablet landscape, desktop) get two-pane layouts — the
 *     event page, the seat map with its side panel — and the tab bar becomes
 *     a side rail.
 */
export const MAX_CONTENT = 1180;
export const BREAKPOINTS = { tablet: 700, wide: 1024 } as const;

export function useLayout() {
  const { width, height, fontScale } = useWindowDimensions();
  const tablet = width >= BREAKPOINTS.tablet;
  const wide = width >= BREAKPOINTS.wide;
  const gutter = tablet ? space.xl : space.lg;
  // The tab rail takes its own width on wide screens; content measures the rest.
  const rail = wide ? 220 : 0;
  const frame = Math.min(width - rail, MAX_CONTENT);
  const inner = frame - gutter * 2;
  /** How many cards of at least `min` points fit across, with `gap` between. */
  const columns = (min: number, gap: number = space.md) => Math.max(1, Math.floor((inner + gap) / (min + gap)));
  /** The width of one of `n` columns. */
  const columnWidth = (n: number, gap: number = space.md) => (inner - gap * (n - 1)) / n;
  return { width, height, fontScale, tablet, wide, gutter, frame, inner, rail, columns, columnWidth, compact: width < 360 };
}

export type Layout = ReturnType<typeof useLayout>;

/**
 * The centred column every scrolling screen sits in. Padding is the gutter,
 * so content lines up with the screen's title at any width.
 */
export function Container({ children, style, flush = false }: { children: ReactNode; style?: ViewStyle | ViewStyle[]; flush?: boolean }) {
  const { gutter } = useLayout();
  return (
    <View style={[styles.container, { maxWidth: MAX_CONTENT, paddingHorizontal: flush ? 0 : gutter }, style]}>
      {children}
    </View>
  );
}

/**
 * Children laid out in as many columns of at least `min` points as fit. A
 * phone gets one or two; a tablet three; a desktop four. Rows are equal
 * width, the last row left-aligned (not stretched), as a grid should be.
 */
export function Grid({ children, min, gap = space.md, max }: { children: ReactNode; min: number; gap?: number; max?: number }) {
  const { columns, columnWidth } = useLayout();
  const n = Math.min(columns(min, gap), max ?? Infinity);
  const w = columnWidth(n, gap);
  return (
    <View style={[styles.grid, { gap }]}>
      {/* toArray gives every child a stable key from its own. */}
      {Children.toArray(children).map((child) => (
        <View key={isValidElement(child) && child.key !== null ? child.key : undefined} style={{ width: w }}>{child}</View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%', alignSelf: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
});
