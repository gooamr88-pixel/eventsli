import { TAGLINE } from '../../lib/siteRoutes';
import { MARK_FRAME, MARK_STAR, MARK_VIEWBOX } from './markPath';
import { WORDMARK_EVENTS, WORDMARK_LI, WORDMARK_VIEWBOX } from './wordmarkPath';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The Eventsli logo: the framed star, the two-colour wordmark, and the tagline.
 *
 * REBUILT 2026-10-16 to Via Marketing's brand guide. Three things changed:
 *
 *   THE MARK is the framed star again (see markPath.js). The leaf that replaced
 *   it on 2026-09-16 is gone everywhere.
 *
 *   THE WORD IS TWO COLOURS. "Events" is the brand black and "li" with its star
 *   is the brand teal, which is how the guide sets it. That is why the wordmark
 *   is two paths now rather than one.
 *
 *   THERE IS NO COLOUR PROP, and that is the guide's "do not change the logo
 *   colours" made into something the code enforces. Three CSS roles colour the
 *   logo (`--es-logo-mark`, `--es-logo-ink`, `--es-logo-li`); they are the full-
 *   colour logo by default, and the only scopes that redefine them are the ones
 *   that mean the guide's REVERSED version (a photograph, the ticket stub), where
 *   all three are white. A caller can choose a size and whether the tagline
 *   shows. It cannot choose a colour.
 *
 * THE TAGLINE is part of the lockup in the artwork, set under the word and
 * spanning it. It is drawn in the same SVG as the word so it can never sit at
 * the wrong width; `textLength` stretches the letter-spacing to the word's
 * measure exactly. It is opt-in because at masthead size it would be 6px tall,
 * which is decoration nobody can read: the header, the sidebar and the gate show
 * the word alone, and the footer, the sign-in page and the email carry it.
 *
 * Decorative SVGs with a real text alternative beside them: a screen reader
 * hears "Eventsli" once, not a description of a star.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** The word's viewBox, extended downwards to hold the tagline line. */
const [WX, WY, WW] = WORDMARK_VIEWBOX.split(' ').map(Number);
const LOCKUP_VIEWBOX = `${WX} ${WY} ${WW} 152`;

export function LogoMark({ className = '' }) {
  return (
    <svg className={`es-logo__mark ${className}`} viewBox={MARK_VIEWBOX} aria-hidden="true" focusable="false">
      <path fillRule="evenodd" d={MARK_FRAME} />
      <path d={MARK_STAR} />
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
      <path className="es-logo__events" fillRule="evenodd" d={WORDMARK_EVENTS} />
      <path className="es-logo__li" fillRule="evenodd" d={WORDMARK_LI} />
      {tagline && (
        // x/y/textLength are in the word's own units: the line starts under the
        // E's stem and ends under the i, as in the artwork.
        <text className="es-logo__tagline" x={WX + 16} y={WY + 148} textLength="435" lengthAdjust="spacing">
          {TAGLINE}
        </text>
      )}
    </svg>
  );
}

/**
 * @param {'sm'|'md'|'lg'} [size]
 * @param {boolean} [mark]     only the framed star (a collapsed rail, an app bar)
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
