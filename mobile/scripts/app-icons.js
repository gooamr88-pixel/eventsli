#!/usr/bin/env node
/**
 * The app's icons, drawn from the scanner mark (src/ui/ScannerMark.tsx,
 * SCANNER_MARK_SVG): a white rounded-square frame on teal. Owner's choice,
 * 2026-11-14, replacing the old star mark so the home-screen icon matches the
 * splash and the sign-in screen.
 *
 *   node scripts/app-icons.js
 *
 * Writes into assets/images/:
 *   icon.png                     iOS / store icon, 1024², full-bleed teal, NO
 *                                alpha (Apple rejects a transparent icon; iOS
 *                                rounds the corners itself)
 *   android-icon-foreground.png  adaptive icon layer, 1024² transparent; the
 *                                teal comes from adaptiveIcon.backgroundColor
 *   android-icon-monochrome.png  Android 13+ themed icon (alpha only)
 *   favicon.png                  48², for the web build
 *
 * Uses `sharp` from the repository's root node_modules (the website has it).
 * Keep the drawing in step with SCANNER_MARK_SVG and scripts/splash-icon.js.
 */
const path = require('node:path');

const sharp = require('sharp');

const TEAL = '#0d5b5e';
const OUT = path.join(__dirname, '..', 'assets', 'images');

// The mark's frame in a 100-unit box: 46 wide at 27..73, stroke 10, corner 11.
// `scale` shrinks it about the centre (Android shows only the middle 72/108
// of an adaptive icon, so the frame is drawn smaller there to look the same).
function frame(scale, colour) {
  const size = 46 * scale;
  const at = 50 - size / 2;
  return `<rect x="${at}" y="${at}" width="${size}" height="${size}" rx="${11 * scale}" fill="none" stroke="${colour}" stroke-width="${10 * scale}"/>`;
}

const svg = (body, background = '') => Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="1024" height="1024">${background}${body}</svg>`,
);

const ADAPTIVE = 72 / 108;

const jobs = [
  {
    file: 'icon.png',
    image: () => sharp(svg(frame(1, '#ffffff'), `<rect width="100" height="100" fill="${TEAL}"/>`))
      .resize(1024, 1024).flatten({ background: TEAL }).removeAlpha().png(),
  },
  {
    file: 'android-icon-foreground.png',
    image: () => sharp(svg(frame(ADAPTIVE, '#ffffff'))).resize(1024, 1024).png(),
  },
  {
    file: 'android-icon-monochrome.png',
    image: () => sharp(svg(frame(ADAPTIVE, '#ffffff'))).resize(1024, 1024).png(),
  },
  {
    file: 'favicon.png',
    image: () => sharp(svg(
      `<rect width="100" height="100" rx="24" fill="${TEAL}"/>${frame(1, '#ffffff')}`,
    )).resize(48, 48).png(),
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
