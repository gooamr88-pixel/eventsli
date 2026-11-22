/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE EVENT'S ADDRESS, ONE WAY EVERYWHERE (2026-11-22).
 *
 * An event's address is up to five parts — street, apartment/unit/floor, city,
 * province/state and postal code (migration 20261208090000) — plus optional
 * directions to the door. Every one is optional: the venue may be a home, or
 * still to be announced. Tickets, emails, the checkout, the door app and the
 * public page all print it through here, so a flat's "Apt 4B" is never on the
 * page and missing from the ticket.
 *
 * The frontend mirror is `frontend/src/app/lib/venueAddress.js`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** The columns to select wherever an event's address is shown. */
const ADDRESS_COLUMNS = 'venue_address, venue_address_line2, venue_region, venue_postal_code, venue_directions, city';

const clean = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** A row's address as named parts, every one possibly null. */
function addressParts(e) {
  if (!e) return { street: null, line2: null, city: null, region: null, postalCode: null, directions: null };
  return {
    street: clean(e.venue_address ?? e.venueAddress),
    line2: clean(e.venue_address_line2 ?? e.venueAddressLine2),
    city: clean(e.city),
    region: clean(e.venue_region ?? e.venueRegion),
    postalCode: clean(e.venue_postal_code ?? e.venuePostalCode),
    directions: clean(e.venue_directions ?? e.venueDirections),
  };
}

/**
 * "147 Danforth Ave, Apt 4B, Toronto, ON M4K 1N2" — every part given, in the
 * order a letter is addressed, or null when nothing is. Directions are not
 * part of an address; callers show them on a line of their own.
 */
function addressLine(e) {
  const p = addressParts(e);
  const tail = [p.region, p.postalCode].filter(Boolean).join(' ');
  // Venue search often writes the street as "11 Polson St, Toronto": the city once.
  const named = p.street && p.city && p.street.toLowerCase().split(',').map((part) => part.trim()).includes(p.city.toLowerCase());
  const line = [p.street, p.line2, named ? null : p.city, tail].filter(Boolean).join(', ');
  return line || null;
}

/** The camelCase fields an API response carries for an address. */
function addressFields(e) {
  const p = addressParts(e);
  return {
    venueAddressLine2: p.line2,
    venueRegion: p.region,
    venuePostalCode: p.postalCode,
    venueDirections: p.directions,
    venueAddressFull: addressLine(e),
  };
}

module.exports = { ADDRESS_COLUMNS, addressParts, addressLine, addressFields };
