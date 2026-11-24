/**
 * A SHORT-LIVED MEMORY OF PUBLIC LISTS — the same answer for everybody, kept
 * for a few seconds so the next visitor does not wait for it again.
 *
 * The homepage, the attendee app's Home and Explore all open with the same
 * few public reads (/public/vip-events, /public/events?…, /public/cities,
 * /public/event-categories). Each one costs several Supabase round trips —
 * 0.3–0.45 s measured on production (2026-11-24) — and returns exactly the
 * same body to every caller, because none of them reads the session or a
 * cookie. Kept for `ttlMs`, the second caller gets it in a millisecond.
 *
 * ONLY for routes whose answer does not depend on who asks. Keyed by the full
 * URL (path + query), so each filter is its own entry. Only a 200 is kept;
 * an error is never remembered. Bounded to `max` entries, oldest out first.
 * One process, one memory: pm2 runs the API as a single fork.
 */
function microCache(ttlMs, { max = 300, now = () => Date.now() } = {}) {
  const store = new Map();

  function middleware(req, res, next) {
    if (req.method !== 'GET') return next();
    const key = req.originalUrl;
    const hit = store.get(key);
    if (hit && now() - hit.at < ttlMs) {
      res.set('X-Cache', 'HIT');
      return res.status(200).json(hit.body);
    }
    if (hit) store.delete(key);

    const send = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode === 200) {
        if (store.size >= max) store.delete(store.keys().next().value);
        store.set(key, { at: now(), body });
      }
      res.set('X-Cache', 'MISS');
      return send(body);
    };
    return next();
  }

  middleware.clear = () => store.clear();
  middleware.size = () => store.size;
  return middleware;
}

module.exports = { microCache };
