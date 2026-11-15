#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Renders every RASTER brand asset from the logo's vector source.
 *
 *   node scripts/brandIcons.js
 *
 * Writes:
 *   public/email-logo.png               the full lockup, 80px tall, for the email masthead
 *   src/app/apple-icon.png              180 × 180  home screen
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
 * paths as the site's logo (`components/brand/markPath.js`, `wordmarkPath.js`),
 * read out of those files, so re-running this is the whole of "update the
 * icons".
 *
 * REDRAWN 2026-11-15 for the white / yellow / coral identity: the tiles are the
 * sheet's near-black with the full-colour yellow ticket on them, and the share
 * card is the homepage concept's hero in miniature.
 *
 * NEEDS Playwright (`playwright`, or `playwright-core` driving the installed
 * Chrome) and network access to Google Fonts, which supplies Urbanist and
 * DM Sans for the share card. Not part of `npm run check` for that reason.
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
const INITIAL = readExport('src/app/components/brand/markPath.js', 'MARK_INITIAL');
const MARK_VB = readExport('src/app/components/brand/markPath.js', 'MARK_VIEWBOX');
const EVENTS = readExport('src/app/components/brand/wordmarkPath.js', 'WORDMARK_EVENTS');
const LI = readExport('src/app/components/brand/wordmarkPath.js', 'WORDMARK_LI');
const WORD_VB = readExport('src/app/components/brand/wordmarkPath.js', 'WORDMARK_VIEWBOX');
const SPARK = readExport('src/app/components/brand/wordmarkPath.js', 'WORDMARK_SPARK');
const GAP = Number(readExport('src/app/components/brand/wordmarkPath.js', 'LOGO_GAP'));

// The brand sheet's values (globals.css holds the same; test/logo.test.jsx pins them).
const YELLOW = '#ffcc00';
const CORAL = '#ff414b';
const CTA = '#d61f2c';          // the text-safe coral, --es-accent
const INK = '#111018';
const MUTED = '#4a4a55';

const [, , MW, MH] = MARK_VB.split(' ').map(Number);

/** The E-ticket alone: yellow, its E near-black. */
function mark({ ticket = YELLOW, initial = INK } = {}) {
  return `<svg viewBox="${MARK_VB}" xmlns="http://www.w3.org/2000/svg" style="display:block;width:100%;height:100%">`
    + `<path d="${FRAME}" fill="${ticket}"/><path d="${INITIAL}" fill="${initial}"/></svg>`;
}

/** The E card + the word as `.es-logo` draws them: the same height, LOGO_GAP apart. */
function lockup({ ink = INK, height = 60 } = {}) {
  return `<div style="display:flex;align-items:center;gap:${height * GAP}px">`
    + `<div style="height:${height}px;width:${(height * MW) / MH}px">${mark()}</div>`
    + `<svg viewBox="${WORD_VB}" style="height:${height}px" xmlns="http://www.w3.org/2000/svg">`
    + `<path d="${EVENTS}" fill="${ink}"/><path d="${LI}" fill="${ink}"/><path d="${SPARK}" fill="${YELLOW}"/></svg></div>`;
}

/** The app tile: the full-colour E-ticket on the near-black. */
function tile(size, { radius = 0, markScale = 0.62 } = {}) {
  const w = Math.round(size * markScale);
  return `<div style="width:${size}px;height:${size}px;border-radius:${radius}px;background:${INK};display:grid;place-items:center">
    <div style="width:${w}px;height:${(w * MH) / MW}px">${mark()}</div></div>`;
}

/**
 * The door scanner's icon: the ticket inside a scanner's corner brackets, so
 * on a tablet's home screen it reads as Eventsli AND as the thing that scans.
 * `safe` shrinks the drawing into Android's maskable safe zone (the inner 80%
 * circle), where a launcher may crop anything outside it.
 */
function gateTile(size, { radius = 0, safe = false } = {}) {
  const s = safe ? 0.78 : 1;
  const k = (v) => (v * s + (1 - s) * 256).toFixed(1);
  const q = (28 * s).toFixed(1);
  const corner = (d) => `<path d="${d}" fill="none" stroke="${YELLOW}" stroke-width="${(26 * s).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const brackets = [
    `M${k(112)} ${k(196)}V${k(140)}a${q} ${q} 0 0 1 ${q} -${q}H${k(196)}`,
    `M${k(316)} ${k(112)}H${k(372)}a${q} ${q} 0 0 1 ${q} ${q}V${k(196)}`,
    `M${k(400)} ${k(316)}V${k(372)}a${q} ${q} 0 0 1 -${q} ${q}H${k(316)}`,
    `M${k(196)} ${k(400)}H${k(140)}a${q} ${q} 0 0 1 -${q} -${q}V${k(316)}`,
  ].map(corner).join('');
  // Centred on the CARD, not on the viewBox: the mark's viewBox starts at
  // y = -121 and is as tall as the word, so placing it by its box put the
  // ticket high, over the top brackets (fixed 2026-11-15). The card itself is
  // 119 wide, centred at (59.5, -39.5). mobile/scripts/brand-mark.js draws the
  // app's icon with the same geometry.
  const m = 176 * s;
  return `<div style="width:${size}px;height:${size}px;border-radius:${radius}px;background:${INK};overflow:hidden">
    <svg viewBox="0 0 512 512" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">${brackets}
      <g transform="translate(256 256) scale(${(m / 119).toFixed(4)}) translate(-59.5 39.5)">
        <path d="${FRAME}" fill="${YELLOW}"/><path d="${INITIAL}" fill="${INK}"/></g></svg></div>`;
}

/**
 * The share card: the homepage concept's hero in miniature. White, the
 * lockup, "Discover Events." over a yellow-highlighted "Make Memories.", one
 * sentence, a coral button; on the right the slanted yellow and coral panels
 * the concept's photo collage sits in, carrying a large ticket. No photograph:
 * this card stands behind every page that has none.
 */
function og() {
  return `<div style="position:relative;width:1200px;height:630px;background:#ffffff;font-family:'DM Sans';overflow:hidden">
    <div style="position:absolute;left:84px;top:70px">${lockup({ height: 64 })}</div>
    <div style="position:absolute;left:84px;top:190px;width:680px;font-family:Urbanist;font-weight:900;font-size:68px;line-height:1.1;color:${INK};letter-spacing:-0.01em">
      <div>Discover Events.</div>
      <div><span style="display:inline-block;background:${YELLOW};border-radius:14px;padding:0 18px;margin-left:-18px;transform:skewX(-6deg)"><span style="display:inline-block;transform:skewX(6deg)">Make Memories.</span></span></div>
    </div>
    <p style="position:absolute;left:84px;top:380px;width:560px;margin:0;font-size:28px;line-height:1.4;font-weight:500;color:${MUTED}">
      Find events near you, pick your seat on the map, and arrive with your ticket on your phone.</p>
    <div style="position:absolute;left:84px;top:505px;display:inline-flex;align-items:center;gap:12px;padding:16px 30px;border-radius:999px;background:${CTA};color:#ffffff;font-weight:700;font-size:24px">Explore events &rarr;</div>
    <div style="position:absolute;right:-70px;top:-40px;width:430px;height:430px;background:${YELLOW};border-radius:44px;transform:skewX(-14deg)"></div>
    <div style="position:absolute;right:-50px;bottom:-70px;width:360px;height:270px;background:${CORAL};border-radius:44px;transform:skewX(-14deg)"></div>
    <div style="position:absolute;right:110px;top:200px;width:290px;height:${(290 * MH) / MW}px;filter:drop-shadow(0 18px 30px rgba(17,16,24,.25))">${mark({ ticket: '#ffffff', initial: INK })}</div>
  </div>`;
}

/**
 * The email masthead's logo: the full lockup, at twice the size it is shown
 * (40px tall) so it is sharp on a phone. On white rather than transparent —
 * a mail client that darkens the page would otherwise put near-black letters
 * on near-black. Email cannot use the SVG (Gmail and Outlook drop it), so this
 * PNG is the only way the real wordmark — Urbanist, the spark — reaches an
 * inbox. The masthead keeps the name as the image's alt text for the clients
 * that block images.
 */
const EMAIL_LOGO_H = 80;
const [, , WW, WH] = WORD_VB.split(' ').map(Number);
const EMAIL_LOGO_W = Math.ceil(EMAIL_LOGO_H * (MW / MH + GAP + WW / WH)) + 4;
function emailLogo() {
  return `<div style="width:${EMAIL_LOGO_W}px;height:${EMAIL_LOGO_H}px;background:#ffffff;display:flex;align-items:center;justify-content:center">${lockup({ height: EMAIL_LOGO_H })}</div>`;
}

const ASSETS = [
  { out: 'public/email-logo.png', w: EMAIL_LOGO_W, h: EMAIL_LOGO_H, html: emailLogo() },
  // iOS rounds the corners itself, and the email masthead rounds them in CSS:
  // a square, full-bleed tile is what both expect.
  { out: 'src/app/apple-icon.png', w: 180, h: 180, html: tile(180) },
  { out: 'public/gate-icon-192.png', w: 192, h: 192, html: gateTile(192, { radius: 42 }), transparent: true },
  { out: 'public/gate-icon-512.png', w: 512, h: 512, html: gateTile(512, { radius: 112 }), transparent: true },
  { out: 'public/gate-icon-maskable-512.png', w: 512, h: 512, html: gateTile(512, { safe: true }) },
  { out: 'public/og-default.png', w: 1200, h: 630, html: og() },
];

/** Google Fonts faces, embedded, so the render does not depend on an install. */
async function faceCss(query) {
  const css = await (await fetch(
    `https://fonts.googleapis.com/css2?${query}&display=block`,
    { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0 Safari/537.36' } },
  )).text();
  // Google answers in one of two shapes depending on the user agent: faces split
  // by unicode subset under `/* latin */`-style comments, or one whole face per
  // weight with no comments at all. Keep the latin subset when there is one,
  // otherwise every face; then inline each file so the page makes no requests.
  const faces = css.match(/(\/\*\s*([\w-]+)\s*\*\/\s*)?@font-face\s*\{[^}]+\}/g) || [];
  const latin = faces.filter((f) => /\/\*\s*latin\s*\*\//.test(f));
  const chosen = latin.length ? latin : faces.filter((f) => !/\/\*/.test(f));
  if (chosen.length === 0) throw new Error(`brandIcons: no @font-face in Google's reply:\n${css.slice(0, 300)}`);
  let out = '';
  for (const face of chosen) {
    const url = face.match(/url\((https:[^)]+)\)/)[1];
    const font = Buffer.from(await (await fetch(url)).arrayBuffer()).toString('base64');
    out += face.replace(/\/\*[\s\S]*?\*\//, '').replace(url, `data:font/woff2;base64,${font}`);
  }
  return out;
}

/** Playwright if it is installed; otherwise playwright-core driving Chrome. */
async function launch() {
  try {
    return await require('playwright').chromium.launch();
  } catch {
    return require('playwright-core').chromium.launch({ channel: 'chrome' });
  }
}

async function main() {
  const faces = (await faceCss('family=DM+Sans:wght@500;600;700'))
    + (await faceCss('family=Urbanist:wght@900'));
  const browser = await launch();
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

module.exports = { lockup, mark, tile, readExport, launch };
