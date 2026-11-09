import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../src/app/utils/apiClient', async () => {
  const actual = await vi.importActual('../src/app/utils/apiClient');
  return { ...actual, post: vi.fn() };
});

import { post } from '../src/app/utils/apiClient';
import { useReservation, TABLE_ACCESS_HEADER } from '../src/app/hooks/useReservation';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * REGRESSION — a private table could never be bought (TECH-AUDIT-LOG S-01).
 *
 * The hold sent the table's unlock key in `x-access-token`; the API reads it
 * from `x-table-access`. The backend's private-table tests sent the right
 * header by hand, so they passed while every real buyer was refused. These pin
 * the request the HOOK makes, and the header name against the backend source.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const RESULT = {
  reservationId: '11111111-2222-4333-8444-555555555555',
  reservationToken: 'tok_res',
  expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
  seatCount: 6,
  subtotalCents: 90000,
  currency: 'CAD',
};

beforeEach(() => {
  sessionStorage.clear();
  post.mockReset();
  post.mockResolvedValue(RESULT);
});

describe('useReservation().hold', () => {
  test('a whole private table carries its key in x-table-access', async () => {
    const { result } = renderHook(() => useReservation());
    await act(() => result.current.hold('gala', { tableId: 'table-1', tableToken: 'key-a,key-b' }));

    const [, body, options] = post.mock.calls[0];
    expect(body).toEqual({ tableId: 'table-1' });
    expect(options.headers).toEqual({ 'x-table-access': 'key-a,key-b' });
  });

  test('seats at a private table carry the key too', async () => {
    const { result } = renderHook(() => useReservation());
    await act(() => result.current.hold('gala', { seatIds: ['s1', 's2'], tableToken: 'key-a' }));

    const [, body, options] = post.mock.calls[0];
    expect(body).toEqual({ seatIds: ['s1', 's2'] });
    expect(options.headers).toEqual({ 'x-table-access': 'key-a' });
  });

  test('no key, no header — an empty one would be split into a bogus token', async () => {
    const { result } = renderHook(() => useReservation());
    await act(() => result.current.hold('gala', { seatIds: ['s1'] }));
    expect(post.mock.calls[0][2].headers).toBeUndefined();
  });
});

test('the header name is the one the API reads', () => {
  const controller = readFileSync(
    resolve(__dirname, '../../backend/controllers/seatMapController.js'), 'utf8',
  );
  expect(TABLE_ACCESS_HEADER).toBe('x-table-access');
  const reads = controller.match(/req\.headers\['([^']+)'\]/g) || [];
  expect(reads.length).toBeGreaterThan(0);
  for (const r of reads) expect(r).toContain(TABLE_ACCESS_HEADER);
});
