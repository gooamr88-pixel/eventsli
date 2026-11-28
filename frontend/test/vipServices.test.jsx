import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * VIP Services with WhatsApp (2026-11-28): the words and links, the
 * conversation (who wrote, which channel, WhatsApp's ticks), and the request
 * form end to end — what it refuses, what it sends, and the "Continue on
 * WhatsApp" step it lands on.
 */
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../src/app/utils/apiClient', async (orig) => ({ ...(await orig()), get: api.get, post: api.post }));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }) => <a href={href} {...rest}>{children}</a> }));

const { displayPhone, waLink, when, windowLeft } = await import('../src/app/components/vip/vipStatus');
const { default: VipThread, whoWrote } = await import('../src/app/components/vip/VipThread');
const { default: VipSteps } = await import('../src/app/components/vip/VipSteps');
const { default: VipRequestForm } = await import('../src/app/organizer/vip/new/VipRequestForm');

describe('words and links', () => {
  test('the team number reads the North American way', () => {
    expect(displayPhone('+16196666620')).toBe('+1 (619) 666-6620');
    expect(displayPhone('+201001234567')).toBe('+201001234567');
    expect(displayPhone('')).toBe('');
  });

  test('click-to-chat links', () => {
    expect(waLink('+16196666620')).toBe('https://wa.me/16196666620');
    expect(waLink('+16196666620', 'About VIP-7KQ2MX')).toBe('https://wa.me/16196666620?text=About%20VIP-7KQ2MX');
    expect(waLink(null)).toBeNull();
  });

  test('times read relative to a known clock, and as a date without one', () => {
    const now = Date.parse('2026-11-28T12:00:00Z');
    expect(when('2026-11-28T11:58:00Z', now)).toBe('2 min ago');
    expect(when('2026-11-28T09:00:00Z', now)).toBe('3 h ago');
    expect(when('2026-11-28T09:00:00Z', null)).toMatch(/Nov 28/);
    expect(windowLeft('2026-11-28T14:30:00Z', now)).toBe('2 h 30 min');
    expect(windowLeft('2026-11-28T11:00:00Z', now)).toBeNull();
  });

  test('who wrote: the organizer sees first names and Eventsli; the team sees the team', () => {
    expect(whoWrote({ author: 'organizer' }, 'organizer')).toBe('You');
    expect(whoWrote({ author: 'organizer', authorName: 'Sara WA' }, 'team')).toBe('Sara WA');
    expect(whoWrote({ author: 'team', authorName: 'Omar' }, 'organizer')).toBe('Omar · Eventsli');
    expect(whoWrote({ author: 'team', authorName: 'Eventsli team (WhatsApp app)' }, 'organizer')).toBe('Eventsli team');
    expect(whoWrote({ author: 'team', authorName: 'Eventsli team (WhatsApp app)' }, 'team')).toBe('Eventsli team (WhatsApp app)');
    expect(whoWrote({ author: 'system' }, 'organizer')).toBe('Eventsli');
  });
});

describe('the conversation', () => {
  const messages = [
    { id: '1', direction: 'in', channel: 'system', author: 'system', body: 'Request sent: Seat map design.', createdAt: '2026-11-28T10:00:00Z' },
    { id: '2', direction: 'in', channel: 'whatsapp', author: 'organizer', authorName: 'Sara WA', body: 'Here is the hall', createdAt: '2026-11-28T10:05:00Z' },
    { id: '3', direction: 'out', channel: 'whatsapp', author: 'team', authorName: 'Omar', body: 'Got it!', status: 'read', createdAt: '2026-11-28T10:06:00Z' },
    { id: '4', direction: 'out', channel: 'email', author: 'team', authorName: 'Omar', body: 'Bounced one', status: 'failed', error: 'Not delivered on WhatsApp; it was sent by email.', createdAt: '2026-11-28T10:07:00Z' },
  ];

  test('their own messages on their side, the channel on each, and the ticks', () => {
    render(<VipThread messages={messages} viewer="organizer" />);
    expect(screen.getByText('Request sent: Seat map design.')).toBeInTheDocument();
    const mine = screen.getByText('Here is the hall').closest('li');
    expect(mine).toHaveClass('is-mine');
    expect(within(mine).getByText('You')).toBeInTheDocument();
    expect(within(mine).getByText('WhatsApp')).toBeInTheDocument();
    const theirs = screen.getByText('Got it!').closest('li');
    expect(theirs).toHaveClass('is-theirs');
    expect(within(theirs).getByText('Omar · Eventsli')).toBeInTheDocument();
    expect(within(theirs).getByLabelText('Read')).toBeInTheDocument();
    expect(screen.getByText(/sent by email/)).toBeInTheDocument();
  });

  test('the team sees it the other way round', () => {
    render(<VipThread messages={messages} viewer="team" />);
    expect(screen.getByText('Got it!').closest('li')).toHaveClass('is-mine');
    expect(within(screen.getByText('Here is the hall').closest('li')).getByText('Sara WA')).toBeInTheDocument();
  });

  test('steps mark where it stands; a cancelled request says so', () => {
    const { unmount } = render(<VipSteps status="quoted" />);
    expect(screen.getByText('Proposal sent').closest('li')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('Received').closest('li')).toHaveClass('is-done');
    expect(screen.getByText('Completed').closest('li')).toHaveClass('is-next');
    unmount();
    render(<VipSteps status="cancelled" />);
    expect(screen.getByText(/This request is cancelled/)).toBeInTheDocument();
  });
});

describe('the request form', () => {
  const options = {
    settings: {
      enabled: true, whatsappNumber: '+16196666620', email: 'info@eventsli.com', responseTime: 'We reply within a few hours.',
      services: [
        { key: 'seating', icon: 'map', title: 'Seat map design', blurb: 'Your venue drawn.' },
        { key: 'door', icon: 'scan', title: 'Door and check-in team', blurb: 'Staff at the door.' },
      ],
    },
    chatUrl: 'https://wa.me/16196666620?text=Hi',
    events: [{ id: 'e1', title: 'Gala Night', startsAt: '2026-12-31T20:00:00Z', timezone: 'UTC', status: 'draft' }],
    contact: { name: 'Sara Haddad', email: 'sara@example.com', phone: '' },
    budgets: [{ value: '5k_15k', label: '$5,000 – $15,000' }],
  };

  beforeEach(() => {
    api.get.mockReset().mockResolvedValue(options);
    api.post.mockReset();
    window.scrollTo = vi.fn();
    // jsdom has no layout; the form scrolls to the first invalid field.
    Element.prototype.scrollIntoView = vi.fn();
  });

  test('refuses until a service is chosen and the details say something', async () => {
    const user = userEvent.setup();
    render(<VipRequestForm />);
    await screen.findByText('Start a VIP request');
    await user.click(screen.getByRole('radio', { name: /Email/ }));
    await user.click(screen.getByRole('button', { name: /Send request/ }));
    expect(screen.getByText('Choose at least one service.')).toBeInTheDocument();
    expect(screen.getByText(/Tell us a little about what you need/)).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  test('WhatsApp chosen but no number: asks for one, or email', async () => {
    const user = userEvent.setup();
    render(<VipRequestForm />);
    await screen.findByText('Start a VIP request');
    await user.click(screen.getByText('Seat map design'));
    await user.type(screen.getByLabelText(/What do you have in mind/), 'Draw our ballroom, 40 tables.');
    await user.click(screen.getByRole('button', { name: /Send request/ }));
    expect(screen.getByText(/Enter your WhatsApp number, or choose email/)).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  test('sends what was chosen and lands on "Continue on WhatsApp" with the reference', async () => {
    api.post.mockResolvedValue({
      request: { id: 'r1', reference: 'VIP-7KQ2MX' },
      chatUrl: 'https://wa.me/16196666620?text=Hi%20Eventsli%2C%20VIP-7KQ2MX',
    });
    const user = userEvent.setup();
    render(<VipRequestForm />);
    await screen.findByText('Start a VIP request');
    await user.click(screen.getByText('Seat map design'));
    await user.click(screen.getByText('Door and check-in team'));
    await user.type(screen.getByLabelText(/Number of guests/), '400');
    await user.type(screen.getByLabelText(/What do you have in mind/), 'Draw our ballroom, 40 tables.');
    await user.click(screen.getByRole('radio', { name: /Email/ }));
    await user.click(screen.getByRole('button', { name: /Send request/ }));

    expect(api.post).toHaveBeenCalledWith('/organizer/vip', expect.objectContaining({
      services: ['seating', 'door'],
      eventId: 'e1',
      guestCount: 400,
      details: 'Draw our ballroom, 40 tables.',
      contactName: 'Sara Haddad',
      contactEmail: 'sara@example.com',
      whatsappOptIn: false,
      preferredChannel: 'email',
    }));
    expect(await screen.findByText('VIP-7KQ2MX')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Continue on WhatsApp/ });
    expect(link).toHaveAttribute('href', 'https://wa.me/16196666620?text=Hi%20Eventsli%2C%20VIP-7KQ2MX');
    expect(link).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('link', { name: 'Open your request' })).toHaveAttribute('href', '/organizer/vip/r1');
  });

  test('switched off: says so, with the number and the email', async () => {
    api.get.mockResolvedValue({ ...options, settings: { ...options.settings, enabled: false } });
    render(<VipRequestForm />);
    expect(await screen.findByText(/New requests are paused/)).toBeInTheDocument();
    expect(screen.getByText(/\+1 \(619\) 666-6620/)).toBeInTheDocument();
  });
});

describe('for every visitor (2026-11-28)', () => {
  const offer = {
    settings: {
      enabled: true, whatsappNumber: '+16196666620', email: 'info@eventsli.com', responseTime: 'We reply within a few hours.',
      services: [{ key: 'hospitality', icon: 'crown', title: 'VIP guest hospitality', blurb: 'Hosts and arrivals.' }],
    },
    chatUrl: 'https://wa.me/16196666620?text=Hi',
    events: [],
    contact: { name: '', email: '', phone: '' },
    isOrganizer: false,
    budgets: [],
  };

  beforeEach(() => {
    api.get.mockReset().mockResolvedValue(offer);
    api.post.mockReset();
    window.scrollTo = vi.fn();
    Element.prototype.scrollIntoView = vi.fn();
  });

  test('no events to pick: the event name directly, an organization field, and the public endpoint', async () => {
    api.post.mockResolvedValue({
      request: { id: 'v1', reference: 'VIP-HARBQR' }, chatUrl: 'https://wa.me/16196666620?text=x',
      manageUrl: 'https://eventsli.com/vip/request/v1?t=tok', token: 'tok',
    });
    const user = userEvent.setup();
    render(<VipRequestForm mode="visitor" />);
    await screen.findByText('Start a VIP request');
    expect(api.get).toHaveBeenCalledWith('/public/vip', expect.anything());
    expect(screen.queryByLabelText(/^Event$/)).toBeNull();
    await user.click(screen.getByText('VIP guest hospitality'));
    await user.type(screen.getByLabelText(/Event name/), 'Harbour Wedding');
    await user.type(screen.getByLabelText(/What do you have in mind/), 'Hosts for 180 guests, please.');
    await user.type(screen.getByLabelText(/Your name/), 'Mona');
    await user.type(screen.getByRole('textbox', { name: /^Email/ }), 'mona@example.com');
    await user.type(screen.getByLabelText(/Company or organization/), 'Harbour Co');
    await user.click(screen.getByRole('radio', { name: /Email/ }));
    await user.click(screen.getByRole('button', { name: /Send request/ }));

    expect(api.post).toHaveBeenCalledWith('/public/vip/requests', expect.objectContaining({
      services: ['hospitality'], eventName: 'Harbour Wedding', company: 'Harbour Co', contactName: 'Mona', preferredChannel: 'email',
    }));
    expect(api.post.mock.calls[0][1].website).toBeUndefined();
    expect(api.post.mock.calls[0][1].eventId).toBeUndefined();
    expect(await screen.findByRole('link', { name: 'Open your request' })).toHaveAttribute('href', '/vip/request/v1?t=tok');
    expect(screen.queryByRole('link', { name: 'Back to VIP Services' })).toBeNull();
  });

  test('a signed-in organizer is pointed at their dashboard form', async () => {
    api.get.mockResolvedValue({ ...offer, isOrganizer: true });
    render(<VipRequestForm mode="visitor" />);
    expect(await screen.findByText('You have an organizer account.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'dashboard' })).toHaveAttribute('href', '/organizer/vip/new');
  });

  test('the request page talks to the organizer paths, or to the token paths with a visitor link', async () => {
    const { requestApi } = await import('../src/app/organizer/vip/[id]/VipRequest');
    expect(requestApi('r1')).toMatchObject({ get: '/organizer/vip/r1', base: '/organizer/vip/r1', extra: {}, back: '/organizer/vip', visitor: false });
    expect(requestApi('r1', 'a+b')).toMatchObject({
      get: '/public/vip/requests/r1?t=a%2Bb', base: '/public/vip/requests/r1', extra: { t: 'a+b' },
      mediaBase: '/public/vip/requests/r1/media', mediaQuery: '?t=a%2Bb', back: '/vip', visitor: true,
    });
  });
});
