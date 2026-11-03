/**
 * How an event presents in the organizer's lists — the dashboard's Your events
 * and the Your events page — so the two cannot disagree about what to call it.
 *
 * WHEN comes from the clock, WHAT from the status. A published event whose
 * doors are open reads "Ongoing", and one that has ended reads "Past"; every
 * other status names itself, because a draft dated last week is still a draft.
 */

const LOOKS = {
  draft: ['Draft', 'warning', 'pencil'],
  pending_review: ['In review', 'info', 'clock'],
  rejected: ['Changes needed', 'warning', 'alert'],
  published: ['Published', 'success', 'check'],
  suspended: ['Suspended', 'danger', 'ban'],
  cancelled: ['Cancelled', 'muted', 'ban'],
  completed: ['Past', 'muted', 'check'],
  archived: ['Archived', 'muted', 'archive'],
};

export function whenOf(event, now) {
  const starts = Date.parse(event.startsAt);
  const ends = Date.parse(event.endsAt || event.startsAt);
  if (starts > now) return 'upcoming';
  if (ends >= now) return 'ongoing';
  return 'past';
}

/** `[label, tone, icon]`. `now` null (before the clock is read) = status only. */
export function eventLook(event, now) {
  if (event.status === 'published' && now !== null && now !== undefined) {
    const when = whenOf(event, now);
    if (when === 'ongoing') return ['Ongoing', 'info', 'refresh'];
    if (when === 'past') return ['Past', 'muted', 'check'];
  }
  return LOOKS[event.status] || [event.status, 'muted', 'info'];
}

/** "Nov 15, 2026", or "Nov 1 – Nov 3, 2026" across days, in the event's zone. */
export function dateRange(event) {
  const start = new Date(event.startsAt);
  const end = new Date(event.endsAt || event.startsAt);
  if (Number.isNaN(start.getTime())) return '—';
  let fmt;
  try {
    fmt = new Intl.DateTimeFormat('en-US', { timeZone: event.timezone, month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    fmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  if (Number.isNaN(end.getTime()) || fmt.format(start) === fmt.format(end)) return fmt.format(start);
  return fmt.formatRange ? fmt.formatRange(start, end) : `${fmt.format(start)} – ${fmt.format(end)}`;
}

/**
 * One shape for both lists: the events-list row (`venue: { name }`,
 * `cover: { url }`) and the dashboard's insight row (`venue`, `coverUrl`),
 * with this page's per-event figures folded in when there are some.
 */
export function toCard(event, figures) {
  const f = figures?.[event.id] || {};
  return {
    id: event.id,
    slug: event.slug,
    title: event.title,
    status: event.status,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    timezone: event.timezone,
    city: event.city || null,
    venue: typeof event.venue === 'string' ? event.venue : event.venue?.name || null,
    coverUrl: event.coverUrl || event.cover?.url || null,
    listingType: event.listingType || null,
    sold: f.sold ?? event.sold ?? null,
    capacity: f.capacity ?? event.capacity ?? null,
    grossCents: f.grossCents ?? null,
    currency: f.currency || event.currency || null,
  };
}
