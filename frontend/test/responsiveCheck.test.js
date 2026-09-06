import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanResponsive, stripComments, mediaRanges } from '../scripts/responsiveCheck.js';

/**
 * The checker is only worth running if it still detects what it was written to
 * detect. A checker that reports "clean" because it broke is precisely the
 * failure mode it replaced — and it is invisible, because clean is what you
 * were hoping for.
 *
 * So: a known-bad fixture that MUST be caught, and a known-good one that must
 * not be. Both in a temp directory, because scanResponsive walks a real tree.
 */
function fixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'es-rc-'));
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body, 'utf8');
  }
  return dir;
}

describe('responsiveCheck', () => {
  test('catches an fx- class made inert by an inline style', () => {
    const dir = fixture({
      'page.js': `export default function P() {
  return <section className="fx-section" style={{ padding: "100px 48px", background: "#fff" }} />;
}`,
    });
    const { inertClasses } = scanResponsive(dir);
    expect(inertClasses).toHaveLength(1);
    expect(inertClasses[0]).toContain('.fx-section is inert');
  });

  test('catches a fixed-column grid with no narrow-width override', () => {
    const dir = fixture({
      'grid.js': `export const G = () => <div style={{ gridTemplateColumns: "repeat(3, 1fr)" }} />;`,
    });
    expect(scanResponsive(dir).fixedGrids).toHaveLength(1);
  });

  test('the class and the inline key must be on the SAME tag', () => {
    // The original grep read a `padding` three lines down that belonged to a
    // CHILD, and reported the parent's class as inert. Nine of its nine inert
    // findings were this.
    const dir = fixture({
      'nested.js': `export default function P() {
  return (
    <section className="fx-section">
      <div style={{ padding: "12px" }} />
    </section>
  );
}`,
    });
    expect(scanResponsive(dir).inertClasses).toEqual([]);
  });

  test('a repeat() inside a comment is not code', () => {
    // Five of the grep's twenty-one "fixed grids" were comments saying the
    // fixed grid had been removed.
    const dir = fixture({
      'commented.js': `/* was: gridTemplateColumns: "repeat(3, 1fr)" — replaced by .fx-grid */
export const G = () => <div className="fx-grid fx-grid--3" />;`,
    });
    expect(scanResponsive(dir).fixedGrids).toEqual([]);
  });

  test('a grid a narrow-width @media re-declares is correct', () => {
    const dir = fixture({
      'styles.css': `.stats { display: grid; grid-template-columns: repeat(4, 1fr); }
@media (max-width: 767.98px) { .stats { grid-template-columns: 1fr; } }`,
    });
    expect(scanResponsive(dir).fixedGrids).toEqual([]);
  });

  test('a dynamic [slug] route is scanned, not silently skipped', () => {
    // The one that mattered most: both bash and PowerShell read [slug] as a
    // character class, so every dynamic route went unscanned — here that would
    // mean the event page, the seat map, the checkout and the ticket. Every
    // page that takes money.
    const dir = fixture({
      'e/[slug]/page.js': `export default () => <div className="fx-container" style={{ maxWidth: 900 }} />;`,
    });
    const { inertClasses } = scanResponsive(dir);
    expect(inertClasses).toHaveLength(1);
    expect(inertClasses[0]).toContain('[slug]');
  });

  test('a correct file is clean', () => {
    const dir = fixture({
      'ok.js': `export default function P() {
  return (
    <section className="fx-section">
      <div className="fx-container fx-container--xl">
        <div className="fx-grid fx-grid--3" />
      </div>
    </section>
  );
}`,
    });
    const { inertClasses, fixedGrids } = scanResponsive(dir);
    expect([...inertClasses, ...fixedGrids]).toEqual([]);
  });

  test('our own src passes', () => {
    const { inertClasses, fixedGrids } = scanResponsive(path.join(process.cwd(), 'src'));
    expect([...inertClasses, ...fixedGrids]).toEqual([]);
  });

  test('stripComments blanks a comment without moving anything after it', () => {
    // Asserted on the properties rather than on a hand-counted literal: the
    // offsets this returns become the line numbers in every finding, so the
    // one thing that must hold is that length is preserved.
    const src = 'a /* x */ b';
    const out = stripComments(src);

    // Length preserved — the offsets this returns become the line numbers in
    // every finding, so a comment must be blanked in place, never removed.
    expect(out).toHaveLength(src.length);
    expect(out).not.toContain('/*');
    expect(out.replace(/\s+/g, ' ')).toBe('a b');

    // And newlines survive, or every line number after a block comment shifts.
    const multi = stripComments('a\n/* one\n   two */\nb');
    expect(multi.split('\n')).toHaveLength(4);
  });

  test('mediaRanges brace-matches a whole block', () => {
    expect(mediaRanges('@media (min-width: 640px) { .a { color: red } }')).toHaveLength(1);
  });
});
