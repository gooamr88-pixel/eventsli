import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { securityHeaders } from './config/csp.mjs';

/**
 * @type {import('next').NextConfig}
 *
 * Ported from fancy, tightened. Three things here are load-bearing and are
 * commented where they sit: the workspace root, the image allowlist, the CSP.
 *
 * Note there is no `eslint` key. Next 16 dropped it, and the build warns that
 * it is unrecognised. Linting is its own CI step — `npm run lint --workspace=frontend`
 * — which is better anyway: a lint failure should not be indistinguishable
 * from a compile failure in the build log.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * The storage host, baked into both the image allowlist and the CSP at BUILD
 * time — so getting it wrong is not a runtime misconfiguration you can fix with
 * an environment variable and a restart. It is compiled in.
 *
 * The failure it causes is also the quiet kind: every cover image is blocked by
 * `img-src` and refused by `next/image`, on a storefront whose entire job is
 * showing event artwork, with nothing in any server log — the browser console
 * on someone else's machine is the only place it appears.
 *
 * So a production build without it REFUSES TO BUILD, in the same spirit as
 * backend/app.js refusing to boot on a missing secret. A development build
 * falls back, because a laptop without Supabase configured should still run.
 */
const SUPABASE_HOST = (() => {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (!raw) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'NEXT_PUBLIC_SUPABASE_URL is required for a production build.\n'
        + 'It is compiled into the image allowlist and the CSP, so building without it '
        + 'ships a site where every event cover image is silently blocked.',
      );
    }
    return 'localhost';
  }

  try {
    return new URL(raw).hostname;
  } catch {
    throw new Error(`NEXT_PUBLIC_SUPABASE_URL is not a valid URL: ${raw}`);
  }
})();

const API_ORIGIN = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1')
  .replace(/\/api\/v1\/?$/, '');

const isDev = process.env.NODE_ENV !== 'production';

// The policy itself lives in config/csp.mjs, where a test can reach it.
// See the note at the top of that file.

const nextConfig = {
  reactStrictMode: true,

  /**
   * Pin the workspace root.
   *
   * Turbopack infers it from the nearest lockfile and gets it wrong here: there
   * is an unrelated `package-lock.json` sitting in the user's home directory,
   * so it chose `C:\Users\<user>` and warned that it had. That root decides
   * module resolution and which files are traced into the build, so leaving it
   * to a coin flip is not a warning to silence — it is a wrong answer that
   * happened to still compile.
   */
  turbopack: { root: path.join(__dirname, '..') },

  images: {
    /**
     * Covers come from Supabase Storage and nowhere else. An open allowlist
     * turns /_next/image into a free image-resizing proxy for the whole
     * internet, billed to us — and `cover_url` is written only by the API, so
     * there is no legitimate second host to admit.
     */
    remotePatterns: [
      { protocol: 'https', hostname: SUPABASE_HOST, pathname: '/storage/v1/object/public/**' },
    ],
    formats: ['image/webp'],
  },

  /**
   * The old platform's URLs, kept alive.
   *
   * Eventsli replaces a static site whose pages were `.html` files at the web
   * root. Those URLs are in inboxes, in messages, in whatever links the old site
   * had earned, and in Google's index. Dropping them turns every one into a 404
   * — which costs the traffic AND the accumulated ranking, because a 404 tells a
   * crawler the page is gone rather than moved.
   *
   * A 308 says "this is the same thing, at a new address", and passes the
   * ranking on. It is a dozen lines and it is the cheapest SEO work available on
   * a replatform.
   *
   * `/merchant-agreement` is here for a second reason. The old site had a
   * separate merchant agreement document; here that IS the organizer agreement
   * at /terms/organizer, and it is versioned with acceptance recorded against
   * the version (BRD §21). Publishing a second copy under the old name would be
   * a legal document with two texts and one of them unversioned, which is worse
   * than a redirect by a wide margin.
   */
  async redirects() {
    const gone = [
      ['/index.html', '/'],
      ['/events.html', '/events'],
      ['/terms.html', '/terms'],
      ['/privacy.html', '/privacy'],
      ['/my-tickets.html', '/account/tickets'],
      ['/checkout-success.html', '/account/tickets'],
      ['/scanner.html', '/gate'],
      ['/dashboard.html', '/organizer'],
      ['/admin.html', '/admin'],
      ['/merchant-agreement.html', '/terms/organizer'],
      ['/merchant-agreement', '/terms/organizer'],
      // The old detail page identified an event by a UUID in the query string,
      // and slugs did not exist then — so there is nothing to map it to. The
      // listing is the honest destination: the visitor is one search from what
      // they wanted, rather than at a dead end.
      ['/event-detail.html', '/events'],
    ];

    return gone.map(([source, destination]) => ({ source, destination, permanent: true }));
  },

  async headers() {
    return [{
      source: '/:path*',
      // The CSP is not among these — it carries a per-request nonce and is set
      // by proxy.ts. See the note in config/csp.mjs.
      headers: securityHeaders({ isDev }),
    }];
  },

  // The dev server and the API are different origins in development, which is
  // fine — the cookie is sameSite: lax and localhost:3000 / localhost:5000 are
  // the same SITE. No proxy rewrite is needed, and adding one would hide the
  // CORS configuration that production actually depends on.
};

export default nextConfig;
