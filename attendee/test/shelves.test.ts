import type { EventCard } from '../src/api/types';
import { buildShelves } from '../src/lib/shelves';

const ev = (id: string): EventCard => ({
  id, slug: id, title: id, comingSoon: false, venue: null, city: null, venueAddress: null, timezone: null,
  startsAt: '2026-12-01T18:00:00Z', endsAt: null, isPast: false, category: null, categoryLabel: null, coverUrl: null,
  displayOnly: false, organizer: null, fromPriceCents: null, availability: null,
});
const ids = (list: EventCard[]) => list.map((e) => e.id);

test('an event appears in the first row that wants it, and in no other', () => {
  const a = ev('a'); const b = ev('b'); const c = ev('c'); const d = ev('d');
  const { shelves, rest } = buildShelves([
    { key: 'near', events: [a, b] },
    { key: 'popular', events: [a, b, c, d] },
  ], [a, b, c, d]);
  expect(ids(shelves.near)).toEqual(['a', 'b']);
  expect(ids(shelves.popular)).toEqual(['c', 'd']);
  expect(rest).toEqual([]);
});

test('a row with fewer than two left is dropped, and its events fall to the list', () => {
  const a = ev('a'); const b = ev('b'); const c = ev('c');
  const { shelves, rest } = buildShelves([
    { key: 'popular', events: [a, b] },
    { key: 'free', events: [a, c] }, // only c is new: one card is not a shelf
  ], [a, b, c]);
  expect(shelves.free).toEqual([]);
  expect(ids(rest)).toEqual(['c']);
});

test('not loaded yet is simply empty', () => {
  const { shelves, rest } = buildShelves([{ key: 'weekend', events: undefined }], [ev('x')]);
  expect(shelves.weekend).toEqual([]);
  expect(ids(rest)).toEqual(['x']);
});
