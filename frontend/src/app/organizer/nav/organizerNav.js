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

/**
 * What a DISPLAY-ONLY event has. It sells nothing, so ticket types, the seat
 * map, orders, the door and every other selling screen would be empty rooms —
 * they are not shown at all for it, rather than shown and useless.
 */
/* `details` IS IN HERE, and leaving it out would be the bug this set invites.
   A listing sells nothing — but it still has a name, a date, a venue and a
   description, and that form is the only place they are edited. Everything
   else dropped here is a SELLING screen; the event's own fields are not one. */
const DISPLAY_ONLY_KEYS = new Set(['overview', 'details', 'share']);

/**
 * WHAT A GENERAL-ADMISSION EVENT DOES NOT HAVE.
 *
 * A seat map, and the table categories that only exist to colour one. Until
 * general admission existed, every ticketed event needed a venue drawn — so an
 * organizer running a conference or a club night had to build a fictional
 * seating plan before they could sell anything, and the two screens that
 * demanded it sat in the sidebar as permanent unfinished work.
 *
 * Hidden rather than disabled. A disabled item with a reason is right when the
 * thing exists and is not reachable YET (that is what "choose an event first"
 * is for); these do not exist for this event at all, and never will while it is
 * general admission.
 */
const RESERVED_ONLY_KEYS = new Set(['map', 'tables']);

/**
 * `admissionType` gates the seat map; `listingType` gates everything that
 * sells. Both are plain columns on the event, so the sidebar can decide from
 * the list it already loads without a request per event.
 *
 * Deliberately NOT gated on whether the event is free. That answer needs every
 * ticket type's price — a query per event, for a sidebar that renders on every
 * page — and the only items it would change are Door sales and Commission,
 * which are merely empty on a free event rather than misleading. The launch
 * checklist, which has one event's full detail, is where free is handled.
 */
export function organizerNavGroups({
  eventId, listingType = null, admissionType = null,
}) {
  const displayOnly = listingType === 'display_only';
  const generalAdmission = admissionType === 'general';
  const item = (key, label, icon, suffix) => ({
    key,
    label,
    icon,
    href: eventId ? `/organizer/events/${eventId}${suffix}` : null,
    disabled: !eventId,
    hint: eventId ? null : CHOOSE_FIRST,
  });

  const account = {
    id: 'account',
    label: 'Your account',
    items: [
      { key: 'payments', label: 'Payments', icon: 'bank', href: '/organizer/payments' },
      { key: 'profile', label: 'Organization', icon: 'user', href: '/organizer/profile' },
    ],
  };
  const home = {
    id: 'home',
    label: null,
    items: [
      { key: 'dashboard', label: 'Dashboard', icon: 'home', href: '/organizer', exact: true },
      { key: 'events', label: 'Your events', icon: 'calendar', href: '/organizer/events' },
      /**
       * ─────────────────────────────────────────────────────────────────────
       * "CREATE EVENT" IS NOT HERE, AND THIS IS WHERE IT WAS.
       *
       * A `canCreate` item pointed at `/organizer/events/new` from this list.
       * It was added because the same control in `EventBar` was ICON-ONLY
       * below 40rem — an unlabelled `+` next to a chevron that opens something
       * else — and got reported as the button not existing.
       *
       * That was fixed in the bar itself: `.es-evbar__new-word` clips the word
       * " event" and nothing else, so the button reads "Create" on a phone and
       * "Create event" from 40rem up. Labelled, at every width. The comment
       * defending the duplicate still described the bar as icon-only long after
       * it had stopped being, and the entry it justified stayed — so the verb
       * appeared twice on one screen, same words, same route, a few hundred
       * pixels apart, which is the duplicate navigation the rest of this file
       * and `siteNav.js` both spend their comments removing.
       *
       * The bar keeps it. It is the copy that is on screen without opening a
       * drawer, which was the original complaint, and it is beside the event
       * switcher — starting an event and moving between them are the same
       * question asked at different times.
       * ─────────────────────────────────────────────────────────────────────
       */
    ],
  };

  /**
   * NO EVENT OPEN → NO EVENT TOOLS. The sidebar used to list twelve greyed-out
   * items under three headings, each saying "choose an event first" — a wall of
   * things a new organizer could not use, above the two things they could. One
   * line now says where those tools live.
   */
  if (!eventId) {
    return [
      home,
      { id: 'event', label: 'Event tools', items: [], note: 'Open an event to manage its tickets, seating, orders and door.' },
      account,
    ];
  }

  const groups = [
    // `home` and `account` are the two objects above, not copies of them. They
    // were written out again here, so adding a destination to the account group
    // changed it for an organizer with an event open and not for one without.
    home,
    /**
     * THE BUILD ORDER IS THE ORDER THE LAUNCH CHECKLIST ASKS FOR, and that is
     * the whole point of listing it this way.
     *
     * It used to read Overview → Page & branding → Ticket types → Seat map,
     * which put the one OPTIONAL screen second, ahead of the two an event
     * cannot go on sale without. The checklist beside it asked for them in the
     * other order. Two lists describing one journey, disagreeing — so "what do
     * I do next" had two answers depending on which the organizer read.
     *
     * Required first, in the order they depend on each other (a seating map
     * needs the tiers that price it; table categories colour the tables on that
     * map), then the optional pair. `BuildNav` walks this group and only this
     * group, so Back/Next at the foot of each screen follows this sequence
     * exactly and ends at Review & submit.
     */
    {
      id: 'build',
      label: 'Build the event',
      note: eventId ? null : 'Pick an event above to open these.',
      items: [
        item('overview', 'Overview', 'info', ''),
        /**
         * ─────────────────────────────────────────────────────────────────
         * THE EVENT'S OWN FIELDS, which had no entry here at all.
         *
         * Name, dates, venue, capacity, fee bearer, refund rules — the form
         * was rendered INSIDE the overview, so the longest editor in the
         * product shared a sidebar row with the summary above it. The row
         * said "Overview" whichever of the two you were reading, and there
         * was no way to link anybody to the form: the launch checklist and
         * the rejection notice both pointed at an `#details` anchor on a
         * screen that also held a checklist telling you to go there.
         *
         * FIRST AFTER THE OVERVIEW, because it is first in fact: a ticket
         * type is priced in the event's currency and a seat map is drawn for
         * its venue, so the fields those depend on come before both. That
         * also makes the Back / Save and continue sequence read as the order
         * somebody actually builds an event in.
         * ─────────────────────────────────────────────────────────────────
         */
        item('details', 'Event details', 'pencil', '/details'),
        item('tiers', 'Ticket types', 'ticket', '/tiers'),
        item('map', 'Seating map', 'map', '/map'),
        item('tables', 'Table categories', 'layers', '/tables'),
        item('content', 'Page & branding', 'image', '/content'),
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
    account,
  ];

  // A listing sells nothing, so every selling screen is an empty room. Checked
  // first because it is the stronger claim: it removes the seat map too, and
  // asking about admission afterwards would be asking about a map that is
  // already gone.
  if (displayOnly) return prune(groups, (item) => DISPLAY_ONLY_KEYS.has(item.key));
  if (generalAdmission) return prune(groups, (item) => !RESERVED_ONLY_KEYS.has(item.key));
  return groups;
}

/** Filters the event-scoped groups and drops any left empty. The account and
 *  home groups are never touched — they are about the organizer, not the event. */
function prune(groups, keep) {
  return groups
    .map((group) => (['build', 'sell', 'day'].includes(group.id)
      ? { ...group, items: group.items.filter(keep) }
      : group))
    .filter((group) => group.items.length > 0);
}

/**
 * The phone's bottom bar. "More" opens the drawer and is added by the shell.
 *
 * It follows where the organizer is. Outside an event: their account's
 * destinations. Inside a ticketed event: that event's orders and door list,
 * the two things opened on a phone on the night. It used to show Orders and
 * Door list greyed out on every page with no event open.
 */
/**
 * THREE, PLUS "More" — not four plus More.
 *
 * The bar carried five items on a 320px phone: five icons, five labels, each
 * about 60px wide with the label truncated to fit. It read as a control panel
 * rather than a way to get somewhere, and the fifth item was always the one
 * nobody wanted — Organization is opened once, when the account is set up.
 *
 * Three destinations and More is the shape a phone bar can actually hold at a
 * legible size. Nothing is lost: "More" opens the same drawer that lists every
 * destination there is, and the event switcher now sits at the top of the page
 * rather than being a reason to keep "Your events" permanently on screen.
 */
export const ORGANIZER_TABS = ['dashboard', 'events', 'payments'];
export const ORGANIZER_EVENT_TABS = ['dashboard', 'orders', 'attendees'];
export const ORGANIZER_LISTING_TABS = ['dashboard', 'overview', 'share'];

export function organizerTabs({ eventId, listingType }) {
  if (!eventId) return ORGANIZER_TABS;
  return listingType === 'display_only' ? ORGANIZER_LISTING_TABS : ORGANIZER_EVENT_TABS;
}
