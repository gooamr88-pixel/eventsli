import { MARK_FRAME, MARK_STAR } from '../brand/markPath';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * A QR matrix → an Eventsli-styled, still-scannable SVG.
 *
 * WHAT IS STYLED, AND WHAT IS NOT. A scanner reads three things: the finder
 * "eyes" in three corners, the light/dark value at the centre of each module,
 * and a quiet margin around the whole. So:
 *   · the eyes keep their exact 7-3-1 proportions, only with rounded corners
 *     and the centre in brand teal (7:1 against white — far above what any
 *     reader needs);
 *   · modules in a row are merged into one softly rounded bar — the centres a
 *     scanner samples are untouched, and the code reads as one designed object
 *     instead of a grid of pixels;
 *   · the Eventsli mark sits in a cleared 9 × 9 centre: 7% of a version-4 code,
 *     well inside the 30% that error correction H recovers;
 *   · the four-module quiet zone is kept, on white, in both themes. A QR code
 *     is never inverted for dark mode: plenty of readers cannot read light on
 *     dark.
 *
 * Pure: rows in, path data out. The same output is drawn inline (`BrandQr`)
 * and as an image for the real ticket component (`brandQrDataUri`).
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const QR_INK = '#0b3436';
export const QR_EYE = '#0d5b5e';
const QUIET = 4;
const R = 0.38;          // corner radius of a bar, in modules
const LOGO = 9;          // the cleared centre, in modules

const n3 = (v) => Math.round(v * 1000) / 1000;

/** A rounded rectangle as path commands. */
function roundRect(x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  return `M${n3(x + rr)} ${n3(y)}h${n3(w - 2 * rr)}a${rr} ${rr} 0 0 1 ${rr} ${rr}v${n3(h - 2 * rr)}`
    + `a${rr} ${rr} 0 0 1 -${rr} ${rr}h${n3(-(w - 2 * rr))}a${rr} ${rr} 0 0 1 -${rr} -${rr}`
    + `v${n3(-(h - 2 * rr))}a${rr} ${rr} 0 0 1 ${rr} -${rr}z`;
}

export function qrGeometry(rows, { logo = true } = {}) {
  const n = rows.length;
  const inFinder = (x, y) => (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
  const lo = Math.floor((n - LOGO) / 2);
  const inLogo = (x, y) => logo && x >= lo && x < lo + LOGO && y >= lo && y < lo + LOGO;

  // Each horizontal run of dark modules becomes one rounded bar.
  let modules = '';
  for (let y = 0; y < n; y += 1) {
    let x = 0;
    while (x < n) {
      const dark = (i) => rows[y][i] === '1' && !inFinder(i, y) && !inLogo(i, y);
      if (!dark(x)) { x += 1; continue; }
      const start = x;
      while (x < n && dark(x)) x += 1;
      modules += roundRect(start + 0.04, y + 0.04, x - start - 0.08, 0.92, R);
    }
  }

  const eyes = [[0, 0], [n - 7, 0], [0, n - 7]];
  return {
    size: n,
    viewBox: `${-QUIET} ${-QUIET} ${n + QUIET * 2} ${n + QUIET * 2}`,
    modules,
    // The ring is one path with a hole (even-odd); the pupil is separate so it
    // can take the accent.
    rings: eyes.map(([x, y]) => `${roundRect(x, y, 7, 7, 2)}${roundRect(x + 1, y + 1, 5, 5, 1.4)}`).join(''),
    pupils: eyes.map(([x, y]) => roundRect(x + 2, y + 2, 3, 3, 0.9)).join(''),
    logo: logo ? { x: lo, y: lo, size: LOGO } : null,
  };
}

/** The mark, scaled into the logo square with a margin. */
function markTransform(logo) {
  const inner = logo.size - 2.4;
  const scale = inner / 512;
  return `translate(${n3(logo.x + 1.2)} ${n3(logo.y + 1.2 + (inner - 500 * scale) / 2)}) scale(${n3(scale * 1000) / 1000})`;
}

/** The whole code as SVG markup — for an <img>, where JSX cannot go. */
export function brandQrSvg(rows, options) {
  const g = qrGeometry(rows, options);
  const quiet = g.size + QUIET * 2;
  const logo = g.logo
    ? `<path d="${roundRect(g.logo.x + 0.3, g.logo.y + 0.3, g.logo.size - 0.6, g.logo.size - 0.6, 1.6)}" fill="#fff"/>`
      + `<g transform="${markTransform(g.logo)}" fill="${QR_EYE}"><path fill-rule="evenodd" d="${MARK_FRAME}"/><path d="${MARK_STAR}"/></g>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${g.viewBox}" shape-rendering="geometricPrecision">`
    + `<rect x="${-QUIET}" y="${-QUIET}" width="${quiet}" height="${quiet}" rx="2" fill="#fff"/>`
    + `<path d="${g.modules}" fill="${QR_INK}"/>`
    + `<path d="${g.rings}" fill="${QR_INK}" fill-rule="evenodd"/>`
    + `<path d="${g.pupils}" fill="${QR_EYE}"/>${logo}</svg>`;
}

export function brandQrDataUri(rows, options) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(brandQrSvg(rows, options))}`;
}

export { markTransform };
