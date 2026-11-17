const { supabase } = require('../config/supabase');
const access = require('./tableAccessService');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Places ONE hold — seats, a whole table, or general-admission quantities —
 * through the Postgres function that owns every rule for it.
 *
 * Out of `seatMapController.hold` (2026-11-17) because the cart calls it twice
 * in one request: once for the combined selection when a buyer adds more to an
 * event already in their cart, and, if that is refused, once more to put their
 * original hold back. The private-table gates live here so both calls pass
 * through them.
 *
 * Returns `{ ok: true, result }` (the RPC's answer) or `{ ok: false, fail }`
 * where `fail` is `{ status, error, message, meta? }` ready for `sendFail`.
 * Throws only on a fault (a failed call is not a taken seat — T-039).
 * ─────────────────────────────────────────────────────────────────────────────
 */
async function placeHold({ event, userId, selection, tableAccessHeader = '', ttlMinutes, statusFor }) {
  const { seatIds, tableId, lines } = selection;
  const unlocked = () => access.unlockedTableIds(String(tableAccessHeader || '').split(',').filter(Boolean), event.id);

  let result;
  let rpcError = null;
  if (Array.isArray(lines)) {
    // GENERAL ADMISSION — the sale window, per-type caps and the allocation are
    // all enforced inside `hold_general`, under a row lock on the tiers.
    ({ data: result, error: rpcError } = await supabase.rpc('hold_general', {
      p_event_id: event.id, p_user_id: userId, p_lines: lines, p_ttl_minutes: ttlMinutes,
    }));
  } else if (tableId) {
    // A private table needs its token here too, or the password gates only the map.
    if (await tableIsPrivate(tableId) && !unlocked().has(tableId)) {
      return { ok: false, fail: { status: 403, error: 'TABLE_PASSWORD_REQUIRED', message: 'This table needs its password before it can be booked.' } };
    }
    ({ data: result, error: rpcError } = await supabase.rpc('hold_table', {
      p_event_id: event.id, p_user_id: userId, p_table_id: tableId, p_ttl_minutes: ttlMinutes,
    }));
  } else {
    // BRD §27 — seats AT a private table need its token as well.
    const privateTables = await privateTablesFor(seatIds);
    if (privateTables.length > 0) {
      const open = unlocked();
      if (privateTables.some((id) => !open.has(id))) {
        return { ok: false, fail: { status: 403, error: 'TABLE_PASSWORD_REQUIRED', message: 'Some of those seats are at a private table. Unlock it with its password first.' } };
      }
    }
    ({ data: result, error: rpcError } = await supabase.rpc('hold_seats', {
      p_event_id: event.id, p_user_id: userId, p_seat_ids: seatIds, p_ttl_minutes: ttlMinutes,
    }));
  }

  if (rpcError) throw new Error(`hold failed: ${rpcError.message}`);
  if (!result?.ok) {
    return {
      ok: false,
      fail: {
        status: statusFor(result?.error),
        error: result?.error || 'CONFLICT',
        message: result?.message || 'Those seats are no longer available.',
        meta: result?.requested !== undefined ? { requested: result.requested, available: result.available } : undefined,
      },
    };
  }
  return { ok: true, result };
}

/** The private tables any of these seats sit at. Fails closed: it is a gate. */
async function privateTablesFor(seatIds) {
  if (!Array.isArray(seatIds) || seatIds.length === 0) return [];
  const { data, error } = await supabase
    .from('seats')
    .select('table_id, tables!inner ( is_private )')
    .in('id', seatIds)
    .eq('tables.is_private', true);
  if (error) throw new Error(`private table lookup failed: ${error.message}`);
  return [...new Set((data || []).map((s) => s.table_id))];
}

/** Fails closed, like `privateTablesFor` (TECH-AUDIT-LOG T-015). */
async function tableIsPrivate(tableId) {
  const { data, error } = await supabase.from('tables').select('is_private').eq('id', tableId).maybeSingle();
  if (error) throw new Error(`private table lookup failed: ${error.message}`);
  return Boolean(data?.is_private);
}

module.exports = { placeHold, privateTablesFor, tableIsPrivate };
