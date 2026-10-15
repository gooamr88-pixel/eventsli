/**
 * ─────────────────────────────────────────────────────────────────────────────
 * "Near you" — the decisions, apart from the component, so they can be tested.
 *
 * NEARBY BY DEFAULT, NEVER BY SURPRISE. The section loads nearby events on its
 * own only when the browser ALREADY grants this site location access. It never
 * opens the browser's permission prompt on page load: a refusal given to a
 * prompt nobody asked for is remembered by the browser and switches the feature
 * off for good (see NearMeDialog). Everyone else gets a button and a city list.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const NEARBY_RADIUS_KM = 100;
export const NEARBY_LIMIT = 8;
export const SAVED_CITY_KEY = 'eventsli.nearby.city';

/**
 * Where the section starts.
 *   'city'    a city this browser chose before — load it, no location needed
 *   'locate'  permission already granted — find the visitor quietly
 *   'offer'   the browser would have to ask — offer a button, ask nothing yet
 *   'manual'  location is impossible or refused — the city list is the way in
 */
export function startMode({ supported, secure, permission, savedCity }) {
  if (savedCity?.city) return 'city';
  if (!supported || !secure) return 'manual';
  if (permission === 'granted') return 'locate';
  if (permission === 'denied') return 'manual';
  return 'offer';
}

/**
 * Coordinates as they leave the browser: three decimals, about 110 metres.
 * Enough to say which events are close; not enough to say which house.
 */
export function roundCoords({ latitude, longitude }) {
  return { lat: Number(latitude).toFixed(3), lng: Number(longitude).toFixed(3) };
}

/** "1.2 km away" when measured to the venue; "about 12 km away" to a city. */
export function distanceLabel(event) {
  if (event?.distanceKm === undefined || event?.distanceKm === null) return null;
  const d = event.distanceKm < 1 ? 'under 1 km' : `${event.distanceKm} km`;
  return event.precise ? `${d} away` : `about ${d} away`;
}

/** The sentence for an empty answer — never just "nothing". */
export function emptyMessage(result, radiusKm = NEARBY_RADIUS_KM) {
  const nearest = result?.nearest;
  if (nearest?.city) {
    return `Nothing within ${radiusKm} km yet. The closest is in ${nearest.city}, about ${nearest.distanceKm} km away.`;
  }
  return 'Nothing is on near you just yet.';
}

export function readSavedCity() {
  try {
    const raw = window.localStorage.getItem(SAVED_CITY_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed.city === 'string' ? parsed : null;
  } catch { return null; }
}

export function saveCity(value) {
  try {
    if (value) window.localStorage.setItem(SAVED_CITY_KEY, JSON.stringify(value));
    else window.localStorage.removeItem(SAVED_CITY_KEY);
  } catch { /* private mode: the choice simply is not remembered */ }
}
