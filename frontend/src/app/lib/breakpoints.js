/**
 * THE breakpoint scale. Four values, and never a fifth.
 *
 * These are Tailwind v4's active defaults, mirrored here for JavaScript. Three
 * consumers, three separate reasons this file exists:
 *
 *   1. hooks/useMediaQuery.js builds its matchMedia strings from it, so every
 *      JS-side viewport check in the app agrees with every CSS one.
 *   2. globals.css declares the same four in its @theme block. Nothing in this
 *      toolchain can make that automatic — a custom property cannot appear in a
 *      media condition, so CSS reads them through Tailwind's build-time
 *      theme() function and JS reads them from here.
 *   3. It is what the breakpoint allowlist check greps against.
 *
 * The previous platform ran twelve breakpoints — 480, 560, 600, 640, 700, 768,
 * 860, 900, 950, 992, 1024, 1100 — because every stylesheet invented its own
 * and no file could be changed without checking the other seventeen. If
 * something needs to change at 480px, fold it into the `< sm` rule and confirm
 * the result is also acceptable at 639px.
 */
export const BREAKPOINTS = Object.freeze({
  sm: 640,
  md: 768,   // the mobile ↔ desktop line
  lg: 1024,
  xl: 1280,
});

/**
 * `>= bp` — mobile-first, identical in meaning to Tailwind's `sm:` / `md:`.
 *
 * Emits the classic `(min-width: 768px)` form, NOT the modern range syntax
 * `(width >= 48rem)`, deliberately: matchMedia handed a query it cannot parse
 * returns `matches: false` with no error and no warning. A range-syntax query
 * on an engine that does not support it would report "not desktop" forever, on
 * every device, in silence. The range form is safe inside globals.css because
 * it is resolved at build time.
 */
export const up = (bp) => `(min-width: ${BREAKPOINTS[bp]}px)`;

/**
 * `< bp` — the exact complement of up(bp).
 *
 * 0.02px, not 1px. At fractional CSS-pixel widths — browser zoom, Windows
 * display scaling, iOS pinch — a 1px gap leaves a band where NEITHER up(bp) nor
 * down(bp) matches, so the desktop and the mobile branch are both off at once.
 * 0.02 sits below the smallest fraction any engine reports, which closes the
 * band without overlapping it.
 */
export const down = (bp) => `(max-width: ${BREAKPOINTS[bp] - 0.02}px)`;

/** `>= a and < b` */
export const between = (a, b) => `${up(a)} and ${down(b)}`;

/**
 * Touch-primary regardless of width. Width alone stopped meaning "not a touch
 * device" years ago — a large phone in landscape is 900px+ — and the seat map
 * cares a great deal about the difference: a tap target that works for a mouse
 * is not one a thumb can hit on a 40-seat row.
 */
export const COARSE_POINTER = '(pointer: coarse)';

export const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
