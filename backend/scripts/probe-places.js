/**
 * Answers one question before an organizer finds out for you: does venue search
 * actually work on this deployment?
 *
 *   node scripts/probe-places.js
 *   node scripts/probe-places.js "danforth music"
 *
 * Read-only. Two GETs against Google, no writes anywhere, and nothing about the
 * key is printed beyond its length and prefix.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS RATHER THAN "JUST TRY THE FORM".
 *
 * A misconfigured key is INVISIBLE in the wizard by design. The venue field
 * degrades to a plain text input when Places is unavailable — that is the
 * intended behaviour for a deployment with no key — so "no suggestions appear"
 * is the same symptom for every cause:
 *
 *   the key is absent          → dormant, and correct
 *   the key is invalid         → dormant, and wrong
 *   the project has no billing → dormant, and wrong
 *   Places API (New) is off    → dormant, and wrong
 *   the key is IP-restricted   → dormant, and wrong from this server only
 *
 * The service logs Google's real reason and deliberately never returns it to
 * the browser, so the browser cannot tell you which of those five it is. This
 * can, in one command, without reading the production log.
 *
 * WHAT THE SECOND PROBE IS AND IS NOT WORTH. It hits a different Google API to
 * see whether the key is recognised anywhere. Read it CAUTIOUSLY: an untouched
 * project has Geocoding disabled too, so a failure there is the normal state and
 * proves nothing about the key. Only a SUCCESS is informative — it would mean
 * the key is live and Places alone is the problem.
 *
 * This probe originally read a Geocoding failure as "the project was deleted"
 * and said so confidently. It was wrong, and the shape of the mistake is worth
 * keeping: an error from an API nobody enabled is not evidence about a key.
 * ─────────────────────────────────────────────────────────────────────────────
 */
require('dotenv').config();
const places = require('../services/placesService');

const KEY = (process.env.GOOGLE_PLACES_API_KEY || '').trim();
const QUERY = process.argv[2] || 'danforth music';

/** Google's own message for a raw request, or the transport failure. */
async function raw(url, options) {
  try {
    const response = await fetch(url, options);
    const text = await response.text();
    let message = text.slice(0, 300);
    try {
      const body = JSON.parse(text);
      message = body.error?.message || body.error_message || body.status || message;
    } catch { /* not JSON — the truncated body is the best we have */ }
    return { status: response.status, message };
  } catch (e) {
    return { status: 0, message: e.message };
  }
}

(async () => {
  if (!KEY) {
    console.log('GOOGLE_PLACES_API_KEY is not set in backend/.env.');
    console.log('Venue search is DORMANT: the venue field is a plain text input,');
    console.log('which is a supported state. Set the key to switch it on.');
    process.exit(0);
  }

  console.log(`key: ${KEY.length} chars, prefix ${KEY.slice(0, 6)}`);
  if (KEY.length !== 39 || !KEY.startsWith('AIza')) {
    console.log('  ! a Google API key is normally 39 characters and starts "AIza"');
  }
  // The most common cause of a mystifying 400: the value in .env still carries
  // the quotes or a trailing comment it was pasted with.
  if (/["'\s]/.test(process.env.GOOGLE_PLACES_API_KEY || '')) {
    console.log('  ! the raw value contains quotes or whitespace — remove them');
  }

  console.log(`\n── 1. Places API (New), the call the wizard makes ──`);
  const auto = await raw('https://places.googleapis.com/v1/places:autocomplete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': KEY,
      'X-Goog-FieldMask': 'suggestions.placePrediction.placeId',
    },
    body: JSON.stringify({ input: QUERY }),
  });
  console.log(`   HTTP ${auto.status}: ${auto.message}`);

  console.log(`\n── 2. A different Google API, to test the KEY itself ──`);
  const geo = await raw(
    `https://maps.googleapis.com/maps/api/geocode/json?address=Toronto&key=${encodeURIComponent(KEY)}`,
  );
  console.log(`   HTTP ${geo.status}: ${geo.message}`);

  console.log(`\n── 3. Diagnosis ──`);
  const notFound = /API Key not found|not a valid API key/i.test(auto.message);
  const projectGone = /project was not found|may have been deleted/i.test(geo.message);
  const serviceOff = /not enabled|SERVICE_DISABLED|not authorized to use this API/i.test(auto.message);
  const billing = /billing/i.test(auto.message) || /billing/i.test(geo.message);
  const blocked = /referer|referrer|IP|blocked|denied/i.test(auto.message);

  if (auto.status === 200) {
    console.log('   Places answered. Running the service end to end:\n');
    try {
      const found = await places.autocomplete({ input: QUERY, country: 'CA' });
      console.log(`   suggestions: ${found.length}`);
      for (const s of found) console.log(`      ${s.primary}  |  ${s.secondary}`);
      if (found[0]) {
        const d = await places.details({ placeId: found[0].placeId });
        console.log(`\n   details for "${d.name}"`);
        console.log(`      address : ${d.address || '(none)'}`);
        console.log(`      city    : ${d.city || '(none)'}`);
        console.log(`      lat/lng : ${d.lat}, ${d.lng}`);
        const complete = d.name && d.address && d.city && d.lat !== null;
        console.log(`\n   ${complete ? 'WORKING — all five venue fields populate.' : 'PARTIAL — some fields came back empty.'}`);
      }
    } catch (e) {
      console.log(`   service call failed: ${e.code || ''} ${e.message}`);
    }
    return;
  }

  if (notFound) {
    /**
     * "API Key not found. Please pass a valid API key." is Google's message for
     * a key whose project has NOT ENABLED Places API (New) — it is not the
     * message it sounds like. Reading it literally, and pairing it with a
     * Geocoding error that only means "Geocoding is not enabled either", is how
     * this probe first concluded the project had been deleted. It had not.
     *
     * Places API (New) is a DIFFERENT PRODUCT from the legacy "Places API" and
     * from the Maps JavaScript API. A key that draws maps in a browser
     * perfectly well still gets this until the new API is switched on for it.
     */
    console.log('   "Places API (New)" is almost certainly not enabled on the');
    console.log('   project behind this key. It is a separate product from the');
    console.log('   legacy "Places API"');
    console.log('   and from Maps JavaScript — a key that works for maps in a');
    console.log('   browser still returns this until the new API is enabled.');
    console.log('');
    console.log('   Enable it: console.cloud.google.com → APIs & Services →');
    console.log('   Library → "Places API (New)" → Enable. Then re-run this.');
    if (projectGone) {
      console.log('');
      console.log('   (The second probe failing too only means Geocoding is not');
      console.log('   enabled either, which is normal and not a problem.)');
    }
  } else if (billing) {
    console.log('   Billing is not enabled on the project. Places API (New) has no');
    console.log('   free tier without a billing account attached.');
  } else if (serviceOff) {
    console.log('   The key is real but "Places API (New)" is not enabled on its');
    console.log('   project. Enable that specific API — the legacy "Places API" is');
    console.log('   a different product and does not satisfy this.');
  } else if (blocked) {
    /**
     * A Google API key carries exactly ONE application restriction: None, HTTP
     * referrers, IP addresses, Android, or iOS. They are a radio choice, not a
     * set — so a key restricted to `eventsli.com/*` for browser use CANNOT also
     * admit this server, and the fix is a second key rather than an edit.
     */
    console.log('   The key is restricted and this server is not allowed.');
    console.log('   A Google key has ONE application restriction, not several: a key');
    console.log('   locked to HTTP referrers for browser use can never also admit a');
    console.log('   server IP. Create a SECOND key for the server, restricted by IP');
    console.log('   to this box and to Places API (New) only.');
  } else {
    console.log('   Unrecognised refusal. Google\'s message is printed above verbatim.');
  }
  process.exitCode = 1;
})();
