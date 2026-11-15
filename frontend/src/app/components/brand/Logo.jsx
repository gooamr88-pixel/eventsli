import { TAGLINE } from '../../lib/siteRoutes';
import { MARK_FRAME, MARK_INITIAL, MARK_VIEWBOX } from './markPath';
import { WORDMARK_EVENTS, WORDMARK_LI, WORDMARK_VIEWBOX } from './wordmarkPath';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The Eventsli logo: the E-ticket, the word, and the optional tagline.
 *
 * THE E-TICKET, the owner's choice on 2026-11-15: a sunshine-yellow ticket (a
 * rounded square, notched on each side) with a near-black E on it; the word is
 * Nunito Black in the sheet's near-black. Both are generated paths — see
 * scripts/brandLogo.js — not an <img> and not live text.
 *
 * THERE IS NO COLOUR PROP. Four CSS roles colour the logo (`--es-logo-mark`,
 * `--es-logo-initial`, `--es-logo-ink`, `--es-logo-li`). They are the full-colour
 * logo by default; the scopes that sit on a photograph, a dark ground or the
 * coral ticket stub turn the word white. The ticket stays yellow everywhere.
 * A caller can choose a size and whether the tagline shows. It cannot choose a
 * colour.
 *
 * THE TAGLINE is drawn in the same SVG as the word so it can never sit at the
 * wrong width; `textLength` stretches its spacing to the word's measure. It is
 * opt-in because at masthead size it would be decoration nobody can read.
 *
 * Decorative SVGs with a real text alternative beside them: a screen reader
 * hears "Eventsli" once, not a description of a ticket.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** The word's viewBox, extended downwards to hold the tagline line. */
const [WX, WY, WW, WH] = WORDMARK_VIEWBOX.split(' ').map(Number);
const LOCKUP_VIEWBOX = `${WX} ${WY} ${WW} ${WH + 51}`;

export function LogoMark({ className = '' }) {
  return (
    <svg className={`es-logo__mark ${className}`} viewBox={MARK_VIEWBOX} aria-hidden="true" focusable="false">
      <path className="es-logo__ticket" d={MARK_FRAME} />
      <path className="es-logo__initial" d={MARK_INITIAL} />
    </svg>
  );
}

export function Wordmark({ tagline = false, className = '' }) {
  return (
    <svg
      className={`es-logo__word ${className}`}
      viewBox={tagline ? LOCKUP_VIEWBOX : WORDMARK_VIEWBOX}
      aria-hidden="true"
      focusable="false"
    >
      <path className="es-logo__events" d={WORDMARK_EVENTS} />
      <path className="es-logo__li" d={WORDMARK_LI} />
      {tagline && (
        // x/y/textLength are in the word's own units: the line runs under the
        // word from the E's stem to the i.
        <text className="es-logo__tagline" x={WX + 4} y={WY + WH + 47} textLength={Math.round(WW * 0.95)} lengthAdjust="spacing">
          {TAGLINE}
        </text>
      )}
    </svg>
  );
}

/**
 * @param {'sm'|'md'|'lg'} [size]
 * @param {boolean} [mark]     only the ticket (a collapsed rail, an app bar)
 * @param {boolean} [tagline]  the full lockup, with DISCOVER - BOOK - ENJOY under the word
 */
export default function Logo({ size = 'md', mark = false, tagline = false, className = '' }) {
  const lockup = tagline && !mark;
  return (
    <span className={`es-logo es-logo--${size} ${lockup ? 'es-logo--lockup' : ''} ${className}`}>
      <LogoMark />
      {!mark && <Wordmark tagline={lockup} />}
      <span className="sr-only">Eventsli</span>
    </span>
  );
}
