import type { EventCard } from '../src/api/types';
import { withRecent } from '../src/lib/recent';

const ev = (id: string): EventCard => ({
  id, slug: id, title: `Event ${id}`, comingSoon: false, venue: 'Hall', city: 'Cairo', venueAddress: null, timezone: 'Africa/Cairo',
  startsAt: '2026-12-01T18:00:00Z', endsAt: null, isPast: false, category: null, categoryLabel: null, coverUrl: null,
  displayOnly: false, organizer: null, fromPriceCents: null, availability: null,
});

test('the latest view goes first, without duplicates, at most six', () => {
  let items = withRecent([], ev('a'));
  items = withRecent(items, ev('b'));
  items = withRecent(items, ev('a'));
  expect(items.map((x) => x.id)).toEqual(['a', 'b']);
  for (const id of ['c', 'd', 'e', 'f', 'g', 'h']) items = withRecent(items, ev(id));
  expect(items).toHaveLength(6);
  expect(items[0].id).toBe('h');
});

test('keeps only what a card draws, small enough for SecureStore', () => {
  let items = withRecent([], ev('a'));
  for (const id of ['b', 'c', 'd', 'e', 'f']) items = withRecent(items, { ...ev(id), coverUrl: `https://x.supabase.co/storage/v1/object/public/event-media/events/${'9'.repeat(36)}/cover-${'f'.repeat(16)}.jpg` });
  expect(Object.keys(items[0]).sort()).toEqual(['city', 'coverUrl', 'id', 'slug', 'startsAt', 'timezone', 'title', 'venue']);
  expect(JSON.stringify(items).length).toBeLessThan(2048);
});
