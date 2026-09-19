import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE TOP-LEVEL HEADING PER PAGE.
 *
 * `components/marketing/PageHeader` renders the `<h1>` for every static page.
 * Two of them ALSO carried a literal `<h1>` in their "could not load" branch,
 * repeating the title word for word — so on the failure path the buyer terms
 * and the organizer agreement each rendered two identical top-level headings.
 *
 * That is a scrambled outline to a screen reader, which uses headings to move
 * around a document, and a duplicated title to a crawler. It was left over from
 * before the header component existed, which is how this kind of thing survives:
 * the page looks right on the path anybody tests.
 *
 * The rule is mechanical, so it is checked mechanically — a page that delegates
 * its heading does not also write one.
 *
 * `Markdown` is deliberately not covered by this: it demotes `#` to `<h2>`
 * precisely so a stored legal document cannot introduce a second `<h1>`.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const APP = path.join(process.cwd(), 'src', 'app');

/** Every `page.jsx` / `page.js` under src/app. */
function pageFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') pageFiles(full, out);
    } else if (/^page\.(jsx|js)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * COMMENTS ARE STRIPPED FIRST, and the first version of this test did not do
 * it. These files discuss their own heading structure — "the homepage puts them
 * under a section h2", and the note explaining this very rule — so a bare
 * search for `<h1` reports four pages, every one of them a sentence rather than
 * markup. A check that cries wolf is one that gets deleted.
 */
function stripComments(source) {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')   // {/* JSX */}
    .replace(/\/\*[\s\S]*?\*\//g, '')             // /* block */
    .replace(/^\s*\/\/.*$/gm, '');                // // line
}

const pages = pageFiles(APP).map((file) => ({
  rel: path.relative(APP, file).split(path.sep).join('/'),
  text: stripComments(fs.readFileSync(file, 'utf8')),
}));

describe('page headings', () => {
  test('there are pages to check', () => {
    expect(pages.length).toBeGreaterThan(10);
  });

  test('a page that uses PageHeader does not also write its own h1', () => {
    const offenders = pages
      .filter((p) => /marketing\/PageHeader/.test(p.text))
      .filter((p) => /<h1[\s>]/.test(p.text))
      .map((p) => p.rel);

    expect(
      offenders,
      'PageHeader already renders the page\'s <h1>. These write a second one:\n  '
      + `${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  test('no page file writes more than one h1 of its own', () => {
    const offenders = pages
      .map((p) => ({ rel: p.rel, n: (p.text.match(/<h1[\s>]/g) || []).length }))
      .filter((p) => p.n > 1)
      .map((p) => `${p.rel} (${p.n})`);

    expect(offenders, `more than one <h1>:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });
});
