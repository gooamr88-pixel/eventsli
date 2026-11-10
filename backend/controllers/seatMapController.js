const { supabase } = require('../config/supabase');
const venue = require('../services/venueService');
const media = require('../services/mediaService');
const access = require('../services/tableAccessService');
const { sendOk, sendFail } = require('../utils/responseEnvelope');
const accessTokens = require('../services/accessTokens');
const logger = require('../utils/logger');
const { fetchAll } = require('../utils/fetchAll');
const { sellableSeats } = require('../services/seatSellability');
const ticketDetails = require('../services/ticketDetails');

const TTL_MINUTES = () => parseInt(process.env.RESERVATION_TTL_MINUTES || '35', 10);

// ═══ ORGANIZER ══════════════════════════════════════════════════════════════

// GET /events/:eventId/venue-map
async function getMap(req, res, next) {
  try {
    const map = await venue.getMapForOrganizer(req.params.eventId);
    return sendOk(res, map || { tables: [], looseSeats: [], layout: {} });
  } catch (err) { return next(err); }
}

// PUT /events/:eventId/venue-map
async function putMap(req, res, next) {
  try {
    // The actor is recorded with every price change the save makes (S-10).
    const result = await venue.saveMap(req.params.eventId, req.body, { actorId: req.user?.id || null });
    return sendOk(res, result);
  } catch (err) {
    if (['VALIDATION_ERROR', 'CONFLICT', 'MAP_STALE'].includes(err.code)) {
      return sendFail(res, {
        status: err.code === 'VALIDATION_ERROR' ? 400 : 409, error: err.code, message: err.message,
      });
    }
    return next(err);
  }
}

// ═══ VENUE STUDIO ═══════════════════════════════════════════════════════════

/** A MediaError or a coded service refusal is an answer; anything else is a fault. */
function studioFail(res, err, next) {
  const { ERROR_STATUS: status } = require('../utils/responseEnvelope');
  if (!err?.code || !(err.code in status)) return next(err);
  return sendFail(res, { status: status[err.code], error: err.code, message: err.message });
}

/**
 * POST /events/:eventId/venue-map/upload — sign an upload for the venue photo
 * or a 360° panorama. The same two steps as the cover (mediaService): the
 * server picks the key, the browser PUTs the bytes, then confirms below.
 */
async function signAssetUpload(req, res, next) {
  try {
    const signed = await media.signUpload({
      eventId: req.params.eventId,
      contentType: String(req.body.contentType || '').toLowerCase(),
      kind: req.body.kind,
    });
    return sendOk(res, signed);
  } catch (err) { return studioFail(res, err, next); }
}

/**
 * POST /events/:eventId/venue-map/assets — confirm an uploaded studio image.
 *
 * Writes nothing. It proves the object landed under this event and returns
 * its path and URL for the editor's draft; the layout save is what keeps it,
 * and that save re-derives the URL from the path (venueStudio.js).
 */
async function confirmAsset(req, res, next) {
  try {
    const { ownPath } = require('../services/venueStudio');
    if (!ownPath(req.params.eventId, req.body.path, ['venue', 'panorama'])) {
      return sendFail(res, {
        status: 400, error: 'VALIDATION_ERROR', message: 'That image does not belong to this venue.',
      });
    }
    const asset = await media.attach({ eventId: req.params.eventId, path: req.body.path });
    return sendOk(res, asset);
  } catch (err) { return studioFail(res, err, next); }
}

/** PUT /events/:eventId/venue-map/availability — block or release seats. */
async function setAvailability(req, res, next) {
  try {
    const result = await venue.setSeatAvailability(
      req.params.eventId, req.body.seatIds, req.body.blocked === true,
    );
    return sendOk(res, result);
  } catch (err) { return studioFail(res, err, next); }
}

// ═══ PUBLIC ═════════════════════════════════════════════════════════════════

/**
 * GET /public/events/:slug/seat-map
 *
 * What a buyer sees. Three things are deliberately absent:
 *
 *   • private tables they have not unlocked — omitted entirely, not flagged
 *     (see tableAccessService for why a flag is not privacy);
 *   • password hashes;
 *   • which reservation is holding a seat — a held seat is just unavailable.
 *     Exposing the reservation id would let someone watch a competitor's
 *     checkout, or map the holds to guess when stock is about to free up.
 */
async function publicMap(req, res, next) {
  try {
    // Every read here checks its error. They did not, so a failed read was
    // indistinguishable from an absent row: a timeout on the event answered
    // "That event is not available", and one on the seats drew an empty room.
    // A failure is a 500 the page can offer to retry; absence is a real answer.
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('id, slug, title, status, currency, purchase_mode, admission_type, max_tickets_per_order, starts_at, ends_at')
      .eq('slug', req.params.slug)
      .maybeSingle();
    if (eventError) throw new Error(`seat map: event lookup failed: ${eventError.message}`);

    if (!event || event.status !== 'published') {
      // 404 for anything not on sale — draft, pending, suspended and cancelled
      // all look alike from outside, which is correct: a rejected event should
      // not be discoverable by its slug.
      return sendFail(res, {
        status: 404, error: 'EVENT_NOT_FOUND', message: 'That event is not available.',
      });
    }

    const { data: map, error: mapError } = await supabase
      .from('venue_maps').select('id, layout_json, version').eq('event_id', event.id).maybeSingle();
    if (mapError) throw new Error(`seat map: map lookup failed: ${mapError.message}`);

    if (!map) {
      return sendOk(res, { event: publicEvent(event), map: null, tables: [], seats: [] });
    }

    // Tokens arrive as a header so they survive a page refresh without ending
    // up in the URL — and therefore out of browser history and server logs.
    const unlocked = access.unlockedTableIds(
      (req.headers['x-table-access'] || '').split(',').filter(Boolean),
      event.id,
    );

    const tables = await fetchAll(({ from, to }, first) => supabase
      .from('tables')
      .select('id, label, seat_count, price_cents, is_private, status, position_x, position_y, rotation, shape, category_id',
        first ? { count: 'exact' } : undefined)
      .eq('venue_map_id', map.id)
      .order('id')
      .range(from, to), { what: 'tables' });

    // In LABEL order (T1, T2 … T10), not id order. The map draws by position
    // either way, but keyboard and screen-reader users move through tables in
    // array order, and id order is random: T2, T5, T1, T3…
    const visible = tables
      .filter((t) => !t.is_private || unlocked.has(t.id))
      .sort((a, b) => String(a.label).localeCompare(String(b.label), 'en', { numeric: true }));
    const visibleIds = new Set(visible.map((t) => t.id));

    // ALL the seats, in pages. One request returned at most 1,000 of them, and a
    // different 1,000 as holds and sales moved rows — see utils/fetchAll.js.
    const seats = await fetchAll(({ from, to }, first) => supabase
      .from('seats')
      .select('id, table_id, tier_id, section_key, row_label, seat_number, price_override_cents, status',
        first ? { count: 'exact' } : undefined)
      .eq('venue_map_id', map.id)
      .order('id')
      .range(from, to), { what: 'seats' });

    // A seat belonging to a hidden table is hidden with it — otherwise the
    // table's existence, size and price leak through its seats.
    const visibleSeats = seats.filter((s) => !s.table_id || visibleIds.has(s.table_id));

    const { data: tiers, error: tierError } = await supabase
      .from('ticket_tiers')
      .select('id, name, description, kind, price_cents, quantity, sold_count, sales_start_at, sales_end_at, max_per_order, details')
      .eq('event_id', event.id);
    if (tierError) throw new Error(`seat map: tier lookup failed: ${tierError.message}`);

    const sellability = sellableSeats(seats, tiers || []);
    const seatReason = new Map(visibleSeats.map((s) => [s.id, sellability.reasonFor(s)]));
    const tableClear = new Map();
    for (const s of visibleSeats) {
      if (!s.table_id) continue;
      tableClear.set(s.table_id, (tableClear.get(s.table_id) ?? true) && seatReason.get(s.id) === null);
    }

    return sendOk(res, {
      event: publicEvent(event),
      map: { id: map.id, layout: map.layout_json, version: map.version },
      tiers: (tiers || []).map((t) => ({
        id: t.id,
        name: t.name,
        priceCents: t.price_cents,
        // What the legend and the selection need to say before the hold does.
        onSale: sellability.tier.get(t.id).onSale,
        soldOut: sellability.tier.get(t.id).soldOut,
        maxPerOrder: t.max_per_order === null ? null : Number(t.max_per_order),
        // The organizer's details card, shown before buying (ticketDetails.js).
        description: t.description || null,
        kind: t.kind || 'standard',
        details: ticketDetails.present(event.id, t.details),
      })),
      tables: visible.map((t) => ({
        id: t.id,
        label: t.label,
        seatCount: t.seat_count,
        priceCents: t.price_cents,
        isPrivate: t.is_private,
        // `partial` is meaningful to a buyer: the table can no longer be booked
        // whole, but individual seats on it may still be free (BRD §25).
        status: t.status,
        // Every seat that comes with the table has to be sellable too: its
        // ticket type on sale and not sold out (S-07).
        canBookWhole: t.status === 'available' && t.price_cents !== null
          && event.purchase_mode !== 'seat_only' && tableClear.get(t.id) === true,
        position: { x: Number(t.position_x), y: Number(t.position_y), rotation: Number(t.rotation) },
        shape: t.shape,
        categoryId: t.category_id,
      })),
      seats: visibleSeats.map((s) => {
        const reason = seatReason.get(s.id);
        return {
          id: s.id,
          tableId: s.table_id,
          tierId: s.tier_id,
          section: s.section_key,
          row: s.row_label,
          number: s.seat_number,
          priceCents: sellability.priceOf(s),
          // `available` means "can be chosen now" (S-07). It used to mean only
          // "nobody holds it", so seats with no price, or of a type off sale or
          // sold out, looked free and were refused at the hold — and the refusal
          // reloaded a map that showed the same seats free again.
          available: reason === null,
          // Why not, in buyer terms. Held and sold collapse to `taken`: which
          // one is our business; to a buyer both mean "not yours".
          ...(reason ? { reason } : {}),
        };
      }),
      // Private tables the buyer has not unlocked are counted, not listed, so
      // the map can say "3 reserved tables" without naming them.
      hiddenTableCount: tables.length - visible.length,
    });
  } catch (err) { return next(err); }
}

function publicEvent(e) {
  return {
    id: e.id, slug: e.slug, title: e.title, currency: e.currency,
    purchaseMode: e.purchase_mode,
    // A general-admission event has no map, so a client that lands here for one
    // knows to send the buyer to the ticket picker instead of rendering an
    // empty room.
    admissionType: e.admission_type || 'reserved',
    maxTicketsPerOrder: e.max_tickets_per_order,
    startsAt: e.starts_at, endsAt: e.ends_at,
  };
}

/**
 * POST /public/events/:slug/tables/:tableId/unlock
 *
 * Answers only "yes, here is a token" or "no". Never says whether the table
 * exists, whether it is private, or whether it is already sold — all of which
 * would make this endpoint a directory of the protected tables.
 */
async function unlockTable(req, res, next) {
  try {
    const { data: event } = await supabase
      .from('events').select('id, status').eq('slug', req.params.slug).maybeSingle();

    if (!event || event.status !== 'published') {
      return sendFail(res, { status: 404, error: 'EVENT_NOT_FOUND', message: 'That event is not available.' });
    }

    const ok = await access.verifyTablePassword(req.params.tableId, req.body.password);
    if (!ok) {
      logger.warn({ eventId: event.id, tableId: req.params.tableId }, 'table unlock failed');
      return sendFail(res, {
        status: 403, error: 'TABLE_PASSWORD_INVALID',
        message: 'That password does not match.',
      });
    }

    return sendOk(res, {
      token: access.issueAccessToken({ eventId: event.id, tableId: req.params.tableId }),
      expiresInMinutes: access.ACCESS_TTL_MINUTES,
    });
  } catch (err) { return next(err); }
}

// ═══ HOLDS ══════════════════════════════════════════════════════════════════

/**
 * POST /public/events/:slug/hold
 * body: { seatIds: [...] }  or  { tableId }
 *
 * A thin wrapper. Every rule — availability, the per-order limit, purchase
 * mode, whether a table has gone partial — is decided inside the Postgres
 * function, because only there can the check and the write be one act.
 */
async function hold(req, res, next) {
  try {
    const { data: event } = await supabase
      .from('events').select('id, status').eq('slug', req.params.slug).maybeSingle();

    if (!event || event.status !== 'published') {
      return sendFail(res, { status: 404, error: 'EVENT_NOT_FOUND', message: 'That event is not available.' });
    }

    const userId = req.user?.id || null;   // null is a guest checkout
    const { seatIds, tableId, lines } = req.body;

    let result;
    let rpcError = null;
    if (Array.isArray(lines)) {
      /**
       * GENERAL ADMISSION — a quantity of a ticket type, with no seat behind it.
       *
       * No private-table check, because there are no tables: the whole point of
       * GA is that stock is a number on a ticket type rather than a place in a
       * room. The rules that DO apply — the sale window, the per-type order cap,
       * the allocation — are all enforced inside `hold_general`, under a row
       * lock on the tiers, because three separate paths take stock and a rule
       * checked out here is a rule the other two do not have.
       */
      ({ data: result, error: rpcError } = await supabase.rpc('hold_general', {
        p_event_id: event.id, p_user_id: userId, p_lines: lines, p_ttl_minutes: TTL_MINUTES(),
      }));
    } else if (tableId) {
      // A private table needs its token presented here too. Without this check
      // the password would gate only the map, and anyone who guessed the id
      // could buy the table without ever seeing it.
      const isPrivate = await tableIsPrivate(tableId);
      if (isPrivate) {
        const unlocked = access.unlockedTableIds(
          (req.headers['x-table-access'] || '').split(',').filter(Boolean), event.id,
        );
        if (!unlocked.has(tableId)) {
          return sendFail(res, {
            status: 403, error: 'TABLE_PASSWORD_REQUIRED',
            message: 'This table needs its password before it can be booked.',
          });
        }
      }
      ({ data: result, error: rpcError } = await supabase.rpc('hold_table', {
        p_event_id: event.id, p_user_id: userId, p_table_id: tableId, p_ttl_minutes: TTL_MINUTES(),
      }));
    } else {
      // BRD §27 — seats AT a private table need its token too. Only the
      // whole-table path checked, so a seat id — still valid after the unlock
      // token expired, or forwarded by someone who had it — could be held
      // without ever knowing the password.
      const privateTables = await privateTablesFor(seatIds);
      if (privateTables.length > 0) {
        const unlocked = access.unlockedTableIds(
          (req.headers['x-table-access'] || '').split(',').filter(Boolean), event.id,
        );
        if (privateTables.some((id) => !unlocked.has(id))) {
          return sendFail(res, {
            status: 403, error: 'TABLE_PASSWORD_REQUIRED',
            message: 'Some of those seats are at a private table. Unlock it with its password first.',
          });
        }
      }
      ({ data: result, error: rpcError } = await supabase.rpc('hold_seats', {
        p_event_id: event.id, p_user_id: userId, p_seat_ids: seatIds, p_ttl_minutes: TTL_MINUTES(),
      }));
    }

    // A failed call is not a taken seat. It used to fall through to the
    // refusal below and tell the buyer the seats had gone (T-039).
    if (rpcError) throw new Error(`hold failed: ${rpcError.message}`);

    if (!result?.ok) {
      return sendFail(res, {
        status: statusFor(result?.error),
        error: result?.error || 'CONFLICT',
        message: result?.message || 'Those seats are no longer available.',
        meta: result?.requested !== undefined
          ? { requested: result.requested, available: result.available } : undefined,
      });
    }

    return sendOk(res, {
      reservationId: result.reservation_id,
      // Proof that this caller made the hold. Required to release it or change
      // its promo code — a bare reservation id is not proof, because it travels
      // to the client and anyone who picks one up could drop someone's seats
      // while they were paying.
      reservationToken: accessTokens.issueReservationToken(result.reservation_id),
      expiresAt: result.expires_at,
      seatCount: result.seat_count,
      subtotalCents: result.subtotal_cents,
      currency: result.currency,
      tableLabel: result.table_label,
    }, { status: 201 });
  } catch (err) { return next(err); }
}

// POST /public/reservations/:reservationId/release
async function release(req, res, next) {
  try {
    // Releasing is destructive and reaches a stranger's seats. The id alone is
    // not authority to do it — the token proves this caller made the hold.
    const authorised = accessTokens.readReservationToken(accessTokens.fromRequest(req));
    if (authorised !== req.params.reservationId) {
      return sendFail(res, {
        status: 403, error: 'FORBIDDEN',
        message: 'That hold is not yours to release.',
      });
    }

    // A Stripe page still open on this hold would take payment for seats about
    // to go back on sale. Made unpayable first; refused if already paid, since
    // that payment's fulfilment needs the hold (TECH-AUDIT-LOG T-010).
    try {
      await require('../services/checkoutSessions').closeOpenSession(req.params.reservationId);
    } catch (err) {
      if (err.code) {
        return sendFail(res, { status: statusFor(err.code), error: err.code, message: err.message });
      }
      throw err;
    }

    // Released FIRST. A limited code otherwise leaks one use per abandoned
    // checkout, and the leak is invisible until the code runs out early.
    await require('../services/promoService').release(req.params.reservationId);

    const { data: result, error: releaseError } = await supabase.rpc('release_reservation', {
      p_reservation_id: req.params.reservationId,
    });
    if (releaseError) throw new Error(`release_reservation failed: ${releaseError.message}`);
    if (!result?.ok) {
      return sendFail(res, {
        status: statusFor(result?.error), error: result?.error || 'CONFLICT',
        message: result?.message || 'That hold could not be released.',
      });
    }
    return sendOk(res, { released: true, seats: result.seats_released });
  } catch (err) { return next(err); }
}

/** The private tables any of these seats sit at. Throws on a lookup error: this is a gate, so it fails closed. */
async function privateTablesFor(seatIds) {
  if (!Array.isArray(seatIds) || seatIds.length === 0) return [];
  const { data, error } = await supabase
    .from('seats')
    .select('table_id, tables!inner ( is_private )')
    .in('id', seatIds)
    .eq('tables.is_private', true);
  if (error) throw new Error(`private table lookup failed: ${error.message}`);
  return [...new Set((data || []).map((s) => s.table_id))];
}

/**
 * Throws on a lookup error, like `privateTablesFor`. This used to read `data`
 * only, so a failed lookup answered "not private" and a private table became
 * holdable without its password (TECH-AUDIT-LOG T-015). A gate fails closed.
 */
async function tableIsPrivate(tableId) {
  const { data, error } = await supabase
    .from('tables').select('is_private').eq('id', tableId).maybeSingle();
  if (error) throw new Error(`private table lookup failed: ${error.message}`);
  return !!data?.is_private;
}

const { ERROR_STATUS } = require('../utils/responseEnvelope');
const statusFor = (code) => ERROR_STATUS[code] || 409;

module.exports = {
  getMap, putMap, publicMap, unlockTable, hold, release, signAssetUpload, confirmAsset, setAvailability,
};
