import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Hoisted above the import below, so the hook gets the mock.
vi.mock('../src/app/utils/apiClient', async () => {
  const actual = await vi.importActual('../src/app/utils/apiClient');
  return { ...actual, post: vi.fn() };
});

import { post, NetworkError, ApiError } from '../src/app/utils/apiClient';
import { useReservation } from '../src/app/hooks/useReservation';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * REGRESSION — "Release my seats" stuck on a dropped connection.
 *
 * `release` guarded with `if (!(err instanceof ApiError)) throw err`, and
 * `apiFetch` throws `NetworkError` — a sibling class, not a subclass — for
 * offline, DNS, a dead connection and its own timeout. So the one failure this
 * request is most likely to meet was the one it rethrew, into an onClick that
 * did not catch:
 *
 *     setBusy('release'); await release(…); router.push(…);
 *
 * leaving the button disabled, the buyer on the checkout, and nothing on screen
 * having changed. These pin both halves of the contract its own doc comment
 * states: it does not throw, and the local hold is dropped either way.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const HOLD = {
  reservationId: '11111111-2222-4333-8444-555555555555',
  reservationToken: 'tok_abc',
  // Comfortably in the future: `snapshot()` discards an expired hold before any
  // caller can see it, which would make these tests pass for the wrong reason.
  expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
  slug: 'an-evening-on-the-waterfront',
};

function seedHold() {
  sessionStorage.setItem('eventsli.reservation', JSON.stringify(HOLD));
}

describe('useReservation().release', () => {
  beforeEach(() => {
    post.mockReset();
    sessionStorage.clear();
  });

  test('a dropped connection does not throw, and the hold is still forgotten', async () => {
    seedHold();
    post.mockRejectedValue(new NetworkError());

    const { result } = renderHook(() => useReservation());
    expect(result.current.reservation?.reservationId).toBe(HOLD.reservationId);

    let answer;
    await act(async () => { answer = await result.current.release(); });

    // It reports that the server was not told — and does not throw saying so.
    expect(answer).toBe(false);
    // The local record is gone, so no screen offers a hold that cannot be paid.
    expect(sessionStorage.getItem('eventsli.reservation')).toBeNull();
    expect(result.current.reservation).toBeNull();
  });

  test('a refusal from the API is handled the same way', async () => {
    seedHold();
    post.mockRejectedValue(new ApiError({ code: 'RESERVATION_EXPIRED', status: 410 }));

    const { result } = renderHook(() => useReservation());
    let answer;
    await act(async () => { answer = await result.current.release(); });

    expect(answer).toBe(false);
    expect(result.current.reservation).toBeNull();
  });

  test('a successful release says so, and sends the token as proof', async () => {
    seedHold();
    post.mockResolvedValue({});

    const { result } = renderHook(() => useReservation());
    let answer;
    await act(async () => { answer = await result.current.release(); });

    expect(answer).toBe(true);
    expect(post).toHaveBeenCalledWith(
      `/public/reservations/${HOLD.reservationId}/release`,
      undefined,
      expect.objectContaining({
        headers: { 'x-access-token': 'tok_abc' },
        noRedirect: true,
      }),
    );
    expect(result.current.reservation).toBeNull();
  });

  test('with no hold at all it is a no-op, not a request', async () => {
    const { result } = renderHook(() => useReservation());
    let answer;
    await act(async () => { answer = await result.current.release(); });

    expect(answer).toBe(false);
    expect(post).not.toHaveBeenCalled();
  });

  /**
   * The hold request is the one that turns a chosen seat into 35 minutes of
   * exclusivity. A 401 escaping to the shared handler would hard-navigate to
   * /login and lose the selection rather than showing an error.
   */
  test('taking a hold never bounces the buyer to the login page', async () => {
    post.mockResolvedValue({
      reservationId: HOLD.reservationId,
      reservationToken: 'tok_new',
      expiresAt: HOLD.expiresAt,
      seatCount: 2,
      subtotalCents: 15800,
      currency: 'CAD',
    });

    const { result } = renderHook(() => useReservation());
    await act(async () => {
      await result.current.hold('an-evening-on-the-waterfront', { seatIds: ['s1', 's2'] });
    });

    expect(post).toHaveBeenCalledWith(
      '/public/events/an-evening-on-the-waterfront/hold',
      { seatIds: ['s1', 's2'] },
      expect.objectContaining({ noRedirect: true }),
    );
  });
});
