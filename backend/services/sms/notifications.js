const { supabase } = require('../../config/supabase');
const logger = require('../../utils/logger');
const { fetchAll } = require('../../utils/fetchAll');
const config = require('./config');
const queue = require('./queue');
const phone = require('./phone');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The transactional texts: what a buyer is told about THEIR order and event.
 *
 *   Participant SMS      ticket confirmation, once per order
 *   Event notifications  reminder, schedule change, cancellation
 *
 * Every one is keyed so it is sent once ("order:<id>:confirmation",
 * "event:<id>:cancelled:<order>"), is best-effort (never throws into the code
 * that issued the ticket or cancelled the event), and carries no credential:
 * the ticket link with its access token stays in the email. A text message is
 * read on a lock screen and forwarded freely.
 *
 * Whether any of this actually goes out is decided at dispatch: the category
 * switch, the country's verification, the suppression list.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const clip = (s, n) => (String(s || '').length > n ? `${String(s).slice(0, n - 1).trimEnd()}…` : String(s || ''));

function when(iso, timeZone) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || 'UTC', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toUTCString().slice(0, 22);
  }
}

const brand = async () => (await config.load()).settings?.brand_name || 'Eventsli';

async function paidOrders(eventId) {
  return fetchAll((r, first) => supabase.from('orders')
    .select('id, guest_phone, user_id, profiles!orders_user_id_fkey ( phone )', first ? { count: 'exact' } : undefined)
    .eq('event_id', eventId).eq('status', 'paid').order('id').range(r.from, r.to), { what: 'orders' });
}

const phoneOf = (order) => (order.guest_phone && String(order.guest_phone).trim()) || order.profiles?.phone || null;

/**
 * One message per NUMBER for the event — a buyer with three orders gets one
 * reminder, not three — queued in bulk so a sold-out arena is a handful of
 * inserts, not one round trip per order. `keyFor(e164)` names the message.
 */
async function fanOut(event, keyFor, body, category, extra = {}) {
  const cfg = await config.load();
  const orders = await paidOrders(event.id);
  const byNumber = new Map();
  for (const order of orders) {
    const raw = phoneOf(order);
    const parsed = raw && phone.normalize(raw, { defaultCountry: event.country, matcher: cfg.matcher });
    if (parsed && !byNumber.has(parsed.e164)) byNumber.set(parsed.e164, { parsed, order });
  }
  const inputs = [...byNumber.values()].map(({ parsed, order }) => ({
    category, e164: parsed.e164, country: parsed.country, body,
    idempotencyKey: keyFor(parsed.e164), eventId: event.id, orderId: order.id, userId: order.user_id, ...extra,
  }));
  let queued = 0;
  for (let i = 0; i < inputs.length; i += 1000) {
    // eslint-disable-next-line no-await-in-loop
    queued += (await queue.enqueueMany(inputs.slice(i, i + 1000))).queued;
  }
  return queued;
}

async function loadEvent(eventId) {
  const { data } = await supabase.from('events')
    .select('id, title, starts_at, timezone, venue_name, city, country, status').eq('id', eventId).maybeSingle();
  return data;
}

/** The number a buyer typed beside the SMS boxes, when the order itself has none. */
async function checkoutPhone(order) {
  const { data } = await supabase.from('reservations').select('attendee_data').eq('id', order.reservation_id).maybeSingle();
  return data?.attendee_data?.smsConsent?.e164 || null;
}

async function ticketConfirmation(orderId) {
  try {
    const { data: order } = await supabase.from('orders')
      .select(`id, status, guest_phone, user_id, reservation_id, profiles!orders_user_id_fkey ( phone ),
               events ( id, title, starts_at, timezone, country, organizer_id )`)
      .eq('id', orderId).maybeSingle();
    if (!order || order.status !== 'paid' || !order.events) return { queued: false };
    // What the buyer ticked at checkout becomes consent NOW, when the order
    // exists — an abandoned checkout records nothing. Before the enqueue, so
    // the confirmation below is decided against it.
    const recorded = await require('./consent').applyCheckoutConsent(order, order.events)
      .catch((err) => { logger.error({ err: err.message, orderId }, 'checkout SMS consent not recorded'); return []; });
    const to = phoneOf(order) || (recorded.length ? await checkoutPhone(order) : null);
    if (!to) return { queued: false, reason: 'no_phone' };
    const { count } = await supabase.from('tickets').select('id', { count: 'exact', head: true }).eq('order_id', orderId);
    const e = order.events;
    const n = count || 1;
    const body = `${await brand()}: You're going to ${clip(e.title, 40)}, ${when(e.starts_at, e.timezone)}. `
      + `${n} ticket${n === 1 ? '' : 's'} confirmed. Your tickets are in your email.`;
    const expiresAt = new Date(Math.min(new Date(e.starts_at).getTime(), Date.now() + 48 * 3_600_000)).toISOString();
    return queue.enqueue({
      category: 'participant', to, defaultCountry: e.country, body,
      idempotencyKey: `order:${orderId}:confirmation`, eventId: e.id, orderId, userId: order.user_id,
      metadata: { purpose: 'ticket_confirmation', expiresAt },
    });
  } catch (err) {
    logger.error({ err: err.message, orderId }, 'ticket confirmation SMS not queued');
    return { queued: false };
  }
}

async function eventCancelled(eventId) {
  try {
    const event = await loadEvent(eventId);
    if (!event) return 0;
    const body = `${await brand()}: ${clip(event.title, 50)} on ${when(event.starts_at, event.timezone)} has been cancelled. `
      + 'Check your email for details.';
    return await fanOut(event, (e164) => `event:${eventId}:cancelled:${e164}`, body, 'event_notification',
      { metadata: { purpose: 'event_cancelled', expiresAt: new Date(Date.now() + 72 * 3_600_000).toISOString() } });
  } catch (err) {
    logger.error({ err: err.message, eventId }, 'cancellation SMS not queued');
    return 0;
  }
}

async function scheduleChanged(eventId, previousStartsAt) {
  try {
    const event = await loadEvent(eventId);
    if (!event || event.status !== 'published' || new Date(event.starts_at) <= new Date()) return 0;
    const body = `${await brand()}: ${clip(event.title, 50)} has moved to ${when(event.starts_at, event.timezone)}. `
      + 'Your tickets stay valid.';
    return await fanOut(event, (e164) => `event:${eventId}:moved:${event.starts_at}:${e164}`, body, 'event_notification',
      { metadata: { purpose: 'schedule_changed', previousStartsAt, expiresAt: event.starts_at } });
  } catch (err) {
    logger.error({ err: err.message, eventId }, 'schedule change SMS not queued');
    return 0;
  }
}

/** The reminder job: events starting within the reminder window, once per order. */
async function eventReminders() {
  const cfg = await config.load();
  const hours = cfg.settings?.reminder_hours_before || 24;
  const reminder = cfg.categories.get('event_notification');
  if (!reminder?.enabled || !cfg.settings?.sending_enabled) return 0;
  const from = new Date(Date.now() + 60 * 60_000).toISOString();
  const to = new Date(Date.now() + hours * 3_600_000).toISOString();
  const { data: events, error } = await supabase.from('events')
    .select('id, title, starts_at, timezone, venue_name, city, country, status')
    .eq('status', 'published').gt('starts_at', from).lte('starts_at', to).limit(500);
  if (error) throw new Error(error.message);
  const b = await brand();
  let queued = 0;
  for (const event of events || []) {
    const where = event.venue_name ? ` at ${clip(event.venue_name, 30)}` : '';
    const body = `${b}: Reminder: ${clip(event.title, 40)} starts ${when(event.starts_at, event.timezone)}${where}. Your tickets are in your email.`;
    // eslint-disable-next-line no-await-in-loop
    queued += await fanOut(event, (e164) => `event:${event.id}:reminder:${e164}`, body, 'event_notification',
      { metadata: { purpose: 'event_reminder', expiresAt: event.starts_at } });
  }
  return queued;
}

module.exports = { ticketConfirmation, eventCancelled, scheduleChanged, eventReminders, when, clip };
