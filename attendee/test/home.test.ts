import type { Category, City, EventCard } from '../src/api/types';
import { listedTime } from '../src/lib/format';
import { categoriesWithEvents, citiesWithEvents, comingUp } from '../src/lib/home';

/** Home, poster-first (2026-11-28): what it shows, decided from the events. */
const ev = (id: string, startsAt: string, category: string | null = null, extra: Partial<EventCard> = {}) =>
  ({ id, startsAt, category, isPast: false, ...extra }) as EventCard;
const cat = (slug: string): Category => ({ slug, label: slug, blurb: null, imageUrl: null });

describe('categoriesWithEvents', () => {
  it('keeps only categories with something on, busiest first', () => {
    const out = categoriesWithEvents([cat('bazar'), cat('music'), cat('holiday')], [
      ev('1', '2026-12-01', 'music'), ev('2', '2026-12-02', 'holiday'), ev('3', '2026-12-03', 'holiday'),
    ]);
    expect(out.map((c) => [c.slug, c.count])).toEqual([['holiday', 2], ['music', 1]]);
  });

  it('shows every category when none has events, rather than nothing', () => {
    expect(categoriesWithEvents([cat('a'), cat('b')], []).map((c) => c.slug)).toEqual(['a', 'b']);
  });
});

describe('comingUp', () => {
  const all = [ev('c', '2026-12-31'), ev('a', '2026-12-04'), ev('b', '2026-12-16'), ev('p', '2026-11-01', null, { isPast: true })];

  it('is soonest first, never past, and skips what Trending already shows', () => {
    expect(comingUp(all, [ev('b', '2026-12-16')]).map((e) => e.id)).toEqual(['a', 'c']);
  });

  it('shows everything rather than one lonely row', () => {
    expect(comingUp(all, [ev('a', ''), ev('b', '')]).map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('never repeats an event', () => {
    expect(comingUp([ev('a', '2026-12-04'), ev('a', '2026-12-04'), ev('b', '2026-12-05')], []).map((e) => e.id)).toEqual(['a', 'b']);
  });
});

it('lists cities with events, busiest first', () => {
  const cities: City[] = [{ city: 'Detroit', country: 'US', events: 1 }, { city: 'Mississauga', country: 'CA', events: 2 }, { city: 'Nowhere', country: 'CA', events: 0 }];
  expect(citiesWithEvents(cities).map((c) => c.city)).toEqual(['Mississauga', 'Detroit']);
});

it('leaves out a midnight that only means "no time was entered"', () => {
  expect(listedTime('2026-12-04T05:00:00Z', 'America/New_York')).toBe('');
  expect(listedTime('2026-12-04T01:00:00Z', 'America/New_York')).toBe('8:00 PM');
});
