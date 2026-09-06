#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * `!important`, and the two places it is allowed to appear.
 *
 * The platform this design system was ported from accumulated 366 of them
 * across nine stylesheets. None of them was a decision — each was the fastest
 * way past a specificity fight, and together they made the cascade
 * unreadable: the only way to find out which rule won was to open devtools.
 *
 * So the rule is zero. But a flat "zero" written into a check would be wrong
 * twice over, and both exceptions are argued rather than grandfathered:
 *
 *   1. `prefers-reduced-motion`. WCAG 2.3.3. The whole point of that block is
 *      to beat every animation declared anywhere, including inline styles and
 *      third-party CSS. Without `!important` it beats nothing, and the person
 *      it exists for — somebody with a vestibular disorder who has told their
 *      OS to stop moving things — gets the animations anyway. Deleting these
 *      four to satisfy a line count would be an accessibility regression
 *      dressed as a cleanup.
 *
 *   2. `.fx-debug-overflow`. A devtools handle, never applied by the app. It
 *      lifts the overflow guard on <html> so whatever is pushing the page
 *      sideways becomes visible. It has to beat the guard; that is its job.
 *
 * Anything else fails. Adding a third exception means editing this file and
 * writing the argument down, which is exactly the friction that stopped
 * existing on the old platform.
 *
 *   node scripts/importantCheck.js
 * ═══════════════════════════════════════════════════════════════════════════ */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', 'src');

/**
 * Each entry: the file it may appear in, and a matcher for the DECLARATION
 * itself — not the line number, which moves the moment anything above it is
 * edited.
 */
const ALLOWED = [
  {
    file: 'app/globals.css',
    why: 'WCAG 2.3.3 reduced-motion override — must beat inline and third-party animation',
    declarations: [
      /^animation-duration:\s*0\.01ms$/,
      /^animation-iteration-count:\s*1$/,
      /^transition-duration:\s*0\.01ms$/,
      /^scroll-behavior:\s*auto$/,
    ],
  },
  {
    file: 'app/globals.css',
    why: 'the devtools overflow handle — never applied by the app',
    declarations: [/^overflow-x:\s*visible$/],
  },
];

/** Block comments and whole-line `//`. The word appears in prose in this
 *  codebase — twice in globals.css, explaining why there are none — and prose
 *  is not a declaration. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|jsx|ts|tsx|css)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Every unargued `!important` in one file's source. Exported so a test can
 *  hand it a string and prove the check still catches one — a checker nobody
 *  has ever seen fail is a checker nobody knows is working. */
function scanSource(rel, raw) {
  const src = stripComments(raw);
  const findings = [];

  for (const match of src.matchAll(/([^\s;{}][^;{}]*?)\s*!important/g)) {
    const declaration = match[1].trim();
    const line = src.slice(0, match.index).split('\n').length;

    const permitted = ALLOWED.some((rule) => (
      rule.file === rel && rule.declarations.some((re) => re.test(declaration))
    ));

    if (!permitted) findings.push(`${rel}:${line}  ${declaration} !important`);
  }

  return findings;
}

function scanImportant(root = ROOT) {
  return walk(root).flatMap((file) => scanSource(
    path.relative(root, file).replace(/\\/g, '/'),
    fs.readFileSync(file, 'utf8'),
  ));
}

module.exports = { scanImportant, scanSource, stripComments, ALLOWED };

if (require.main === module) {
  const findings = scanImportant();

  if (findings.length === 0) {
    console.log('importantCheck: clean (only the two argued exceptions)');
    process.exit(0);
  }

  console.error(`${findings.length} unargued \`!important\`:\n`);
  for (const f of findings) console.error(`  ${f}`);
  console.error(
    '\nWinning a specificity fight this way makes the next one harder. Raise the '
    + 'selector, or move the rule — and if it genuinely has to beat everything, add '
    + 'it to ALLOWED in this file with the reason written out.',
  );
  process.exit(1);
}
