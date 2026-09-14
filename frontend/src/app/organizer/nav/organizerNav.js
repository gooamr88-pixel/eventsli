/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The organizer's destination map.
 *
 * Every route here already existed; the sidebar arranges them, it does not
 * replace them, so every deep link an organizer has bookmarked still works.
 *
 * TWO SCOPES, as in fancy. Account items are always available. Event items are
 * about ONE event and mean nothing without one — so when none is chosen they
 * are shown disabled WITH A REASON rather than hidden (an organizer should see
 * that "Door team" exists) or live (a click that opens an empty screen).
 *
 * One real improvement on the pattern it came from: the event is in the PATH
 * (`/organizer/events/<id>/tiers`), not in `?event=`. Fancy's comments record
 * the bug where dropping the query string silently switched an organizer to a
 * different event; with the id in the path that cannot happen.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const EVENT_PATH = new RegExp(`^/organizer/events/(${UUID})(?=/|$)`, 'i');

/** The event a path is about, or null. `/organizer/events/new` is not an event. */
export function eventIdFromPath(pathname) {
  return String(pathname || '').match(EVENT_PATH)?.[1] || null;
}

/**
 * The same section, for another event. Switching from one event's Orders to
 * another's lands on that event's Orders, not on its overview — which is what
 * someone comparing two events is trying to do.
 */
export function pathForEvent(pathname, nextEventId) {
  const current = eventIdFromPath(pathname);
  if (!current) return `/organizer/events/${nextEventId}`;
  return String(pathname).replace(`/organizer/events/${current}`, `/organizer/events/${nextEventId}`);
}

const CHOOSE_FIRST = 'Choose an event first';

export function organizerNavGroups({ eventId }) {
  const item = (key, label, icon, suffix) => ({
    key,
    label,
    icon,
    href: eventId ? `/organizer/events/${eventId}${suffix}` : null,
    disabled: !eventId,
    hint: eventId ? null : CHOOSE_FIRST,
  });

  return [
    {
      id: 'home',
      label: null,
      items: [
        { key: 'dashboard', label: 'Dashboard', icon: 'home', href: '/organizer', exact: true },
        { key: 'events', label: 'Your events', icon: 'calendar', href: '/organizer/events' },
      ],
    },
    {
      id: 'build',
      label: 'Build the event',
      note: eventId ? null : 'Pick an event above to open these.',
      items: [
        item('overview', 'Overview', 'info', ''),
        item('tiers', 'Ticket types', 'ticket', '/tiers'),
        item('map', 'Seat map', 'map', '/map'),
        item('tables', 'Table categories', 'layers', '/tables'),
        item('promos', 'Discounts', 'tag', '/promos'),
      ],
    },
    {
      id: 'sell',
      label: 'Sell',
      items: [
        item('share', 'Share & QR', 'qr', '/share'),
        item('orders', 'Orders', 'receipt', '/orders'),
        item('door', 'Door sales', 'cash', '/door'),
        item('commission', 'Commission', 'percent', '/commission'),
      ],
    },
    {
      id: 'day',
      label: 'On the day',
      items: [
        item('attendees', 'Door list', 'users', '/attendees'),
        item('staff', 'Door team', 'shield', '/staff'),
        item('devices', 'Scanning devices', 'scan', '/devices'),
      ],
    },
    {
      id: 'account',
      label: 'Your account',
      items: [
        { key: 'payouts', label: 'Payouts', icon: 'bank', href: '/organizer/payouts' },
        { key: 'profile', label: 'Profile', icon: 'user', href: '/organizer/profile' },
      ],
    },
  ];
}

/** The phone's bottom bar. "More" opens the drawer and is added by the shell. */
export const ORGANIZER_TABS = ['dashboard', 'events', 'orders', 'attendees'];
