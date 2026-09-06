const jwt = require('jsonwebtoken');
const { supabase } = require('../config/supabase');

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

function issueQrToken({ ticketId, eventId }) {
  return jwt.sign(
    { typ: TOKEN_TYPE, tid: ticketId, eid: eventId },
    process.env.QR_JWT_SECRET,
    { algorithm: 'HS256' },
  );
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
    return { ticketId: claims.tid, eventId: claims.eid };
  } catch {
    return null;
  }
}

/** Every ticket on an order, with its QR. */
async function forOrder(orderId) {
  const { data } = await supabase
    .from('tickets')
    .select(`id, event_id, status, attendee_name, transfer_count, scanned_at,
             seats ( section_key, row_label, seat_number ),
             tables ( label )`)
    .eq('order_id', orderId)
    .order('created_at');

  return (data || []).map(shape);
}

async function forToken(token) {
  const decoded = decodeQrToken(token);
  if (!decoded) return null;

  const { data } = await supabase
    .from('tickets')
    .select(`id, event_id, status, attendee_name, transfer_count, scanned_at,
             seats ( section_key, row_label, seat_number ),
             tables ( label ),
             events ( title, slug, starts_at, ends_at, timezone, venue_name, status )`)
    .eq('id', decoded.ticketId)
    .maybeSingle();

  // The signature proves we issued it; this proves it is for the event it
  // claims. Without the second check, a valid token for event A would look
  // valid when presented at event B.
  if (!data || data.event_id !== decoded.eventId) return null;
  return { ...shape(data), event: data.events };
}

function shape(t) {
  return {
    id: t.id,
    status: t.status,
    attendeeName: t.attendee_name,
    seat: t.seats
      ? { section: t.seats.section_key, row: t.seats.row_label, number: t.seats.seat_number }
      : null,
    table: t.tables?.label || null,
    transferred: (t.transfer_count || 0) > 0,
    scannedAt: t.scanned_at,
    qr: issueQrToken({ ticketId: t.id, eventId: t.event_id }),
  };
}

/**
 * BRD §10 — a ticket may be passed on ONCE.
 *
 * The counter is checked in the WHERE clause, not read and then written: two
 * simultaneous transfers would both pass a read-then-check and both succeed,
 * leaving one ticket claimed by two people.
 */
async function transfer({ ticketId, ownerUserId, toEmail, proofEmail }) {
  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, order_id, transfer_count, status, attendee_email, orders ( user_id, guest_email ), events ( allow_ticket_transfer )')
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
   * OWNERSHIP, PROVEN — not assumed.
   *
   * The previous check read:
   *
   *   if (ownerUserId && ticket.orders?.user_id && ticket.orders.user_id !== ownerUserId)
   *
   * which skipped entirely when EITHER side was null — and `orders.user_id` is
   * null for every guest purchase, which is the primary path in this product.
   * So the guard looked like a guard and, in the common case, let anyone
   * holding a ticket id transfer it away from the person who paid. A transfer
   * is one-way and one-time, so the real buyer lost the ticket permanently.
   *
   * Now it fails CLOSED: one of these must positively hold, or the transfer is
   * refused.
   */
  const buyerUserId = ticket.orders?.user_id || null;
  const buyerEmail = (ticket.orders?.guest_email || '').toLowerCase() || null;
  const claimed = String(proofEmail || '').trim().toLowerCase() || null;

  const isAccountOwner = !!(ownerUserId && buyerUserId && buyerUserId === ownerUserId);
  // A guest proves ownership with the address the tickets were sent to — the
  // same address the emailed link went to, and the only thing they have.
  const isGuestOwner = !!(claimed && buyerEmail && claimed === buyerEmail);

  if (!isAccountOwner && !isGuestOwner) {
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

module.exports = { issueQrToken, decodeQrToken, forOrder, forToken, transfer };
