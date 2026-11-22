/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE EVENT'S ADDRESS, ONE WAY EVERYWHERE (2026-11-22).
 *
 * Up to five parts — street, apartment/unit/floor, city, province/state,
 * postal code — and optional directions to the door, every one optional: the
 * venue may be someone's home, or still to be announced. The event page, the
 * ticket, the checkout and the calendar file all read it through here, so a
 * flat's "Apt 4B" is never on one and missing from another.
 *
 * Mirrors `backend/utils/venueAddress.js`. The API also sends the one-line
 * form as `venueAddressFull`; it wins when present.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const clean = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** An event's address as named parts, every one possibly null. */
export function addressParts(event) {
  const e = event || {};
  return {
    street: clean(e.venueAddress ?? e.venue?.address),
    line2: clean(e.venueAddressLine2),
    city: clean(e.city),
    region: clean(e.venueRegion),
    postalCode: clean(e.venuePostalCode),
    directions: clean(e.venueDirections),
  };
}

/** "147 Danforth Ave, Apt 4B, Toronto, ON M4K 1N2", or null when nothing is given. */
export function addressLine(event) {
  const full = clean(event?.venueAddressFull);
  if (full) return full;
  const p = addressParts(event);
  const tail = [p.region, p.postalCode].filter(Boolean).join(' ');
  return [p.street, p.line2, saysAlready(p.street, p.city) ? null : p.city, tail].filter(Boolean).join(', ') || null;
}

/** True when the street line already names the city (venue search often writes "11 Polson St, Toronto"). */
function saysAlready(street, city) {
  if (!street || !city) return false;
  return street.toLowerCase().split(',').map((part) => part.trim()).includes(city.toLowerCase());
}

/**
 * What a maps app is asked for: the street, city, province and postal code,
 * without the unit — "Apt 4B" is for the guest at the door, and it makes a
 * geocoder guess. Null when there is no street.
 */
export function mapQueryAddress(event) {
  const p = addressParts(event);
  if (!p.street) return null;
  const tail = [p.region, p.postalCode].filter(Boolean).join(' ');
  return [p.street, saysAlready(p.street, p.city) ? null : p.city, tail].filter(Boolean).join(', ');
}

/**
 * The address on two lines, as on an envelope: the street and unit, then the
 * city, province and postal code. Lines with nothing in them are left out.
 */
export function addressLines(event) {
  const p = addressParts(event);
  const first = [p.street, p.line2].filter(Boolean).join(', ');
  const second = [p.city, [p.region, p.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [first, second].filter(Boolean);
}

/** True when the organizer has said where, beyond the city. */
export function hasVenue(event) {
  const p = addressParts(event);
  return Boolean(clean(event?.venueName ?? (typeof event?.venue === 'string' ? event.venue : event?.venue?.name)) || p.street || p.line2);
}

/** What a page says when no venue has been given yet. */
export const VENUE_TBA = 'Venue to be announced';
