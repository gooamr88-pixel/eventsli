/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The buyer's destination map — the one that did not exist.
 *
 * WHAT THE BUYER HAD. Two tabs, "Tickets" and "Security", inside a page whose
 * `<h1>` was the reader's own name, reached from a masthead link. That is an
 * account-settings screen, and it was standing in for a workspace: there was no
 * dashboard, no orders, no answer to "what can I do here", and `/account`
 * itself had a layout with no page behind it — so the bare path 404'd while
 * being the thing the product called somebody's account.
 *
 * Meanwhile the organizer and the admin each had a real shell with a sidebar,
 * a phone tab bar and a footer that says who is signed in. The buyer — the
 * account type every single person on the platform has — had the least of the
 * three, and the product's own landing rule dropped them straight onto a
 * sub-page of it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THREE GROUPS, AND THE SPLIT IS THE POINT.
 *
 * Section 6 of the brief this pass answers names the confusion exactly, and it
 * is a vocabulary problem before it is a layout problem:
 *
 *     EVENTS   things being discovered — they belong to organizers
 *     TICKETS  admissions this person OWNS
 *     ORDERS   the transactions that bought them
 *
 * They were one screen. `GET /tickets` returns orders each carrying their
 * tickets, and "My tickets" rendered the whole payload as one list — so the
 * receipt, the QR code and the event were the same object on screen. Somebody
 * looking for what they paid had to read a ticket, and somebody looking for the
 * QR code had to scroll past a total.
 *
 * Tickets and Orders are now two readings of that one request: no second
 * endpoint, and no possibility of the two disagreeing about what was bought.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BROWSE LEAVES THE WORKSPACE, and it says so rather than pretending otherwise.
 *
 * `/events` and `/events/saved` are storefront routes: public, server-rendered,
 * cached and crawlable. Wrapping them in this shell would opt the most-indexed
 * pages on the site out of static rendering to give a signed-in buyer a
 * sidebar — the exact trade `SiteHeader` refuses in its own header comment.
 *
 * So they are listed here, because discovery is genuinely part of what a buyer
 * does and a nav that omitted it would send them to the logo to find it, and
 * the group carries a note saying the chrome changes. The way back is
 * `SiteHeader`'s "Dashboard" button, which points at `/account` for a buyer.
 *
 * NO NOTIFICATIONS ITEM. The brief lists one and this product has no
 * notifications — no endpoint, no table, no screen. A nav entry for it would be
 * either a 404 or an invented feature, and `SiteHeader` already refuses the
 * same thing for "Pricing" and "Sponsors": a nav link to a page that does not
 * exist is worse than a shorter nav.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * @param {object} [options]
 * @param {number|null} [options.upcoming]  tickets for events still to come, for
 *                                          the badge. `null` while unknown — a
 *                                          badge that reads 0 and then 3 is a
 *                                          layout shift in the sidebar.
 * @param {boolean} [options.canSell]       true for an account that does NOT yet
 *                                          have the organizer workspace, which is
 *                                          who the "Sell on Eventsli" row is for.
 *                                          Somebody who already has it gets the
 *                                          workspace switcher instead.
 */
export function accountNavGroups({ upcoming = null, canSell = false } = {}) {
  return [
    {
      id: 'home',
      label: null,
      items: [
        /**
         * `exact`, like the organizer's dashboard and for the same reason: a
         * prefix match on `/account` lights "Dashboard" on Tickets, Orders and
         * Security as well, and `resolveNav` then has to break a four-way tie
         * on href length. It resolves it correctly and the sidebar still looks
         * wrong for a moment on every deeper route.
         */
        { key: 'overview', label: 'Dashboard', icon: 'home', href: '/account', exact: true },
      ],
    },
    {
      id: 'owned',
      label: 'Yours',
      items: [
        {
          key: 'tickets',
          label: 'My tickets',
          icon: 'ticket',
          href: '/account/tickets',
          // Only when there is something to count. `0` in a badge is a
          // notification that nothing happened.
          badge: upcoming && upcoming > 0 ? upcoming : null,
        },
        { key: 'orders', label: 'Orders', icon: 'receipt', href: '/account/orders' },
      ],
    },
    {
      id: 'browse',
      label: 'Browse',
      // The one place this shell hands over to the public site. Said out loud
      // because the alternative is somebody wondering where their sidebar went.
      note: 'These open the main Eventsli site.',
      items: [
        { key: 'discover', label: 'Discover events', icon: 'search', href: '/events', exact: true },
        { key: 'saved', label: 'Saved events', icon: 'heart', href: '/events/saved' },
      ],
    },
    {
      id: 'account',
      label: 'Your account',
      items: [
        { key: 'security', label: 'Sign-in & security', icon: 'shield', href: '/account/security' },
        /**
         * ─────────────────────────────────────────────────────────────────────
         * THE WAY TO START SELLING, for a buyer who has not.
         *
         * The brief this pass answers asks for the upgrade path to be PRESERVED
         * AND DISCOVERABLE without pushing every buyer through organizer
         * onboarding, and removing the masthead's "Create event" button — which
         * was aimed at every signed-in buyer whether they wanted it or not — took
         * away the loud version without leaving a quiet one. This is the quiet
         * one: one row, at the bottom, in the group about the account itself.
         *
         * `/organizer` and not `/register/organizer`: they already have an
         * account, and `/organizer` is the screen that asks for the organization
         * details. (`proxy.ts` now redirects the register path here for exactly
         * this reason, so both work — but linking straight at it saves the hop.)
         *
         * ONLY WHEN THEY DO NOT ALREADY HAVE THE WORKSPACE. For somebody who
         * does, this row and the switcher above would be two controls pointing at
         * one place, and the switcher is the better of the two because it says
         * what is behind it.
         * ─────────────────────────────────────────────────────────────────────
         */
        ...(canSell
          ? [{ key: 'sell', label: 'Sell on Eventsli', icon: 'briefcase', href: '/organizer' }]
          : []),
      ],
    },
  ];
}

/**
 * The phone's bottom bar: three destinations, plus the "More" the shell adds.
 *
 * The same three-and-More shape `ORGANIZER_TABS` argues for — five items on a
 * 320px screen reads as a control panel rather than a way to get somewhere.
 *
 * Dashboard, My tickets, Discover: what this workspace is for, in the order
 * somebody uses it. Orders and Security are both things you open occasionally
 * and deliberately, which is what "More" is for.
 */
export const ACCOUNT_TABS = ['overview', 'tickets', 'discover'];
