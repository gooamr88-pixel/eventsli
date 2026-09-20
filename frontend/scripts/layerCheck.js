#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Every rule in globals.css belongs to a layer.
 *
 * Tailwind v4 puts its utilities in `@layer utilities`. A rule written OUTSIDE
 * any layer beats every layered rule regardless of specificity — that is what
 * cascade layers do, not a quirk — so an unlayered `.es-card { padding }`
 * silently defeats a `p-6` written beside it in a component. Nothing errors,
 * nothing warns, and the only symptom is a utility that does not apply.
 *
 * This codebase has been bitten twice. `a { color: inherit }` sat unlayered
 * and made `text-accent`, `text-muted` and `text-on-accent` inert on every
 * link in the app. An "organizer polish" block sat unlayered for the same
 * stated reason — it had to beat the component rules above it — and took every
 * utility on `.es-stat`, `.es-evlist`, `.es-onboard`, `.es-nextstep` and
 * `.es-facts` with it. Both were invisible: the colour was just the inherited
 * one, and the padding was just the other padding.
 *
 * Wanting to beat an earlier component rule is not a reason to leave the
 * layer. Re-open it — `@layer components { … }` later in the file wins by
 * source order at equal specificity, and utilities still win over the result,
 * which is what somebody writing `.es-stat p-4` plainly means.
 *
 * WHAT IS ALLOWED UNLAYERED, and why each one is argued rather than
 * grandfathered:
 *
 *   1. A block that declares ONLY custom properties. `:root { --es-accent: … }`
 *      defines tokens; it is not competing with a utility for a property, so
 *      the layer cannot change which declaration wins. Every token block in
 *      this file is one of these.
 *
 *   2. `.fx-debug-overflow`. A devtools handle, never applied by the app. It
 *      lifts the overflow guard on <html> so whatever is pushing the page
 *      sideways becomes visible. It has to beat everything; that is its job,
 *      and `importantCheck.js` argues the same exception for the same rule.
 *
 * Anything else fails. Adding a third exception means editing this file and
 * writing the argument down.
 *
 *   node scripts/layerCheck.js
 * ═══════════════════════════════════════════════════════════════════════════ */
const fs = require('node:fs');
const path = require('node:path');

const TARGET = path.join(__dirname, '..', 'src', 'app', 'globals.css');

/** Selectors permitted to sit outside every layer. Matched against the whole
 *  selector text, so a rule that grows a second selector stops matching and
 *  has to be argued again. */
const ALLOWED_SELECTORS = [
  {
    selector: /^\.fx-debug-overflow(\s\*)?$/,
    why: 'the devtools overflow handle — never applied by the app, must beat everything',
  },
];

/** Block comments. The words `@layer` and `:root` both appear in prose in this
 *  file — at length — and prose is not a rule. Newlines are preserved so a
 *  reported line number still points at the right line. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

/** True when a declaration body sets nothing but custom properties. Nested
 *  rules count as content, so `:root { --a: 1; .b { color: red } }` is not one. */
function onlyCustomProperties(body) {
  if (/[{}]/.test(body)) return false;
  const declarations = body.split(';').map((d) => d.trim()).filter(Boolean);
  if (declarations.length === 0) return false;
  return declarations.every((d) => d.startsWith('--'));
}

/**
 * Every unlayered rule in one stylesheet's source. Exported so a test can hand
 * it a string and prove the check still catches one — a checker nobody has
 * ever seen fail is a checker nobody knows is working.
 */
function scanSource(rel, raw) {
  const src = stripComments(raw);
  const findings = [];

  // Walk the top level, tracking whether we are inside a layer. An at-rule
  // that is not a layer (`@media`, `@supports`) does NOT create one, so its
  // children are checked at the same standing as its parent.
  let i = 0;
  const stack = [{ layered: false }];

  while (i < src.length) {
    const ch = src[i];

    if (ch === '}') {
      if (stack.length > 1) stack.pop();
      i += 1;
      continue;
    }

    if (ch === '{') { i += 1; continue; }

    // Read a prelude up to the next `{` or `;`.
    let j = i;
    while (j < src.length && src[j] !== '{' && src[j] !== ';' && src[j] !== '}') j += 1;

    const prelude = src.slice(i, j).trim();

    if (src[j] === ';' || j >= src.length) { i = j + 1; continue; }
    if (src[j] === '}') { i = j; continue; }

    // We are at a `{`. Find its matching close to read the body.
    let depth = 0;
    let k = j;
    for (; k < src.length; k += 1) {
      if (src[k] === '{') depth += 1;
      else if (src[k] === '}') { depth -= 1; if (depth === 0) break; }
    }
    const body = src.slice(j + 1, k);
    const parent = stack[stack.length - 1];

    if (/^@layer\b/.test(prelude)) {
      stack.push({ layered: true });
      i = j + 1;
      continue;
    }

    if (/^@(media|supports|container)\b/.test(prelude)) {
      stack.push({ layered: parent.layered });
      i = j + 1;
      continue;
    }

    // Any other at-rule (`@theme`, `@import`, `@keyframes`, `@font-face`) is
    // not a style rule competing with a utility. Skip its whole body.
    if (prelude.startsWith('@')) { i = k + 1; continue; }

    // A plain style rule. Only now does the layer matter.
    if (!parent.layered) {
      const selector = prelude.replace(/\s+/g, ' ').trim();
      const permitted = ALLOWED_SELECTORS.some((rule) => rule.selector.test(selector));

      if (!permitted && !onlyCustomProperties(body)) {
        // From the first character OF THE SELECTOR, not from `i` — the prelude
        // starts at whatever followed the previous `}`, which is usually a
        // newline, and counting from there reports the line above.
        const offset = src.slice(i, j).search(/\S/);
        const line = src.slice(0, i + (offset < 0 ? 0 : offset)).split('\n').length;
        findings.push(`${rel}:${line}  ${selector}`);
      }
    }

    // Descend, so a nested rule inside an unlayered one is reported too.
    stack.push({ layered: parent.layered });
    i = j + 1;
  }

  return findings;
}

function scanLayers(file = TARGET) {
  const rel = path.relative(path.join(__dirname, '..'), file).replace(/\\/g, '/');
  return scanSource(rel, fs.readFileSync(file, 'utf8'));
}

module.exports = { scanLayers, scanSource, stripComments, onlyCustomProperties, ALLOWED_SELECTORS };

if (require.main === module) {
  const findings = scanLayers();

  if (findings.length === 0) {
    console.log('layerCheck: clean (every rule is in a layer, bar the argued exception)');
    process.exit(0);
  }

  console.error(`${findings.length} unlayered rule(s):\n`);
  for (const f of findings) console.error(`  ${f}`);
  console.error(
    '\nAn unlayered rule beats every Tailwind utility regardless of specificity, '
    + 'so a utility written beside one of these classes is inert — silently. '
    + 'Wrap the block in `@layer components { … }`: re-opening the layer later in '
    + 'the file still wins over the component rules above it, by source order, '
    + 'and gives the call site its utilities back.',
  );
  process.exit(1);
}
