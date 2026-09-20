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

const WORD = '!important';

/** Every unargued `!important` in one file's source. Exported so a test can
 *  hand it a string and prove the check still catches one — a checker nobody
 *  has ever seen fail is a checker nobody knows is working. */
function scanSource(rel, raw) {
  /**
   * NOTHING TO FIND, AND THE CHEAPEST POSSIBLE WAY TO ESTABLISH IT.
   *
   * Four files in this tree contain the word and roughly two hundred do not,
   * so this returns immediately for almost every call — before `stripComments`
   * rewrites a file that could never have produced a finding.
   */
  if (!raw.includes(WORD)) return [];

  const src = stripComments(raw);
  const findings = [];

  /**
   * ───────────────────────────────────────────────────────────────────────────
   * BACKWARDS FROM EACH `!important`, NOT FORWARDS TOWARDS IT.
   *
   * This used to be `matchAll(/([^\s;{}][^;{}]*?)\s*!important/g)`, which reads
   * well and took THIRTEEN SECONDS on this tree — long enough that the vitest
   * case wrapping it hit the 20s timeout and the suite failed with nothing
   * actually wrong in the CSS.
   *
   * The cause is the interaction between that pattern and the line above it.
   * `stripComments` blanks comments to spaces rather than deleting them, to
   * keep line numbers honest — and `globals.css` is 319KB that is mostly
   * comment, so it becomes enormous runs of whitespace containing no `;`, `{`
   * or `}`. `[^;{}]*?` matches whitespace happily, so from every one of those
   * positions the engine lazily expands towards the end of the run looking for
   * a `!important` that is not there, and fails. That is quadratic in the
   * length of the run.
   *
   * The declaration the old pattern captured is exactly "everything back to
   * the previous `;`, `{` or `}`, trimmed" — so this finds the word first,
   * which `indexOf` does in one pass, and walks back to that delimiter. Linear,
   * and it does no work at all in the space between declarations.
   * ───────────────────────────────────────────────────────────────────────────
   */
  // Counted forward from the previous finding rather than re-slicing the file
  // from byte zero for each one — the other half of the same quadratic.
  let line = 1;
  let counted = 0;

  for (let at = src.indexOf(WORD); at !== -1; at = src.indexOf(WORD, at + WORD.length)) {
    let start = at;
    while (start > 0 && !';{}'.includes(src[start - 1])) start -= 1;

    const declaration = src.slice(start, at).trim();
    // Only whitespace since the last delimiter, so there is no declaration for
    // this `!important` to belong to. The old pattern required a non-space
    // character here too, and skipped the occurrence for the same reason.
    if (!declaration) continue;

    // The old pattern reported the line of the declaration's FIRST non-space
    // character, which is where its capture group began.
    const begin = start + src.slice(start, at).search(/\S/);
    while (counted < begin) {
      if (src[counted] === '\n') line += 1;
      counted += 1;
    }

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
