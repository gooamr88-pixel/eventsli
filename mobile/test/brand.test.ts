/**
 * The app's logo stays the website's logo.
 *
 * The app keeps a COPY of the logo's paths (src/ui/brandPaths.ts, written by
 * scripts/brand-paths.js), and the native icons are rendered by a script that
 * cannot import TypeScript (scripts/brand-mark.js). Copies drift; these tests
 * are what notices.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import * as paths from '@/ui/brandPaths';
import { scannerMarkSvg } from '@/ui/ScannerMark';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const script = require('../scripts/brand-mark.js') as { scannerMarkSvg: (o?: object) => string };

const BRAND = path.join(__dirname, '..', '..', 'frontend', 'src', 'app', 'components', 'brand');

test("the app's copy of the logo paths matches the website's", () => {
  const site = fs.readFileSync(path.join(BRAND, 'markPath.js'), 'utf8')
    + fs.readFileSync(path.join(BRAND, 'wordmarkPath.js'), 'utf8');
  for (const [name, value] of Object.entries(paths)) {
    const m = site.match(new RegExp(`export const ${name} = '([^']+)';`));
    expect(m && m[1]).toBe(value);
  }
});

test('the icons and the app draw the same mark', () => {
  for (const options of [{}, { radius: 0 }, { tile: null, scale: 72 / 108 }, { tile: null, solid: true, ticket: '#ffffff' }]) {
    expect(scannerMarkSvg(options)).toBe(script.scannerMarkSvg(options));
  }
});

test('the mark is the brand: yellow ticket and brackets on the near-black', () => {
  const svg = scannerMarkSvg();
  expect(svg).toContain('fill="#111018"');
  expect(svg).toContain('stroke="#ffcc00"');
  expect(svg).toContain(`<path d="${paths.MARK_FRAME}" fill="#ffcc00"/>`);
});
