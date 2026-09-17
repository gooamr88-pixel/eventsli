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
  // Reserved seating or general admission. What makes the difference between an
  // event that needs a venue map drawn and one that sells a number of tickets —
  // and therefore what most of the organizer's interface hides or shows.
  admissionType: 'admission_type',
  category: 'category',
  // Short selling points under the description. Content, like `description`
  // itself, so it carries the same permissions.
  highlights: 'highlights',
  // For the map on the event page. Deliberately separate from the address: a
  // venue can be findable by name with no coordinates at all.
  venueLat: 'venue_lat',
  venueLng: 'venue_lng',
  feeBearer: 'fee_bearer',                      // BRD §04
  maxTicketsPerOrder: 'max_tickets_per_order',  // BRD §11
  allowTicketTransfer: 'allow_ticket_transfer', // BRD §10
  // Which of the organizer's payment methods this event takes. Checked against
  // what the organizer has actually set up in the controller, and again before
  // submitting — see paymentReadiness.
  acceptsStripe: 'accepts_stripe',
  acceptsManual: 'accepts_manual',
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
  draft:          ['pending_review', 'cancelled', 'archived'],
  pending_review: ['published', 'rejected', 'draft', 'cancelled', 'archived'],   // BRD §16; an edit withdraws it
  rejected:       ['draft', 'pending_review', 'cancelled', 'archived'],
  published:      ['cancelled', 'suspended', 'completed', 'archived'],
  suspended:      ['published', 'cancelled'],
  // Restoring goes back to where it came from — see restoreTarget.
  archived:       ['draft', 'rejected', 'published', 'completed', 'cancelled'],
  cancelled:      [],
  completed:      ['archived'],
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
  'archived→cancelled':       'admin',
  // Archiving is the organizer's own housekeeping: it takes an event off sale
  // and out of their list. A SUSPENDED event cannot be archived — that would let
  // an organizer tuck away an admin's action and restore it as published.
  'draft→archived':           'organizer',
  'pending_review→archived':  'organizer',
  'rejected→archived':        'organizer',
  'published→archived':       'organizer',
  'completed→archived':       'organizer',
  'archived→draft':           'organizer',
  'archived→rejected':        'organizer',
  'archived→published':       'organizer',
  'archived→completed':       'organizer',
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
const LIVE_EDITABLE = Object.freeze([
  'description', 'max_tickets_per_order', 'allow_ticket_transfer',
  // Adding a way to pay changes nothing a buyer already agreed to, and an
  // organizer whose Stripe account is restricted mid-sale needs to switch.
  'accepts_stripe', 'accepts_manual',
  // Content, not terms. Highlights and a pin on a map describe the event an
  // admin already approved; they do not change what anybody bought, and
  // correcting "doors at 7" on a live listing is exactly the kind of fix that
  // must not need a review queue.
  'highlights', 'venue_lat', 'venue_lng',
]);

/**
 * Fixed once a ticket has sold, in any status. Each changes what an existing
 * buyer bought or agreed to: whether tickets are sold at all, how a seat is
 * bought, and who carries the fee on the order they already paid.
 */
const LOCKED_AFTER_SALE = Object.freeze([
  'listing_type', 'purchase_mode', 'fee_bearer',
  /**
   * `admission_type` is locked for a harder reason than the other three.
   *
   * Those change what a buyer agreed to. This changes what their ticket IS. A
   * reserved ticket points at a seat; a general-admission one points at a
   * ticket type and nothing else. Flipping the event after a sale leaves
   * tickets referring to seats on a map the event no longer uses — and, the
   * other way, a room full of seats that no sale can ever release.
   */
  'admission_type',
]);

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

/**
 * Where an archived event goes back to.
 *
 *   in review  → draft      it left the queue when it was archived; it is
 *                           submitted again rather than silently re-queued
 *   on sale    → on sale    only while it has not ended; after, finished
 *   otherwise  → where it was
 *
 * Restoring to `published` skips review, and that is safe only because an
 * archived event cannot be edited (editConsequence).
 */
function restoreTarget({ archivedFrom, endsAt }, now = new Date()) {
  if (archivedFrom === 'pending_review') return 'draft';
  if (archivedFrom === 'published') {
    return new Date(endsAt) > now ? 'published' : 'completed';
  }
  if (['draft', 'rejected', 'completed'].includes(archivedFrom)) return archivedFrom;
  return 'draft';
}

/**
 * Which payment choices an organizer can offer on an event, from what they have
 * set up. Card only counts once Stripe can actually pay them out.
 *
 *   both ready    → 'both', 'stripe', 'manual'
 *   Stripe only   → 'stripe'
 *   manual only   → 'manual'
 *   neither       → []    (a ticketed event can be drafted, not submitted)
 */
function paymentChoices({ stripeReady, manualReady }) {
  const choices = [];
  if (stripeReady && manualReady) choices.push('both');
  if (stripeReady) choices.push('stripe');
  if (manualReady) choices.push('manual');
  return choices;
}

/** `'both' | 'stripe' | 'manual'` → the two columns. Anything else → neither. */
function paymentFlags(choice) {
  return {
    accepts_stripe: choice === 'both' || choice === 'stripe',
    accepts_manual: choice === 'both' || choice === 'manual',
  };
}

/**
 * Can this event take money, as things stand? Asked before it is submitted.
 *
 * A listing never needs to. A ticketed event needs at least one channel that is
 * both switched on for the event AND set up on the account — "accepts card" with
 * no Stripe account behind it is not a way to pay.
 *
 * `isFree` IS NOT A SETTING. It is derived from the ticket types, every time,
 * by `isFreeEvent` below — because a stored "this event is free" flag and a
 * price list drift apart, and only one of them is what the buyer is charged.
 *
 * A free event needing no payment method is the difference between a community
 * organizer publishing in ten minutes and one abandoning at a Stripe onboarding
 * form for money that will never move.
 *
 * @returns {{ ok: boolean, reason: null | 'NO_CHANNEL' | 'CHANNEL_NOT_READY' }}
 */
function paymentReadiness({
  listingType, acceptsStripe, acceptsManual, stripeReady, manualReady, isFree = false,
}) {
  if (listingType === 'display_only') return { ok: true, reason: null };
  if (isFree) return { ok: true, reason: null };
  if (!acceptsStripe && !acceptsManual) return { ok: false, reason: 'NO_CHANNEL' };
  if ((acceptsStripe && stripeReady) || (acceptsManual && manualReady)) return { ok: true, reason: null };
  return { ok: false, reason: 'CHANNEL_NOT_READY' };
}

/**
 * Is every ticket on this event free?
 *
 * TRUE ONLY WHEN THERE IS SOMETHING TO BE FREE. An event with no ticket types
 * yet has no prices, and "no prices" is not "free" — treating it as free would
 * waive the payment requirement for every brand-new draft, and the organizer
 * would discover they needed Stripe at the moment they first set a price, which
 * is the worst possible moment to find out.
 *
 * Whole-table prices count too. On a reserved event the table can be bought as
 * a unit at its own price (BRD §25), so a map of free seats on paid tables is
 * not a free event, however the tier list reads.
 *
 * @param {Array<{priceCents:number}>} tiers
 * @param {Array<{priceCents:number|null}>} [tables]
 */
function isFreeEvent(tiers, tables = []) {
  const list = Array.isArray(tiers) ? tiers : [];
  if (list.length === 0) return false;
  if (list.some((t) => Number(t.priceCents) > 0)) return false;
  return !(tables || []).some((t) => Number(t.priceCents) > 0);
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS EVENT ACTUALLY NEEDS — the one answer, for every surface that asks.
 *
 * The organizer's interface used to show every section to everybody: a seating
 * map to someone running a free workshop, a Stripe setup step to someone
 * charging nothing, a checkout settings tab for an event that has no checkout.
 * Each of those is a question the organizer has to work out is not for them,
 * and the honest answer is that the system already knew.
 *
 * Derived, never stored, and computed HERE rather than in the dashboard —
 * because the launch checklist, the sub-navigation, the submit guard and the
 * API's own refusals all have to agree about it. When they disagree, the shape
 * it takes is a checklist demanding a step the nav does not offer.
 *
 * @param {object} event
 * @param {'ticketed'|'display_only'} event.listingType
 * @param {'reserved'|'general'}      event.admissionType
 * @param {boolean}                   event.isFree
 * @returns {{
 *   tickets: boolean, seating: boolean, payment: boolean,
 *   checkout: boolean, tables: boolean,
 * }}
 * ─────────────────────────────────────────────────────────────────────────────
 */
function eventNeeds({ listingType, admissionType, isFree = false }) {
  // BRD §12 — a listing sells nothing, so it needs none of the selling machinery.
  const sells = listingType !== 'display_only';

  // Reserved seating is the ONLY thing that needs a venue map. That is the
  // whole point of general admission: stock is a number on a ticket type.
  const seating = sells && admissionType !== 'general';

  return {
    tickets: sells,
    seating,
    // Table categories are decoration for a map, so they follow the map.
    tables: seating,
    // Free tickets take no payment, so they need no way to take one.
    payment: sells && !isFree,
    // There is still a checkout for a free event — somebody claims a ticket and
    // gives their name — so this is NOT gated on price. It is gated on selling.
    checkout: sells,
  };
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
  restoreTarget,
  paymentChoices,
  paymentFlags,
  paymentReadiness,
  isFreeEvent,
  eventNeeds,
  canTransition,
  transitionActor,
  partitionPatch,
  editConsequence,
  apiFieldName,
};
