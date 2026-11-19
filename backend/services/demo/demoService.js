const { supabase } = require('../../config/supabase');
const logger = require('../../utils/logger');
const T = require('../emailTemplates');
const { clean } = require('./demoSettings');
const { openSlots, isOpen, hostDayBounds, hostDate } = require('./demoSlots');
const { buildIcs } = require('./demoCalendar');
const emails = require('./demoEmails');
const { tokenFor, tokenMatches } = require('./demoLinks');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Book a demo (owner, 2026-11-19): settings, open times, bookings.
 *
 * Every write that takes a time goes through book_demo / move_demo_booking
 * (migration 20261130090000), which lock, re-check and write in one
 * transaction. Everything here returns `{ code }` for a refusal the person can
 * act on, and throws only for a failure that is ours.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const KEY = 'demo_booking';
const SELECT = 'id, starts_at, ends_at, status, name, email, phone, company, topic, message, answers, '
  + 'booker_timezone, meeting_link, host_notes, assigned_to, reminder_sent_at, cancelled_at, cancelled_by, '
  + 'cancel_reason, rescheduled_from, reschedule_count, created_at, updated_at';

// ── Settings ─────────────────────────────────────────────────────────────

async function getSettings() {
  const { data, error } = await supabase.from('platform_settings').select('value').eq('key', KEY).maybeSingle();
  if (error) throw new Error(`demo settings read failed: ${error.message}`);
  return clean(data?.value);
}

async function saveSettings(input) {
  const value = clean(input);
  const { error } = await supabase.from('platform_settings')
    .upsert({ key: KEY, value }, { onConflict: 'key' });
  if (error) throw new Error(`demo settings save failed: ${error.message}`);
  return value;
}

// ── Shapes ───────────────────────────────────────────────────────────────

/** One spelling for every instant ("…Z"), whatever PostgREST sent ("+00:00"). */
const iso = (v) => (v ? new Date(v).toISOString() : null);

function shape(row) {
  if (!row) return null;
  return {
    id: row.id,
    startsAt: iso(row.starts_at),
    endsAt: iso(row.ends_at),
    status: row.status,
    name: row.name,
    email: row.email,
    phone: row.phone,
    company: row.company,
    topic: row.topic,
    message: row.message,
    answers: Array.isArray(row.answers) ? row.answers : [],
    bookerTimezone: row.booker_timezone,
    meetingLink: row.meeting_link,
    hostNotes: row.host_notes,
    assignedTo: row.assigned_to,
    reminderSentAt: iso(row.reminder_sent_at),
    cancelledAt: iso(row.cancelled_at),
    cancelledBy: row.cancelled_by,
    cancelReason: row.cancel_reason,
    rescheduledFrom: iso(row.rescheduled_from),
    rescheduleCount: row.reschedule_count,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

/** What the booker's own page may show: no host notes, no assignee. */
function bookerView(b, settings, now = Date.now()) {
  const future = Date.parse(b.startsAt) > now;
  return {
    id: b.id,
    status: b.status,
    startsAt: b.startsAt,
    endsAt: b.endsAt,
    name: b.name,
    email: b.email,
    bookerTimezone: b.bookerTimezone,
    hostTimezone: settings.timezone,
    durationMinutes: Math.round((Date.parse(b.endsAt) - Date.parse(b.startsAt)) / 60_000),
    meetingLink: b.status === 'confirmed' ? b.meetingLink : null,
    meetingNote: settings.meetingNote,
    title: settings.title,
    canChange: b.status === 'confirmed' && future,
    cancelledBy: b.cancelledBy,
  };
}

// ── Links ────────────────────────────────────────────────────────────────

/** Every link about one booking. The manage token is derived (demoLinks.js). */
function links(id) {
  const site = T.siteUrl();
  const api = T.apiUrl();
  const t = encodeURIComponent(tokenFor(id));
  return {
    token: tokenFor(id),
    manageUrl: site ? `${site}/demo/booking/${id}?t=${t}` : null,
    icsUrl: api ? `${api}/api/v1/public/demo/bookings/${id}/calendar.ics?t=${t}` : null,
    bookUrl: site ? `${site}/demo` : null,
    adminUrl: site ? `${site}/admin/demo?booking=${id}` : null,
  };
}

// ── Reading bookings ─────────────────────────────────────────────────────

/** Live bookings that could touch [from, to], padded a day each side. */
async function liveAround(fromIso, toIso) {
  const from = new Date(Date.parse(fromIso) - 86_400_000).toISOString();
  const to = new Date(Date.parse(toIso) + 86_400_000).toISOString();
  const { data, error } = await supabase.from('demo_bookings')
    .select('id, starts_at, ends_at')
    .eq('status', 'confirmed').lt('starts_at', to).gt('ends_at', from);
  if (error) throw new Error(`demo bookings read failed: ${error.message}`);
  return (data || []).map((r) => ({ id: r.id, startsAt: r.starts_at, endsAt: r.ends_at }));
}

async function loadRow(id) {
  const { data, error } = await supabase.from('demo_bookings')
    .select(SELECT).eq('id', id).maybeSingle();
  if (error) throw new Error(`demo booking read failed: ${error.message}`);
  return data;
}

/** Open starts in a window (the page asks a month at a time). */
async function slots({ from, to, now = Date.now() }) {
  const settings = await getSettings();
  if (!settings.enabled) return { enabled: false, slots: [] };
  const bookings = await liveAround(from, to);
  return { enabled: true, slots: openSlots(settings, bookings, { now, from, to }) };
}

// ── Checking what a person sent ──────────────────────────────────────────

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^[0-9+\-() ]{7,20}$/;
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** → { values } or { code, message } — the message names the field to fix. */
function checkDetails(input, settings) {
  const bad = (message) => ({ code: 'VALIDATION_ERROR', message });
  const fillIn = (label) => bad(`Please fill in “${label}”.`);
  const name = str(input.name, 120);
  const email = str(input.email, 254).toLowerCase();
  if (!name) return bad('Enter your name.');
  if (!EMAIL.test(email)) return bad('Enter a valid email address.');

  const f = settings.fields;
  const take = (key, max) => (f[key].mode === 'hidden' ? '' : str(input[key], max));
  const phone = take('phone', 30);
  const company = take('company', 200);
  let topic = take('topic', 120);
  const message = take('message', 2000);
  if (f.phone.mode === 'required' && !phone) return fillIn(f.phone.label);
  if (phone && !PHONE.test(phone)) return bad('Enter the phone number with digits only (and +, spaces or dashes).');
  if (f.company.mode === 'required' && !company) return fillIn(f.company.label);
  if (topic && !settings.topics.includes(topic)) topic = '';
  if (f.topic.mode === 'required' && settings.topics.length > 0 && !topic) return fillIn(f.topic.label);
  if (f.message.mode === 'required' && !message) return fillIn(f.message.label);

  const given = input.answers && typeof input.answers === 'object' ? input.answers : {};
  const answers = [];
  for (const q of settings.questions) {
    let answer = str(given[q.id], q.type === 'textarea' ? 2000 : 300);
    if (q.type === 'select' && answer && !q.options.includes(answer)) answer = '';
    if (q.required && !answer) return fillIn(q.label);
    if (answer) answers.push({ id: q.id, label: q.label, answer });
  }

  let timezone = str(input.timezone, 64);
  try {
    if (timezone) new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
  } catch {
    timezone = '';
  }
  return { values: { name, email, phone, company, topic, message, answers, timezone } };
}

// ── Notifying ────────────────────────────────────────────────────────────

async function adminTargets(settings) {
  const extra = settings.notifyEmails || [];
  if (!settings.notifyAdmins) return extra;
  const { adminRecipients } = require('../eventPublishing');
  const admins = await adminRecipients().catch((err) => {
    logger.error({ err: err.message }, 'demo: admin recipients lookup failed');
    return [];
  });
  return [...new Set([...admins, ...extra])];
}

function later(label, fn) {
  setImmediate(() => {
    Promise.resolve().then(fn).catch((err) => logger.error({ err: err.message }, `demo: ${label} failed`));
  });
}

// ── Booking ──────────────────────────────────────────────────────────────

function rpcCode(error) {
  const m = String(error?.message || '');
  if (m.includes('DEMO_SLOT_TAKEN')) return 'DEMO_SLOT_TAKEN';
  if (m.includes('DEMO_NOT_FOUND')) return 'NOT_FOUND';
  return null;
}

/** Move a live booking, re-checked inside the database's lock. → { error } */
async function moveTo(settings, id, startsAt, endsAt) {
  const day = hostDayBounds(hostDate(startsAt, settings.timezone), settings.timezone);
  return supabase.rpc('move_demo_booking', {
    p_id: id, p_starts: startsAt, p_ends: endsAt,
    p_capacity: settings.capacity, p_buffer_minutes: settings.bufferMinutes,
    p_daily_limit: settings.dailyLimit, p_day_start: day.start, p_day_end: day.end,
  });
}

async function createBooking(input, { now = Date.now() } = {}) {
  const settings = await getSettings();
  if (!settings.enabled) return { code: 'FEATURE_DISABLED', message: 'Demo bookings are closed for now.' };

  const checked = checkDetails(input, settings);
  if (checked.code) return checked;
  const v = checked.values;

  const t = Date.parse(input.startsAt);
  if (!Number.isFinite(t)) return { code: 'VALIDATION_ERROR', message: 'Choose a time.' };
  const startsAt = new Date(t).toISOString();
  const endsAt = new Date(t + settings.durationMinutes * 60_000).toISOString();
  if (!isOpen(settings, await liveAround(startsAt, endsAt), startsAt, { now })) {
    return { code: 'DEMO_SLOT_TAKEN' };
  }

  const day = hostDayBounds(hostDate(startsAt, settings.timezone), settings.timezone);
  const { data: id, error } = await supabase.rpc('book_demo', {
    p_row: {
      starts_at: startsAt, ends_at: endsAt, name: v.name, email: v.email, phone: v.phone,
      company: v.company, topic: v.topic, message: v.message, answers: v.answers,
      booker_timezone: v.timezone, meeting_link: settings.meetingLink,
    },
    p_capacity: settings.capacity,
    p_buffer_minutes: settings.bufferMinutes,
    p_daily_limit: settings.dailyLimit,
    p_day_start: day.start,
    p_day_end: day.end,
  });
  if (error) {
    const code = rpcCode(error);
    if (code) return { code };
    throw new Error(`book_demo failed: ${error.message}`);
  }

  const booking = shape(await loadRow(id));
  const l = links(id);
  later('confirmation email', () => emails.sendConfirmed({ booking, settings, manageUrl: l.manageUrl, icsUrl: l.icsUrl }));
  later('admin email', async () => {
    const to = await adminTargets(settings);
    if (to.length) await emails.sendToAdmins({ to, kind: 'new', booking, settings, adminUrl: l.adminUrl });
  });
  return { booking: bookerView(booking, settings, now), token: l.token };
}

// ── The booker's own link ────────────────────────────────────────────────

async function forBooker(id, token) {
  if (!tokenMatches(id, token)) return { code: 'NOT_FOUND' };
  const row = await loadRow(id);
  if (!row) return { code: 'NOT_FOUND' };
  const settings = await getSettings();
  return { booking: shape(row), settings };
}

async function viewForBooker(id, token, { now = Date.now() } = {}) {
  const found = await forBooker(id, token);
  if (found.code) return found;
  return { booking: bookerView(found.booking, found.settings, now) };
}

async function cancelByBooker(id, token, { reason = '', now = Date.now() } = {}) {
  const found = await forBooker(id, token);
  if (found.code) return found;
  const { booking, settings } = found;
  if (booking.status !== 'confirmed' || Date.parse(booking.startsAt) <= now) {
    return { code: 'CONFLICT', message: 'This demo can no longer be cancelled here. Reply to your confirmation email instead.' };
  }
  const cancelled = await setCancelled(id, { by: 'booker', reason });
  const l = links(id);
  later('cancel email', () => emails.sendCancelled({ booking: cancelled, settings, byAdmin: false, bookUrl: l.bookUrl }));
  later('admin cancel email', async () => {
    const to = await adminTargets(settings);
    if (to.length) await emails.sendToAdmins({ to, kind: 'cancelled', booking: cancelled, settings, adminUrl: l.adminUrl, reason });
  });
  return { booking: bookerView(cancelled, settings, now) };
}

async function rescheduleByBooker(id, token, { startsAt: wanted, now = Date.now() } = {}) {
  const found = await forBooker(id, token);
  if (found.code) return found;
  const { booking, settings } = found;
  if (!settings.enabled) return { code: 'FEATURE_DISABLED', message: 'Demo bookings are closed for now.' };
  if (booking.status !== 'confirmed' || Date.parse(booking.startsAt) <= now) {
    return { code: 'CONFLICT', message: 'This demo can no longer be moved here. Reply to your confirmation email instead.' };
  }
  const t = Date.parse(wanted);
  if (!Number.isFinite(t)) return { code: 'VALIDATION_ERROR', message: 'Choose a time.' };
  const startsAt = new Date(t).toISOString();
  const endsAt = new Date(t + settings.durationMinutes * 60_000).toISOString();
  const others = (await liveAround(startsAt, endsAt)).filter((b) => b.id !== id);
  if (!isOpen(settings, others, startsAt, { now })) return { code: 'DEMO_SLOT_TAKEN' };

  const { error } = await moveTo(settings, id, startsAt, endsAt);
  if (error) {
    const code = rpcCode(error);
    if (code) return { code };
    throw new Error(`move_demo_booking failed: ${error.message}`);
  }
  const moved = shape(await loadRow(id));
  const l = links(id);
  later('reschedule email', () => emails.sendRescheduled({
    booking: moved, settings, manageUrl: l.manageUrl, icsUrl: l.icsUrl, previousStartsAt: booking.startsAt,
  }));
  later('admin reschedule email', async () => {
    const to = await adminTargets(settings);
    if (to.length) {
      await emails.sendToAdmins({ to, kind: 'moved', booking: moved, settings, adminUrl: l.adminUrl, previousStartsAt: booking.startsAt });
    }
  });
  return { booking: bookerView(moved, settings, now) };
}

async function calendarFile(id, token) {
  const found = await forBooker(id, token);
  if (found.code) return found;
  const { booking, settings } = found;
  const l = links(id);
  return {
    ics: buildIcs({
      uid: booking.id,
      sequence: booking.rescheduleCount,
      start: booking.startsAt,
      end: booking.endsAt,
      title: `${settings.title} with Eventsli`,
      description: booking.meetingLink ? `Join: ${booking.meetingLink}` : settings.meetingNote,
      location: booking.meetingLink || '',
      url: l.manageUrl,
      cancelled: booking.status === 'cancelled',
    }),
  };
}

async function setCancelled(id, { by, reason }) {
  const { data, error } = await supabase.from('demo_bookings')
    .update({
      status: 'cancelled', cancelled_at: new Date().toISOString(), cancelled_by: by,
      cancel_reason: str(reason, 500) || null, updated_at: new Date().toISOString(),
    })
    .eq('id', id).eq('status', 'confirmed').select(SELECT).maybeSingle();
  if (error) throw new Error(`demo cancel failed: ${error.message}`);
  return shape(data) || shape(await loadRow(id));
}

module.exports = {
  KEY, SELECT, getSettings, saveSettings, shape, bookerView, links,
  liveAround, loadRow, slots, checkDetails, adminTargets, later, rpcCode, moveTo, setCancelled,
  createBooking, viewForBooker, cancelByBooker, rescheduleByBooker, calendarFile,
};
