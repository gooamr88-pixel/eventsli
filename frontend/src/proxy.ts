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
const AUTH_ONLY = ['/login', '/register'];

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
    url.pathname = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
    url.search = '';
    return withCsp(request, () => NextResponse.redirect(url));
  }

  return withCsp(request, (headers) => NextResponse.next({ request: { headers } }));
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
