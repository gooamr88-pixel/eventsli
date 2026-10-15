import Field from './Field';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE VENUE'S COORDINATES, VISIBLE AND EDITABLE.
 *
 * They were already being captured — `PlaceAutocomplete` fills them from a
 * chosen suggestion — but only as hidden form state. Nothing on screen said an
 * event had a pin, nothing said it had lost one, and nothing offered a way to
 * supply one by hand.
 *
 * That last part is the reason this exists rather than a read-out. Venue search
 * is optional (`GOOGLE_PLACES_API_KEY`) and can be refused by Google for
 * reasons the organizer never sees — a key restricted to HTTP referrers blocks
 * every server-side call, which is what this deployment was doing. When search
 * is unavailable, typing the numbers is the ONLY way to pin a venue, and a
 * hidden field cannot be typed into. The same applies to a venue Google has
 * never heard of: a school hall, a farm, a new building.
 *
 * BOTH OR NEITHER. `venue_coords_together` is a CHECK constraint, so half a pin
 * is refused by the database. The message below says so in advance rather than
 * letting the organizer discover it as a failed save.
 *
 * WHERE THE NUMBERS COME FROM, for an organizer who has never copied a
 * coordinate: Google Maps, right-click the spot, and the first line of the menu
 * is the pair, ready to paste. That sentence is the hint, because "latitude" is
 * not a word most people have a workflow for.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** A blank, or a number inside the real range. Strings, because inputs are. */
export function pinProblem({ lat, lng }) {
  const hasLat = String(lat ?? '').trim() !== '';
  const hasLng = String(lng ?? '').trim() !== '';

  if (!hasLat && !hasLng) return null;
  if (hasLat !== hasLng) {
    return 'A map pin needs both numbers. Add the other one, or clear both.';
  }

  const nLat = Number(lat);
  const nLng = Number(lng);
  if (!Number.isFinite(nLat) || !Number.isFinite(nLng)) {
    return 'Latitude and longitude must be numbers.';
  }
  // Catches the single most common paste error: the pair the wrong way round.
  // A longitude in the latitude box is out of range anywhere beyond ±90, which
  // is most of the world's longitudes.
  if (nLat < -90 || nLat > 90) return 'Latitude must be between -90 and 90.';
  if (nLng < -180 || nLng > 180) return 'Longitude must be between -180 and 180.';
  return null;
}

/**
 * @param {string} lat            the latitude as the form holds it (a string)
 * @param {string} lng
 * @param {(key: 'venueLat'|'venueLng', value: string) => void} onChange
 * @param {boolean} [fromSearch]  true when a Places suggestion set these, which
 *                                changes what the line underneath says
 */
export default function VenuePin({ lat, lng, onChange, fromSearch = false }) {
  const problem = pinProblem({ lat, lng });
  const pinned = !problem && String(lat ?? '').trim() !== '';

  return (
    <>
      <div className="fx-grid fx-grid--2">
        <Field
          label="Latitude"
          name="venueLat"
          optional
          inputMode="decimal"
          autoComplete="off"
          placeholder="e.g. 43.6532"
          value={lat}
          onChange={(e) => onChange('venueLat', e.target.value)}
        />
        <Field
          label="Longitude"
          name="venueLng"
          optional
          inputMode="decimal"
          autoComplete="off"
          placeholder="e.g. -79.3832"
          value={lng}
          onChange={(e) => onChange('venueLng', e.target.value)}
        />
      </div>

      {/* `inputMode` and not `type="number"`: a numeric keypad on a phone,
          without the spinner arrows, and without a number input's habit of
          silently rejecting a pasted value it does not like the shape of —
          which for a minus sign and four decimal places it often does not. */}

      {problem ? (
        <p className="text-sm text-danger">{problem}</p>
      ) : (
        <p className="text-sm text-muted">
          {pinned
            ? (fromSearch
              ? 'Filled in from the venue you picked. “Events near me” measures to this point.'
              : 'Pinned. “Events near me” measures to this point rather than to the middle of the city.')
            : 'Optional. Pick the venue from the suggestions above and these fill themselves in — or in Google Maps, right-click the spot and click the numbers at the top of the menu to copy them.'}
        </p>
      )}
    </>
  );
}
