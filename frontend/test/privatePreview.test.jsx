import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
const put = vi.fn();
vi.mock('../src/app/utils/apiClient', () => ({
  post: vi.fn(), put: (...a) => put(...a), PUBLIC_API_URL: 'http://api.test/api/v1',
}));
vi.mock('../src/app/components/ui/Toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));

const { default: PrivateEventGate } = await import('../src/app/e/[slug]/PrivateEventGate');
const { default: PrivacyCard } = await import('../src/app/organizer/events/[id]/PrivacyCard');

/**
 * What a private event shows before its password (2026-11-22, the owner:
 * "blur all details and images until it is unlocked — the organizer decides").
 */
const teaser = (over = {}) => ({
  slug: 'gala', preview: 'blur', reveal: ['title', 'organizer'], title: 'The Gala', organizer: { name: 'Host Co' },
  coverUrl: null, blurredCover: true, logoUrl: null, startsAt: null, timezone: null, city: null, passwordRule: null, ...over,
});

describe('the locked page', () => {
  test('blurred: the page shape behind the card, the cover as the tiny blurred copy', () => {
    const { container } = render(<PrivateEventGate event={teaser()} />);
    expect(container.querySelector('.es-pblur')).toBeInTheDocument();
    expect(container.querySelector('.es-pblur')).toHaveAttribute('aria-hidden', 'true');
    const hero = container.querySelector('.es-pgate__img--blur');
    expect(hero).toHaveAttribute('src', 'http://api.test/api/v1/public/events/gala/locked-cover');
    expect(screen.getByRole('heading', { name: 'The Gala' })).toBeInTheDocument();
    expect(screen.getByText('Host Co')).toBeInTheDocument();
  });

  test('the blurred page holds placeholders, not the event’s words', () => {
    const { container } = render(<PrivateEventGate event={teaser()} />);
    expect(container.querySelector('.es-pblur').textContent).toBe('');
  });

  test('card only: no page behind it; a hidden name reads "Private event"', () => {
    const { container } = render(<PrivateEventGate event={teaser({ preview: 'card', title: null, organizer: null, blurredCover: false })} />);
    expect(container.querySelector('.es-pblur')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Private event' })).toBeInTheDocument();
    expect(screen.queryByText(/Hosted by/)).toBeNull();
  });

  test('a shown date and city appear on the card', () => {
    render(<PrivateEventGate event={teaser({ startsAt: '2027-03-14T23:00:00Z', timezone: 'America/Toronto', city: 'Toronto' })} />);
    expect(screen.getByText(/Mar 14, 2027/)).toBeInTheDocument();
    expect(screen.getByText('Toronto')).toBeInTheDocument();
  });

  test('a shown cover is the real one, sharp', () => {
    const { container } = render(<PrivateEventGate event={teaser({ coverUrl: 'https://cdn.test/c.jpg', blurredCover: false })} />);
    expect(container.querySelector('.es-pgate__img:not(.es-pgate__img--blur)')).toHaveAttribute('src', 'https://cdn.test/c.jpg');
  });
});

describe('the organizer decides', () => {
  const event = {
    id: 'e1', slug: 'gala', status: 'published',
    privacy: { isPrivate: true, hasPassword: true, passwordSetAt: '2026-11-22T10:00:00Z', lockedPreview: 'blur', lockedReveal: ['title', 'organizer'] },
  };

  test('choosing the plain box and ticking the city saves both', async () => {
    put.mockResolvedValue({ isPrivate: true });
    const user = userEvent.setup();
    render(<PrivacyCard event={event} />);
    expect(screen.getByRole('radio', { name: /Blurred preview/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Event name' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Cover image, not blurred' })).not.toBeChecked();

    await user.click(screen.getByRole('radio', { name: /Password box only/ }));
    await user.click(screen.getByRole('checkbox', { name: 'City' }));
    await user.click(screen.getByRole('button', { name: /Save privacy/ }));
    expect(put).toHaveBeenCalledWith('/events/e1/privacy', expect.objectContaining({
      isPrivate: true, lockedPreview: 'card', lockedReveal: ['title', 'organizer', 'city'],
    }), { noRedirect: true });
  });

  test('nothing changed, nothing to save', () => {
    render(<PrivacyCard event={event} />);
    expect(screen.getByRole('button', { name: /Save privacy/ })).toBeDisabled();
  });
});
