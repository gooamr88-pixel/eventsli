import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../src/app/utils/apiClient', () => ({ put: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() }));
const reload = vi.fn();
let listed = [];
vi.mock('../src/app/hooks/useApi', () => ({ useApi: () => ({ data: listed, error: null, loading: false, reload }) }));
vi.mock('../src/app/components/ui/Toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('../src/app/components/ui/Confirm', () => ({ useConfirm: () => async () => true }));
vi.mock('../src/app/organizer/events/[id]/EventContext', () => ({ useEventContext: () => ({ event: { currency: 'CAD' } }) }));

import { put, post, patch } from '../src/app/utils/apiClient';
import AddonsPanel from '../src/app/organizer/events/[id]/tiers/AddonsPanel';
import ExtrasList from '../src/app/e/[slug]/tickets/ExtrasList';
import { useExtras, attachExtras } from '../src/app/e/[slug]/tickets/useExtras';
import { ticketFacts } from '../src/app/components/TicketStub';
import ExtrasAdded from '../src/app/checkout/[reservationId]/ExtrasAdded';

/**
 * Ticket add-ons (2026-11-17) in the browser. Since 2026-11-22 "Make it
 * special" is chosen with the tickets, before checkout: it stops at one per
 * ticket and at the organizer's stock, says the organizer delivers them, and
 * the choice goes onto the hold with its token. The ticket lists what it
 * includes.
 */

const offered = [
  { id: 'p', name: 'Photo with the headliner', description: 'After the show', priceCents: 2000, remaining: 5 },
  { id: 's', name: 'Signed poster', description: null, priceCents: 1500, remaining: 0 },
];

/** The extras as the ticket picker and the seat page draw them (2026-11-22). */
function Extras({ addons = offered, tickets = 2 }) {
  const extras = useExtras(addons, tickets);
  return <ExtrasList rows={extras.rows} currency="CAD" organizerName="Northlight Live" tickets={tickets} onSet={extras.set} />;
}

beforeEach(() => { vi.clearAllMocks(); put.mockResolvedValue({}); });

describe('Make it special — chosen with the tickets, before checkout', () => {
  test('renders nothing when the event offers no add-ons', () => {
    const { container } = render(<Extras addons={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('stops at one per ticket on the order', async () => {
    render(<Extras tickets={1} />);
    await userEvent.click(screen.getByRole('button', { name: 'One more Photo with the headliner' }));
    expect(screen.getByRole('button', { name: 'One more Photo with the headliner' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'One fewer Photo with the headliner' })).toBeEnabled();
  });

  test('says sold out when the organizer has none left', () => {
    render(<Extras />);
    expect(screen.getByText('Sold out')).toBeInTheDocument();
  });

  test('says the organizer alone is responsible for delivering add-ons', () => {
    render(<Extras />);
    expect(screen.getByText(/Northlight Live, who alone is responsible/)).toBeInTheDocument();
  });

  test('the choice goes onto the hold with its token; nothing chosen, nothing sent', async () => {
    await attachExtras({ reservationId: 'r1', reservationToken: 'tok' }, [{ addonId: 'p', quantity: 1 }]);
    expect(put).toHaveBeenCalledWith(
      '/public/reservations/r1/addons',
      { lines: [{ addonId: 'p', quantity: 1 }] },
      { headers: { 'x-access-token': 'tok' }, noRedirect: true },
    );
    put.mockClear();
    await attachExtras({ reservationId: 'r1', reservationToken: 'tok' }, []);
    expect(put).not.toHaveBeenCalled();
  });
});

describe('the ticket', () => {
  test('lists the add-ons it includes', () => {
    const facts = ticketFacts({ tierName: 'General Admission', addons: ['Photo with the headliner'] });
    expect(facts).toContainEqual(['Includes', 'Photo with the headliner']);
    expect(ticketFacts({ tierName: 'VIP' }).some(([label]) => label === 'Includes')).toBe(false);
  });
});

describe('AddonsPanel (organizer)', () => {
  test('says the organizer delivers every add-on, before any exist', () => {
    listed = [];
    render(<AddonsPanel eventId="e1" />);
    expect(screen.getByRole('heading', { level: 2, name: /Add-ons/ })).toBeInTheDocument();
    expect(screen.getByText(/You alone are responsible for providing add-ons/)).toBeInTheDocument();
  });

  test('creates one in the event currency, in cents', async () => {
    listed = [];
    post.mockResolvedValue({});
    render(<AddonsPanel eventId="e1" />);
    await userEvent.click(screen.getByRole('button', { name: /Add an add-on/ }));
    await userEvent.type(screen.getByLabelText(/^Name/), 'Photo with the headliner');
    await userEvent.type(screen.getByLabelText(/Price per ticket \(CAD\)/), '25.50');
    await userEvent.type(screen.getByLabelText(/How many available/), '40');
    await userEvent.click(screen.getByRole('button', { name: 'Add add-on' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith(
      '/events/e1/addons',
      { name: 'Photo with the headliner', priceCents: 2550, quantity: 40 },
      { noRedirect: true },
    ));
  });

  test('a sold add-on keeps its price: the field is locked and not sent', async () => {
    listed = [{ id: 'a1', name: 'Photo', description: null, priceCents: 2000, quantity: 10, remaining: 7, sold: 3, isActive: true }];
    patch.mockResolvedValue({});
    render(<AddonsPanel eventId="e1" />);
    expect(screen.getByText('3 sold')).toBeInTheDocument();
    expect(screen.getByText('7 of 10 left')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText(/Price per ticket/)).toBeDisabled();
    const qty = screen.getByLabelText(/How many available/);
    await userEvent.clear(qty);
    await userEvent.type(qty, '20');
    await userEvent.click(screen.getByRole('button', { name: 'Save add-on' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/events/e1/addons/a1', { quantity: 20 }, { noRedirect: true }));
  });
});

describe('add-on pictures', () => {
  test('the buyer sees the organizer\'s picture beside the add-on', () => {
    const { container } = render(<Extras addons={[{ id: 'p', name: 'Photo with the headliner', priceCents: 2000, remaining: 5, imageUrl: 'https://cdn.test/addon-1.jpg' }]} />);
    expect(container.querySelector('img.es-extra__img')?.getAttribute('src')).toBe('https://cdn.test/addon-1.jpg');
  });

  test('removing a picture sends imagePath: null', async () => {
    listed = [{ id: 'a1', name: 'Photo', description: null, priceCents: 2000, quantity: null, remaining: null, sold: 0, isActive: true, imageUrl: 'https://cdn.test/a.jpg' }];
    patch.mockResolvedValue({});
    render(<AddonsPanel eventId="e1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const form = screen.getByRole('button', { name: 'Save add-on' }).closest('form');
    await userEvent.click(within(form).getByRole('button', { name: 'Remove' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save add-on' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/events/e1/addons/a1', { imagePath: null }, { noRedirect: true }));
  });
});

describe('the checkout says whether extras were added (2026-11-22)', () => {
  const base = { currency: 'CAD', addonsOffered: offered, addons: [] };

  test('added: names each extra with its quantity and price, and who delivers it', () => {
    render(<ExtrasAdded quote={{ ...base, addons: [{ addonId: 'p', name: 'Photo with the headliner', quantity: 2, unitPriceCents: 2000 }] }}
      organizerName="Northlight Live" backHref="/e/gala/seats" />);
    expect(screen.getByRole('heading', { name: 'Extras added to your order' })).toBeInTheDocument();
    expect(screen.getByText('Photo with the headliner')).toBeInTheDocument();
    expect(screen.getByText('× 2')).toBeInTheDocument();
    expect(screen.getByText(/Northlight Live, who alone is responsible/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Change' })).toHaveAttribute('href', '/e/gala/seats');
  });

  test('none added on an event that offers some: says so, with the way back', () => {
    render(<ExtrasAdded quote={base} backHref="/e/gala#event-tickets" />);
    expect(screen.getByRole('heading', { name: 'No extras added' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add extras' })).toHaveAttribute('href', '/e/gala#event-tickets');
  });

  test('an event with no add-ons shows nothing', () => {
    const { container } = render(<ExtrasAdded quote={{ currency: 'CAD', addons: [], addonsOffered: [] }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
