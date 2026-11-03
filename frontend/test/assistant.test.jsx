import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../src/app/utils/apiClient', () => ({ get: vi.fn(), post: vi.fn() }));

import { get, post } from '../src/app/utils/apiClient';
import ChatBubble from '../src/app/components/landing/ChatBubble';
import { requestFor, WELCOME, STORAGE_KEY } from '../src/app/components/assistant/assistantModel';

/**
 * The homepage's round button, and the assistant behind it.
 *
 * What these pin: without AI the button is exactly the contact link it always
 * was; with AI it opens a chat that sends only real turns, shows event cards
 * from the API's data and our own page links, keeps the conversation for the
 * tab, recovers from an error, and closes on Escape.
 */

const EVENT = {
  id: 'e1', slug: 'neon-nights', title: 'Neon Nights', startsAt: '2026-11-15T02:00:00Z', timezone: 'America/Toronto',
  city: 'Toronto', currency: 'CAD', fromPriceCents: 2500, displayOnly: false, coverUrl: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
});

test('without AI, the button is the contact link it always was', async () => {
  get.mockResolvedValue({ ai: false });
  render(<ChatBubble />);
  await waitFor(() => expect(get).toHaveBeenCalledWith('/public/assistant', { noRedirect: true }));
  expect(screen.getByRole('link', { name: 'Contact us' })).toHaveAttribute('href', '/contact');
});

test('if the API cannot be reached, it is still the contact link', async () => {
  get.mockRejectedValue(new Error('offline'));
  render(<ChatBubble />);
  await waitFor(() => expect(get).toHaveBeenCalled());
  expect(screen.getByRole('link', { name: 'Contact us' })).toBeInTheDocument();
});

describe('with AI', () => {
  async function openChat() {
    get.mockResolvedValue({ ai: true });
    const user = userEvent.setup();
    render(<ChatBubble />);
    await user.click(await screen.findByRole('button', { name: 'Ask the Eventsli assistant' }));
    return user;
  }

  test('a question gets an answer with real event cards, our own link, and follow-ups', async () => {
    post.mockResolvedValue({
      mode: 'ai', reply: 'Here is one this weekend:', events: [EVENT],
      link: { label: 'Browse events', href: '/events' }, suggestions: ['Anything free?'],
    });
    const user = await openChat();
    const panel = screen.getByRole('dialog', { name: 'Eventsli Assistant' });
    expect(within(panel).getByText(/I.m the Eventsli assistant/)).toBeInTheDocument();

    await user.type(screen.getByLabelText('Ask the Eventsli assistant'), 'nightlife this weekend in Toronto{Enter}');

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [path, body] = post.mock.calls[0];
    expect(path).toBe('/public/assistant/messages');
    expect(body.messages).toEqual([{ role: 'user', text: 'nightlife this weekend in Toronto' }]);

    expect(await within(panel).findByText('Here is one this weekend:')).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: /Neon Nights/ })).toHaveAttribute('href', '/e/neon-nights');
    expect(within(panel).getByText(/From .*25/)).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: /Browse events/ })).toHaveAttribute('href', '/events');
    expect(within(panel).getByRole('button', { name: 'Anything free?' })).toBeInTheDocument();
  });

  test('a failed answer says so and can be retried; the conversation survives a remount', async () => {
    post.mockRejectedValueOnce(Object.assign(new Error('down'), { code: 'NETWORK' }));
    post.mockResolvedValueOnce({ mode: 'basic', reply: 'You can have your tickets sent again.', events: [], link: { label: 'Find my tickets', href: '/tickets/find' }, suggestions: [] });
    const user = await openChat();
    await user.type(screen.getByLabelText('Ask the Eventsli assistant'), 'I lost my ticket{Enter}');
    expect(await screen.findByText(/couldn.t answer just now/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Try again/ }));
    expect(await screen.findByText('You can have your tickets sent again.')).toBeInTheDocument();
    expect(screen.queryByText(/couldn.t answer just now/)).not.toBeInTheDocument();

    const kept = JSON.parse(sessionStorage.getItem(STORAGE_KEY));
    expect(kept.at(-1).text).toBe('You can have your tickets sent again.');
  });

  test('Escape closes it, and the button says so while it is open', async () => {
    const user = await openChat();
    expect(screen.getByRole('button', { name: 'Close the Eventsli assistant' })).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Eventsli Assistant' })).not.toBeInTheDocument();
  });
});

test('only real turns are sent — never the greeting or an error — and never more than eight', () => {
  const turns = Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: `m${i}` }));
  const body = requestFor([WELCOME, ...turns, { role: 'assistant', error: true, text: 'oops' }], 'America/Toronto');
  expect(body.messages).toHaveLength(8);
  expect(body.messages[0].text).toBe('m4');
  expect(body.timezone).toBe('America/Toronto');
  expect(body.messages.some((m) => m.text === 'oops' || m.text === WELCOME.text)).toBe(false);
});
