/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Event rules — WHO may change WHAT, and WHICH status may follow which.
 *
 * Deliberately dependency-free. Not a stylistic preference: these are the rules
 * that decide whether an organizer can set their own commission and whether an
 * event can publish without review, and they must be testable without a
 * database, a network, or a single environment variable. When they lived beside
 * the Supabase queries, importing them dragged in a client that throws at module
 * load unless credentials are present — so the rules could only be exercised
 * against production data, which is the last place you want to find out.
 *
 * eventService.js re-exports everything here alongside the queries.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * WHAT AN ORGANIZER MAY EDIT — as API-name → column-name.
 *
 * A map, not a list of columns. The API speaks camelCase and Postgres speaks
 * snake_case; a bare list of column names matches nothing a client actually
 * sends, so every field falls through to "unknown" and comes back 403. This
 * shipped once and was caught by an integration test that had ignored the
 * response of its own PATCH.
 *
 * Money rates are absent by design (BRD §05, §06) — an organizer who could set
 * their own commission would set it to zero. `feeBearer` is the one financial
 * field they own (BRD §04): it changes who pays the payment fee, never how much
 * the platform collects.
 */
const ORGANIZER_EDITABLE = Object.freeze({
  title: 'title',
  description: 'description',
  venueName: 'venue_name',
  venueAddress: 'venue_address',
  city: 'city',
  country: 'country',
  timezone: 'timezone',
  startsAt: 'starts_at',
  endsAt: 'ends_at',
  listingType: 'listing_type',
  purchaseMode: 'purchase_mode',
  category: 'category',
  feeBearer: 'fee_bearer',                      // BRD §04
  maxTicketsPerOrder: 'max_tickets_per_order',  // BRD §11
  allowTicketTransfer: 'allow_ticket_transfer', // BRD §10
});

/**
 * THE CATEGORY LIST USED TO LIVE HERE, and it is worth saying where it went.
 *
 * It was a frozen array, exported so the validator, the tests and any admin
 * tool read the same list the database enum was built from — one copy, so the
 * enum could not accept a value the validator rejected.
 *
 * The enum became a table (20260916100000_storefront_cms.sql) so an admin could
 * add a category without a migration and a deploy. A frozen array cannot
 * survive that: the moment somebody adds one, this file starts refusing a
 * category the database accepts, and the failure names neither list.
 *
 * The same single-source guarantee now lives in `services/categoryService.js`,
 * which reads the table and caches it. This module stays import-free and pure,
 * which is what its tests depend on.
 */

/**
 * `cover_url` and `cover_path` are in NEITHER map, deliberately.
 *
 * They are written only by `mediaController`, after the object it signed the
 * upload for has been confirmed to exist. If they were organizer-editable, a
 * PATCH could set `coverUrl` to any address on the internet — and that address
 * is then served inside an Open Graph tag on a public page, which makes it a
 * link the platform vouches for.
 */

/**
 * WHAT ONLY AN ADMIN MAY SET (BRD §05, §06, §19).
 *
 * A separate map rather than "anything not in the organizer list", so adding a
 * column to `events` does not silently become editable. A new field is
 * un-editable by everyone until it is deliberately placed in one of these two.
 */
const ADMIN_EDITABLE = Object.freeze({
  commissionPct: 'commission_pct',
  commissionTaxPct: 'commission_tax_pct',
  paymentFeeMode: 'payment_fee_mode',
  paymentFeePct: 'payment_fee_pct',
  paymentFeeFixedCents: 'payment_fee_fixed_cents',
  eventTaxPct: 'event_tax_pct',
  // Snake_case accepted too: these column names circulate in admin tooling and
  // in the docs, and refusing the "wrong" spelling of a field you ARE allowed
  // to set is a confusing way to find that out.
  commission_pct: 'commission_pct',
  commission_tax_pct: 'commission_tax_pct',
  payment_fee_mode: 'payment_fee_mode',
  payment_fee_pct: 'payment_fee_pct',
  payment_fee_fixed_cents: 'payment_fee_fixed_cents',
  event_tax_pct: 'event_tax_pct',
});

/**
 * The status machine, as explicit edges.
 *
 * Written as data rather than as guards scattered through handlers, because
 * every interesting question here is about an edge: a rejected event CAN go
 * round again; a cancelled one never comes back; a published one cannot slip
 * back into draft once tickets have sold.
 */
const TRANSITIONS = Object.freeze({
  draft:          ['pending_review', 'cancelled'],
  pending_review: ['published', 'rejected', 'draft', 'cancelled'],   // BRD §16; an edit withdraws it
  rejected:       ['draft', 'pending_review', 'cancelled'],
  published:      ['cancelled', 'suspended', 'completed'],
  suspended:      ['published', 'cancelled'],
  cancelled:      [],
  completed:      [],
});

/**
 * Who may make each move.
 *
 * The load-bearing lines are the five edges into `cancelled`, and every one of
 * them is the ADMIN's. Final Business Rules §17: the organizer cannot cancel an
 * event; cancellation is done through the admin. An earlier revision of this
 * file gave those edges to the organizer, and the organizer endpoint shipped —
 * the opposite of the rule. There is no organizer route to cancel any more.
 *
 * An admin also SUSPENDS (reversible, a pull from view). Cancelling is terminal.
 */
const TRANSITION_ACTOR = Object.freeze({
  'draft→pending_review':     'organizer',
  'rejected→pending_review':  'organizer',
  'rejected→draft':           'organizer',
  'pending_review→draft':     'organizer',  // editing an event under review withdraws it
  'pending_review→published': 'admin',      // BRD §16 — approval is the admin's
  'pending_review→rejected':  'admin',
  'published→suspended':      'admin',
  'suspended→published':      'admin',
  'published→completed':      'system',     // a job, once ends_at passes
  'draft→cancelled':          'admin',      // BRD §17 — every cancel is the admin's
  'pending_review→cancelled': 'admin',
  'rejected→cancelled':       'admin',
  'published→cancelled':      'admin',
  'suspended→cancelled':      'admin',
});

/**
 * WHAT MAY CHANGE ON AN EVENT THAT IS ON SALE without another review (BRD §16),
 * as column names.
 *
 * An admin approves what they saw. Edits used to be refused only for cancelled
 * and completed events, so the title, the dates, the venue or who pays the fees
 * could change after approval — or while the event sat in the queue, so the
 * admin approved content they had never seen. On a live event, these are the
 * operational details an organizer genuinely needs to adjust alone; everything
 * else a reviewer approved goes through Eventsli.
 */
const LIVE_EDITABLE = Object.freeze(['description', 'max_tickets_per_order', 'allow_ticket_transfer']);

/**
 * Fixed once a ticket has sold, in any status. Each changes what an existing
 * buyer bought or agreed to: whether tickets are sold at all, how a seat is
 * bought, and who carries the fee on the order they already paid.
 */
const LOCKED_AFTER_SALE = Object.freeze(['listing_type', 'purchase_mode', 'fee_bearer']);

const COLUMN_TO_API = Object.freeze(
  Object.fromEntries(Object.entries(ORGANIZER_EDITABLE).map(([api, column]) => [column, api])),
);

/** `starts_at` → `startsAt`, so a refusal names the field the client sent. */
function apiFieldName(column) {
  return COLUMN_TO_API[column] || column;
}

/**
 * What an organizer's edit does to the event's review, decided before it is
 * written. `columns` are the column names about to change.
 *
 *   refused         columns that may not change, with `reason`
 *                   LOCKED_AFTER_SALE or EVENT_ON_SALE
 *   returnsToDraft  the event was under review; the edit withdraws it, and it
 *                   has to be submitted again
 *
 * An admin is held to neither rule: their edits ARE the review.
 */
function editConsequence({ status, columns, isAdmin, hasPaidOrders }) {
  const nothing = { refused: [], reason: null, returnsToDraft: false };
  if (isAdmin) return nothing;

  // `currency` follows `country` and `updated_at` is bookkeeping; neither is
  // something the organizer chose to change.
  const changed = (columns || []).filter((c) => c !== 'updated_at' && c !== 'currency');

  if (hasPaidOrders) {
    const locked = changed.filter((c) => LOCKED_AFTER_SALE.includes(c));
    if (locked.length) return { refused: locked, reason: 'LOCKED_AFTER_SALE', returnsToDraft: false };
  }

  if (status === 'published' || status === 'suspended') {
    const reviewed = changed.filter((c) => !LIVE_EDITABLE.includes(c));
    if (reviewed.length) return { refused: reviewed, reason: 'EVENT_ON_SALE', returnsToDraft: false };
  }

  return { ...nothing, returnsToDraft: status === 'pending_review' && changed.length > 0 };
}

/**
 * The statuses in which an organizer accepts the terms — before submitting.
 * Once an event is in review or on sale, the version it went in under stands.
 */
const TERMS_ACCEPTABLE_FROM = Object.freeze(['draft', 'rejected']);

/**
 * Has this event's organizer accepted the terms, as far as the NEXT step cares?
 *
 * THE BUG THIS REPLACES. The dashboard read `!!terms_accepted_id`, but only
 * `submit` wrote that column — `accept-terms` recorded a row in
 * `terms_acceptances` and left the event alone. So after "Accept and continue"
 * the page reloaded the event, still saw no acceptance, showed the terms box
 * again and kept "Submit for review" disabled: the one button that would have
 * written the flag was locked behind the flag. Nobody could submit an event
 * from the dashboard.
 *
 * Accepting now stamps the event in the same request, and this decides what the
 * stamp means:
 *   · before submission, only the CURRENT version counts — it is what
 *     `submit` will demand, so a stamp from an older version must show the
 *     terms step again rather than a Submit button that fails;
 *   · after submission, the version accepted at the time stands (a published
 *     event keeps running under the terms its organizer agreed to).
 *
 * `currentTermsId` may be unknown (no terms published, or the lookup failed);
 * then any stamp counts, and `submit` remains the authority.
 */
function termsAcceptedFor(event, currentTermsId = null) {
  const acceptedId = event?.terms_accepted_id || null;
  if (!acceptedId) return false;
  if (TERMS_ACCEPTABLE_FROM.includes(event.status) && currentTermsId) {
    return acceptedId === currentTermsId;
  }
  return true;
}

function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to);
}

function transitionActor(from, to) {
  return TRANSITION_ACTOR[`${from}→${to}`] || null;
}

/**
 * Splits a patch into what this actor may write and what they may not.
 *
 * Denied keys come back under the name the CALLER used, so the API can say
 * "you cannot change commissionPct" rather than a vague 403 — and rather than
 * silently dropping it, which would leave an organizer believing they had set
 * their commission to zero and received a 200.
 */
function partitionPatch(patch, { isAdmin }) {
  const allowed = {};   // keyed by COLUMN name, ready for the update
  const denied = [];    // keyed by the caller's spelling

  for (const [key, value] of Object.entries(patch || {})) {
    const organizerColumn = ORGANIZER_EDITABLE[key];
    if (organizerColumn) { allowed[organizerColumn] = value; continue; }

    const adminColumn = ADMIN_EDITABLE[key];
    if (adminColumn) {
      if (isAdmin) allowed[adminColumn] = value;
      else denied.push(key);
      continue;
    }
    denied.push(key);
  }
  return { allowed, denied };
}

module.exports = {
  ORGANIZER_EDITABLE,
  ADMIN_EDITABLE,
  TRANSITIONS,
  TRANSITION_ACTOR,
  LIVE_EDITABLE,
  LOCKED_AFTER_SALE,
  TERMS_ACCEPTABLE_FROM,
  termsAcceptedFor,
  canTransition,
  transitionActor,
  partitionPatch,
  editConsequence,
  apiFieldName,
};
