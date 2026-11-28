import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

vi.mock('next/link', () => ({ default: ({ href, children, ...rest }) => <a href={href} {...rest}>{children}</a> }));
// next/image needs a configured loader; a plain <img> is all the test reads.
// eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
vi.mock('next/image', () => ({ default: ({ fill, priority, ...rest }) => <img {...rest} /> }));

const { default: EventGridCard } = await import('../src/app/events/EventGridCard');
const { default: EventPartners, partnerRows, partnerRow, monogram } = await import('../src/app/events/EventPartners');

/**
 * /events (owner, 2026-11-28): completed events stay listed with a
 * "Completed" badge, and every card carries its sponsors and vendors at its
 * foot — logos (or monograms), the first names and "+N".
 */
const event = (over = {}) => ({
  id: 'e1', slug: 'gala', title: 'Gala Night', isPrivate: false, isPast: false,
  startsAt: '2026-12-31T23:00:00Z', endsAt: '2027-01-01T03:00:00Z', timezone: 'America/Toronto',
  venue: 'The Hall', city: 'Toronto', venueAddress: null, coverUrl: null,
  comingSoon: false, displayOnly: false, currency: 'CAD', fromPriceCents: 5000, availability: null,
  ...over,
});

const partners = {
  sponsors: [
    { name: 'Headline Bank', logoUrl: 'https://cdn.example/bank.png', level: 'headline' },
    { name: 'Partner Co', logoUrl: null, level: 'partner' },
    { name: 'Third Brand', logoUrl: null, level: 'partner' },
  ],
  sponsorCount: 5,
  vendors: [{ name: 'Taco Stand', logoUrl: null, category: 'Food' }],
  vendorCount: 1,
};

describe('the partner rows', () => {
  it('monograms from a brand name', () => {
    expect(monogram('Headline Bank')).toBe('HB');
    expect(monogram('acme')).toBe('AC');
    expect(monogram('')).toBe('?');
  });

  it('a headline sponsor makes it "Presented by"; names, logos and +N from the totals', () => {
    const [s, v] = partnerRows(partners);
    expect(s).toMatchObject({ kind: 'sponsor', label: 'Presented by', names: 'Headline Bank, Partner Co', more: 3, count: 5 });
    expect(s.logos).toHaveLength(3);
    expect(v).toMatchObject({ kind: 'vendor', label: 'Vendor', names: 'Taco Stand', more: 0 });
  });

  it('plain sponsors are "Sponsors"; nobody at all is nothing', () => {
    expect(partnerRow([{ name: 'A', level: 'gold' }, { name: 'B', level: 'silver' }], 2, 'sponsor').label).toBe('Sponsors');
    expect(partnerRow([], 0, 'vendor')).toBeNull();
    expect(partnerRows({ sponsors: [], sponsorCount: 0, vendors: [], vendorCount: 0 })).toBeNull();
    expect(partnerRows(undefined)).toBeNull();
    const { container } = render(<EventPartners partners={{ sponsors: [], sponsorCount: 0, vendors: [], vendorCount: 0 }} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('the card', () => {
  it('an upcoming card: its partners at the foot, no Completed badge', () => {
    const { container } = render(<EventGridCard event={event({ partners })} />);
    expect(screen.queryByText('Completed')).toBeNull();
    const band = container.querySelector('.es-evx-partners');
    expect(band).not.toBeNull();
    expect(within(band).getByText('Presented by')).toBeInTheDocument();
    expect(within(band).getByText(/Headline Bank, Partner Co/)).toBeInTheDocument();
    expect(within(band).getByText('+3')).toBeInTheDocument();
    expect(within(band).getByText('Taco Stand')).toBeInTheDocument();
    // A logo where there is one, a monogram where there is not.
    expect(band.querySelector('img').getAttribute('src')).toBe('https://cdn.example/bank.png');
    expect(within(band).getByText('PC')).toBeInTheDocument();
    // Still one link: the band is inside the card's anchor, not a second one.
    expect(container.querySelectorAll('a')).toHaveLength(1);
    expect(band.closest('a')).toHaveAttribute('href', '/e/gala');
  });

  it('a completed card: the badge over the poster, the past styling, its partners kept', () => {
    const { container } = render(<EventGridCard event={event({ isPast: true, partners })} />);
    const link = container.querySelector('a');
    expect(link).toHaveClass('es-evx-card--past');
    const badge = container.querySelector('.es-evx-done');
    expect(badge).toHaveTextContent('Completed');
    expect(badge.closest('.es-evx-card__media')).not.toBeNull();
    // The foot's tag says it too (shown on phones, where the badge is hidden).
    expect(container.querySelector('.es-evx-card__tag--past')).toHaveTextContent('Completed');
    expect(screen.getByText('View event')).toBeInTheDocument();
    expect(container.querySelector('.es-evx-partners')).not.toBeNull();
  });

  it('no partners sent (an older API): no band', () => {
    const { container } = render(<EventGridCard event={event()} />);
    expect(container.querySelector('.es-evx-partners')).toBeNull();
  });
});

describe('"Become a sponsor / vendor" under the cards (2026-11-28)', async () => {
  const { default: EventCard } = await import('../src/app/components/EventCard');
  const { openCallLinks } = await import('../src/app/components/OpenCalls');

  it('a badge for each programme the organizer opened, sponsors first, to that event\'s pages', () => {
    expect(openCallLinks(event({ openCalls: { sponsors: true, vendors: true } })).map((l) => [l.label, l.href]))
      .toEqual([['Become a sponsor', '/e/gala/sponsor'], ['Become a vendor', '/e/gala/vendors']]);
    expect(openCallLinks(event({ openCalls: { sponsors: false, vendors: true } })).map((l) => l.kind)).toEqual(['vendor']);
    expect(openCallLinks(event({ openCalls: { sponsors: false, vendors: false } }))).toEqual([]);
    expect(openCallLinks(event())).toEqual([], 'an older API sends no flags');
    expect(openCallLinks(event({ isPast: true, openCalls: { sponsors: true, vendors: true } }))).toEqual([], 'nobody joins a finished event');
  });

  it('on the /events card: under it, as their own links, never inside the card\'s link', () => {
    const { container } = render(<EventGridCard event={event({ openCalls: { sponsors: true, vendors: true } })} />);
    const nav = screen.getByRole('navigation', { name: 'Partner with Gala Night' });
    expect(within(nav).getByRole('link', { name: /Become a sponsor/ })).toHaveAttribute('href', '/e/gala/sponsor');
    expect(within(nav).getByRole('link', { name: /Become a vendor/ })).toHaveAttribute('href', '/e/gala/vendors');
    expect(nav.closest('.es-evx-card')).toBeNull();
    expect(container.querySelector('.es-evx-cardwrap')).not.toBeNull();
    container.querySelectorAll('a a').forEach(() => { throw new Error('a link inside a link'); });
  });

  it('on the homepage card too; and no badges, no extra wrapper on /events', () => {
    const { container, unmount } = render(<EventCard event={event({ openCalls: { sponsors: false, vendors: true } })} />);
    const badge = screen.getByRole('link', { name: /Become a vendor/ });
    expect(badge.closest('.es-evcard')).toBeNull();
    expect(badge.closest('.es-evcard-wrap')).not.toBeNull();
    expect(screen.queryByRole('link', { name: /Become a sponsor/ })).toBeNull();
    expect(container.querySelectorAll('a a')).toHaveLength(0);
    unmount();
    const plain = render(<EventGridCard event={event({ openCalls: { sponsors: false, vendors: false } })} />);
    expect(plain.container.querySelector('.es-evx-cardwrap')).toBeNull();
    expect(plain.container.querySelector('.es-opencalls')).toBeNull();
  });
});
