const { supabase } = require('../config/supabase');
const scanSvc = require('./scanService');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * What the check-in app reads about its door, beyond scanning: who it is, the
 * recent arrivals, the guest list, one ticket's history, and the analytics.
 *
 * PERMISSIONS ARE DECIDED HERE, from the device's role (middleware/deviceAuth)
 * and the organizer's door settings — never from anything the app sends.
 *
 *   owner                     everything for their event
 *   staff / pin, by default   counts, the gate, recent arrivals with names
 *                             shortened ("Sara A."), and the scan answer for
 *                             the person standing in front of them
 *   staff / pin, guest list   + search, manual check-in, full names
 *     shared by the organizer
 *
 * The default is the door team's position before this app existed — "scan,
 * undo, gate status; no attendee list" (staffService.js) — so installing the
 * app widens nobody's access until the organizer chooses to.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const SETTINGS_DEFAULTS = Object.freeze({
  doorTeamCanViewGuests: false,
  offlineAdmission: true,
  offlineShowNames: false,
  legacyQrOffline: 'allow',
});

function shapeSettings(row) {
  if (!row) return { ...SETTINGS_DEFAULTS };
  return {
    doorTeamCanViewGuests: row.door_team_can_view_guests,
    offlineAdmission: row.offline_admission,
    offlineShowNames: row.offline_show_names,
    legacyQrOffline: row.legacy_qr_offline,
  };
}

async function getSettings(eventId) {
  const { data, error } = await supabase
    .from('event_gate_settings')
    .select('door_team_can_view_guests, offline_admission, offline_show_names, legacy_qr_offline')
    .eq('event_id', eventId)
    .maybeSingle();
  if (error) throw new Error(`could not read door settings: ${error.message}`);
  return shapeSettings(data);
}

/** Organizer only (eventRoutes, behind verifyEventOwner). A partial patch. */
async function updateSettings(eventId, patch, userId) {
  const current = await getSettings(eventId);
  const next = { ...current };
  for (const key of Object.keys(SETTINGS_DEFAULTS)) {
    if (patch[key] !== undefined) next[key] = patch[key];
  }
  const { data, error } = await supabase
    .from('event_gate_settings')
    .upsert({
      event_id: eventId,
      door_team_can_view_guests: next.doorTeamCanViewGuests,
      offline_admission: next.offlineAdmission,
      offline_show_names: next.offlineShowNames,
      legacy_qr_offline: next.legacyQrOffline,
      updated_at: new Date().toISOString(),
      updated_by: userId || null,
    }, { onConflict: 'event_id' })
    .select('door_team_can_view_guests, offline_admission, offline_show_names, legacy_qr_offline')
    .single();
  if (error) throw new Error(`could not save door settings: ${error.message}`);
  return shapeSettings(data);
}

function permissionsFor(device, settings) {
  const owner = device.role === 'owner';
  const guests = owner || settings.doorTeamCanViewGuests;
  return {
    viewGuests: guests,
    manualCheckIn: guests,
    fullNames: guests,
    analytics: true,
    offlineAdmission: settings.offlineAdmission,
    offlineNames: settings.offlineAdmission && (owner || settings.offlineShowNames),
  };
}

/**
 * "Sara Ahmed" → "Sara A." Enough for the person at the door to recognise a
 * guest they just let in; not a guest list for anyone holding the tablet.
 */
function shortName(name) {
  if (!name) return null;
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] || null;
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

const nameFor = (perms) => (name) => (perms.fullNames ? name || null : shortName(name));

// ─── Who am I ────────────────────────────────────────────────────────────────
/**
 * The app's first call after it has a door token: the event, this device, what
 * it may do, and the gate's state — one round trip to draw the dashboard.
 */
async function me(device) {
  const [settings, { data: event, error }, gate] = await Promise.all([
    getSettings(device.eventId),
    supabase.from('events')
      .select('id, title, slug, status, starts_at, ends_at, timezone, venue_name, venue_address, city, cover_url')
      .eq('id', device.eventId)
      .maybeSingle(),
    scanSvc.gateStatus(device.eventId),
  ]);
  if (error) throw new Error(error.message);

  return {
    device: { id: device.deviceId, label: device.label, kind: device.staffUserId ? 'staff' : 'pin' },
    role: device.role,
    event: event && {
      id: event.id,
      title: event.title,
      slug: event.slug,
      status: event.status,
      startsAt: event.starts_at,
      endsAt: event.ends_at,
      timezone: event.timezone,
      venue: event.venue_name,
      address: event.venue_address,
      city: event.city,
      coverUrl: event.cover_url,
    },
    permissions: permissionsFor(device, settings),
    settings,
    gate: gate.gate,
    stats: gate.stats,
  };
}

// ─── Recent arrivals ─────────────────────────────────────────────────────────
async function recent(device, { limit = 20, before = null, admittedOnly = true } = {}) {
  const perms = permissionsFor(device, await getSettings(device.eventId));
  const { data, error } = await supabase.rpc('event_recent_scans', {
    p_event_id: device.eventId,
    p_limit: limit,
    p_before: before,
    p_admitted_only: admittedOnly,
  });
  if (error) throw new Error(error.message);
  const name = nameFor(perms);
  return (data || []).map((r) => ({ ...r, holder: name(r.holder) }));
}

// ─── The guest list ──────────────────────────────────────────────────────────
/** LIKE wildcards and the escape are stripped: a search box is not a pattern. */
function safeQuery(q) {
  return String(q || '').replace(/[%_\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
}

async function attendees(device, { q = '', status = 'all', limit = 50, offset = 0 } = {}) {
  const perms = permissionsFor(device, await getSettings(device.eventId));
  if (!perms.viewGuests) return null;

  const { data, error } = await supabase.rpc('event_door_list', {
    p_event_id: device.eventId,
    p_q: safeQuery(q) || null,
    p_status: status,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw new Error(error.message);
  return { total: data?.total || 0, rows: data?.rows || [], limit, offset };
}

// ─── One ticket ──────────────────────────────────────────────────────────────
async function ticket(device, ticketId) {
  const perms = permissionsFor(device, await getSettings(device.eventId));
  const { data, error } = await supabase.rpc('ticket_door_detail', {
    p_event_id: device.eventId, p_ticket_id: ticketId,
  });
  if (error) throw new Error(error.message);
  if (!data) return null;
  return { ...data, holder: nameFor(perms)(data.holder) };
}

/**
 * A guest picked from the list rather than scanned — a dead phone, a cracked
 * screen, a printout that will not read. The same admission function, with no
 * code presented, so the code-version check is answered with the ticket's own
 * version: a person found by name is not holding an old screenshot.
 */
async function manualCheckIn(device, { ticketId, clientScanId = null }) {
  const perms = permissionsFor(device, await getSettings(device.eventId));
  if (!perms.manualCheckIn) return { forbidden: true };

  const { data: row, error: readError } = await supabase
    .from('tickets').select('id, qr_version')
    .eq('id', ticketId).eq('event_id', device.eventId)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!row) return { ok: false, result: 'not_found', message: 'That ticket is not for this event.' };

  const { data, error } = await supabase.rpc('check_in_ticket_v2', {
    p_event_id: device.eventId,
    p_ticket_id: row.id,
    p_qr_version: row.qr_version,
    p_device_id: device.deviceId,
    p_client_scan_id: clientScanId || null,
    p_occurred_at: null,
    p_method: 'manual',
    p_offline_admitted: false,
  });
  if (error) return { ok: false, result: 'error', message: error.message, unavailable: true };
  return data;
}

// ─── Analytics ───────────────────────────────────────────────────────────────
async function analytics(device, { bucketMinutes = 15 } = {}) {
  const { data, error } = await supabase.rpc('event_checkin_analytics', {
    p_event_id: device.eventId, p_bucket_minutes: bucketMinutes,
  });
  if (error) throw new Error(error.message);
  return data;
}

// ─── The event picker's counts ───────────────────────────────────────────────
async function summaries(eventIds) {
  if (!eventIds.length) return {};
  const { data, error } = await supabase.rpc('event_checkin_summaries', { p_event_ids: eventIds });
  if (error) throw new Error(error.message);
  return data || {};
}

// ─── The offline list ────────────────────────────────────────────────────────
/**
 * The event's tickets for a phone to decide from with no signal (offline
 * admission, docs/CHECKIN-APP-API.md §7). The phone calls with the cursor it
 * was last given, page after page, until `done`, and keeps the final cursor
 * for next time:
 *
 *   no cursor            every ticket, `reset: true` (replace what you have)
 *   a cursor             only what changed since the last complete run
 *
 * "Since" is the database's clock at the START of the previous run, less
 * OVERLAP_MS: a check-in committed a moment after that run read past it is
 * sent again rather than missed. Rows are idempotent on the phone, so
 * sending one twice costs nothing.
 *
 * The cursor also records whether the list carried names. When the organizer
 * changes "include names offline", the next call starts over with `reset`, so
 * names appear, or are wiped, everywhere.
 */
const MANIFEST_PAGE = 1000;
const MANIFEST_OVERLAP_MS = 30_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const encodeCursor = (c) => Buffer.from(JSON.stringify(c)).toString('base64url');

/** Null for anything that is not a cursor this server wrote: the phone then gets a fresh list. */
function decodeCursor(raw) {
  if (!raw) return null;
  try {
    const c = JSON.parse(Buffer.from(String(raw), 'base64url').toString('utf8'));
    const time = (s) => s === null || (typeof s === 'string' && !Number.isNaN(Date.parse(s)));
    if (!c || c.k !== 1 || typeof c.n !== 'boolean') return null;
    if (!time(c.s) || !time(c.w)) return null;
    if (c.a !== null && !(Array.isArray(c.a) && c.a.length === 2 && time(c.a[0]) && c.a[0] && UUID_RE.test(c.a[1]))) return null;
    return c;
  } catch {
    return null;
  }
}

async function manifest(device, { cursor = null, limit = MANIFEST_PAGE } = {}) {
  const settings = await getSettings(device.eventId);
  const perms = permissionsFor(device, settings);
  if (!perms.offlineAdmission) return { off: true };

  let c = decodeCursor(cursor);
  const reset = !c || c.n !== perms.offlineNames;
  if (reset) c = { k: 1, s: null, a: null, w: null, n: perms.offlineNames };

  const [list, eventRead, gate] = await Promise.all([
    supabase.rpc('event_door_manifest', {
      p_event_id: device.eventId,
      p_since: c.s,
      p_after_at: c.a ? c.a[0] : null,
      p_after_id: c.a ? c.a[1] : null,
      p_limit: limit,
      p_names: perms.offlineNames,
    }),
    supabase.from('events').select('status, starts_at, ends_at').eq('id', device.eventId).maybeSingle(),
    supabase.rpc('scanner_is_locked', { p_event_id: device.eventId }),
  ]);
  if (list.error) throw new Error(`could not read the offline list: ${list.error.message}`);
  if (eventRead.error) throw new Error(eventRead.error.message);

  const rows = list.data?.rows || [];
  // Fixed on the first page of a run and carried through its other pages.
  const watermark = c.w || new Date(Date.parse(list.data.now) - MANIFEST_OVERLAP_MS).toISOString();
  const done = rows.length < limit;
  const last = rows[rows.length - 1];
  const next = done
    ? { k: 1, s: watermark, a: null, w: null, n: c.n }
    : { k: 1, s: c.s, a: [last.updatedAt, last.ticketId], w: watermark, n: c.n };

  return {
    // updatedAt only steers the paging; the phone has no use for it.
    rows: rows.map(({ updatedAt, ...row }) => row),
    cursor: encodeCursor(next),
    done,
    reset,
    names: perms.offlineNames,
    event: eventRead.data && {
      status: eventRead.data.status, startsAt: eventRead.data.starts_at, endsAt: eventRead.data.ends_at,
    },
    gateLocked: Boolean(gate?.data?.locked),
    // Why, so a phone refusing with no signal says what the server would.
    gateReason: gate?.data?.locked ? gate.data.reason || null : null,
    legacyQrOffline: settings.legacyQrOffline,
    serverTime: list.data.now,
  };
}

module.exports = {
  SETTINGS_DEFAULTS, getSettings, updateSettings, permissionsFor, shortName, safeQuery,
  me, recent, attendees, ticket, manualCheckIn, analytics, summaries, manifest,
};
