const { supabase } = require('../config/supabase');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * AN ORGANIZER CORRECTS A BUYER'S CONTACT ON ONE ORDER (2026-11-23).
 *
 * The common case is a typo in an email — "gmial.com" — and a buyer who never
 * got their tickets. So this edits the ORDER's own contact fields
 * (`guest_name`, `guest_email`, `guest_phone`), which are what the ticket
 * email, the door's "who to expect" and the Orders list all read first.
 *
 * WHAT IT NEVER TOUCHES:
 *   · a buyer's Eventsli ACCOUNT. Their profile is theirs; an organizer
 *     changing it would change every other order they ever placed, with every
 *     other organizer. Only this order's contact changes.
 *   · a ticket holder someone named separately (a friend's ticket). Those are
 *     their own person. Only tickets that carry the BUYER's old name or email
 *     — a door sale stamps the buyer onto each ticket — are kept in step, so
 *     the door list does not keep the misspelling.
 *   · a transferred ticket: its holder is, by definition, not the buyer.
 *
 * An order with an email cannot have it removed: that address is where the
 * tickets live, and a guest order without one breaks the table's
 * `buyer_identified` constraint. One that never had one (a free booking on a
 * name alone) may stay without.
 * ─────────────────────────────────────────────────────────────────────────────
 */
class OrderContactError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
const fail = (code, message) => new OrderContactError(code, message);

const clean = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s || null;
};
const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

/** The contact as the order uses it: its own fields first, the account's after. */
function effectiveContact(order) {
  const account = Array.isArray(order.profiles) ? order.profiles[0] : order.profiles;
  return {
    name: clean(order.guest_name) || clean(account?.full_name),
    email: clean(order.guest_email) || clean(account?.email),
    phone: clean(order.guest_phone),
  };
}

/**
 * Applies the edit. Returns what it was, what it is now, which fields changed,
 * and how many of the buyer's own tickets were brought in step.
 */
async function updateContact(eventId, orderId, input) {
  const { data: order, error } = await supabase
    .from('orders')
    .select('id, event_id, status, user_id, guest_name, guest_email, guest_phone, profiles!orders_user_id_fkey ( full_name, email )')
    .eq('id', orderId)
    .eq('event_id', eventId)
    .maybeSingle();
  if (error) throw new Error(`order read failed: ${error.message}`);
  if (!order) throw fail('NOT_FOUND', 'That order is not on this event.');

  const before = effectiveContact(order);
  const after = {
    name: clean(input.name),
    email: clean(input.email)?.toLowerCase() || null,
    phone: clean(input.phone),
  };
  if (!after.name) throw fail('VALIDATION_ERROR', 'Enter the buyer’s name.');
  if (!after.email && before.email) {
    throw fail('VALIDATION_ERROR', 'This order’s tickets were sent to an email address, so it needs one. Enter the correct address.');
  }

  const changed = {
    name: after.name !== before.name,
    email: !same(after.email, before.email),
    phone: (after.phone || null) !== (before.phone || null),
  };
  if (!changed.name && !changed.email && !changed.phone) {
    return { order, before, after: before, changed, ticketsUpdated: 0 };
  }

  const { error: upErr } = await supabase
    .from('orders')
    .update({ guest_name: after.name, guest_email: after.email, guest_phone: after.phone })
    .eq('id', order.id)
    .eq('event_id', eventId);
  if (upErr) throw new Error(`order contact update failed: ${upErr.message}`);

  const ticketsUpdated = await keepBuyerTicketsInStep(order.id, before, after, changed);
  return { order, before, after, changed, ticketsUpdated };
}

/**
 * The buyer's own tickets — the ones carrying the buyer's old name or email,
 * never transferred — take the new values. Few per order, so they are read
 * and compared here rather than matched with a pattern in the database, where
 * a name with a `%` in it would match others.
 */
async function keepBuyerTicketsInStep(orderId, before, after, changed) {
  if (!changed.name && !changed.email) return 0;
  const { data: tickets, error } = await supabase
    .from('tickets')
    .select('id, attendee_name, attendee_email, transfer_count')
    .eq('order_id', orderId);
  if (error) throw new Error(`order tickets read failed: ${error.message}`);

  let updated = 0;
  for (const t of tickets || []) {
    if (Number(t.transfer_count) > 0) continue;
    const patch = {};
    if (changed.name && t.attendee_name && before.name && same(t.attendee_name, before.name)) patch.attendee_name = after.name;
    if (changed.email && t.attendee_email && before.email && same(t.attendee_email, before.email)) patch.attendee_email = after.email;
    if (!Object.keys(patch).length) continue;
    const { error: tErr } = await supabase.from('tickets').update(patch).eq('id', t.id).eq('order_id', orderId);
    if (tErr) throw new Error(`ticket contact update failed: ${tErr.message}`);
    updated += 1;
  }
  return updated;
}

module.exports = { updateContact, effectiveContact, OrderContactError };
