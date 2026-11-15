#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Draws the Eventsli logo's vector source: the E card (`markPath.js`) and the
 * word "eventsli" with its spark (`wordmarkPath.js`), both under
 * `components/brand/`.
 *
 *   npm install --no-save opentype.js@1.3.4    # once; not an app dependency
 *   node scripts/brandLogo.js
 *
 * Then run scripts/brandIcons.js and scripts/brandKit.js, which render every
 * PNG and the print kit FROM the two files this writes.
 *
 * THE LOGO, the owner's choice on 2026-11-15 after several rounds ("make it
 * sharp"): a sharp yellow card — small corners, a notch in each side, a ticket
 * — carrying a capital E, beside the word "eventsli" in lowercase Urbanist
 * Black, whose i has a yellow four-point spark for its dot. The card alone is
 * the app icon and the favicon.
 *
 * ONE COORDINATE SYSTEM. The card's E and the word share a baseline (y = 0),
 * and BOTH files get the same vertical extent in their viewBox. So
 * `.es-logo__mark` and `.es-logo__word` drawn at the same CSS height line up
 * exactly, and the space between them is `LOGO_GAP` of that height.
 *
 * The i is the font's DOTLESS i (U+0131) with the spark drawn where the dot
 * was, centred on the stem, so the letter keeps the font's own spacing.
 * ═══════════════════════════════════════════════════════════════════════════ */
const fs = require('node:fs');
const path = require('node:path');

const BRAND = path.join(__dirname, '..', 'src', 'app', 'components', 'brand');
const r1 = (n) => Math.round(n * 10) / 10;

const SIZE = 140;                    // the word's type size, in units
const TRACK = -0.025 * SIZE;         // display tracking: tight
const E_SIZE = 0.78 * SIZE;          // the card's E
const CARD_W = 0.85 * SIZE;
const CARD_BELOW = 0.136 * SIZE;     // the card's bottom, below the baseline
const CORNER = 0.08 * SIZE;          // SHARP: a small radius, just enough not to cut
const NOTCH = 0.1 * SIZE;            // the half-circle bitten out of each side
const GAP = 0.19 * SIZE;             // card to word
const SPARK_R = 0.165 * SIZE;        // the spark's outer radius
const SPARK_WAIST = 0.24;            // its inner radius, as a share of the outer

async function urbanist900(opentype) {
  // An unknown user agent gets TrueType, which opentype.js reads directly.
  const css = await (await fetch('https://fonts.googleapis.com/css2?family=Urbanist:wght@900', { headers: { 'user-agent': 'curl/8.0' } })).text();
  const url = css.match(/url\((https:[^)]+)\)/)[1];
  return opentype.parse(await (await fetch(url)).arrayBuffer());
}

const P = (a, b) => `${r1(a)} ${r1(b)}`;

/** The card: a w × h box from (x, y), small corners, a notch in each side. */
function card(x, y, w, h) {
  const c = CORNER; const n = NOTCH; const m = y + h / 2;
  return `M${P(x + c, y)}H${r1(x + w - c)}A${r1(c)} ${r1(c)} 0 0 1 ${P(x + w, y + c)}`
    + `V${r1(m - n)}A${r1(n)} ${r1(n)} 0 0 0 ${P(x + w, m + n)}V${r1(y + h - c)}`
    + `A${r1(c)} ${r1(c)} 0 0 1 ${P(x + w - c, y + h)}H${r1(x + c)}A${r1(c)} ${r1(c)} 0 0 1 ${P(x, y + h - c)}`
    + `V${r1(m + n)}A${r1(n)} ${r1(n)} 0 0 0 ${P(x, m - n)}V${r1(y + c)}A${r1(c)} ${r1(c)} 0 0 1 ${P(x + c, y)}Z`;
}

/** A four-point spark centred on (cx, cy). */
function spark(cx, cy, R) {
  const w = R * SPARK_WAIST;
  return `M${P(cx, cy - R)}L${P(cx + w, cy - w)}L${P(cx + R, cy)}L${P(cx + w, cy + w)}`
    + `L${P(cx, cy + R)}L${P(cx - w, cy + w)}L${P(cx - R, cy)}L${P(cx - w, cy - w)}Z`;
}

(async () => {
  const opentype = require('opentype.js');
  const font = await urbanist900(opentype);
  const scale = SIZE / font.unitsPerEm;
  const cap = (font.tables.os2.sCapHeight || 700) * scale;
  const xh = (font.tables.os2.sxHeight || 500) * scale;

  // ── The card and its E, baseline at y = 0 ───────────────────────────────
  const cardTop = -cap;
  const cardH = cap + CARD_BELOW;
  const frame = card(0, cardTop, CARD_W, cardH);
  const eGlyph = font.charToGlyph('E');
  const eBox = eGlyph.getPath(0, 0, E_SIZE).getBoundingBox();
  const eCapTop = eBox.y1;                              // negative
  // Centre the E in the card both ways (its own box, not its advance).
  const eX = (CARD_W - (eBox.x2 - eBox.x1)) / 2 - eBox.x1;
  const eY = cardTop + cardH / 2 - (eCapTop / 2);       // baseline that centres the cap height
  const initial = eGlyph.getPath(eX, eY, E_SIZE).toPathData(1);

  // ── "eventsl" + dotless i, then the spark over the i ────────────────────
  const glyphs = font.stringToGlyphs('eventslı');
  if (glyphs[7].name === '.notdef' || glyphs[7].index === 0) throw new Error('brandLogo: this font has no dotless i');
  let x = 0;
  const parts = glyphs.map((g, i) => {
    const p = g.getPath(x, 0, SIZE);
    x += g.advanceWidth * scale + TRACK;
    if (i < glyphs.length - 1) x += font.getKerningValue(g, glyphs[i + 1]) * scale;
    return p;
  });
  const iBox = parts[7].getBoundingBox();
  const lBox = parts[6].getBoundingBox();
  // Centred over the i's stem — unless its left arm would touch the l's
  // ascender, in which case it moves right just far enough to clear it.
  const sparkCx = Math.max((iBox.x1 + iBox.x2) / 2, lBox.x2 + SPARK_R + 0.03 * SIZE);
  const sparkCy = -(xh + SPARK_R + 0.03 * SIZE);
  const sparkD = spark(sparkCx, sparkCy, SPARK_R);

  let minX = Infinity; let maxX = -Infinity; let minY = Infinity;
  for (const p of parts) {
    const b = p.getBoundingBox();
    minX = Math.min(minX, b.x1); maxX = Math.max(maxX, b.x2); minY = Math.min(minY, b.y1);
  }
  maxX = Math.max(maxX, sparkCx + SPARK_R);
  minY = Math.min(minY, sparkCy - SPARK_R);

  // The shared vertical extent: the highest of the card, the ascenders and
  // the spark, down to the card's bottom edge.
  const top = Math.floor(Math.min(cardTop, minY));
  const bottom = Math.ceil(cardTop + cardH);
  const height = bottom - top;
  const events = parts.slice(0, 6).map((p) => p.toPathData(1)).join('');
  const li = parts.slice(6).map((p) => p.toPathData(1)).join('');
  const wordX = Math.floor(minX);
  const wordW = Math.ceil(maxX - wordX);

  fs.writeFileSync(path.join(BRAND, 'markPath.js'), `/**
 * The Eventsli mark — the E card — as vector path data.
 *
 * GENERATED by scripts/brandLogo.js; change the geometry there and re-run it
 * rather than editing numbers here. The owner's choice on 2026-11-15: a sharp
 * yellow card (a ticket: small corners, a notch in each side) carrying a
 * capital E in Urbanist Black. It sits beside the word, and alone it is the app
 * icon and the favicon.
 *
 * TWO SHAPES, TWO COLOURS. \`MARK_FRAME\` is the card (\`--es-logo-mark\`, the
 * sheet's yellow); \`MARK_INITIAL\` is the E painted over it
 * (\`--es-logo-initial\`, near-black) — a shape rather than a hole, so on a dark
 * ground it stays near-black on yellow.
 *
 * The viewBox has the SAME vertical extent as \`WORDMARK_VIEWBOX\` (y ${top} to
 * ${bottom}), so the two line up when drawn at the same height.
 *
 * Read by things that must agree: \`Logo.jsx\`, \`app/icon.svg\` (the favicon,
 * which carries the paths literally), the QR centre (\`landing/brandQr.js\`) and
 * \`scripts/brandIcons.js\`. \`test/logo.test.jsx\` fails if the favicon's copy
 * drifts from this one.
 */
export const MARK_VIEWBOX = '0 ${top} ${Math.ceil(CARD_W)} ${height}';

export const MARK_FRAME = '${frame}';

export const MARK_INITIAL = '${initial}';
`);

  fs.writeFileSync(path.join(BRAND, 'wordmarkPath.js'), `/**
 * The Eventsli word — "eventsli" with a spark for the dot of its i — as vector
 * path data, set to follow the E card in \`markPath.js\`.
 *
 * GENERATED by scripts/brandLogo.js from Urbanist Black (2026-11-15): the i is
 * the font's dotless i, and the dot is a four-point spark in the sheet's
 * yellow. Kept as paths, not text, so the word is the same on a machine without
 * the font and takes its colours from CSS roles.
 *
 * The viewBox has the SAME vertical extent as \`MARK_VIEWBOX\`, so the two share
 * a baseline when drawn at the same height. \`LOGO_GAP\` is the space between
 * the card and the word, as a share of that height.
 *
 * THREE EXPORTS: "events", "li" (near-black, \`--es-logo-ink\`) and the spark
 * (yellow, \`--es-logo-mark\`).
 */
export const WORDMARK_VIEWBOX = '${wordX} ${top} ${wordW} ${height}';

export const LOGO_GAP = '${(GAP / height).toFixed(4)}';

/** e, v, e, n, t, s. */
export const WORDMARK_EVENTS = '${events}';

/** l, and the dotless i. */
export const WORDMARK_LI = '${li}';

/** The spark over the i. */
export const WORDMARK_SPARK = '${sparkD}';
`);

  console.log('brandLogo: mark', `0 ${top} ${Math.ceil(CARD_W)} ${height}`, '· word', `${wordX} ${top} ${wordW} ${height}`, '· gap', (GAP / height).toFixed(4));
})().catch((err) => { console.error(err); process.exit(1); });
