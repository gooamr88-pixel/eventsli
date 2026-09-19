const { supabase } = require('../config/supabase');
const { sendOk, sendFail } = require('../utils/responseEnvelope');
const { writeAudit } = require('../services/auditService');
const submission = require('../services/submissionService');
const terms = require('../services/termsService');
const rules = require('../services/eventRules');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * DRAFTS — events that were started and never sent.
 *
 * WHAT WAS MISSING. A draft has always existed in the schema, and an organizer
 * could always reach one through Your events with a status filter. What they
 * could not do is see, from one place, WHICH of their half-finished events is
 * waiting on what. So a draft abandoned two steps from being sellable looks
 * exactly like one abandoned at the title, and neither gets finished.
 *
 * A DRAFT IS DELIBERATELY CHEAP TO MAKE AND KEEP. It needs a title, a date and
 * a time zone — the three things the row cannot exist without — and nothing
 * else. No venue, no city, no seating map, no ticket type, no payment method.
 * Every one of those is required to SUBMIT, and `submissionService` is where
 * that is enforced. Requiring them earlier does not produce the information; it
 * produces placeholder text that reaches the public listing.
 *
 * THE PROGRESS IS COMPUTED HERE, FROM REAL STATE, IN A FIXED NUMBER OF
 * QUERIES. The obvious implementation asks per event and turns a list of twelve
 * drafts into fifty round trips. Instead the tiers, maps, seats and the
 * organizer's readiness are read once for the whole list.
 *
 * It answers the SAME questions as the per-event launch checklist, in the same
 * order, because an organizer who reads "Ticket types" here and opens the event
 * must not be told something different by the page they land on.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** The statuses that are a draft to the organizer: not sent, or sent back. */
const DRAFT_STATUSES = ['draft', 'rejected'];

const SELECT = `id, title, status, slug, listing_type, admission_type, category,
                starts_at, ends_at, timezone, currency, cover_url,
                venue_name, venue_address, city, country,
                accepts_stripe, accepts_manual, terms_accepted_id,
                rejection_reason, created_at, updated_at`;

/** Counts keyed by event id, from one `in` query. */
function tally(rows, key = 'event_id') {
  const out = new Map();
  for (const row of rows || []) out.set(row[key], (out.get(row[key]) || 0) + 1);
  return out;
}

// ─── GET /events/drafts ─────────────────────────────────────────────────────
async function list(req, res, next) {
  try {
    const organizerId = req.user.access.organizerId;
    if (!organizerId) {
      return sendFail(res, {
        status: 404, error: 'NOT_FOUND', message: 'You do not have an organizer profile yet.',
      });
    }

    const { data: events, error } = await supabase
      .from('events')
      .select(SELECT)
      .eq('organizer_id', organizerId)
      .in('status', DRAFT_STATUSES)
      .is('archived_at', null)
      // Most recently touched first: the one somebody just left is the one they
      // are coming back to.
      .order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);

    if (!events || events.length === 0) return sendOk(res, []);

    const ids = events.map((e) => e.id);

    const [{ data: tiers }, { data: maps }, readiness, currentTermsId] = await Promise.all([
      supabase.from('ticket_tiers').select('event_id, price_cents').in('event_id', ids),
      supabase.from('venue_maps').select('id, event_id').in('event_id', ids),
      submission.organizerReadiness(organizerId),
      currentTerms(),
    ]);

    /**
     * Seats and priced tables, for the maps that exist.
     *
     * SEATS ARE COUNTED, NOT FETCHED. The only question asked of them is "are
     * there any", and a drawn room holds thousands of rows — pulling them all
     * across every draft to answer a boolean is the kind of query that is fine
     * until somebody has drawn an arena. `head: true` transfers none of them.
     * Tables ARE read, because their prices decide whether the event is free.
     */
    const mapIds = (maps || []).map((m) => m.id);
    const mapOwner = new Map((maps || []).map((m) => [m.id, m.event_id]));
    let seatCounts = [];
    let tableRows = [];
    if (mapIds.length > 0) {
      const [counts, { data: tables }] = await Promise.all([
        Promise.all(mapIds.map(async (mapId) => {
          const { count } = await supabase
            .from('seats').select('id', { count: 'exact', head: true }).eq('venue_map_id', mapId);
          return { mapId, count: count || 0 };
        })),
        supabase.from('tables').select('venue_map_id, price_cents').in('venue_map_id', mapIds),
      ]);
      seatCounts = counts;
      tableRows = tables || [];
    }

    const tierRows = tiers || [];
    const tierCount = tally(tierRows);
    const seatCount = new Map();
    for (const { mapId, count } of seatCounts) {
      const eventId = mapOwner.get(mapId);
      seatCount.set(eventId, (seatCount.get(eventId) || 0) + count);
    }
    const tableCount = tally(tableRows.map((t) => ({ event_id: mapOwner.get(t.venue_map_id) })));

    return sendOk(res, events.map((event) => describe({
      event,
      tiers: tierRows.filter((t) => t.event_id === event.id),
      tables: tableRows.filter((t) => mapOwner.get(t.venue_map_id) === event.id),
      hasMap: (maps || []).some((m) => m.event_id === event.id),
      counts: {
        tiers: tierCount.get(event.id) || 0,
        seats: seatCount.get(event.id) || 0,
        tables: tableCount.get(event.id) || 0,
      },
      readiness,
      currentTermsId,
    })));
  } catch (err) { return next(err); }
}

/** The organizer terms in force, or null — never an error here. */
async function currentTerms() {
  try {
    return (await terms.currentVersion('organizer')).id;
  } catch {
    return null;
  }
}

/**
 * One draft, and where it stopped.
 *
 * `next` is the step an organizer should open, and `href` is the screen it is
 * on — so "Resume" lands on the thing that is missing rather than on an
 * overview they then have to read.
 */
function describe({ event, tiers, tables, hasMap, counts, readiness, currentTermsId }) {
  const isFree = rules.isFreeEvent(
    tiers.map((t) => ({ priceCents: Number(t.price_cents) })),
    tables.map((t) => ({ priceCents: t.price_cents === null ? null : Number(t.price_cents) })),
  );
  const needs = rules.eventNeeds({
    listingType: event.listing_type,
    admissionType: event.admission_type || 'reserved',
    isFree,
  });

  const payment = rules.paymentReadiness({
    listingType: event.listing_type,
    acceptsStripe: event.accepts_stripe,
    acceptsManual: event.accepts_manual,
    isFree,
    ...readiness,
  });

  const base = `/organizer/events/${event.id}`;
  const steps = [
    {
      key: 'details',
      label: 'Where it happens',
      // The venue, not the title: a draft cannot exist without a title, and
      // the venue is what is actually missing on nearly every one of these.
      done: Boolean(
        String(event.venue_name || '').trim()
        && String(event.venue_address || '').trim()
        && String(event.city || '').trim(),
      ),
      href: `${base}#details`,
    },
    ...(needs.tickets ? [{
      key: 'tiers', label: 'Ticket types', done: counts.tiers > 0, href: `${base}/tiers`,
    }] : []),
    ...(needs.seating ? [{
      key: 'map', label: 'Seating map', done: counts.seats > 0 || counts.tables > 0, href: `${base}/map`,
    }] : []),
    ...(needs.payment ? [{
      key: 'payments', label: 'How buyers pay', done: payment.ok, href: `${base}#details`,
    }] : []),
    {
      key: 'terms',
      label: 'Accept the terms',
      done: rules.termsAcceptedFor(event, currentTermsId),
      href: `${base}#going-on-sale`,
    },
    {
      key: 'submit',
      label: 'Submit for review',
      // Never done — a draft that had been submitted would not be in this list.
      done: false,
      href: `${base}#going-on-sale`,
    },
  ];

  const next = steps.find((s) => !s.done) || null;

  return {
    id: event.id,
    title: event.title,
    status: event.status,
    listingType: event.listing_type,
    admissionType: event.admission_type,
    category: event.category,
    startsAt: event.starts_at,
    endsAt: event.ends_at,
    timezone: event.timezone,
    currency: event.currency,
    coverUrl: event.cover_url,
    venueName: event.venue_name,
    city: event.city,
    rejectionReason: event.rejection_reason,
    createdAt: event.created_at,
    updatedAt: event.updated_at,
    isFree,
    needs,
    steps,
    done: steps.filter((s) => s.done).length,
    total: steps.length,
    next,
    // A draft has never sold anything, so it is always the organizer's to
    // remove. The database is the final word — see `remove` below.
    canDelete: true,
  };
}

// ─── DELETE /events/:eventId ────────────────────────────────────────────────
/**
 * REMOVES A DRAFT, AND ONLY A DRAFT.
 *
 * Archive is the answer for everything else, and it stays the answer: an event
 * that has been seen, sold or reviewed leaves a trail that has to survive it.
 * A draft is private, never listed and never sold — keeping one forever because
 * the platform has no verb for "I started this by mistake" is how the events
 * list becomes unusable.
 *
 * THREE GUARDS, AND THE LAST ONE IS THE DATABASE'S. The status is checked here,
 * the sales are checked here, and `orders`, `tickets`, `ledger_entries` and
 * `invoices` all reference the event `ON DELETE RESTRICT` — so if anything
 * financial exists that this handler did not think of, Postgres refuses rather
 * than cascading. Everything else about an event (its tiers, map, seats,
 * policies, media, sponsors, schedule) is `ON DELETE CASCADE` and goes with it.
 */
async function remove(req, res, next) {
  try {
    const { data: event, error } = await supabase
      .from('events')
      .select('id, title, status, organizer_id')
      .eq('id', req.params.eventId)
      .single();
    if (error) throw new Error(error.message);

    if (!DRAFT_STATUSES.includes(event.status)) {
      return sendFail(res, {
        status: 409,
        error: 'CONFLICT',
        message: event.status === 'archived'
          ? 'This event is archived, not a draft. Restore it if you need it back.'
          : `Only a draft can be deleted. Archive this event instead — it is ${event.status}.`,
      });
    }

    // A draft should have none of these. Checked anyway, because "should" is
    // not a guarantee and the message for a refusal here is far better than the
    // database's.
    const [{ count: orders }, { count: tickets }] = await Promise.all([
      supabase.from('orders').select('id', { count: 'exact', head: true }).eq('event_id', event.id),
      supabase.from('tickets').select('id', { count: 'exact', head: true }).eq('event_id', event.id),
    ]);
    if ((orders || 0) > 0 || (tickets || 0) > 0) {
      return sendFail(res, {
        status: 409,
        error: 'CONFLICT',
        message: 'This event has tickets against it and cannot be deleted. Archive it instead.',
      });
    }

    // Written BEFORE the delete: afterwards there is no row to describe, and an
    // audit entry that says what was removed is the only record left of it.
    await writeAudit(req, {
      action: 'event.draft_deleted',
      targetType: 'event',
      targetId: event.id,
      payload: { title: event.title, status: event.status },
    });

    const { error: delError } = await supabase.from('events').delete().eq('id', event.id);
    if (delError) {
      // 23503 — a foreign key held it. Something financial exists after all.
      if (delError.code === '23503') {
        return sendFail(res, {
          status: 409,
          error: 'CONFLICT',
          message: 'Something on this event cannot be removed. Archive it instead.',
        });
      }
      throw new Error(delError.message);
    }

    return sendOk(res, { id: event.id, deleted: true });
  } catch (err) { return next(err); }
}

module.exports = { list, remove, DRAFT_STATUSES };
