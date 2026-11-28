import type { Category, City, EventCard } from '../api/types';

/**
 * What Home shows, decided from the events themselves (2026-11-28, "poster-
 * first" — the owner's choice after Home read as empty on production data:
 * nine events in eight cities, so most rows vanished and the first category
 * tile was one with nothing in it).
 */

/** The categories that have something on, busiest first; all of them if none do. */
export function categoriesWithEvents(cats: Category[], events: EventCard[]): (Category & { count: number })[] {
  const counts = new Map<string, number>();
  for (const e of events) if (e.category) counts.set(e.category, (counts.get(e.category) ?? 0) + 1);
  const withCount = cats.map((c, i) => ({ ...c, count: counts.get(c.slug) ?? 0, i }));
  const live = withCount.filter((c) => c.count > 0).sort((a, b) => b.count - a.count || a.i - b.i);
  return (live.length ? live : withCount).map(({ i: _i, ...c }) => c);
}

/**
 * The "Coming up" list: soonest first, not past, no repeats, and not the ones
 * already on the Trending posters above — unless that would leave fewer than
 * two, when the list shows everything rather than looking empty.
 */
export function comingUp(events: EventCard[], shownAbove: EventCard[], limit = 8): EventCard[] {
  const seen = new Set<string>();
  const sorted = events
    .filter((e) => !e.isPast && !seen.has(e.id) && seen.add(e.id))
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const above = new Set(shownAbove.map((e) => e.id));
  const fresh = sorted.filter((e) => !above.has(e.id));
  return (fresh.length >= 2 ? fresh : sorted).slice(0, limit);
}

/** Cities with events, busiest first — the "By city" chips. */
export function citiesWithEvents(cities: City[] | undefined): City[] {
  return [...(cities ?? [])].filter((c) => c.events > 0).sort((a, b) => b.events - a.events || a.city.localeCompare(b.city));
}
