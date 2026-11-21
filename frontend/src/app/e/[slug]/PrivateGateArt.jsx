import { useId } from 'react';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The drawn parts of the private-event password screen (owner's design,
 * 2026-11-22): the warm concert scene used when an event has no cover, the
 * dark ticket with a padlock, the wave the hero ends on, and the brand-yellow
 * swooshes. All decorative (`aria-hidden`), all SVG — no stock photo to
 * license, and every colour is a brand token so it follows the theme.
 *
 * Gradient ids come from `useId`, so two of these on one page cannot collide.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const sid = (raw) => raw.replace(/[^a-zA-Z0-9_-]/g, '');

// Fixed, not random: the server and the browser must draw the same scene.
const BOKEH = [
  [40, 30, 7, 0.55], [78, 58, 4, 0.8], [112, 22, 9, 0.5], [150, 70, 5, 0.85], [176, 34, 6, 0.6],
  [205, 52, 11, 0.45], [232, 20, 5, 0.75], [258, 64, 7, 0.65], [288, 30, 9, 0.5], [318, 58, 4, 0.85],
  [346, 24, 7, 0.6], [372, 66, 5, 0.75], [24, 84, 5, 0.6], [96, 96, 8, 0.4], [196, 100, 6, 0.55],
  [300, 92, 8, 0.45], [386, 104, 6, 0.5], [134, 44, 3, 0.9], [62, 12, 3, 0.9], [270, 8, 4, 0.8],
];
const BACK_ROW = Array.from({ length: 21 }, (_, i) => ({ x: i * 21 - 6 + (i % 3) * 3, y: 146 + (i % 4) * 3, up: [2, 6, 11, 15, 19].includes(i) }));
const FRONT_ROW = Array.from({ length: 14 }, (_, i) => ({ x: i * 31 + 4 + (i % 2) * 6, y: 166 + (i % 3) * 4, up: [1, 4, 9, 12].includes(i) }));

/** A warm, out-of-focus crowd under stage lights — the fallback cover. */
export function GateScene() {
  const id = sid(useId());
  return (
    <svg className="es-pgate__scene" viewBox="0 0 400 200" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4b4f7c" />
          <stop offset="0.38" stopColor="#b58aa8" />
          <stop offset="0.62" stopColor="#f4c9a6" />
          <stop offset="1" stopColor="#e9d6c8" />
        </linearGradient>
        <radialGradient id={`${id}-glow`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#fff8ec" stopOpacity="0.95" />
          <stop offset="1" stopColor="#fff8ec" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-dot`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.55" stopColor="#ffe9b8" stopOpacity="0.8" />
          <stop offset="1" stopColor="#ffe9b8" stopOpacity="0" />
        </radialGradient>
        <filter id={`${id}-soft`} x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="0.9" /></filter>
      </defs>
      <rect width="400" height="200" fill={`url(#${id}-sky)`} />
      <ellipse cx="205" cy="96" rx="170" ry="90" fill={`url(#${id}-glow)`} />
      {BOKEH.map(([x, y, r, o]) => <circle key={`${x}-${y}`} cx={x} cy={y} r={r * 1.6} fill={`url(#${id}-dot)`} opacity={o} />)}
      <g filter={`url(#${id}-soft)`}>
        <g fill="#6a5470" stroke="#6a5470" opacity="0.7">
          {BACK_ROW.map(({ x, y, up }) => (
            <g key={`b${x}`}>
              {up && <path d={`M${x + 6} ${y + 14} L${x + 12} ${y - 22}`} strokeWidth="4.5" strokeLinecap="round" fill="none" />}
              <circle cx={x} cy={y} r="8.5" stroke="none" />
              <ellipse cx={x} cy={y + 34} rx="15" ry="26" stroke="none" />
            </g>
          ))}
        </g>
        <g fill="#2b2231" stroke="#2b2231">
          {FRONT_ROW.map(({ x, y, up }) => (
            <g key={`f${x}`}>
              {up && <path d={`M${x - 9} ${y + 16} L${x - 18} ${y - 26}`} strokeWidth="6" strokeLinecap="round" fill="none" />}
              <circle cx={x} cy={y} r="11.5" stroke="none" />
              <ellipse cx={x} cy={y + 40} rx="21" ry="32" stroke="none" />
            </g>
          ))}
        </g>
      </g>
    </svg>
  );
}

/** The dark ticket with a padlock, tilted over the hero. */
export function TicketLock() {
  const id = sid(useId());
  return (
    <svg className="es-pgate__ticket" viewBox="0 0 140 112" aria-hidden="true" focusable="false">
      <defs>
        <mask id={`${id}-cut`}>
          <rect width="140" height="112" fill="#fff" />
          <circle cx="70" cy="10" r="11" fill="#000" />
          <circle cx="10" cy="56" r="11" fill="#000" />
          <circle cx="130" cy="56" r="11" fill="#000" />
        </mask>
        <linearGradient id={`${id}-face`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2e2a3a" />
          <stop offset="1" stopColor="#15131c" />
        </linearGradient>
      </defs>
      <rect x="10" y="10" width="120" height="92" rx="16" fill={`url(#${id}-face)`} mask={`url(#${id}-cut)`} />
      <path d="M57 54v-8a13 13 0 0 1 26 0v8" fill="none" stroke="#fff" strokeWidth="7" strokeLinecap="round" />
      <rect x="49" y="52" width="42" height="34" rx="7" fill="#fff" />
      <circle cx="70" cy="66" r="4.5" fill="#15131c" />
      <rect x="68" y="67" width="4" height="9" rx="2" fill="#15131c" />
    </svg>
  );
}

/** Where the hero ends: the card's surface rising as a wave, a yellow swoosh on it. */
export function HeroWave() {
  const id = sid(useId());
  return (
    <svg className="es-pgate__wave" viewBox="0 0 400 90" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}-sun`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" style={{ stopColor: 'var(--es-sun-400)' }} stopOpacity="0" />
          <stop offset="0.45" style={{ stopColor: 'var(--es-sun-400)' }} />
          <stop offset="1" style={{ stopColor: 'var(--es-sun-500)' }} />
        </linearGradient>
      </defs>
      <path d="M210 66 C290 48 345 32 400 4 L400 26 C345 46 290 60 210 68 Z" fill={`url(#${id}-sun)`} />
      <path className="es-pgate__wave-fill" d="M0 90 L0 60 C120 100 262 50 400 26 L400 90 Z" />
    </svg>
  );
}

/** A brand-yellow swoosh for a corner: `tl` over the hero, `br` on the card. */
export function CornerSwoosh({ corner }) {
  const id = sid(useId());
  const d = corner === 'tl'
    ? 'M0 0 H170 C112 6 46 38 0 104 Z'
    : 'M120 0 C104 30 64 52 0 60 H120 Z';
  return (
    <svg className={`es-pgate__swoosh es-pgate__swoosh--${corner}`} viewBox={corner === 'tl' ? '0 0 170 104' : '0 0 120 60'} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}-sun`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--es-sun-400)' }} />
          <stop offset="1" style={{ stopColor: 'var(--es-sun-500)' }} />
        </linearGradient>
      </defs>
      <path d={d} fill={`url(#${id}-sun)`} />
    </svg>
  );
}

/** Filled padlock for the badge and the field. */
export function LockGlyph({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M8 10V7.5a4 4 0 0 1 8 0V10" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <rect x="5" y="10" width="14" height="11" rx="2.5" fill="currentColor" />
      <circle cx="12" cy="15" r="1.6" fill="var(--es-surface)" />
    </svg>
  );
}

/** The yellow shield beside "Your information is secure". */
export function ShieldGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 2.5 4.5 5.5v6c0 4.8 3.2 8.4 7.5 10 4.3-1.6 7.5-5.2 7.5-10v-6z" style={{ fill: 'var(--es-sun-500)' }} />
      <path d="m8.5 12 2.4 2.4 4.6-4.8" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The eye on the password field: struck through while the text is hidden. */
export function EyeGlyph({ off }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
      {off && <path d="M3.5 3.5l17 17" />}
    </svg>
  );
}
