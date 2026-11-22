const { supabase } = require('../config/supabase');
const logger = require('../utils/logger');
const T = require('./emailTemplates');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ORGANIZER IS TOLD WHEN TICKETS SELL (2026-11-23, the owner: "the
 * organizer must get an email when tickets are bought — professionally").
 * Migration 20261211090000.
 *
 *   EACH   one email per confirmed order, the moment it is confirmed: who
 *          bought (name, email, phone — the organizer's own customer), what
 *          (each ticket, its type and seat, the extras), what was paid and what
 *          the organizer keeps, whose guest they are, and the event's running
 *          totals. Reply-To is the buyer, so a reply reaches them directly.
 *   DAILY  one summary a day at 8 am in the zone of the organizer's latest
 *          event: every event that sold since the last summary, with its
 *          orders, tickets and money. Nothing sold, nothing sent.
 *   OFF    nothing.
 *
 * To the account owner (unless they opt out) and up to five more addresses.
 * Never twice for one order: the order is claimed (`organizer_notified_at IS
 * NULL`) before anything is sent. Never throws into a sale: every failure is
 * logged and swallowed. Door sales are not emailed — the organizer's own team
 * rang them up.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const MODES = Object.freeze(['each', 'daily', 'off']);
const MAX_RECIPIENTS = 5;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DIGEST_HOUR = 8;
const COUNTED = ['paid', 'pending'];

function fail(code, message, status = 400) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

/* ── settings ────────────────────────────────────────────────────────────── */

const ORG_COLUMNS = 'id, display_name, sale_email_mode, sale_email_owner, sale_email_recipients, sale_digest_last_at, profiles!organizers_owner_user_id_fkey ( email )';

function shapeSettings(org) {
  return {
    mode: MODES.includes(org.sale_email_mode) ? org.sale_email_mode : 'each',
    toOwner: org.sale_email_owner !== false,
    ownerEmail: org.profiles?.email || null,
    recipients: Array.isArray(org.sale_email_recipients) ? org.sale_email_recipients : [],
    maxRecipients: MAX_RECIPIENTS,
  };
}

async function orgRow(organizerId) {
  const { data, error } = await supabase.from('organizers').select(ORG_COLUMNS).eq('id', organizerId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw fail('NOT_FOUND', 'Organizer not found.', 404);
  return data;
}

async function getSettings(organizerId) {
  return shapeSettings(await orgRow(organizerId));
}

/** Cleaned recipients: valid addresses, lower-cased, once each, at most five. */
function cleanRecipients(list) {
  if (!Array.isArray(list)) throw fail('VALIDATION_ERROR', 'Send the extra addresses as a list.');
  const out = [];
  for (const raw of list) {
    const e = String(raw || '').trim().toLowerCase();
    if (!e) continue;
    if (e.length > 254 || !EMAIL.test(e)) throw fail('VALIDATION_ERROR', `“${String(raw).slice(0, 60)}” is not an email address.`);
    if (!out.includes(e)) out.push(e);
  }
  if (out.length > MAX_RECIPIENTS) throw fail('VALIDATION_ERROR', `Add at most ${MAX_RECIPIENTS} extra addresses.`);
  return out;
}

async function saveSettings(organizerId, body) {
  const patch = {};
  if (body.mode !== undefined) {
    if (!MODES.includes(body.mode)) throw fail('VALIDATION_ERROR', 'Choose every sale, a daily summary, or off.');
    patch.sale_email_mode = body.mode;
    // Switching to the daily summary starts its window now, so the first one
    // does not report every sale since the event opened.
    if (body.mode === 'daily') patch.sale_digest_last_at = new Date().toISOString();
  }
  if (body.toOwner !== undefined) patch.sale_email_owner = body.toOwner === true;
  if (body.recipients !== undefined) patch.sale_email_recipients = cleanRecipients(body.recipients);
  if (Object.keys(patch).length) {
    const { error } = await supabase.from('organizers').update(patch).eq('id', organizerId);
    if (error) throw new Error(error.message);
  }
  const saved = shapeSettings(await orgRow(organizerId));
  if (saved.mode !== 'off' && !saved.toOwner && saved.recipients.length === 0) {
    saved.warning = 'Nobody receives sale emails: tick your own address or add one.';
  }
  return saved;
}

/** Who receives this organizer's sale emails. */
function recipientsOf(org) {
  const s = shapeSettings(org);
  const list = [...(s.toOwner && s.ownerEmail ? [s.ownerEmail.toLowerCase()] : []), ...s.recipients];
  return [...new Set(list)];
}

/* ── one sale ────────────────────────────────────────────────────────────── */

const ORDER_COLUMNS = `id, event_id, organizer_id, channel, status, currency, quantity,
  subtotal_cents, discount_cents, event_tax_cents, buyer_total_cents, organizer_net_cents,
  commission_cents, commission_tax_cents, guest_name, guest_email, guest_phone,
  created_at, paid_at, organizer_notified_at, promo_code,
  profiles!orders_user_id_fkey ( full_name, email ),
  event_hosts ( name ),
  events ( id, title, slug, starts_at, timezone, venue_name, city, currency )`;

/** What the organizer keeps on an order — the figure the dashboard shows. */
function netOf(o) {
  return Number(o.organizer_net_cents)
    - (o.channel === 'manual' ? Number(o.commission_cents) + Number(o.commission_tax_cents) : 0);
}

function buyerOf(o) {
  const account = Array.isArray(o.profiles) ? o.profiles[0] : o.profiles;
  return {
    name: o.guest_name || account?.full_name || 'A buyer',
    email: o.guest_email || account?.email || null,
    phone: o.guest_phone || null,
  };
}

/** Each ticket type with its count and seats: "VIP × 2 — Table 4 · Seat 1, Seat 2". */
function linesOf(tickets) {
  const by = new Map();
  for (const t of tickets) {
    const key = t.tierName || 'Ticket';
    const line = by.get(key) || by.set(key, { name: key, count: 0, seats: [], addons: new Set() }).get(key);
    line.count += 1;
    const seat = T.seatLabel(t);
    if (seat && seat !== 'General admission') line.seats.push(seat);
    for (const a of t.addons || []) line.addons.add(a);
  }
  return [...by.values()].map((l) => ({ ...l, addons: [...l.addons] }));
}

/** The event's running totals, for the email's foot. */
async function eventProgress(eventId) {
  const [{ data: totals }, { data: tiers }] = await Promise.all([
    supabase.rpc('event_order_totals', { p_event_id: eventId, p_status: 'paid', p_channel: null }),
    supabase.from('ticket_tiers').select('quantity, sold_count').eq('event_id', eventId),
  ]);
  const byCurrency = Object.entries(totals?.totals || {});
  const capped = (tiers || []).every((t) => t.quantity !== null && t.quantity !== undefined);
  return {
    orders: byCurrency.reduce((n, [, t]) => n + Number(t.orders || 0), 0),
    tickets: byCurrency.reduce((n, [, t]) => n + Number(t.tickets || 0), 0),
    sold: (tiers || []).reduce((n, t) => n + Number(t.sold_count || 0), 0),
    capacity: capped && tiers?.length ? tiers.reduce((n, t) => n + Number(t.quantity || 0), 0) : null,
    gross: byCurrency.map(([currency, t]) => ({ currency, cents: Number(t.grossCents || 0), netCents: Number(t.netCents || 0) })),
  };
}

/**
 * Emails the organizer about one confirmed order — once, whoever calls first.
 * Never throws: a missed email must not touch a sale.
 */
async function notifyOrganizer(orderId) {
  try {
    const { data: order, error } = await supabase.from('orders').select(ORDER_COLUMNS).eq('id', orderId).maybeSingle();
    if (error || !order || order.organizer_notified_at) return { sent: false };
    if (!COUNTED.includes(order.status) || order.channel === 'manual') return { sent: false };

    const org = await orgRow(order.organizer_id);
    if (shapeSettings(org).mode !== 'each') return { sent: false };
    const to = recipientsOf(org);
    if (!to.length) return { sent: false };

    // Claim it, so two callers cannot both send.
    const { data: claimed, error: claimError } = await supabase.from('orders')
      .update({ organizer_notified_at: new Date().toISOString() })
      .eq('id', order.id).is('organizer_notified_at', null).select('id');
    if (claimError || !claimed?.length) return { sent: false };

    const tickets = await require('./ticketService').forOrder(order.id);
    const progress = await eventProgress(order.event_id);
    const promo = order.promo_code || null;
    const email = require('./emailService');
    const sale = {
      orderId: order.id,
      event: order.events,
      buyer: buyerOf(order),
      lines: linesOf(tickets),
      tickets: Number(order.quantity) || tickets.length,
      currency: order.currency,
      paidCents: Number(order.buyer_total_cents),
      discountCents: Number(order.discount_cents),
      netCents: netOf(order),
      free: Number(order.buyer_total_cents) === 0,
      channel: order.channel,
      pending: order.status === 'pending',
      guestOf: order.event_hosts?.name || null,
      promo,
      at: order.paid_at || order.created_at,
      progress,
      url: `${T.siteUrl()}/organizer/events/${order.event_id}/orders`,
    };
    const results = [];
    for (const address of to) {
      // One message per address: no recipient sees the others.
      results.push(await email.sendSaleToOrganizer({ to: address, organizerName: org.display_name, sale }));
    }
    return { sent: results.some((r) => r.sent), recipients: to.length };
  } catch (err) {
    logger.warn({ err: err.message, orderId }, 'sale notice: organizer email failed');
    return { sent: false };
  }
}

/* ── the daily summary ───────────────────────────────────────────────────── */

/** Hour and calendar date of an instant in a zone. */
function localParts(date, timeZone) {
  try {
    const f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false });
    const parts = Object.fromEntries(f.formatToParts(date).map((p) => [p.type, p.value]));
    return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24 };
  } catch {
    return localParts(date, 'UTC');
  }
}

/** Is a summary due now for this organizer, in this zone? */
function digestDue(org, timeZone, now = new Date()) {
  const here = localParts(now, timeZone);
  if (here.hour < DIGEST_HOUR) return false;
  if (!org.sale_digest_last_at) return true;
  return localParts(new Date(org.sale_digest_last_at), timeZone).day < here.day;
}

/** The summary for one organizer: every event that sold in the window. */
async function digestFor(org, since, until) {
  const { data: orders, error } = await supabase.from('orders')
    .select('id, event_id, channel, status, currency, quantity, buyer_total_cents, organizer_net_cents, commission_cents, commission_tax_cents, created_at, paid_at, events ( id, title, slug, starts_at, timezone )')
    .eq('organizer_id', org.id).in('status', COUNTED).neq('channel', 'manual')
    .gte('created_at', since).lt('created_at', until);
  if (error) throw new Error(error.message);
  const byEvent = new Map();
  for (const o of orders || []) {
    const e = byEvent.get(o.event_id) || byEvent.set(o.event_id, { event: o.events, orders: 0, tickets: 0, money: new Map() }).get(o.event_id);
    e.orders += 1;
    e.tickets += Number(o.quantity) || 0;
    const m = e.money.get(o.currency) || { paid: 0, net: 0 };
    m.paid += Number(o.buyer_total_cents) || 0;
    m.net += netOf(o);
    e.money.set(o.currency, m);
  }
  return [...byEvent.values()].map((e) => ({
    ...e,
    url: `${T.siteUrl()}/organizer/events/${e.event.id}/orders`,
    money: [...e.money.entries()].map(([currency, m]) => ({ currency, paidCents: m.paid, netCents: m.net })),
  })).sort((a, b) => b.tickets - a.tickets);
}

/**
 * The hourly job: every organizer on the daily summary whose 8 am has come
 * today gets one email covering the sales since their last summary. Each
 * organizer is claimed (`sale_digest_last_at`) before their email is built, so
 * two workers cannot both send it.
 */
async function sendDigests(now = new Date()) {
  const { data: orgs, error } = await supabase.from('organizers').select(ORG_COLUMNS).eq('sale_email_mode', 'daily');
  if (error) throw new Error(error.message);
  let sent = 0;
  for (const org of orgs || []) {
    try {
      // The zone of their latest event; UTC for an organizer with none.
      const { data: latest } = await supabase.from('events').select('timezone')
        .eq('organizer_id', org.id).order('starts_at', { ascending: false }).limit(1).maybeSingle();
      const zone = latest?.timezone || 'UTC';
      if (!digestDue(org, zone, now)) continue;
      const since = org.sale_digest_last_at || new Date(now.getTime() - 24 * 3600e3).toISOString();
      const until = now.toISOString();
      let claim = supabase.from('organizers').update({ sale_digest_last_at: until }).eq('id', org.id);
      claim = org.sale_digest_last_at ? claim.eq('sale_digest_last_at', org.sale_digest_last_at) : claim.is('sale_digest_last_at', null);
      const { data: claimed } = await claim.select('id');
      if (!claimed?.length) continue;
      const events = await digestFor(org, since, until);
      const to = recipientsOf(org);
      if (!events.length || !to.length) continue;
      const email = require('./emailService');
      for (const address of to) {
        await email.sendSalesDigest({ to: address, organizerName: org.display_name, events, since, until, timeZone: zone });
      }
      sent += 1;
    } catch (err) {
      logger.warn({ err: err.message, organizerId: org.id }, 'sale digest failed');
    }
  }
  return { sent };
}

module.exports = {
  MODES, MAX_RECIPIENTS, DIGEST_HOUR,
  getSettings, saveSettings, cleanRecipients, recipientsOf,
  notifyOrganizer, sendDigests, digestDue, linesOf, localParts,
};
