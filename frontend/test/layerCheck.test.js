import { describe, test, expect } from 'vitest';
import { scanLayers, scanSource, onlyCustomProperties } from '../scripts/layerCheck';

/**
 * A checker nobody has ever seen fail is a checker nobody knows is working —
 * and this one guards an invariant whose only symptom is silence. An unlayered
 * rule beats every utility, so the failure it prevents looks exactly like a
 * utility somebody forgot to write.
 *
 * The two regressions in the file's own header are the first two cases below.
 */
describe('layerCheck', () => {
  test('globals.css is clean', () => {
    const findings = scanLayers();
    expect(
      findings,
      `Unlayered rules:\n  ${findings.join('\n  ')}`,
    ).toEqual([]);
  });

  test('catches the `a { color: inherit }` regression', () => {
    // An element selector, specificity (0,0,1) — it lost every specificity
    // contest it entered and still beat `text-accent` on every link, because
    // being unlayered is not a specificity question.
    const found = scanSource('app/globals.css', 'a { color: inherit; }');
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('app/globals.css:1');
    expect(found[0]).toContain('a');
  });

  test('catches an unlayered block that only meant to beat a component rule', () => {
    // The organizer-polish shape: correct about needing to win, wrong about how.
    const found = scanSource('app/globals.css', [
      '@layer components { .es-stat { padding: 1.25rem } }',
      '.es-stat { padding: 0.875rem; }',
    ].join('\n'));
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('app/globals.css:2');
  });

  test('a media query does not create a layer', () => {
    // `@media` groups conditions, not cascade standing. Its children are as
    // unlayered as it is, which is where the `.es-stat` phone override hid.
    const found = scanSource('app/globals.css', [
      '@media (width < 40rem) {',
      '  .es-stat { padding: 0.875rem; }',
      '}',
    ].join('\n'));
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('app/globals.css:2');
  });

  test('the same rule inside a layer is fine', () => {
    expect(scanSource('app/globals.css', [
      '@layer components {',
      '  @media (width < 40rem) { .es-stat { padding: 0.875rem; } }',
      '}',
    ].join('\n'))).toEqual([]);
  });

  test('a token block is not a rule that competes with a utility', () => {
    // Custom properties define values; they do not contest a property with
    // `p-4`. Every token block in globals.css is one of these, and they are
    // unlayered on purpose.
    expect(scanSource('app/globals.css', ':root { --es-accent: #2c62bd; }')).toEqual([]);
    expect(scanSource('app/globals.css', ':root[data-theme="dark"], .fx-gate { --es-bg: #111; }')).toEqual([]);
  });

  test('a token block that also sets a real property is not exempt', () => {
    // The exemption is about what the block declares, not about `:root`.
    expect(scanSource('app/globals.css', ':root { --es-bg: #fff; color: red; }')).toHaveLength(1);
    expect(onlyCustomProperties(' --a: 1; --b: 2; ')).toBe(true);
    expect(onlyCustomProperties(' --a: 1; color: red; ')).toBe(false);
  });

  test('the debug handle is the one argued exception, and it is scoped', () => {
    expect(scanSource('app/globals.css', '.fx-debug-overflow { overflow-x: visible !important; }')).toEqual([]);
    // A different selector does not inherit the allowance.
    expect(scanSource('app/globals.css', '.fx-debug-overflowX { overflow-x: visible; }')).toHaveLength(1);
  });

  test('prose mentioning @layer or :root is not a rule', () => {
    expect(scanSource('app/globals.css', [
      '/* An unlayered `.fx-stack { gap }` defeats `gap-1.5`, and :root is fine. */',
      '@layer components { .a { color: red } }',
    ].join('\n'))).toEqual([]);
  });
});
