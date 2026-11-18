import { useWindowDimensions, type ViewStyle } from 'react-native';

/**
 * Size classes for the iPad (2026-11-18), read from the WINDOW, never from the
 * device: on iOS 27 an iPad app runs in a window the person can resize (Split
 * View, Stage Manager), and the system ignores the orientations an app asks
 * for, so a 13-inch iPad can hand us a 390-point-wide window. Asking "is this an
 * iPad?" would lay a tablet design into a phone-sized window.
 *
 *   compact   < 600 pt    every iPhone, and narrow iPad windows: the phone design, untouched
 *   regular   600–999     iPad portrait, half-screen landscape: one centred column, roomier
 *   wide      ≥ 1000      iPad landscape, 13-inch portrait: two-column dashboards, grids
 *
 * The phone layout is the compact class exactly: a gutter of 20 (the old
 * `space.lg + 4`) and no maximum width, so nothing moves on an iPhone.
 */
export type SizeClass = 'compact' | 'regular' | 'wide';

export const BREAKPOINT = { regular: 600, wide: 1000 } as const;

/**
 * The widest a block of content may grow. Lines of text past ~760 pt are hard
 * to read, a form past ~520 looks empty, and a page of cards stops at 1180 so a
 * 13-inch landscape screen keeps margins.
 */
export const MAX_WIDTH = { form: 520, column: 760, page: 1180 } as const;
export type ContentWidth = keyof typeof MAX_WIDTH | 'full';

const GUTTER: Record<SizeClass, number> = { compact: 20, regular: 32, wide: 40 };

export type Layout = {
  width: number;
  height: number;
  size: SizeClass;
  landscape: boolean;
  /** Horizontal padding at the edge of the content. */
  gutter: number;
  compact: boolean;
  wide: boolean;
};

export function sizeClassFor(width: number): SizeClass {
  if (width >= BREAKPOINT.wide) return 'wide';
  if (width >= BREAKPOINT.regular) return 'regular';
  return 'compact';
}

export function layoutFor(width: number, height: number): Layout {
  const size = sizeClassFor(width);
  return {
    width,
    height,
    size,
    landscape: width > height,
    gutter: GUTTER[size],
    compact: size === 'compact',
    wide: size === 'wide',
  };
}

/** The current window's layout. Re-renders when the window is resized or rotated. */
export function useLayout(): Layout {
  const { width, height } = useWindowDimensions();
  return layoutFor(width, height);
}

/** The width content of this kind actually gets in this window, gutters removed. */
export function contentWidth(layout: Layout, content: ContentWidth): number {
  const max = content === 'full' ? Infinity : MAX_WIDTH[content];
  return Math.min(layout.width, max) - layout.gutter * 2;
}

/**
 * A centred block of content, at most `content` wide, with the size class's
 * gutter. On a phone it is simply full width with a 20-point gutter.
 */
export function columnStyle(layout: Layout, content: ContentWidth): ViewStyle {
  return {
    width: '100%',
    // Never on a phone, so nothing there can move.
    maxWidth: layout.compact || content === 'full' ? undefined : MAX_WIDTH[content],
    alignSelf: 'center',
    paddingHorizontal: layout.gutter,
  };
}

/**
 * How many cards fit across `available` points when each needs at least
 * `minItem` and they sit `gap` apart, between 1 and `max`.
 */
export function gridColumns(available: number, minItem: number, gap: number, max = 3): number {
  const fit = Math.floor((available + gap) / (minItem + gap));
  return Math.max(1, Math.min(max, fit));
}
