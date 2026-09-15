import { WORDMARK_PATH, WORDMARK_VIEWBOX } from './wordmarkPath';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The Eventsli logo: the framed star, and the wordmark.
 *
 * Both come from the brand artwork the previous platform shipped
 * (`events platform/dist/assets`). The mark is redrawn here from its geometry —
 * a frame with chamfered top corners and a detached base, a regular five-point
 * star inside — so it is exact at any size rather than a trace of a 512px PNG.
 * The wordmark's letterforms are custom, so those ARE traced (wordmarkPath.js).
 *
 * The artwork's teal is not used. The colour is the product's emerald, taken
 * from a ROLE (`.es-logo__mark` reads `--es-accent`), so the logo re-tones on the
 * dark theme and on the emerald sidebar without a second asset.
 *
 * Decorative SVGs with a real text alternative beside them: a screen reader
 * hears "Eventsli" once, not a description of a star.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** 512 × 500 — the frame (its inner square cut out by even-odd) and the star. */
const FRAME = 'M90 0H420L512 90V432H420V500H92V432H0V90ZM92 70V432H420V70Z';
const STAR = 'M256 118L284.2 204.7H375.4L301.7 258.3L329.8 345L256 291.5L182.2 345L210.3 258.3L136.6 204.7H227.8Z';

export function LogoMark({ className = '' }) {
  return (
    <svg className={`es-logo__mark ${className}`} viewBox="0 0 512 500" aria-hidden="true" focusable="false">
      <path fillRule="evenodd" d={FRAME} fill="currentColor" />
      <path d={STAR} fill="currentColor" />
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
 * @param {boolean} [mark]  only the framed star (a collapsed rail, a favicon-sized slot)
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
