const crypto = require('crypto');
const { supabase } = require('../config/supabase');
const { sendOk, sendFail } = require('../utils/responseEnvelope');
const storefront = require('../services/storefrontService');
const categories = require('../services/categoryService');
const { platformStats } = require('../services/statsService');
const geo = require('../utils/cityCoordinates');
const logger = require('../utils/logger');
const discovery = require('./discoveryController');
const { fetchAll } = require('../utils/fetchAll');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Everything the homepage needs that is not an event.
 *
 * ONE ENDPOINT, not five. The landing page renders six admin-owned blocks, and
 * as six separate fetches that is six round trips before the first byte, six
 * cache tags to invalidate correctly, and six chances for a partial page —
 * where the sponsors band renders and the testimonials band is missing, which
 * looks like a design decision rather than a failure.
 *
 * Events are deliberately NOT in here. They come from `/public/events`, which
 * already exists, is already paginated and filtered, and has a different
 * lifetime: the featured rail changes when an organizer publishes, the sponsor
 * list changes when an admin saves. Folding them together would mean every new
 * event drops the whole page's cache.
 *
 * EVERY PART FAILS INDEPENDENTLY. This is the first thing a crawler indexes and
 * the first thing a share link opens; a slow statistic must not be able to 500
 * it. Each section resolves to its empty value on failure and the page renders
 * the rest.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── GET /public/landing ────────────────────────────────────────────────────
async function landing(req, res, next) {
  try {
    const [content, cats, sponsors, testimonials, stats] = await Promise.all([
      storefront.content().catch((err) => {
        logger.warn({ err: err.message }, 'landing content failed; falling back to defaults');
        // Not an empty object: the page must still have a headline. `content()`
        // merges defaults, so its failure is the one case where the caller has
        // to reach for them itself.
        return require('../utils/landingSchema').allDefaults();
      }),
      categories.list({ enabledOnly: true }).catch(() => []),
      storefront.listSponsors({ publicOnly: true }).catch(() => []),
      storefront.listTestimonials({ publicOnly: true }).catch(() => []),
      platformStats().catch(() => null),
    ]);

    return sendOk(res, {
      content,
      // `imagePath` is the storage object key — the admin console's business,
      // not a public page's. Dropped here rather than in the service, because
      // the service is also what the admin console reads.
      categories: cats.map(({ slug, label, blurb, imageUrl }) => ({ slug, label, blurb, imageUrl })),
      sponsors,
      testimonials,
      stats,
    });
  } catch (err) { return next(err); }
}

/**
 * The city and country of every upcoming published event that names a city.
 * In pages: these two reads used `.limit(5000)`, which the Data API cuts to 1,000
 * without saying so (utils/fetchAll.js).
 */
function upcomingCities() {
  const now = new Date().toISOString();
  return fetchAll(({ from, to }, first) => supabase
    .from('events')
    .select('id, city, country', first ? { count: 'exact' } : undefined)
    .eq('status', 'published')
    .not('city', 'is', null)
    .gte('ends_at', now)
    .order('id')
    .range(from, to), { what: 'event cities' });
}

// ─── GET /public/cities ─────────────────────────────────────────────────────
/**
 * The cities that have something on, for the hero's location picker.
 *
 * Derived from published events rather than from a list of cities somebody
 * maintains. A picker offering a city with nothing in it is a picker that
 * returns an empty listing, which reads as a broken search rather than as an
 * empty calendar.
 *
 * Counted and sorted by how much is on, so the busiest city is the first
 * suggestion. The country travels with each one because "London" is a
 * different answer in CA than in the UK, and the picker has to be able to say
 * which it means.
 */
async function cities(req, res, next) {
  try {
    const data = await upcomingCities();

    const byKey = new Map();
    for (const row of data || []) {
      const name = String(row.city || '').trim();
      if (!name) continue;
      // Case-folded key, original spelling kept: an organizer typing "toronto"
      // must not create a second city, and the one shown should still read
      // "Toronto".
      const key = `${name.toLowerCase()}|${row.country}`;
      const entry = byKey.get(key);
      if (entry) entry.events += 1;
      else byKey.set(key, { city: name, country: row.country, events: 1 });
    }

    const list = [...byKey.values()]
      .sort((a, b) => b.events - a.events || a.city.localeCompare(b.city))
      .slice(0, 60);

    return sendOk(res, { cities: list });
  } catch (err) { return next(err); }
}

// ─── GET /public/cities/nearest ─────────────────────────────────────────────
/**
 * "What is on near me", answered without a geocoder.
 *
 * The visitor's browser supplies the coordinates; this compares them against
 * the cities that ACTUALLY HAVE EVENTS and returns the closest one, which the
 * storefront then uses as a plain `?city=` filter. There is no third party in
 * the path and nothing is written down — see `utils/cityCoordinates.js` for why
 * that mattered enough to ship a table.
 *
 * THE COORDINATES ARE NOT STORED, not logged, and not passed anywhere. They
 * exist for the length of this function.
 *
 * Three distinct answers, because they need three different sentences in the
 * UI and collapsing them into "no results" is how a working feature looks
 * broken:
 *   • a city, with its distance      — filter by it
 *   • `city: null, reason: 'none'`   — nothing on sale anywhere right now
 *   • `city: null, reason: 'unmapped'` — we have events, but in places this
 *     build cannot place on a map. Honest, and it tells us to add a row.
 */
async function nearestCity(req, res, next) {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);

    // Validated in the route too; repeated here because a NaN reaching the
    // haversine returns NaN and would silently pick the first candidate.
    if (!Number.isFinite(lat) || !Number.isFinite(lng)
      || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return sendFail(res, {
        status: 400, error: 'VALIDATION_ERROR', message: 'Send a latitude and a longitude.',
      });
    }

    const data = await upcomingCities();

    const seen = new Map();
    for (const row of data || []) {
      const city = String(row.city || '').trim();
      if (city) seen.set(`${city.toLowerCase()}|${row.country}`, { city, country: row.country });
    }

    if (seen.size === 0) return sendOk(res, { city: null, reason: 'none' });

    const match = geo.nearest(lat, lng, [...seen.values()]);
    if (!match) return sendOk(res, { city: null, reason: 'unmapped' });

    return sendOk(res, { city: match.city, country: match.country, distanceKm: match.distanceKm });
  } catch (err) { return next(err); }
}

// ─── GET /public/events/near ────────────────────────────────────────────────
/**
 * "What is on near me", answered in full.
 *
 * `/public/cities/nearest` returns one city and stops. That is enough to build
 * a filter and not enough to build an ANSWER: the interesting cases are
 * "fourteen events, twelve kilometres away" and "nothing within a hundred
 * kilometres, and the closest is in Toronto, four hundred away". A caller that
 * only learns the nearest city cannot tell those apart, so the dialog that asks
 * for a location cannot say anything useful when the answer is disappointing.
 *
 * So this returns the whole picture, grouped by city and sorted by distance:
 *
 *   places[]   every city with something on, with its event count and how far
 *              it is. Sorted nearest first.
 *   within[]   the subset inside `radiusKm`.
 *   nearest    the closest place, whether or not it is within the radius —
 *              this is what makes "nothing near you, but there is something in
 *              X" possible to say.
 *   unmapped   how many cities have events but no coordinates we hold, so the
 *              UI can be honest that the answer is partial rather than
 *              pretending it is complete.
 *
 * THE COORDINATES ARE NOT STORED, not logged, and not passed to anybody. They
 * exist for the length of this function. See `utils/cityCoordinates.js` for why
 * there is no geocoder in the path.
 */
async function eventsNear(req, res, next) {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    // Bounded: a caller asking for a 20,000km radius is asking for "everything"
    // and should say so by not passing a radius at all.
    const radiusKm = Math.min(Math.max(Number(req.query.radiusKm) || 100, 5), 2000);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)
      || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return sendFail(res, {
        status: 400, error: 'VALIDATION_ERROR', message: 'Send a latitude and a longitude.',
      });
    }

    /**
     * ───────────────────────────────────────────────────────────────────────
     * THE EVENT'S OWN COORDINATES COME FIRST, AND THEY WERE NOT READ AT ALL.
     *
     * This selected `city, country` and nothing else, so every distance in the
     * answer was measured to a CITY CENTROID out of a hardcoded table of 146
     * names. Two things followed, and both were reported as "near me does not
     * work":
     *
     *   · ACCURACY. `events.venue_lat/lng` exist, are returned by
     *     `/public/events/:slug` as `venueLocation`, and draw the map on the
     *     event page — the exact spot was already known and this threw it away.
     *     A venue at one end of a large city and a visitor at the other were
     *     told "0 km".
     *
     *   · VISIBILITY. An event with real coordinates does not need a city to
     *     be found at all, and `.not('city', 'is', null)` dropped it anyway.
     *
     * The city table stays as the FALLBACK. Most organizers type a city and
     * never pin a venue, and a centroid is a good answer to "which city" — it
     * is only a bad answer to "how far".
     *
     * WHAT THIS DOES NOT FIX, and it has to be said here because the symptom
     * looks identical: an event with NO city AND NO coordinates cannot be
     * placed by anything. Three published events are in that state today. The
     * cure for those is data, not code — see `submissionBlockers`, which has
     * required a city since before this was written, and the events that
     * predate it.
     * ───────────────────────────────────────────────────────────────────────
     */
    // Every upcoming event, in pages — `.limit(5000)` was capped at 1,000 by the
    // Data API without a word (utils/fetchAll.js). The full card columns, because
    // this now answers with the events themselves as well as the places.
    const now = new Date().toISOString();
    const data = await fetchAll(({ from, to }, first) => supabase
      .from('events')
      .select(discovery.SELECT, first ? { count: 'exact' } : undefined)
      .eq('status', 'published')
      .gte('ends_at', now)
      .order('id')
      .range(from, to), { what: 'events' });

    /**
     * Grouped by city, because that is what the caller renders and what a
     * visitor picks — but the DISTANCE of a group is the distance to its
     * CLOSEST event, not to the middle of the city.
     *
     * An event with coordinates contributes its own point. One without falls
     * back to the centroid. A city holding both reports whichever is nearer,
     * which is the honest reading of "the closest thing on in this city".
     *
     * A GROUP IS STILL KEYED BY CITY NAME, including for an event that has
     * coordinates but no city — it is counted in `unmapped` rather than given
     * a nameless group. `places[]` is a picker: the client renders
     * `?city=<name>` links from it, so an entry with a null name would render
     * the word "null" and link to a filter that matches nothing. Being honest
     * that the answer is partial is better than a row nobody can use.
     */
    const byKey = new Map();
    const cityGroups = [];       // groups that may still need the centroid
    for (const row of data || []) {
      const city = String(row.city || '').trim();
      const hasPoint = row.venue_lat !== null && row.venue_lat !== undefined
        && row.venue_lng !== null && row.venue_lng !== undefined;

      // Nothing to place it by, named or measured.
      if (!city) continue;

      const key = `${city.toLowerCase()}|${row.country}`;
      const seen = byKey.get(key);
      const entry = seen || {
        city,
        country: row.country,
        events: 0,
        // Infinity so the first real measurement always wins.
        best: Infinity,
        anyPoint: false,
      };
      entry.events += 1;

      if (hasPoint) {
        entry.anyPoint = true;
        const d = geo.distanceKm(lat, lng, Number(row.venue_lat), Number(row.venue_lng));
        if (d < entry.best) entry.best = d;
      }

      if (!seen) {
        byKey.set(key, entry);
        cityGroups.push(entry);
      }
    }

    // Events with no city at all. They cannot appear in a city picker, but the
    // count is what lets the dialog say the answer is incomplete.
    const cityless = (data || []).filter((r) => !String(r.city || '').trim()).length;

    /**
     * ─────────────────────────────────────────────────────────────────────────
     * THE EVENTS THEMSELVES, NEAREST FIRST — what "near you" on the homepage
     * shows by default (2026-10-15).
     *
     * `places` answers "which city"; a person deciding what to do on Friday
     * wants the events. Each one is measured to its own venue when the organizer
     * pinned it (`precise: true`), and to its city's centroid otherwise
     * (`precise: false`), so the client can say "about 12 km" honestly. An event
     * that can be placed by neither is left out rather than guessed at.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const limit = Math.min(Math.max(Number(req.query.limit) || 8, 1), 24);
    const placed = [];
    for (const row of data) {
      const hasPoint = row.venue_lat !== null && row.venue_lat !== undefined
        && row.venue_lng !== null && row.venue_lng !== undefined;
      let distance = null;
      if (hasPoint) {
        distance = geo.distanceKm(lat, lng, Number(row.venue_lat), Number(row.venue_lng));
      } else if (String(row.city || '').trim()) {
        const known = geo.locate(String(row.city).trim(), row.country);
        if (known) distance = geo.distanceKm(lat, lng, known.lat, known.lng);
      }
      if (distance !== null && distance <= radiusKm) placed.push({ row, distance, precise: hasPoint });
    }
    placed.sort((a, b) => a.distance - b.distance
      || new Date(a.row.starts_at) - new Date(b.row.starts_at));
    const nearby = placed.slice(0, limit);
    const fromPrices = await discovery.lowestTierPrices(nearby.map((p) => p.row.id));
    const events = nearby.map(({ row, distance, precise }) => ({
      ...discovery.shape(row),
      fromPriceCents: fromPrices.get(row.id) ?? null,
      // One decimal under 10 km, where the difference is a walk; whole
      // kilometres beyond.
      distanceKm: distance < 10 ? Math.round(distance * 10) / 10 : Math.round(distance),
      precise,
    }));

    if (byKey.size === 0) {
      return sendOk(res, {
        places: [], within: [], nearest: null, unmapped: cityless, radiusKm, events,
      });
    }

    // The centroid fallback, for groups where no event carried a point of its
    // own. Looked up once per city, as before.
    for (const entry of cityGroups) {
      if (entry.best !== Infinity) continue;
      const known = geo.locate(entry.city, entry.country);
      if (known) entry.best = geo.distanceKm(lat, lng, known.lat, known.lng);
    }

    let unmapped = cityless;
    const places = [];
    for (const entry of byKey.values()) {
      // Still unplaceable: no coordinates, and a city name the table does not
      // hold. Counted so the dialog can say the answer is partial.
      if (entry.best === Infinity) { unmapped += 1; continue; }
      places.push({
        city: entry.city,
        country: entry.country,
        events: entry.events,
        distanceKm: Math.round(entry.best),
        // Lets the client distinguish "12km from the door" from "12km from the
        // middle of a city we guessed". Nothing renders it yet; it is here so
        // that when something does, the answer is already in the payload.
        precise: entry.anyPoint,
      });
    }

    places.sort((a, b) => a.distanceKm - b.distanceKm);

    return sendOk(res, {
      places: places.slice(0, 20),
      within: places.filter((p) => p.distanceKm <= radiusKm),
      nearest: places[0] || null,
      unmapped,
      radiusKm,
      events,
    });
  } catch (err) { return next(err); }
}

// ─── POST /public/visit ─────────────────────────────────────────────────────
/**
 * The visit counter behind the "visits" statistic.
 *
 * WHY THIS EXISTS AT ALL: the storefront brief asked for real statistics and
 * named visits as one. Every other figure on the strip is already countable —
 * events, organizers, tickets, cities. Visits were the one number nothing in
 * the database could answer, so the choice was to invent one or to start
 * counting. Inventing one is the thing the brief ruled out.
 *
 * WHAT IS RECORDED: a path, a day, and a salted hash. Nothing else. The hash is
 * sha256(ip + user-agent + IP_HASH_SALT + the day), so it cannot be reversed to
 * an address, cannot be joined to an account, and is a different value tomorrow
 * for the same visitor — which means no history of any one person can be
 * assembled from this table even by someone holding it.
 *
 * ALWAYS 204, even on failure. It is fired from a page that has already
 * rendered; an error here must never become a console error on a homepage, and
 * there is nothing the caller could usefully do about it.
 */
async function recordVisit(req, res) {
  try {
    const path = normalisePath(req.body?.path);
    if (!path) return res.status(204).end();

    const salt = process.env.IP_HASH_SALT;
    // Fails CLOSED. Without a salt the hash is a plain digest of an address,
    // which is reversible by anyone with a list of addresses — a worse outcome
    // than not counting.
    if (!salt) return res.status(204).end();

    const day = new Date().toISOString().slice(0, 10);
    const visitorHash = crypto
      .createHash('sha256')
      .update(`${req.ip || ''}|${req.get('user-agent') || ''}|${salt}|${day}`)
      .digest('hex');

    const { error } = await supabase.rpc('record_site_visit', {
      p_path: path,
      p_visitor_hash: visitorHash,
    });
    if (error) logger.debug({ err: error.message }, 'visit not recorded');
  } catch (err) {
    logger.debug({ err: err.message }, 'visit not recorded');
  }
  return res.status(204).end();
}

/**
 * A path, or nothing.
 *
 * The client sends this, so it is a string from outside. Query strings and
 * fragments are stripped — they carry search terms and, on a ticket link, a
 * signed token. A counter that stores what people searched for is a different
 * product with different obligations.
 */
function normalisePath(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().split('?')[0].split('#')[0];
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return null;
  if (trimmed.length > 200) return null;
  if (!/^[\w\-/.]*$/.test(trimmed.slice(1))) return null;
  return trimmed;
}

module.exports = { landing, cities, nearestCity, eventsNear, recordVisit, normalisePath };
