import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { buildCsp } from '../config/csp.mjs';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Route guards.
 *
 * `proxy.ts`, not `middleware.ts`. Next 16 renamed the convention and the old
 * filename now builds with a deprecation warning — `NextProxy` is a straight
 * alias of `NextMiddleware`, so nothing about the signature changed. Starting a
 * greenfield tree on the deprecated name would be debt taken on for no reason
 * on day one. (fancy still uses `middleware.ts`; "زي fancy بالظبط" is about the
 * stack, not about inheriting its deprecation warnings.)
 *
 * WHAT THIS IS NOT: authorisation. It checks only that a session cookie is
 * PRESENT — it does not verify the signature, does not know the role, and does
 * not know whether the session was revoked ten seconds ago. It cannot: the JWT
 * secret belongs to the API, and calling the API from here would put a network
 * round trip in front of every navigation.
 *
 * The real gate is the API. Every protected route's data comes from an endpoint
 * behind `requireAuth` + `requireRole`, each of which re-checks the session
 * against the database on every request. A forged cookie gets past this file
 * and then gets a 401 with nothing rendered.
 *
 * What this buys is the redirect. Without it a signed-out visitor opening
 * /organizer sees a dashboard shell, three spinners and then a bounce, because
 * the layout renders before its data fails. With it they land on /login.
 *
 * The single `.ts` file in a JavaScript codebase. This is the one place the
 * request/response types earn their keep, because getting them wrong fails at
 * the edge on every route at once.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const SESSION_COOKIE = 'eventsli_session';

/** Signed-in only. Prefix match, so /organizer/events/123/map is covered. */
const PROTECTED = ['/account', '/organizer', '/admin'];

/** Signed-IN visitors are sent away from these. */
const AUTH_ONLY = ['/login', '/register', '/verify-email'];

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * "SEND ME AWAY" IS NOT THE SAME AS "SEND ME HOME" — and this is where five
 * dead ends were.
 *
 * `/register/organizer` is the one AUTH_ONLY path that means something specific:
 * somebody pressed "Start selling" or "Create your event". They cannot register
 * again, so being bounced is right — but bouncing them to their DASHBOARD
 * answers a question they did not ask. They asked to start selling.
 *
 * SIX PLACES LINK TO IT and only one of them worked while signed in:
 *
 *   why-us/page.jsx            "Start selling"
 *   how-it-works/page.jsx      the closing call to action
 *   landing/Sections.jsx  ×2   the audience card, and "Start selling"
 *   landing/Social.jsx         "Create your event"
 *   landing/HeroCta.jsx        — the only one that handled it
 *
 * `HeroCta` found this and fixed it for its own button, rewriting the href to
 * `/organizer` once the session is known. Its header comment describes the
 * failure exactly: "pressing the button from the homepage returned them to the
 * homepage. Nothing errored, nothing was logged, and it read as a button that
 * does not work." The other five were never given the same treatment, so for a
 * signed-in buyer they were all still that button.
 *
 * FIXED HERE RATHER THAN IN FIVE COMPONENTS, because it is a property of the
 * ROUTE, not of any button: every link into organizer sign-up means the same
 * thing, and a per-component rewrite has to be remembered again for the seventh
 * one somebody adds. `/organizer` is where an account without a profile is asked
 * for the organization details — it is the continuation of the journey, not a
 * consolation.
 *
 * `HeroCta` stays as it is: rewriting client-side saves a redirect hop, its rule
 * is now an optimisation rather than the only thing holding that path up, and it
 * has a test pinning it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const SIGNED_IN_INSTEAD: Array<[string, string]> = [
  ['/register/organizer', '/organizer'],
];

/**
 * The gate has its own principal — a DEVICE with a PIN, not a person — so a
 * staff session cookie must not open it, and its absence must not redirect to a
 * page asking for an email. /gate handles its own state; this stays out.
 */
const EXEMPT = ['/gate'];

function startsWithAny(pathname: string, prefixes: string[]) {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

const API_ORIGIN = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1')
  .replace(/\/api\/v1\/?$/, '');

const SUPABASE_HOST = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL as string).hostname;
  } catch {
    return 'localhost';
  }
})();

const IS_DEV = process.env.NODE_ENV !== 'production';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SECOND JOB THIS FILE DOES: issue the Content Security Policy.
 *
 * It has to happen here rather than in next.config.mjs, because the policy
 * carries a per-request nonce and a config header is one fixed string.
 *
 * The nonce is set on the REQUEST as well as the response, and both are
 * load-bearing. Next reads the incoming `Content-Security-Policy` header,
 * extracts the nonce from it, and stamps that value onto every inline script it
 * emits; the response header is what the browser then enforces. Set only one
 * and the two disagree — which is the same broken page as having no nonce at
 * all, except harder to see.
 *
 * `crypto.randomUUID` rather than a counter or a timestamp: a predictable nonce
 * is not a nonce. An attacker who can guess it can write an inline script the
 * policy will accept, and the whole mechanism becomes decoration.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function withCsp(request: NextRequest, make: (headers: Headers) => NextResponse) {
  const nonce = crypto.randomUUID();
  const csp = buildCsp({
    isDev: IS_DEV, apiOrigin: API_ORIGIN, supabaseHost: SUPABASE_HOST, nonce,
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('Content-Security-Policy', csp);
  // Available to a server component via `headers()`, for anything that has to
  // render a <script> of its own. Nothing does today; it is here because
  // discovering the need and having no nonce to hand is a bad afternoon.
  requestHeaders.set('x-nonce', nonce);

  const response = make(requestHeaders);
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  /**
   * The gate is exempt from the AUTH rules — its principal is a device with a
   * PIN, and a staff cookie must not open it — but not from the policy. It runs
   * a service worker and a camera on a tablet at a door, which is the last
   * place that should be the one page on the site with no CSP.
   */
  if (startsWithAny(pathname, EXEMPT)) {
    return withCsp(request, (headers) => NextResponse.next({ request: { headers } }));
  }

  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);

  if (!hasSession && startsWithAny(pathname, PROTECTED)) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    // Carried so signing in finishes the journey, rather than dropping everyone
    // on a generic dashboard.
    url.searchParams.set('next', `${pathname}${search}`);
    // A redirect renders no HTML, so it needs no nonce — and it still gets the
    // policy, because a 307 with a Location header is a response like any other
    // and there is no reason for one page of the site to answer without one.
    return withCsp(request, () => NextResponse.redirect(url));
  }

  /**
   * `reason=expired` means the API just refused this cookie.
   *
   * Without this escape hatch the two guards fight and nobody can sign in. A
   * revoked or expired session still leaves the cookie in the browser — the API
   * clears it only on the requests that actually reach `requireAuth` — so:
   * protected page → 401 → apiFetch sends them to `/login?reason=expired` →
   * this rule sees a cookie and sends them back. A closed loop, with the sign-in
   * form on the other side of it.
   *
   * Presence of a cookie is not evidence of a session, and this is the one
   * place that distinction becomes a dead end rather than a redundant check.
   */
  const bouncedHere = request.nextUrl.searchParams.get('reason') === 'expired';

  if (hasSession && !bouncedHere && startsWithAny(pathname, AUTH_ONLY)) {
    const url = request.nextUrl.clone();
    const next = request.nextUrl.searchParams.get('next');
    // Same-origin PATHS only. An absolute URL here is an open redirect, and
    // `//evil.test` is an absolute URL that starts with a slash — which is why
    // the second check is not redundant.
    const wanted = next && next.startsWith('/') && !next.startsWith('//') ? next : null;
    /**
     * ─────────────────────────────────────────────────────────────────────────
     * `/account`, NOT `/` — AND THE STOREFRONT WAS THE SECOND ANSWER TO ONE
     * QUESTION.
     *
     * `landingAfterAuth` decides where a signed-in person goes when nothing was
     * asked for, and its whole reason for existing is that six ways in used to
     * disagree. This file was a seventh, and it was invisible because it only
     * fires on the path where the form does NOT run: somebody who is already
     * signed in and opens /login — a bookmark, a stale tab, a link in an old
     * email, the back button after signing in.
     *
     * So the same account landed on its dashboard or on the storefront depending
     * on whether it had just typed a password. That is most of what "users get
     * randomly dropped somewhere after login" actually was.
     *
     * WHY `/account` AND NOT THE ACCOUNT'S OWN DASHBOARD. This runs at the edge
     * and cannot know: the cookie is opaque here — this file does not verify the
     * signature, does not know the role, and cannot read `account_types` without
     * putting an API round trip in front of every navigation, which the header of
     * this file refuses for good reason.
     *
     * `/account` is the one landing that is correct for EVERY signed-in account
     * rather than a guess that is right for some. Every account is a buyer — the
     * API normalises an empty `account_types` to `['buyer']` — so it is never a
     * refusal, and an organizer or an admin arrives one click from their own
     * workspace with the switcher at the top of the panel naming it.
     *
     * The alternative was a client redirect on `/account` that bounces anybody
     * with another workspace onward. That trades a correct landing for a flash of
     * the wrong dashboard, and it would fire on every legitimate visit a
     * buyer-and-organizer makes to their own tickets.
     * ─────────────────────────────────────────────────────────────────────────
     */
    /**
     * A destination that was actually asked for still wins over both of the
     * answers below — it is what carries somebody back to a checkout they were
     * bounced off, and an organizer link with a `?next=` on it is still that.
     */
    const instead = SIGNED_IN_INSTEAD.find(
      ([from]) => pathname === from || pathname.startsWith(`${from}/`),
    )?.[1];

    url.pathname = wanted || instead || '/account';
    url.search = '';
    return withCsp(request, () => NextResponse.redirect(url));
  }

  /**
   * ───────────────────────────────────────────────────────────────────────────
   * THE BACK BUTTON AFTER SIGNING OUT.
   *
   * `signOut` revokes the session row server-side and then leaves with
   * `window.location.assign`, which is a real document navigation and is what
   * discards the whole client tree and its cached `/auth/me` answer. The gap it
   * leaves is the one direction it cannot control: pressing BACK.
   *
   * Without this header the browser is free to serve the dashboard it already
   * has, from the back-forward cache or from the ordinary HTTP cache, and
   * restore it whole — the same markup, the same figures, the same "signed in
   * as" line. Nothing is actually reachable behind it, because every request it
   * would make now answers 401, but somebody has just pressed "sign out" on a
   * shared laptop at a venue office and is looking at their own dashboard. That
   * it will fail on the next click is not the reassurance they need.
   *
   * `no-store` is the one directive that covers both caches: it forbids storing
   * the response at all, and it is what makes Chrome and Firefox decline to put
   * the page in the back-forward cache. So BACK re-requests the route, this
   * file finds no session cookie, and the redirect above sends them to /login.
   *
   * ONLY THE PROTECTED PREFIXES. The storefront and the event pages are cached
   * deliberately and aggressively — they are the crawlable, server-rendered half
   * of the product — and a `no-store` on those would be a performance change
   * dressed up as a security one. These three prefixes render nothing a cache
   * should be holding anyway: every one of them is a client tree whose data is
   * fetched per visit with `cache: 'no-store'` already.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const privatePage = startsWithAny(pathname, PROTECTED);

  return withCsp(request, (headers) => {
    const response = NextResponse.next({ request: { headers } });
    if (privatePage) response.headers.set('Cache-Control', 'no-store, must-revalidate');
    return response;
  });
}

export const config = {
  /**
   * Everything except Next's own assets, the internal API route and static
   * files. Matching those would run this on every image and font request for
   * no benefit — and /api/internal/revalidate authenticates with a shared
   * secret rather than a cookie, so a session check there would break it.
   */
  matcher: [
    '/((?!_next/static|_next/image|api/internal|favicon.ico|icon.svg|manifest.webmanifest|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|webp|svg|gif|ico|css|js|woff2?)$).*)',
  ],
};
