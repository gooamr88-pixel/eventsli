const { supabase } = require('../config/supabase');
const { hashPassword, verifyPassword } = require('../utils/crypto');
const logger = require('../utils/logger');
const { mapLimit } = require('../utils/mapLimit');
const {
  MAX_PIN_FAILURES, PIN_LOCK_MINUTES, isPinLocked, isShortPin, shortPinRefused,
} = require('../utils/pinLockout');
const { decodeQrToken } = require('./ticketService');
const scanTokens = require('./scanTokens');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The gate.
 *
 * Devices, not users. Door staff share a tablet and change between shifts;
 * making each of them log in with a personal account means either everyone
 * knows the organizer's password or nobody can scan. A device is registered
 * once by the organizer, given a PIN, and is its own principal — so a lost
 * tablet is revoked without touching anyone's account.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// Token signing and reading live in scanTokens.js, which has no database and is
// therefore testable. A tablet's token lasts seven days — a festival weekend
// without a re-login, short enough that a stolen one dies before the next event.

async function registerDevice({ eventId, label, pin }) {
  const { data, error } = await supabase
    .from('scan_devices')
    .insert({ event_id: eventId, label: String(label).trim(), pin_hash: await hashPassword(pin), pin_short: false })
    .select('id, label, is_active, created_at')
    .single();
  if (error) throw new Error(error.message);
  return { id: data.id, label: data.label, isActive: data.is_active, createdAt: data.created_at };
}

async function listDevices(eventId) {
  // Shared tablets only. A door-team member's own device row is how their
  // scans are recorded, and is managed by removing the person, not the row.
  const { data } = await supabase
    .from('scan_devices')
    .select('id, label, is_active, last_seen_at, created_at, pin_short')
    .eq('event_id', eventId)
    .is('staff_id', null)
    .order('created_at');
  return (data || []).map((d) => ({
    id: d.id, label: d.label, isActive: d.is_active,
    lastSeenAt: d.last_seen_at, createdAt: d.created_at,
    // True once it has signed in with a PIN under six digits: ask for a new one.
    pinNeedsReset: d.pin_short === true,
  }));
}

/**
 * Revoking is a flag, not a delete: the scans it recorded must keep pointing somewhere.
 * Switching a device back on also clears a PIN lockout — the organizer is the
 * person who can vouch for whoever is holding it.
 */
async function setDeviceActive(deviceId, isActive) {
  const patch = isActive
    ? { is_active: true, failed_pin_count: 0, pin_locked_until: null }
    : { is_active: false };
  const { data, error } = await supabase
    .from('scan_devices').update(patch).eq('id', deviceId)
    .select('id, is_active').single();
  if (error) throw new Error(error.message);
  return { id: data.id, isActive: data.is_active };
}

/**
 * A device signs in with its id and PIN and gets a token.
 *
 * The failure is deliberately uniform: a wrong PIN, a revoked device and a
 * locked one all look the same, so someone holding a lost tablet learns nothing
 * about which of them stopped them.
 *
 * After MAX_PIN_FAILURES wrong PINs the device refuses every PIN, right or
 * wrong, for PIN_LOCK_MINUTES. Counted per device in the database, so rotating
 * addresses no longer buys more guesses (utils/pinLockout.js).
 */
async function authenticateDevice({ deviceId, pin }) {
  const { data: device } = await supabase
    .from('scan_devices')
    .select('id, event_id, label, pin_hash, is_active, staff_id, pin_locked_until')
    .eq('id', deviceId)
    .maybeSingle();

  // A device that belongs to a door-team member is reached with that person's
  // account and never with a PIN — refused exactly like a revoked one.
  if (!device || !device.is_active || device.staff_id || isPinLocked(device)) {
    // Still spend the hash, so a revoked or locked device is not identifiable
    // by how quickly it is refused.
    await verifyPassword(String(pin || ''), 'pbkdf2$210000$AAAA$AAAA');
    return null;
  }

  const { ok } = await verifyPassword(String(pin || ''), device.pin_hash);
  if (!ok) {
    const { error } = await supabase.rpc('record_device_pin_failure', {
      p_device_id: device.id, p_max_failures: MAX_PIN_FAILURES, p_lock_minutes: PIN_LOCK_MINUTES,
    });
    if (error) logger.error({ err: error.message, deviceId: device.id }, 'PIN failure could not be counted');
    return null;
  }

  const short = isShortPin(pin);
  await supabase.from('scan_devices')
    .update({
      last_seen_at: new Date().toISOString(), failed_pin_count: 0, pin_locked_until: null,
      // What the organizer's Devices page reads to ask for a new PIN.
      pin_short: short,
    })
    .eq('id', device.id);

  // The right PIN, but one being retired: only whoever knew it learns this.
  if (shortPinRefused(pin)) return { pinTooShort: true };

  return {
    token: scanTokens.signDeviceToken({ deviceId: device.id, eventId: device.event_id }),
    device: { id: device.id, label: device.label, eventId: device.event_id },
    ...(short ? { pinNeedsReset: true } : {}),
  };
}

/**
 * The organizer sets a new PIN (routes/eventRoutes.js, behind verifyEventOwner
 * and NEW_PIN_PATTERN). A shared tablet's only: a door-team member's device is
 * reached with their account. Clears a lockout and the short-PIN flag. Tokens
 * already issued keep working until they expire or the device is revoked.
 */
async function setDevicePin({ eventId, deviceId, pin }) {
  const { data, error } = await supabase
    .from('scan_devices')
    .update({ pin_hash: await hashPassword(pin), pin_short: false, failed_pin_count: 0, pin_locked_until: null })
    .eq('id', deviceId).eq('event_id', eventId).is('staff_id', null)
    .select('id, label')
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? { id: data.id, label: data.label } : null;
}

/**
 * The device row behind a token, or null.
 *
 * Called on EVERY authenticated scan request, which is what makes revoking a
 * lost tablet take effect immediately instead of at its next sign-in seven days
 * later. See the note in middleware/deviceAuth.js.
 *
 * Null on a database error too, not a throw. The caller is middleware on
 * Express 4, where a rejected promise is an unhandled rejection and a hung
 * request; and the safe answer for a door that cannot check its own credentials
 * is "no".
 */
/**
 * Returned when the device could not be LOOKED UP (the database did not
 * answer), as opposed to looked up and found switched off. Both refuse the
 * request; only the second is an answer about the device. Under a door-opening
 * rush that saturated the database, treating the first as "revoked" sent every
 * phone a 401, which the app reads as "this door was closed" and leaves.
 */
const DEVICE_LOOKUP_FAILED = Object.freeze({ lookupFailed: true });

async function getActiveDevice(deviceId, { staffUserId = null } = {}) {
  if (!deviceId) return null;
  const { data, error } = await supabase
    .from('scan_devices')
    .select(`id, event_id, label, is_active, staff_id,
             event_staff ( user_id, revoked_at, profiles!event_staff_user_id_fkey ( is_blocked ) ),
             events ( organizers ( owner_user_id ) )`)
    .eq('id', deviceId)
    .maybeSingle();

  if (error) return DEVICE_LOOKUP_FAILED;
  if (!data || !data.is_active) return null;

  // The token and the row must agree about what kind of principal this is: a
  // PIN token cannot ride a person's device, and a person's token cannot ride
  // a shared tablet.
  if (Boolean(data.staff_id) !== Boolean(staffUserId)) return null;

  if (data.staff_id) {
    // A person is re-checked on every scan, like a device: removed from the
    // team, or their account blocked, and the next scan is refused.
    const staff = Array.isArray(data.event_staff) ? data.event_staff[0] : data.event_staff;
    const person = Array.isArray(staff?.profiles) ? staff.profiles[0] : staff?.profiles;
    if (!staff || staff.revoked_at || staff.user_id !== staffUserId || person?.is_blocked) return null;
  }

  /**
   * What this principal may SEE, decided here and never by the client:
   *   owner — the event's organizer, scanning their own door: everything.
   *   staff — a door-team member: the gate, plus whatever the organizer shares.
   *   pin   — a shared tablet: the same as staff.
   */
  const event = Array.isArray(data.events) ? data.events[0] : data.events;
  const organizer = Array.isArray(event?.organizers) ? event.organizers[0] : event?.organizers;
  let role = 'pin';
  if (staffUserId) role = organizer?.owner_user_id === staffUserId ? 'owner' : 'staff';

  return {
    id: data.id, eventId: data.event_id, label: data.label, staffUserId: staffUserId || null, role,
  };
}

/** Either gate credential — see scanTokens.js. */
function verifyDeviceToken(token) {
  return scanTokens.verifyScanToken(token);
}

/**
 * Scan one code.
 *
 * The signature is checked HERE, before the database: a forged code is rejected
 * without a round trip, which matters at a gate on a saturated network — and it
 * means a flood of junk codes cannot become a flood of queries.
 */
/**
 * How a check-in was taken, as the log records it. `scan` is a code read live,
 * `offline` one read with no signal and uploaded later, `manual` a ticket
 * picked from the door list. Anything else is the caller's default — never a
 * reason to refuse somebody at a door.
 */
const METHODS = new Set(['scan', 'manual', 'offline']);

async function scan({
  qr, deviceId, eventId, clientScanId, occurredAt,
  method = 'scan', offlineAdmitted = false,
}) {
  const decoded = decodeQrToken(qr);
  if (!decoded) {
    // A phone let somebody in, with no signal, on a code that is not ours. The
    // answer cannot change that; the organizer must at least be able to see it.
    if (offlineAdmitted === true) {
      await logForgedOffline({ qr, eventId, deviceId, clientScanId, occurredAt });
    }
    return { ok: false, result: 'invalid', message: 'That code was not issued by us.' };
  }

  // A valid ticket for ANOTHER event must not open this door. Without this, one
  // real ticket admits its holder to every event on the platform.
  if (decoded.eventId !== eventId) {
    return { ok: false, result: 'wrong_event', message: 'That ticket is for a different event.' };
  }

  // v2 also checks the event in the database (T-054), the code's version
  // against the ticket's (T-016), and the order still being paid (T-023).
  const { data, error } = await supabase.rpc('check_in_ticket_v2', {
    p_event_id: eventId,
    p_ticket_id: decoded.ticketId,
    p_qr_version: decoded.version,
    p_device_id: deviceId,
    p_client_scan_id: clientScanId || null,
    p_occurred_at: occurredAt || null,
    p_method: METHODS.has(method) ? method : 'scan',
    p_offline_admitted: offlineAdmitted === true,
  });

  // The database did not answer: not a decision. `unavailable` lets the live
  // routes answer 503 (the door holds the scan); in an upload the row says
  // 'error' and the phone sends it again without counting it as an attempt.
  // The database's own words stay in the log, not in the door's answer.
  if (error) {
    logger.warn({ err: error.message, eventId, deviceId }, 'scan: the check-in function did not answer');
    return { ok: false, result: 'error', message: UNAVAILABLE_MESSAGE, unavailable: true };
  }
  return withAddons(data, decoded.ticketId);
}

const UNAVAILABLE_MESSAGE = 'The check-in server could not decide this scan. It is sent again shortly.';

/**
 * Logged as a refusal and flagged as a conflict on the ticket the code NAMES,
 * when that ticket is at this event: the organizer then finds it in the door
 * list's conflicts and in the ticket's history. Nothing else is trusted from
 * the code (its claims are unverified). Best effort, and idempotent on the
 * scan id: a re-upload writes nothing new.
 */
async function logForgedOffline({ qr, eventId, deviceId, clientScanId, occurredAt }) {
  try {
    const parts = String(qr || '').split('.');
    if (parts.length !== 3) return;
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    const ticketId = typeof claims?.tid === 'string' && UUID_RE.test(claims.tid) ? claims.tid : null;
    if (!ticketId) return;
    const { data: ticket } = await supabase.from('tickets').select('id')
      .eq('id', ticketId).eq('event_id', eventId).maybeSingle();
    if (!ticket) return;
    const when = occurredAt && !Number.isNaN(Date.parse(occurredAt)) ? occurredAt : new Date().toISOString();
    const { error } = await supabase.from('scans').insert({
      ticket_id: ticket.id, event_id: eventId, device_id: deviceId, result: 'invalid',
      occurred_at: when, method: 'offline', conflict: true,
      client_scan_id: typeof clientScanId === 'string' && clientScanId ? clientScanId : null,
      detail: 'admitted offline on a code that was not issued by us (forged or altered)',
    });
    // 23505: this scan was already logged by an earlier upload.
    if (error && error.code !== '23505') throw new Error(error.message);
    logger.warn({ eventId, deviceId, ticketId: ticket.id }, 'scan: a code that is not ours was admitted offline');
  } catch (err) {
    logger.warn({ err: err.message, eventId, deviceId }, 'scan: could not log a forged offline admission');
  }
}

/**
 * What this device has been TOLD about the gate (scan_devices.gate_lock_seen_at).
 * A shut gate only exempts an offline admission the device made before it was
 * told (check_in_ticket_v2), so every answer that carries the gate's state —
 * the status poll, `me`, the offline list — records it. Never throws: a
 * failure here must not turn into a failed status poll at a door.
 */
async function noteGateSeen(deviceId, locked) {
  if (!deviceId || typeof locked !== 'boolean') return;
  try {
    const { error } = await supabase.rpc('note_gate_seen', { p_device_id: deviceId, p_locked: locked });
    if (error) throw new Error(error.message);
  } catch (err) {
    logger.warn({ err: err.message, deviceId }, 'gate: could not record what the device was told');
  }
}

/**
 * The ticket's add-ons on the door's answer (2026-11-17): staff see at the
 * scan that this guest has "Photo with the headliner" to collect. Only for a
 * real ticket (admitted, or already in). Best effort, always: a lookup that
 * fails must never turn an admission into a refusal at the door.
 */
async function withAddons(data, ticketId) {
  if (!data || !['admitted', 'duplicate'].includes(data.result)) return data;
  try {
    const names = (await require('./addonService').namesForTickets([ticketId])).get(ticketId) || [];
    return names.length ? { ...data, addons: names } : data;
  } catch (err) {
    logger.warn({ err: err.message, ticketId }, 'scan: could not read the ticket add-ons');
    return data;
  }
}

/**
 * Reverses an admission at this device's own event. A ticket at another event
 * comes back as `not_found` — a device has no business learning it exists.
 */
async function undo({ ticketId, deviceId, eventId }) {
  const { data, error } = await supabase.rpc('undo_check_in_v2', {
    p_event_id: eventId, p_ticket_id: ticketId, p_device_id: deviceId,
  });
  if (error) {
    logger.warn({ err: error.message, eventId, deviceId }, 'undo: the check-in function did not answer');
    return { ok: false, result: 'error', message: 'That could not be undone right now. Try again in a moment.' };
  }
  return data;
}

/**
 * Uploads a queue of scans taken while offline.
 *
 * Each scan is its own call rather than one statement: a single bad row must
 * not reject the other 200, and each needs its own answer so the device can
 * show the operator which of their scans were duplicates.
 *
 * Several at once, not one at a time. A tablet reconnecting after a busy
 * offline hour sent 500 sequential calls and could time out before the queue
 * landed. Scans of the SAME code stay in queue order, one after another, so
 * which of two scans admitted the guest does not depend on a race.
 *
 * Every entry carries a client-generated id, so uploading the same queue twice
 * is a no-op rather than 200 duplicate refusals.
 */
const SYNC_CONCURRENCY = 8;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Which device took each scan, when the phone says it was not the one
 * uploading (a colleague signed in on the same phone before the signal came
 * back). Only devices of THIS event count: anything else is ignored and the
 * scan stays with the uploader, as before.
 */
async function sameEventDevices(eventId, scans, uploaderId) {
  const claimed = [...new Set(scans
    .map((s) => s?.scannedByDeviceId)
    .filter((id) => typeof id === 'string' && UUID_RE.test(id) && id !== uploaderId))];
  if (claimed.length === 0) return new Set();
  const { data, error } = await supabase.from('scan_devices').select('id').eq('event_id', eventId).in('id', claimed);
  if (error) {
    logger.warn({ err: error.message }, 'scan attribution: device lookup failed; scans stay with the uploader');
    return new Set();
  }
  return new Set((data || []).map((d) => d.id));
}

/**
 * Put a scan back under the device that took it, after the decision is made
 * (check_in_ticket_v2 is untouched). Only the row this upload just wrote
 * (still under the uploader, no uploader recorded yet): a replay changes
 * nothing. A failure here never fails the upload — the admission stands, only
 * the attribution is left as it was.
 */
async function attribute({ eventId, clientScanId, uploaderId, scannedBy }) {
  const { error } = await supabase.from('scans')
    .update({ device_id: scannedBy, uploaded_by_device_id: uploaderId })
    .eq('event_id', eventId)
    .eq('client_scan_id', clientScanId)
    .eq('device_id', uploaderId)
    .is('uploaded_by_device_id', null);
  if (error) logger.warn({ err: error.message }, 'scan attribution: update failed; scan stays with the uploader');
}

async function syncBatch({ deviceId, eventId, scans }) {
  const queue = scans.slice(0, 500);
  const others = await sameEventDevices(eventId, queue, deviceId);
  const byCode = new Map();
  queue.forEach((s, index) => {
    const code = String(s?.qr || '');
    if (!byCode.has(code)) byCode.set(code, []);
    byCode.get(code).push(index);
  });

  const results = new Array(queue.length);
  await mapLimit([...byCode.values()], SYNC_CONCURRENCY, async (indexes) => {
    for (const index of indexes) {
      const s = queue[index];
      // eslint-disable-next-line no-await-in-loop
      const r = await scan({
        qr: s.qr, deviceId, eventId,
        clientScanId: s.clientScanId, occurredAt: s.occurredAt,
        // A queue is, by definition, scans taken without a connection. The
        // native app also says whether it already let the person in, which is
        // what turns a late duplicate into a flagged conflict.
        method: METHODS.has(s.method) ? s.method : 'offline',
        offlineAdmitted: s.offlineVerdict === 'admitted',
      });
      if (others.has(s.scannedByDeviceId) && typeof s.clientScanId === 'string' && s.clientScanId) {
        // eslint-disable-next-line no-await-in-loop
        await attribute({ eventId, clientScanId: s.clientScanId, uploaderId: deviceId, scannedBy: s.scannedByDeviceId });
      }
      results[index] = { clientScanId: s.clientScanId, ...r };
    }
  });
  return results;
}

async function gateStatus(eventId) {
  const [{ data: lock }, { data: stats }] = await Promise.all([
    supabase.rpc('scanner_is_locked', { p_event_id: eventId }),
    supabase.rpc('event_checkin_stats', { p_event_id: eventId }),
  ]);
  return { gate: lock, stats };
}

module.exports = {
  registerDevice, listDevices, setDeviceActive, setDevicePin,
  authenticateDevice, verifyDeviceToken, getActiveDevice, DEVICE_LOOKUP_FAILED,
  scan, undo, syncBatch, gateStatus, noteGateSeen,
};
