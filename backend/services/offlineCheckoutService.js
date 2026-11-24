const crypto = require('node:crypto');
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
    .select('id, kind, label, require_proof')
    .eq('organizer_id', organizerId).eq('is_active', true)
    .order('created_at');
  if (error) throw new Error(error.message);
  // `requireProof`: the buyer is told before choosing that a receipt is needed.
  return (data || []).map(({ require_proof: rp, ...m }) => ({ ...m, requireProof: rp === true }));
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
    // The buyer's receipt, if they sent one (2026-11-24): when, and its type.
    proof: row.proof_uploaded_at ? { uploadedAt: row.proof_uploaded_at, contentType: row.proof_content_type } : null,
    // When the buyer pressed "I've sent the payment" (2026-11-24), if they did.
    sentAt: row.buyer_sent_at || null,
    // The organizer requires a receipt for this method (frozen at reserving).
    proofRequired: row.proof_required === true,
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

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * PROOF OF PAYMENT (owner, 2026-11-24): the buyer uploads a photo or PDF of
 * their transfer receipt; the organizer sees it beside the reservation before
 * marking it paid. Two steps, like every upload here: the server signs an
 * upload into the PRIVATE `payment-proofs` bucket (migration 20261216090000),
 * the browser PUTs the file, then `attachProof` checks it landed under this
 * reservation and records it (offline_attach_proof — only while awaited, and
 * written to payment_audit as `offline.proof_uploaded`). A receipt never has a
 * public address: only signed links that expire in minutes.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const PROOF_BUCKET = 'payment-proofs';
const PROOF_TYPES = Object.freeze({
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'application/pdf': 'pdf',
});
const TYPE_OF_EXT = Object.freeze(Object.fromEntries(Object.entries(PROOF_TYPES).map(([t, e]) => [e, t])));
const PROOF_LINK_SECONDS = 15 * 60;

function storageFail(error) {
  // No bucket yet, or no storage service reachable: a configuration gap, said as one.
  if (/bucket|not found|does not exist|name resolution|fetch failed|ECONNREFUSED/i.test(String(error?.message || ''))) {
    return fail('STORAGE_NOT_CONFIGURED', 'Receipt uploads are not available on this deployment yet.');
  }
  return new Error(`receipt storage: ${error?.message}`);
}

async function awaitedRow(id, token) {
  if (accessTokens.readOfflineToken(token) !== id) throw fail('NOT_FOUND', 'That reservation was not found.');
  const { data, error } = await supabase.from('offline_payments').select('id, status').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw fail('NOT_FOUND', 'That reservation was not found.');
  if (data.status !== 'awaiting') throw fail('CONFLICT', 'This reservation is no longer waiting for payment.');
  return data;
}

/** Step 1: a signed upload for the receipt. */
async function signProofUpload(id, token, contentType) {
  const type = String(contentType || '').toLowerCase();
  const ext = PROOF_TYPES[type];
  if (!ext) throw fail('UNSUPPORTED_MEDIA_TYPE', 'Upload a photo (JPEG, PNG, WebP or HEIC) or a PDF of the receipt.');
  await awaitedRow(id, token);
  const path = `offline/${id}/proof-${crypto.randomBytes(8).toString('hex')}.${ext}`;
  const { data, error } = await supabase.storage.from(PROOF_BUCKET).createSignedUploadUrl(path);
  if (error) throw storageFail(error);
  return { uploadUrl: data.signedUrl, path, method: 'PUT', contentType: type, maxBytes: 10 * 1024 * 1024 };
}

/** Step 2: the upload landed under this reservation — record it. */
async function attachProof(id, token, path) {
  await awaitedRow(id, token);
  const dir = `offline/${id}`;
  if (typeof path !== 'string' || !path.startsWith(`${dir}/`) || path.includes('..') || path.slice(dir.length + 1).includes('/')) {
    throw fail('VALIDATION_ERROR', 'That file does not belong to this reservation.');
  }
  const name = path.slice(dir.length + 1);
  const contentType = TYPE_OF_EXT[name.split('.').pop()];
  if (!contentType) throw fail('VALIDATION_ERROR', 'That file does not belong to this reservation.');
  const { data: found, error } = await supabase.storage.from(PROOF_BUCKET).list(dir, { search: name, limit: 1 });
  if (error) throw storageFail(error);
  if (!(found || []).some((o) => o.name === name)) throw fail('NOT_FOUND', 'The receipt did not upload. Try again.');

  const result = await rpc('offline_attach_proof', { p_offline_id: id, p_path: path, p_content_type: contentType });
  // The receipt it replaced is not kept: one receipt per reservation.
  if (result.previous_path && result.previous_path !== path) {
    supabase.storage.from(PROOF_BUCKET).remove([result.previous_path]).catch(() => {});
  }
  return viewForBuyer(id, token);
}

/** Signed, short-lived links to receipts, by storage path. Never throws. */
async function proofLinks(paths) {
  const list = [...new Set(paths.filter(Boolean))];
  if (list.length === 0) return new Map();
  try {
    const { data, error } = await supabase.storage.from(PROOF_BUCKET).createSignedUrls(list, PROOF_LINK_SECONDS);
    if (error) throw error;
    return new Map((data || []).filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]));
  } catch (err) {
    logger.warn({ err: err.message }, 'receipt links could not be signed');
    return new Map();
  }
}

/** Who each actor id is — names on the payment history, not "organizer". */
async function peopleById(ids) {
  const list = [...new Set(ids.filter(Boolean))];
  if (list.length === 0) return new Map();
  const { data, error } = await supabase.from('profiles').select('id, full_name, email').in('id', list);
  if (error) { logger.warn({ err: error.message }, 'payment history names could not be read'); return new Map(); }
  return new Map((data || []).map((p) => [p.id, { name: p.full_name || null, email: p.email || null }]));
}

/**
 * "I've sent the payment" (owner, 2026-11-24: "at the end put a confirm …
 * that ends the payment and booking process"). The buyer's last step: it
 * records that the money is on its way (offline_mark_sent, migration
 * 20261218090000) and, the first time only, emails the organizer to check.
 * It issues nothing — tickets come when the organizer marks it received.
 */
async function markSent(id, token) {
  await awaitedRow(id, token);
  const result = await rpc('offline_mark_sent', { p_offline_id: id });
  const row = await loadWithEvent(id);
  if (result.first && row) {
    const site = require('./emailTemplates').siteUrl();
    emailService.sendOfflineBuyerSent({
      to: row.organizers?.profiles?.email, organizerName: row.organizers?.display_name, event: row.events,
      payment: row, buyerName: row.buyer?.name, withReceipt: Boolean(row.proof_uploaded_at),
      url: site && row.events?.id ? `${site}/organizer/events/${row.events.id}/offline` : null,
    }).catch((e) => logger.error({ err: e.message, offlinePaymentId: id }, 'offline buyer-sent email failed'));
  }
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
    .select('id, status, reference_code, amount_cents, currency, due_at, created_at, buyer, method, confirmed_at, confirmed_by, payment_reference, order_id, closed_at, close_reason, proof_path, proof_content_type, proof_uploaded_at, buyer_sent_at, proof_required')
    .eq('event_id', eventId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = data || [];
  const [links, people] = await Promise.all([
    proofLinks(rows.map((r) => r.proof_path)),
    peopleById(rows.map((r) => r.confirmed_by)),
  ]);
  return rows.map((r) => ({
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
    // The buyer says the money is on its way (2026-11-24).
    buyerSentAt: r.buyer_sent_at || null,
    proofRequired: r.proof_required === true,
    // WHO marked it paid (2026-11-24), beside when.
    confirmedBy: r.confirmed_by ? people.get(r.confirmed_by) || { name: null, email: null } : null,
    paymentReference: r.payment_reference,
    orderId: r.order_id,
    closedAt: r.closed_at,
    closeReason: r.close_reason,
    // The buyer's receipt: a link that expires in 15 minutes.
    proof: r.proof_uploaded_at ? {
      uploadedAt: r.proof_uploaded_at, contentType: r.proof_content_type, url: links.get(r.proof_path) || null,
    } : null,
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
  const people = await peopleById((data || []).map((r) => r.actor_id));
  return (data || []).map((r) => ({
    id: r.id, at: r.created_at, action: r.action, orderId: r.order_id, offlinePaymentId: r.offline_payment_id,
    amountCents: r.amount_cents === null ? null : Number(r.amount_cents), currency: r.currency,
    actorId: r.actor_id, actorRole: r.actor_role, reason: r.reason, details: r.payload,
    // The person, by name and email (2026-11-24): "who confirmed it".
    actor: r.actor_id ? people.get(r.actor_id) || null : null,
  }));
}

/**
 * The offline payment waiting on this hold, with a fresh link to its page —
 * for the buyer who comes back to the checkout after choosing to pay the
 * organizer (2026-11-24: their card payment was refused with a bare 409).
 * Only ever handed to the holder of the reservation's own token.
 */
async function awaitingFor(reservationId) {
  const { data, error } = await supabase
    .from('offline_payments').select('id, reference_code, amount_cents, currency, due_at')
    .eq('reservation_id', reservationId).eq('status', 'awaiting').maybeSingle();
  if (error) {
    if (/offline_payments/.test(error.message) && /does not exist/.test(error.message)) return null;
    throw new Error(error.message);
  }
  if (!data) return null;
  const token = accessTokens.issueOfflineToken(data.id);
  return {
    id: data.id, reference: data.reference_code, amountCents: Number(data.amount_cents), currency: data.currency,
    dueAt: data.due_at, url: `/checkout/offline/${data.id}?token=${encodeURIComponent(token)}`,
  };
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
  listForEvent, confirm, cancelByOrganizer, voidOrder, auditForEvent, pendingFor, awaitingFor, signProofUpload, attachProof, markSent,
};
