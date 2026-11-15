import { TAGLINE } from '../../lib/siteRoutes';
import { MARK_FRAME, MARK_INITIAL, MARK_VIEWBOX } from './markPath';
import { WORDMARK_EVENTS, WORDMARK_LI, WORDMARK_SPARK, WORDMARK_VIEWBOX } from './wordmarkPath';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The Eventsli logo: the E card, the word "eventsli" with its spark, and the
 * optional tagline.
 *
 * THE OWNER'S CHOICE, 2026-11-15: a sharp yellow card (a ticket) carrying a
 * capital E, beside lowercase Urbanist Black whose i is dotted with a yellow
 * spark. The card alone (`LogoMark`) is the icon. The two SVGs share a
 * vertical extent, so drawn at the same height they share a baseline. Both are generated paths — see
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
const LOCKUP_VIEWBOX = `${WX} ${WY} ${WW} ${WH + 50}`;

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
      <path className="es-logo__spark" d={WORDMARK_SPARK} />
      {tagline && (
        // x/y/textLength are in the word's own units: the line runs under
        // the word from the first e to the i.
        <text className="es-logo__tagline" x={WX + 2} y={WY + WH + 40} textLength={Math.round(WW * 0.97)} lengthAdjust="spacing">
          {TAGLINE}
        </text>
      )}
    </svg>
  );
}

/**
 * @param {'sm'|'md'|'lg'} [size]
 * @param {boolean} [mark]     only the E card (a collapsed rail, an app bar)
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
