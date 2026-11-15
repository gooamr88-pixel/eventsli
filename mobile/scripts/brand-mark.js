/**
 * The scanner mark as SVG markup, for the scripts that render the native
 * images (app-icons.js, splash-icon.js). The app draws the same thing from
 * src/ui/ScannerMark.tsx; test/brand.test.ts holds the two equal.
 *
 * THE MARK (2026-11-15): the brand's yellow E ticket inside four yellow
 * scanner brackets, on the near-black — the website's door-scanner icon
 * (frontend/scripts/brandIcons.js `gateTile`), so the app on a home screen is
 * Eventsli AND the thing that scans. It replaced an empty yellow frame drawn
 * before the logo became the E ticket.
 *
 * In a 512 box. `scale` shrinks the drawing about the centre (Android's
 * adaptive icon shows only the middle of its layer). `radius` rounds the
 * tile; 0 is full-bleed (iOS rounds its own icons); `tile: null` draws no
 * tile at all (an adaptive icon's foreground). `solid` draws the ticket with
 * the E cut out, for a one-colour (monochrome) icon.
 */
const fs = require('node:fs');
const path = require('node:path');

const PATHS = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'brandPaths.ts'), 'utf8');
const read = (name) => {
  const m = PATHS.match(new RegExp(`export const ${name} = '([^']+)';`));
  if (!m) throw new Error(`brand-mark: no ${name} in brandPaths.ts`);
  return m[1];
};
const FRAME = read('MARK_FRAME');
const INITIAL = read('MARK_INITIAL');

/** The ticket card's own box inside the mark's viewBox (it shares its height with the word). */
const CARD = { cx: 59.5, cy: -39.5, w: 119 };

function scannerMarkSvg({
  tile = '#111018', radius = 112, brackets = '#ffcc00', ticket = '#ffcc00', initial = '#111018',
  scale = 1, solid = false,
} = {}) {
  const k = (v) => +(v * scale + (1 - scale) * 256).toFixed(2);
  const q = +(28 * scale).toFixed(2);
  const corner = (d) => `<path d="${d}" fill="none" stroke="${brackets}" stroke-width="${+(26 * scale).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const marks = [
    `M${k(112)} ${k(196)}V${k(140)}a${q} ${q} 0 0 1 ${q} -${q}H${k(196)}`,
    `M${k(316)} ${k(112)}H${k(372)}a${q} ${q} 0 0 1 ${q} ${q}V${k(196)}`,
    `M${k(400)} ${k(316)}V${k(372)}a${q} ${q} 0 0 1 -${q} ${q}H${k(316)}`,
    `M${k(196)} ${k(400)}H${k(140)}a${q} ${q} 0 0 1 -${q} -${q}V${k(316)}`,
  ].map(corner).join('');
  const s = +((176 * scale) / CARD.w).toFixed(4);
  const card = solid
    ? `<path d="${FRAME}${INITIAL}" fill="${ticket}" fill-rule="evenodd"/>`
    : `<path d="${FRAME}" fill="${ticket}"/><path d="${INITIAL}" fill="${initial}"/>`;
  const back = tile ? `<rect width="512" height="512" rx="${radius}" fill="${tile}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${back}${marks}`
    + `<g transform="translate(256 256) scale(${s}) translate(${-CARD.cx} ${-CARD.cy})">${card}</g></svg>`;
}

module.exports = { scannerMarkSvg };
