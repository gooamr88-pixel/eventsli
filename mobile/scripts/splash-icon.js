#!/usr/bin/env node
/**
 * Renders the scanner mark (src/ui/ScannerMark.tsx) to the native splash image
 * assets/images/splash-icon.png: teal on transparent, shown on the white
 * splash before the app's own opening screen takes over.
 *
 *   node scripts/splash-icon.js
 *
 * Uses `sharp` from the repository's root node_modules (the website has it).
 * Keep the drawing in step with SCANNER_MARK_SVG.
 */
const path = require('node:path');

const sharp = require('sharp');

const SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="1024" height="1024">
  <rect x="0" y="0" width="100" height="100" rx="24" fill="#0d5b5e"/>
  <rect x="27" y="27" width="46" height="46" rx="11" fill="none" stroke="#ffffff" stroke-width="10"/>
</svg>`;

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
