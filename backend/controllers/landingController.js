const crypto = require('crypto');
const { supabase } = require('../config/supabase');
const { sendOk } = require('../utils/responseEnvelope');
const storefront = require('../services/storefrontService');
const categories = require('../services/categoryService');
const { platformStats } = require('../services/statsService');
const logger = require('../utils/logger');

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
    const { data, error } = await supabase
      .from('events')
      .select('city, country')
      .eq('status', 'published')
      .not('city', 'is', null)
      .gte('ends_at', new Date().toISOString())
      .limit(5000);

    if (error) throw new Error(error.message);

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

module.exports = { landing, cities, recordVisit, normalisePath };
