import { describe, test, expect, vi, beforeEach } from 'vitest';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * REGRESSION — a general-admission buyer sent to a seat map that does not exist.
 *
 * There are two picker pages and each is wrong for one kind of event, so each
 * has to hand the other kind over. `/tickets` always did. `/seats` did not, and
 * general admission is the direction that actually gets hit, because two
 * screens link to `/seats` with no idea what kind of event it is:
 *
 *   · checkout/Outcomes.jsx  — the failure screen an EXPIRED HOLD lands on
 *   · checkout/success       — "Try again" when Stripe reports not-paid
 *
 * So a general-admission buyer whose card was declined pressed the one recovery
 * button on the page and got "Choose your seats" above "This event has no seat
 * map yet", with nothing further to click. At the moment they were trying to
 * pay us.
 * ─────────────────────────────────────────────────────────────────────────────
 */
// Defined INSIDE the factory: vi.mock is hoisted above every top-level
// binding, so a const declared out here is not initialised when it runs.
vi.mock('next/navigation', () => ({
  // Next's own redirect throws to unwind the render; mirroring that keeps
  // the page modules on the control flow they have in production.
  redirect: vi.fn((url) => { throw new Error(`NEXT_REDIRECT:${url}`); }),
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND'); }),
}));
vi.mock('../src/app/utils/apiClient', () => ({
  serverFetch: vi.fn(),
  PUBLIC_API_URL: 'http://api.test',
}));

import { redirect, notFound } from 'next/navigation';
import { serverFetch } from '../src/app/utils/apiClient';
import SeatsPage from '../src/app/e/[slug]/seats/page';
import TicketsPage from '../src/app/e/[slug]/tickets/page';

const event = (over = {}) => ({
  slug: 'an-evening-on-the-waterfront',
  title: 'An Evening on the Waterfront',
  currency: 'CAD',
  admissionType: 'reserved',
  displayOnly: false,
  purchaseMode: 'seat_only',
  maxTicketsPerOrder: 10,
  ...over,
});

const args = (over = {}) => ({
  params: Promise.resolve({ slug: 'an-evening-on-the-waterfront' }),
  searchParams: Promise.resolve(over),
});

async function urlFrom(page, pageArgs) {
  try {
    await page(pageArgs);
  } catch (err) {
    if (!String(err.message).startsWith('NEXT_REDIRECT:')) throw err;
    return String(err.message).slice('NEXT_REDIRECT:'.length);
  }
  return null;
}

describe('the two picker pages hand over the event they cannot serve', () => {
  beforeEach(() => {
    redirect.mockClear();
    notFound.mockClear();
    serverFetch.mockReset();
  });

  test('/seats sends a general-admission event to the ticket picker', async () => {
    serverFetch.mockResolvedValue(event({ admissionType: 'general' }));
    const to = await urlFrom(SeatsPage, args());
    expect(to).toBe('/e/an-evening-on-the-waterfront/tickets');
  });

  test('/seats carries the chosen tier across with it', async () => {
    serverFetch.mockResolvedValue(event({ admissionType: 'general' }));
    const to = await urlFrom(SeatsPage, args({ tier: 'tier-7' }));
    expect(to).toBe('/e/an-evening-on-the-waterfront/tickets?tier=tier-7');
  });

  test('/seats keeps a reserved event', async () => {
    serverFetch.mockResolvedValue(event());
    await SeatsPage(args());
    expect(redirect).not.toHaveBeenCalled();
  });

  test('/tickets sends a reserved event to the seat map, as it always has', async () => {
    serverFetch.mockResolvedValue(event());
    const to = await urlFrom(TicketsPage, args());
    expect(to).toBe('/e/an-evening-on-the-waterfront/seats');
  });

  test('/tickets keeps a general-admission event', async () => {
    serverFetch.mockResolvedValue(event({ admissionType: 'general' }));
    await TicketsPage(args());
    expect(redirect).not.toHaveBeenCalled();
  });

  // BRD §12 — a listing has nothing behind it, on either page.
  test('a display-only event is a 404 on both, not a redirect loop', async () => {
    for (const page of [SeatsPage, TicketsPage]) {
      serverFetch.mockResolvedValue(event({ displayOnly: true, admissionType: 'general' }));
      await expect(page(args())).rejects.toThrow('NEXT_NOT_FOUND');
      expect(redirect).not.toHaveBeenCalled();
    }
  });
});
