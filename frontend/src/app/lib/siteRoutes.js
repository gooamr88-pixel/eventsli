/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The public surface of the site, declared once.
 *
 * `sitemap.js`, `robots.js` and the footer all read this file. That is the whole
 * point: the three of them disagreeing is the classic SEO failure, and it is
 * silent — a page nobody links to, a page in the sitemap that 404s, or worst, a
 * private route a crawler was never told to leave alone.
 *
 * A test walks `src/app` and fails if a page exists on disk that is neither
 * listed here nor covered by a private prefix. Adding a route therefore has to
 * be a decision about whether it is public, rather than something discovered
 * months later in Search Console.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Pages a crawler should have.
 *
 * `changeFrequency` and `priority` are hints and no more — Google has said for
 * years that it largely ignores them. They are set anyway because other crawlers
 * do read them and the cost is a word. `lastModified` is the field that actually
 * earns its place, and it is only set where there is something honest to put in
 * it.
 */
export const PUBLIC_PAGES = [
  { path: '/', changeFrequency: 'hourly', priority: 1.0 },
  { path: '/events', changeFrequency: 'hourly', priority: 0.9 },
  { path: '/how-it-works', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/why-us', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/trust', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/contact', changeFrequency: 'yearly', priority: 0.5 },
  { path: '/tickets/find', changeFrequency: 'yearly', priority: 0.4 },
  { path: '/terms', changeFrequency: 'yearly', priority: 0.3 },
  { path: '/terms/organizer', changeFrequency: 'yearly', priority: 0.3 },
  { path: '/privacy', changeFrequency: 'yearly', priority: 0.3 },
];

/**
 * Everything a crawler must stay out of, and why each one is here:
 *
 *   /account /organizer /admin   signed-in only; a crawler gets a login redirect
 *   /gate                        a device's screen, not a page
 *   /checkout                    a live hold with somebody's seats in it
 *   /t                           THE IMPORTANT ONE. A ticket URL contains the
 *                                signed admission token. It is a bearer
 *                                credential in a path segment, and a crawler
 *                                that fetches one puts it in a log, a cache and
 *                                possibly an index.
 *   /login /register /forgot-password /reset-password
 *                                nothing to index, and a reset link is
 *                                single-use — a crawler following one burns it
 *   /api                         not pages
 */
export const PRIVATE_PREFIXES = [
  '/account',
  /**
   * `/events/saved` — the browser's own saved list, which lives in
   * localStorage and therefore does not exist on the server.
   *
   * Not private because it is secret; private because there is NOTHING THERE
   * to crawl. A bot fetching it gets the empty state, and an indexed
   * "Saved events" result would send a stranger to a page describing a list
   * that is not theirs.
   *
   * It sits above `/events` in no meaningful way — `isPrivatePath` matches on
   * the full segment, so this excludes `/events/saved` and its children while
   * leaving `/events` itself in the sitemap.
   */
  '/events/saved',
  '/organizer',
  '/admin',
  '/gate',
  '/checkout',
  '/t',
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/activate',
  '/api',
];

export function isPrivatePath(path) {
  return PRIVATE_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * The footer, in the order it reads.
 *
 * Every `path` here must appear in PUBLIC_PAGES — a footer link to a page the
 * sitemap does not know about is a page nothing else points at either.
 */
export const FOOTER_GROUPS = [
  /* The four columns of the owner's footer mockup (2026-10-17). The mockup
     also lists Organizers, Cities, Venues, Pricing, Blog, Careers, Press and
     a cookie policy; none of those pages exists, so none is here. */
  {
    heading: 'Explore',
    links: [
      { path: '/events', label: 'Events' },
      { path: '/how-it-works', label: 'How it works' },
      { path: '/tickets/find', label: 'Find my tickets' },
    ],
  },
  {
    heading: 'For organizers',
    links: [
      { path: '/why-us', label: 'Why Eventsli' },
      { path: '/how-it-works', label: 'Selling with us' },
      { path: '/trust', label: 'Security and trust' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { path: '/why-us', label: 'About' },
      { path: '/contact', label: 'Contact' },
    ],
  },
  {
    heading: 'Legal',
    links: [
      { path: '/terms', label: 'Ticket terms' },
      { path: '/terms/organizer', label: 'Organizer agreement' },
      { path: '/privacy', label: 'Privacy policy' },
    ],
  },
];

/**
 * The brand's social profiles, in the order the footer shows them.
 *
 * EMPTY UNTIL THE ACCOUNTS EXIST. An icon linking to a profile that does not
 * exist is a dead end on every page of the site, so the footer renders the
 * row only for entries here. `network` is one of: instagram, x, facebook,
 * linkedin, youtube.
 *
 *   { network: 'instagram', href: 'https://www.instagram.com/…' },
 */
export const SOCIAL_LINKS = [];

/**
 * The brand's tagline, as the brand guide sets it under the wordmark.
 *
 * It was "Events for a brighter tomorrow." until 2026-10-16, when Via
 * Marketing's guide made DISCOVER - BOOK - ENJOY part of the logo lockup. It is
 * spelled the way the artwork spells it, capitals and hyphens, because it is
 * drawn as part of the logo (`brand/Logo.jsx` reads it from here) rather than
 * set as a sentence.
 *
 * In source rather than in the CMS: it is part of the logo, and the guide says
 * the logo does not change.
 */
export const TAGLINE = 'DISCOVER - BOOK - ENJOY';

/** The one address that exists. Everything else would be a promise the mailbox
 *  cannot keep. */
export const CONTACT_EMAIL = 'info@eventsli.com';
