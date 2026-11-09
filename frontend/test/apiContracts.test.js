import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { toApi } from '../src/app/organizer/events/[id]/map/mapApi';
import { UNAVAILABLE } from '../src/app/components/seating/SeatMapCanvas';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BROWSER AND THE API AGREE (TECH-AUDIT-LOG S-21).
 *
 * The audit's Critical finding (S-01) was a header name: the browser sent the
 * private-table key in one header and the API read another. Every test on each
 * side passed, because each side's tests spoke its own dialect — the backend's
 * by hand, the frontend's against a mock. Nothing checked that the two halves
 * of one request matched.
 *
 * These read the BACKEND SOURCE off disk, the way the error-code parity test
 * does, and hold the seating and checkout requests to it: what the browser
 * sends is what the server reads, and what the server sends the browser can
 * say. A rename on either side fails here instead of in front of a buyer.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const backend = (path) => readFileSync(resolve(__dirname, '../../backend', path), 'utf8');
const frontend = (path) => readFileSync(resolve(__dirname, '../src/app', path), 'utf8');

describe('the map save', () => {
  const service = backend('services/venueService.js');
  // The body of saveMap's per-table preparation: every `t.<field>` it reads.
  const read = new Set([...service.matchAll(/\bt\.(\w+)/g)].map((m) => m[1]));

  test('every field the editor sends for a table is one the server reads', () => {
    const sample = toApi(
      { id: 'x', label: 'Gold C', seatCount: 8, priceCents: 1, isPrivate: true, password: 'pw', shape: 'row',
        categoryId: 'c', tierId: 't', seatPriceCents: 2, position: { x: 1, y: 2, rotation: 3 } },
      new Map([['Gold C', { section: 'Gold', row: 'C' }]]),
    );
    for (const key of Object.keys(sample)) {
      expect(read, `the editor sends "${key}", the server never reads it`).toContain(key);
    }
  });

  test('the save body\'s version and seat blocks are read by the server', () => {
    const editor = frontend('organizer/events/[id]/map/useMapPersistence.js');
    for (const key of ['expectedVersion', 'availability']) {
      expect(editor).toContain(`${key}`);
      expect(service, `the server must read payload.${key}`).toContain(`payload.${key}`);
    }
  });
});

describe('holds and checkout', () => {
  test('the reservation token travels in the header the API reads it from', () => {
    const tokens = backend('services/accessTokens.js');
    const header = /function fromRequest\(req, headerName = '([^']+)'\)/.exec(tokens)?.[1];
    expect(header).toBe('x-access-token');
    expect(frontend('hooks/useReservation.js')).toContain(`'${header}': target.reservationToken`);
    expect(frontend('checkout/[reservationId]/CheckoutClient.jsx')).toContain(`'${header}': reservation.reservationToken`);
  });

  test('every reason the seat map gives for an unavailable seat has words on the buyer\'s map', () => {
    const rules = backend('services/seatSellability.js');
    const reasons = [...rules.matchAll(/return '([a-z_]+)';/g)].map((m) => m[1]);
    expect(reasons.length).toBeGreaterThan(0);
    for (const reason of reasons) expect(Object.keys(UNAVAILABLE)).toContain(reason);
  });
});
