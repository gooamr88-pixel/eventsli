import { describe, test, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * The exact commission, shown before an event is created (owner, 2026-11-24).
 * Every figure is the API's (backend fees file); the card only says it.
 */
const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../src/app/utils/apiClient', () => api);
const { default: CommissionPreview } = await import('../src/app/components/fees/CommissionPreview');
const { commissionRate } = await import('../src/app/lib/fees');

const terms = (examples) => ({
  currency: 'USD', commissionPct: 1.5, commissionFixedCents: 50, commissionTaxPct: 0, perTicket: true, examples,
});

describe('what Eventsli charges', () => {
  test('the rate, and the commission at a few prices', async () => {
    api.get.mockResolvedValue(terms([
      { priceCents: 1000, commissionCents: 65, commissionTaxCents: 0, youKeepCents: 935 },
      { priceCents: 5000, commissionCents: 125, commissionTaxCents: 0, youKeepCents: 4875 },
    ]));
    render(<CommissionPreview country="US" />);
    expect(await screen.findByText('1.5% + $0.50 per ticket')).toBeInTheDocument();
    expect(screen.getByRole('row', { name: '$10.00 $0.65 $9.35' })).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/organizer/fee-terms?country=US', expect.anything());
  });

  test('typing a price asks for it and shows what the organizer keeps', async () => {
    api.get.mockImplementation(async (path) => terms(path.includes('prices=4000')
      ? [{ priceCents: 4000, commissionCents: 110, commissionTaxCents: 0, youKeepCents: 3890 }]
      : [{ priceCents: 1000, commissionCents: 65, commissionTaxCents: 0, youKeepCents: 935 }]));
    const user = userEvent.setup();
    render(<CommissionPreview country="US" />);
    await user.type(await screen.findByLabelText('Try your ticket price'), '40');
    await waitFor(() => expect(screen.getByText('$38.90')).toBeInTheDocument());
    expect(api.get).toHaveBeenLastCalledWith('/organizer/fee-terms?country=US&prices=4000', expect.anything());
  });

  test('a malformed answer draws nothing rather than breaking the page', async () => {
    api.get.mockResolvedValue({});
    const { container } = render(<CommissionPreview country="US" />);
    await waitFor(() => expect(container.querySelector('.es-fees--loading')).toBeNull());
    expect(container).toBeEmptyDOMElement();
  });

  test('the rate reads plainly with and without a fixed part', () => {
    expect(commissionRate({ commissionPct: 1.5 }, 'USD')).toBe('1.5%');
    expect(commissionRate({ commissionPct: 0, commissionFixedCents: 99 }, 'USD')).toBe('$0.99 per ticket');
  });
});
