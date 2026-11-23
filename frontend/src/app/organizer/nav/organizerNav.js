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
   else dropped here is a SELLING screen; the event's own fields are not one.

   `content` (Page & branding) IS IN HERE TOO, added 2026-10-16 at the owner's
   request. It was left out with the selling screens, but nothing on it sells:
   the cover, logo, gallery, schedule, sponsors and policies are what a listing
   is FOR, and the public page shows every one of them for a listing. Without
   it a listing's setup was Overview → Event details → submit, with no way to
   give the page a single picture. */
/* `sponsors` and `vendors` (2026-11-20): selling sponsorship or vendor space
   is not selling tickets. A listing can have both, shown on its page. */
const DISPLAY_ONLY_KEYS = new Set(['overview', 'details', 'content', 'share', 'sponsors', 'vendors']);

/**
 * WHAT A GENERAL-ADMISSION EVENT DOES NOT HAVE.
 *
 * A seat map, and the table categories that only exist to colour one. Until
 * general admission existed, every ticketed event needed a venue drawn — so an
 * organizer running a conference or a club night had to build a fictional
 * seating plan before they could sell anything, and the two screens that
 * demanded it sat in the sidebar as permanent unfinished work.
 *
 * Table categories are hidden: they mean nothing without a map. The seat map
 * itself is DISABLED WITH ITS REASON rather than hidden (TECH-AUDIT-LOG S-13):
 * hiding it read as a missing feature, and "where is the seating map?" had no
 * answer anywhere on screen. See the end of `organizerNavGroups`.
 */

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
  eventId, listingType = null, admissionType = null, eventTitle = null, partners = null,
}) {
  const displayOnly = listingType === 'display_only';
  const generalAdmission = admissionType === 'general';
  const base = eventId ? `/organizer/events/${eventId}` : null;
  // `also`: screens that live INSIDE this row (Table categories inside
  // Tickets, Commission inside Orders) light it up too. They are reached from
  // tabs at the top of the row's own page, not from the sidebar.
  const item = (key, label, icon, suffix, also = []) => ({
    key,
    label,
    icon,
    href: base ? `${base}${suffix}` : null,
    also: base ? also.map((s) => `${base}${s}`) : [],
    disabled: !eventId,
    hint: eventId ? null : CHOOSE_FIRST,
  });

  const account = {
    id: 'account',
    label: 'Your account',
    items: [
      { key: 'payments', label: 'Payments', icon: 'bank', href: '/organizer/payments' },
      // Text campaigns to buyers who opted in to THIS organizer (organizer/sms).
      { key: 'sms', label: 'Text messages', icon: 'chat', href: '/organizer/sms' },
      { key: 'profile', label: 'Organization', icon: 'user', href: '/organizer/profile' },
    ],
  };
  const home = {
    id: 'home',
    label: null,
    items: [
      { key: 'dashboard', label: 'Dashboard', icon: 'home', href: '/organizer', exact: true },
      { key: 'events', label: 'Your events', icon: 'calendar', href: '/organizer/events' },
      // Event templates (2026-11-19): theirs and Eventsli's.
      { key: 'templates', label: 'Templates', icon: 'copy', href: '/organizer/templates' },
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

  /**
   * ─────────────────────────────────────────────────────────────────────────
   * FOUR GROUPS, PLAIN NAMES (owner, 2026-11-23: "very complex and terrible").
   *
   * With an event open the sidebar was 25 rows. "Sell" alone held eight —
   * Orders beside Sponsors, Vendors, Commission, Hosts & guests, Offline
   * payments and Door sales — so the list had to be read top to bottom to
   * find anything, and two whole systems (sponsors, vendors) looked like one
   * more small tool every event had to deal with.
   *
   *   Set up      what the event IS — and the Back / Save and continue walk
   *   Sell        what happens once it is on sale
   *   Partners    sponsors and vendors, only for an event that said yes
   *   On the day  the door
   *
   * Screens that belong to another one moved inside it, reached by tabs at the
   * top of that page (`SectionTabs`): Table categories inside Tickets;
   * Offline payments and Commission inside Orders; Scanning devices inside
   * Door team. Their routes did not change, and `also` keeps the parent row
   * lit while you are on them.
   * ─────────────────────────────────────────────────────────────────────────
   */
  const groups = [
    // `home` and `account` are the two objects above, not copies of them.
    home,
    /**
     * THE SETUP ORDER IS THE ORDER THE LAUNCH CHECKLIST ASKS FOR. Required
     * first, in the order they depend on each other (tickets are priced in the
     * event's currency, the map is priced by the tickets), then the page.
     * `BuildNav` walks this group and only this group, so its "step N of M"
     * counts only these. Discounts used to be the last step, which made an
     * optional extra read as required; it is under Sell now.
     */
    {
      id: 'build',
      label: 'Set up',
      // Which event every group below acts on. `AppShell` prints it under the
      // label; without it a drawer that covers the page named no event at all.
      caption: eventTitle,
      items: [
        item('overview', 'Overview', 'info', ''),
        // The event's own fields: name, dates, venue, capacity, refund rules.
        item('details', 'Event details', 'pencil', '/details'),
        item('tiers', 'Tickets', 'ticket', '/tiers', ['/tables']),
        item('map', 'Event map', 'map', '/map'),
        item('content', 'Event page', 'image', '/content'),
      ],
    },
    {
      id: 'sell',
      label: 'Sell',
      items: [
        item('orders', 'Orders', 'receipt', '/orders', ['/offline', '/commission']),
        item('share', 'Share & QR', 'qr', '/share'),
        item('promos', 'Discounts', 'tag', '/promos'),
        // Whose guest each buyer is, and their hosts (2026-11-23).
        item('guests', 'Hosts & guests', 'users', '/guests'),
      ],
    },
    {
      id: 'partners',
      label: 'Partners',
      items: [
        ...(partners?.sponsors ? [item('sponsors', 'Sponsors', 'handshake', '/sponsors')] : []),
        ...(partners?.vendors ? [item('vendors', 'Vendors', 'store', '/vendors')] : []),
      ],
    },
    {
      id: 'day',
      label: 'On the day',
      items: [
        item('attendees', 'Door list', 'users', '/attendees'),
        item('door', 'Door sales', 'cash', '/door'),
        item('staff', 'Door team', 'shield', '/staff', ['/devices']),
        /**
         * THE SCANNER ITSELF. `/gate/login` was reachable only by typing it.
         * NOT `item()` — the gate is its own principal (a device with a PIN or
         * a named door-team member, scoped to one event chosen at sign-in), so
         * this href carries no id. `targetBlank` because it is a shift, not a
         * page: leaving the dashboard to scan should not lose the dashboard.
         */
        {
          key: 'scan',
          label: 'Open the scanner',
          icon: 'scan',
          href: '/gate/login',
          targetBlank: true,
          hint: 'Scan tickets at the door',
        },
      ],
    },
    account,
  ];

  // A listing sells nothing, so every selling screen is an empty room. Checked
  // first because it is the stronger claim: it removes the map too.
  if (displayOnly) return prune(groups, (item) => DISPLAY_ONLY_KEYS.has(item.key));
  // Drops the Partners heading when neither is on.
  const kept = prune(groups, () => true);
  if (generalAdmission) {
    /**
     * THE EVENT MAP IS FOR EVERY EVENT (2026-11-23). A general-admission event
     * draws its room — stage, bars, entrances, vendor booths — with no seats,
     * so the row stays live and carries a hint about what is different.
     * (Table categories, which only price tables, are hidden on the Tickets
     * page for it.)
     */
    return kept.map((group) => ({
      ...group,
      items: group.items.map((item) => (item.key === 'map' ? { ...item, hint: GA_MAP_HINT } : item)),
    }));
  }
  return kept;
}

/**
 * THE SETUP WALK — what `BuildNav` steps through with Back / Save and continue
 * and counts in "Setup · step N of M". The Set up group, minus what is
 * optional for this event: a general-admission event's map is a nice-to-have
 * (a room drawing, no seats to sell), so it stays in the sidebar but is not a
 * step (owner, 2026-11-23: setup counts only what is required).
 */
export function setupSteps({ eventId, listingType = null, admissionType = null }) {
  return organizerNavGroups({ eventId, listingType, admissionType })
    .filter((g) => g.id === 'build')
    .flatMap((g) => g.items)
    .filter((item) => item.href)
    .filter((item) => !(item.key === 'map' && admissionType === 'general'));
}

const GA_MAP_HINT = 'General admission: draw the room and its vendor booths — there are no seats to sell. '
  + 'To sell seats or tables, switch to Reserved seating in Event details — possible until the first ticket sells.';

/** Filters the event-scoped groups and drops any left empty. The account and
 *  home groups are never touched — they are about the organizer, not the event. */
function prune(groups, keep) {
  return groups
    .map((group) => (['build', 'sell', 'partners', 'day'].includes(group.id)
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

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * BEFORE LAUNCH, THE BAR IS FOR BUILDING.
 *
 * A draft showed Dashboard, Orders and Door list — two screens that are empty
 * until the event sells — while the setup steps the organizer actually had to
 * do were only in the menu. Before it is on sale the bar carries the overview
 * (the checklist and the next step) and the first thing to build: ticket types
 * for a ticketed event, the details for a listing. Once it is on sale, and in
 * every state after, it is the bar used on the night.
 *
 * `status` is optional and an unknown one is treated as selling, so a caller
 * that has not loaded the event yet gets the bar it always had.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const ORGANIZER_SETUP_TABS = ['dashboard', 'overview', 'tiers'];
export const ORGANIZER_LISTING_SETUP_TABS = ['dashboard', 'overview', 'details'];
const PRE_LAUNCH = new Set(['draft', 'rejected', 'pending_review']);

export function organizerTabs({ eventId, listingType, status = null }) {
  if (!eventId) return ORGANIZER_TABS;
  const listing = listingType === 'display_only';
  if (PRE_LAUNCH.has(status)) return listing ? ORGANIZER_LISTING_SETUP_TABS : ORGANIZER_SETUP_TABS;
  return listing ? ORGANIZER_LISTING_TABS : ORGANIZER_EVENT_TABS;
}
