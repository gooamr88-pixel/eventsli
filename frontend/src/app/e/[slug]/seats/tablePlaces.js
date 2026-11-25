/**
 * ─────────────────────────────────────────────────────────────────────────────
 * PLACES AT A TABLE — the buyer's choice, as plain data (2026-11-25).
 *
 * A party: how many GUESTS, and where they sit — `picks`, one per table:
 * [{ tableId, quantity }]. The buyer never chooses a seat; the server takes
 * the first free seats at each table (hold_table_places, lowest numbers
 * first) and the ticket names only the table.
 *
 * The rules, said the way a host would:
 *   · Tap a table and your party sits there — as many as it has room for.
 *   · Room for fewer than your party? The rest wait; tap another table.
 *   · Everyone already seated? Tapping another table moves you there.
 *   · Tap a table you chose to give it back.
 *   · One more guest joins the last table if it has room; one fewer leaves
 *     the last table first.
 *
 * Pure: state in, state out, so every rule is tested without a map.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const numeric = (a, b) => {
  const x = Number(a.number); const y = Number(b.number);
  if (Number.isFinite(x) && Number.isFinite(y) && x !== y) return x - y;
  return String(a.number).localeCompare(String(b.number), undefined, { numeric: true });
};

/** Each table's free seats, lowest number first — the order the server takes them. */
export function freeSeatsByTable(seats) {
  const by = new Map();
  for (const s of seats || []) {
    if (!s.tableId || !s.available) continue;
    const list = by.get(s.tableId) || [];
    list.push(s);
    by.set(s.tableId, list);
  }
  for (const list of by.values()) list.sort(numeric);
  return by;
}

export const seated = (picks) => picks.reduce((n, p) => n + p.quantity, 0);

/** A table pressed on the map. `free` is its free places. */
export function tapTable(picks, guests, tableId, free) {
  if (picks.some((p) => p.tableId === tableId)) return picks.filter((p) => p.tableId !== tableId);
  if (free <= 0) return picks;
  const waiting = guests - seated(picks);
  if (waiting > 0) return [...picks, { tableId, quantity: Math.min(waiting, free) }];
  // Everyone has a seat: the party moves to the table pressed.
  return [{ tableId, quantity: Math.min(guests, free) }];
}

/** The party grows or shrinks. `freeOf(tableId)` is a table's free places. */
export function setGuests(picks, guests, freeOf) {
  let next = picks.map((p) => ({ ...p }));
  let extra = seated(next) - guests;
  // Fewer guests: the last table gives them up first.
  for (let i = next.length - 1; i >= 0 && extra > 0; i -= 1) {
    const take = Math.min(extra, next[i].quantity);
    next[i].quantity -= take;
    extra -= take;
  }
  next = next.filter((p) => p.quantity > 0);
  // More guests: they join the last table while it has room.
  const last = next[next.length - 1];
  const waiting = guests - seated(next);
  if (last && waiting > 0) last.quantity += Math.max(0, Math.min(waiting, freeOf(last.tableId) - last.quantity));
  return next;
}

/** The chairs drawn as the party's: the first free ones at each chosen table. */
export function partySeatIds(picks, freeBy) {
  const ids = new Set();
  for (const p of picks) for (const s of (freeBy.get(p.tableId) || []).slice(0, p.quantity)) ids.add(s.id);
  return ids;
}

/**
 * What the places at one table cost: the sum of the seats the server will
 * take, or null when one of them has no price (the checkout then says).
 */
export function pickPrice(pick, freeBy) {
  const seats = (freeBy.get(pick.tableId) || []).slice(0, pick.quantity);
  if (seats.length < pick.quantity) return null;
  let sum = 0;
  for (const s of seats) {
    if (s.priceCents === null || s.priceCents === undefined) return null;
    sum += s.priceCents;
  }
  return sum;
}

/** The cart's seats for this event, back as a party (the page starts with them). */
export function picksFromSeatIds(seatIds, seats) {
  const ids = new Set(seatIds || []);
  const by = new Map();
  for (const s of seats || []) {
    if (!ids.has(s.id) || !s.tableId) continue;
    by.set(s.tableId, (by.get(s.tableId) || 0) + 1);
  }
  return [...by.entries()].map(([tableId, quantity]) => ({ tableId, quantity }));
}
