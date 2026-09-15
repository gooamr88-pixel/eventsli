#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * `rounded-[--es-radius-lg]` is not a Tailwind v4 class. It compiles.
 *
 * v3 read a bare custom property in brackets as `var(--…)`. v4 reads it as the
 * literal text, and emits `border-radius: --es-radius-lg` — invalid CSS that the
 * browser drops without a word. The v4 spelling for "the value of this custom
 * property" is parentheses: `rounded-(--es-radius-lg)`.
 *
 * Fifty-four of them shipped across twenty-five files. The corners they were
 * meant to round rendered square, and the skip link lost its z-index under the
 * fixed app bar. The build passed, the lint passed, and nothing on screen was
 * wrong enough to notice. This fails instead.
 *
 *   node scripts/cssVarClassCheck.js      # non-zero on any finding
 * ═══════════════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'src');

/** Walks the tree rather than globbing: `[slug]` directories read as a
 *  character class to both bash and PowerShell. */
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|jsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

// A utility prefix, then `[--name]`. `var(--name)` inside brackets is fine and
// is not matched.
const BROKEN = /[a-z0-9]-\[--[a-z0-9-]+\]/gi;

const findings = [];
for (const file of walk(ROOT)) {
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
    for (const match of line.matchAll(BROKEN)) {
      findings.push(`${path.relative(ROOT, file)}:${index + 1}  ${match[0]}`);
    }
  });
}

if (findings.length) {
  console.error('Tailwind v4 needs parentheses for a custom property: `rounded-(--es-radius-lg)`.');
  for (const f of findings) console.error(`  ${f}`);
  process.exit(1);
}
console.log('css variables: every custom-property utility uses the v4 (--token) form');
