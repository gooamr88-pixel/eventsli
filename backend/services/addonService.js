const { supabase } = require('../config/supabase');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * TICKET ADD-ONS (owner, 2026-11-17) — "Photo with the headliner", a meet &
 * greet: extras sold with a ticket, delivered by the ORGANIZER, who alone is
 * responsible for them. Eventsli takes the payment, under the same fees as
 * the tickets (they are part of the order's subtotal).
 *
 * The rules that need a lock — at most one per ticket in the order, never
 * past the organizer's stock — are in `set_reservation_addons` (migration
 * 20261125090000). Paid add-ons are attached to tickets by a trigger in the
 * same transaction as the order, so no payment path can miss them.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const COLUMNS = 'id, event_id, name, description, price_cents, quantity, sort_order, is_active, created_at, updated_at';

function fail(code, message, meta) {
  return Object.assign(new Error(message), { code, ...(meta ? { meta } : {}) });
}

/** How many of each add-on are taken: on paid tickets, and on live holds. */
async function takenCounts(addonIds) {
  if (!addonIds.length) return new Map();
  const [sold, held] = await Promise.all([
    supabase.from('ticket_addons').select('addon_id, tickets!inner ( status )').in('addon_id', addonIds).neq('tickets.status', 'void'),
    supabase.from('reservation_addons').select('addon_id, quantity, reservations!inner ( state, expires_at )')
      .in('addon_id', addonIds).eq('reservations.state', 'active').gt('reservations.expires_at', new Date().toISOString()),
  ]);
  if (sold.error) throw new Error(`add-on sold count failed: ${sold.error.message}`);
  if (held.error) throw new Error(`add-on held count failed: ${held.error.message}`);
  const taken = new Map();
  for (const r of sold.data || []) taken.set(r.addon_id, (taken.get(r.addon_id) || 0) + 1);
  for (const r of held.data || []) taken.set(r.addon_id, (taken.get(r.addon_id) || 0) + Number(r.quantity));
  return taken;
}

/** The sold count alone — what the organizer's screen shows, and what locks a price. */
async function soldCounts(addonIds) {
  if (!addonIds.length) return new Map();
  const { data, error } = await supabase.from('ticket_addons')
    .select('addon_id, tickets!inner ( status )').in('addon_id', addonIds).neq('tickets.status', 'void');
  if (error) throw new Error(`add-on sold count failed: ${error.message}`);
  const sold = new Map();
  for (const r of data || []) sold.set(r.addon_id, (sold.get(r.addon_id) || 0) + 1);
  return sold;
}

function shape(a, { sold = 0, taken = 0 } = {}) {
  return {
    id: a.id,
    name: a.name,
    description: a.description || null,
    priceCents: Number(a.price_cents),
    quantity: a.quantity ?? null,
    remaining: a.quantity === null || a.quantity === undefined ? null : Math.max(0, a.quantity - taken),
    sold,
    sortOrder: a.sort_order,
    isActive: a.is_active,
  };
}

/** The organizer's list, with what has sold. */
async function listForOrganizer(eventId) {
  const { data, error } = await supabase.from('event_addons').select(COLUMNS)
    .eq('event_id', eventId).order('sort_order').order('created_at');
  if (error) throw new Error(error.message);
  const ids = (data || []).map((a) => a.id);
  const [sold, taken] = await Promise.all([soldCounts(ids), takenCounts(ids)]);
  return (data || []).map((a) => shape(a, { sold: sold.get(a.id) || 0, taken: taken.get(a.id) || 0 }));
}

/** What a buyer is offered: active add-ons with what is left. */
async function listForBuyer(eventId) {
  const { data, error } = await supabase.from('event_addons').select(COLUMNS)
    .eq('event_id', eventId).eq('is_active', true).order('sort_order').order('created_at');
  if (error) throw new Error(error.message);
  const taken = await takenCounts((data || []).map((a) => a.id));
  return (data || []).map((a) => {
    const s = shape(a, { taken: taken.get(a.id) || 0 });
    return { id: s.id, name: s.name, description: s.description, priceCents: s.priceCents, remaining: s.remaining };
  });
}

function rowFrom(body, { partial = false } = {}) {
  const row = {};
  if (!partial || body.name !== undefined) row.name = String(body.name || '').trim();
  if (!partial || body.description !== undefined) row.description = body.description ? String(body.description).trim() : null;
  if (!partial || body.priceCents !== undefined) row.price_cents = Number(body.priceCents);
  if (!partial || body.quantity !== undefined) row.quantity = body.quantity === null || body.quantity === '' || body.quantity === undefined ? null : Number(body.quantity);
  if (body.sortOrder !== undefined) row.sort_order = Number(body.sortOrder);
  if (body.isActive !== undefined) row.is_active = body.isActive === true;
  return row;
}

async function create(eventId, body) {
  const { data, error } = await supabase.from('event_addons')
    .insert({ event_id: eventId, ...rowFrom(body) }).select(COLUMNS).single();
  if (error) throw new Error(error.message);
  return shape(data);
}

/**
 * An edit. Once any has SOLD, the price is fixed — buyers paid it — and the
 * stock may not go below what is already sold.
 */
async function update(eventId, addonId, body) {
  const { data: current, error: readError } = await supabase.from('event_addons').select(COLUMNS)
    .eq('id', addonId).eq('event_id', eventId).maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!current) throw fail('NOT_FOUND', 'That add-on does not exist.');
  const row = rowFrom(body, { partial: true });
  const sold = (await soldCounts([addonId])).get(addonId) || 0;
  if (sold > 0 && row.price_cents !== undefined && row.price_cents !== Number(current.price_cents)) {
    throw fail('CONFLICT', `${sold} already sold at the current price, so the price is fixed. Add a new add-on for a new price.`);
  }
  if (row.quantity !== undefined && row.quantity !== null && row.quantity < sold) {
    throw fail('CONFLICT', `${sold} are already sold, so the number available cannot go below ${sold}.`);
  }
  row.updated_at = new Date().toISOString();
  const { data, error } = await supabase.from('event_addons').update(row)
    .eq('id', addonId).eq('event_id', eventId).select(COLUMNS).single();
  if (error) throw new Error(error.message);
  const taken = await takenCounts([addonId]);
  return shape(data, { sold, taken: taken.get(addonId) || 0 });
}

/** Deleted if never chosen by anyone; otherwise switched off, so its sales keep their name. */
async function remove(eventId, addonId) {
  const [{ count: everHeld }, sold] = await Promise.all([
    supabase.from('reservation_addons').select('addon_id', { count: 'exact', head: true }).eq('addon_id', addonId),
    soldCounts([addonId]),
  ]);
  if ((everHeld || 0) === 0 && !(sold.get(addonId) > 0)) {
    const { error } = await supabase.from('event_addons').delete().eq('id', addonId).eq('event_id', eventId);
    if (error) throw new Error(error.message);
    return { deleted: true };
  }
  const { error } = await supabase.from('event_addons').update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', addonId).eq('event_id', eventId);
  if (error) throw new Error(error.message);
  return { deleted: false, deactivated: true };
}

/** A hold's add-ons, at the price chosen: `[{ addonId, name, quantity, unitPriceCents, amountCents }]`. */
async function forReservation(reservationId) {
  const { data, error } = await supabase.from('reservation_addons')
    .select('addon_id, quantity, unit_price_cents, event_addons ( name, sort_order )')
    .eq('reservation_id', reservationId);
  if (error) throw new Error(`hold add-ons lookup failed: ${error.message}`);
  return (data || [])
    .map((r) => {
      const a = Array.isArray(r.event_addons) ? r.event_addons[0] : r.event_addons;
      return {
        addonId: r.addon_id,
        name: a?.name || 'Add-on',
        quantity: Number(r.quantity),
        unitPriceCents: Number(r.unit_price_cents),
        amountCents: Number(r.unit_price_cents) * Number(r.quantity),
        sortOrder: a?.sort_order ?? 0,
      };
    })
    .sort((x, y) => x.sortOrder - y.sortOrder);
}

/** Sets a hold's add-ons (the whole choice). Throws `{ code, meta }` on a refusal. */
async function setForReservation(reservationId, lines) {
  const { data, error } = await supabase.rpc('set_reservation_addons', {
    p_reservation_id: reservationId,
    p_lines: (lines || []).map((l) => ({ addonId: l.addonId, quantity: Number(l.quantity) || 0 })),
  });
  if (error) throw new Error(`set_reservation_addons failed: ${error.message}`);
  if (!data?.ok) throw fail(data?.error || 'CONFLICT', data?.message || 'Those add-ons could not be added.', data?.available !== undefined ? { available: data.available } : undefined);
  return data;
}

/** Each ticket's add-ons, by name: `Map<ticketId, string[]>`. */
async function namesForTickets(ticketIds) {
  const map = new Map();
  if (!ticketIds?.length) return map;
  const { data, error } = await supabase.from('ticket_addons')
    .select('ticket_id, event_addons ( name, sort_order )').in('ticket_id', ticketIds);
  if (error) throw new Error(`ticket add-ons lookup failed: ${error.message}`);
  const rows = (data || []).map((r) => {
    const a = Array.isArray(r.event_addons) ? r.event_addons[0] : r.event_addons;
    return { ticketId: r.ticket_id, name: a?.name || 'Add-on', sort: a?.sort_order ?? 0 };
  }).sort((x, y) => x.sort - y.sort);
  for (const r of rows) map.set(r.ticketId, [...(map.get(r.ticketId) || []), r.name]);
  return map;
}

module.exports = {
  listForOrganizer, listForBuyer, create, update, remove,
  forReservation, setForReservation, namesForTickets, fail,
};
