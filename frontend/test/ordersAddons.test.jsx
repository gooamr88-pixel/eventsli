import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

/**
 * The organizer's Orders list shows each order's add-ons (2026-11-23). The
 * owner reported the section did not show them — the organizer delivers the
 * add-ons, so each order must say which it paid for.
 */
let listed;
vi.mock('../src/app/utils/apiClient', () => ({ get: vi.fn(), put: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() }));
vi.mock('../src/app/hooks/useApi', () => ({ useApi: () => ({ data: listed, error: null, loading: false, reload: vi.fn() }) }));
vi.mock('../src/app/components/ui/Toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('../src/app/organizer/events/[id]/EventContext', () => ({ useEventContext: () => ({ event: { currency: 'CAD', timezone: 'America/Toronto' } }) }));

const { default: Orders } = await import('../src/app/organizer/events/[id]/orders/Orders');
const { addonsText } = await import('../src/app/organizer/events/[id]/orders/ordersExport');

const order = (over = {}) => ({
  id: 'a1b2c3d4-0000-4000-8000-000000000000', channel: 'stripe', status: 'paid', currency: 'CAD', tickets: 2,
  buyer: { name: 'Sara Ahmed', email: 'sara@example.com', hasAccount: true }, guestOf: null,
  subtotalCents: 15500, discountCents: 0, taxCents: 0, buyerPaidCents: 15500,
  commissionCents: 500, organizerNetCents: 15000, manual: null,
  createdAt: '2026-11-20T23:30:00Z', paidAt: '2026-11-20T23:31:00Z', addons: [],
  ...over,
});

const PHOTO = { addonId: 'p', name: 'Photo with the star', quantity: 2, unitPriceCents: 2000, amountCents: 4000 };
const POSTER = { addonId: 's', name: 'Signed poster', quantity: 1, unitPriceCents: 1500, amountCents: 1500 };

function show(rows) {
  listed = { data: rows, meta: { totals: {} }, pagination: { page: 1, totalPages: 1, total: rows.length } };
  return render(<Orders eventId="ev1" />);
}

describe('add-ons on the Orders list', () => {
  it('adds an Add-ons column with each order\'s add-ons and their counts', () => {
    show([
      order({ addons: [PHOTO, POSTER] }),
      order({ id: 'ffff0000-0000-4000-8000-000000000000', buyer: { name: 'Omar', email: 'o@example.com' }, addons: [] }),
    ]);
    const table = screen.getAllByRole('table')[0];
    expect(within(table).getByRole('columnheader', { name: 'Add-ons' })).toBeInTheDocument();
    const saraRow = within(table).getByText('Sara Ahmed').closest('tr');
    expect(saraRow.textContent).toMatch(/2\s*×\s*Photo with the star/);
    expect(saraRow.textContent).toMatch(/1\s*×\s*Signed poster/);
    const omarRow = within(table).getByText('Omar').closest('tr');
    expect(omarRow.textContent).toContain('—');
  });

  it('leaves the column out when no order on the page has add-ons', () => {
    show([order(), order({ id: 'b', addons: undefined })]);
    expect(screen.queryByRole('columnheader', { name: 'Add-ons' })).toBeNull();
  });

  it('writes an order\'s add-ons as one line for the exports', () => {
    expect(addonsText(order({ addons: [PHOTO, POSTER] }))).toBe('2 × Photo with the star, 1 × Signed poster');
    expect(addonsText(order())).toBe('');
    expect(addonsText({})).toBe('');
  });
});
