import { test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import { DEMO_QR_ROWS, DEMO_QR_URL, DEMO_QR_LEVEL } from '../src/app/components/landing/demoQr';
import { brandQrSvg, qrGeometry } from '../src/app/components/landing/brandQr';

/**
 * The homepage's door showcase must stay honest: its QR code a real one for
 * its URL, its phones the check-in app's real screenshots, its store link the
 * app's own listing.
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

/**
 * The phones are the real app (2026-11-23), not a drawing of it: every image
 * the showcase names is a file in public/, and the App Store link is the
 * check-in app's own listing — the id App Store Connect gave it.
 */
const SRC = () => fs.readFileSync(path.join(process.cwd(), 'src', 'app', 'components', 'landing', 'DoorShowcase.jsx'), 'utf8');

test('every app screenshot the showcase names is a real file', () => {
  const images = [...SRC().matchAll(/'(\/app\/[\w-]+\.webp)'/g)].map((m) => m[1]);
  expect(images.length).toBeGreaterThanOrEqual(3);
  for (const img of images) {
    expect(fs.existsSync(path.join(process.cwd(), 'public', img)), img).toBe(true);
  }
});

test('the App Store link is the check-in app', () => {
  const eas = JSON.parse(fs.readFileSync(path.join(process.cwd(), '..', 'mobile', 'eas.json'), 'utf8'));
  const id = JSON.stringify(eas).match(/"ascAppId":"(\d+)"/)[1];
  expect(SRC()).toContain(`https://apps.apple.com/app/eventsli-check-in/id${id}`);
});
