/**
 * The organizer's own map, in the shape the buyer's SeatMapCanvas draws.
 *
 * Door sales used to load the PUBLIC seat map. That map leaves out private
 * tables — correctly, for buyers — so a private table could never be sold at
 * the door; and it 404s for any event not yet published, so a draft with a
 * finished map read "No seat map yet". The organizer map has every table, with
 * each seat's real status, and this converts it without changing the canvas.
 *
 * Seat prices resolve the way the buyer map resolves them: the seat's own
 * price, else its ticket type's. Pure, so it is tested without a browser.
 */
export function toSaleMap(map, tiers, purchaseMode) {
  const tierPrice = new Map((tiers || []).map((t) => [t.id, t.priceCents ?? null]));

  const seatFor = (seat, tableId) => ({
    id: seat.id,
    tableId,
    tierId: seat.tierId || null,
    section: seat.section,
    row: seat.row,
    number: seat.number,
    priceCents: seat.priceOverrideCents ?? tierPrice.get(seat.tierId) ?? null,
    available: seat.status === 'available',
  });

  const tables = (map?.tables || []).map((t) => ({
    id: t.id,
    label: t.label,
    seatCount: t.seatCount,
    priceCents: t.priceCents,
    isPrivate: t.isPrivate,
    status: t.status,
    canBookWhole: t.status === 'available' && t.priceCents !== null && t.priceCents !== undefined
      && purchaseMode !== 'seat_only',
    position: t.position,
    shape: t.shape,
    categoryId: t.categoryId,
  }));

  const seats = [
    ...(map?.tables || []).flatMap((t) => (t.seats || []).map((s) => seatFor(s, t.id))),
    ...(map?.looseSeats || []).map((s) => seatFor(s, null)),
  ];

  return { tables, seats, hasMap: tables.length > 0 || seats.length > 0 };
}
