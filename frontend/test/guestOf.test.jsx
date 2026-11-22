import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const post = vi.fn();
vi.mock('../src/app/utils/apiClient', () => ({
  get: vi.fn(), post: (...a) => post(...a), put: vi.fn(), patch: vi.fn(), del: vi.fn(),
}));
let apiData = null;
vi.mock('../src/app/hooks/useApi', () => ({ useApi: () => ({ data: apiData, error: null, loading: false, reload: vi.fn() }) }));
vi.mock('../src/app/components/ui/Toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('../src/app/organizer/events/[id]/EventContext', () => ({ useEventContext: () => ({ event: { timezone: 'America/Toronto', currency: 'CAD' } }) }));

const { default: GuestOfField } = await import('../src/app/checkout/[reservationId]/GuestOfField');
const { rememberGuestOf, recalledGuestOf, pickFromCode } = await import('../src/app/lib/guestOf');
const { guestsCsv } = await import('../src/app/organizer/events/[id]/guests/guestsCsv');
const { default: HostGuests } = await import('../src/app/organizer/events/[id]/guests/HostGuests');

/**
 * Whose guest (2026-11-23, the owner: "the guest says 'I come from the groom',
 * and the groom receives an email").
 */
const ask = (mode = 'optional') => ({
  mode, question: 'Whose guest are you?',
  hosts: [{ id: 'g', name: 'The groom — Ahmed', code: 'the-groom' }, { id: 'b', name: 'The bride — Mona', code: 'the-bride' }],
});

beforeEach(() => { window.localStorage.clear(); post.mockReset(); });

describe('at checkout', () => {
  test('the hosts as choices, in the organizer’s words; optional offers "Prefer not to say"', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<GuestOfField guestOf={ask()} value={null} onChange={onChange} />);
    expect(screen.getByRole('heading', { name: /Whose guest are you\?/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Prefer not to say' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'The bride — Mona' }));
    expect(onChange).toHaveBeenCalledWith('b');
  });

  test('required: no "Prefer not to say", and the refusal is said on the question', () => {
    render(<GuestOfField guestOf={ask('required')} value={null} onChange={() => {}} error="Answer “Whose guest are you?” to continue." />);
    expect(screen.queryByRole('radio', { name: 'Prefer not to say' })).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent(/to continue/);
  });

  test('nothing to ask, nothing drawn', () => {
    const { container } = render(<GuestOfField guestOf={null} value={null} onChange={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('a host’s link is remembered per event and picks them', () => {
    rememberGuestOf('wedding', 'the-bride');
    rememberGuestOf('wedding', 'Not A Code!');
    expect(recalledGuestOf('wedding')).toBe('the-bride');
    expect(recalledGuestOf('other')).toBeNull();
    expect(pickFromCode(ask(), 'the-bride')).toBe('b');
    expect(pickFromCode(ask(), 'nobody')).toBeNull();
  });
});

describe('the organizer', () => {
  test('a CSV per host, quoted, with formula-looking names neutralised', () => {
    const csv = guestsCsv({ name: 'The groom' }, [
      { name: '=HYPERLINK("x")', email: 'a@b.c', phone: null, tickets: 2, totalCents: 0, status: 'paid', bookedAt: '2026-11-23T10:00:00Z' },
    ], 'CAD');
    const [head, row] = csv.trim().split('\r\n');
    expect(head).toBe('"Guest of","Guest","Email","Phone","Tickets","Paid","Status","Booked"');
    expect(row).toContain('"\'=HYPERLINK(""x"")"');
    expect(row).toContain('"Confirmed"');
  });

  test('the page lists each host with their numbers and links, and adds a new one', async () => {
    apiData = {
      settings: { mode: 'optional', question: 'Whose guest are you?', defaultQuestion: 'Whose guest are you?' },
      currency: 'CAD',
      hosts: [{
        id: 'g', name: 'The groom — Ahmed', email: 'groom@x.test', notify: true, code: 'the-groom', active: true,
        link: 'https://site/e/w?guestof=the-groom', listUrl: 'https://site/guests/t', stats: { orders: 3, tickets: 7, revenueCents: 0 },
      }],
      unassigned: { orders: 1, tickets: 1, revenueCents: 0 },
    };
    post.mockResolvedValue({});
    const user = userEvent.setup();
    render(<HostGuests eventId="e1" />);
    expect(screen.getByRole('heading', { name: /The groom — Ahmed/ })).toBeInTheDocument();
    expect(screen.getByText(/emailed on each booking/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Copy invite link/ })).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('e.g. The groom — Ahmed'), 'The bride — Mona');
    await user.click(screen.getByRole('button', { name: /Add host/ }));
    expect(post).toHaveBeenCalledWith('/events/e1/hosts', { name: 'The bride — Mona', email: null, notify: true }, { noRedirect: true });
  });
});
