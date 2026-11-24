const { supabase } = require('../config/supabase');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Who each ticket is for (owner, 2026-11-19).
 *
 * On an order of two or more tickets the checkout asks, per ticket, the
 * holder's first and last name, phone and email. The event decides how
 * strictly (events.holder_details): 'full' — first AND last name on every
 * ticket (owner, 2026-11-24) — 'required' — first name — 'optional' or 'off'.
 * An order of one ticket asks nothing: the ticket is named from the buyer's
 * own details, and under 'full' that name must hold a last name too.
 *
 * The answers are saved on the reservation (reservation_holders) before any
 * money moves; the database names each ticket as it is issued
 * (trigger apply_ticket_holder, migration 20261201090000). A seat's ticket
 * takes its seat's holder; general admission takes the next one of its type.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const MODES = ['full', 'required', 'optional', 'off'];
/** Modes that need a first name; 'full' needs the last name as well. */
const needsFirst = (mode) => mode === 'full' || mode === 'required';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^[0-9+\-() ]{7,20}$/;
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const byNumber = (a, b) => String(a.seat_number).localeCompare(String(b.seat_number), undefined, { numeric: true });

function placeLabel(seat, table) {
  if (!seat) return null;
  if (table && !table.section_name) return `Table ${table.label} · Seat ${seat.seat_number}`;
  const parts = [seat.section_key || table?.section_name, seat.row_label ? `Row ${seat.row_label}` : null, `Seat ${seat.seat_number}`];
  return parts.filter(Boolean).join(' · ');
}

/**
 * One slot per ticket this hold will issue, in a stable order:
 * { key, seatId, tierId, title: "Ticket 1", place, tierName }.
 */
async function slotsFor(q) {
  const items = q.items || [];
  const reservationId = q.reservation?.id;
  const seatIds = items.filter((i) => i.seat_id).map((i) => i.seat_id);
  const wholeTables = items.filter((i) => i.table_id && !i.seat_id).map((i) => i.table_id);

  const seatCols = 'id, table_id, tier_id, section_key, row_label, seat_number';
  const [direct, tableSeats] = await Promise.all([
    seatIds.length ? supabase.from('seats').select(seatCols).in('id', seatIds) : { data: [] },
    wholeTables.length && reservationId
      ? supabase.from('seats').select(seatCols).in('table_id', wholeTables).eq('held_by_reservation', reservationId)
      : { data: [] },
  ]);
  if (direct.error) throw new Error(`holder slots: seats read failed: ${direct.error.message}`);
  if (tableSeats.error) throw new Error(`holder slots: table seats read failed: ${tableSeats.error.message}`);

  const seats = [...(direct.data || [])];
  const seen = new Set(seats.map((s) => s.id));
  for (const s of (tableSeats.data || []).sort(byNumber)) if (!seen.has(s.id)) seats.push(s);

  const tableIds = [...new Set(seats.map((s) => s.table_id).filter(Boolean))];
  const tierIds = [...new Set([...seats.map((s) => s.tier_id), ...items.map((i) => i.tier_id)].filter(Boolean))];
  const [tables, tiers] = await Promise.all([
    tableIds.length ? supabase.from('tables').select('id, label, section_name').in('id', tableIds) : { data: [] },
    tierIds.length ? supabase.from('ticket_tiers').select('id, name').in('id', tierIds) : { data: [] },
  ]);
  const tableOf = new Map((tables.data || []).map((t) => [t.id, t]));
  const tierName = new Map((tiers.data || []).map((t) => [t.id, t.name]));

  // Seats in the order they were chosen, a whole table's seats by number.
  const order = new Map(seatIds.map((id, i) => [id, i]));
  seats.sort((a, b) => (order.has(a.id) && order.has(b.id) ? order.get(a.id) - order.get(b.id) : 0));

  const slots = seats.map((s) => ({
    key: `seat:${s.id}`,
    seatId: s.id,
    tierId: s.tier_id || null,
    place: placeLabel(s, tableOf.get(s.table_id)),
    tierName: tierName.get(s.tier_id) || null,
  }));
  for (const item of items.filter((i) => !i.seat_id && !i.table_id)) {
    const qty = Math.max(1, Number(item.quantity) || 1);
    for (let n = 1; n <= qty; n += 1) {
      slots.push({
        key: `ga:${item.tier_id || 'none'}:${n}`,
        seatId: null,
        tierId: item.tier_id || null,
        place: null,
        tierName: tierName.get(item.tier_id) || 'General admission',
      });
    }
  }
  return slots.map((s, i) => ({ ...s, title: `Ticket ${i + 1}` }));
}

/** The event's setting, defaulting to 'required' if the column is not there yet. */
async function modeFor(eventId) {
  const { data, error } = await supabase.from('events').select('holder_details').eq('id', eventId).maybeSingle();
  if (error) return 'off';   // a deploy ahead of its migration: ask nothing rather than fail a sale
  return MODES.includes(data?.holder_details) ? data.holder_details : 'required';
}

/** What the checkout page needs to draw the forms. */
async function forCheckout(q) {
  const mode = await modeFor(q.event.id);
  if (mode === 'off') return { mode, slots: [] };
  const slots = await slotsFor(q);
  return { mode, slots: slots.length > 1 ? slots : [] };
}

function splitName(full) {
  const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: '', last: '' };
  return { first: parts[0].slice(0, 60), last: parts.slice(1).join(' ').slice(0, 60) };
}

/**
 * Check and store the holders for this hold, replacing any saved before.
 * `input` is [{ key, firstName, lastName, phone, email }] keyed by slot.
 * → { ok: true } or { code: 'VALIDATION_ERROR', message, meta: { key } }.
 */
async function save(q, input, buyer) {
  const reservationId = q.reservation.id;
  const mode = await modeFor(q.event.id);
  const slots = mode === 'off' ? [] : await slotsFor(q);

  const rows = [];
  if (slots.length === 1) {
    // One ticket: the buyer's own. Named only when the buyer gave a name.
    const { first, last } = splitName(buyer?.name);
    // First and last name on every ticket (2026-11-24): the buyer's own too.
    if (mode === 'full' && (!first || !last)) {
      return {
        code: 'VALIDATION_ERROR',
        message: 'Add your first and last name — this event prints both on every ticket.',
        meta: { field: 'name' },
      };
    }
    if (first) {
      rows.push({
        slot: slots[0], first_name: first, last_name: last || null,
        phone: buyer.phone || null, email: buyer.email || null,
      });
    }
  } else if (slots.length > 1) {
    const given = new Map((Array.isArray(input) ? input : []).filter((h) => h && typeof h === 'object').map((h) => [String(h.key), h]));
    for (const slot of slots) {
      const h = given.get(slot.key) || {};
      const label = [slot.title, slot.place || slot.tierName].filter(Boolean).join(' · ');
      const first = str(h.firstName, 60);
      const last = str(h.lastName, 60);
      const phone = str(h.phone, 30);
      const email = str(h.email, 254).toLowerCase();
      const bad = (message) => ({ code: 'VALIDATION_ERROR', message, meta: { key: slot.key } });
      if (needsFirst(mode) && !first) return bad(`Add the first name for ${label}.`);
      if (mode === 'full' && !last) return bad(`Add the last name for ${label}.`);
      if (phone && !PHONE.test(phone)) return bad(`Check the phone number for ${label}.`);
      if (email && !EMAIL.test(email)) return bad(`Check the email address for ${label}.`);
      if (first || last || phone || email) {
        rows.push({ slot, first_name: first || null, last_name: last || null, phone: phone || null, email: email || null });
      }
    }
  }

  const { error: clearError } = await supabase.from('reservation_holders').delete().eq('reservation_id', reservationId);
  if (clearError) throw new Error(`holders: clear failed: ${clearError.message}`);
  if (rows.length === 0) return { ok: true, saved: 0 };
  const { error } = await supabase.from('reservation_holders').insert(rows.map((r, i) => ({
    reservation_id: reservationId,
    position: i + 1,
    seat_id: r.slot.seatId,
    tier_id: r.slot.tierId,
    first_name: r.first_name,
    last_name: r.last_name,
    phone: r.phone,
    email: r.email,
  })));
  if (error) throw new Error(`holders: save failed: ${error.message}`);
  return { ok: true, saved: rows.length };
}

module.exports = { MODES, slotsFor, modeFor, forCheckout, save, splitName, placeLabel };
