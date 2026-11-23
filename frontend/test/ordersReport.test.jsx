import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import OrdersReportDoc, { hostTally } from '../src/app/organizer/events/[id]/orders/OrdersReportDoc';
import { reportCss } from '../src/app/organizer/events/[id]/orders/ordersReportCss';
import { summarize } from '../src/app/organizer/events/[id]/orders/ordersExport';
import { paperBox } from '../src/app/organizer/events/[id]/map/print/packGeometry';

const event = { title: 'Ladies Night', slug: 'ladies-night', timezone: 'America/Toronto', startsAt: '2026-12-20T01:00:00Z', venue: 'The Hall', city: 'Toronto' };

const order = (over = {}) => ({
  id: 'a1b2c3d4-0000-4000-8000-000000000000', channel: 'stripe', status: 'paid', currency: 'CAD', tickets: 2,
  buyer: { name: 'Sara Ahmed', email: 'sara@example.com', hasAccount: true }, guestOf: null,
  subtotalCents: 10000, discountCents: 0, taxCents: 1300, buyerPaidCents: 11300,
  commissionCents: 500, organizerNetCents: 10800, manual: null,
  createdAt: '2026-11-20T23:30:00Z', paidAt: '2026-11-20T23:31:00Z',
  ...over,
});

const rows = [
  order(),
  order({
    id: 'ffff0000-0000-4000-8000-000000000000', channel: 'manual', tickets: 3,
    buyer: { name: 'سارة أحمد', email: null, hasAccount: false }, manual: { method: 'cash' },
    subtotalCents: 6000, discountCents: 1000, taxCents: 0, buyerPaidCents: 5000, commissionCents: 300, organizerNetCents: 4700,
    guestOf: { id: 'h1', name: 'The bride' },
  }),
];

function renderDoc(list = rows, filters = { status: 'paid', channel: '', search: '' }) {
  return render(
    <OrdersReportDoc event={event} rows={list} summary={summarize(list, null)} filters={filters} generated="Nov 23, 2026, 2:00 p.m." />,
  );
}

describe('the sales report document', () => {
  it('names the event, the filters and the order count', () => {
    renderDoc(rows, { status: 'paid', channel: 'manual', search: '' });
    expect(screen.getByRole('heading', { level: 1, name: 'Ladies Night' })).toBeInTheDocument();
    expect(screen.getByText('SALES REPORT')).toBeInTheDocument();
    const chips = document.querySelector('.es-orep-chips');
    expect(within(chips).getByText('At the door')).toBeInTheDocument();
    expect(within(chips).getByText('2 orders')).toBeInTheDocument();
  });

  it('shows the KPI tiles and the money from ticket sales down to "To you"', () => {
    renderDoc();
    const kpis = document.querySelector('.es-orep-kpis');
    expect(within(kpis).getByText('Sales')).toBeInTheDocument();
    // 113.00 + 50.00 paid; 108.00 + 47.00 kept.
    expect(within(kpis).getByText(/163\.00/)).toBeInTheDocument();
    expect(within(kpis).getByText(/155\.00/)).toBeInTheDocument();
    const ledger = document.querySelector('.es-orep-ledger');
    expect(within(ledger).getByText('Discounts')).toBeInTheDocument();
    expect(within(ledger).getByText('Eventsli commission')).toBeInTheDocument();
  });

  it('lists every order with a guest column, an RTL-safe name, and a totals row', () => {
    renderDoc();
    const table = document.querySelector('.es-orep-table');
    const body = document.querySelector('.es-orep-table tbody');
    expect(body.querySelectorAll('tr')).toHaveLength(3); // two orders + one total
    expect(within(table).getByRole('columnheader', { name: 'Guest of' })).toBeInTheDocument();
    expect(screen.getByText('سارة أحمد')).toHaveAttribute('dir', 'auto');
    expect(screen.getByText('Door · Cash')).toBeInTheDocument();
    expect(screen.getByText('A1B2C3D4')).toBeInTheDocument();
    expect(body.querySelector('tr.is-total').textContent).toMatch(/Total · 2 orders/);
  });

  it('notes an order\'s add-ons under the buyer, and nothing for an order without', () => {
    renderDoc([
      order({ addons: [{ addonId: 'p', name: 'Photo with the star', quantity: 2, unitPriceCents: 2000, amountCents: 4000 }] }),
      rows[1],
    ]);
    const lines = document.querySelectorAll('.es-orep-addons');
    expect(lines).toHaveLength(1);
    expect(lines[0].textContent).toBe('+ 2 × Photo with the star');
    expect(lines[0]).toHaveAttribute('dir', 'auto');
  });

  it('says so when nothing matches', () => {
    renderDoc([]);
    expect(screen.getByText('No orders match these filters.')).toBeInTheDocument();
    expect(document.querySelector('.es-orep-table')).toBeNull();
  });

  it('tallies hosts busiest first', () => {
    expect(hostTally(rows)).toEqual([{ name: 'The bride', orders: 1, tickets: 3 }]);
  });
});

describe('the report stylesheet', () => {
  const css = reportCss({ box: paperBox('letter', 'portrait'), footer: 'Eventsli · Sales report · "Quoted" \\ night' });

  it('sizes the printed page to the chosen paper and numbers the pages', () => {
    expect(css).toMatch(/size: 216mm 279mm/);
    expect(css).toContain('counter(page)');
    expect(css).toContain('counter(pages)');
  });

  it('escapes the footer text and never uses !important', () => {
    expect(css).toContain('\\"Quoted\\" \\\\ night');
    expect(css).not.toContain('!important');
  });

  it('hides the app behind the report when printing, and keeps the brand colours', () => {
    expect(css).toContain('body > *:not(.es-orep-root) { display: none; }');
    expect(css).toContain('print-color-adjust: exact');
    expect(css).toContain('display: table-header-group');
  });
});
