const { supabase } = require('../config/supabase');
const { hashPassword, verifyPassword } = require('../utils/crypto');
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
const { DEVICE_TOKEN_TYPE } = scanTokens;

async function registerDevice({ eventId, label, pin }) {
  const { data, error } = await supabase
    .from('scan_devices')
    .insert({ event_id: eventId, label: String(label).trim(), pin_hash: await hashPassword(pin) })
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
    .select('id, label, is_active, last_seen_at, created_at')
    .eq('event_id', eventId)
    .is('staff_id', null)
    .order('created_at');
  return (data || []).map((d) => ({
    id: d.id, label: d.label, isActive: d.is_active,
    lastSeenAt: d.last_seen_at, createdAt: d.created_at,
  }));
}

/** Revoking is a flag, not a delete: the scans it recorded must keep pointing somewhere. */
async function setDeviceActive(deviceId, isActive) {
  const { data, error } = await supabase
    .from('scan_devices').update({ is_active: isActive }).eq('id', deviceId)
    .select('id, is_active').single();
  if (error) throw new Error(error.message);
  return { id: data.id, isActive: data.is_active };
}

/**
 * A device signs in with its id and PIN and gets a token.
 *
 * The failure is deliberately uniform: a wrong PIN and a revoked device look
 * the same, so someone holding a lost tablet learns nothing about whether it
 * was the PIN or the revocation that stopped them.
 */
async function authenticateDevice({ deviceId, pin }) {
  const { data: device } = await supabase
    .from('scan_devices')
    .select('id, event_id, label, pin_hash, is_active, staff_id')
    .eq('id', deviceId)
    .maybeSingle();

  // A device that belongs to a door-team member is reached with that person's
  // account and never with a PIN — refused exactly like a revoked one.
  if (!device || !device.is_active || device.staff_id) {
    // Still spend the hash, so a revoked device is not identifiable by how
    // quickly it is refused.
    await verifyPassword(String(pin || ''), 'pbkdf2$210000$AAAA$AAAA');
    return null;
  }

  const { ok } = await verifyPassword(String(pin || ''), device.pin_hash);
  if (!ok) return null;

  await supabase.from('scan_devices')
    .update({ last_seen_at: new Date().toISOString() }).eq('id', device.id);

  return {
    token: scanTokens.signDeviceToken({ deviceId: device.id, eventId: device.event_id }),
    device: { id: device.id, label: device.label, eventId: device.event_id },
  };
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
async function getActiveDevice(deviceId, { staffUserId = null } = {}) {
  if (!deviceId) return null;
  const { data, error } = await supabase
    .from('scan_devices')
    .select(`id, event_id, label, is_active, staff_id,
             event_staff ( user_id, revoked_at, profiles!event_staff_user_id_fkey ( is_blocked ) )`)
    .eq('id', deviceId)
    .maybeSingle();

  if (error || !data || !data.is_active) return null;

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

  return { id: data.id, eventId: data.event_id, label: data.label, staffUserId: staffUserId || null };
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
async function scan({ qr, deviceId, eventId, clientScanId, occurredAt }) {
  const decoded = decodeQrToken(qr);
  if (!decoded) {
    return { ok: false, result: 'invalid', message: 'That code was not issued by us.' };
  }

  // A valid ticket for ANOTHER event must not open this door. Without this, one
  // real ticket admits its holder to every event on the platform.
  if (decoded.eventId !== eventId) {
    return { ok: false, result: 'wrong_event', message: 'That ticket is for a different event.' };
  }

  const { data, error } = await supabase.rpc('check_in_ticket', {
    p_ticket_id: decoded.ticketId,
    p_device_id: deviceId,
    p_client_scan_id: clientScanId || null,
    p_occurred_at: occurredAt || null,
  });

  if (error) return { ok: false, result: 'error', message: error.message };
  return data;
}

/**
 * Uploads a queue of scans taken while offline.
 *
 * Processed one at a time rather than in one statement: a single bad row must
 * not reject the other 200, and each needs its own answer so the device can
 * show the operator which of their scans were duplicates.
 *
 * Every entry carries a client-generated id, so uploading the same queue twice
 * is a no-op rather than 200 duplicate refusals.
 */
async function syncBatch({ deviceId, eventId, scans }) {
  const results = [];
  for (const s of scans.slice(0, 500)) {
    // eslint-disable-next-line no-await-in-loop
    const r = await scan({
      qr: s.qr, deviceId, eventId,
      clientScanId: s.clientScanId, occurredAt: s.occurredAt,
    });
    results.push({ clientScanId: s.clientScanId, ...r });
  }
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
  registerDevice, listDevices, setDeviceActive,
  authenticateDevice, verifyDeviceToken, getActiveDevice,
  scan, syncBatch, gateStatus,
  DEVICE_TOKEN_TYPE,
};
