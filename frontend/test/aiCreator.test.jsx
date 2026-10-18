import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('../src/app/utils/apiClient', () => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));

import { get, post, patch } from '../src/app/utils/apiClient';
import AiCreator from '../src/app/organizer/events/new/ai/AiCreator';
import { TypeChooser } from '../src/app/organizer/events/new/WizardParts';
import { resetCategoriesForTests } from '../src/app/hooks/useCategories';
import { RESULT } from './aiDraftFixture';

/**
 * The Smart Event Creator, end to end in the browser, against a mocked API.
 *
 * What these pin: the AI card is offered only when the API says AI is on; a
 * generation that fails says it cost nothing; a draft is saved through the
 * ordinary endpoints in order and lands on the event; and the two owner rules
 * the review screen enforces — the organizer, not the AI, fills a missing end
 * time and an unpriced ticket (D-018) — actually block Continue.
 */

const ORGANIZER = { country: 'CA', payments: { choices: ['manual'] } };
const QUOTA = { enabled: true, limit: 2, used: 0, remaining: 2, nextAvailableAt: null };
const TEXT = 'Diwali Gala Dinner 2026, Saturday November 7 from 6:30pm at the Palais Royale, Toronto. General $95.';

function api({ quota = QUOTA } = {}) {
  get.mockImplementation(async (path) => {
    if (path === '/ai/quota') return quota;
    if (path.startsWith('/public/event-categories')) return { labelled: [{ slug: 'gala', label: 'Galas & banquets' }, { slug: 'other', label: 'Everything else' }] };
    return {};
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetCategoriesForTests();
  sessionStorage.clear();
  if (!globalThis.crypto?.randomUUID) globalThis.crypto = { ...globalThis.crypto, randomUUID: () => '00000000-0000-4000-8000-000000000000' };
});

describe('the entry', () => {
  test('offers AI only when the API says it is on', async () => {
    api();
    render(<TypeChooser />);
    expect(await screen.findByRole('link', { name: /Describe it, and we.ll draft it/ })).toHaveAttribute('href', '/organizer/events/new?mode=ai');
    expect(screen.getByText(/2 of 2 AI drafts left today/)).toBeInTheDocument();
  });

  test('an admin is told why there is no AI card, instead of being left to look for it', async () => {
    api({ quota: { ...QUOTA, enabled: false, reason: 'ADMIN_ACCOUNT' } });
    render(<TypeChooser />);
    expect(await screen.findByText(/offered to organizer accounts only/)).toBeInTheDocument();
    expect(screen.queryByText(/we.ll draft it/)).not.toBeInTheDocument();
  });

  test('without AI the page is the two manual choices it always was', async () => {
    api({ quota: { ...QUOTA, enabled: false } });
    render(<TypeChooser />);
    await waitFor(() => expect(get).toHaveBeenCalledWith('/ai/quota', expect.anything()));
    expect(screen.queryByText(/we.ll draft it/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Ticketed event/ })).toBeInTheDocument();
  });
});

describe('describe', () => {
  test('Generate waits for enough to work from, and says why', async () => {
    api();
    const user = userEvent.setup();
    render(<AiCreator organizer={ORGANIZER} />);
    await user.type(screen.getByLabelText('About your event'), 'Gala on Saturday');
    await user.click(screen.getByRole('button', { name: /Generate draft/ }));
    expect(screen.getByText(/at least 40 characters/)).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  test('with today’s drafts used, Generate is off and the way out is offered', async () => {
    api({ quota: { ...QUOTA, used: 2, remaining: 0, nextAvailableAt: '2026-10-19T18:14:00Z' } });
    render(<AiCreator organizer={ORGANIZER} />);
    expect(await screen.findByText(/used today.s 2 AI drafts/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Generate draft/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Set it up yourself now/ })).toBeInTheDocument();
  });

  test('a failed generation says it cost nothing, and keeps the text', async () => {
    api();
    post.mockRejectedValueOnce(Object.assign(new Error('down'), { code: 'AI_UNAVAILABLE' }));
    const user = userEvent.setup();
    render(<AiCreator organizer={ORGANIZER} />);
    fireEvent.change(screen.getByLabelText('About your event'), { target: { value: TEXT } });
    await user.click(screen.getByRole('button', { name: /Generate draft/ }));
    expect(await screen.findByText(/didn.t use any of your AI drafts/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Change the description/ }));
    expect(screen.getByLabelText('About your event')).toHaveValue(TEXT);
  });

  test('the description is handed to the manual wizard, so nothing is retyped', async () => {
    api({ quota: { ...QUOTA, remaining: 0 } });
    const user = userEvent.setup();
    render(<AiCreator organizer={ORGANIZER} />);
    fireEvent.change(screen.getByLabelText('About your event'), { target: { value: TEXT } });
    await user.click(await screen.findByRole('button', { name: /Set it up yourself now/ }));
    expect(push).toHaveBeenCalledWith('/organizer/events/new?type=ticketed');
    expect(JSON.parse(sessionStorage.getItem('eventsli.newEvent.ticketed')).form.description).toBe(TEXT);
  });
});

describe('review and save', () => {
  async function toReview(user) {
    api();
    post.mockImplementation(async (path) => {
      if (path === '/ai/event-drafts') return RESULT;
      if (path === '/events') return { id: 'evt-9' };
      return {};
    });
    patch.mockResolvedValue({});
    render(<AiCreator organizer={ORGANIZER} />);
    fireEvent.change(screen.getByLabelText('About your event'), { target: { value: TEXT } });
    await user.click(screen.getByRole('button', { name: /Generate draft/ }));
    await screen.findByText('Your draft is ready');
  }

  test('the draft is shown as the event page, with only the two problems flagged', async () => {
    const user = userEvent.setup();
    await toReview(user);
    const body = post.mock.calls[0][1];
    expect(body).toMatchObject({ listingType: 'ticketed', country: 'CA', description: TEXT });
    expect(body.requestId).toBeTruthy();

    // The page itself; the desktop rail repeats the problems as its own list.
    const page = screen.getByRole('article', { name: 'Your event page' });
    expect(within(page).getByRole('heading', { level: 1, name: 'Diwali Gala Dinner 2026' })).toBeInTheDocument();
    expect(screen.getByText('2 things need you')).toBeInTheDocument();
    expect(within(page).getByText('When does it end?')).toBeInTheDocument();
    expect(within(page).getByText('No price in your description.')).toBeInTheDocument();
    expect(within(page).getByText('$95')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Continue/ })).not.toBeInTheDocument();
  });

  test('fixing both, then saving, creates a private draft through the ordinary endpoints in order', async () => {
    const user = userEvent.setup();
    await toReview(user);

    await user.click(screen.getByRole('button', { name: /Edit When and where/ }));
    const when = screen.getByRole('dialog', { name: 'When and where' });
    fireEvent.change(within(when).getByLabelText(/Ends/), { target: { value: '2026-11-07T23:30' } });
    expect(within(when).getByText(/You wrote: .Saturday November 7 from 6:30pm./)).toBeInTheDocument();
    await user.click(within(when).getByRole('button', { name: 'Done' }));

    await user.click(screen.getByRole('button', { name: /Edit Tickets/ }));
    const tickets = screen.getByRole('dialog', { name: 'Tickets' });
    expect(within(tickets).getByText(/has no price for this one/)).toBeInTheDocument();
    const free = within(tickets).getAllByLabelText(/This ticket is free/)[1];
    await user.click(free);
    await user.click(within(tickets).getByRole('button', { name: 'Done' }));

    expect(screen.getByText('Ready')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Continue/ }));
    expect(screen.getByRole('heading', { name: 'How buyers pay' })).toBeInTheDocument();
    expect(screen.getByText(/AI never sets payments or fees/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/organizer/events/evt-9?created=1'));
    const calls = [...post.mock.calls.slice(1).map(([p]) => p), ...patch.mock.calls.map(([p]) => `PATCH ${p}`)];
    expect(calls).toEqual(['/events', '/events/evt-9/tiers', '/events/evt-9/tiers', '/events/evt-9/schedule', 'PATCH /events/evt-9']);
    const [, event] = post.mock.calls.find(([p]) => p === '/events');
    expect(event).toMatchObject({ aiGenerationId: 'gen-1', admissionType: 'reserved', paymentOption: 'manual' });
    expect(event).not.toHaveProperty('status');
    const tiers = post.mock.calls.filter(([p]) => p.endsWith('/tiers')).map(([, b]) => b.priceCents);
    expect(tiers).toEqual([9500, 0]);
    expect(sessionStorage.getItem('eventsli.newEvent.ai')).toBe(null);
  });

  test('a ticket type that fails to save is named, and retrying adds only that one', async () => {
    const user = userEvent.setup();
    await toReview(user);
    await user.click(screen.getByRole('button', { name: /Edit When and where/ }));
    fireEvent.change(within(screen.getByRole('dialog')).getByLabelText(/Ends/), { target: { value: '2026-11-07T23:30' } });
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Done' }));
    await user.click(screen.getByRole('button', { name: /Edit Tickets/ }));
    await user.click(within(screen.getByRole('dialog')).getAllByLabelText(/This ticket is free/)[1]);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Done' }));
    await user.click(screen.getByRole('button', { name: /Continue/ }));

    let failOnce = true;
    post.mockImplementation(async (path, body) => {
      if (path === '/events') return { id: 'evt-9' };
      if (path.endsWith('/tiers') && body.name === 'General' && failOnce) {
        failOnce = false;
        throw Object.assign(new Error('Already exists.'), { code: 'DUPLICATE_TIER' });
      }
      return {};
    });
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText(/Saved, with one thing to add/)).toBeInTheDocument();
    expect(screen.getByText('General')).toBeInTheDocument();

    post.mockClear();
    await user.click(screen.getByRole('button', { name: /Try adding them again/ }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/organizer/events/evt-9?created=1'));
    expect(post.mock.calls.map(([p, b]) => `${p} ${b.name}`)).toEqual(['/events/evt-9/tiers General']);
  });
});
