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
 * The browse categories, as data.
 *
 * Exported from the one module with no imports so the validator, the tests and
 * any future admin tool read the same list the database enum was built from.
 * A second copy is a second thing to forget: the enum would accept a value the
 * validator rejects, or the reverse, and neither failure names the other list.
 */
const EVENT_CATEGORIES = Object.freeze([
  'music', 'festival', 'nightlife', 'sports', 'arts', 'comedy', 'film',
  'food_drink', 'business', 'community', 'education', 'family', 'other',
]);

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
  pending_review: ['published', 'rejected', 'cancelled'],   // BRD §16
  rejected:       ['draft', 'pending_review', 'cancelled'],
  published:      ['cancelled', 'suspended', 'completed'],
  suspended:      ['published', 'cancelled'],
  cancelled:      [],
  completed:      [],
});

/**
 * Who may make each move.
 *
 * The load-bearing line is `published→cancelled: organizer`. An admin may
 * SUSPEND an event — pull it from view for a breach — but does not cancel it
 * on the organizer's behalf: the organizer owes their buyers that conversation
 * (BRD §17), and cancelling for them would hide who actually decided.
 */
const TRANSITION_ACTOR = Object.freeze({
  'draft→pending_review':     'organizer',
  'rejected→pending_review':  'organizer',
  'rejected→draft':           'organizer',
  'pending_review→published': 'admin',      // BRD §16 — approval is the admin's
  'pending_review→rejected':  'admin',
  'published→suspended':      'admin',
  'suspended→published':      'admin',
  'published→completed':      'system',     // a job, once ends_at passes
  'draft→cancelled':          'organizer',
  'pending_review→cancelled': 'organizer',
  'rejected→cancelled':       'organizer',
  'published→cancelled':      'organizer',
  'suspended→cancelled':      'organizer',
});

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
  EVENT_CATEGORIES,
  TRANSITIONS,
  TRANSITION_ACTOR,
  canTransition,
  transitionActor,
  partitionPatch,
};
