const crypto = require('node:crypto');
const { supabase } = require('../config/supabase');
const { hashPassword } = require('../utils/crypto');
const tokens = require('./scanTokens');
const links = require('./shareLinks');
const email = require('./emailService');
const logger = require('../utils/logger');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The door team: people with their own Eventsli accounts, allowed to scan for
 * ONE event.
 *
 * Beside PIN devices, not replacing them. What a member can do is exactly what
 * a PIN device can do — scan, undo, see the gate status — for the one event
 * they were added to, and nothing else: no orders, no attendee list, no money,
 * no organizer pages. Their account role does not change.
 *
 * At the gate a member scans through a device row of their own (see the
 * migration), so check-in, undo, revocation and the scan log need no second
 * code path — a second path is where a revoked person keeps scanning.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { one } = require('../utils/embed');

// Only an event on sale opens its door. A cancelled one is refused by the
// check-in function anyway; refusing the sign-in is clearer. An ARCHIVED event
// has stopped selling, but the tickets it already sold are still good — so its
// door stays open to them.
const SCANNABLE = new Set(['published', 'archived']);

async function list(eventId) {
  const { data, error } = await supabase
    .from('event_staff')
    // No name: the list shows the addresses the organizer typed, and nothing
    // the account holder did not choose to share with them.
    .select(`id, user_id, created_at, revoked_at,
             profiles!event_staff_user_id_fkey ( email ),
             scan_devices ( last_seen_at )`)
    .eq('event_id', eventId)
    .order('created_at');
  if (error) throw new Error(error.message);

  return (data || []).map((row) => {
    const person = one(row.profiles);
    const device = one(row.scan_devices);
    return {
      id: row.id,
      userId: row.user_id,
      email: person?.email || null,
      addedAt: row.created_at,
      active: !row.revoked_at,
      revokedAt: row.revoked_at,
      lastSignInAt: device?.last_seen_at || null,
    };
  });
}

/**
 * Adds an existing account by email.
 *
 * Returns `{ added }` for the caller's logs only. The HTTP answer is the same
 * either way (staffController.add): anyone can become an organizer, and a 404
 * for an unknown address with a name for a known one made this a free lookup
 * of who has an Eventsli account. A blocked account is treated as absent.
 */
async function add({ eventId, email, addedBy }) {
  const address = String(email || '').trim().toLowerCase();
  const { data: person, error: lookupError } = await supabase
    .from('profiles')
    .select('id, full_name, email, is_blocked')
    .eq('email', address)
    .maybeSingle();
  if (lookupError) throw new Error(lookupError.message);

  if (!person || person.is_blocked) return { added: false, notified: false };

  // Were they already on the team? Only someone new — or coming back after
  // being removed — is emailed; saving the same person twice sends nothing.
  const { data: before } = await supabase
    .from('event_staff').select('revoked_at')
    .eq('event_id', eventId).eq('user_id', person.id)
    .maybeSingle();

  // Re-adding someone who was removed restores the same row, so their earlier
  // scans stay attached to one identity.
  const { data, error } = await supabase
    .from('event_staff')
    .upsert(
      { event_id: eventId, user_id: person.id, added_by: addedBy, revoked_at: null },
      { onConflict: 'event_id,user_id' },
    )
    .select('id, created_at')
    .single();
  if (error) throw new Error(error.message);

  const notified = !before || Boolean(before.revoked_at);
  if (notified) notifyAdded({ eventId, person });

  return { added: true, notified, id: data.id };
}

/**
 * The email that tells a new member what they can do and where to go.
 * Not awaited by the caller and never throws: adding someone to the door must
 * not fail because a mail provider had a bad minute.
 */
async function notifyAdded({ eventId, person }) {
  try {
    const { data: event } = await supabase
      .from('events')
      .select('title, starts_at, timezone, organizers ( display_name )')
      .eq('id', eventId)
      .maybeSingle();
    if (!event) return;
    await email.sendDoorTeamAdded({
      to: person.email,
      name: person.full_name,
      eventTitle: event.title,
      organizerName: one(event.organizers)?.display_name,
      startsAt: event.starts_at,
      timezone: event.timezone,
      gateUrl: `${links.siteOrigin()}/gate/login`,
    });
  } catch (err) {
    logger.error({ err: err.message, eventId }, 'door team email not sent');
  }
}

/**
 * Removes someone from the door team — effective on their NEXT SCAN, not their
 * next sign-in, because `requireDevice` re-reads the device and the membership
 * on every request.
 */
async function revoke({ eventId, staffId }) {
  const { data, error } = await supabase
    .from('event_staff')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', staffId)
    .eq('event_id', eventId)
    .is('revoked_at', null)
    .select('id')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return false;

  const { error: deviceError } = await supabase
    .from('scan_devices').update({ is_active: false }).eq('staff_id', staffId);
  if (deviceError) throw new Error(deviceError.message);
  return true;
}

/** The events this person may scan for right now: their door-team events, plus their own. */
async function assignmentsFor({ userId, organizerId }) {
  const EVENT_COLUMNS = 'id, title, slug, status, starts_at, ends_at, timezone, venue_name';
  const [staffRows, owned] = await Promise.all([
    supabase.from('event_staff').select(`events ( ${EVENT_COLUMNS} )`)
      .eq('user_id', userId).is('revoked_at', null),
    organizerId
      ? supabase.from('events').select(EVENT_COLUMNS).eq('organizer_id', organizerId).in('status', [...SCANNABLE])
      : Promise.resolve({ data: [] }),
  ]);
  if (staffRows.error) throw new Error(staffRows.error.message);
  if (owned.error) throw new Error(owned.error.message);

  const byId = new Map();
  for (const row of staffRows.data || []) {
    const event = one(row.events);
    if (event) byId.set(event.id, { ...event, as: 'staff' });
  }
  for (const event of owned.data || []) byId.set(event.id, { ...event, as: 'organizer' });

  // Twelve hours of grace after the end: doors close late and the last scans
  // of the night should not be refused because the listed end time passed.
  const cutoff = Date.now() - 12 * 3600e3;
  return [...byId.values()]
    .filter((e) => SCANNABLE.has(e.status) && new Date(e.ends_at).getTime() > cutoff)
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))
    .map((e) => ({
      id: e.id, title: e.title, slug: e.slug, startsAt: e.starts_at, endsAt: e.ends_at,
      timezone: e.timezone, venue: e.venue_name, as: e.as,
    }));
}

async function staffDeviceFor({ staffId, eventId, label }) {
  const now = new Date().toISOString();
  const { data: existing, error } = await supabase
    .from('scan_devices').select('id, label').eq('staff_id', staffId).maybeSingle();
  if (error) throw new Error(error.message);

  if (existing) {
    const { error: updateError } = await supabase
      .from('scan_devices').update({ is_active: true, last_seen_at: now }).eq('id', existing.id);
    if (updateError) throw new Error(updateError.message);
    return existing;
  }

  // The PIN hash of an unguessable secret nobody is told. The column is NOT
  // NULL, and PIN login refuses any device with a staff_id regardless, so this
  // row can only ever be reached with a staff token.
  const { data, error: insertError } = await supabase
    .from('scan_devices')
    .insert({
      event_id: eventId,
      label,
      staff_id: staffId,
      pin_hash: await hashPassword(crypto.randomBytes(32).toString('base64url')),
      last_seen_at: now,
    })
    .select('id, label')
    .single();

  if (insertError?.code === '23505') {
    // Two sign-ins at once: the other one created it. Use theirs.
    const { data: raced } = await supabase
      .from('scan_devices').select('id, label').eq('staff_id', staffId).single();
    return raced;
  }
  if (insertError) throw new Error(insertError.message);
  return data;
}

/**
 * Signs a door-team member in to scan one event. Null when they may not.
 *
 * The event's organizer may always scan their own event, and is added to its
 * door team on first use so their scans carry a name like anyone else's.
 */
async function openStaffSession({ userId, organizerId, displayName, eventId }) {
  const { data: event, error } = await supabase
    .from('events').select('id, organizer_id, status, title').eq('id', eventId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!event || !SCANNABLE.has(event.status)) return null;

  let staff;
  if (organizerId && event.organizer_id === organizerId) {
    const res = await supabase
      .from('event_staff')
      .upsert({ event_id: eventId, user_id: userId, added_by: userId, revoked_at: null },
        { onConflict: 'event_id,user_id' })
      .select('id').single();
    if (res.error) throw new Error(res.error.message);
    staff = res.data;
  } else {
    const res = await supabase
      .from('event_staff').select('id')
      .eq('event_id', eventId).eq('user_id', userId).is('revoked_at', null)
      .maybeSingle();
    if (res.error) throw new Error(res.error.message);
    staff = res.data;
  }
  if (!staff) return null;

  const device = await staffDeviceFor({
    staffId: staff.id, eventId, label: `Staff · ${displayName}`.slice(0, 60),
  });

  return {
    token: tokens.signStaffToken({ deviceId: device.id, eventId, userId }),
    device: { id: device.id, label: device.label, eventId, staff: true },
    event: { id: event.id, title: event.title },
  };
}

module.exports = { list, add, revoke, assignmentsFor, openStaffSession };
