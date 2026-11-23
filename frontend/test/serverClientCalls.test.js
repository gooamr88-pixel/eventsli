import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * A SERVER FILE MUST NOT CALL A FUNCTION THAT LIVES IN A `'use client'` FILE.
 *
 * Next turns every export of a client module into a reference when a server
 * component imports it. A component reference renders fine; CALLING one
 * throws "Attempted to call levelLabel() from the server" — in production a
 * bare React #441 and the site-wide "Something broke" screen. That is how
 * /e/<slug>/sponsor broke for every event with a public package
 * (2026-11-23): the page called `levelLabel` from components/sponsors/sponsorUi.
 *
 * The rule checked here: a file with no `'use client'` imports only
 * capitalised names (components) from a client file. Shared helpers and
 * constants go in a plain module the client file re-exports
 * (sponsorLevels.js is the pattern).
 *
 * KNOWN_CLIENT_ONLY: plain files that break the rule but are only ever
 * imported by client components, so they never run on the server. Adding to
 * this list means checking that is still true.
 */
const SRC = path.resolve(__dirname, '../src');

const KNOWN_CLIENT_ONLY = new Set([
  'app/lib/authLanding.js',
  'app/organizer/dashboard/InsightPanels.jsx',
  'app/organizer/events/[id]/map/print/packRoster.js',
]);

function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p, out);
    else if (/\.(jsx?|mjs)$/.test(f.name)) out.push(p);
  }
  return out;
}

const isClient = (src) => /^\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*['"]use client['"]/.test(src);

function resolveImport(from, spec) {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(from), spec);
  for (const c of [base, `${base}.js`, `${base}.jsx`, path.join(base, 'index.js'), path.join(base, 'index.jsx')]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

function violations() {
  const found = [];
  for (const file of walk(SRC)) {
    const src = fs.readFileSync(file, 'utf8');
    if (isClient(src)) continue;
    const rel = path.relative(SRC, file).split(path.sep).join('/');
    const re = /import\s+(?:\w+\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*['"]([^'"]+)['"]/g;
    let m;
    while ((m = re.exec(src))) {
      const target = resolveImport(file, m[2]);
      if (!target || !isClient(fs.readFileSync(target, 'utf8'))) continue;
      const names = (m[1] || '').split(',').map((s) => s.trim().split(/\s+as\s+/).pop()).filter(Boolean);
      const calls = names.filter((n) => !/^[A-Z][a-z]/.test(n));
      if (calls.length) found.push({ file: rel, from: path.relative(SRC, target).split(path.sep).join('/'), names: calls });
    }
  }
  return found;
}

describe('server files and client modules', () => {
  it('no server file imports a function or constant from a client module', () => {
    const bad = violations().filter((v) => !KNOWN_CLIENT_ONLY.has(v.file));
    expect(bad).toEqual([]);
  });

  it('the sponsor page takes levelLabel from the plain module', () => {
    const page = fs.readFileSync(path.join(SRC, 'app/e/[slug]/sponsor/page.jsx'), 'utf8');
    expect(page).toMatch(/from '\.\.\/\.\.\/\.\.\/components\/sponsors\/sponsorLevels'/);
    expect(isClient(fs.readFileSync(path.join(SRC, 'app/components/sponsors/sponsorLevels.js'), 'utf8'))).toBe(false);
  });
});
