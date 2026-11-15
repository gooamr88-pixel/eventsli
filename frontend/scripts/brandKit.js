#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Builds the logo kit in docs/brand: the logo in every version the brand needs,
 * as SVG (tagline OUTLINED) and PNG, for printers and the agency.
 *
 *   npm install --no-save opentype.js@1.3.4    # once; not an app dependency
 *   node scripts/brandKit.js
 *
 * The tagline is converted to paths with DM Sans (fetched from Google Fonts),
 * because a print shop opening an SVG without the font installed would
 * otherwise get its own fallback letters under the wordmark. Everything else
 * is the website's own geometry, read out of the files the logo is drawn from,
 * so the kit cannot disagree with the site. Needs Playwright (or
 * playwright-core and an installed Chrome), as scripts/brandIcons.js does.
 *
 * THE WHITE / YELLOW / CORAL BRAND, 2026-11-15: the E-ticket (a yellow ticket
 * with a near-black E) and "Eventsli" in Nunito Black, near-black. The
 * ticket stays yellow in every colour version except one-colour print, where
 * the E is knocked out of a near-black ticket.
 * ═══════════════════════════════════════════════════════════════════════════ */
const fs = require('node:fs');
const path = require('node:path');
const opentype = require('opentype.js');
const { launch } = require('./brandIcons');

const REPO = path.join(__dirname, '..', '..');
const OUT = path.join(REPO, 'docs', 'brand');
fs.mkdirSync(OUT, { recursive: true });

const readExport = (rel, name) => {
  const src = fs.readFileSync(path.join(REPO, 'frontend', rel), 'utf8');
  return src.match(new RegExp(`export const ${name} = '([^']+)';`))[1];
};
const FRAME = readExport('src/app/components/brand/markPath.js', 'MARK_FRAME');
const INITIAL = readExport('src/app/components/brand/markPath.js', 'MARK_INITIAL');
const MARK_VB = readExport('src/app/components/brand/markPath.js', 'MARK_VIEWBOX');
const EVENTS = readExport('src/app/components/brand/wordmarkPath.js', 'WORDMARK_EVENTS');
const LI = readExport('src/app/components/brand/wordmarkPath.js', 'WORDMARK_LI');
const WORD_VB = readExport('src/app/components/brand/wordmarkPath.js', 'WORDMARK_VIEWBOX');
const TAGLINE = readExport('src/app/lib/siteRoutes.js', 'TAGLINE');

const YELLOW = '#FFCC00';
const INK = '#111018';
const WHITE = '#FFFFFF';

const [, , MW, MH] = MARK_VB.split(' ').map(Number);
const [WX, WY, WW, WH] = WORD_VB.split(' ').map(Number);

async function dmSans600() {
  // An unknown user agent gets TrueType, which opentype.js reads directly.
  const css = await (await fetch('https://fonts.googleapis.com/css2?family=DM+Sans:wght@600', { headers: { 'user-agent': 'curl/8.0' } })).text();
  const url = css.match(/url\((https:[^)]+)\)/)[1];
  return opentype.parse(await (await fetch(url)).arrayBuffer());
}

/** The tagline as one outlined path, spaced to `length` the way SVG's
 *  textLength + lengthAdjust="spacing" spaces it on the site. */
function taglinePath(font, x0, baseline, size, length) {
  const glyphs = font.stringToGlyphs(TAGLINE);
  const scale = size / font.unitsPerEm;
  let natural = 0;
  glyphs.forEach((g, i) => {
    natural += g.advanceWidth * scale;
    if (i < glyphs.length - 1) natural += font.getKerningValue(g, glyphs[i + 1]) * scale;
  });
  const extra = (length - natural) / glyphs.length;
  let x = x0;
  let d = '';
  glyphs.forEach((g, i) => {
    d += g.getPath(x, baseline, size).toPathData(2);
    x += g.advanceWidth * scale + extra;
    if (i < glyphs.length - 1) x += font.getKerningValue(g, glyphs[i + 1]) * scale;
  });
  return d;
}

/**
 * Ticket + word, in the website's proportions (`.es-logo`): the ticket is 1.2 of
 * the word's height, the gap 0.3 of it, the tagline under the word.
 */
function lockupSvg(font, { ticket, initial, ink, tag, tagline = true, label }) {
  const k = 1;                          // the word at its own units
  const tH = WH * 1.3;
  const tW = (tH * MW) / MH;
  const gap = WH * 0.38;
  const wordX = tW + gap;
  const H = tagline ? WH + 51 : tH;
  const W = +(wordX + WW).toFixed(1);
  const markY = tagline ? (WH - tH) / 2 : 0;
  const wordY = tagline ? 0 : (tH - WH) / 2;
  const tg = tagline
    ? `\n  <path d="${taglinePath(font, wordX + 6, WH + 47, 30, Math.round(WW * 0.95))}" fill="${tag}"/>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Eventsli — ${label}. Generated from the product's logo source; do not edit by hand. -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 ${Math.min(0, markY).toFixed(1)} ${W} ${(H - Math.min(0, markY)).toFixed(1)}" width="${W * 4}" height="${((H - Math.min(0, markY)) * 4).toFixed(0)}">
  <title>Eventsli</title>
  <g transform="translate(0 ${markY.toFixed(2)}) scale(${(tH / MH).toFixed(4)})">
    <path d="${FRAME}" fill="${ticket}"/>
    <path d="${INITIAL}" fill="${initial}"/>
  </g>
  <g transform="translate(${(wordX - WX * k).toFixed(1)} ${(wordY - WY).toFixed(1)})">
    <path d="${EVENTS}" fill="${ink}"/>
    <path d="${LI}" fill="${ink}"/>
  </g>${tg}
</svg>
`;
}

function markSvg({ ticket, initial }, label) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Eventsli — ${label}. Generated from the product's logo source; do not edit by hand. -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MARK_VB}" width="${MW * 2}" height="${MH * 2}">
  <title>Eventsli</title>
  <path d="${FRAME}" fill="${ticket}"/>
  <path d="${INITIAL}" fill="${initial}"/>
</svg>
`;
}

function appIconSvg() {
  const w = 1024 * 0.62;
  const h = (w * MH) / MW;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Eventsli — app icon (the E-ticket on near-black). Generated from the product's logo source. -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <title>Eventsli</title>
  <rect width="1024" height="1024" fill="${INK}"/>
  <g transform="translate(${((1024 - w) / 2).toFixed(1)} ${((1024 - h) / 2).toFixed(1)}) scale(${(w / MW).toFixed(4)})">
    <path d="${FRAME}" fill="${YELLOW}"/>
    <path d="${INITIAL}" fill="${INK}"/>
  </g>
</svg>
`;
}

(async () => {
  const font = await dmSans600();
  const files = {
    'eventsli-logo-full-colour.svg': lockupSvg(font, { ticket: YELLOW, initial: INK, ink: INK, tag: INK, label: 'primary logo, full colour, with tagline' }),
    'eventsli-logo-full-colour-no-tagline.svg': lockupSvg(font, { ticket: YELLOW, initial: INK, ink: INK, tagline: false, label: 'primary logo, full colour' }),
    'eventsli-logo-black.svg': lockupSvg(font, { ticket: INK, initial: WHITE, ink: INK, tag: INK, label: 'one colour (near-black), with tagline' }),
    'eventsli-logo-white.svg': lockupSvg(font, { ticket: YELLOW, initial: INK, ink: WHITE, tag: WHITE, label: 'reversed (white word, yellow ticket), with tagline — for dark grounds and photographs' }),
    'eventsli-mark.svg': markSvg({ ticket: YELLOW, initial: INK }, 'mark, full colour'),
    'eventsli-mark-black.svg': markSvg({ ticket: INK, initial: WHITE }, 'mark, one colour'),
    'eventsli-app-icon.svg': appIconSvg(),
  };
  for (const [name, svg] of Object.entries(files)) {
    fs.writeFileSync(path.join(OUT, name), svg);
    console.log('svg', name, `${(svg.length / 1024).toFixed(1)}KB`);
  }

  const browser = await launch();
  const pngs = [
    ['eventsli-logo-full-colour.svg', 2400],
    ['eventsli-logo-white.svg', 2400],
    ['eventsli-logo-black.svg', 2400],
    ['eventsli-app-icon.svg', 1024],
  ];
  for (const [svgName, width] of pngs) {
    const svg = files[svgName].replace(/<\?xml[^>]*>\s*/, '').replace(/<!--[\s\S]*?-->\s*/, '');
    const vb = svg.match(/viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/);
    const height = Math.round((width * Number(vb[2])) / Number(vb[1]));
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace(/width="[\d.]+" height="[\d.]+"/, `width="${width}" height="${height}"`)}</body></html>`);
    const out = svgName.replace('.svg', '.png');
    await page.screenshot({ path: path.join(OUT, out), omitBackground: true, clip: { x: 0, y: 0, width, height } });
    await page.close();
    console.log('png', out, `${width}x${height}`);
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
