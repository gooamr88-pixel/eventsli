#!/usr/bin/env node
/**
 * The app's icons, drawn from the scanner mark (scripts/brand-mark.js, the
 * same drawing as src/ui/ScannerMark.tsx): the brand's yellow E ticket inside
 * yellow scanner brackets on the near-black — the website's door-scanner
 * icon (2026-11-15; it was an empty yellow frame before the logo became the
 * E ticket).
 *
 *   node scripts/app-icons.js
 *
 * Writes into assets/images/:
 *   icon.png                     iOS / store icon, 1024², full-bleed near-black, NO
 *                                alpha (Apple rejects a transparent icon; iOS
 *                                rounds the corners itself)
 *   android-icon-foreground.png  adaptive icon layer, 1024² transparent; the
 *                                near-black comes from adaptiveIcon.backgroundColor
 *   android-icon-monochrome.png  Android 13+ themed icon (alpha only: the E is
 *                                cut out of the ticket)
 *   favicon.png                  48², for the web build
 *
 * Uses `sharp` from the repository's root node_modules (the website has it).
 */
const path = require('node:path');

const sharp = require('sharp');

const { scannerMarkSvg } = require('./brand-mark');

const TILE = '#111018';
const OUT = path.join(__dirname, '..', 'assets', 'images');
// Android shows only the middle 72/108 of an adaptive icon's layer.
const ADAPTIVE = 72 / 108;
const svg = (markup) => Buffer.from(markup.replace('<svg ', '<svg width="1024" height="1024" '));

const jobs = [
  {
    file: 'icon.png',
    image: () => sharp(svg(scannerMarkSvg({ radius: 0 }))).resize(1024, 1024).flatten({ background: TILE }).removeAlpha().png(),
  },
  {
    file: 'android-icon-foreground.png',
    image: () => sharp(svg(scannerMarkSvg({ tile: null, scale: ADAPTIVE }))).resize(1024, 1024).png(),
  },
  {
    file: 'android-icon-monochrome.png',
    image: () => sharp(svg(scannerMarkSvg({ tile: null, scale: ADAPTIVE, brackets: '#ffffff', ticket: '#ffffff', solid: true }))).resize(1024, 1024).png(),
  },
  {
    file: 'favicon.png',
    image: () => sharp(svg(scannerMarkSvg({ radius: 112 }))).resize(48, 48).png(),
  },
];

(async () => {
  for (const job of jobs) {
    const out = path.join(OUT, job.file);
    await job.image().toFile(out);
    console.log(`Wrote ${out}`);
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
