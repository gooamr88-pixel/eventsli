#!/usr/bin/env node
/**
 * Renders the scanner mark (scripts/brand-mark.js, the same drawing as
 * src/ui/ScannerMark.tsx) to the native splash image
 * assets/images/splash-icon.png: the rounded near-black tile with the yellow
 * E ticket in its scanner brackets, on transparent, shown on the white splash
 * before the app's own opening screen takes over.
 *
 *   node scripts/splash-icon.js
 *
 * Uses `sharp` from the repository's root node_modules (the website has it).
 */
const path = require('node:path');

const sharp = require('sharp');

const { scannerMarkSvg } = require('./brand-mark');

const SVG = scannerMarkSvg({ radius: 112 }).replace('<svg ', '<svg width="1024" height="1024" ');

const out = path.join(__dirname, '..', 'assets', 'images', 'splash-icon.png');
sharp(Buffer.from(SVG))
  .resize(1024, 1024)
  .png()
  .toFile(out)
  .then(() => console.log(`Wrote ${out}`))
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
