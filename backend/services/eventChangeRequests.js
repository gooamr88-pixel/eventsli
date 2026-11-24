const { supabase } = require('../config/supabase');
const events = require('./eventService');
const logger = require('../utils/logger');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * EDITS TO A LIVE EVENT, REVIEWED BEFORE THEY SHOW (owner, 2026-11-24: "add
 * ability for organizer to edit event details but after review from us").
 *
 * An event on sale was approved as it was. Its operational details
 * (eventRules.LIVE_EDITABLE — the description, the order limit, payments…)
 * still save at once; everything else an organizer changes — the title, the
 * category, the dates, the venue — used to be REFUSED with "contact us". Now
 * it is kept as a change request (migration 20261215090000): the public event
 * stays exactly as approved, an admin approves the request (the changes are
 * written to the event, with the same follow-ups an admin's own edit has) or
 * declines it with a reason the organizer is emailed.
 *
 * Still refused outright, not reviewable: the fields fixed once a ticket has
 * sold (eventRules.LOCKED_AFTER_SALE) — they change what buyers already bought.
 *
 * ONE PENDING REQUEST PER EVENT (a unique index). A second edit merges into
 * it: a field changed again takes the newest value, and a field changed back
 * to what is live drops out. A request left with nothing in it is withdrawn.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** What each reviewed column is called on screen and in emails. */
const LABELS = Object.freeze({
  title: 'Title',
  category: 'Category',
  starts_at: 'Starts',
  ends_at: 'Ends',
  timezone: 'Time zone',
  venue_name: 'Venue',
  venue_address: 'Address',
  venue_address_line2: 'Unit or suite',
  venue_place_id: 'Venue (map place)',
  city: 'City',
  country: 'Country',
  listing_type: 'Listing type',
  admission_type: 'How tickets work',
  purchase_mode: 'How buyers choose',
  fee_bearer: 'Who pays the booking fee',
});

const COLUMNS = 'id, event_id, organizer_id, requested_by, changes, previous, status, decision_note, decided_by, decided_at, created_at, updated_at';

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/** Equal as stored: dates compared as instants, everything else as JSON. */
function same(column, a, b) {
  if (a === undefined) a = null;
  if (b === undefined) b = null;
  if ((column === 'starts_at' || column === 'ends_at') && a && b) {
    return new Date(a).getTime() === new Date(b).getTime();
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

/** A request as the API sends it: each change with its label, old and new value. */
function shape(row) {
  if (!row) return null;
  const changes = row.changes || {};
  const previous = row.previous || {};
  return {
    id: row.id,
    eventId: row.event_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    decidedAt: row.decided_at,
    decisionNote: row.decision_note,
    changes: Object.keys(changes).map((column) => ({
      field: events.apiFieldName(column),
      column,
      label: LABELS[column] || events.apiFieldName(column),
      from: previous[column] ?? null,
      to: changes[column] ?? null,
    })),
  };
}

/** The open request on an event, or null. */
async function pendingRow(eventId) {
  const { data, error } = await supabase.from('event_change_requests')
    .select(COLUMNS).eq('event_id', eventId).eq('status', 'pending').maybeSingle();
  if (error) throw new Error(`change request lookup failed: ${error.message}`);
  return data || null;
}

async function pendingFor(eventId) {
  return shape(await pendingRow(eventId));
}

/**
 * The latest request on an event, whatever its state — so the organizer's
 * page can say "approved" or "declined, because…" after the fact.
 */
async function latestFor(eventId) {
  const { data, error } = await supabase.from('event_change_requests')
    .select(COLUMNS).eq('event_id', eventId).order('created_at', { ascending: false }).limit(1);
  if (error) throw new Error(`change request lookup failed: ${error.message}`);
  return shape(data?.[0] || null);
}

/**
 * Ask for `changes` (column → value) on a live event. `current` is the event
 * row holding at least those columns, `starts_at` and `ends_at`.
 * Returns the request as it now stands, or null when nothing is left to ask.
 */
async function request({ eventId, organizerId, userId, changes, current }) {
  const existing = await pendingRow(eventId);
  const merged = { ...(existing?.changes || {}) };
  const previous = { ...(existing?.previous || {}) };
  for (const [column, value] of Object.entries(changes)) {
    if (same(column, value, current[column])) {
      // Changed back to what is live: nothing to review for it any more.
      delete merged[column];
      delete previous[column];
    } else {
      merged[column] = value;
      if (!(column in previous)) previous[column] = current[column] ?? null;
    }
  }

  // The dates as they would be after approval must still make an event.
  const startsAt = merged.starts_at ?? current.starts_at;
  const endsAt = merged.ends_at ?? current.ends_at;
  if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
    throw fail('VALIDATION_ERROR', 'The event has to end after it starts.');
  }

  if (Object.keys(merged).length === 0) {
    if (existing) await setStatus(existing.id, 'withdrawn', { note: 'Every change was put back.' });
    return null;
  }

  if (existing) {
    const { data, error } = await supabase.from('event_change_requests')
      .update({ changes: merged, previous, requested_by: userId || existing.requested_by, updated_at: new Date().toISOString() })
      .eq('id', existing.id).eq('status', 'pending').select(COLUMNS).maybeSingle();
    if (error) throw new Error(`change request update failed: ${error.message}`);
    if (data) return shape(data);
  }
  const { data, error } = await supabase.from('event_change_requests')
    .insert({ event_id: eventId, organizer_id: organizerId, requested_by: userId || null, changes: merged, previous })
    .select(COLUMNS).single();
  if (error) {
    // Two tabs at once: the other one's request won the unique index. Merge
    // into it instead of failing the save.
    if (error.code === '23505') return request({ eventId, organizerId, userId, changes, current });
    throw new Error(`change request insert failed: ${error.message}`);
  }
  return shape(data);
}

async function setStatus(id, status, { adminId = null, note = null } = {}) {
  const { data, error } = await supabase.from('event_change_requests')
    .update({
      status,
      decision_note: note,
      decided_by: adminId,
      decided_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id).eq('status', 'pending').select(COLUMNS).maybeSingle();
  if (error) throw new Error(`change request update failed: ${error.message}`);
  return data;
}

/** The organizer takes their request back. */
async function withdraw(eventId) {
  const existing = await pendingRow(eventId);
  if (!existing) throw fail('NOT_FOUND', 'There is no change waiting for review on this event.');
  return shape(await setStatus(existing.id, 'withdrawn'));
}

/**
 * APPROVE: write the changes to the event and close the request — the same
 * follow-ups an admin's own edit has. A country brings its currency, refused
 * if tickets have sold in another one; new dates tell ticket holders.
 */
async function approve({ id, adminId, note = null }) {
  const { data: row, error } = await supabase.from('event_change_requests')
    .select(COLUMNS).eq('id', id).maybeSingle();
  if (error) throw new Error(`change request lookup failed: ${error.message}`);
  if (!row) throw fail('NOT_FOUND', 'That change request does not exist.');
  if (row.status !== 'pending') throw fail('CONFLICT', `This request was already ${row.status}.`);

  const columns = Object.keys(row.changes);
  const { data: event, error: eventError } = await supabase.from('events')
    .select(['id', 'slug', 'status', 'country', 'currency', 'starts_at', 'ends_at', ...columns].filter((c, i, a) => a.indexOf(c) === i).join(', '))
    .eq('id', row.event_id).single();
  if (eventError) throw new Error(`change request event lookup failed: ${eventError.message}`);
  if (['cancelled', 'completed', 'archived'].includes(event.status)) {
    throw fail('CONFLICT', `This event is ${event.status}, so it can no longer be changed.`);
  }

  const patch = { ...row.changes };
  if (patch.country && String(patch.country).toUpperCase() !== event.country) {
    patch.country = String(patch.country).toUpperCase();
    const currency = await events.currencyForCountry(patch.country);
    if (currency !== event.currency && await events.hasPaidOrders(event.id)) {
      throw fail('CONFLICT', `Tickets have already sold in ${event.currency}, so this event cannot move to a country that uses a different currency.`);
    }
    patch.currency = currency;
  }
  const startsAt = patch.starts_at ?? event.starts_at;
  const endsAt = patch.ends_at ?? event.ends_at;
  if (new Date(endsAt) <= new Date(startsAt)) {
    throw fail('VALIDATION_ERROR', 'With these changes the event would end before it starts. Decline it, or ask the organizer to fix the dates.');
  }
  patch.updated_at = new Date().toISOString();

  const { data: saved, error: saveError } = await supabase.from('events')
    .update(patch).eq('id', event.id).select('id, slug, status, starts_at').single();
  if (saveError) throw fail('VALIDATION_ERROR', `The changes could not be applied: ${saveError.message}`);

  const closed = await setStatus(row.id, 'approved', { adminId, note });

  // The same follow-ups as any edit to a live event.
  const publishing = require('./eventPublishing');
  if (saved.status === 'published') publishing.refreshPublicPages(saved.slug);
  if (saved.status === 'published' && patch.starts_at && !same('starts_at', patch.starts_at, event.starts_at)) {
    require('./sms/notifications').scheduleChanged(event.id, event.starts_at);
    require('./attendeeNotifications').eventMoved(event.id);
  }
  publishing.inBackground('change approved email', notify(row, 'approved', note));
  return { request: shape(closed || { ...row, status: 'approved' }), event: saved, before: row.previous, after: row.changes };
}

/** DECLINE, with the reason the organizer is emailed. The event is untouched. */
async function reject({ id, adminId, note }) {
  const { data: row, error } = await supabase.from('event_change_requests')
    .select(COLUMNS).eq('id', id).maybeSingle();
  if (error) throw new Error(`change request lookup failed: ${error.message}`);
  if (!row) throw fail('NOT_FOUND', 'That change request does not exist.');
  if (row.status !== 'pending') throw fail('CONFLICT', `This request was already ${row.status}.`);
  const closed = await setStatus(row.id, 'rejected', { adminId, note });
  require('./eventPublishing').inBackground('change declined email', notify(row, 'rejected', note));
  return shape(closed || { ...row, status: 'rejected', decision_note: note });
}

/** The admin queue: requests with their event and organizer. */
async function list({ status = 'pending', from = 0, to = 49 } = {}) {
  let query = supabase.from('event_change_requests')
    .select(`${COLUMNS}, events ( id, slug, title, status, timezone, starts_at ), organizers ( id, display_name )`, { count: 'exact' })
    .order('created_at', { ascending: status === 'pending' })
    .range(from, to);
  if (status !== 'all') query = query.eq('status', status);
  const { data, error, count } = await query;
  if (error) throw new Error(`change requests list failed: ${error.message}`);
  return {
    rows: (data || []).map((r) => {
      const event = Array.isArray(r.events) ? r.events[0] : r.events;
      const org = Array.isArray(r.organizers) ? r.organizers[0] : r.organizers;
      return {
        ...shape(r),
        event: event ? { id: event.id, slug: event.slug, title: event.title, status: event.status, timezone: event.timezone, startsAt: event.starts_at } : null,
        organizer: org ? { id: org.id, name: org.display_name } : null,
      };
    }),
    count: count || 0,
  };
}

/** Email the organizer what happened to their request. Never throws. */
async function notify(row, outcome, note) {
  try {
    const { loadForEmail } = require('./eventPublishing');
    const info = await loadForEmail(row.event_id);
    if (!info?.organizerEmail) return;
    const email = require('./emailService');
    const changes = shape(row).changes.map((c) => c.label);
    await email.sendEventChangeReviewed({
      to: info.organizerEmail, organizerName: info.organizerName, event: info.event, outcome, note, changes,
    });
  } catch (err) {
    logger.error({ err: err.message, requestId: row.id }, 'change request email failed');
  }
}

module.exports = {
  LABELS, request, pendingFor, latestFor, withdraw, approve, reject, list, shape,
};
