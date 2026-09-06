import { PRIVATE_PREFIXES } from './lib/siteRoutes';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * /robots.txt
 *
 * The disallow list is not hand-written here — it is `PRIVATE_PREFIXES`, the
 * same list the sitemap excludes and the same one a test checks against the
 * pages actually on disk. Two hand-maintained lists is how `/t/` ends up in one
 * and not the other, and `/t/<token>` is a signed admission credential in a URL.
 *
 * NOT a security control, and worth saying out loud: robots.txt is a request to
 * well-behaved crawlers. Every one of these prefixes is enforced properly
 * elsewhere — `proxy.ts` redirects, the API re-checks the session on every
 * request, and a ticket token is verified rather than trusted. This file exists
 * so a polite crawler does not waste its budget on pages it will only be
 * redirected away from, and does not put a ticket URL in a log.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function robots() {
  const base = process.env.NEXT_PUBLIC_SITE_URL || 'https://eventsli.com';

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        /**
         * TWO PATTERNS PER PREFIX, and the pair is the point.
         *
         * A robots.txt path is a prefix match, so a bare `/t` also matches
         * `/terms` — a legal document that must stay indexable, de-indexed by a
         * missing character nobody would notice for a year. Writing only `/t/`
         * fixes that and introduces the opposite hole: `/login/` does not match
         * `/login`, which is the actual page.
         *
         * So: `/x/` for the subtree, and `/x$` — end-of-URL, RFC 9309 — for the
         * page itself. Neither can over-reach.
         */
        disallow: PRIVATE_PREFIXES.flatMap((p) => [`${p}/`, `${p}$`]),
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
