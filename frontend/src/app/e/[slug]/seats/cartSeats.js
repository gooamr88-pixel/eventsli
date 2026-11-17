/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BUYER'S OWN HOLD, SHOWN AS THEIRS ON THE MAP (the cart, 2026-11-17).
 *
 * Seats this buyer already holds in their cart come back from the public map
 * as taken — they are, by them. Left that way, the buyer could neither see
 * them as their selection nor drop one. So the map is drawn with those seats
 * (or that whole table) AVAILABLE, and the page starts with them selected.
 * "Update cart" then sends the whole selection as a replacement for the old
 * hold, which the server releases in the same request (seatMapController.hold).
 *
 * Pure: the map in, a map out. Nothing here is trusted by the server — a seat
 * marked available here that is really someone else's is refused at the hold.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** The cart item for this event, if any. */
export function cartItemFor(items, slug) {
  return (items || []).find((i) => i.event?.slug === slug) || null;
}

/** The map with this buyer's held seats and table drawn as available. */
export function withMyHolds(map, item) {
  if (!map || !item?.selection) return map;
  const seatIds = new Set(item.selection.seatIds || []);
  const tableId = item.selection.tableId || null;
  if (seatIds.size === 0 && !tableId) return map;
  return {
    ...map,
    seats: (map.seats || []).map((s) => (seatIds.has(s.id) || (tableId && s.tableId === tableId)
      ? { ...s, available: true, reason: null }
      : s)),
    tables: (map.tables || []).map((t) => (t.id === tableId ? { ...t, canBookWhole: true, status: 'available' } : t)),
  };
}

/** What to start the page with: the cart's seats, or its table. */
export function selectionFromCart(map, item) {
  if (!map || !item?.selection) return { seats: [], table: null };
  if (item.selection.tableId) {
    return { seats: [], table: (map.tables || []).find((t) => t.id === item.selection.tableId) || null };
  }
  const ids = new Set(item.selection.seatIds || []);
  return { seats: (map.seats || []).filter((s) => ids.has(s.id)), table: null };
}
