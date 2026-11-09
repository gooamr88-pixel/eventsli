const { supabase } = require('../config/supabase');
const { hashTablePassword } = require('./tableAccessService');
const { fetchAll } = require('../utils/fetchAll');
const { sanitizeLayout } = require('./venueStudio');

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
  const { data: map, error: mapError } = await supabase
    .from('venue_maps')
    .select('id, layout_json, version, updated_at')
    .eq('event_id', eventId)
    .maybeSingle();
  // A failed read must not look like "no map yet": the editor would offer a
  // blank room to draw, and saving it would replace the real one.
  if (mapError) throw new Error(`could not read the venue map: ${mapError.message}`);

  if (!map) return null;

  const tables = await fetchAll(({ from, to }, first) => supabase
    .from('tables')
    .select('id, label, seat_count, price_cents, is_private, password_hash, status, position_x, position_y, rotation, shape, category_id, tier_id, seat_price_cents, section_name, row_name',
      first ? { count: 'exact' } : undefined)
    .eq('venue_map_id', map.id)
    .order('label')
    .order('id')
    .range(from, to), { what: 'tables' });

  // Every seat, in pages — one request stopped at 1,000 (utils/fetchAll.js).
  const seats = await fetchAll(({ from, to }, first) => supabase
    .from('seats')
    .select('id, table_id, tier_id, section_key, row_label, seat_number, price_override_cents, status',
      first ? { count: 'exact' } : undefined)
    .eq('venue_map_id', map.id)
    .order('id')
    .range(from, to), { what: 'seats' });

  // Grouped once. A `seats.filter` per table was tables × seats comparisons —
  // nine million on a 400-row, 24,000-seat room, on every load and every save.
  const seatsByTable = new Map();
  for (const s of seats) {
    const key = s.table_id || null;
    if (!seatsByTable.has(key)) seatsByTable.set(key, []);
    seatsByTable.get(key).push(s);
  }

  return {
    id: map.id,
    layout: map.layout_json,
    version: map.version,
    updatedAt: map.updated_at,
    tables: tables.map((t) => ({
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
      // The TABLE's ticket type and seat price (TECH-AUDIT-LOG S-02). The editor
      // used to infer them from the first seat, in id order — after a partial
      // sale that could be a sold seat of the old type, and the next save put
      // the old type back on every available seat.
      tierId: t.tier_id,
      seatPriceCents: t.seat_price_cents === null ? null : Number(t.seat_price_cents),
      // S-19: the section and row this table's seats are addressed by, if any.
      section: t.section_name,
      row: t.row_name,
      seats: (seatsByTable.get(t.id) || []).map(shapeSeat),
    })),
    // Seats not attached to a table — general rows.
    looseSeats: (seatsByTable.get(null) || []).map(shapeSeat),
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

async function saveMap(eventId, payload, { actorId = null } = {}) {
  const incoming = Array.isArray(payload.tables) ? payload.tables : [];

  if (incoming.length > MAX_TABLES) {
    throw fail('VALIDATION_ERROR', `A map can hold at most ${MAX_TABLES} tables.`);
  }

  // Which events may have a map at all — listing-only (BRD §12), general
  // admission, cancelled or completed — is decided by `save_venue_map`, inside
  // the transaction. It was a lookup here whose error was ignored, so a failed
  // read let a listing-only event's map through (TECH-AUDIT-LOG S-17).

  // The version the editor loaded (S-03). Absent from an older client, which
  // is then saved without the check rather than refused.
  const expectedVersion = payload.expectedVersion === undefined || payload.expectedVersion === null
    ? null : Number(payload.expectedVersion);
  if (expectedVersion !== null && (!Number.isInteger(expectedVersion) || expectedVersion < 0)) {
    throw fail('VALIDATION_ERROR', 'The map version sent with this save is not valid. Reload the editor.');
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
    // Money is whole cents or nothing. `Number('abc')` is NaN, which JSON sends
    // as null — so a garbled price silently became "no price".
    for (const key of ['priceCents', 'seatPriceCents']) {
      const v = t[key];
      if (v !== null && v !== undefined && v !== '' && !(Number.isInteger(Number(v)) && Number(v) >= 0)) {
        throw fail('VALIDATION_ERROR', `"${label}" has a price that is not a whole number of cents.`);
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
      seatPriceCents: t.seatPriceCents === null || t.seatPriceCents === undefined || t.seatPriceCents === ''
        ? null : Number(t.seatPriceCents),
      // S-19: a row of a seating section is addressed (section, row), not
      // (label, 'A'). Both come from the Studio's sections in the same save.
      section: cleanName(t.section, MAX_SECTION_NAME),
      row: t.section ? cleanName(t.row, MAX_ROW_NAME) : null,
    });
  }

  const availability = cleanAvailability(payload.availability);

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
    // The studio's images arrive as paths and leave as server-computed URLs;
    // see venueStudio.js for why a client-written URL never reaches the blob.
    p_layout: sanitizeLayout(eventId, payload.layout),
    p_tables: prepared,
    p_expected_version: expectedVersion,
    // Seats blocked or released in the Studio preview, saved with the map.
    p_availability: availability,
    p_actor: actorId,
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
    const s = /MAP_STALE:\s*(.*)/.exec(error.message);
    if (s) throw fail('MAP_STALE', `${s[1].trim()}. Reload the map, then make your change again.`);
    const m = /MAP_CONFLICT:\s*(.*)/.exec(error.message);
    if (m) throw fail('CONFLICT', `${m[1].trim()}.`);
    // A ticket type or category from another event.
    const v = /MAP_INVALID:\s*(.*)/.exec(error.message);
    if (v) throw fail('VALIDATION_ERROR', `${v[1].trim()}.`);
    throw fail('VALIDATION_ERROR', error.message);
  }

  return {
    mapId: result.map_id,
    tables: result.tables,
    version: result.version,
    // How many of the requested blocks and releases landed. Fewer than asked
    // means a buyer held or bought some of those seats meanwhile.
    availability: result.availability
      ? { blocked: result.availability.blocked, released: result.availability.released,
        requested: availability ? availability.block.length + availability.release.length : 0 }
      : null,
  };
}

// upsertTable, resizeTable, generateSeats and seatRow used to live here.
// They are now the body of `save_venue_map`, because doing that work from
// Node meant one transaction per table and a half-written map on any failure.

// The database's own limits on a section row's names (table_section_row_sane).
const MAX_SECTION_NAME = 40;
const MAX_ROW_NAME = 8;
// Seats one save may block or release. A whole stadium section is far less.
const MAX_AVAILABILITY_PER_SAVE = 5000;

/** A trimmed name, or null; refused rather than cut when it is too long. */
function cleanName(value, max) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.length > max) throw fail('VALIDATION_ERROR', `"${text.slice(0, 20)}…" is longer than ${max} characters.`);
  return text;
}

/**
 * `{ block: [seat ids], release: [seat ids] }` from the editor, or null when
 * the save changes no seat's availability. Ids must be UUIDs; whether each
 * seat is on THIS map, and still free to move, is the database's call.
 */
function cleanAvailability(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const ids = (list) => [...new Set(Array.isArray(list) ? list : [])];
  const block = ids(raw.block);
  const release = ids(raw.release);
  if (block.length === 0 && release.length === 0) return null;
  if (block.length + release.length > MAX_AVAILABILITY_PER_SAVE) {
    throw fail('VALIDATION_ERROR', `Block or release at most ${MAX_AVAILABILITY_PER_SAVE} seats in one save.`);
  }
  if ([...block, ...release].some((id) => !UUID.test(String(id)))) {
    throw fail('VALIDATION_ERROR', 'That is not a seat on this map.');
  }
  return { block, release };
}

function fail(code, message) {
  return Object.assign(new Error(message), { code });
}

/**
 * Blocks or releases seats: the organizer's own holds, for production kills,
 * sightline losses, a sponsor's seats or a camera position.
 *
 * `blocked` is a seat status the schema has always had and every hold path
 * already refuses (they take `available` seats only), so a blocked seat simply
 * cannot be bought, by any channel, until it is released. The table's status
 * follows by the existing trigger.
 *
 * ONLY TRANSITIONS BETWEEN `available` AND `blocked`. A held or sold seat is a
 * buyer's, and this endpoint must never be a way to take it back or to put it
 * on sale twice, so those rows are skipped and reported as unchanged, not
 * refused: one sold seat in a block of forty should not stop the other 39.
 */
async function setSeatAvailability(eventId, seatIds, blocked) {
  const { data: map, error: mapError } = await supabase
    .from('venue_maps').select('id').eq('event_id', eventId).maybeSingle();
  if (mapError) throw new Error(`could not read the venue map: ${mapError.message}`);
  if (!map) throw fail('VALIDATION_ERROR', 'This event has no seat map yet.');

  const ids = [...new Set(seatIds)];
  // The ids travel in the request URL to PostgREST, so a call is capped (the
  // route allows MAX_AVAILABILITY_BATCH) and the studio sends larger blocks in
  // several calls.
  if (ids.length > MAX_AVAILABILITY_BATCH) {
    throw fail('VALIDATION_ERROR', `Change at most ${MAX_AVAILABILITY_BATCH} seats at a time.`);
  }
  const { data, error } = await supabase
    .from('seats')
    .update({ status: blocked ? 'blocked' : 'available' })
    .eq('venue_map_id', map.id)
    .eq('status', blocked ? 'available' : 'blocked')
    .in('id', ids)
    .select('id');
  if (error) throw new Error(`could not change seat availability: ${error.message}`);

  const changed = (data || []).map((s) => s.id);
  return { changed, unchanged: ids.length - changed.length };
}

const MAX_AVAILABILITY_BATCH = 150;

module.exports = {
  getMapForOrganizer, saveMap, setSeatAvailability, MAX_TABLES, MAX_SEATS_PER_TABLE, MAX_AVAILABILITY_BATCH,
};
