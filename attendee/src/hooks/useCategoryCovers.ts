import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { listEvents } from '../api/endpoints';
import type { EventCard } from '../api/types';
import { useSession, useToken } from '../auth/session';

/**
 * A PHOTO FOR EVERY CATEGORY TILE (2026-11-28, the mockup's Home and Explore).
 *
 * The board draws categories as photo tiles; Eventsli's categories carry no
 * picture (`imageUrl` is null on production for all of them). Rather than a
 * stock photo of somebody else's crowd, a tile shows the cover of a REAL
 * upcoming event in that category, in the city being browsed. A category
 * with nothing on gets the branded tile instead (CategoryTile).
 *
 * Same query as Home's upcoming list, so on Home it costs nothing extra.
 */
export function upcomingQuery(city: string | null | undefined, token: string | null) {
  return {
    queryKey: ['events', 'upcoming', city ?? null] as const,
    queryFn: () => listEvents({ city: city ?? undefined, ticketedFirst: true, limit: 30 }, token).then((r) => r.data),
  };
}

export function coversByCategory(...lists: (EventCard[] | null | undefined)[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const list of lists) {
    for (const e of list ?? []) {
      if (!e.category || !e.coverUrl || e.blurredCover || e.isPrivate || out.has(e.category)) continue;
      out.set(e.category, e.coverUrl);
    }
  }
  return out;
}

export function useCategoryCovers(): Map<string, string> {
  const token = useToken();
  const city = useSession((s) => s.city?.city);
  const q = useQuery(upcomingQuery(city, token));
  return useMemo(() => coversByCategory(q.data), [q.data]);
}
