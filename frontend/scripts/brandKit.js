#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Builds the logo kit in docs/brand: the logo in every version the brand guide
 * names, as SVG (tagline OUTLINED) and PNG, for printers and the agency.
 *
 *   npm install --no-save opentype.js@1.3.4    # once; not an app dependency
 *   node scripts/brandKit.js
 *
 * The tagline is converted to paths with DM Sans (fetched from Google Fonts),
 * because a print shop opening an SVG without the font installed would
 * otherwise get its own fallback letters under the wordmark. Everything else
 * is the website's own geometry, read out of the files the logo is drawn from,
 * so the kit cannot disagree with the site. Needs Playwright, as
 * scripts/brandIcons.js does.
 * ═══════════════════════════════════════════════════════════════════════════ */
const fs = require('node:fs');
const path = require('node:path');
const opentype = require('opentype.js');

const REPO = path.join(__dirname, '..', '..');
const OUT = path.join(REPO, 'docs', 'brand');
fs.mkdirSync(OUT, { recursive: true });

const readExport = (rel, name) => {
  const src = fs.readFileSync(path.join(REPO, 'frontend', rel), 'utf8');
  return src.match(new RegExp(`export const ${name} = '([^']+)';`))[1];
};
const FRAME = readExport('src/app/components/brand/markPath.js', 'MARK_FRAME');
const STAR = readExport('src/app/components/brand/markPath.js', 'MARK_STAR');
const EVENTS = readExport('src/app/components/brand/wordmarkPath.js', 'WORDMARK_EVENTS');
const LI = readExport('src/app/components/brand/wordmarkPath.js', 'WORDMARK_LI');
const TAGLINE = readExport('src/app/lib/siteRoutes.js', 'TAGLINE');

const TEAL = '#0D5B5E';
const BLACK = '#000000';
const WHITE = '#FFFFFF';

async function dmSans500() {
  // An unknown user agent gets TrueType, which opentype.js reads directly.
  const css = await (await fetch('https://fonts.googleapis.com/css2?family=DM+Sans:wght@500', { headers: { 'user-agent': 'curl/8.0' } })).text();
  const url = css.match(/url\((https:[^)]+)\)/)[1];
  const buf = await (await fetch(url)).arrayBuffer();
  return opentype.parse(buf);
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

function lockupSvg(font, { mark, ink, li, tag, tagline = true, label }) {
  const markH = 97;
  const markW = (markH * 512) / 500;
  const wordX = markW + 34;
  const W = +(wordX + 458).toFixed(1);
  const H = tagline ? 152 : 101;
  const tg = tagline ? `\n  <path d="${taglinePath(font, wordX + 16, 148, 31, 435)}" fill="${tag}"/>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Eventsli — ${label}. Generated from the product's logo source; do not edit by hand. -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W * 4}" height="${H * 4}">
  <title>Eventsli</title>
  <g transform="translate(0 2) scale(${(markH / 500).toFixed(4)})">
    <path fill-rule="evenodd" d="${FRAME}" fill="${mark}"/>
    <path d="${STAR}" fill="${mark}"/>
  </g>
  <g transform="translate(${(wordX - 269).toFixed(1)} -36)">
    <path fill-rule="evenodd" d="${EVENTS}" fill="${ink}"/>
    <path fill-rule="evenodd" d="${LI}" fill="${li}"/>
  </g>${tg}
</svg>
`;
}

function markSvg(color, label) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Eventsli — ${label}. Generated from the product's logo source; do not edit by hand. -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 500" width="1024" height="1000">
  <title>Eventsli</title>
  <path fill-rule="evenodd" d="${FRAME}" fill="${color}"/>
  <path d="${STAR}" fill="${color}"/>
</svg>
`;
}

function appIconSvg() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Eventsli — app icon (reversed mark on teal). Generated from the product's logo source. -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <title>Eventsli</title>
  <rect width="1024" height="1024" fill="${TEAL}"/>
  <g transform="translate(250 256) scale(1.0234)">
    <path fill-rule="evenodd" d="${FRAME}" fill="${WHITE}"/>
    <path d="${STAR}" fill="${WHITE}"/>
  </g>
</svg>
`;
}

(async () => {
  const font = await dmSans500();
  const files = {
    'eventsli-logo-full-colour.svg': lockupSvg(font, { mark: TEAL, ink: BLACK, li: TEAL, tag: BLACK, label: 'primary logo, full colour, with tagline' }),
    'eventsli-logo-full-colour-no-tagline.svg': lockupSvg(font, { mark: TEAL, ink: BLACK, li: TEAL, tagline: false, label: 'primary logo, full colour' }),
    'eventsli-logo-black.svg': lockupSvg(font, { mark: BLACK, ink: BLACK, li: BLACK, tag: BLACK, label: 'monochrome (black), with tagline' }),
    'eventsli-logo-white.svg': lockupSvg(font, { mark: WHITE, ink: WHITE, li: WHITE, tag: WHITE, label: 'reversed (white), with tagline — for teal or dark grounds' }),
    'eventsli-mark-teal.svg': markSvg(TEAL, 'mark, teal'),
    'eventsli-mark-white.svg': markSvg(WHITE, 'mark, white — for teal or dark grounds'),
    'eventsli-app-icon.svg': appIconSvg(),
  };
  for (const [name, svg] of Object.entries(files)) {
    fs.writeFileSync(path.join(OUT, name), svg);
    console.log('svg', name, (svg.length / 1024).toFixed(1) + 'KB');
  }

  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const pngs = [
    ['eventsli-logo-full-colour.svg', 2400, false],
    ['eventsli-logo-white.svg', 2400, true],
    ['eventsli-logo-black.svg', 2400, false],
    ['eventsli-app-icon.svg', 1024, false],
  ];
  for (const [svgName, width, onTeal] of pngs) {
    const svg = files[svgName].replace(/<\?xml[^>]*>\s*/, '').replace(/<!--[\s\S]*?-->\s*/, '');
    const vb = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
    const height = Math.round((width * Number(vb[2])) / Number(vb[1]));
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace(/width="[\d.]+" height="[\d.]+"/, `width="${width}" height="${height}"`)}</body></html>`);
    const out = svgName.replace('.svg', '.png');
    await page.screenshot({ path: path.join(OUT, out), omitBackground: true, clip: { x: 0, y: 0, width, height } });
    await page.close();
    console.log('png', out, `${width}x${height}`, onTeal ? '(transparent, white artwork)' : '');
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
