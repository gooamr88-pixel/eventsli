const jwt = require('jsonwebtoken');
const { supabase } = require('../config/supabase');
const logger = require('../utils/logger');
const T = require('./emailTemplates');
const { slugify } = require('../utils/slug');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHOSE GUEST IS THIS? (2026-11-23, the owner: "know where each ticket buyer
 * comes from and from whom — the guest says 'I come from the groom', and the
 * groom receives an email, or the bride and the bride receives an email").
 * Migration 20261210090000.
 *
 *   HOSTS     the people a guest can come from, per event: the groom and the
 *             bride, two families, departments, promoters. Name, optional
 *             email, a short code for their own link.
 *   THE ASK   events.guest_of_mode — off, optional or required — and the
 *             organizer's own wording of the question.
 *   THE ANSWER saved on the hold at checkout (before any payment) and copied
 *             onto the order by a database trigger as the order is made.
 *   THE EMAIL to the host, once per order, when the booking is confirmed —
 *             with their running total and a private link to their guest list.
 *   THE LIST  a signed link per host (no account needed), revocable by the
 *             organizer: names and ticket counts, never contact details.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const MODES = Object.freeze(['off', 'optional', 'required']);
const DEFAULT_QUESTION = 'Whose guest are you?';
const MAX_HOSTS = 50;
const TOKEN_TYPE = 'host_guests';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Orders that count as a guest coming: paid, or reserved and awaiting the
// organizer's payment. A failed or cancelled order is not a guest.
const COUNTED = ['paid', 'pending'];

const HOST_COLUMNS = 'id, event_id, name, email, notify, code, is_active, sort_order, link_version, created_at';

function fail(code, message, status = 400) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/* ── the private guest-list link ─────────────────────────────────────────── */

/** A host's guest-list token. `link_version` lets the organizer revoke it. */
function hostToken(host) {
  return jwt.sign({ typ: TOKEN_TYPE, h: host.id, v: host.link_version || 1 }, process.env.JWT_SECRET, { algorithm: 'HS256' });
}

function hostListUrl(host) {
  return `${T.siteUrl()}/guests/${encodeURIComponent(hostToken(host))}`;
}

/** The claims of a guest-list token, or null — never says why. */
function readToken(raw) {
  try {
    const claims = jwt.verify(String(raw || ''), process.env.JWT_SECRET, { algorithms: ['HS256'] });
    if (claims.typ !== TOKEN_TYPE || !UUID.test(String(claims.h || ''))) return null;
    return claims;
  } catch {
    return null;
  }
}

/* ── shapes ──────────────────────────────────────────────────────────────── */

function shapeHost(h, stats = null, slug = null) {
  return {
    id: h.id,
    name: h.name,
    email: h.email || null,
    notify: h.notify !== false,
    code: h.code,
    active: h.is_active !== false,
    // The host's own share link: it picks them at checkout.
    link: slug ? `${T.siteUrl()}/e/${slug}?guestof=${encodeURIComponent(h.code)}` : null,
    // Their private guest list, for the organizer to copy or resend.
    listUrl: hostListUrl(h),
    ...(stats ? { stats } : {}),
  };
}

function emptyStats() { return { orders: 0, tickets: 0, revenueCents: 0 }; }

/* ── reads ───────────────────────────────────────────────────────────────── */

async function eventRow(eventId) {
  const { data, error } = await supabase.from('events')
    .select('id, slug, title, starts_at, timezone, venue_name, city, currency, guest_of_mode, guest_of_question, organizer_id')
    .eq('id', eventId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw fail('NOT_FOUND', 'That event was not found.', 404);
  return data;
}

async function hostsOf(eventId) {
  const { data, error } = await supabase.from('event_hosts').select(HOST_COLUMNS)
    .eq('event_id', eventId).order('sort_order').order('created_at');
  if (error) throw new Error(error.message);
  return data || [];
}

/** Orders that count, per host (and those with no host), for one event. */
async function statsFor(eventId) {
  const { data, error } = await supabase.from('orders')
    .select('guest_of_host_id, quantity, buyer_total_cents, status')
    .eq('event_id', eventId).in('status', COUNTED);
  if (error) throw new Error(error.message);
  const by = new Map();
  const none = emptyStats();
  for (const o of data || []) {
    const s = o.guest_of_host_id ? (by.get(o.guest_of_host_id) || by.set(o.guest_of_host_id, emptyStats()).get(o.guest_of_host_id)) : none;
    s.orders += 1;
    s.tickets += Number(o.quantity) || 0;
    s.revenueCents += Number(o.buyer_total_cents) || 0;
  }
  return { by, none, total: (data || []).length };
}

/** The organizer's page: the setting, every host with their numbers, and the rest. */
async function overview(eventId) {
  const [event, hosts, stats] = await Promise.all([eventRow(eventId), hostsOf(eventId), statsFor(eventId)]);
  return {
    settings: {
      mode: MODES.includes(event.guest_of_mode) ? event.guest_of_mode : 'off',
      question: event.guest_of_question || DEFAULT_QUESTION,
      defaultQuestion: DEFAULT_QUESTION,
    },
    currency: event.currency,
    hosts: hosts.map((h) => shapeHost(h, stats.by.get(h.id) || emptyStats(), event.slug)),
    // Bookings with no host named: the question was off, optional and skipped,
    // or the host they chose was removed.
    unassigned: stats.none,
  };
}

/** One host's guests, as the organizer sees them (with contact details). */
async function guestsOf(eventId, hostId) {
  const host = await ownHost(eventId, hostId);
  const rows = await guestRows(eventId, host.id);
  return {
    host: shapeHost(host),
    guests: rows.map((o) => ({
      orderId: o.id,
      name: buyerName(o),
      email: o.guest_email || o.profiles?.email || null,
      phone: o.guest_phone || null,
      tickets: Number(o.quantity) || 0,
      totalCents: Number(o.buyer_total_cents) || 0,
      status: o.status,
      bookedAt: o.paid_at || o.created_at,
    })),
  };
}

async function guestRows(eventId, hostId) {
  const { data, error } = await supabase.from('orders')
    .select('id, guest_name, guest_email, guest_phone, quantity, buyer_total_cents, status, created_at, paid_at, profiles!orders_user_id_fkey ( full_name, email )')
    .eq('event_id', eventId).eq('guest_of_host_id', hostId).in('status', COUNTED)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

function buyerName(o) {
  return text(o.guest_name, 120) || text(o.profiles?.full_name, 120) || 'Guest';
}

async function ownHost(eventId, hostId) {
  if (!UUID.test(String(hostId || ''))) throw fail('NOT_FOUND', 'That host was not found.', 404);
  const { data, error } = await supabase.from('event_hosts').select(HOST_COLUMNS)
    .eq('id', hostId).eq('event_id', eventId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw fail('NOT_FOUND', 'That host was not found.', 404);
  return data;
}

/* ── the organizer's writes ──────────────────────────────────────────────── */

function cleanHostInput(body, { partial = false } = {}) {
  const out = {};
  if (!partial || body.name !== undefined) {
    const name = text(body.name, 80);
    if (!name) throw fail('VALIDATION_ERROR', 'Give the host a name, e.g. “The groom — Ahmed”.');
    out.name = name;
  }
  if (body.email !== undefined) {
    const email = text(body.email, 254);
    if (email && !EMAIL.test(email)) throw fail('VALIDATION_ERROR', 'That email address does not look right.');
    out.email = email || null;
  }
  if (body.notify !== undefined) out.notify = body.notify === true;
  if (body.active !== undefined) out.is_active = body.active === true;
  if (body.sortOrder !== undefined && Number.isInteger(body.sortOrder)) out.sort_order = Math.max(0, Math.min(1000, body.sortOrder));
  return out;
}

/** A short code for the host's link, unique in this event: "the-groom", "the-groom-2". */
async function freeCode(eventId, name) {
  const base = (slugify(name) || 'host').slice(0, 28).replace(/-+$/, '') || 'host';
  const { data, error } = await supabase.from('event_hosts').select('code').eq('event_id', eventId);
  if (error) throw new Error(error.message);
  const taken = new Set((data || []).map((r) => r.code));
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  return `${base}-${Date.now().toString(36)}`.slice(0, 32);
}

async function createHost(eventId, body) {
  const fields = cleanHostInput(body);
  const existing = await hostsOf(eventId);
  if (existing.length >= MAX_HOSTS) throw fail('VALIDATION_ERROR', `An event can have up to ${MAX_HOSTS} hosts.`);
  const { data, error } = await supabase.from('event_hosts').insert({
    event_id: eventId, ...fields, code: await freeCode(eventId, fields.name),
    sort_order: existing.length ? Math.max(...existing.map((h) => h.sort_order)) + 1 : 0,
  }).select(HOST_COLUMNS).single();
  if (error) throw new Error(error.message);
  const event = await eventRow(eventId);
  return shapeHost(data, emptyStats(), event.slug);
}

async function updateHost(eventId, hostId, body) {
  await ownHost(eventId, hostId);
  const fields = cleanHostInput(body, { partial: true });
  const { data, error } = await supabase.from('event_hosts')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', hostId).eq('event_id', eventId).select(HOST_COLUMNS).single();
  if (error) throw new Error(error.message);
  const event = await eventRow(eventId);
  return shapeHost(data, null, event.slug);
}

/** Deleted when nobody booked under them; otherwise taken off the list, keeping their guests. */
async function removeHost(eventId, hostId) {
  await ownHost(eventId, hostId);
  const { count, error } = await supabase.from('orders').select('id', { count: 'exact', head: true }).eq('guest_of_host_id', hostId);
  if (error) throw new Error(error.message);
  if (count > 0) {
    const { error: offError } = await supabase.from('event_hosts').update({ is_active: false, updated_at: new Date().toISOString() }).eq('id', hostId);
    if (offError) throw new Error(offError.message);
    return { removed: false, deactivated: true };
  }
  const { error: delError } = await supabase.from('event_hosts').delete().eq('id', hostId).eq('event_id', eventId);
  if (delError) throw new Error(delError.message);
  return { removed: true, deactivated: false };
}

/** A new guest-list link for a host; every copy of the old one stops working. */
async function resetLink(eventId, hostId) {
  const host = await ownHost(eventId, hostId);
  const { data, error } = await supabase.from('event_hosts')
    .update({ link_version: (host.link_version || 1) + 1, updated_at: new Date().toISOString() })
    .eq('id', hostId).select(HOST_COLUMNS).single();
  if (error) throw new Error(error.message);
  return { listUrl: hostListUrl(data) };
}

async function saveSettings(eventId, body) {
  const patch = {};
  if (body.mode !== undefined) {
    if (!MODES.includes(body.mode)) throw fail('VALIDATION_ERROR', 'Choose off, optional or required.');
    patch.guest_of_mode = body.mode;
  }
  if (body.question !== undefined) {
    const q = text(body.question, 120);
    patch.guest_of_question = q && q !== DEFAULT_QUESTION ? q : null;
  }
  if (Object.keys(patch).length) {
    const { error } = await supabase.from('events').update(patch).eq('id', eventId);
    if (error) throw new Error(error.message);
  }
  return overview(eventId);
}

/* ── checkout ────────────────────────────────────────────────────────────── */

/** What the checkout asks, or null when it asks nothing. Names and codes only. */
async function forCheckout(eventId) {
  const event = await eventRow(eventId);
  const mode = MODES.includes(event.guest_of_mode) ? event.guest_of_mode : 'off';
  if (mode === 'off') return null;
  const hosts = (await hostsOf(eventId)).filter((h) => h.is_active !== false);
  if (!hosts.length) return null;
  return {
    mode,
    question: event.guest_of_question || DEFAULT_QUESTION,
    hosts: hosts.map((h) => ({ id: h.id, name: h.name, code: h.code })),
  };
}

/**
 * The buyer's answer, checked and saved on the hold before any payment.
 * Returns `{ code, message }` for a refusal, `{}` when saved (or not asked).
 */
async function saveChoice(q, hostId) {
  const eventId = q.event?.id;
  const reservationId = q.reservation?.id;
  if (!eventId || !reservationId) return {};
  const ask = await forCheckout(eventId);
  if (!ask) return {};
  const chosen = hostId ? ask.hosts.find((h) => h.id === hostId) : null;
  if (hostId && !chosen) return { code: 'VALIDATION_ERROR', message: 'Choose who invited you from the list.' };
  if (!chosen && ask.mode === 'required') {
    return { code: 'VALIDATION_ERROR', message: `Answer “${ask.question}” to continue.`, meta: { field: 'guestOf' } };
  }
  const { error } = await supabase.from('reservations').update({ guest_of_host_id: chosen ? chosen.id : null }).eq('id', reservationId);
  if (error) throw new Error(error.message);
  return {};
}

/* ── the host's email ────────────────────────────────────────────────────── */

/**
 * Tells the host a guest booked — once per order, whoever calls first (the
 * order is claimed with `host_notified_at IS NULL`). Never throws: a missed
 * email must not touch a sale.
 */
async function notifyHost(orderId) {
  try {
    const { data: order, error } = await supabase.from('orders')
      .select('id, event_id, guest_of_host_id, status, quantity, guest_name, host_notified_at, profiles!orders_user_id_fkey ( full_name )')
      .eq('id', orderId).maybeSingle();
    if (error || !order || !order.guest_of_host_id || order.host_notified_at) return { sent: false };
    if (!COUNTED.includes(order.status)) return { sent: false };

    const { data: host } = await supabase.from('event_hosts').select(HOST_COLUMNS).eq('id', order.guest_of_host_id).maybeSingle();
    if (!host || !host.email || host.notify === false) return { sent: false };

    // Claim it, so two callers cannot both send.
    const { data: claimed, error: claimError } = await supabase.from('orders')
      .update({ host_notified_at: new Date().toISOString() })
      .eq('id', order.id).is('host_notified_at', null).select('id');
    if (claimError || !claimed?.length) return { sent: false };

    const [event, rows] = await Promise.all([eventRow(order.event_id), guestRows(order.event_id, host.id)]);
    const totals = { orders: rows.length, tickets: rows.reduce((n, o) => n + (Number(o.quantity) || 0), 0) };
    // Replies go to the organizer, as with the ticket emails.
    const { data: organizer } = await supabase.from('organizers')
      .select('profiles!organizers_owner_user_id_fkey ( email )').eq('id', event.organizer_id).maybeSingle();
    const email = require('./emailService');
    return await email.sendGuestBooked({
      to: host.email,
      hostName: host.name,
      event,
      guestName: buyerName(order),
      tickets: Number(order.quantity) || 0,
      pending: order.status === 'pending',
      totals,
      listUrl: hostListUrl(host),
      replyTo: organizer?.profiles?.email || null,
    });
  } catch (err) {
    logger.warn({ err: err.message, orderId }, 'guest-of: host email failed');
    return { sent: false };
  }
}

/* ── the host's own guest list (public, by token) ────────────────────────── */

async function guestListByToken(raw) {
  const claims = readToken(raw);
  const notFound = fail('NOT_FOUND', 'This guest list link is not valid any more. Ask the organizer for a new one.', 404);
  if (!claims) throw notFound;
  const { data: host, error } = await supabase.from('event_hosts').select(HOST_COLUMNS).eq('id', claims.h).maybeSingle();
  if (error) throw new Error(error.message);
  if (!host || (host.link_version || 1) !== claims.v) throw notFound;
  const [event, rows] = await Promise.all([eventRow(host.event_id), guestRows(host.event_id, host.id)]);
  return {
    host: { name: host.name },
    event: { title: event.title, slug: event.slug, startsAt: event.starts_at, timezone: event.timezone, venue: event.venue_name, city: event.city },
    // Names and ticket counts only: the host invited these people, but their
    // contact details and what they paid are between them and the organizer.
    guests: rows.map((o) => ({
      name: buyerName(o),
      tickets: Number(o.quantity) || 0,
      pending: o.status === 'pending',
      bookedAt: o.paid_at || o.created_at,
    })),
    totals: { bookings: rows.length, tickets: rows.reduce((n, o) => n + (Number(o.quantity) || 0), 0) },
  };
}

module.exports = {
  MODES, DEFAULT_QUESTION, MAX_HOSTS, TOKEN_TYPE,
  hostToken, readToken, hostListUrl,
  overview, guestsOf, createHost, updateHost, removeHost, resetLink, saveSettings,
  forCheckout, saveChoice, notifyHost, guestListByToken,
};
