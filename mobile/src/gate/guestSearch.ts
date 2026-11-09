/**
 * What the guest list asks the server for.
 *
 * Browsing, the filter decides: "Not yet" (the default: who is still to come),
 * "Checked in", or "Everyone". Searching, it does not. A person typed a name to
 * find someone, and "Nobody matches" for a guest who is already inside reads
 * as "not on the list". That was the bug on the phone: after most of the
 * guests had been scanned, searching "John" under "Not yet" found nobody.
 * Each result still shows whether that guest is in.
 */

export type GuestFilter = 'out' | 'in' | 'all';

export type GuestQuery = { q: string; status: GuestFilter; searching: boolean };

export function guestQuery(typed: string, filter: GuestFilter): GuestQuery {
  const q = typed.replace(/\s+/g, ' ').trim();
  return q ? { q, status: 'all', searching: true } : { q: '', status: filter, searching: false };
}

const FILTER_NOUN: Record<GuestFilter, string> = {
  out: 'not yet in',
  in: 'checked in',
  all: 'on the list',
};

/** The line above the list: what it is showing. */
export function guestCountLine(total: number, query: GuestQuery): string {
  const guests = `${total.toLocaleString()} guest${total === 1 ? '' : 's'}`;
  return query.searching
    ? `${guests} ${total === 1 ? 'matches' : 'match'} “${query.q}”`
    : `${guests} ${FILTER_NOUN[query.status]}`;
}

/** The empty list, which should say what to try next. */
export function guestEmpty(query: GuestQuery): { title: string; body: string } {
  if (query.searching) {
    return {
      title: `Nobody on the guest list matches “${query.q}”`,
      body: 'Check the spelling, or try their email or the start of the ticket number.',
    };
  }
  if (query.status === 'out') return { title: 'Everyone is in', body: 'Every guest on the list has checked in.' };
  if (query.status === 'in') return { title: 'Nobody is in yet', body: 'Guests appear here as they check in.' };
  return { title: 'No guests yet', body: 'Tickets appear here once they are sold.' };
}
