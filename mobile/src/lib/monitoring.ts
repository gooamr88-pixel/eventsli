/**
 * Crash reports and scan timings (Sentry), with guest data scrubbed out.
 *
 * OFF unless EXPO_PUBLIC_SENTRY_DSN is set at build time. Without it, Sentry is
 * never even loaded, so a build or a test with no account behaves exactly as
 * before.
 *
 * What leaves the phone is a crash's stack, the phone model and OS, and how
 * long scans take. What never does, whatever an error happens to contain:
 *   • tokens (door, account, ticket codes are all JWTs: eyJ…)
 *   • email addresses
 *   • query strings (the guest search carries names; the list cursor, ids)
 *   • console output (it can echo anything)
 *   • the "user" Sentry would otherwise attach
 * The store privacy answers (mobile/store/PRIVACY.md) describe exactly this.
 */

type Json = unknown;

const JWT = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Ticket, event, device and scan ids: each one leads back to a guest on the server.
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
// The query string or fragment of any address inside a text ("GET https://…/attendees?q=Sara Ali").
const URL_TAIL = /([a-z][a-z0-9+.-]*:\/\/[^\s?#"'<>]*)[?#][^\s"'<>]*/gi;

/** A string with tokens, addresses, ids and URL query strings replaced. */
export function scrubText(text: string): string {
  return text
    .replace(URL_TAIL, '$1')
    .replace(JWT, '[token]')
    .replace(EMAIL, '[email]')
    .replace(UUID, '[id]');
}

/** A URL without its query string or fragment, and with no token in its path. */
export function scrubUrl(url: string): string {
  return scrubText(String(url).split(/[?#]/)[0]);
}

// Keys whose values are dropped whole. `http.query` / `http.fragment` are what
// Sentry's own fetch spans and breadcrumbs carry the guest search in.
const SECRET_KEYS = /^(authorization|cookie|set-cookie|x-eventsli-client|token|qr|password|pin|code|codeverifier|cursor|q|query|search|email|attendee|holder|name|seat|body|params|http\.query|http\.fragment|url\.query|url\.fragment|http\.request\.body.*|http\.response\.body.*)$/i;

/** Every string in a value scrubbed; keys that name secrets dropped outright. */
export function scrubDeep(value: Json, depth = 0): Json {
  if (depth > 8) return '[deep]';
  if (typeof value === 'string') return scrubText(value);
  if (Array.isArray(value)) return value.map((v) => scrubDeep(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, Json> = {};
    for (const [k, v] of Object.entries(value as Record<string, Json>)) {
      if (SECRET_KEYS.test(k)) continue;
      out[k] = scrubDeep(v, depth + 1);
    }
    return out;
  }
  return value;
}

type Breadcrumb = { category?: string; message?: string; data?: Record<string, Json> };
type Span = { description?: string; data?: Record<string, Json> };
type Event = {
  message?: string;
  transaction?: string;
  spans?: Span[];
  user?: unknown;
  request?: { url?: string; headers?: Record<string, string>; query_string?: unknown; cookies?: unknown; data?: unknown };
  exception?: { values?: { value?: string }[] };
  breadcrumbs?: Breadcrumb[];
  extra?: Record<string, Json>;
  contexts?: Record<string, Json>;
  tags?: Record<string, Json>;
};

/** Console breadcrumbs are dropped; network ones keep method, status and path. */
export function scrubBreadcrumb<T extends Breadcrumb>(crumb: T): T | null {
  if (crumb.category === 'console') return null;
  const data = crumb.data ? { ...crumb.data } : undefined;
  if (data && typeof data.url === 'string') data.url = scrubUrl(data.url);
  return {
    ...crumb,
    message: crumb.message ? scrubText(crumb.message) : crumb.message,
    data: data ? (scrubDeep(data) as Record<string, Json>) : data,
  };
}

export function scrubEvent<T extends Event>(event: T): T {
  const e: T = { ...event };
  delete e.user;
  if (e.request) {
    e.request = { url: e.request.url ? scrubUrl(e.request.url) : undefined };
  }
  if (e.message) e.message = scrubText(e.message);
  // A transaction's own name and every span in it ("GET https://…/attendees?q=…").
  if (e.transaction) e.transaction = scrubText(e.transaction);
  if (e.spans) {
    e.spans = e.spans.map((s) => ({
      ...s,
      description: s.description ? scrubText(s.description) : s.description,
      data: s.data ? (scrubDeep(s.data) as Record<string, Json>) : s.data,
    }));
  }
  if (e.exception?.values) {
    e.exception = { ...e.exception, values: e.exception.values.map((v) => ({ ...v, value: v.value ? scrubText(v.value) : v.value })) };
  }
  if (e.breadcrumbs) e.breadcrumbs = e.breadcrumbs.map((b) => scrubBreadcrumb(b)).filter((b): b is Breadcrumb => b !== null);
  if (e.extra) e.extra = scrubDeep(e.extra) as Record<string, Json>;
  if (e.contexts) e.contexts = scrubDeep(e.contexts) as Record<string, Json>;
  if (e.tags) e.tags = scrubDeep(e.tags) as Record<string, Json>;
  return e;
}

type SpanLike = { setAttribute: (key: string, value: string) => void };
type SentryLike = {
  init: (options: Record<string, unknown>) => void;
  startSpan: <R>(options: { name: string; op?: string }, fn: (span: SpanLike) => R) => R;
  captureException: (error: unknown) => unknown;
};

/**
 * A crash the app caught itself (the root error boundary), so it would never
 * reach Sentry's own handler. Scrubbed by beforeSend like everything else; a
 * no-op with crash reporting off.
 */
export function reportError(error: unknown): void {
  try {
    sentry?.captureException(error);
  } catch {
    // Reporting must never be the second crash.
  }
}

let sentry: SentryLike | null = null;

/** Called once at launch. True when crash reporting is on. */
export function startMonitoring(env: { dsn?: string; environment?: string } = {
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  environment: process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT,
}): boolean {
  if (!env.dsn || sentry) return Boolean(sentry);
  // Loaded only here, only with a DSN: the native module stays out of the way otherwise.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('@sentry/react-native') as SentryLike;
  mod.init({
    dsn: env.dsn,
    environment: env.environment || 'production',
    // JavaScript only. The native SDKs send their own crash reports and
    // session pings straight from native code: those never pass beforeSend
    // below, record native network breadcrumbs (whole URLs, the guest search
    // included), and carry a per-install id as the "user"
    // (RNSentry.mm, fetchNativeDeviceContexts). With the native layer off,
    // every byte that leaves goes through the scrubbing in this file, and no
    // install id or session ping is sent at all. The cost: a crash in native
    // code (camera, database) is not reported. Revisit only with native
    // scrubbing verified on a real build (mobile/store/PRIVACY.md).
    enableNative: false,
    enableAutoSessionTracking: false,
    sendDefaultPii: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    tracesSampleRate: 0.2,
    beforeSend: (event: Event) => scrubEvent(event),
    beforeSendTransaction: (event: Event) => scrubEvent(event),
    beforeBreadcrumb: (crumb: Breadcrumb) => scrubBreadcrumb(crumb),
  });
  sentry = mod;
  return true;
}

/**
 * Time one scan, from the code read to the answer on screen (the plan's
 * target: p95 under 800 ms online, under 150 ms offline). Nothing about the
 * ticket is attached: only how it was decided.
 */
export async function measureScan<R>(fn: () => Promise<R>, describe: (r: R) => string): Promise<R> {
  if (!sentry) return fn();
  return sentry.startSpan({ name: 'door.scan', op: 'scan' }, async (span) => {
    const r = await fn();
    span.setAttribute('outcome', describe(r));
    return r;
  });
}
