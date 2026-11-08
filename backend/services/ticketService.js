const jwt = require('jsonwebtoken');
const { supabase } = require('../config/supabase');
const { fetchAll } = require('../utils/fetchAll');
const { transferProof } = require('../utils/ticketTransfer');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The scannable credential.
 *
 * A ticket's QR carries a SIGNED TOKEN, not a database id. An id in a QR is a
 * bearer credential with no integrity: print a few, notice they are sequential
 * or simply guessable, and you are into the venue. A signature means a code
 * that was not issued by us cannot be made to verify at all — the scanner
 * rejects it before it touches the network, which also matters at a gate with
 * bad signal.
 *
 * Signed with QR_JWT_SECRET, deliberately NOT the session secret: a leaked QR
 * secret must not also mint logins, and vice versa.
 *
 * The token carries no expiry. A ticket is valid until the event, and re-issuing
 * one because a token aged out would mean a guest who screenshotted their pass a
 * month ago is turned away at the door. Whether it may be used is decided by the
 * ticket row — status, event, and whether it has already been scanned.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const TOKEN_TYPE = 'ticket';

/**
 * `version` is tickets.qr_version. A transfer bumps it, so the code the seller
 * still has on their phone is older than the ticket and the door refuses it as
 * `transferred` (T-016). Left out of the token while it is 0, so every ticket
 * that was never transferred keeps the exact code already in its email.
 */
function issueQrToken({ ticketId, eventId, version = 0 }) {
  const claims = { typ: TOKEN_TYPE, tid: ticketId, eid: eventId };
  if (Number.isInteger(version) && version > 0) claims.v = version;
  return jwt.sign(claims, process.env.QR_JWT_SECRET, { algorithm: 'HS256' });
}

/**
 * Decode without touching the database.
 *
 * Split from the status check so the scanner can reject a forgery instantly and
 * offline, and only spend a round trip on codes that are genuinely ours.
 */
function decodeQrToken(token) {
  try {
    const claims = jwt.verify(String(token), process.env.QR_JWT_SECRET, { algorithms: ['HS256'] });
    if (claims.typ !== TOKEN_TYPE) return null;
    if (!claims.tid || !claims.eid) return null;
    // Absent on every code issued before a transfer: version 0.
    const version = claims.v === undefined ? 0 : claims.v;
    if (!Number.isInteger(version) || version < 0) return null;
    return { ticketId: claims.tid, eventId: claims.eid, version };
  } catch {
    return null;
  }
}

/** Every ticket on an order, with its QR. */
async function forOrder(orderId) {
  const { data, error } = await supabase
    .from('tickets')
    .select(`id, event_id, status, attendee_name, transfer_count, qr_version, scanned_at,
             seats ( section_key, row_label, seat_number ),
             tables ( label ),
             ticket_tiers ( name )`)
    .eq('order_id', orderId)
    .order('created_at')
    .order('id');
  // Thrown, not swallowed: a failed read used to render as an order with NO
  // tickets — on the success page, seconds after somebody paid.
  if (error) throw new Error(`could not read the order's tickets: ${error.message}`);

  return (data || []).map(shape);
}

/**
 * The same thing, for MANY orders, in one round trip.
 *
 * `forOrder` in a loop is what "My tickets" used to do — up to a hundred
 * sequential queries to render one page, each waiting on the last. The list is
 * already bounded by the caller's page size, so the whole set fits in a single
 * `in.()` and the grouping is cheaper here than a hundred network waits.
 *
 * Returns a Map keyed by order id. Orders with no tickets are simply absent,
 * so callers use `?? []` rather than relying on a key existing — an order can
 * legitimately have none while a refund or a correction is in progress.
 */
async function forOrders(orderIds) {
  const ids = [...new Set((orderIds || []).filter(Boolean))];
  if (ids.length === 0) return new Map();

  // In pages: a hundred orders of whole tables is thousands of tickets, and one
  // request stops at 1,000 without saying so (utils/fetchAll.js). Ordered once,
  // for the whole set — grouping preserves it, so each order's tickets come out
  // in the same sequence `forOrder` gives them.
  const data = await fetchAll(({ from, to }, first) => supabase
    .from('tickets')
    .select(`id, order_id, event_id, status, attendee_name, transfer_count, qr_version, scanned_at,
             seats ( section_key, row_label, seat_number ),
             tables ( label ),
             ticket_tiers ( name )`, first ? { count: 'exact' } : undefined)
    .in('order_id', ids)
    .order('created_at')
    .order('id')
    .range(from, to), { what: 'tickets' });

  const byOrder = new Map();
  for (const row of data) {
    if (!byOrder.has(row.order_id)) byOrder.set(row.order_id, []);
    byOrder.get(row.order_id).push(shape(row));
  }
  return byOrder;
}

async function forToken(token) {
  const decoded = decodeQrToken(token);
  if (!decoded) return null;

  const { data } = await supabase
    .from('tickets')
    .select(`id, event_id, status, attendee_name, transfer_count, qr_version, scanned_at,
             seats ( section_key, row_label, seat_number ),
             tables ( label ),
             ticket_tiers ( name ),
             events ( title, slug, starts_at, ends_at, timezone, venue_name, status )`)
    .eq('id', decoded.ticketId)
    .maybeSingle();

  // The signature proves we issued it; this proves it is for the event it
  // claims. Without the second check, a valid token for event A would look
  // valid when presented at event B.
  if (!data || data.event_id !== decoded.eventId) return null;
  // A code from before a transfer is the seller's, and must not be traded in
  // for the recipient's current one.
  if (decoded.version < (data.qr_version || 0)) return null;
  return { ...shape(data, { holder: true }), event: data.events };
}

/**
 * Tickets someone was GIVEN — the other half of a transfer (T-016).
 *
 * `GET /tickets` matched orders by buyer only, so the email telling a
 * recipient "it is in your account" pointed at a page without it. Matched on
 * the ticket's own address, which a transfer sets, and only on paid orders.
 * Grouped by the order they came from so the page renders them like any other.
 */
async function receivedBy(email) {
  const address = String(email || '').trim().toLowerCase();
  if (!address) return [];

  const { data, error } = await supabase
    .from('tickets')
    .select(`id, order_id, event_id, status, attendee_name, transfer_count, qr_version, scanned_at, transferred_at,
             seats ( section_key, row_label, seat_number ),
             tables ( label ),
             ticket_tiers ( name ),
             orders!inner ( status ),
             events ( id, title, slug, starts_at, ends_at, timezone, venue_name, status )`)
    .eq('attendee_email', address)
    .gt('transfer_count', 0)
    .eq('orders.status', 'paid')
    .order('transferred_at', { ascending: false })
    .order('id')
    .limit(200);
  if (error) throw new Error(`could not read received tickets: ${error.message}`);

  const byOrder = new Map();
  for (const row of data || []) {
    if (!byOrder.has(row.order_id)) {
      byOrder.set(row.order_id, {
        orderId: row.order_id,
        event: row.events,
        receivedAt: row.transferred_at,
        tickets: [],
      });
    }
    byOrder.get(row.order_id).tickets.push(shape(row, { holder: true }));
  }
  return [...byOrder.values()];
}

/**
 * One ticket as a page shows it.
 *
 * `holder` is whose copy this is. A transferred ticket's code belongs to the
 * person it was given to: on the BUYER's order (My tickets, the emailed link,
 * a resent email) it comes back without one, because a fresh code minted there
 * would carry the new version and walk the seller straight back in.
 */
function shape(t, { holder = false } = {}) {
  const transferred = (t.transfer_count || 0) > 0;
  return {
    id: t.id,
    status: t.status,
    attendeeName: t.attendee_name,
    seat: t.seats
      ? { section: t.seats.section_key, row: t.seats.row_label, number: t.seats.seat_number }
      : null,
    table: t.tables?.label || null,
    // The ticket type the printed ticket names ("General Admission", "VIP").
    // Null when the tier was deleted after the sale (tier_id is ON DELETE SET
    // NULL); the ticket then simply leaves the line out.
    tierName: t.ticket_tiers?.name || null,
    transferred,
    // The buyer's copy of a ticket they gave away: no code, and the page says why.
    transferredAway: transferred && !holder,
    scannedAt: t.scanned_at,
    qr: transferred && !holder
      ? null
      : issueQrToken({ ticketId: t.id, eventId: t.event_id, version: t.qr_version || 0 }),
  };
}

/**
 * BRD §10 — a ticket may be passed on ONCE.
 *
 * The counter is checked in the WHERE clause, not read and then written: two
 * simultaneous transfers would both pass a read-then-check and both succeed,
 * leaving one ticket claimed by two people.
 */
async function transfer({ ticketId, ownerUserId, ownerEmail, tokenOrderId = null, toEmail }) {
  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, order_id, transfer_count, qr_version, status, attendee_email, orders ( id, user_id, guest_email ), events ( allow_ticket_transfer )')
    .eq('id', ticketId)
    .maybeSingle();

  if (!ticket) throw fail('TICKET_NOT_FOUND', 'That ticket does not exist.');
  if (!ticket.events?.allow_ticket_transfer) {
    throw fail('TRANSFER_DISABLED', 'The organizer has turned off transfers for this event.');
  }
  if (ticket.status !== 'valid') {
    throw fail('CONFLICT', 'That ticket cannot be transferred.');
  }
  if (ticket.transfer_count >= 1) {
    throw fail('ALREADY_TRANSFERRED', 'This ticket has already been passed on once, and cannot be transferred again.');
  }

  /**
   * OWNERSHIP, PROVEN — not assumed. The decision is `transferProof`
   * (utils/ticketTransfer.js), which fails CLOSED and says why.
   *
   * Twice wrong before. First the guard skipped whenever `orders.user_id` was
   * null — every guest purchase — so holding a ticket id was enough. Then the
   * guest proof was a `proofEmail` the caller typed, so knowing the buyer's
   * address was enough, and the organizer sees it on the door list. Now a
   * guest proves the INBOX: a verified account on that address, or the signed
   * order token the confirmation email carries.
   */
  const order = ticket.orders ? { id: ticket.orders.id || ticket.order_id, ...ticket.orders } : null;
  if (!transferProof(order, { userId: ownerUserId, email: ownerEmail, tokenOrderId })) {
    throw fail('FORBIDDEN',
      'We could not confirm this is your ticket. Sign in with the account that bought it, '
      + 'or use the link in your confirmation email.');
  }

  const from = ticket.attendee_email || ticket.orders?.guest_email || null;

  const { data, error } = await supabase
    .from('tickets')
    .update({
      attendee_email: String(toEmail).trim().toLowerCase(),
      transfer_count: 1,
      transferred_at: new Date().toISOString(),
      transferred_from: from,
      // The credential moves with the ticket (T-016): every code issued before
      // this line is now older than the ticket, and the door refuses it.
      qr_version: (ticket.qr_version || 0) + 1,
    })
    .eq('id', ticketId)
    .eq('transfer_count', 0)   // the guard, applied atomically
    .select('id, transferred_at')
    .single();

  if (error || !data) {
    throw fail('ALREADY_TRANSFERRED', 'This ticket has already been passed on once.');
  }
  // Both parties are told (BRD §10) — the sending is the caller's job; this
  // returns what the notification needs.
  return { ticketId: data.id, from, to: toEmail, transferredAt: data.transferred_at };
}

function fail(code, message) {
  return Object.assign(new Error(message), { code });
}

module.exports = { issueQrToken, decodeQrToken, forOrder, forOrders, forToken, receivedBy, transfer };
