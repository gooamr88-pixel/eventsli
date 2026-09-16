const logger = require('../utils/logger');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Telling Next to drop a cached page.
 *
 * `frontend/src/app/api/internal/revalidate/route.js` has existed since the
 * storefront was built, both `.env` files carry `REVALIDATE_SECRET`, and
 * `apiClient.serverFetch` tags every response so this can work. Nothing ever
 * called it. The receiving end was complete and the sending end did not exist,
 * which is the hardest kind of gap to notice: every piece looks right on its
 * own, and the only symptom is a page that is a minute out of date.
 *
 * It matters most for exactly this feature. A CMS whose changes appear
 * "within a minute" is a CMS the operator does not believe — they save, they
 * look, nothing moved, they save again. The landing page caches for 60 seconds
 * because it should; this is what makes an admin's save an exception to that
 * rather than a reason to stop caching.
 *
 * NEVER THROWS, and never blocks the write.
 * The change is already committed by the time this runs. A failure here means a
 * page is stale for up to its revalidate window — which is precisely the
 * behaviour the system has without this file at all. Failing the admin's save
 * because a cache hint did not land would turn a cosmetic delay into a lost
 * edit.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** 3 seconds. This is a hint to a process on the same box; if loopback is
 *  taking longer than that, something is wrong that waiting will not fix. */
const TIMEOUT_MS = 3000;

/**
 * The frontend's own address, over loopback.
 *
 * `FRONTEND_URL` is the public origin and is the right default: in development
 * it IS localhost:3000. In production the request should not leave the box —
 * nginx routes every `/api/*` path on the public hostname to this API, so a
 * public-hostname call would arrive back here rather than at Next, and the
 * handler would never run.
 */
function target() {
  return process.env.REVALIDATE_URL
    || `${(process.env.FRONTEND_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '')}/api/internal/revalidate`;
}

/**
 * @param {string[]} tags  the `next: { tags }` values to drop
 */
async function revalidate(tags) {
  const secret = process.env.REVALIDATE_SECRET;
  const list = (Array.isArray(tags) ? tags : [tags]).filter(Boolean);
  if (list.length === 0) return false;

  if (!secret) {
    // Warn once per call rather than silently doing nothing: a deployment
    // missing this variable has a CMS whose saves take a minute to appear, and
    // there would otherwise be no evidence anywhere of why.
    logger.warn('REVALIDATE_SECRET is not set — cached pages will age out instead of updating now');
    return false;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(target(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-revalidate-secret': secret },
      body: JSON.stringify({ tags: list }),
      signal: controller.signal,
    });

    if (!response.ok) {
      logger.warn({ status: response.status, tags: list }, 'revalidate refused');
      return false;
    }
    logger.debug({ tags: list }, 'revalidated');
    return true;
  } catch (err) {
    // Includes the common and harmless case: the API is running and the web
    // server is not, which is every backend-only test run and every deploy
    // where the two restart in sequence.
    logger.debug({ err: err.message, tags: list }, 'revalidate could not be delivered');
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** The one tag the landing page's data is stored under. Named here so the
 *  writers and the page cannot disagree about its spelling. */
const LANDING_TAG = 'landing';

module.exports = { revalidate, LANDING_TAG };
