#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * The logo files ORGANIZERS download (owner, 2026-11-17), served from
 * frontend/public/brand and offered on the event's cover screen.
 *
 *   node scripts/brandDownloads.js
 *
 * Built FROM docs/brand (scripts/brandKit.js), never drawn here, so they
 * cannot disagree with the website or the printers' kit:
 *
 *   copied as-is   the full-colour, white and black logos (SVG + PNG), the
 *                  no-tagline logo and the E mark (SVG)
 *   derived        a WHITE logo with no tagline — the one most covers need
 *                  (a photo or a dark poster, at a size where the tagline is
 *                  unreadable). It is the full-colour no-tagline file with the
 *                  word's two shapes painted white, exactly as the kit's own
 *                  white logo is the full-colour one with its word white.
 *   rendered       PNGs of the no-tagline logos (2400px wide) and the mark
 *                  (1024px tall), transparent, for anyone without an SVG tool
 *
 * Then a zip of the lot, with the kit's README, as one "download everything".
 * Uses `sharp` (installed with Next) and the system `tar` (Windows 10+ and
 * macOS write zips with `-a`; on Linux install `zip` and change one line).
 * ═══════════════════════════════════════════════════════════════════════════ */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const sharp = require('sharp');

const REPO = path.join(__dirname, '..', '..');
const KIT = path.join(REPO, 'docs', 'brand');
const OUT = path.join(REPO, 'frontend', 'public', 'brand');
fs.mkdirSync(OUT, { recursive: true });

const COPY = [
  'eventsli-logo-full-colour.svg', 'eventsli-logo-full-colour.png',
  'eventsli-logo-white.svg', 'eventsli-logo-white.png',
  'eventsli-logo-black.svg', 'eventsli-logo-black.png',
  'eventsli-logo-full-colour-no-tagline.svg',
  'eventsli-mark.svg',
];
for (const f of COPY) fs.copyFileSync(path.join(KIT, f), path.join(OUT, f));

// The white no-tagline logo: paths are card, E, "events", "li", spark — the
// word is the third and fourth. Refused if the source ever changes shape.
const colour = fs.readFileSync(path.join(KIT, 'eventsli-logo-full-colour-no-tagline.svg'), 'utf8');
let index = 0;
const white = colour
  .replace(/<path d="[^"]+" fill="([^"]+)"\/>/g, (whole) => {
    index += 1;
    return index === 3 || index === 4 ? whole.replace(/fill="#111018"/, 'fill="#FFFFFF"') : whole;
  })
  .replace('primary logo, full colour', 'logo, white, no tagline');
if (index !== 5 || !/fill="#FFFFFF"[\s\S]*fill="#FFFFFF"/.test(white)) {
  throw new Error(`unexpected no-tagline logo (${index} paths) — regenerate docs/brand and check this script`);
}
fs.writeFileSync(path.join(OUT, 'eventsli-logo-white-no-tagline.svg'), white);

(async () => {
  const png = (svg, out, opts) => sharp(Buffer.from(svg), { density: 600 }).resize(opts).png().toFile(path.join(OUT, out));
  await png(colour, 'eventsli-logo-full-colour-no-tagline.png', { width: 2400 });
  await png(white, 'eventsli-logo-white-no-tagline.png', { width: 2400 });
  await png(fs.readFileSync(path.join(KIT, 'eventsli-mark.svg'), 'utf8'), 'eventsli-mark.png', { height: 1024 });

  fs.copyFileSync(path.join(KIT, 'README.md'), path.join(OUT, 'README.md'));
  const zip = path.join(OUT, 'eventsli-logo-kit.zip');
  fs.rmSync(zip, { force: true });
  const files = fs.readdirSync(OUT).filter((f) => f !== 'eventsli-logo-kit.zip');
  execFileSync('tar', ['-a', '-c', '-f', 'eventsli-logo-kit.zip', ...files], { cwd: OUT });
  fs.rmSync(path.join(OUT, 'README.md'));
  console.log(`brand downloads written to ${path.relative(REPO, OUT)}: ${fs.readdirSync(OUT).join(', ')}`);
})().catch((err) => { console.error(err); process.exit(1); });
