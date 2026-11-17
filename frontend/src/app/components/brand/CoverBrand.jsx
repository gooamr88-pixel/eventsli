import { MARK_VIEWBOX, MARK_FRAME, MARK_INITIAL } from './markPath';
import {
  WORDMARK_VIEWBOX, WORDMARK_EVENTS, WORDMARK_LI, WORDMARK_SPARK,
} from './wordmarkPath';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE EVENTSLI BADGE ON AN EVENT'S COVER (owner, 2026-11-17).
 *
 * Every cover the public sees — the event cards, the event page's poster, the
 * homepage slider — carries a small white pill with the logo in a corner, so a
 * screenshot of any of them still says where it came from.
 *
 * DRAWN OVER THE IMAGE, NEVER INTO IT. The organizer's file is untouched: the
 * badge can be restyled or moved in one place, works on every cover already
 * uploaded, and stays sharp at any size. The share preview that travels with a
 * link is a separate, generated card (e/[slug]/opengraph-image.jsx).
 *
 * FIXED COLOURS, in both themes: it sits on a photograph, not on the page, so
 * it is always the logo's own near-black on white — never re-pointed by dark
 * mode. Decorative (`aria-hidden`): the cover's own text alternative already
 * names the event, and "Eventsli" read aloud on every card is noise.
 *
 * `compact`: the E card alone, for small covers where the word would crowd
 * the sale tag beside it. The CSS also drops the word on phone-size rails.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function CoverBrand({ className = '', compact = false, size = 'sm' }) {
  return (
    <span className={`es-coverbrand es-coverbrand--${size} ${compact ? 'is-compact' : ''} ${className}`} aria-hidden="true">
      <svg className="es-coverbrand__mark" viewBox={MARK_VIEWBOX} focusable="false">
        <path d={MARK_FRAME} fill="#ffcc00" />
        <path d={MARK_INITIAL} fill="#111018" />
      </svg>
      {!compact && (
        <svg className="es-coverbrand__word" viewBox={WORDMARK_VIEWBOX} focusable="false">
          <path d={WORDMARK_EVENTS} fill="#111018" />
          <path d={WORDMARK_LI} fill="#111018" />
          <path d={WORDMARK_SPARK} fill="#ffcc00" />
        </svg>
      )}
    </span>
  );
}
