const { supabase } = require('../config/supabase');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The browse categories, now that they are rows rather than an enum.
 *
 * `eventRules.EVENT_CATEGORIES` was a frozen array, and its comment said the
 * right thing for the time: one list, read by the validator and the tests, so
 * the enum could not accept a value the validator rejected. The array is gone
 * and the guarantee has to be rebuilt somewhere else — here.
 *
 * THE PROBLEM THIS SOLVES. Validation runs in express-validator, synchronously,
 * on a public endpoint, before any controller. Asking Postgres "is `music` a
 * category" on every request to `/public/events` would put a round trip in
 * front of the most-hit query on the site, to check a set that changes about
 * twice a year.
 *
 * So the set is cached in process, and the cache has two properties that matter
 * more than its speed:
 *
 *   • It is REFRESHED ON WRITE. Every mutation in storefrontService calls
 *     `invalidate()`, so an admin who adds a category can use it immediately
 *     rather than after a timer.
 *   • It FAILS OPEN INTO THE DATABASE, not into a guess. Until the first load
 *     resolves, `knownSlugs()` returns null and callers fall back to letting
 *     the foreign key decide — which is the same answer, one round trip later.
 *     A cache that answers "no such category" because it has not loaded yet
 *     would 400 every request during the first second after a restart.
 *
 * `ON DELETE RESTRICT` on `events.category` is what makes all of this safe to
 * get slightly wrong: the database refuses an unknown category regardless of
 * what this file believes.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Long, because a write invalidates it. The TTL is only a backstop for a
 *  second process — pm2 runs this API in cluster mode, so an admin's write
 *  lands in one worker and the others age out. */
const TTL_MS = 60_000;

const SELECT = 'slug, label, blurb, image_url, image_path, sort_order, is_enabled, created_at, updated_at';

let cache = null;         // { rows, at } — the full set, enabled and not
let inFlight = null;      // de-duplicates a stampede after invalidate()

function shape(row) {
  return {
    slug: row.slug,
    label: row.label,
    blurb: row.blurb || null,
    imageUrl: row.image_url || null,
    imagePath: row.image_path || null,
    sortOrder: row.sort_order,
    isEnabled: row.is_enabled,
  };
}

async function fetchAll() {
  const { data, error } = await supabase
    .from('event_categories')
    .select(SELECT)
    .order('sort_order', { ascending: true })
    .order('label', { ascending: true });

  if (error) throw new Error(error.message);
  return data || [];
}

/**
 * Every category, in display order, cached.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.enabledOnly]  what a public caller wants
 */
async function list({ enabledOnly = false } = {}) {
  const fresh = cache && Date.now() - cache.at < TTL_MS;

  if (!fresh) {
    // One fetch for however many requests arrive while it is in flight. Without
    // this, invalidating under load starts a query per concurrent request.
    inFlight = inFlight || fetchAll()
      .then((rows) => { cache = { rows, at: Date.now() }; return rows; })
      .finally(() => { inFlight = null; });
    await inFlight;
  }

  const rows = cache.rows.map(shape);
  return enabledOnly ? rows.filter((c) => c.isEnabled) : rows;
}

/**
 * The slugs a request may name, or NULL if they are not known yet.
 *
 * Synchronous on purpose: express-validator's `.custom()` can take a promise,
 * but a validator that awaits a network call runs on every request to the
 * listing. Null means "ask the database" — see the note at the top.
 *
 * Disabled categories ARE included. Disabling hides a category from the browse
 * rail; it does not invalidate the links already in inboxes and search results
 * pointing at `/events?category=<slug>`, and answering those with a 400 is a
 * worse outcome than showing an empty listing.
 */
function knownSlugs() {
  if (!cache || Date.now() - cache.at >= TTL_MS) return null;
  return cache.rows.map((r) => r.slug);
}

/**
 * Warm the cache at boot so the first request does not pay for it, and so
 * `knownSlugs()` is populated before any traffic arrives.
 *
 * Never throws: an API that refuses to start because a category list was slow
 * is worse than one that starts and loads it on first use.
 */
async function warm() {
  try { await list(); } catch { /* the first request will retry */ }
}

function invalidate() { cache = null; }

/**
 * An express-validator `.custom()` predicate: the value must be a category this
 * process knows about, when it knows any.
 *
 * Lives here rather than in a route file because BOTH the public listing and
 * the organizer's create/update endpoints need it, and the version that gets
 * copied into the second route file is the one that stops matching the first.
 *
 * Throws with the options listed, because "Unknown category" without them
 * leaves the caller guessing at a set that is now editable and therefore
 * genuinely unguessable.
 */
function assertKnownSlug(value) {
  const slugs = knownSlugs();
  if (!slugs) return true;                       // not loaded — the FK decides
  if (slugs.includes(value)) return true;
  throw new Error(`Unknown category. Choose one of: ${slugs.join(', ')}.`);
}

// ─── Writes ─────────────────────────────────────────────────────────────────
/**
 * Every write invalidates the cache before it returns, so the admin who made
 * the change sees it on the next request rather than within the minute. The
 * other workers age out on the TTL — see the note at the top.
 */

async function create(fields) {
  const row = toRow(fields, { creating: true });
  const { data, error } = await supabase
    .from('event_categories').insert(row).select(SELECT).single();

  if (error) throw error;
  invalidate();
  return shape(data);
}

async function update(slug, fields) {
  const patch = toRow(fields, { creating: false });
  if (Object.keys(patch).length === 0) return null;

  const { data, error } = await supabase
    .from('event_categories').update(patch).eq('slug', slug).select(SELECT).maybeSingle();

  if (error) throw error;
  invalidate();
  return data ? shape(data) : null;
}

/**
 * Refused by the database while events are filed under it — `ON DELETE
 * RESTRICT` on `events.category`. The caller turns that into a sentence naming
 * the count, which is the answer the operator needed before they clicked.
 */
async function remove(slug) {
  const { error, count } = await supabase
    .from('event_categories').delete({ count: 'exact' }).eq('slug', slug);

  if (error) throw error;
  invalidate();
  return (count || 0) > 0;
}

/** How many events would block a delete. Read separately so the refusal can
 *  say "14 events" rather than "this is in use". */
async function eventCount(slug) {
  const { count, error } = await supabase
    .from('events').select('id', { count: 'exact', head: true }).eq('category', slug);
  if (error) throw new Error(error.message);
  return count || 0;
}

function toRow(fields, { creating }) {
  const row = {};
  if (fields.slug !== undefined) row.slug = String(fields.slug).trim().toLowerCase();
  if (fields.label !== undefined) row.label = String(fields.label).trim();
  if (fields.blurb !== undefined) row.blurb = nullIfEmpty(fields.blurb);
  if (fields.sortOrder !== undefined) row.sort_order = Number(fields.sortOrder);
  if (fields.isEnabled !== undefined) row.is_enabled = !!fields.isEnabled;
  // The URL and its storage key move together, matching the table's CHECK.
  if (fields.imageUrl !== undefined || fields.imagePath !== undefined) {
    row.image_url = nullIfEmpty(fields.imageUrl);
    row.image_path = nullIfEmpty(fields.imagePath);
  }
  if (creating && (!row.slug || !row.label)) {
    const err = new Error('A category needs an id and a name.');
    err.code = 'VALIDATION_ERROR';
    throw err;
  }
  return row;
}

const nullIfEmpty = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

module.exports = {
  list, knownSlugs, assertKnownSlug, warm, invalidate,
  create, update, remove, eventCount,
};
