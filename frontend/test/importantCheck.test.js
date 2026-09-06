import { describe, test, expect } from 'vitest';
import { scanImportant, scanSource, ALLOWED } from '../scripts/importantCheck';

/**
 * A checker nobody has ever seen fail is a checker nobody knows is working.
 *
 * The tree is clean, so the interesting assertions are the negative ones: hand
 * it a violation and it has to say so, hand it prose and it has to stay quiet.
 */
describe('importantCheck', () => {
  test('the tree is clean', () => {
    const findings = scanImportant();
    expect(
      findings,
      `Unargued \`!important\`:\n  ${findings.join('\n  ')}`,
    ).toEqual([]);
  });

  test('catches one that is not argued for', () => {
    const found = scanSource('app/components/Thing.jsx', '.thing { color: red !important; }');
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('color: red !important');
    expect(found[0]).toContain('app/components/Thing.jsx:1');
  });

  test('the exceptions are scoped to the file they were argued for', () => {
    // The same declaration somewhere else is not covered. An allowance is for a
    // specific rule in a specific file, not for a string.
    expect(scanSource('app/globals.css', '* { scroll-behavior: auto !important; }')).toEqual([]);
    expect(scanSource('app/other.css', '* { scroll-behavior: auto !important; }')).toHaveLength(1);
  });

  test('the whole reduced-motion block is covered, and nothing more', () => {
    const block = `@media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
        scroll-behavior: auto !important;
      }
    }`;
    expect(scanSource('app/globals.css', block)).toEqual([]);

    // A fifth declaration smuggled into the same block is still a finding.
    expect(scanSource('app/globals.css', '* { display: none !important; }')).toHaveLength(1);
  });

  test('prose is not a declaration', () => {
    // globals.css explains twice why there are no `!important` rules. A check
    // that flagged its own rationale would be deleted within a week.
    const prose = `/* Do not "fix" that with !important. Winning over inline
       styles would need !important, and that is the wrong trade. */
       .thing { color: red; }`;
    expect(scanSource('app/globals.css', prose)).toEqual([]);
  });

  test('every exception carries its reason', () => {
    for (const rule of ALLOWED) {
      expect(rule.why, `${rule.file} has an allowance with no argument`).toBeTruthy();
      expect(rule.why.length).toBeGreaterThan(20);
      expect(rule.declarations.length).toBeGreaterThan(0);
    }
  });
});
