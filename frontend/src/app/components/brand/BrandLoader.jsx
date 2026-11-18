import { useId } from 'react';
import { WORDMARK_EVENTS, WORDMARK_LI, WORDMARK_SPARK } from './wordmarkPath';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The logo, assembling itself — the loading animation (owner's video,
 * 2026-11-18), looped:
 *
 *   1. the yellow card drops in and settles with a small squash
 *   2. the ticket notches cut into its sides
 *   3. the E is drawn stroke by stroke: I → F → E
 *   4. "eventsli" rises into place from behind a mask
 *   5. the spark pops over the i with a little burst
 *   6. a hold, then the whole thing fades and starts again
 *
 * BUILT FROM THE REAL LOGO GEOMETRY (markPath.js / wordmarkPath.js), not a
 * video or a GIF: it is a few hundred bytes, sharp at any size, and it takes
 * the `--es-logo-*` colour roles like every other logo on the site.
 *
 * WHY THE E IS FOUR RECTANGLES. `MARK_INITIAL` is one outline, which cannot be
 * drawn stroke by stroke. Its geometry is four straight bars, so they are drawn
 * here as four <rect>s at exactly those coordinates (the arms overlap the stem
 * by a unit so no hairline seam shows at the joins). If the E in
 * markPath.js ever changes, change these four bars with it.
 *
 * THE CARD IS A ROUNDED RECT WITH A MASK rather than `MARK_FRAME`, so the two
 * notches can grow from nothing. Same corners (11.2), same notch radius (14).
 *
 * ALL THE MOTION IS CSS (`.es-bl*` in globals.css). Every animated part's
 * resting style is the finished logo, so under `prefers-reduced-motion` —
 * where the animations are switched off — the complete logo simply sits there.
 *
 * Decorative: the caller says what is loading (ImageLoader is aria-hidden; a
 * route fallback puts the words on its role="status" wrapper).
 *
 * @param {'full'|'mark'} [variant]  the stacked lockup, or the card alone for
 *   frames too small for the word to be read
 * ─────────────────────────────────────────────────────────────────────────────
 */

function Card({ maskId }) {
  return (
    <g className="es-bl__tile">
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x="-20" y="-120" width="160" height="160">
          <rect x="-20" y="-120" width="160" height="160" fill="#fff" />
          <circle className="es-bl__notch" cx="0" cy="-39.5" r="14" fill="#000" />
          <circle className="es-bl__notch" cx="119" cy="-39.5" r="14" fill="#000" />
        </mask>
      </defs>
      <rect className="es-logo__ticket" x="0" y="-98" width="119" height="117" rx="11.2" mask={`url(#${maskId})`} />
      <rect className="es-logo__initial es-bl__stem" x="35.1" y="-77.7" width="16.4" height="76.4" />
      <rect className="es-logo__initial es-bl__arm es-bl__arm--1" x="50.5" y="-77.7" width="33.4" height="16.4" />
      <rect className="es-logo__initial es-bl__arm es-bl__arm--2" x="50.5" y="-50.4" width="25.9" height="16.4" />
      <rect className="es-logo__initial es-bl__arm es-bl__arm--3" x="50.5" y="-17.6" width="33.4" height="16.3" />
    </g>
  );
}

/** Six short rays around a centre, for the spark's pop. */
function Burst({ cx, cy, inner, outer }) {
  return (
    <g className="es-bl__burst">
      {[0, 60, 120, 180, 240, 300].map((deg) => {
        const r = (deg * Math.PI) / 180;
        const p = (d) => [cx + Math.cos(r) * d, cy + Math.sin(r) * d].map((n) => n.toFixed(1));
        const [x1, y1] = p(inner);
        const [x2, y2] = p(outer);
        return <line key={deg} x1={x1} y1={y1} x2={x2} y2={y2} />;
      })}
    </g>
  );
}

export default function BrandLoader({ variant = 'full', className = '' }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');

  if (variant === 'mark') {
    // The card alone, with the spark landing on its top-right corner.
    return (
      <svg className={`es-bl es-bl--mark ${className}`} viewBox="-8 -122 145 151" aria-hidden="true" focusable="false">
        <g className="es-bl__all">
          <Card maskId={`${id}-m`} />
          <Burst cx={116} cy={-96} inner={13} outer={21} />
          <path className="es-logo__spark es-bl__spark" d="M116 -110L118.8 -98.8L130 -96L118.8 -93.2L116 -82L113.2 -93.2L102 -96L113.2 -98.8Z" />
        </g>
      </svg>
    );
  }

  // The stacked lockup from the video: the card centred over the word, both at
  // the logo's own scale. The word sits 20 units under the card.
  return (
    <svg className={`es-bl ${className}`} viewBox="0 0 484 262" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={`${id}-w`} clipPathUnits="userSpaceOnUse">
          <rect x="0" y="-112" width="484" height="128" />
        </clipPath>
      </defs>
      <g className="es-bl__all">
        <g transform="translate(182.5 102)">
          <Card maskId={`${id}-m`} />
        </g>
        <g transform="translate(0 246)">
          <g clipPath={`url(#${id}-w)`}>
            <g className="es-bl__word">
              <path className="es-logo__events" d={WORDMARK_EVENTS} />
              <path className="es-logo__li" d={WORDMARK_LI} />
            </g>
          </g>
          <Burst cx={456.3} cy={-97.3} inner={30} outer={42} />
          <path className="es-logo__spark es-bl__spark" d={WORDMARK_SPARK} />
        </g>
      </g>
    </svg>
  );
}
