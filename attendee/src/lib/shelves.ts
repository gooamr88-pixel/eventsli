import type { EventCard } from '../api/types';

/**
 * Home's rows, without repeats.
 *
 * With a small catalogue — ten events on production today — every row asked
 * for "popular", "this weekend", "free" and "near you" comes back with the
 * same few events, and the page shows one gala four times. So the rows are
 * filled in order of priority: an event goes to the first row that wants it
 * and to no other; a row left with fewer than `min` events is dropped (one
 * card on a shelf reads as broken); and whatever no row took is `rest`, for
 * the plain list at the end — so every event still appears once.
 */
export function buildShelves(
  rows: { key: string; events: EventCard[] | undefined }[],
  all: EventCard[],
  min = 2,
): { shelves: Record<string, EventCard[]>; rest: EventCard[] } {
  const used = new Set<string>();
  const shelves: Record<string, EventCard[]> = {};
  for (const row of rows) {
    const fresh = (row.events ?? []).filter((e) => !used.has(e.id));
    const unique = fresh.filter((e, i) => fresh.findIndex((x) => x.id === e.id) === i);
    if (unique.length >= min) {
      shelves[row.key] = unique;
      unique.forEach((e) => used.add(e.id));
    } else {
      shelves[row.key] = [];
    }
  }
  const rest = all.filter((e, i) => !used.has(e.id) && all.findIndex((x) => x.id === e.id) === i);
  return { shelves, rest };
}
