#!/usr/bin/env node
/**
 * A backtick inside a CSS comment, in a `<style>{` … `}</style>` block, ends
 * the template literal and produces a PARSE ERROR — not a style bug.
 *
 * The received wisdom is to run the build rather than grep for this, because a
 * grep cannot tell a CSS comment from a JS one and fires on every JSDoc that
 * quotes an identifier. That is true of a grep. This is not a grep: it extracts
 * the style blocks first and looks only inside CSS comments within them, so it
 * has no opinion about JSDoc anywhere else in the file.
 *
 * It exists because `next build` takes minutes and this takes milliseconds, and
 * because the failure bit the codebase this was ported from four times.
 *
 *   node scripts/backtickInCssComment.js      # non-zero on any finding
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'src');

/** Every .js/.jsx under src, INCLUDING `[slug]` routes — which a glob would
 *  silently skip, because both bash and PowerShell read the brackets as a
 *  character class. Walking the tree never builds a glob. */
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|jsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const findings = [];

for (const file of walk(ROOT)) {
  const src = fs.readFileSync(file, 'utf8');

  // Each <style …>{` … `} block. Non-greedy, so adjacent blocks stay separate.
  for (const block of src.matchAll(/<style[^>]*>\{`([\s\S]*?)`\}/g)) {
    const css = block[1];
    for (const comment of css.matchAll(/\/\*[\s\S]*?\*\//g)) {
      if (!comment[0].includes('`')) continue;
      findings.push({
        file: path.relative(path.join(__dirname, '..'), file).replace(/\\/g, '/'),
        line: src.slice(0, block.index + comment.index).split('\n').length,
        snippet: comment[0].replace(/\s+/g, ' ').slice(0, 90),
      });
    }
  }
}

if (findings.length === 0) {
  console.log('backtickInCssComment: clean');
  process.exit(0);
}

console.error(`${findings.length} backtick(s) inside a CSS comment:\n`);
for (const f of findings) {
  console.error(`  ${f.file}:${f.line}`);
  console.error(`    ${f.snippet}\n`);
}
console.error('Each one ends its template literal. Use " instead.');
process.exit(1);
