import { useQuery } from '@tanstack/react-query';

import { myTickets } from '../api/endpoints';
import type { Order } from '../api/types';
import { useToken } from '../auth/session';

/**
 * Upcoming until the event ENDS, not until it starts: a show that began an
 * hour ago has not happened yet to somebody standing outside it, and that is
 * exactly when they need the code (ticketController.eventCard says the same).
 */
export function isUpcoming(o: Order, now = Date.now()): boolean {
  if (!o.event) return false;
  const end = Date.parse(o.event.endsAt || o.event.startsAt);
  // No end time: the start plus six hours, so it does not vanish at the door.
  const until = o.event.endsAt ? end : end + 6 * 3_600_000;
  return Number.isFinite(until) && until > now;
}

export function useTickets() {
  const token = useToken();
  return useQuery({
    queryKey: ['tickets'],
    queryFn: () => myTickets(token as string),
    enabled: Boolean(token),
    // The QR is what matters here, and it does not change; a cached list is
    // what shows in a basement with no signal.
    staleTime: 60_000,
    gcTime: 24 * 3_600_000,
  });
}
