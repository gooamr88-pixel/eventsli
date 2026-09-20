/**
 * ─────────────────────────────────────────────────────────────────────────────
 * VENUE SEARCH — Google Places, called from the SERVER and never the browser.
 *
 * The create-event wizard asks for a venue by name. Before this, that was three
 * free-text boxes and a fourth screen where the organizer was told to
 * "right-click the venue in Google Maps and copy the two numbers" — so the
 * coordinates that draw the map on a public event page were a manual
 * transcription job, and `events.city`, which "events near me" filters on, was
 * whatever got typed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A PROXY AND NOT A BROWSER INTEGRATION.
 *
 * The obvious build is Google's own widget: load `maps.googleapis.com` with a
 * `NEXT_PUBLIC_` key and let it talk to Google directly. Three reasons this
 * does not:
 *
 *   1. THE KEY. A browser key is public by construction. Google's answer is HTTP
 *      referrer restriction, which is a header an attacker sets freely — it
 *      stops casual copying and nothing else. The bill for Places is ours. Here
 *      the key is `GOOGLE_PLACES_API_KEY`, server-side, never in a bundle.
 *
 *   2. THE CSP. `config/csp.mjs` runs `script-src 'self' 'nonce-…'` and
 *      `connect-src 'self' <api> <supabase>`. A browser integration needs
 *      google added to both, on every page of the site, to serve one field on
 *      one screen. Through our own API the existing `connect-src 'self'`
 *      already covers it and the policy does not move.
 *
 *      This is the same reasoning the CSP file already records for Google
 *      Sign-In: "The ID token is handed to our own API and verified there
 *      against Google's keys, so the browser never calls Google with anything
 *      of ours."
 *
 *   3. RATE LIMITING. Autocomplete bills per session and the input is a
 *      keystroke stream. Behind our own route it sits under `makeLimiter` and
 *      `requireRole('organizer')`, so the spend is bounded and attributable.
 *      A public browser key is bounded by nothing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PLACES API (NEW), NOT THE LEGACY ONE.
 *
 * `AutocompleteService` / `PlacesService` are the legacy JS library, deprecated
 * for new consumers in March 2025 and unavailable on keys created since. This
 * uses the REST surface that replaced them —
 * `POST places.googleapis.com/v1/places:autocomplete` and
 * `GET  places.googleapis.com/v1/places/{id}` — which needs no JS bundle at all,
 * which is the other reason the browser never has to load anything from Google.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SESSION TOKENS ARE A BILLING MECHANISM, and getting them wrong is expensive.
 *
 * Google bills a "session": every keystroke's autocomplete call plus the ONE
 * details call that resolves the chosen place, grouped by a token the client
 * mints and reuses. Without a token each request is billed separately, so a
 * fifteen-character venue name costs fifteen autocompletes instead of one
 * session. The client owns the token's lifetime because only the client knows
 * when a selection ended the session — see `PlaceAutocomplete.jsx`.
 *
 * This module only forwards it, and validates its SHAPE so a caller cannot use
 * the field to smuggle anything into the upstream request.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FIELD MASKS ARE MANDATORY AND THEY ARE ALSO THE BILL.
 *
 * The new API refuses a request with no `X-Goog-FieldMask`, and the fields asked
 * for decide which SKU is charged. These masks are the narrowest that answer the
 * question: suggestions need the text and the id, details needs the address
 * parts and the coordinates. Adding a field here is adding a line to an invoice,
 * so each one below is there because a column stores it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ABSENT KEY IS A SUPPORTED STATE, NOT AN ERROR.
 *
 * `GOOGLE_PLACES_API_KEY` is optional. Without it `isEnabled()` is false, the
 * routes answer a plain "not configured", and the wizard's venue field stays the
 * ordinary text input it is today. A deployment that never sets it behaves
 * exactly as it did before this feature existed — which is the same shape
 * `GoogleSignIn.jsx` already uses for its client id.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const logger = require('../utils/logger');

const API_ROOT = 'https://places.googleapis.com/v1';

/** Read per call, not captured at import: tests set it per case. */
const key = () => (process.env.GOOGLE_PLACES_API_KEY || '').trim();

/** Whether venue search can work at all on this deployment. */
function isEnabled() {
  return key().length > 0;
}

/**
 * Upstream calls get a deadline.
 *
 * This sits inside a request an organizer is waiting on with a half-typed venue
 * name. Google being slow must become "no suggestions" quickly rather than a
 * request that hangs until the proxy gives up — by which time the organizer has
 * typed three more characters and this answer is stale anyway.
 */
const TIMEOUT_MS = 4000;

async function call(path, { method = 'GET', body, fieldMask }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${API_ROOT}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        // The key travels in a header, never in the query string: a URL ends up
        // in access logs and error reports, and a header does not.
        'X-Goog-Api-Key': key(),
        'X-Goog-FieldMask': fieldMask,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    const text = await response.text();
    const data = text ? JSON.parse(text) : {};

    if (!response.ok) {
      /**
       * UPSTREAM DETAIL IS LOGGED, NEVER RETURNED.
       *
       * Google's error body names the project and the reason a key was refused
       * ("API not enabled", "referer blocked", quota). That is operator
       * information — useful in our log, and not something to hand to a browser
       * on a form field.
       */
      logger.error(
        { status: response.status, upstream: data?.error?.message || text?.slice(0, 200) },
        'places request failed',
      );
      const err = new Error('Venue search is unavailable right now.');
      err.code = 'PLACES_UPSTREAM';
      throw err;
    }

    return data;
  } catch (err) {
    if (err.code) throw err;
    // An abort and a DNS failure are the same thing to the caller: no
    // suggestions. Neither is worth a 500 on a page that works without them.
    logger.error({ err: err.message }, 'places request errored');
    const wrapped = new Error('Venue search is unavailable right now.');
    wrapped.code = 'PLACES_UPSTREAM';
    throw wrapped;
  }
}

/**
 * A session token as the client minted it, or undefined.
 *
 * `crypto.randomUUID()` is what the client sends, so anything that is not a
 * plausible token is dropped rather than forwarded — this value goes into an
 * upstream request body, and an unvalidated passthrough is how a field meant for
 * a UUID becomes a way to shape somebody else's API call.
 */
function cleanSession(value) {
  const token = String(value || '').trim();
  return /^[A-Za-z0-9-]{8,64}$/.test(token) ? token : undefined;
}

/**
 * Venue suggestions for a partial name.
 *
 * `includedPrimaryTypes` is deliberately NOT set. The instinct is to ask for
 * `establishment` — events happen at venues — and it is wrong often enough to
 * matter: a street festival, a park, a conference centre inside a hotel and a
 * plain street address are all real answers, and a type filter silently removes
 * whichever category was not thought of. The organizer can see which result is
 * theirs; a filter decides for them.
 *
 * `regionCode` biases rather than restricts. The country comes from the event
 * being created, so a Toronto organizer types "danforth" and gets Toronto
 * results first — without making a Canadian organizer's Buffalo venue
 * unfindable.
 *
 * @param {object}  args
 * @param {string}  args.input          what has been typed
 * @param {string}  [args.sessionToken] groups this keystroke with its session
 * @param {string}  [args.country]      two-letter code, for biasing only
 */
async function autocomplete({ input, sessionToken, country }) {
  const query = String(input || '').trim();
  // The client already refuses to ask below three characters; this is the
  // server saying the same thing, because the client is not the only caller
  // that can exist and one-character autocompletes are pure spend.
  if (query.length < 3) return [];

  const region = /^[A-Za-z]{2}$/.test(String(country || '')) ? String(country).toUpperCase() : undefined;

  const data = await call('/places:autocomplete', {
    method: 'POST',
    // Only the parts of a suggestion that get rendered. `structuredFormat`
    // splits "The Danforth Music Hall" from "147 Danforth Ave, Toronto", which
    // is what lets the list show a name in reading weight above a quiet address
    // instead of one run-on string.
    fieldMask: [
      'suggestions.placePrediction.placeId',
      'suggestions.placePrediction.text',
      'suggestions.placePrediction.structuredFormat',
    ].join(','),
    body: {
      input: query,
      ...(cleanSession(sessionToken) ? { sessionToken: cleanSession(sessionToken) } : {}),
      ...(region ? { regionCode: region } : {}),
    },
  });

  return (data.suggestions || [])
    .map((s) => s.placePrediction)
    .filter((p) => p?.placeId)
    .map((p) => ({
      placeId: p.placeId,
      // `structuredFormat` is absent on some predictions; `text` always exists,
      // so the primary line falls back to it rather than rendering blank.
      primary: p.structuredFormat?.mainText?.text || p.text?.text || '',
      secondary: p.structuredFormat?.secondaryText?.text || '',
    }))
    // Google returns at most five; this bounds it whatever it returns, because
    // the listbox is rendered on a phone.
    .slice(0, 5);
}

/**
 * The city, dug out of the address components.
 *
 * `locality` is the city in most of the world and is ABSENT in some of it —
 * London boroughs, unincorporated areas, and much of Japan. The fallbacks walk
 * outward through the administrative levels, so a place that has no locality
 * still yields something a buyer would recognise as "where", which is all
 * `events.city` is for.
 *
 * `postalTown` is the one that matters for the UK specifically: a London
 * address has no `locality` and this is what carries "London".
 */
const CITY_TYPES = ['locality', 'postal_town', 'administrative_area_level_2', 'administrative_area_level_1'];

function cityFrom(components) {
  for (const type of CITY_TYPES) {
    const hit = (components || []).find((c) => (c.types || []).includes(type));
    if (hit?.longText) return hit.longText;
  }
  return null;
}

/**
 * Everything the event row needs, for one chosen place.
 *
 * `shortFormattedAddress` in preference to `formattedAddress`: the long form
 * ends with the country and often the postal code, and this string is rendered
 * under a venue name on a ticket where the country is already implied by the
 * event. The long one is the fallback for places that have no short form.
 *
 * COORDINATES ARE RETURNED AS NUMBERS AND STORED AS NUMERIC(9,6). The column's
 * scale is six decimal places, roughly 11cm, which is far finer than a venue
 * pin needs and is the existing shape — `venue_lat`/`venue_lng` predate this
 * feature.
 */
async function details({ placeId, sessionToken }) {
  const id = String(placeId || '').trim();
  if (!/^[A-Za-z0-9_-]{1,255}$/.test(id)) {
    const err = new Error('That place is not valid.');
    err.code = 'PLACES_BAD_ID';
    throw err;
  }

  const token = cleanSession(sessionToken);
  const data = await call(
    `/places/${encodeURIComponent(id)}${token ? `?sessionToken=${encodeURIComponent(token)}` : ''}`,
    {
      fieldMask: [
        'id',
        'displayName',
        'shortFormattedAddress',
        'formattedAddress',
        'addressComponents',
        'location',
      ].join(','),
    },
  );

  const lat = data.location?.latitude;
  const lng = data.location?.longitude;

  return {
    placeId: data.id || id,
    name: data.displayName?.text || '',
    address: data.shortFormattedAddress || data.formattedAddress || '',
    city: cityFrom(data.addressComponents),
    // Both or neither — `venue_coords_together` in the schema refuses half a
    // pin, so a place that somehow came back without a location must not
    // contribute one coordinate.
    lat: Number.isFinite(lat) && Number.isFinite(lng) ? lat : null,
    lng: Number.isFinite(lat) && Number.isFinite(lng) ? lng : null,
  };
}

module.exports = { isEnabled, autocomplete, details, cityFrom };
