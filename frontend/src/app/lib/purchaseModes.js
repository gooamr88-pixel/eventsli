/**
 * How buyers choose their place at a reserved event — the four modes, and the
 * three questions every screen asks of them.
 *
 *   seat_only       buyers pick seats one by one
 *   table_only      buyers book a whole table
 *   seat_and_table  either
 *   table_places    buyers book N places AT a table, with no seat numbers
 *                   (2026-11-25, migration 20261220090000)
 *
 * The questions are asked here, once, because the old answers were written as
 * `mode !== 'seat_only'` and `mode !== 'table_only'` — which a fourth mode
 * silently answers wrong: "places at a table" is not seat_only, and it does
 * not sell tables whole.
 */
export const PURCHASE_MODE_LABELS = Object.freeze({
  seat_only: 'Individual seats',
  table_only: 'Whole tables',
  seat_and_table: 'Seats or whole tables',
  table_places: 'Places at a table',
});

/** A table can be booked whole, at its whole-table price. */
export const sellsWholeTables = (mode) => mode === 'table_only' || mode === 'seat_and_table';

/** Seats are priced one by one (by ticket type), so every seat needs a type. */
export const pricesSeats = (mode) => mode !== 'table_only';

/** Buyers book places at a table; nobody picks or is told a seat. */
export const isTablePlaces = (mode) => mode === 'table_places';
