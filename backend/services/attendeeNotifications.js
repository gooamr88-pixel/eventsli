const { supabase } = require('../config/supabase');
const logger = require('../utils/logger');
const { fetchAll } = require('../utils/fetchAll');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The attendee app's notifications (2026-11-24): the inbox row, and the push
 * that carries it to the lock screen.
 *
 *   tickets_issued   an order was paid or claimed       once per order
 *   ticket_received  somebody transferred a ticket here once per ticket
 *   event_reminder   an event with your ticket is close once per event
 *   event_cancelled  an event you hold or saved is off  once per event
 *   event_moved      … has a new start time             once per new time
 *   welcome          first sign-in to the app           once per person
 *
 * THE SAME RULES AS THE SMS NOTICES (services/sms/notifications.js), for the
 * same reasons:
 *
 *   · Keyed. `user_notifications_once (user_id, dedupe_key)` makes a retried
 *     webhook, a resend button or two workers racing write ONE row, and only a
 *     row that was actually inserted is pushed — so the lock screen is never
 *     told twice either.
 *   · Best-effort. Nothing here throws into the code that issued a ticket or
 *     cancelled an event. A notification that did not go out is logged; a sale
 *     that failed because a phone was unreachable would be a real outage.
 *   · No credentials. A push is read on a lock screen and shown in a
 *     notification history; it names the event and nothing that opens a door.
 *     The QR stays in the app behind the session.
 *
 * Who an event's notice reaches: everyone holding a paid order for it — by
 * account, or by a verified account on the address they bought with as a
 * guest, which is exactly who `/tickets` shows the tickets to — plus, for a
 * cancellation or a move, everyone who saved it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
/** Expo accepts at most 100 messages per request. */
const PUSH_BATCH = 100;
const PUSH_TIMEOUT_MS = 10_000;
/** An `in.()` filter is a URL; bounded so a sold-out arena stays a handful of requests. */
const LOOKUP_BATCH = 200;

const enabled = () => !/^(0|false|no|off)$/i.test(String(process.env.ATTENDEE_NOTIFICATIONS_ENABLED ?? 'true'));
const pushEnabled = () => !/^(0|false|no|off)$/i.test(String(process.env.ATTENDEE_PUSH_ENABLED ?? 'true'));

const clip = (s, n) => (String(s || '').length > n ? `${String(s).slice(0, n - 1).trimEnd()}…` : String(s || ''));

/** "Sat, Nov 20, 8:00 PM" in the EVENT's zone — the time on the ticket and at the door. */
function when(iso, timeZone) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || 'UTC', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toUTCString().slice(0, 22);
  }
}

/**
 * The words, in one place, so the inbox and the push never disagree. Titles
 * stay short enough for a lock screen; bodies name the event, never a code.
 */
function messageFor(kind, ctx = {}) {
  const title = clip(ctx.event?.title, 60);
  const at = ctx.event?.starts_at ? when(ctx.event.starts_at, ctx.event.timezone) : '';
  switch (kind) {
    case 'tickets_issued': {
      const n = Math.max(1, Number(ctx.count) || 1);
      return {
        title: 'Your tickets are ready',
        body: `${n} ticket${n === 1 ? '' : 's'} for ${title}${at ? `, ${at}` : ''}. Open My Tickets to see your code.`,
      };
    }
    case 'ticket_received':
      return {
        title: 'You received a ticket',
        body: `${ctx.from ? clip(ctx.from, 60) : 'Someone'} sent you a ticket for ${title}${at ? `, ${at}` : ''}.`,
      };
    case 'event_reminder':
      return {
        title: `${clip(ctx.event?.title, 40)} is coming up`,
        body: `It starts ${at}${ctx.event?.venue_name ? ` at ${clip(ctx.event.venue_name, 40)}` : ''}. Your ticket is in the app.`,
      };
    case 'event_cancelled':
      return {
        title: 'Event cancelled',
        body: `${title}${at ? ` on ${at}` : ''} has been cancelled. Check your email for details.`,
      };
    case 'event_moved':
      return {
        title: 'Event rescheduled',
        body: `${title} has moved to ${at}. Tickets you hold stay valid.`,
      };
    case 'welcome':
      return {
        title: 'Welcome to Eventsli',
        body: 'Discover. Experience. Be there. Save events with the heart to hear when they change.',
      };
    default:
      throw new Error(`unknown notification kind: ${kind}`);
  }
}

/**
 * Write the rows; push the ones that were new. Never throws.
 *
 * @param {Array<{userId:string, kind:string, eventId?:string|null, orderId?:string|null, dedupeKey:string, title:string, body:string}>} items
 * @returns {Promise<number>} how many were new
 */
async function record(items) {
  if (!enabled() || !items?.length) return 0;
  let created = [];
  try {
    for (let i = 0; i < items.length; i += 500) {
      const rows = items.slice(i, i + 500).map((n) => ({
        user_id: n.userId,
        kind: n.kind,
        title: clip(n.title, 120),
        body: clip(n.body, 400),
        event_id: n.eventId || null,
        order_id: n.orderId || null,
        dedupe_key: n.dedupeKey,
      }));
      // eslint-disable-next-line no-await-in-loop
      const { data, error } = await supabase.from('user_notifications')
        .upsert(rows, { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true })
        .select('id, user_id, kind, title, body, event_id, order_id');
      if (error) throw new Error(error.message);
      created = created.concat(data || []);
    }
  } catch (err) {
    logger.error({ err: err.message, count: items.length }, 'app notifications not recorded');
    return created.length;
  }
  await push(created).catch((err) => logger.error({ err: err.message }, 'app push failed'));
  return created.length;
}

// ─── Push ──────────────────────────────────────────────────────────────────

async function liveTokens(userIds) {
  const out = [];
  const ids = [...new Set(userIds)];
  for (let i = 0; i < ids.length; i += LOOKUP_BATCH) {
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await supabase.from('push_devices')
      .select('token, user_id').in('user_id', ids.slice(i, i + LOOKUP_BATCH)).is('disabled_at', null);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
  }
  return out;
}

/** One Expo message per (row, device). `data` is what a tap opens — ids only. */
function buildMessages(rows, devices) {
  const byUser = new Map();
  for (const d of devices) byUser.set(d.user_id, [...(byUser.get(d.user_id) || []), d.token]);
  const messages = [];
  for (const row of rows) {
    for (const to of byUser.get(row.user_id) || []) {
      messages.push({
        to,
        title: row.title,
        body: row.body,
        sound: 'default',
        data: { notificationId: row.id, kind: row.kind, eventId: row.event_id || null, orderId: row.order_id || null },
      });
    }
  }
  return messages;
}

/**
 * The tokens Expo says are gone — the app was uninstalled or the token
 * rotated. Expo answers per message, in the order sent.
 */
function deadTokens(messages, tickets) {
  const dead = new Set();
  (tickets || []).forEach((t, i) => {
    if (t?.status === 'error' && t?.details?.error === 'DeviceNotRegistered' && messages[i]) dead.add(messages[i].to);
  });
  return [...dead];
}

async function sendBatch(messages) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PUSH_TIMEOUT_MS);
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        // Optional: required only once "enhanced push security" is on in Expo.
        ...(process.env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}),
      },
      body: JSON.stringify(messages),
      signal: controller.signal,
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`Expo push answered ${res.status}`);
    return json?.data || [];
  } finally {
    clearTimeout(timer);
  }
}

async function push(rows) {
  if (!pushEnabled() || !rows?.length) return 0;
  const devices = await liveTokens(rows.map((r) => r.user_id));
  const messages = buildMessages(rows, devices);
  let sent = 0;
  for (let i = 0; i < messages.length; i += PUSH_BATCH) {
    const batch = messages.slice(i, i + PUSH_BATCH);
    try {
      // eslint-disable-next-line no-await-in-loop
      const tickets = await sendBatch(batch);
      sent += batch.length;
      const dead = deadTokens(batch, tickets);
      if (dead.length) {
        // eslint-disable-next-line no-await-in-loop
        await supabase.from('push_devices').update({ disabled_at: new Date().toISOString() }).in('token', dead);
      }
    } catch (err) {
      // One failed batch is not a reason to skip the rest.
      logger.warn({ err: err.message, size: batch.length }, 'app push batch failed');
    }
  }
  return sent;
}

// ─── Who hears about an event ──────────────────────────────────────────────

/** Verified accounts behind a list of guest addresses. */
async function accountsByEmail(emails) {
  const list = [...new Set((emails || []).filter(Boolean).map((e) => String(e).toLowerCase()))];
  const ids = [];
  for (let i = 0; i < list.length; i += LOOKUP_BATCH) {
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await supabase.from('profiles')
      .select('id').in('email', list.slice(i, i + LOOKUP_BATCH)).not('email_verified_at', 'is', null);
    if (error) throw new Error(error.message);
    ids.push(...(data || []).map((p) => p.id));
  }
  return ids;
}

async function ticketHolders(eventId) {
  const orders = await fetchAll((r, first) => supabase.from('orders')
    .select('id, user_id, guest_email', first ? { count: 'exact' } : undefined)
    .eq('event_id', eventId).eq('status', 'paid').order('id').range(r.from, r.to), { what: 'orders' });
  const ids = new Set(orders.map((o) => o.user_id).filter(Boolean));
  const guests = orders.filter((o) => !o.user_id).map((o) => o.guest_email);
  for (const id of await accountsByEmail(guests)) ids.add(id);
  return ids;
}

async function savers(eventId) {
  const rows = await fetchAll((r, first) => supabase.from('saved_events')
    .select('user_id', first ? { count: 'exact' } : undefined)
    .eq('event_id', eventId).order('user_id').range(r.from, r.to), { what: 'saved_events' });
  return new Set(rows.map((r) => r.user_id));
}

async function loadEvent(eventId) {
  const { data, error } = await supabase.from('events')
    .select('id, title, starts_at, timezone, venue_name, status').eq('id', eventId).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

function toEveryone(userIds, kind, event, dedupeKey) {
  const msg = messageFor(kind, { event });
  return [...userIds].map((userId) => ({ userId, kind, eventId: event.id, dedupeKey, ...msg }));
}

// ─── The hooks ─────────────────────────────────────────────────────────────

/** Called beside the ticket email (controllers/ticketController.sendTicketEmail). */
async function ticketsIssued(orderId) {
  try {
    const { data: order, error } = await supabase.from('orders')
      .select('id, status, user_id, guest_email, events ( id, title, starts_at, timezone )')
      .eq('id', orderId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!order || order.status !== 'paid' || !order.events) return 0;
    const userId = order.user_id || (await accountsByEmail([order.guest_email]))[0];
    if (!userId) return 0;
    const { count } = await supabase.from('tickets').select('id', { count: 'exact', head: true }).eq('order_id', orderId);
    return await record([{
      userId, kind: 'tickets_issued', eventId: order.events.id, orderId,
      dedupeKey: `order:${orderId}:tickets`, ...messageFor('tickets_issued', { event: order.events, count }),
    }]);
  } catch (err) {
    logger.error({ err: err.message, orderId }, 'tickets-issued app notification failed');
    return 0;
  }
}

/** After a transfer (routes/ticketRoutes.js). `toEmail` is the new holder. */
async function ticketReceived({ ticketId, toEmail, fromEmail }) {
  try {
    const [userId] = await accountsByEmail([toEmail]);
    if (!userId) return 0;
    const { data: t, error } = await supabase.from('tickets')
      .select('id, events ( id, title, starts_at, timezone )').eq('id', ticketId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!t?.events) return 0;
    return await record([{
      userId, kind: 'ticket_received', eventId: t.events.id,
      dedupeKey: `ticket:${ticketId}:received`,
      ...messageFor('ticket_received', { event: t.events, from: fromEmail }),
    }]);
  } catch (err) {
    logger.error({ err: err.message, ticketId }, 'ticket-received app notification failed');
    return 0;
  }
}

/** Beside the cancellation texts (services/eventCancellation.js). */
async function eventCancelled(eventId) {
  try {
    const event = await loadEvent(eventId);
    if (!event) return 0;
    const users = new Set([...await ticketHolders(eventId), ...await savers(eventId)]);
    return await record(toEveryone(users, 'event_cancelled', event, `event:${eventId}:cancelled`));
  } catch (err) {
    logger.error({ err: err.message, eventId }, 'cancellation app notifications failed');
    return 0;
  }
}

/** Beside the schedule-change texts (controllers/eventController.js). */
async function eventMoved(eventId) {
  try {
    const event = await loadEvent(eventId);
    if (!event || event.status !== 'published' || new Date(event.starts_at) <= new Date()) return 0;
    const users = new Set([...await ticketHolders(eventId), ...await savers(eventId)]);
    // Keyed by the NEW time: moved twice is told twice, moved once is told once.
    return await record(toEveryone(users, 'event_moved', event, `event:${eventId}:moved:${event.starts_at}`));
  } catch (err) {
    logger.error({ err: err.message, eventId }, 'schedule-change app notifications failed');
    return 0;
  }
}

/**
 * The reminder job (services/scheduler.js): events starting between one and
 * REMINDER_HOURS from now, to the people holding tickets for them. Once per
 * event per person, however often the job runs inside that window.
 */
const REMINDER_HOURS = 24;
async function eventReminders(now = new Date()) {
  if (!enabled()) return 0;
  const from = new Date(now.getTime() + 60 * 60_000).toISOString();
  const to = new Date(now.getTime() + REMINDER_HOURS * 3_600_000).toISOString();
  const { data: events, error } = await supabase.from('events')
    .select('id, title, starts_at, timezone, venue_name, status')
    .eq('status', 'published').gt('starts_at', from).lte('starts_at', to).limit(500);
  if (error) throw new Error(error.message);
  let created = 0;
  for (const event of events || []) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const users = await ticketHolders(event.id);
      // eslint-disable-next-line no-await-in-loop
      created += await record(toEveryone(users, 'event_reminder', event, `event:${event.id}:reminder`));
    } catch (err) {
      logger.error({ err: err.message, eventId: event.id }, 'reminder app notifications failed');
    }
  }
  return created;
}

/** First sign-in to the attendee app. */
function welcome(userId) {
  return record([{ userId, kind: 'welcome', dedupeKey: 'welcome', ...messageFor('welcome') }])
    .catch(() => 0);
}

module.exports = {
  ticketsIssued,
  ticketReceived,
  eventCancelled,
  eventMoved,
  eventReminders,
  welcome,
  record,
  // Pure, for tests.
  messageFor,
  buildMessages,
  deadTokens,
  when,
  PUSH_BATCH,
};
