#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Draws the Eventsli logo's vector source: the yellow ticket with its star
 * (`components/brand/markPath.js`) and the italic wordmark
 * (`components/brand/wordmarkPath.js`).
 *
 *   npm install --no-save opentype.js@1.3.4    # once; not an app dependency
 *   node scripts/brandLogo.js
 *
 * Then run scripts/brandIcons.js and scripts/brandKit.js, which render every
 * PNG and the print kit FROM the two files this writes.
 *
 * THE LOGO, 2026-11-15, from the approved homepage concept ("Eventsli | Website
 * design inspiration"): a sunshine-yellow ticket, tilted, with a white star
 * punched into it, and "Eventsli" in a heavy italic near-black. It replaced Via
 * Marketing's teal framed star.
 *
 * DRAWN, not traced. The ticket is a rounded rectangle with a semicircular
 * notch in each long edge, rotated as one shape; the star is a regular
 * five-point star. Both are computed here, so they are exact at 16px and at
 * 2,000. The word is outlined from Montserrat ExtraBold Italic — the face the
 * site's headings are set in — so the logo and the page are one typeface, and
 * the paths render identically on a machine without the font.
 * ═══════════════════════════════════════════════════════════════════════════ */
const fs = require('node:fs');
const path = require('node:path');

const BRAND = path.join(__dirname, '..', 'src', 'app', 'components', 'brand');
const r1 = (n) => Math.round(n * 10) / 10;

/* ── The mark ─────────────────────────────────────────────────────────────── */

const TILT = -12;                     // degrees; negative lifts the right end
const TW = 440;                       // ticket, before the tilt
const TH = 296;
const CORNER = 40;
const NOTCH = 44;
const STAR_R = 110;                   // the star's outer radius
const STAR_INNER = 0.47;              // inner radius as a share of the outer

function ticketSegments() {
  const x = TW / 2;
  const y = TH / 2;
  const c = CORNER;
  const n = NOTCH;
  // [command, point, arc radius, sweep] — lines and circular arcs only, so a
  // rotation moves the endpoints and leaves every arc a circle.
  return [
    ['M', [-x + c, -y]],
    ['L', [x - c, -y]],
    ['A', [x, -y + c], c, 1],
    ['L', [x, -n]],
    ['A', [x, n], n, 0],
    ['L', [x, y - c]],
    ['A', [x - c, y], c, 1],
    ['L', [-x + c, y]],
    ['A', [-x, y - c], c, 1],
    ['L', [-x, n]],
    ['A', [-x, -n], n, 0],
    ['L', [-x, -y + c]],
    ['A', [-x + c, -y], c, 1],
  ];
}

function starPoints() {
  const pts = [];
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 === 0 ? STAR_R : STAR_R * STAR_INNER;
    const a = (-90 + i * 36) * (Math.PI / 180);
    pts.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return pts;
}

function buildMark() {
  const t = (TILT * Math.PI) / 180;
  const rot = ([px, py]) => [px * Math.cos(t) - py * Math.sin(t), px * Math.sin(t) + py * Math.cos(t)];

  const segs = ticketSegments().map(([cmd, p, r, s]) => [cmd, rot(p), r, s]);
  const star = starPoints().map(rot);

  // The rotated ticket's bounds, sampled densely enough to include the arcs.
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (let i = 0; i < 360; i += 1) {
    const a = (i * Math.PI) / 180;
    // the four corner circles are the only parts that reach the bounds
    for (const [cx, cy] of [[TW / 2 - CORNER, TH / 2 - CORNER], [-(TW / 2 - CORNER), TH / 2 - CORNER],
      [TW / 2 - CORNER, -(TH / 2 - CORNER)], [-(TW / 2 - CORNER), -(TH / 2 - CORNER)]]) {
      const [qx, qy] = rot([cx + CORNER * Math.cos(a), cy + CORNER * Math.sin(a)]);
      minX = Math.min(minX, qx); maxX = Math.max(maxX, qx);
      minY = Math.min(minY, qy); maxY = Math.max(maxY, qy);
    }
  }
  const W = Math.ceil(maxX - minX);
  const H = Math.ceil(maxY - minY);
  const ox = -minX + (W - (maxX - minX)) / 2;
  const oy = -minY + (H - (maxY - minY)) / 2;
  const P = ([px, py]) => `${r1(px + ox)} ${r1(py + oy)}`;

  const frame = segs.map(([cmd, p, r, s]) => (cmd === 'A' ? `A${r} ${r} 0 0 ${s} ${P(p)}` : `${cmd}${P(p)}`)).join('') + 'Z';
  const starD = `M${star.map(P).join('L')}Z`;
  return { viewBox: `0 0 ${W} ${H}`, frame, star: starD };
}

/* ── The word ─────────────────────────────────────────────────────────────── */

async function montserrat800Italic(opentype) {
  // An unknown user agent gets TrueType, which opentype.js reads directly.
  const css = await (await fetch('https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@1,800', { headers: { 'user-agent': 'curl/8.0' } })).text();
  const url = css.match(/url\((https:[^)]+)\)/)[1];
  return opentype.parse(await (await fetch(url)).arrayBuffer());
}

function buildWord(font) {
  const SIZE = 140;                   // cap height ≈ 98 units, as the old word
  const TRACK = -0.012 * SIZE;        // the concept sets it tight
  const scale = SIZE / font.unitsPerEm;
  const glyphs = font.stringToGlyphs('Eventsli');
  let x = 0;
  const parts = glyphs.map((g, i) => {
    const p = g.getPath(x, 0, SIZE);
    x += g.advanceWidth * scale + TRACK;
    if (i < glyphs.length - 1) x += font.getKerningValue(g, glyphs[i + 1]) * scale;
    return p;
  });

  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const p of parts) {
    const b = p.getBoundingBox();
    minX = Math.min(minX, b.x1); minY = Math.min(minY, b.y1);
    maxX = Math.max(maxX, b.x2); maxY = Math.max(maxY, b.y2);
  }
  const d = (list) => list.map((p) => p.toPathData(1)).join('');
  const vb = [Math.floor(minX), Math.floor(minY), Math.ceil(maxX - Math.floor(minX)), Math.ceil(maxY - Math.floor(minY))];
  return { viewBox: vb.join(' '), events: d(parts.slice(0, 6)), li: d(parts.slice(6)) };
}

/* ── Write ────────────────────────────────────────────────────────────────── */

(async () => {
  const opentype = require('opentype.js');
  const mark = buildMark();
  const word = buildWord(await montserrat800Italic(opentype));

  fs.writeFileSync(path.join(BRAND, 'markPath.js'), `/**
 * The Eventsli mark — the yellow ticket with a white star — as vector path data.
 *
 * GENERATED by scripts/brandLogo.js; change the geometry there and re-run it
 * rather than editing numbers here. Drawn 2026-11-15 from the approved homepage
 * concept: a ticket with a notch in each long edge, tilted ${Math.abs(TILT)}°, and a
 * regular five-point star on it.
 *
 * TWO SHAPES, TWO COLOURS. \`MARK_FRAME\` is the ticket (\`--es-logo-mark\`, the
 * sheet's yellow); \`MARK_STAR\` is painted over it in \`--es-logo-star\` (white).
 * The star is a separate shape rather than a hole so that on a dark ground it
 * stays white instead of showing the ground through the ticket.
 *
 * Read by three things that must agree: \`Logo.jsx\`, \`app/icon.svg\` (the
 * favicon, which never sees a stylesheet so it carries the paths literally) and
 * \`scripts/brandIcons.js\`, which renders every PNG icon from them.
 * \`test/logo.test.jsx\` fails if the favicon's copy ever drifts from this one.
 */
export const MARK_VIEWBOX = '${mark.viewBox}';

export const MARK_FRAME = '${mark.frame}';

export const MARK_STAR = '${mark.star}';
`);

  fs.writeFileSync(path.join(BRAND, 'wordmarkPath.js'), `/**
 * The Eventsli wordmark as vector path data.
 *
 * GENERATED by scripts/brandLogo.js from Montserrat ExtraBold Italic, the face
 * the site's headings are set in (2026-11-15). Kept as paths, not text, so the
 * word is the same on a machine without the font and takes its colour from a
 * CSS role.
 *
 * TWO EXPORTS, ONE COLOUR. The word is near-black throughout; it is still two
 * paths ("Events" and "li") because the print kit and the tests address the
 * halves, and a future two-colour treatment would need nothing but CSS.
 * \`fill-rule="nonzero"\` is what the font's outlines are wound for.
 */
export const WORDMARK_VIEWBOX = '${word.viewBox}';

/** E, v, e, n, t, s. */
export const WORDMARK_EVENTS = '${word.events}';

/** l, i. */
export const WORDMARK_LI = '${word.li}';
`);

  console.log('brandLogo: mark', mark.viewBox, '· word', word.viewBox);
})().catch((err) => { console.error(err); process.exit(1); });
