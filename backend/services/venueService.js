const { supabase } = require('../config/supabase');
const { hashTablePassword } = require('./tableAccessService');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Building and editing the venue map.
 *
 * The organizer draws tables; this turns them into sellable stock. Each table
 * gets `seatCount` seats generated for it, numbered 1..n, and those seats are
 * what `hold_seats` and `hold_table` actually move.
 *
 * THE RULE THAT SHAPES EVERYTHING HERE: stock that is held or sold is not
 * editable. Not "we try not to" — a save that would remove or shrink a table
 * someone has already paid for is refused outright. Losing a seat that has a
 * ticket against it means somebody arrives at the venue with a valid QR code
 * for a chair that no longer exists in the system.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const MAX_TABLES = 400;
const MAX_SEATS_PER_TABLE = 60;

// Each new password is a 210k-iteration PBKDF2 on the libuv pool that login
// and checkout share. A 400-table save with a password on every table was
// minutes of that pool, from one request, with no cap on how long each
// password could be.
const MAX_TABLE_PASSWORD_LENGTH = 64;
const MAX_NEW_PASSWORDS_PER_SAVE = 50;

/** The map as the organizer's editor needs it — including private tables. */
async function getMapForOrganizer(eventId) {
  const { data: map } = await supabase
    .from('venue_maps')
    .select('id, layout_json, version, updated_at')
    .eq('event_id', eventId)
    .maybeSingle();

  if (!map) return null;

  const { data: tables } = await supabase
    .from('tables')
    .select('id, label, seat_count, price_cents, is_private, password_hash, status, position_x, position_y, rotation, shape, category_id')
    .eq('venue_map_id', map.id)
    .order('label');

  const { data: seats } = await supabase
    .from('seats')
    .select('id, table_id, tier_id, section_key, row_label, seat_number, price_override_cents, status')
    .eq('venue_map_id', map.id);

  return {
    id: map.id,
    layout: map.layout_json,
    version: map.version,
    updatedAt: map.updated_at,
    tables: (tables || []).map((t) => ({
      id: t.id,
      label: t.label,
      seatCount: t.seat_count,
      priceCents: t.price_cents,
      isPrivate: t.is_private,
      // The hash never leaves the server, but the organizer needs to know
      // whether a password is set — otherwise the editor cannot tell "no
      // password yet" from "unchanged".
      hasPassword: !!t.password_hash,
      status: t.status,
      position: { x: Number(t.position_x), y: Number(t.position_y), rotation: Number(t.rotation) },
      shape: t.shape,
      categoryId: t.category_id,
      seats: (seats || [])
        .filter((s) => s.table_id === t.id)
        .map(shapeSeat),
    })),
    // Seats not attached to a table — general rows.
    looseSeats: (seats || []).filter((s) => !s.table_id).map(shapeSeat),
  };
}

function shapeSeat(s) {
  return {
    id: s.id,
    tierId: s.tier_id,
    section: s.section_key,
    row: s.row_label,
    number: s.seat_number,
    priceOverrideCents: s.price_override_cents,
    status: s.status,
  };
}

/**
 * Replaces the map.
 *
 * Deliberately NOT a diff-and-patch. The editor sends the whole layout, and
 * working out which of a hundred tables moved is exactly the kind of merge that
 * goes wrong quietly. Instead: anything the organizer still lists is updated or
 * created, anything they dropped is deleted — and every one of those deletions
 * is checked against live stock first.
 *
 * @param {string} eventId
 * @param {object} payload  { layout, tables: [...] }
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function saveMap(eventId, payload) {
  const incoming = Array.isArray(payload.tables) ? payload.tables : [];

  if (incoming.length > MAX_TABLES) {
    throw fail('VALIDATION_ERROR', `A map can hold at most ${MAX_TABLES} tables.`);
  }

  // BRD §12 — a listing-only event sells nothing, so it has no stock to draw.
  const { data: event } = await supabase
    .from('events').select('listing_type').eq('id', eventId).maybeSingle();
  if (event?.listing_type === 'display_only') {
    throw fail('VALIDATION_ERROR', 'This event is listed for information only. Make it a ticketed event before drawing a seat map.');
  }
  const labels = new Set();
  for (const t of incoming) {
    const label = String(t.label || '').trim();
    if (!label) throw fail('VALIDATION_ERROR', 'Every table needs a label.');
    if (labels.has(label.toLowerCase())) {
      throw fail('VALIDATION_ERROR', `Two tables are both called "${label}". Labels must be unique.`);
    }
    labels.add(label.toLowerCase());

    const count = Number(t.seatCount);
    if (!Number.isInteger(count) || count < 1 || count > MAX_SEATS_PER_TABLE) {
      throw fail('VALIDATION_ERROR', `"${label}" must have between 1 and ${MAX_SEATS_PER_TABLE} seats.`);
    }
    if (t.isPrivate && !t.password && !t.id) {
      throw fail('VALIDATION_ERROR', `"${label}" is private, so it needs a password.`);
    }
    if (t.password && String(t.password).length > MAX_TABLE_PASSWORD_LENGTH) {
      throw fail('VALIDATION_ERROR',
        `The password for "${label}" is longer than ${MAX_TABLE_PASSWORD_LENGTH} characters.`);
    }
    // Shape only. Whether each id belongs to THIS event is the database's call
    // (`save_venue_map`), inside the transaction that uses it.
    for (const key of ['id', 'tierId', 'categoryId']) {
      if (t[key] && !UUID.test(String(t[key]))) {
        throw fail('VALIDATION_ERROR', `"${label}" carries an invalid ${key}.`);
      }
    }
  }

  const newPasswords = incoming.filter((t) => t.password).length;
  if (newPasswords > MAX_NEW_PASSWORDS_PER_SAVE) {
    throw fail('VALIDATION_ERROR',
      `Set at most ${MAX_NEW_PASSWORDS_PER_SAVE} new table passwords in one save. Save these, then set the rest.`);
  }

  /**
   * Hashed HERE, then handed to the database already hashed.
   *
   * Password hashing is PBKDF2 on the libuv pool — it belongs in Node, not in a
   * plpgsql loop. The function receives `passwordHash`, never a password.
   */
  const prepared = [];
  for (const t of incoming) {
    prepared.push({
      id: t.id || null,
      label: String(t.label).trim(),
      seatCount: Number(t.seatCount),
      priceCents: t.priceCents === null || t.priceCents === undefined ? null : Number(t.priceCents),
      isPrivate: !!t.isPrivate,
      // Only when a new password was actually typed. Sending the editor's state
      // back without one must not silently unprotect a table.
      // eslint-disable-next-line no-await-in-loop
      passwordHash: t.password ? await hashTablePassword(String(t.password)) : null,
      // The explicit way to remove protection, so "absent" and "remove" are
      // different instructions rather than the same one.
      clearPassword: t.isPrivate === false,
      position: {
        x: Number(t.position?.x ?? 0),
        y: Number(t.position?.y ?? 0),
        rotation: Number(t.position?.rotation ?? 0),
      },
      shape: t.shape || 'round',
      categoryId: t.categoryId || null,
      tierId: t.tierId || null,
      seatPriceCents: t.seatPriceCents ?? null,
    });
  }

  /**
   * ONE transaction.
   *
   * This was a loop of separate statements from here: delete the removed tables
   * one by one, then upsert the rest one by one, each its own transaction. A
   * network blip halfway left the map HALF SAVED — some tables gone, some
   * updated, some untouched — with no way to tell which and no way back. For an
   * organizer laying out a 200-table room, that is their whole afternoon.
   */
  const { data: result, error } = await supabase.rpc('save_venue_map', {
    p_event_id: eventId,
    p_layout: payload.layout || {},
    p_tables: prepared,
  });

  if (error) {
    /**
     * A refusal RAISEs, so the transaction unwinds.
     *
     * It used to return `{ ok: false }` — and a plpgsql RETURN is not a
     * rollback. The refusal committed everything the function had already
     * done: the layout, the deletions, the tables the loop had reached. The
     * map save was refused and half applied at the same time.
     */
    const m = /MAP_CONFLICT:\s*(.*)/.exec(error.message);
    if (m) throw fail('CONFLICT', `${m[1].trim()}.`);
    // A ticket type or category from another event.
    const v = /MAP_INVALID:\s*(.*)/.exec(error.message);
    if (v) throw fail('VALIDATION_ERROR', `${v[1].trim()}.`);
    throw fail('VALIDATION_ERROR', error.message);
  }

  return { mapId: result.map_id, tables: result.tables, version: result.version };
}

// upsertTable, resizeTable, generateSeats and seatRow used to live here.
// They are now the body of `save_venue_map`, because doing that work from
// Node meant one transaction per table and a half-written map on any failure.

function fail(code, message) {
  return Object.assign(new Error(message), { code });
}

module.exports = { getMapForOrganizer, saveMap, MAX_TABLES, MAX_SEATS_PER_TABLE };
