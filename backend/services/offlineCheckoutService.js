const { supabase } = require('../config/supabase');
const pricing = require('./pricingService');
const accessTokens = require('./accessTokens');
const emailService = require('./emailService');
const logger = require('../utils/logger');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * OFFLINE CHECKOUT (global launch, phase 2).
 *
 * A buyer reserves online and pays the ORGANIZER directly, with the organizer's
 * own instructions; the organizer marks it paid; only then are tickets issued.
 * Every state change happens inside one Postgres function under a row lock —
 * offline_reserve, offline_confirm, offline_cancel, order_void_offline, and the
 * expiry sweep — and each writes its own payment_audit row. This module only
 * prices, chooses the deadline, and sends the emails.
 *
 * Off until `offline_checkout.enabled` is true (Admin → Settings). With it off,
 * every entry point answers FEATURE_DISABLED and nothing else changes.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const DEFAULTS = Object.freeze({ enabled: false, payment_hours: 48, min_hours_before_event: 2 });

function fail(code, message, meta) {
  return Object.assign(new Error(message), { code, meta });
}

async function settings() {
  const { data, error } = await supabase
    .from('platform_settings').select('value').eq('key', 'offline_checkout').maybeSingle();
  if (error) throw new Error(error.message);
  return { ...DEFAULTS, ...(data?.value || {}) };
}

async function assertEnabled() {
  const s = await settings();
  if (s.enabled !== true) {
    throw fail('FEATURE_DISABLED', 'Paying the organizer offline is not available yet.');
  }
  return s;
}

/**
 * When the payment must be confirmed: the event's own window, or the
 * platform's, but never later than `min_hours_before_event` before the doors.
 * Null when that leaves less than an hour — too late to pay offline.
 */
function dueAt({ startsAt, eventHours, setting, now = new Date() }) {
  const hours = Number(eventHours) > 0 ? Number(eventHours) : Number(setting.payment_hours) || DEFAULTS.payment_hours;
  const byWindow = now.getTime() + hours * 3600e3;
  const byEvent = new Date(startsAt).getTime() - (Number(setting.min_hours_before_event) || 0) * 3600e3;
  const due = Math.min(byWindow, byEvent);
  return due - now.getTime() < 3600e3 ? null : new Date(due);
}

/** The organizer's active methods, as a buyer may see them before choosing. */
async function methodsFor(organizerId) {
  const { data, error } = await supabase
    .from('organizer_payment_methods')
    .select('id, kind, label')
    .eq('organizer_id', organizerId).eq('is_active', true)
    .order('created_at');
  if (error) throw new Error(error.message);
  return data || [];
}

/**
 * What the buyer's checkout needs: whether card is possible (unchanged rules,
 * services/purchasability.js), whether offline is offered, and how.
 */
async function optionsForReservation(reservationId) {
  const s = await settings();
  const q = await pricing.quoteReservation(reservationId, { offline: true });
  const { data: event } = await supabase
    .from('events')
    .select('id, organizer_id, listing_type, accepts_stripe, accepts_manual, starts_at, offline_payment_hours')
    .eq('id', q.event.id).maybeSingle();
  const { card } = await require('./purchasability').forEvent(event);
  if (!s.enabled || !event?.accepts_manual) return { card, available: false };
  const due = dueAt({ startsAt: event.starts_at, eventHours: event.offline_payment_hours, setting: s });
  const methods = await methodsFor(event.organizer_id);
  if (!due || methods.length === 0) return { card, available: false, reason: due ? 'NO_METHODS' : 'TOO_LATE' };
  return {
    card,
    available: true,
    dueAt: due.toISOString(),
    totalCents: q.breakdown.buyerTotalCents,
    currency: q.event.currency,
    methods,
    // The same line items the card checkout shows — minus any card fee.
    lines: pricing.publicBreakdown(q).lines,
  };
}

/** Shape of an offline payment for the buyer's page (never internal fields). */
function publicShape(row, event, organizerName) {
  return {
    id: row.id,
    status: row.status,
    reference: row.reference_code,
    amountCents: Number(row.amount_cents),
    currency: row.currency,
    dueAt: row.due_at,
    method: { kind: row.method?.kind, label: row.method?.label, instructions: row.method?.instructions },
    confirmedAt: row.confirmed_at,
    closedAt: row.closed_at,
    orderId: row.status === 'paid' ? row.order_id : null,
    orderToken: row.status === 'paid' && row.order_id ? accessTokens.issueOrderToken(row.order_id) : null,
    event: event ? {
      title: event.title, slug: event.slug, startsAt: event.starts_at, timezone: event.timezone,
      venueName: event.venue_name, city: event.city,
    } : null,
    organizer: organizerName ? { name: organizerName } : null,
  };
}

async function loadWithEvent(id) {
  const { data, error } = await supabase
    .from('offline_payments')
    .select(`*, events ( id, title, slug, starts_at, timezone, venue_name, city, organizer_id ),
             organizers ( display_name, profiles!organizers_owner_user_id_fkey ( email ) )`)
    .eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * The buyer chose to pay the organizer. Prices WITHOUT a card fee, fixes the
 * deadline, and hands the rest to offline_reserve.
 */
async function reserve({ reservationId, methodId, buyer }) {
  const s = await assertEnabled();
  const q = await pricing.quoteReservation(reservationId, { offline: true });
  const { data: event } = await supabase
    .from('events').select('id, starts_at, offline_payment_hours').eq('id', q.event.id).maybeSingle();
  const due = dueAt({ startsAt: event.starts_at, eventHours: event.offline_payment_hours, setting: s });
  if (!due) throw fail('VALIDATION_ERROR', 'This event starts too soon to pay the organizer offline.');

  const { data, error } = await supabase.rpc('offline_reserve', {
    p_reservation_id: reservationId,
    p_method_id: methodId,
    p_breakdown: q.breakdown,
    p_buyer: { user_id: buyer.userId, name: buyer.name, email: buyer.email, phone: buyer.phone || null },
    p_due_at: due.toISOString(),
  });
  if (error) throw new Error(error.message);
  if (!data?.ok) throw fail(data?.error || 'CONFLICT', data?.message || 'That could not be reserved.');

  const row = await loadWithEvent(data.offline_payment_id);
  const token = accessTokens.issueOfflineToken(row.id);
  if (!data.duplicate) notifyReserved(row, token);
  return { payment: publicShape(row, row.events, row.organizers?.display_name), token, duplicate: !!data.duplicate };
}

function buyerUrl(row, token) {
  const site = require('./emailTemplates').siteUrl();
  return site ? `${site}/checkout/offline/${row.id}?token=${encodeURIComponent(token)}` : null;
}

function notifyReserved(row, token) {
  const event = row.events;
  const organizerName = row.organizers?.display_name;
  const site = require('./emailTemplates').siteUrl();
  emailService.sendOfflineReserved({
    to: row.buyer?.email, buyerName: row.buyer?.name, event, organizerName, payment: row, url: buyerUrl(row, token),
  }).catch((e) => logger.error({ err: e.message, offlinePaymentId: row.id }, 'offline instructions email failed'));
  emailService.sendOfflineReservedToOrganizer({
    to: row.organizers?.profiles?.email, organizerName, event, payment: row, buyerName: row.buyer?.name,
    url: site ? `${site}/organizer/events/${event.id}/offline` : null,
  }).catch((e) => logger.error({ err: e.message, offlinePaymentId: row.id }, 'offline organizer email failed'));
}

/** The buyer's page. The token is the only key; a wrong one is "not found". */
async function viewForBuyer(id, token) {
  if (accessTokens.readOfflineToken(token) !== id) throw fail('NOT_FOUND', 'That reservation was not found.');
  const row = await loadWithEvent(id);
  if (!row) throw fail('NOT_FOUND', 'That reservation was not found.');
  return publicShape(row, row.events, row.organizers?.display_name);
}

async function cancelByBuyer(id, token) {
  if (accessTokens.readOfflineToken(token) !== id) throw fail('NOT_FOUND', 'That reservation was not found.');
  return rpc('offline_cancel', { p_offline_id: id, p_actor: null, p_role: 'buyer', p_organizer_id: null, p_reason: 'cancelled by the buyer' });
}

async function rpc(fn, args) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  if (!data?.ok) throw fail(data?.error || 'CONFLICT', data?.message || 'That could not be done.', data);
  return data;
}

// ─── Organizer ──────────────────────────────────────────────────────────────
async function listForEvent(eventId, { status } = {}) {
  let query = supabase
    .from('offline_payments')
    .select('id, status, reference_code, amount_cents, currency, due_at, created_at, buyer, method, confirmed_at, payment_reference, order_id, closed_at, close_reason')
    .eq('event_id', eventId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || []).map((r) => ({
    id: r.id,
    status: r.status,
    reference: r.reference_code,
    amountCents: Number(r.amount_cents),
    currency: r.currency,
    dueAt: r.due_at,
    createdAt: r.created_at,
    buyer: { name: r.buyer?.name || null, email: r.buyer?.email || null, phone: r.buyer?.phone || null },
    method: r.method?.label || null,
    confirmedAt: r.confirmed_at,
    paymentReference: r.payment_reference,
    orderId: r.order_id,
    closedAt: r.closed_at,
    closeReason: r.close_reason,
  }));
}

/** Mark as paid. On a first confirmation the buyer gets their tickets by email. */
async function confirm({ offlineId, organizerId, actorId, amountCents, reference, confirmKey }) {
  const result = await rpc('offline_confirm', {
    p_offline_id: offlineId, p_organizer_id: organizerId, p_actor: actorId,
    p_amount_cents: amountCents, p_reference: reference || null, p_confirm_key: confirmKey || null,
  });
  if (!result.duplicate && result.order_id) {
    require('../controllers/ticketController').sendTicketEmail(result.order_id).catch((e) =>
      logger.error({ err: e.message, orderId: result.order_id }, 'offline ticket email failed'));
    // The host the buyer named at checkout (2026-11-23); never throws.
    require('./guestOfService').notifyHost(result.order_id);
    // …and the organizer's sale email, if they want one per order.
    require('./saleNoticeService').notifyOrganizer(result.order_id);
  }
  return result;
}

async function cancelByOrganizer({ offlineId, organizerId, actorId, reason }) {
  const result = await rpc('offline_cancel', {
    p_offline_id: offlineId, p_actor: actorId, p_role: 'organizer', p_organizer_id: organizerId, p_reason: reason || null,
  });
  if (!result.duplicate) {
    const row = await loadWithEvent(offlineId);
    emailService.sendOfflineCancelled({ to: row?.buyer?.email, buyerName: row?.buyer?.name, event: row?.events, payment: row, reason })
      .catch((e) => logger.error({ err: e.message, offlinePaymentId: offlineId }, 'offline cancel email failed'));
  }
  return result;
}

/** Void (recorded in error) or refund (money returned) a door or offline order. */
async function voidOrder({ orderId, organizerId, actorId, role = 'organizer', kind, reason }) {
  return rpc('order_void_offline', {
    p_order_id: orderId, p_organizer_id: organizerId, p_actor: actorId, p_role: role, p_kind: kind, p_reason: reason,
  });
}

async function auditForEvent(eventId) {
  const { data, error } = await supabase
    .from('payment_audit')
    .select('id, created_at, action, order_id, offline_payment_id, amount_cents, currency, actor_id, actor_role, reason, payload')
    .eq('event_id', eventId).order('created_at', { ascending: false }).limit(500);
  if (error) throw new Error(error.message);
  return (data || []).map((r) => ({
    id: r.id, at: r.created_at, action: r.action, orderId: r.order_id, offlinePaymentId: r.offline_payment_id,
    amountCents: r.amount_cents === null ? null : Number(r.amount_cents), currency: r.currency,
    actorId: r.actor_id, actorRole: r.actor_role, reason: r.reason, details: r.payload,
  }));
}

/** Is a card checkout allowed on this hold? Not while an offline payment awaits. */
async function pendingFor(reservationId) {
  const { data, error } = await supabase.rpc('offline_payment_pending', { p_reservation_id: reservationId });
  if (error) {
    // Before phase 2's migration the function does not exist: nothing can be pending.
    if (/offline_payment_pending/.test(error.message)) return false;
    throw new Error(error.message);
  }
  return data === true;
}

module.exports = {
  DEFAULTS, settings, dueAt, methodsFor, optionsForReservation, reserve, viewForBuyer, cancelByBuyer,
  listForEvent, confirm, cancelByOrganizer, voidOrder, auditForEvent, pendingFor,
};
