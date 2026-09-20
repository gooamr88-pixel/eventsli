/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHICH URLS ARE ALLOWED TO BECOME AN `href`.
 *
 * The API already refuses a bad scheme where these values enter trusted state —
 * `eventRoutes.js` validates `linkUrl` and the video `url` with
 * `isURL({ protocols: ['http','https'], require_protocol: true })`. This module
 * is the second half of that, at the rendering boundary, and it exists for the
 * three gaps a server-side validator cannot close on its own:
 *
 *   · Rows written before a validator was added, or by a path that predates it.
 *   · Values that arrive from somewhere else entirely — a cached API response,
 *     a future endpoint, a field somebody adds without remembering the rule.
 *   · `proofUrl`, which until now was a bare `isURL()` and therefore took
 *     `ftp://` and a protocol-less string.
 *
 * REACT 19 ALREADY BLOCKS `javascript:` — it replaces the href with a throwing
 * stub — so this is defence in depth, not the only thing standing between an
 * organizer and stored XSS. It is written anyway because that protection is a
 * property of the renderer, not of this product: it is invisible at the call
 * site, it does not cover `window.open`, and `data:` is not covered by it at
 * all (only the browser's top-level-navigation rule stops that one).
 *
 * WHAT IS REFUSED, and why refusing is safe: every one of these is either
 * executable or a way to smuggle a document.
 *
 *   javascript:  runs in this origin
 *   data:        a whole HTML document, including script, in the URL
 *   vbscript:    the same, on engines that still take it
 *   file:        reads the viewer's disk
 *   blob:        a document handle this page did not create
 *   anything else that is not http/https — `tel:`, `mailto:` and `sms:` are
 *   real and useful, and are allowed ONLY through `contactUrl`, so a sponsor
 *   link field cannot quietly become a dialer.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** The only two schemes an organizer-supplied outbound link may use. */
const WEB_SCHEMES = new Set(['http:', 'https:']);

/** Additionally allowed where a contact link is the point. */
const CONTACT_SCHEMES = new Set(['mailto:', 'tel:', 'sms:']);

/**
 * Control characters and whitespace are stripped before parsing.
 *
 * `\njavascript:alert(1)` and `java\tscript:alert(1)` are the two classic ways
 * past a naive `startsWith` check: browsers strip TAB, LF and CR from a URL
 * before acting on it, so a filter that does not strip them first is looking at
 * a different string from the one the browser will use. `new URL()` is stricter
 * than that, but this module must not depend on which of the two is stricter.
 */
function clean(value) {
  if (typeof value !== 'string') return '';
  // The control-character range is deliberate rather than an accident of a
  // copied regex: these are exactly the bytes a browser strips from a URL
  // before acting on it, plus the zero-width characters that survive a paste.
  return value.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200D\uFEFF]/g, '').trim();
}

/**
 * An absolute http(s) URL, or `null`.
 *
 * Returns the PARSED-AND-RESERIALISED form rather than the input, so what gets
 * rendered is what was actually validated — a parser and a renderer
 * disagreeing about the same string is the shape of most URL bypasses.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
export function safeExternalUrl(value) {
  const raw = clean(value);
  if (!raw) return null;

  // A protocol-relative URL (`//evil.example`) inherits the page's scheme, so
  // it IS a web URL — but it is also the form somebody writes when they mean a
  // path, and it silently leaves the site. Refused: an outbound link that means
  // to go somewhere can say https.
  if (raw.startsWith('//')) return null;

  let url;
  try {
    url = new URL(raw);
  } catch {
    // Not absolute, or not parseable at all. A relative path is not an
    // external link; `safeHref` is the function that takes one.
    return null;
  }

  // `new URL` lowercases the scheme, so `JavaScript:` and `JAVASCRIPT:` both
  // arrive here as `javascript:` and neither needs its own case.
  if (!WEB_SCHEMES.has(url.protocol)) return null;

  // `https://` with no host parses in some engines and points nowhere.
  if (!url.hostname) return null;

  return url.href;
}

/**
 * A contact URL — `mailto:`, `tel:`, `sms:` — or an http(s) one.
 *
 * Separate from `safeExternalUrl` so that allowing a dialer is a decision made
 * at the call site rather than a widening of the rule everywhere.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
export function safeContactUrl(value) {
  const raw = clean(value);
  if (!raw) return null;

  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (CONTACT_SCHEMES.has(url.protocol)) return url.href;
  return safeExternalUrl(raw);
}

/**
 * An href that may be internal OR external — what a CMS-controlled CTA is.
 *
 * The homepage's hero buttons, its badge and the footer's link rows are
 * admin-editable, and an admin legitimately wants both `/events` and a link to
 * an outside page. So a same-origin PATH is allowed, and anything absolute has
 * to be http(s).
 *
 * A path must start with a single `/`. `//evil.example` is refused for the
 * reason above, and a bare `events` is refused because a relative href resolves
 * against the CURRENT page — the same string means a different destination on
 * every route it is rendered on.
 *
 * @param {unknown} value
 * @param {string|null} [fallback] returned instead of `null` when the value is
 *   unusable, so a caller can keep a CTA present rather than dropping it.
 * @returns {string|null}
 */
export function safeHref(value, fallback = null) {
  const raw = clean(value);
  if (!raw) return fallback;

  if (raw.startsWith('/')) {
    if (raw.startsWith('//')) return fallback;
    return raw;
  }

  // A fragment or a query on the current page is same-document and harmless.
  if (raw.startsWith('#') || raw.startsWith('?')) return raw;

  return safeExternalUrl(raw) || fallback;
}
