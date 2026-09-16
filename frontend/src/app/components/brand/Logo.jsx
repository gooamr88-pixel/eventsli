import { WORDMARK_PATH, WORDMARK_VIEWBOX } from './wordmarkPath';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The Eventsli logo: the leaf, and the wordmark.
 *
 * THE MARK CHANGED 2026-09-16. It was a framed star, redrawn from the artwork
 * the previous platform shipped. The brand artwork supplied with the storefront
 * is a leaf with a spiral wound into it, and a masthead carrying a different
 * mark from the one on everything else is the kind of inconsistency that makes
 * a product look assembled rather than made.
 *
 * It is DRAWN, not traced, and that is the same decision the star was built on.
 * A trace of a 1536px PNG carries every wobble of its own anti-aliasing: it was
 * tried here first and produced a 3,000-character path that was visibly lumpy
 * at 200px and mud at 28px. The geometry below is a leaf outline with a cusp at
 * the tip and a spiral gap struck through it — exact at any size, and a tenth
 * of the bytes.
 *
 * The wordmark's letterforms are custom, so those ARE traced (wordmarkPath.js).
 *
 * The artwork's own green is not used. The colour comes from a ROLE
 * (`.es-logo__mark` reads `--es-accent`), so the logo re-tones on the dark
 * theme, on the emerald sidebar and over the hero photograph without a second
 * asset existing anywhere.
 *
 * Decorative SVGs with a real text alternative beside them: a screen reader
 * hears "Eventsli" once, not a description of a leaf.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * The leaf, in a 64 box.
 *
 * Two subpaths under `evenodd`: the blade, and the spiral struck out of it. The
 * spiral is an annulus that NARROWS as it winds inward — a constant-width one
 * reads as a washer rather than as something that grew.
 */
const LEAF = 'M54.5 5.0C55.92 5.00 54.83 3.08 54.50 5.00C54.17 6.92 53.50 12.67 52.50 16.50C51.50 20.33 50.25 24.17 48.50 28.00C46.75 31.83 44.58 35.83 42.00 39.50C39.42 43.17 36.08 47.08 33.00 50.00C29.92 52.92 26.50 56.00 23.50 57.00C20.50 58.00 17.45 57.25 15.00 56.00C12.55 54.75 10.17 52.17 8.80 49.50C7.43 46.83 6.85 43.33 6.80 40.00C6.75 36.67 7.22 32.92 8.50 29.50C9.78 26.08 11.92 22.50 14.50 19.50C17.08 16.50 20.42 13.62 24.00 11.50C27.58 9.38 32.33 7.88 36.00 6.80C39.67 5.72 42.92 5.30 46.00 5.00C49.08 4.70 53.08 5.00 54.50 5.00Z';
const SPIRAL = 'M30.88 26.47C31.60 25.89 32.75 27.39 33.59 27.97C34.43 28.55 35.21 29.22 35.90 29.94C36.59 30.66 37.22 31.46 37.74 32.28C38.27 33.11 38.70 34.00 39.05 34.89C39.39 35.78 39.65 36.72 39.81 37.65C39.97 38.58 40.03 39.53 40.00 40.45C39.97 41.37 39.85 42.30 39.65 43.18C39.45 44.06 39.15 44.92 38.78 45.72C38.41 46.52 37.96 47.30 37.45 48.00C36.94 48.70 36.36 49.35 35.74 49.92C35.12 50.49 34.43 51.00 33.72 51.43C33.01 51.86 32.26 52.22 31.50 52.49C30.74 52.76 29.94 52.96 29.16 53.07C28.38 53.18 27.59 53.21 26.82 53.17C26.05 53.13 25.28 53.01 24.55 52.82C23.82 52.63 23.12 52.36 22.46 52.04C21.80 51.72 21.18 51.33 20.61 50.89C20.04 50.45 19.52 49.95 19.07 49.43C18.62 48.91 18.22 48.33 17.89 47.74C17.56 47.15 17.29 46.52 17.09 45.90C16.89 45.28 16.75 44.63 16.68 44.00C16.61 43.37 16.61 42.73 16.66 42.11C16.71 41.49 16.84 40.89 17.01 40.31C17.18 39.73 17.42 39.17 17.70 38.66C17.98 38.15 18.31 37.67 18.67 37.24C19.03 36.81 19.43 36.42 19.86 36.08C20.29 35.74 20.75 35.45 21.22 35.22C21.69 34.98 22.14 34.16 22.67 34.67C23.20 35.18 24.25 37.63 24.42 38.26C24.59 38.89 23.92 38.35 23.67 38.44C23.42 38.53 23.17 38.64 22.93 38.79C22.69 38.94 22.45 39.12 22.24 39.32C22.03 39.52 21.82 39.75 21.65 40.01C21.47 40.27 21.31 40.56 21.19 40.86C21.07 41.16 20.97 41.49 20.91 41.83C20.85 42.17 20.82 42.52 20.83 42.88C20.84 43.24 20.89 43.61 20.98 43.98C21.07 44.34 21.19 44.72 21.36 45.07C21.53 45.42 21.74 45.77 21.99 46.09C22.24 46.41 22.52 46.73 22.84 47.01C23.16 47.29 23.52 47.55 23.90 47.76C24.28 47.97 24.70 48.15 25.13 48.29C25.56 48.43 26.03 48.53 26.50 48.58C26.97 48.63 27.46 48.64 27.94 48.59C28.42 48.54 28.92 48.45 29.40 48.30C29.88 48.15 30.36 47.95 30.82 47.70C31.28 47.45 31.72 47.15 32.13 46.80C32.54 46.45 32.92 46.05 33.26 45.62C33.60 45.19 33.92 44.71 34.17 44.20C34.42 43.69 34.63 43.14 34.78 42.58C34.93 42.02 35.03 41.42 35.07 40.82C35.11 40.22 35.09 39.60 35.01 38.99C34.92 38.38 34.77 37.75 34.56 37.16C34.35 36.56 34.08 35.98 33.75 35.42C33.42 34.87 33.02 34.32 32.57 33.83C32.12 33.34 31.61 32.87 31.06 32.47C30.51 32.07 29.31 32.42 29.28 31.42C29.25 30.42 30.16 27.04 30.88 26.47Z';

export function LogoMark({ className = '' }) {
  return (
    <svg className={`es-logo__mark ${className}`} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      {/* ONE path with both subpaths, not two <path> elements. The spiral is a
          HOLE, and a hole only exists as a subpath under the same fill rule —
          as its own element it would paint a second leaf on top. */}
      <path fillRule="evenodd" d={`${LEAF} ${SPIRAL}`} fill="currentColor" />
    </svg>
  );
}

export function Wordmark({ className = '' }) {
  return (
    <svg className={`es-logo__word ${className}`} viewBox={WORDMARK_VIEWBOX} aria-hidden="true" focusable="false">
      <path fillRule="evenodd" d={WORDMARK_PATH} fill="currentColor" />
    </svg>
  );
}

/**
 * @param {'sm'|'md'|'lg'} [size]
 * @param {boolean} [mark]  only the leaf (a collapsed rail, a favicon-sized slot)
 */
export default function Logo({ size = 'md', mark = false, className = '' }) {
  return (
    <span className={`es-logo es-logo--${size} ${className}`}>
      <LogoMark />
      {!mark && <Wordmark />}
      <span className="sr-only">Eventsli</span>
    </span>
  );
}
