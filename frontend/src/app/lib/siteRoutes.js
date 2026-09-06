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
  '/organizer',
  '/admin',
  '/gate',
  '/checkout',
  '/t',
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
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
  {
    heading: 'Going out',
    links: [
      { path: '/events', label: 'Browse events' },
      { path: '/how-it-works', label: 'How it works' },
      { path: '/tickets/find', label: 'Find my tickets' },
    ],
  },
  {
    heading: 'Running an event',
    links: [
      { path: '/why-us', label: 'Why Eventsli' },
      { path: '/how-it-works', label: 'Selling with us' },
      { path: '/terms/organizer', label: 'Organizer agreement' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { path: '/trust', label: 'Security and trust' },
      { path: '/contact', label: 'Contact' },
      { path: '/terms', label: 'Ticket terms' },
      { path: '/privacy', label: 'Privacy' },
    ],
  },
];

/** The one address that exists. Everything else would be a promise the mailbox
 *  cannot keep. */
export const CONTACT_EMAIL = 'info@eventsli.com';
