import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * The general-admission ticket picker.
 *
 * Its limits are not the authority — `hold_general` re-checks all three under a
 * row lock, which is what actually prevents an oversell. What this page owes
 * the buyer is being STOPPED BEFORE THEY CHOOSE rather than after: picking six
 * and being refused at the hold means picking again, and on a selling-out event
 * that is the difference between getting in and not.
 *
 * So these tests are about the explanation, and about the three caps binding in
 * the right order.
 */

const push = vi.fn();
const hold = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('../src/app/hooks/useReservation', () => ({
  useReservation: () => ({ hold }),
}));

let payload;
vi.mock('../src/app/hooks/useApi', () => ({
  useApi: () => ({ data: payload, error: null, loading: false, reload: vi.fn() }),
}));

const { default: TicketPicker } = await import('../src/app/e/[slug]/tickets/TicketPicker');

const tier = (over = {}) => ({
  id: 'tier-1',
  name: 'General',
  description: null,
  priceCents: 2500,
  kind: 'general',
  maxPerOrder: null,
  remaining: null,
  soldOut: false,
  onSale: true,
  notYetOnSale: false,
  salesEnded: false,
  salesStartAt: null,
  salesEndAt: null,
  ...over,
});

const event = (tiers, over = {}) => ({
  slug: 'gala', currency: 'CAD', maxTicketsPerOrder: 10, tiers, ...over,
});

beforeEach(() => {
  push.mockReset();
  hold.mockReset();
  payload = event([tier()]);
});

const plus = (name = /one more/i) => screen.getByRole('button', { name });
const minus = (name = /one fewer/i) => screen.getByRole('button', { name });

describe('choosing quantities', () => {
  test('starts at zero with nothing to continue to', () => {
    render(<TicketPicker slug="gala" />);
    expect(screen.getByRole('button', { name: /choose your tickets/i })).toBeDisabled();
    expect(minus()).toBeDisabled();
  });

  test('the running total follows the count', async () => {
    const user = userEvent.setup();
    render(<TicketPicker slug="gala" />);

    await user.click(plus());
    await user.click(plus());

    expect(screen.getByText('2 tickets')).toBeInTheDocument();
    expect(screen.getByText(/50\.00/)).toBeInTheDocument();
  });

  test('a free event says Free rather than a zero amount', async () => {
    payload = event([tier({ priceCents: 0 })]);
    const user = userEvent.setup();
    render(<TicketPicker slug="gala" />);

    await user.click(plus());
    expect(screen.getAllByText('Free').length).toBeGreaterThan(0);
    expect(screen.queryByText(/0\.00/)).toBeNull();
  });

  test('the fee warning appears only when there is something to add fees to', async () => {
    const user = userEvent.setup();
    render(<TicketPicker slug="gala" />);
    expect(screen.queryByText(/booking fees/i)).toBeNull();

    await user.click(plus());
    expect(screen.getByText(/booking fees/i)).toBeInTheDocument();
  });
});

describe('the three caps, in the order they bind', () => {
  test('what is left in the type stops it first', async () => {
    payload = event([tier({ remaining: 2 })]);
    const user = userEvent.setup();
    render(<TicketPicker slug="gala" />);

    await user.click(plus());
    await user.click(plus());
    expect(plus()).toBeDisabled();
    expect(screen.getByText('2 tickets')).toBeInTheDocument();
  });

  test("the type's own per-order cap stops it next", async () => {
    payload = event([tier({ maxPerOrder: 2, remaining: 100 })]);
    const user = userEvent.setup();
    render(<TicketPicker slug="gala" />);

    await user.click(plus());
    await user.click(plus());
    expect(plus()).toBeDisabled();
  });

  test("the EVENT's cap stops a total across several types", async () => {
    // The case a per-type cap alone misses: three of each of two types on an
    // event that allows four in total.
    payload = event(
      [tier({ id: 'a', name: 'Standard' }), tier({ id: 'b', name: 'VIP', kind: 'vip' })],
      { maxTicketsPerOrder: 3 },
    );
    const user = userEvent.setup();
    render(<TicketPicker slug="gala" />);

    await user.click(plus(/one more Standard/i));
    await user.click(plus(/one more Standard/i));
    await user.click(plus(/one more VIP/i));

    expect(screen.getByText('3 tickets')).toBeInTheDocument();
    expect(plus(/one more Standard/i)).toBeDisabled();
    expect(plus(/one more VIP/i)).toBeDisabled();
  });

  test('going back down releases the cap again', async () => {
    payload = event([tier({ remaining: 1 })]);
    const user = userEvent.setup();
    render(<TicketPicker slug="gala" />);

    await user.click(plus());
    expect(plus()).toBeDisabled();

    await user.click(minus());
    expect(plus()).toBeEnabled();
    expect(screen.getByText('0 tickets')).toBeInTheDocument();
  });
});

describe('a type that cannot be bought right now', () => {
  test('sold out says so, and offers no stepper', () => {
    payload = event([tier({ soldOut: true, remaining: 0 })]);
    render(<TicketPicker slug="gala" />);

    expect(screen.getByText('Sold out')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /one more/i })).toBeNull();
  });

  test('"not on sale yet" is a DIFFERENT sentence from sold out', () => {
    // Collapsing the two into "unavailable" tells somebody an early-bird type
    // is gone when it has not opened — one is an invitation to come back and
    // the other is not.
    payload = event([tier({
      onSale: false, notYetOnSale: true, salesStartAt: '2030-01-01T10:00:00.000Z', kind: 'early_bird',
    })]);
    render(<TicketPicker slug="gala" />);

    expect(screen.getByText('Not on sale')).toBeInTheDocument();
    expect(screen.queryByText('Sold out')).toBeNull();
    expect(screen.getByText(/on sale from/i)).toBeInTheDocument();
  });

  test('a nearly-gone type says how many are left; a well-stocked one does not', () => {
    payload = event([tier({ remaining: 3 })]);
    const { unmount } = render(<TicketPicker slug="gala" />);
    expect(screen.getByText(/only 3 left/i)).toBeInTheDocument();
    unmount();

    payload = event([tier({ remaining: 250 })]);
    render(<TicketPicker slug="gala" />);
    expect(screen.queryByText(/left/i)).toBeNull();
  });
});

describe('continuing', () => {
  test('holds exactly what was chosen, then goes to the checkout', async () => {
    hold.mockResolvedValue({ reservationId: 'res-1' });
    payload = event([tier({ id: 'a', name: 'Standard' }), tier({ id: 'b', name: 'VIP', kind: 'vip' })]);
    const user = userEvent.setup();
    render(<TicketPicker slug="gala" />);

    await user.click(plus(/one more Standard/i));
    await user.click(plus(/one more Standard/i));
    await user.click(plus(/one more VIP/i));
    await user.click(screen.getByRole('button', { name: /^continue$/i }));

    await waitFor(() => expect(hold).toHaveBeenCalled());
    const [slug, body] = hold.mock.calls[0];
    expect(slug).toBe('gala');
    // One line per type, with the totals collapsed — not three separate lines
    // of one, which the server would have to add up again.
    expect(body.lines).toEqual(expect.arrayContaining([
      { tierId: 'a', quantity: 2 },
      { tierId: 'b', quantity: 1 },
    ]));
    expect(body.lines).toHaveLength(2);

    await waitFor(() => expect(push).toHaveBeenCalledWith('/checkout/res-1'));
  });

  test('a type stepped back to zero is not sent as a zero line', async () => {
    hold.mockResolvedValue({ reservationId: 'res-1' });
    const user = userEvent.setup();
    render(<TicketPicker slug="gala" />);

    await user.click(plus());
    await user.click(minus());
    await user.click(plus());
    await user.click(screen.getByRole('button', { name: /^continue$/i }));

    await waitFor(() => expect(hold).toHaveBeenCalled());
    expect(hold.mock.calls[0][1].lines).toEqual([{ tierId: 'tier-1', quantity: 1 }]);
  });

  test('losing the stock mid-choice clears the selection rather than keeping it', async () => {
    // A quantity chosen against availability that no longer exists is not a
    // choice the buyer would make again, so it is not silently retried.
    hold.mockRejectedValue(Object.assign(new Error('gone'), { code: 'TIER_SOLD_OUT' }));
    const user = userEvent.setup();
    render(<TicketPicker slug="gala" />);

    await user.click(plus());
    await user.click(screen.getByRole('button', { name: /^continue$/i }));

    await waitFor(() => expect(screen.getByText('0 tickets')).toBeInTheDocument());
    expect(push).not.toHaveBeenCalled();
  });

  test('a refusal is shown, not swallowed', async () => {
    hold.mockRejectedValue(Object.assign(new Error('You can buy at most 4 tickets in one order.'), {
      code: 'PURCHASE_LIMIT_EXCEEDED',
    }));
    const user = userEvent.setup();
    render(<TicketPicker slug="gala" />);

    await user.click(plus());
    await user.click(screen.getByRole('button', { name: /^continue$/i }));

    await waitFor(() => expect(screen.getByText(/at most 4 tickets/i)).toBeInTheDocument());
  });
});

describe('an event with nothing on sale', () => {
  test('says so instead of showing an empty list', () => {
    payload = event([]);
    render(<TicketPicker slug="gala" />);
    expect(screen.getByText(/no tickets yet/i)).toBeInTheDocument();
  });
});
