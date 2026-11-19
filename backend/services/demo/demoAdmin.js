const { supabase } = require('../../config/supabase');
const emails = require('./demoEmails');
const svc = require('./demoService');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The console's side of "Book a demo" (2026-11-19): the list, one booking,
 * and what an admin can do to it. Plus the reminder job.
 *
 * An admin may move a demo to ANY time (outside the weekly hours, at short
 * notice): the hours are for the public page. The database still refuses a
 * time that would put more demos on top of each other than the capacity.
 *
 * Emails sent from here carry the booker's same "change or cancel" link as
 * every other email: its token is derived from the booking id (demoLinks.js).
 * ─────────────────────────────────────────────────────────────────────────────
 */

const VIEWS = ['upcoming', 'past', 'cancelled', 'all'];
const PAGE = 25;

function escapeLike(q) {
  return String(q).replace(/[%_,()\\]/g, ' ').trim();
}

async function list({ view = 'upcoming', q = '', page = 1, now = Date.now() } = {}) {
  const nowIso = new Date(now).toISOString();
  let query = supabase.from('demo_bookings').select(svc.SELECT, { count: 'exact' });
  if (view === 'upcoming') query = query.eq('status', 'confirmed').gte('ends_at', nowIso).order('starts_at', { ascending: true });
  else if (view === 'past') query = query.neq('status', 'cancelled').lt('ends_at', nowIso).order('starts_at', { ascending: false });
  else if (view === 'cancelled') query = query.eq('status', 'cancelled').order('starts_at', { ascending: false });
  else query = query.order('starts_at', { ascending: false });
  const term = escapeLike(q);
  if (term) query = query.or(`name.ilike.%${term}%,email.ilike.%${term}%,company.ilike.%${term}%`);
  const from = (Math.max(1, page) - 1) * PAGE;
  const { data, error, count } = await query.range(from, from + PAGE - 1);
  if (error) throw new Error(`demo list failed: ${error.message}`);

  const counted = async (fn) => {
    const { count: n, error: e } = await fn(supabase.from('demo_bookings').select('id', { count: 'exact', head: true }));
    if (e) throw new Error(`demo count failed: ${e.message}`);
    return n || 0;
  };
  const weekAhead = new Date(now + 7 * 86_400_000).toISOString();
  const [upcoming, nextWeek, completed, noShow, cancelled] = await Promise.all([
    counted((x) => x.eq('status', 'confirmed').gte('ends_at', nowIso)),
    counted((x) => x.eq('status', 'confirmed').gte('starts_at', nowIso).lt('starts_at', weekAhead)),
    counted((x) => x.eq('status', 'completed')),
    counted((x) => x.eq('status', 'no_show')),
    counted((x) => x.eq('status', 'cancelled')),
  ]);

  return {
    bookings: (data || []).map(svc.shape),
    pagination: { page, pageSize: PAGE, total: count || 0, totalPages: Math.max(1, Math.ceil((count || 0) / PAGE)) },
    counts: { upcoming, nextWeek, completed, noShow, cancelled },
  };
}

async function get(id) {
  const row = await svc.loadRow(id);
  return row ? svc.shape(row) : null;
}

/** Admins and super admins, for "who is running this demo". */
async function hosts() {
  const { data, error } = await supabase.from('profiles')
    .select('id, full_name, email').in('role', ['admin', 'super_admin']).eq('is_blocked', false)
    .order('full_name', { ascending: true });
  if (error) throw new Error(`demo hosts read failed: ${error.message}`);
  return (data || []).map((p) => ({ id: p.id, name: p.full_name || p.email, email: p.email }));
}

const STATUSES = ['confirmed', 'completed', 'no_show'];

/** Status (not cancel — that has its own action), notes, meeting link, host. */
async function update(id, patch, { notify = false } = {}) {
  const before = await get(id);
  if (!before) return { code: 'NOT_FOUND' };
  const row = { updated_at: new Date().toISOString() };
  if (patch.status !== undefined) {
    if (!STATUSES.includes(patch.status)) return { code: 'VALIDATION_ERROR', message: 'Unknown status.' };
    if (before.status === 'cancelled') return { code: 'CONFLICT', message: 'A cancelled demo stays cancelled. Ask them to book a new time.' };
    row.status = patch.status;
  }
  if (patch.hostNotes !== undefined) row.host_notes = String(patch.hostNotes || '').slice(0, 4000) || null;
  if (patch.meetingLink !== undefined) {
    const link = String(patch.meetingLink || '').trim();
    if (link && !/^https:\/\/\S+$/i.test(link)) return { code: 'VALIDATION_ERROR', message: 'The meeting link must start with https://' };
    row.meeting_link = link.slice(0, 1000) || null;
  }
  if (patch.assignedTo !== undefined) row.assigned_to = patch.assignedTo || null;

  const { data, error } = await supabase.from('demo_bookings').update(row).eq('id', id).select(svc.SELECT).maybeSingle();
  if (error) throw new Error(`demo update failed: ${error.message}`);
  const after = svc.shape(data);

  const linkChanged = patch.meetingLink !== undefined && (after.meetingLink || '') !== (before.meetingLink || '');
  if (notify && linkChanged && after.status === 'confirmed' && Date.parse(after.startsAt) > Date.now()) {
    const settings = await svc.getSettings();
    svc.later('details email', async () => {
      const l = svc.links(id);
      await emails.sendUpdated({ booking: after, settings, manageUrl: l.manageUrl });
    });
  }
  return { booking: after, before };
}

async function cancel(id, { reason = '', notify = true } = {}) {
  const before = await get(id);
  if (!before) return { code: 'NOT_FOUND' };
  if (before.status !== 'confirmed') return { code: 'CONFLICT', message: 'Only a booked demo can be cancelled.' };
  const booking = await svc.setCancelled(id, { by: 'admin', reason });
  if (notify) {
    const settings = await svc.getSettings();
    const l = svc.links(id);
    svc.later('admin-cancel email', () => emails.sendCancelled({ booking, settings, byAdmin: true, reason, bookUrl: l.bookUrl }));
  }
  return { booking, before };
}

async function reschedule(id, { startsAt: wanted, notify = true } = {}) {
  const before = await get(id);
  if (!before) return { code: 'NOT_FOUND' };
  if (before.status !== 'confirmed') return { code: 'CONFLICT', message: 'Only a booked demo can be moved.' };
  const t = Date.parse(wanted);
  if (!Number.isFinite(t)) return { code: 'VALIDATION_ERROR', message: 'Choose the new date and time.' };
  const settings = await svc.getSettings();
  const length = Date.parse(before.endsAt) - Date.parse(before.startsAt);
  const startsAt = new Date(t).toISOString();
  const endsAt = new Date(t + length).toISOString();
  const { error } = await svc.moveTo(settings, id, startsAt, endsAt);
  if (error) {
    const code = svc.rpcCode(error);
    if (code === 'DEMO_SLOT_TAKEN') {
      return { code, message: 'Another demo is booked at that time. Raise "Demos at the same time" in the settings, or choose another time.' };
    }
    if (code) return { code };
    throw new Error(`move_demo_booking failed: ${error.message}`);
  }
  const booking = await get(id);
  if (notify) {
    svc.later('admin-reschedule email', async () => {
      const l = svc.links(id);
      await emails.sendRescheduled({
        booking, settings, manageUrl: l.manageUrl, icsUrl: l.icsUrl, previousStartsAt: before.startsAt, byAdmin: true,
      });
    });
  }
  return { booking, before };
}

/**
 * The reminder job: one email per booking, `reminderHours` before it starts.
 * Stamped first, sent second — a crash between the two loses one reminder,
 * which beats sending two.
 */
async function sendReminders({ now = Date.now() } = {}) {
  const settings = await svc.getSettings();
  if (!settings.enabled || settings.reminderHours <= 0) return { sent: 0 };
  const nowIso = new Date(now).toISOString();
  const until = new Date(now + settings.reminderHours * 3_600_000).toISOString();
  const { data, error } = await supabase.from('demo_bookings')
    .select(svc.SELECT).eq('status', 'confirmed').is('reminder_sent_at', null)
    .gt('starts_at', nowIso).lte('starts_at', until).limit(50);
  if (error) throw new Error(`demo reminders read failed: ${error.message}`);
  let sent = 0;
  for (const row of data || []) {
    // Booked inside the reminder window? The confirmation just went out.
    if (Date.parse(row.created_at) > Date.parse(row.starts_at) - settings.reminderHours * 3_600_000) {
      await supabase.from('demo_bookings').update({ reminder_sent_at: nowIso }).eq('id', row.id);
      continue;
    }
    const { data: claimed } = await supabase.from('demo_bookings')
      .update({ reminder_sent_at: nowIso }).eq('id', row.id).is('reminder_sent_at', null).select('id').maybeSingle();
    if (!claimed) continue;
    const l = svc.links(row.id);
    await emails.sendReminder({ booking: svc.shape(row), settings, manageUrl: l.manageUrl });
    // …and by text, to those who ticked "texts about my demo" (2026-11-19).
    // Queued like every other participant text: consent, quiet hours and
    // STOP are checked again when it is sent.
    if (row.sms_transactional && row.sms_e164) await queueReminderText(row, settings, l.manageUrl);
    sent += 1;
  }
  return { sent };
}

/** "Eventsli: reminder - your demo is Mon, Nov 23, 5:30 PM (your time). …" GSM-7 only, one segment. */
function reminderText(row, settings, manageUrl) {
  const zone = row.booker_timezone || settings.timezone;
  let when;
  try {
    when = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    }).format(new Date(row.starts_at));
  } catch {
    when = new Date(row.starts_at).toUTCString();
  }
  const link = manageUrl ? ` Change it: ${manageUrl}` : '';
  const base = `Eventsli: reminder - your demo is ${when}.`;
  const tail = ' Reply STOP to opt out.';
  return (base.length + link.length + tail.length <= 160) ? `${base}${link}${tail}` : `${base}${tail}`;
}

async function queueReminderText(row, settings, manageUrl) {
  const queue = require('../sms/queue');
  return queue.enqueue({
    category: 'participant',
    to: row.sms_e164,
    body: reminderText(row, settings, manageUrl),
    idempotencyKey: `demo:${row.id}:reminder:${new Date(row.starts_at).toISOString()}`,
    metadata: { purpose: 'demo_reminder', demoBookingId: row.id, expiresAt: new Date(row.starts_at).toISOString() },
  });
}

module.exports = { VIEWS, list, get, hosts, update, cancel, reschedule, sendReminders, reminderText };
