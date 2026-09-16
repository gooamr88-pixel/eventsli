/**
 * ═══════════════════════════════════════════════════════════════════════════
 * The Content Security Policy, as a function.
 *
 * It lived inside next.config.mjs, where it could not be tested: the config
 * evaluates once, at build time, with `isDev` read from the ambient
 * environment — so a test running under NODE_ENV=test could only ever see the
 * DEVELOPMENT policy, which is the permissive one. The production policy, the
 * one that actually protects anybody, was the one no assertion could reach.
 *
 * Now it takes its inputs and returns a string. next.config.mjs calls it with
 * the real values; the test calls it with `isDev: false` and checks the
 * promises this project has made about it — no `unsafe-inline` on scripts, no
 * CDN, nobody frames us.
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Google Identity Services, for "Sign in with Google".
 *
 * Two entries, and they are the ONLY third party the policy admits. The script
 * is the sign-in client; the frame is what GIS renders its button and its
 * consent flow inside. Neither is optional if the feature exists at all — and
 * the feature is not optional either, because the API already supports
 * `POST /auth/google` and the client id is provisioned.
 *
 * Note what is NOT added: `connect-src`. The ID token is handed to our own API
 * and verified there against Google's keys, so the browser never calls Google
 * with anything of ours.
 */
export const GOOGLE = 'https://accounts.google.com';

/**
 * The two video hosts the storefront's introduction film may come from.
 *
 * ADDED 2026-09-16 with the video section. They are here because the section
 * exists at all, and they are EXACTLY the two `backend/utils/landingSchema.js`
 * accepts — that is not a coincidence to be maintained by hand, it is the
 * point: a URL the schema saves and the policy blocks is the worst outcome
 * available, because the section looks configured and is blank for everybody.
 *
 * `youtube-nocookie.com` is NOT here. It would be the better host, but the
 * schema does not accept it, and admitting a host nothing can be saved against
 * is a standing permission for no benefit. Add it to both or neither.
 */
export const VIDEO_FRAMES = 'https://www.youtube.com https://player.vimeo.com';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE NONCE, AND THE BUG THAT MADE IT NECESSARY.
 *
 * `script-src 'self'` with no nonce does not merely fail to protect a Next.js
 * app — it breaks it, and only in production.
 *
 * The App Router streams the React payload to the browser inside INLINE
 * `<script>` tags (`self.__next_f.push(...)`). Under a strict policy every one
 * of them is refused. The server HTML still renders, so the page looks correct
 * and a crawler is perfectly happy — Lighthouse scored SEO 100 on a page whose
 * JavaScript was entirely dead. Nothing hydrates: the header never learns who
 * is signed in, the seat map does not draw, the countdown does not count, the
 * checkout button does nothing.
 *
 * It was invisible for eight phases because `isDev` is true under `next dev`,
 * where the policy carries 'unsafe-inline' for the dev overlay. It appears only
 * under `next start`, which is to say only in production. Found by reading the
 * browser console during the phase 9 accessibility sweep: fourteen blocked
 * inline scripts and one `Error: Connection closed.` from React's flight
 * reader.
 *
 * A nonce is the documented fix and it has a real cost, stated here rather than
 * discovered later: a nonce is per-request, so every page becomes dynamically
 * rendered. Static prerendering of routes is gone. What is NOT gone is the data
 * cache — `serverFetch`'s tagged, revalidating fetches are a separate cache and
 * still work exactly as before, so a re-render is a re-render, not a re-fetch.
 * On this app that is a cheap trade: the pages that matter most (`/e/[slug]`,
 * `/events`, the checkout) were already dynamic, and the ones that were static
 * are marketing copy with no data behind them.
 *
 * `'strict-dynamic'` is deliberately NOT used. It would make browsers ignore
 * the host allowlist, and the usual recipe restores compatibility by adding
 * `https:` and `'unsafe-inline'` as CSP2 fallbacks — putting the exact string
 * this project promised to keep out back into the header, where the next person
 * to read it has to work out that it is inert. A nonce plus a two-entry
 * allowlist is simpler and says what it means.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * @param {object} opts
 * @param {boolean} opts.isDev
 * @param {string}  opts.apiOrigin       e.g. https://api.eventsli.com
 * @param {string}  opts.supabaseHost    hostname only
 * @param {string}  [opts.nonce]         per-request, from proxy.ts
 */
export function buildCsp({ isDev, apiOrigin, supabaseHost, nonce }) {
  return [
    "default-src 'self'",

    /**
     * `'unsafe-inline'` on script-src exists ONLY in development, where Next's
     * dev overlay and fast-refresh runtime need it. In production it is gone,
     * and keeping it gone is what this file protects.
     *
     * The previous platform needed it permanently because its pages carried
     * inline <script> blocks — dashboard.html alone was 146KB of them — and
     * `esm.sh` was in its script-src because the seat map imported panzoom from
     * a CDN at runtime, inside the purchase path. Neither is true here and
     * neither may come back.
     *
     * `https://apis.google.com` was here and is gone. Nothing loads from it:
     * GoogleSignIn.jsx pulls one script, `accounts.google.com/gsi/client`. The
     * third entry was vestigial — `apis.google.com/js/platform.js` is the OLD
     * Google Sign-In library, which this codebase never used. A host in
     * script-src that nothing loads from is a standing permission for any
     * injection to fetch executable code, and it is invisible: removing it
     * cannot break anything that exists, which is exactly why such entries
     * survive audits.
     */
    [
      "script-src 'self'",
      GOOGLE,
      // The nonce Next stamps on its own inline payload scripts. Absent in
      // development, where 'unsafe-inline' covers them and the dev overlay.
      nonce ? `'nonce-${nonce}'` : '',
      isDev ? "'unsafe-inline' 'unsafe-eval'" : '',
    ].filter(Boolean).join(' '),

    /**
     * `style-src 'unsafe-inline'` STAYS, and it is an argued exception rather
     * than an oversight.
     *
     * Next injects the @font-face block and the critical CSS as inline
     * <style>, and the App Router has no nonce plumbing for it today. The
     * alternative is a flash of unstyled text on every first paint, paid by
     * every visitor.
     *
     * The trade is real because the two are not comparable: an injected SCRIPT
     * reads the session and speaks to the API as the viewer; an injected STYLE
     * restyles a page. Neither is nothing, and only one of them ends with
     * somebody's tickets.
     */
    "style-src 'self' 'unsafe-inline'",

    // apiOrigin is here for the admission QR, an <img> served by
    // `GET /public/qr/:token`. In production that is same-origin and 'self'
    // already covers it; in development the page is :3000 and the API is
    // :5000, so without this every ticket renders a broken image on a
    // developer's machine and nowhere else — the worst kind of
    // environment-only bug.
    `img-src 'self' data: blob: ${apiOrigin} https://${supabaseHost}`,
    "font-src 'self' data:",
    `connect-src 'self' ${apiOrigin} https://${supabaseHost}`,

    /**
     * The gate's service worker, stated rather than inherited.
     *
     * `worker-src` falls back through child-src to script-src, which already
     * allows 'self', so this changes nothing today. It is here so a future
     * tightening of script-src cannot silently break offline scanning at a
     * door — the failure would be a tablet that will not open its own page,
     * discovered by whoever is holding it.
     */
    "worker-src 'self'",
    "manifest-src 'self'",

    /**
     * The storefront's introduction film, when it is a FILE rather than an
     * embed — `landingSchema` accepts an .mp4 or .webm, and one uploaded
     * through the admin console lives in our own storage bucket.
     *
     * This used to be `'none'`, with the note that nothing on the site plays
     * audio or video. That stopped being true when the video section landed.
     */
    `media-src 'self' ${supabaseHost ? `https://${supabaseHost}` : ''}`.trim(),

    // Stripe Checkout is a full-page redirect, not an iframe, so it needs
    // nothing here. Google Identity Services does: its button and consent flow
    // are an iframe. YouTube and Vimeo do, for the introduction film — and
    // nothing is framed until a visitor presses play. See VideoBand.
    `frame-src ${GOOGLE} ${VIDEO_FRAMES}`,

    // Nobody frames US, in either case. This is the clickjacking guard and it
    // stays absolute — a checkout inside someone else's iframe is the whole
    // attack.
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",

    /**
     * Production only: an http:// subresource that slipped into a template is
     * fetched over https instead of being blocked as mixed content. In
     * development everything is http://localhost and this would break the API.
     *
     * Not a substitute for getting the URLs right — it is the net under it.
     */
    ...(isDev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}

/**
 * The other four response headers, kept beside the policy they travel with.
 *
 * `Permissions-Policy` is the one worth reading twice: no page here needs a
 * camera except /gate, which asks for it at the point of use. Denying the rest
 * by default means a compromised dependency cannot open a microphone on the
 * checkout page.
 */
export function securityHeaders({ isDev }) {
  return [
    /**
     * NO Content-Security-Policy here, deliberately.
     *
     * It is set per request by `proxy.ts`, because it carries a nonce. A second
     * copy declared statically would not be a safety net — two CSP headers are
     * enforced as their INTERSECTION, so a nonce-free one here would block the
     * very scripts the nonce exists to allow, and the app would be broken again
     * with a policy that looks stricter for it.
     *
     * The headers below have no per-request part, so they stay where they are
     * cheapest: applied by the server to everything, including responses the
     * proxy's matcher skips.
     */
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), payment=()' },
    /**
     * HSTS, production only.
     *
     * Two years, subdomains included, and NOT preloaded — preloading is a
     * one-way door that takes months to undo and needs a deliberate decision
     * about every subdomain that will ever exist. The header itself is the
     * part that stops a first request over http from being downgradable.
     */
    ...(isDev ? [] : [{
      key: 'Strict-Transport-Security',
      value: 'max-age=63072000; includeSubDomains',
    }]),
  ];
}
