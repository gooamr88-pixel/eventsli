/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The one way this app talks to the API.
 *
 * Ported from fancy's apiClient, rewritten around three things that are true
 * here and were not there: one response envelope, a table of ~40 error codes,
 * and a server runtime that has to reach the API over loopback.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const IS_SERVER = typeof window === 'undefined';

/**
 * Two base URLs, and confusing them is a production-only failure.
 *
 * The browser goes through nginx on the public hostname. Server components go
 * straight to 127.0.0.1:5000 — INTERNAL_API_URL, deliberately NOT prefixed
 * NEXT_PUBLIC_ so it can never be inlined into the client bundle, where a
 * loopback address is useless.
 *
 * Without the internal one, every SSR render hairpins out through nginx and
 * back, arriving at the API as traffic from the box's own address. That
 * collapses all rendering onto ONE rate-limit key and adds a TLS round trip per
 * render. The reasoning is written into ecosystem.config.js too, because that
 * is where the variable is set.
 */
const RAW = IS_SERVER
  ? (process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:5000/api/v1')
  : (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1');

export const API_URL = RAW.replace(/\/+$/, '').endsWith('/api/v1')
  ? RAW.replace(/\/+$/, '')
  : `${RAW.replace(/\/+$/, '')}/api/v1`;

/**
 * The API address as the BROWSER must see it — always the public one, even
 * when this module is evaluated on the server.
 *
 * Use it for any URL that ends up in rendered HTML: a QR `<img src>`, a
 * download link, anything the browser will fetch itself. `API_URL` is the
 * address the CURRENT runtime should call, which on the server is
 * 127.0.0.1:5000 — correct for a server-side fetch and useless in an attribute,
 * because the browser resolves loopback to the viewer's own machine.
 *
 * The failure is subtle and one-sided: the server component renders fine, the
 * page looks fine, and only the image is broken — on the ticket page, which is
 * opened at a door, on a phone, by someone who needs it to work.
 */
const RAW_PUBLIC = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';
export const PUBLIC_API_URL = RAW_PUBLIC.replace(/\/+$/, '').endsWith('/api/v1')
  ? RAW_PUBLIC.replace(/\/+$/, '')
  : `${RAW_PUBLIC.replace(/\/+$/, '')}/api/v1`;

/** 30s. Long enough for a slow connection, short enough that a hung request
 *  surfaces as an error the UI can render instead of a spinner forever. */
const TIMEOUT_MS = 30_000;

/**
 * Every failure the API can produce, as one type.
 *
 * `code` is the contract — the API's error table is a stable set of strings, and
 * the UI switches on it. `message` is English prose meant for a person and MAY
 * change; branching on it is how you get a bug that only appears after a copy
 * edit.
 */
export class ApiError extends Error {
  constructor({ code, message, status, meta }) {
    super(message || code || 'Something went wrong.');
    this.name = 'ApiError';
    this.code = code || 'ERROR';
    this.status = status || 0;
    this.meta = meta || null;
  }
}

/** A fetch that never resolved — offline, DNS, a dropped connection, a timeout.
 *  Distinct from an API failure: there is nothing to switch on, and the right
 *  UI is "try again", not an explanation. */
export class NetworkError extends Error {
  constructor(message) {
    super(message || 'Could not reach the server.');
    this.name = 'NetworkError';
    this.code = 'NETWORK';
    this.status = 0;
  }
}

const AUTH_PATHS = ['/login', '/register', '/forgot-password', '/reset-password'];

/**
 * @param {string} path        e.g. '/public/events?q=jazz'
 * @param {object} options
 * @param {boolean} [options.raw]      resolve the whole envelope, not `data`
 * @param {boolean} [options.noRedirect] never bounce to /login on a 401
 * @param {string}  [options.cookie]   forwarded session, for server components
 */
export async function apiFetch(path, options = {}) {
  const { raw = false, noRedirect = false, cookie, headers: extraHeaders, ...init } = options;

  const headers = { ...extraHeaders };
  if (!(init.body instanceof FormData) && init.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  // A server component has no cookie jar. `credentials: 'include'` does nothing
  // there, so the session has to be forwarded by hand — see serverFetch below.
  // Forgetting it renders an authenticated page logged-out, and only under SSR,
  // which means only in production.
  if (cookie) headers.cookie = cookie;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers,
      // The session is an httpOnly cookie the browser holds and JavaScript
      // cannot read. This is what sends it.
      credentials: 'include',
      signal: init.signal || controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err?.name === 'AbortError' && !init.signal) {
      throw new NetworkError('That took too long. Check your connection and try again.');
    }
    if (err?.name === 'AbortError') throw err;   // the caller cancelled, on purpose
    throw new NetworkError();
  } finally {
    clearTimeout(timer);
  }

  // A binary answer — the QR image, a CSV export. There is no envelope to parse.
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    if (!response.ok) {
      throw new ApiError({
        code: 'ERROR', status: response.status,
        message: `Request failed (${response.status}).`,
      });
    }
    return response.blob();
  }

  let body = null;
  try { body = await response.json(); } catch { /* an empty or truncated body */ }

  if (response.status === 401) return handle401({ body, response, noRedirect });

  if (!response.ok || body?.success === false) {
    throw new ApiError({
      code: body?.error,
      message: body?.message,
      status: response.status,
      meta: body?.meta,
    });
  }

  return raw ? body : body?.data;
}

/**
 * A 401 means two completely different things, and answering both the same way
 * is a real bug fancy shipped once.
 *
 * On a PROTECTED page it means the session is gone — expired, revoked by an
 * admin, or signed out on another device — and the right move is to send the
 * viewer to sign in again.
 *
 * On the LOGIN page it means the password was wrong. Redirecting to /login from
 * /login is a no-op that swallows the server's actual message, so the form
 * shows nothing and the person retypes the same password.
 */
function handle401({ body, response, noRedirect }) {
  const onAuthPage = !IS_SERVER && AUTH_PATHS.includes(window.location.pathname);

  if (IS_SERVER || onAuthPage || noRedirect) {
    throw new ApiError({
      code: body?.error || 'UNAUTHENTICATED',
      message: body?.message,
      status: 401,
      meta: body?.meta,
    });
  }

  // The session is a backend-issued httpOnly JWT with a fixed expiry and no
  // refresh exchange — there is nothing to renew, so this is terminal.
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  /**
   * Next 16.3's lint prefers `useRouter().push()` here. It cannot apply: this
   * is a plain module, not a component, so there is no router to reach — and
   * a hard navigation is what is wanted anyway. The session is gone; the React
   * tree and every cache in it have to go with it, or the next page renders
   * from stale state that believes somebody is still signed in.
   */
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.href = `/login?reason=expired&next=${next}`;

  // Never resolves. A redirect is in flight, and resolving would let the caller
  // render an empty state for the split second before the navigation commits.
  return new Promise(() => {});
}

/**
 * The server-component wrapper: forwards the session cookie from the incoming
 * request, and tags the response so the backend can drop it from the cache the
 * moment the data changes rather than waiting out a timer.
 *
 * Usage inside a server component or route handler:
 *
 *   import { cookies } from 'next/headers';
 *   const event = await serverFetch(`/public/events/${slug}`, {
 *     cookieStore: await cookies(),
 *     tags: [`event:${slug}`],
 *     revalidate: 60,
 *   });
 */
export async function serverFetch(path, { cookieStore, tags, revalidate, ...options } = {}) {
  const cookie = cookieStore
    ? cookieStore.getAll().map((c) => `${c.name}=${c.value}`).join('; ')
    : undefined;

  return apiFetch(path, {
    ...options,
    cookie,
    // A tagged entry can be dropped on demand by /api/internal/revalidate, which
    // the backend calls when an event is published, approved, suspended,
    // cancelled or repriced. Without that, a 60s window means a brand-new event
    // reads "not found" for a minute — a cached MISS is stored exactly like a
    // cached hit — and the organizer concludes the product is broken.
    next: { ...(tags ? { tags } : {}), ...(revalidate !== undefined ? { revalidate } : {}) },
  });
}

export const get = (path, options) => apiFetch(path, { ...options, method: 'GET' });

export const post = (path, data, options) =>
  apiFetch(path, { ...options, method: 'POST', body: data === undefined ? undefined : JSON.stringify(data) });

export const patch = (path, data, options) =>
  apiFetch(path, { ...options, method: 'PATCH', body: JSON.stringify(data) });

export const put = (path, data, options) =>
  apiFetch(path, { ...options, method: 'PUT', body: JSON.stringify(data) });

export const del = (path, options) => apiFetch(path, { ...options, method: 'DELETE' });
