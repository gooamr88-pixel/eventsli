import { test, expect } from 'vitest';
import { render } from '@testing-library/react';
import EventCard, { priceBlock, ctaLabel } from '../src/app/components/EventCard';

const base = {
  slug: 'gala', title: 'Gala', startsAt: '2027-03-14T19:00:00Z', timezone: 'America/Toronto',
  city: 'Toronto', venue: 'Hall', coverUrl: null, fromPriceCents: 2500, currency: 'CAD',
};

// Owner, 2026-11-18: a teaser's date is not known — not the month, not the year.
test('a coming-soon card shows no date at all, only the poster and place', () => {
  const { container } = render(<EventCard event={{ ...base, comingSoon: true, fromPriceCents: null }} />);
  expect(container.querySelector('.es-lp-datebadge')).toBeNull();
  expect(container.textContent).not.toMatch(/2027|Mar/);
  expect(container.textContent).toContain('Coming soon');
});

test('a dated card still shows its date badge', () => {
  const { container } = render(<EventCard event={base} />);
  expect(container.querySelector('.es-lp-datebadge')).not.toBeNull();
});

test('a past event sells nothing: no price, "View event", greyed card', () => {
  const past = { ...base, isPast: true };
  expect(priceBlock(past)).toBeNull();
  expect(ctaLabel(past)).toBe('View event');
  const { container } = render(<EventCard event={past} />);
  expect(container.querySelector('.es-evcard--past')).not.toBeNull();
  expect(container.textContent).toContain('Past event');
});
