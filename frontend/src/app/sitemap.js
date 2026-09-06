import { serverFetch } from './utils/apiClient';
import { PUBLIC_PAGES } from './lib/siteRoutes';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * /sitemap.xml
 *
 * The static pages come from `siteRoutes.js`; the event pages come from the API,
 * because they are the ones worth crawling and there is no other way to know
 * them.
 *
 * Two properties this file has to keep:
 *
 *   1. IT NEVER FAILS THE ROUTE. A sitemap that 500s when the API is slow is a
 *      sitemap Google stops asking for. An API failure costs the event URLs;
 *      the static ones are still served, and the next fetch fills them back in.
 *
 *   2. IT IS BOUNDED. Paging until the API says stop is fine right up until an
 *      organizer uploads a catalogue; a sitemap has a 50,000-URL ceiling and a
 *      crawler has a patience ceiling well below it. Ten pages of 200 is 2,000
 *      events, which is far more than this platform has and small enough that
 *      the route stays fast. Past that the answer is a sitemap INDEX, not a
 *      bigger loop, and this is where that decision will be made.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const PER_PAGE = 200;   // the API's MAX_LIMIT
const MAX_PAGES = 10;

/**
 * RENDERED PER REQUEST, CACHED PER FETCH — and the split is the point.
 *
 * `export const revalidate = 3600` was the obvious thing to write and it is
 * wrong here, for the same reason it was wrong on /terms. Next prerenders a
 * static route at BUILD time and caches whatever it produced, including a
 * failure: the build talks to no API — CI's build step deliberately points at
 * an unreachable one to prove pages degrade — so the prerender captured the
 * "no events" branch and served an events-free sitemap for an hour after every
 * deploy. A cached MISS is stored exactly like a cached hit.
 *
 * On most pages that is a bad hour. On this one it is the hour immediately
 * after a release, when a crawler that fetches a sitemap a few times a day is
 * most likely to look, and it would be told the catalogue is empty.
 *
 * So the ROUTE is dynamic and the FETCHES inside it are cached for an hour by
 * the data cache. Every request re-renders; at most ten API calls happen per
 * hour no matter how often this URL is hit.
 */
export const dynamic = 'force-dynamic';

const CACHE_SECONDS = 3600;

async function publishedEvents() {
  const collected = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    // Sequential, because each page's existence depends on the last one's
    // `totalPages`. Ten requests at worst, once an hour, off the request path.
    let body;
    try {
      body = await serverFetch(`/public/events?limit=${PER_PAGE}&page=${page}`, {
        raw: true,
        tags: ['events:published'],
        revalidate: CACHE_SECONDS,
      });
    } catch {
      // Property 1. Whatever was collected before the failure is still a valid
      // sitemap; an empty one would tell a crawler the catalogue is gone.
      break;
    }

    const rows = Array.isArray(body?.data) ? body.data : [];
    collected.push(...rows);

    if (rows.length < PER_PAGE) break;
    if (page >= (body?.pagination?.totalPages || 1)) break;
  }

  return collected;
}

export default async function sitemap() {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || 'https://eventsli.com').replace(/\/+$/, '');

  const staticPages = PUBLIC_PAGES.map((p) => ({
    url: `${base}${p.path}`,
    changeFrequency: p.changeFrequency,
    priority: p.priority,
  }));

  const events = (await publishedEvents()).map((event) => ({
    url: `${base}/e/${event.slug}`,
    // The listing's own updated_at, added to the public shape for exactly this.
    // Omitted rather than guessed when the API has not sent one — `startsAt`
    // would look plausible and would be a lie about when the page changed.
    ...(event.updatedAt ? { lastModified: new Date(event.updatedAt) } : {}),
    changeFrequency: 'daily',
    // Above the marketing pages and below the two listings. These are the pages
    // people share and search for; everything else on the site exists to get
    // somebody to one of them.
    priority: 0.8,
  }));

  return [...staticPages, ...events];
}
