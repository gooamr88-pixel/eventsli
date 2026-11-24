import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import EventCard, { priceBlock, saleTag, ctaLabel } from '../src/app/components/EventCard';
import EventGridCard, { gridPlace, gridCta } from '../src/app/events/EventGridCard';

/**
 * Private events listed blurred (owner, 2026-11-23): "the point of the blurry
 * image is to list it on the main events page, but nobody can see the details
 * — only the organizer name, the date and the event name".
 *
 * The API sends a private listing as name, organizer and date only (backend
 * test/privateListing.test.js). These cards draw it: the blurred copy of the
 * cover (never the cover itself), a lock, "Private event", "By <organizer>",
 * the date, and "Enter password" — no price, no place.
 */
const privateListing = (over = {}) => ({
  id: 'priv-1', slug: 'sara-and-omar', title: 'Sara & Omar’s Wedding', isPrivate: true,
  startsAt: '2026-12-27T22:00:00Z', endsAt: '2026-12-28T04:00:00Z', timezone: 'America/Toronto', isPast: false,
  organizer: { name: 'Golden Events' }, coverUrl: null, blurredCover: true,
  comingSoon: false, displayOnly: false, venue: null, city: null, venueAddress: null,
  category: null, categoryLabel: null, fromPriceCents: null, availability: null,
  ...over,
});

describe('the card helpers on a private event', () => {
  it('no price, a "Private event" tag and "Enter password"', () => {
    const e = privateListing();
    expect(priceBlock(e)).toBeNull();
    expect(saleTag(e)).toEqual({ kind: 'private', label: 'Private event' });
    expect(ctaLabel(e)).toBe('Enter password');
    expect(gridCta(e)).toBe('Enter password');
    expect(gridPlace(e)).toBe('By Golden Events');
  });

  it('a past private event still says it is over', () => {
    expect(saleTag(privateListing({ isPast: true })).kind).toBe('past');
  });
});

describe.each([
  ['homepage card', EventCard],
  ['/events card', EventGridCard],
])('the %s', (_, Card) => {
  it('shows the name, organizer and date over the blurred cover, with a lock', () => {
    const { container } = render(<Card event={privateListing()} />);
    expect(container.textContent).toContain('Sara & Omar’s Wedding');
    expect(container.textContent).toContain('By Golden Events');
    expect(container.textContent).toMatch(/Dec/);
    expect(container.textContent).toContain('Private event');
    expect(container.textContent).toContain('Enter password');
    expect(container.querySelector('a').getAttribute('href')).toBe('/e/sara-and-omar');

    const img = container.querySelector('.es-privcover__img');
    expect(img.getAttribute('src')).toMatch(/\/public\/events\/sara-and-omar\/locked-cover$/);
    expect(container.querySelector('.es-privcover__lock')).not.toBeNull();
  });

  it('falls back to the coral wash when there is no cover, or the copy fails', () => {
    const { container: none } = render(<Card event={privateListing({ blurredCover: false })} />);
    expect(none.querySelector('.es-privcover__img')).toBeNull();
    expect(none.querySelector('.es-privcover__wash')).not.toBeNull();

    const { container } = render(<Card event={privateListing()} />);
    fireEvent.error(container.querySelector('.es-privcover__img'));
    expect(container.querySelector('.es-privcover__wash')).not.toBeNull();
  });
});

/**
 * "Password box only" is not blurred (owner, 2026-11-24: "I chose password,
 * why is it blurred?"): its card shows the cover it chose to show, sharp, or a
 * plain locked card, and never the blurred stand-in.
 */
describe('a password-box private event on a listing', () => {
  it('shows its chosen cover sharp, not blurred', () => {
    const { container } = render(<EventGridCard event={privateListing({ lockedPreview: 'card', coverUrl: 'https://cdn/adel.jpg', blurredCover: false })} />);
    expect(container.querySelector('.es-privcover--card')).not.toBeNull();
    expect(container.querySelector('.es-privcover__img').getAttribute('src')).toBe('https://cdn/adel.jpg');
  });

  it('with its cover hidden, draws a plain card — never the blurred copy', () => {
    const { container } = render(<EventGridCard event={privateListing({ lockedPreview: 'card', blurredCover: true })} />);
    expect(container.querySelector('.es-privcover--card')).not.toBeNull();
    expect(container.querySelector('.es-privcover__img')).toBeNull();
  });

  it('a blurred-preview event keeps its blur', () => {
    const { container } = render(<EventGridCard event={privateListing({ lockedPreview: 'blur' })} />);
    expect(container.querySelector('.es-privcover--card')).toBeNull();
    expect(container.querySelector('.es-privcover__img').getAttribute('src')).toMatch(/locked-cover$/);
  });
});
