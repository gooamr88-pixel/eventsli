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
import AddonPicker from '../src/app/checkout/[reservationId]/AddonPicker';
import { ticketFacts } from '../src/app/components/TicketStub';

/**
 * Ticket add-ons (2026-11-17) in the browser: the checkout's "Make it
 * special" card sends the whole choice with the hold's token, stops at one
 * per ticket and at the organizer's stock, and says the organizer delivers
 * them. The ticket lists what it includes.
 */

const HEADERS = { 'x-access-token': 'tok' };
const quote = (over = {}) => ({
  currency: 'CAD',
  admits: 2,
  addons: [],
  addonsOffered: [
    { id: 'p', name: 'Photo with the headliner', description: 'After the show', priceCents: 2000, remaining: 5 },
    { id: 's', name: 'Signed poster', description: null, priceCents: 1500, remaining: 0 },
  ],
  ...over,
});

function renderPicker(q, onChanged = vi.fn(async () => {})) {
  render(<AddonPicker reservationId="r1" headers={HEADERS} quote={q} organizerName="Northlight Live" onChanged={onChanged} />);
  return onChanged;
}

beforeEach(() => { vi.clearAllMocks(); put.mockResolvedValue({}); });

describe('AddonPicker', () => {
  test('renders nothing when the event offers no add-ons', () => {
    const { container } = render(<AddonPicker reservationId="r1" headers={HEADERS} quote={quote({ addonsOffered: [] })} onChanged={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('adding one sends the whole choice with the hold token, then reloads the quote', async () => {
    const onChanged = renderPicker(quote({ addons: [{ addonId: 's', quantity: 1, name: 'Signed poster', unitPriceCents: 1500 }] }));
    await userEvent.click(screen.getByRole('button', { name: 'One more Photo with the headliner' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(put).toHaveBeenCalledWith(
      '/public/reservations/r1/addons',
      { lines: [{ addonId: 's', quantity: 1 }, { addonId: 'p', quantity: 1 }] },
      { headers: HEADERS, noRedirect: true },
    );
  });

  test('stops at one per ticket on the order', () => {
    renderPicker(quote({ addons: [{ addonId: 'p', quantity: 2, name: 'Photo with the headliner', unitPriceCents: 2000 }] }));
    expect(screen.getByRole('button', { name: 'One more Photo with the headliner' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'One fewer Photo with the headliner' })).toBeEnabled();
  });

  test('stops at the organizer\'s stock, and says sold out when none are left', () => {
    renderPicker(quote({ addonsOffered: [{ id: 'p', name: 'Photo', priceCents: 2000, remaining: 0 }, { id: 's', name: 'Signed poster', priceCents: 1500, remaining: 0 }],
      addons: [{ addonId: 'p', quantity: 1, name: 'Photo', unitPriceCents: 2000 }] }));
    // Its own one counts as available to it; nobody else's.
    expect(screen.getByRole('button', { name: 'One more Photo' })).toBeDisabled();
    expect(screen.getByText('Sold out')).toBeInTheDocument();
  });

  test('says the organizer alone is responsible for delivering add-ons', () => {
    renderPicker(quote());
    expect(screen.getByText(/Northlight Live, who alone is responsible/)).toBeInTheDocument();
  });

  test('a refusal is explained and the quote is reloaded to show what is left', async () => {
    put.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'ADDON_SOLD_OUT' }));
    const onChanged = renderPicker(quote());
    await userEvent.click(screen.getByRole('button', { name: 'One more Photo with the headliner' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That extra is gone');
    expect(onChanged).toHaveBeenCalled();
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
    const q = quote({ addonsOffered: [{ id: 'p', name: 'Photo with the headliner', priceCents: 2000, remaining: 5, imageUrl: 'https://cdn.test/addon-1.jpg' }] });
    const { container } = render(<AddonPicker reservationId="r1" headers={HEADERS} quote={q} organizerName="X" onChanged={vi.fn()} />);
    expect(container.querySelector('img.es-addons__img')?.getAttribute('src')).toBe('https://cdn.test/addon-1.jpg');
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
