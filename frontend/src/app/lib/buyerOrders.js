/**
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE READING OF `GET /tickets`, for the three screens that read it.
 *
 * The endpoint answers with the buyer's ORDERS, each carrying its tickets:
 *
 *     { orderId, event: { title, slug, startsAt, endsAt, timezone, venue,
 *                         cancelled }, currency, totalCents, purchasedAt,
 *       tickets: [...] }
 *
 * `MyTickets` had the upcoming/past split inline. It is here now because the
 * dashboard and the orders list need the same answer, and three copies of a
 * date comparison is three chances for the dashboard to say "next event
 * tomorrow" while the tickets list files that event under Past.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SPLIT IS ON THE EVENT'S END, NOT ITS START, and that is load-bearing.
 *
 * `MyTickets` worked this out and the reasoning is worth keeping where the code
 * is: an event that started an hour ago has not happened yet as far as somebody
 * standing outside it is concerned. They are still going, and they still need
 * the QR code on screen. Splitting on `startsAt` files the ticket under "Past"
 * while the doors are open — which is the exact moment it is needed most.
 *
 * `endsAt` is on every event (the schema requires it and refuses an end before a
 * start), so the fallback below is defence against a malformed payload rather
 * than a case that happens.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `now` IS PASSED IN, never read from the clock in here.
 *
 * `Date.now()` inside a `useMemo` is impure — React's compiler refuses it, and
 * it is right to: the same render could produce two different answers, and an
 * event ending mid-render would land in a different group depending on when the
 * memo happened to run. Every caller captures the instant beside the data it
 * describes, so the split is consistent with the list it is splitting.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** An order's end, as a timestamp. `0` for a payload with no usable date. */
function endsAt(order) {
  const value = new Date(order?.event?.endsAt || order?.event?.startsAt || 0).getTime();
  return Number.isFinite(value) ? value : 0;
}

function startsAt(order) {
  return new Date(order?.event?.startsAt || 0).getTime();
}

/**
 * `{ upcoming, past }` — soonest first for what is coming, most recent first for
 * what is done.
 *
 * Two different sorts because they answer two different questions. "What is
 * next" wants the nearest thing at the top; "what have I been to" is a history,
 * and a history reads backwards.
 *
 * @param {object[]|null} orders  the `GET /tickets` payload
 * @param {number} now            the instant the payload was fetched
 */
export function splitOrders(orders, now) {
  const upcoming = [];
  const past = [];

  for (const order of orders || []) {
    (endsAt(order) >= now ? upcoming : past).push(order);
  }

  upcoming.sort((a, b) => startsAt(a) - startsAt(b));
  past.sort((a, b) => startsAt(b) - startsAt(a));

  return { upcoming, past };
}

/**
 * Every figure the buyer dashboard states, derived from the one payload.
 *
 * DERIVED RATHER THAN COUNTED SEPARATELY. The first version of the dashboard
 * asked `GET /tickets` and then counted tickets one way for the tile and
 * another way for the "next event" panel, and the two disagreed about a
 * cancelled event. One function, so a change to what counts changes every
 * figure that claims to count it.
 *
 * WHAT A CANCELLED EVENT DOES TO EACH NUMBER, because it is different per number
 * and getting it wrong is how a dashboard lies:
 *
 *   `nextEvent`      SKIPS cancelled events. "Your next event" pointing at
 *                    something that is not happening is the worst single cell
 *                    on the page.
 *   `upcomingCount`  COUNTS them. It is a count of tickets the person holds for
 *                    dates still to come, and a cancelled event's tickets are
 *                    deliberately kept (BRD §17) — hiding them from the count
 *                    makes the number disagree with the list under it.
 *   `needsAttention` is exactly the cancelled ones, which is why they are
 *                    counted rather than filtered: the dashboard's job is to
 *                    surface them, not to tidy them away.
 *
 * @param {object[]|null} orders
 * @param {number} now
 */
export function summariseOrders(orders, now) {
  const { upcoming, past } = splitOrders(orders, now);

  // Tickets, not orders: "3 tickets" is what somebody holds, and one order can
  // be six of them. An order count here would read as "3 upcoming events".
  const ticketsIn = (list) => list.reduce((n, o) => n + (o.tickets?.length || 0), 0);

  const live = upcoming.filter((o) => !o.event?.cancelled);
  const cancelled = upcoming.filter((o) => o.event?.cancelled);

  return {
    upcoming,
    past,
    /** The soonest event still actually happening, or null. */
    nextEvent: live[0] || null,
    upcomingCount: ticketsIn(upcoming),
    pastCount: ticketsIn(past),
    /** Every order ever, which is what "Orders" lists. */
    orderCount: (orders || []).length,
    /**
     * Upcoming events that were cancelled. The one thing on this payload that
     * needs the buyer to do something — contact the organizer — and the only
     * reason the dashboard has an attention row at all.
     */
    cancelled,
    /** True when the account has never bought anything. Not the same as an
     *  empty `upcoming`, which is an account whose events have all happened. */
    neverBought: (orders || []).length === 0,
  };
}
