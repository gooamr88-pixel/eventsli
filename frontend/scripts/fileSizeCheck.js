#!/usr/bin/env node
/**
 * A 500-line cap on source files, enforced from day one.
 *
 * Both codebases this one is assembled from have files nobody can read:
 * `dashboard.html` at 146KB in the old platform, `seating-map/page.js` at 166KB
 * in fancy. Neither arrived that way — each grew a hundred lines at a time,
 * past the point where a check could be added without a week of refactoring
 * first. So the check goes in while every file is small, and the only cost of
 * keeping it is splitting a file on the day it crosses.
 *
 * WARNS, does not fail, and that is deliberate. A hard failure on line 501
 * during a legitimate feature invites `// eslint-disable`-shaped workarounds and
 * a suppression file, and a suppression file is a cap that has been removed
 * without anyone deciding to remove it. A warning that shows up in every CI run
 * is harder to ignore for long and impossible to silence by accident.
 *
 *   node scripts/fileSizeCheck.js            # always exit 0
 *   node scripts/fileSizeCheck.js --strict   # non-zero if anything is over
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'src');
const LIMIT = 500;

/** globals.css is the exception, and it is an argued one: the whole point of
 *  that file is that there is exactly ONE place a design token is declared.
 *  Splitting it to satisfy a line count would recreate the nine-stylesheet
 *  cascade this project exists to escape. */
const EXEMPT = new Set(['app/globals.css']);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|jsx|ts|tsx|css)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const over = [];
for (const file of walk(ROOT)) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  if (EXEMPT.has(rel)) continue;
  const lines = fs.readFileSync(file, 'utf8').split('\n').length;
  if (lines > LIMIT) over.push({ rel, lines });
}

if (over.length === 0) {
  console.log(`fileSizeCheck: clean (nothing over ${LIMIT} lines)`);
  process.exit(0);
}

over.sort((a, b) => b.lines - a.lines);
console.warn(`${over.length} file(s) over ${LIMIT} lines:\n`);
for (const f of over) console.warn(`  ${String(f.lines).padStart(5)}  ${f.rel}`);
console.warn('\nSplit them before they become the next 166KB page.');

process.exit(process.argv.includes('--strict') ? 1 : 0);
