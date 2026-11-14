import * as Application from 'expo-application';
import { Platform } from 'react-native';

/**
 * The one way the app talks to the API — the same envelope the website's
 * client reads (frontend/src/app/utils/apiClient.js):
 *
 *   success → { success: true,  data, pagination? }
 *   failure → { success: false, error: CODE, message, meta? }
 *
 * Failures become an ApiError carrying the server's CODE, so screens switch on
 * a stable string rather than on an English sentence. A request that never got
 * an answer is a NetworkError — at a door that is "no signal", a different
 * thing from a refusal, and the scanner treats it differently.
 */

export const PRODUCTION_API_URL = 'https://eventsli.com/api/v1';

/**
 * The API's address. A development build may point at a laptop over plain
 * HTTP (EXPO_PUBLIC_API_URL in mobile/.env.local). A store build never does:
 * `eas update` bundles on the machine that runs it, where .env.local is read,
 * so a stray local address could otherwise reach every installed phone.
 */
export function resolveApiUrl(configured: string | undefined, dev: boolean): string {
  const url = (configured || PRODUCTION_API_URL).replace(/\/+$/, '');
  if (!dev && !/^https:\/\//i.test(url)) return PRODUCTION_API_URL;
  return url;
}

export const API_URL = resolveApiUrl(process.env.EXPO_PUBLIC_API_URL, __DEV__);

const CLIENT = `checkin-${Platform.OS}/${Application.nativeApplicationVersion ?? '0.0.0'}+${Application.nativeBuildVersion ?? '0'}`;

export class ApiError extends Error {
  status: number;
  code: string;
  meta?: Record<string, unknown>;
  constructor(status: number, code: string, message: string, meta?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.meta = meta;
  }
}

export class NetworkError extends Error {
  constructor(message = 'No connection.') {
    super(message);
    this.name = 'NetworkError';
  }
}

type Options = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  token?: string | null;
  timeoutMs?: number;
  query?: Record<string, string | number | boolean | null | undefined>;
};

export type Envelope<T> = { data: T; pagination?: { total: number; limit: number; offset: number; hasMore: boolean } };

function withQuery(path: string, query?: Options['query']) {
  if (!query) return path;
  const qs = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return qs ? `${path}${path.includes('?') ? '&' : '?'}${qs}` : path;
}

/** The whole envelope, for the calls that read `pagination`. */
export async function request<T>(path: string, opts: Options = {}): Promise<Envelope<T>> {
  const { method = 'GET', body, token, timeoutMs = 15000, query } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // The timer covers the whole exchange, body included: a connection that
  // sends headers and then stalls must not hold the scanner forever.
  let res: Response;
  let text: string;
  try {
    res = await fetch(`${API_URL}${withQuery(path, query)}`, {
      method,
      headers: {
        Accept: 'application/json',
        'X-Eventsli-Client': CLIENT,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    text = await Promise.race([
      res.text(),
      new Promise<never>((_, reject) => {
        if (controller.signal.aborted) reject(new Error('aborted'));
        controller.signal.addEventListener('abort', () => reject(new Error('aborted')));
      }),
    ]);
  } catch {
    throw new NetworkError(controller.signal.aborted ? 'The server took too long to answer.' : 'No connection.');
  } finally {
    clearTimeout(timer);
  }

  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // A proxy error page, or an empty body. Not the API's envelope.
  }

  if (!res.ok || !json || json.success !== true) {
    throw new ApiError(
      res.status,
      json?.error || (res.status >= 500 ? 'SERVER_ERROR' : 'ERROR'),
      json?.message || `The server answered ${res.status}.`,
      json?.meta,
    );
  }
  return { data: json.data as T, pagination: json.pagination };
}

export async function api<T>(path: string, opts: Options = {}): Promise<T> {
  return (await request<T>(path, opts)).data;
}

/** A session that ended on the server — revoked, expired, removed from the team. */
export function isAuthError(err: unknown): err is ApiError {
  return err instanceof ApiError && err.status === 401;
}

/** What a person should read when something failed. */
export function messageFor(err: unknown): string {
  if (err instanceof NetworkError) return 'No connection. Check the signal and try again.';
  if (err instanceof ApiError) return err.message;
  return 'Something went wrong. Try again.';
}
