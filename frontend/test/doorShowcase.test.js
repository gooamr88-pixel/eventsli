import { test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import { DEMO_QR_ROWS, DEMO_QR_URL, DEMO_QR_LEVEL } from '../src/app/components/landing/demoQr';
import { brandQrSvg, qrGeometry } from '../src/app/components/landing/brandQr';
import { describeScan } from '../src/app/gate/scanOutcome';

/**
 * The homepage's door showcase must stay honest: its QR code a real one for
 * its URL, its picture of the door app in the door app's own words.
 * Verified once by eye as well: the styled code decodes with html5-qrcode (the
 * library /gate uses) at 600, 300 and 160 px (2026-11-03).
 */

test('the QR rows are exactly what the qrcode library makes for the URL', () => {
  const q = QRCode.create(DEMO_QR_URL, { errorCorrectionLevel: DEMO_QR_LEVEL });
  const n = q.modules.size;
  const rows = Array.from({ length: n }, (_, y) => Array.from({ length: n }, (_, x) => (q.modules.data[y * n + x] ? '1' : '0')).join(''));
  expect(DEMO_QR_ROWS).toEqual(rows);
});

test('the logo covers well under the 30% that level H can recover', () => {
  const { size, logo } = qrGeometry(DEMO_QR_ROWS);
  expect((logo.size * logo.size) / (size * size)).toBeLessThan(0.1);
});

test('the image the page serves is the code the renderer makes', () => {
  const file = fs.readFileSync(path.join(process.cwd(), 'public', 'eventsli-demo-qr.svg'), 'utf8');
  expect(file).toBe(brandQrSvg(DEMO_QR_ROWS));
});

test('the phone says what the real door app says', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src', 'app', 'components', 'landing', 'DoorShowcase.jsx'), 'utf8');
  expect(src).toContain(describeScan('admitted').title);
  expect(src).toContain(describeScan('admitted').note);
  expect(src).toContain(describeScan('duplicate').title);
});
