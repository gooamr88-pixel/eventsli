#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Renders every RASTER brand asset from the logo's vector source.
 *
 *   node scripts/brandIcons.js
 *
 * Writes:
 *   src/app/apple-icon.png              180 × 180  home screen, and the email masthead
 *   public/gate-icon-192.png            192 × 192  the door scanner's app icon
 *   public/gate-icon-512.png            512 × 512
 *   public/gate-icon-maskable-512.png   512 × 512  Android's adaptive icon
 *   public/og-default.png              1200 × 630  the share card every link inherits
 *
 * WHY A SCRIPT AND NOT FILES SOMEBODY EXPORTS BY HAND. The PNGs are the only
 * copies of the logo that cannot follow a stylesheet, so they are the copies
 * that drift: when the mark became a leaf on 2026-09-16 the apple icon changed
 * and the share card did not — every link shared since then carried the
 * emerald-era card with a serif name on it. These are drawn from the SAME
 * paths as the site's logo (`components/brand/markPath.js`, `wordmarkPath.js`)
 * and the same tagline (`lib/siteRoutes.js`), read out of those files, so
 * re-running this is the whole of "update the icons".
 *
 * NEEDS Playwright (resolved from the global install, as the QC scripts do)
 * and network access to Google Fonts, which supplies DM Sans for the tagline
 * and the share card's sentence. Not part of `npm run check` for that reason.
 * ═══════════════════════════════════════════════════════════════════════════ */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/** A string export, read from an ES module this CommonJS script cannot import. */
function readExport(rel, name) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const m = src.match(new RegExp(`export const ${name} = '([^']+)';`));
  if (!m) throw new Error(`brandIcons: no \`${name}\` in ${rel}`);
  return m[1];
}

const FRAME = readExport('src/app/components/brand/markPath.js', 'MARK_FRAME');
const STAR = readExport('src/app/components/brand/markPath.js', 'MARK_STAR');
const EVENTS = readExport('src/app/components/brand/wordmarkPath.js', 'WORDMARK_EVENTS');
const LI = readExport('src/app/components/brand/wordmarkPath.js', 'WORDMARK_LI');
const TAGLINE = readExport('src/app/lib/siteRoutes.js', 'TAGLINE');

// The brand guide's values (globals.css holds the same; test/logo.test.js pins them).
const TEAL = '#0d5b5e';
const BLACK = '#000000';
const INK = '#0b1617';
const MUTED = '#45585b';
const GREY = '#f2f4f5';

function mark(color) {
  return `<svg viewBox="0 0 512 500" xmlns="http://www.w3.org/2000/svg">`
    + `<path fill-rule="evenodd" d="${FRAME}" fill="${color}"/><path d="${STAR}" fill="${color}"/></svg>`;
}

/**
 * The full lockup in one coordinate space — the proportions `.es-logo` uses:
 * mark at 0.96 of the word height, gap 0.35, tagline under the word.
 */
function lockup({ markColor = TEAL, ink = BLACK, li = TEAL, tag = INK } = {}) {
  const markH = 97;
  const markW = (markH * 512) / 500;
  const wordX = markW + 34;
  const W = wordX + 458;
  return `<svg viewBox="0 0 ${W.toFixed(1)} 152" xmlns="http://www.w3.org/2000/svg">`
    + `<g transform="translate(0 2) scale(${(markH / 500).toFixed(4)})">`
    + `<path fill-rule="evenodd" d="${FRAME}" fill="${markColor}"/><path d="${STAR}" fill="${markColor}"/></g>`
    + `<g transform="translate(${(wordX - 269).toFixed(1)} -36)">`
    + `<path fill-rule="evenodd" d="${EVENTS}" fill="${ink}"/><path fill-rule="evenodd" d="${LI}" fill="${li}"/></g>`
    + `<text x="${(wordX + 16).toFixed(1)}" y="148" textLength="435" lengthAdjust="spacing" fill="${tag}"`
    + ` font-family="'DM Sans'" font-weight="500" font-size="31">${TAGLINE}</text></svg>`;
}

/** A teal tile with the white star — the guide's reversed mark. */
function tile(size, { radius = 0, markScale = 0.5 } = {}) {
  return `<div style="width:${size}px;height:${size}px;border-radius:${radius}px;background:${TEAL};display:grid;place-items:center">
    <div style="height:${Math.round(size * markScale)}px;aspect-ratio:512/500">${mark('#ffffff')}</div></div>`;
}

/**
 * The door scanner's icon: the star inside a scanner's corner brackets, so on
 * a tablet's home screen it reads as Eventsli AND as the thing that scans.
 * `safe` shrinks the drawing into Android's maskable safe zone (the inner 80%
 * circle), where a launcher may crop anything outside it.
 */
function gateTile(size, { radius = 0, safe = false } = {}) {
  const s = safe ? 0.78 : 1;
  const k = (v) => (v * s + (1 - s) * 256).toFixed(1);   // scale about the centre of a 512 box
  const corner = (d) => `<path d="${d}" fill="none" stroke="#ffffff" stroke-width="${(26 * s).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const brackets = [
    `M${k(112)} ${k(196)}V${k(140)}a${(28 * s).toFixed(1)} ${(28 * s).toFixed(1)} 0 0 1 ${(28 * s).toFixed(1)} -${(28 * s).toFixed(1)}H${k(196)}`,
    `M${k(316)} ${k(112)}H${k(372)}a${(28 * s).toFixed(1)} ${(28 * s).toFixed(1)} 0 0 1 ${(28 * s).toFixed(1)} ${(28 * s).toFixed(1)}V${k(196)}`,
    `M${k(400)} ${k(316)}V${k(372)}a${(28 * s).toFixed(1)} ${(28 * s).toFixed(1)} 0 0 1 -${(28 * s).toFixed(1)} ${(28 * s).toFixed(1)}H${k(316)}`,
    `M${k(196)} ${k(400)}H${k(140)}a${(28 * s).toFixed(1)} ${(28 * s).toFixed(1)} 0 0 1 -${(28 * s).toFixed(1)} -${(28 * s).toFixed(1)}V${k(316)}`,
  ].map(corner).join('');
  const m = 168 * s;   // the star's frame, inside the brackets
  return `<div style="width:${size}px;height:${size}px;border-radius:${radius}px;background:${TEAL};overflow:hidden">
    <svg viewBox="0 0 512 512" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">${brackets}
      <g transform="translate(${(256 - m / 2).toFixed(1)} ${(256 - (m * 500) / 512 / 2).toFixed(1)}) scale(${(m / 512).toFixed(4)})">
        <path fill-rule="evenodd" d="${FRAME}" fill="#ffffff"/><path d="${STAR}" fill="#ffffff"/></g></svg></div>`;
}

/**
 * The share card. White, like the site; the full-colour lockup and one plain
 * sentence on the left, and on the right the brand teal carrying a large white
 * star — the guide's business card, at 1200 × 630. Under the guide's teal top
 * bar. No photograph: this card stands behind every page that has none.
 */
function og() {
  return `<div style="position:relative;width:1200px;height:630px;background:#ffffff;font-family:'DM Sans';overflow:hidden">
    <div style="position:absolute;inset:0 0 auto 0;height:14px;background:${TEAL}"></div>
    <div style="position:absolute;left:88px;top:150px;width:640px;display:flex;flex-direction:column;gap:46px">
      <div style="width:560px">${lockup()}</div>
      <p style="margin:0;font-size:34px;line-height:1.35;font-weight:500;color:${INK};letter-spacing:-0.01em">
        Find events near you, pick your seat on the map, and arrive with your ticket on your phone.</p>
      <p style="margin:0;font-size:20px;font-weight:600;letter-spacing:0.14em;color:${MUTED}">CANADA · UNITED STATES</p>
    </div>
    <div style="position:absolute;right:0;top:14px;bottom:0;width:330px;background:${TEAL};display:grid;place-items:center;overflow:hidden">
      <div style="height:200px;aspect-ratio:512/500">${mark('#ffffff')}</div>
    </div>
    <div style="position:absolute;left:0;right:330px;bottom:0;height:10px;background:${GREY}"></div>
  </div>`;
}

const ASSETS = [
  // iOS rounds the corners itself, and the email masthead rounds them in CSS:
  // a square, full-bleed tile is what both expect.
  { out: 'src/app/apple-icon.png', w: 180, h: 180, html: tile(180, { markScale: 0.5 }) },
  { out: 'public/gate-icon-192.png', w: 192, h: 192, html: gateTile(192, { radius: 42 }), transparent: true },
  { out: 'public/gate-icon-512.png', w: 512, h: 512, html: gateTile(512, { radius: 112 }), transparent: true },
  { out: 'public/gate-icon-maskable-512.png', w: 512, h: 512, html: gateTile(512, { safe: true }) },
  { out: 'public/og-default.png', w: 1200, h: 630, html: og() },
];

/** DM Sans, embedded, so the render does not depend on a font being installed. */
async function dmSansFaceCss() {
  const css = await (await fetch(
    'https://fonts.googleapis.com/css2?family=DM+Sans:wght@500;600;700&display=block',
    { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0 Safari/537.36' } },
  )).text();
  // Google answers in one of two shapes depending on the user agent: faces split
  // by unicode subset under `/* latin */`-style comments, or one whole face per
  // weight with no comments at all. Keep the latin subset when there is one,
  // otherwise every face; then inline each file so the page makes no requests.
  const faces = css.match(/(\/\*\s*([\w-]+)\s*\*\/\s*)?@font-face\s*\{[^}]+\}/g) || [];
  const latin = faces.filter((f) => /\/\*\s*latin\s*\*\//.test(f));
  const chosen = latin.length ? latin : faces.filter((f) => !/\/\*/.test(f));
  if (chosen.length === 0) throw new Error(`brandIcons: no DM Sans @font-face in Google's reply:\n${css.slice(0, 300)}`);
  let out = '';
  for (const face of chosen) {
    const url = face.match(/url\((https:[^)]+)\)/)[1];
    const font = Buffer.from(await (await fetch(url)).arrayBuffer()).toString('base64');
    out += face.replace(/\/\*[\s\S]*?\*\//, '').replace(url, `data:font/woff2;base64,${font}`);
  }
  return out;
}

async function main() {
  // Not a dependency of the app: a dev-machine tool, see the header.
  const { chromium } = require('playwright');
  const faces = await dmSansFaceCss();
  const browser = await chromium.launch();
  try {
    for (const asset of ASSETS) {
      const page = await browser.newPage({ viewport: { width: asset.w, height: asset.h }, deviceScaleFactor: 1 });
      await page.setContent(`<!doctype html><html><head><style>${faces}
        html,body{margin:0;padding:0;background:transparent}</style></head><body>${asset.html}</body></html>`);
      await page.evaluate(() => document.fonts.ready);
      const file = path.join(ROOT, asset.out);
      await page.screenshot({ path: file, omitBackground: Boolean(asset.transparent), clip: { x: 0, y: 0, width: asset.w, height: asset.h } });
      await page.close();
      console.log(`brandIcons: wrote ${asset.out} (${asset.w}×${asset.h}, ${(fs.statSync(file).size / 1024).toFixed(1)} KB)`);
    }
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { lockup, mark, readExport };
