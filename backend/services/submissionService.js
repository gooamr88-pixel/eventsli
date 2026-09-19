const { supabase } = require('../config/supabase');
const { describeOrder, FEE_BEARER, PAYMENT_FEE_MODE } = require('../utils/money');
const { stripeCostModel } = require('./pricingService');
const { canReceivePayouts } = require('../utils/payouts');
const rules = require('./eventRules');
const terms = require('./termsService');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * SUBMITTING AN EVENT FOR REVIEW — the checks, and the preview of what is
 * being agreed to.
 *
 * TWO CALLERS, ONE ANSWER. `POST /events/:id/submit` refuses on the first
 * blocker; `GET /events/:id/submission-preview` lists every one of them, so the
 * confirmation dialog can say what is outstanding before the organizer presses
 * anything. Written twice, those two would drift, and the shape that takes is a
 * dialog saying "ready to submit" over a button the API then refuses.
 *
 * THE MONEY IS COMPUTED HERE, NOT IN THE BROWSER. The client's money helper has
 * no arithmetic in it at all, on purpose: a client that re-derives a total will
 * eventually disagree with the charge, and the version the organizer believes
 * is the one on their screen. So the dialog that says "you receive $43.12" is
 * shown a number that came out of `describeOrder` — the same function that
 * prices a real order — rather than one it worked out from percentages.
 *
 * THE PREVIEW IS PER TICKET TYPE, FOR A ONE-TICKET ORDER, and says so. The
 * fixed component of the payment fee mirrors Stripe's per-CHARGE cost, so it
 * lands once on an order however many seats it holds; quoting it per ticket on
 * a ten-seat order would overstate it ninefold. One ticket is the honest unit,
 * and the one an organizer can check against a price they already know.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Where the organizer stands on what an event depends on: is the organization
 * set up, can Stripe pay them, do they have a manual method. Read fresh — the
 * access context caches `canReceivePayouts` for seconds, and these decisions
 * must not be made on a stale answer.
 */
async function organizerReadiness(organizerId) {
  const [{ data: org, error }, { count, error: mErr }] = await Promise.all([
    supabase.from('organizers')
      .select('display_name, legal_name, description, policies_accepted_at, stripe_onboarding_complete, stripe_payouts_enabled')
      .eq('id', organizerId).maybeSingle(),
    supabase.from('organizer_payment_methods')
      .select('id', { count: 'exact', head: true })
      .eq('organizer_id', organizerId).eq('is_active', true),
  ]);
  if (error) throw new Error(error.message);
  if (mErr) throw new Error(mErr.message);
  // Required inside the function, not at the top: keeping the edge one-way at
  // load time costs nothing and this module is required from controllers.
  const { isSetupComplete } = require('../controllers/organizerController');
  return {
    setupComplete: isSetupComplete(org),
    stripeReady: canReceivePayouts(org),
    manualReady: (count || 0) > 0,
  };
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS EVENT NEEDS, answered by the API rather than by each screen.
 *
 * The organizer's dashboard used to show every section to everybody: a seating
 * map to someone running a free workshop, a Stripe setup step to someone
 * charging nothing. Each of those is a question the organizer has to work out
 * is not for them — and the system already knew.
 *
 * COMPUTED SERVER-SIDE, not in the browser, and that is the whole point. The
 * launch checklist, the sub-navigation, the submit guard and the API's own
 * refusals all branch on this. Worked out separately in each, they drift, and
 * the shape that takes is a checklist demanding a step the navigation does not
 * offer — which an organizer cannot resolve from the outside.
 *
 * `isFree` is DERIVED FROM THE PRICES, every time, never stored: a stored flag
 * and a price list drift apart, and only one of them is what the buyer is
 * charged. Whole-table prices count, because BRD §25 lets a table be bought as
 * a unit at its own price.
 * ─────────────────────────────────────────────────────────────────────────────
 */
async function eventSetup(event) {
  const [{ data: tiers }, { data: map }] = await Promise.all([
    supabase.from('ticket_tiers').select('price_cents').eq('event_id', event.id),
    supabase.from('venue_maps').select('id').eq('event_id', event.id).maybeSingle(),
  ]);

  let tables = [];
  if (map) {
    const { data } = await supabase.from('tables').select('price_cents').eq('venue_map_id', map.id);
    tables = data || [];
  }

  const isFree = rules.isFreeEvent(
    (tiers || []).map((t) => ({ priceCents: Number(t.price_cents) })),
    tables.map((t) => ({ priceCents: t.price_cents === null ? null : Number(t.price_cents) })),
  );

  return {
    isFree,
    needs: rules.eventNeeds({
      listingType: event.listing_type,
      admissionType: event.admission_type || 'reserved',
      isFree,
    }),
  };
}

/** The columns every check below reads. */
const SUBMIT_SELECT = `id, organizer_id, status, listing_type, admission_type, starts_at, ends_at,
                       accepts_stripe, accepts_manual, venue_name, venue_address, city`;

/**
 * Everything standing between this event and the review queue, in the order
 * `submit` has always tested them.
 *
 * Returns ALL of them rather than the first. `submit` still refuses on
 * `blockers[0]`, so its behaviour is unchanged; the preview lists the rest, so
 * an organizer fixes three things in one pass instead of discovering them one
 * failed submission at a time.
 *
 * Each blocker carries the exact `status`, `error` and `message` the endpoint
 * responds with, because those strings are the ones already tested and already
 * mapped to recovery actions in the client.
 */
async function submissionBlockers({ event, userId }) {
  const blockers = [];

  if (!rules.canTransition(event.status, 'pending_review')) {
    blockers.push({
      status: 409,
      error: 'CONFLICT',
      message: `An event that is ${event.status} cannot be submitted for review.`,
    });
  }

  // BRD §21 — the confirmation step. Accepting the terms is what turns the
  // financial settings from something displayed into something agreed.
  const { accepted, termsId, version } = await terms.hasAcceptedCurrent({
    userId, audience: 'organizer', eventId: event.id,
  });
  if (!accepted) {
    blockers.push({
      status: 403,
      error: 'TERMS_NOT_ACCEPTED',
      message: 'Review and accept the organizer terms for this event before submitting it.',
      meta: { termsId, version },
    });
  }

  if (new Date(event.starts_at) <= new Date()) {
    blockers.push({
      status: 400,
      error: 'VALIDATION_ERROR',
      message: 'This event starts in the past. Update the date before submitting.',
    });
  }

  /**
   * THE VENUE, CHECKED HERE RATHER THAN AT CREATION.
   *
   * Creation stays permissive on purpose — an organizer drafts an event before
   * they have booked a room, and refusing the draft would push them into
   * inventing a venue they then forget to correct. Publication is the point at
   * which it has to be true. It is also what keeps a DRAFT saveable with none
   * of this filled in.
   *
   * CITY is the one that changes behaviour rather than just completeness.
   * "Events near me" matches `events.city` against a coordinate table
   * (`utils/cityCoordinates.js`), and `nearestCity` filters `city IS NOT NULL`
   * — so an event published without one is invisible to that feature and to
   * `?city=`, silently, forever.
   */
  const missing = [
    !String(event.venue_name || '').trim() && 'a venue name',
    !String(event.venue_address || '').trim() && 'a street address',
    !String(event.city || '').trim() && 'a city',
  ].filter(Boolean);

  if (missing.length > 0) {
    blockers.push({
      status: 400,
      error: 'VALIDATION_ERROR',
      message: `Add ${missing.join(', ')} before submitting — buyers need to know where to go, and the city is what puts this event in “events near me”.`,
      meta: { missing },
    });
  }

  /**
   * A ticketed event cannot go on sale with no way to take the money — unless
   * there is no money. Demanding Stripe onboarding for an event that will never
   * charge anybody is where a community organizer abandons the product.
   */
  const readiness = await organizerReadiness(event.organizer_id);
  const { isFree, needs } = await eventSetup(event);
  const payment = rules.paymentReadiness({
    listingType: event.listing_type,
    acceptsStripe: event.accepts_stripe,
    acceptsManual: event.accepts_manual,
    isFree,
    ...readiness,
  });
  if (!payment.ok) {
    blockers.push({
      status: 409,
      error: 'PAYMENT_METHOD_REQUIRED',
      message: payment.reason === 'NO_CHANNEL'
        ? 'Choose how buyers pay for this event (Stripe, manual payment, or both) before submitting it.'
        : 'The payment option on this event is not set up yet. Connect Stripe or add a manual payment method, then submit.',
      meta: { reason: payment.reason },
    });
  }

  return {
    blockers,
    termsId,
    termsVersion: version,
    termsAccepted: accepted,
    isFree,
    needs,
    payment,
    readiness,
  };
}

/** One priced line of the preview, from the same function that prices a sale. */
function priceLine({ label, kind, priceCents, detail, fees, stripe }) {
  const b = describeOrder({
    faceCents: Number(priceCents) || 0,
    quantity: 1,
    eventTaxPct: fees.eventTaxPct,
    commissionPct: fees.commissionPct,
    commissionTaxPct: fees.commissionTaxPct,
    paymentFeeMode: fees.paymentFeeMode,
    paymentFeePct: fees.paymentFeePct,
    paymentFeeFixedCents: fees.paymentFeeFixedCents,
    feeBearer: fees.feeBearer,
    stripe,
  });

  return {
    label,
    kind,
    detail: detail || null,
    faceCents: b.faceCents,
    eventTaxCents: b.eventTaxCents,
    commissionCents: b.commissionCents,
    commissionTaxCents: b.commissionTaxCents,
    paymentFeeCents: b.paymentFeeCents,
    // What Stripe bills US on this order. Shown to the organizer because "the
    // platform takes X" is only half an answer if part of X is a card cost that
    // never reaches Eventsli either.
    stripeCostCents: b.stripeCostCents,
    // The two numbers the whole dialog exists for.
    buyerTotalCents: b.buyerTotalCents,
    organizerNetCents: b.organizerNetCents,
    // What leaves the organizer's side in total, however it is split up.
    platformTakeCents: b.applicationFeeCents,
    isFree: b.subtotalCents === 0,
  };
}

/**
 * Everything the confirmation dialog shows, in one request.
 *
 * One round trip rather than six, because this opens on a click and a dialog
 * that fills in piece by piece is one an organizer starts reading before it has
 * finished changing.
 */
async function preview({ eventId, userId }) {
  const { data: event, error } = await supabase
    .from('events')
    .select(`id, slug, title, description, status, listing_type, admission_type, category,
             venue_name, venue_address, city, country, venue_lat, venue_lng,
             starts_at, ends_at, timezone, currency, cover_url,
             max_tickets_per_order, allow_ticket_transfer,
             commission_pct, commission_tax_pct, event_tax_pct,
             payment_fee_mode, payment_fee_pct, payment_fee_fixed_cents, fee_bearer,
             accepts_stripe, accepts_manual, organizer_id`)
    .eq('id', eventId)
    .single();
  if (error) throw new Error(error.message);

  const [state, stripe, { data: tiers }, { data: policies }, { data: map }] = await Promise.all([
    submissionBlockers({ event, userId }),
    stripeCostModel(),
    supabase.from('ticket_tiers')
      .select('id, name, price_cents, quantity, sold_count, kind, is_hidden, sort_order')
      .eq('event_id', eventId).order('sort_order').order('created_at'),
    supabase.from('event_policies')
      .select('id, kind, title, body, show_at_checkout')
      .eq('event_id', eventId).order('sort_order'),
    supabase.from('venue_maps').select('id').eq('event_id', eventId).maybeSingle(),
  ]);

  const fees = {
    commissionPct: Number(event.commission_pct),
    commissionTaxPct: Number(event.commission_tax_pct),
    eventTaxPct: Number(event.event_tax_pct),
    paymentFeeMode: event.payment_fee_mode === 'manual'
      ? PAYMENT_FEE_MODE.MANUAL : PAYMENT_FEE_MODE.AUTO,
    paymentFeePct: Number(event.payment_fee_pct),
    paymentFeeFixedCents: Number(event.payment_fee_fixed_cents),
    feeBearer: event.fee_bearer === 'organizer' ? FEE_BEARER.ORGANIZER : FEE_BEARER.BUYER,
  };

  const lines = (tiers || []).map((t) => priceLine({
    label: t.name,
    kind: 'tier',
    priceCents: t.price_cents,
    detail: [
      t.quantity === null || t.quantity === undefined ? null : `${t.quantity} available`,
      t.is_hidden ? 'hidden from the public listing' : null,
    ].filter(Boolean).join(' · ') || null,
    fees,
    stripe,
  }));

  /**
   * Whole tables, grouped by price rather than listed one by one. Twelve tables
   * at $800 is one line an organizer can check, not twelve identical rows that
   * bury the ticket types above them.
   */
  if (map) {
    const { data: tables } = await supabase
      .from('tables').select('label, price_cents, seat_count')
      .eq('venue_map_id', map.id).not('price_cents', 'is', null);

    const byPrice = new Map();
    for (const t of tables || []) {
      const key = Number(t.price_cents);
      const seen = byPrice.get(key) || { count: 0, seats: 0 };
      byPrice.set(key, { count: seen.count + 1, seats: seen.seats + (Number(t.seat_count) || 0) });
    }
    for (const [priceCents, group] of [...byPrice.entries()].sort((a, b) => b[0] - a[0])) {
      lines.push(priceLine({
        label: group.count === 1 ? 'Whole table' : `Whole tables (${group.count})`,
        kind: 'table',
        priceCents,
        detail: `bought as a unit · seats ${group.seats}`,
        fees,
        stripe,
      }));
    }
  }

  return {
    event: {
      id: event.id,
      slug: event.slug,
      title: event.title,
      description: event.description,
      status: event.status,
      listingType: event.listing_type,
      admissionType: event.admission_type,
      category: event.category,
      venueName: event.venue_name,
      venueAddress: event.venue_address,
      city: event.city,
      country: event.country,
      hasCoordinates: event.venue_lat !== null && event.venue_lng !== null,
      startsAt: event.starts_at,
      endsAt: event.ends_at,
      timezone: event.timezone,
      currency: event.currency,
      coverUrl: event.cover_url,
      maxTicketsPerOrder: event.max_tickets_per_order,
      allowTicketTransfer: event.allow_ticket_transfer,
      acceptsStripe: event.accepts_stripe,
      acceptsManual: event.accepts_manual,
    },
    fees: {
      ...fees,
      // The real card cost, so "Stripe takes" is a figure and not a rumour.
      stripe: { pct: stripe.pct, fixedCents: stripe.fixedCents },
    },
    lines,
    /** Ticket types exist at all — a submit with none is an empty event. */
    hasTickets: (tiers || []).length > 0 || lines.length > 0,
    policies: (policies || []).map((p) => ({
      id: p.id,
      kind: p.kind,
      title: p.title,
      body: p.body,
      showAtCheckout: p.show_at_checkout,
    })),
    terms: {
      accepted: state.termsAccepted,
      version: state.termsVersion ?? null,
    },
    isFree: state.isFree,
    needs: state.needs,
    blockers: state.blockers.map((b) => ({ code: b.error, message: b.message, meta: b.meta || null })),
    canSubmit: state.blockers.length === 0,
  };
}

module.exports = {
  organizerReadiness, eventSetup, submissionBlockers, preview, SUBMIT_SELECT,
};
