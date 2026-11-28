import * as Application from 'expo-application';
import { Platform } from 'react-native';

/**
 * The one way the app talks to the API — the envelope every Eventsli client
 * reads (backend/utils/responseEnvelope.js):
 *
 *   success → { success: true,  data, meta?, pagination? }
 *   failure → { success: false, error: CODE, message, meta? }
 *
 * A failure becomes an ApiError carrying the server's CODE, so a screen
 * switches on a stable string (SEAT_UNAVAILABLE, RESERVATION_EXPIRED) rather
 * than on an English sentence. A request that never got an answer is a
 * NetworkError: "no signal" is a different thing from "no".
 *
 * TWO CREDENTIALS CAN TRAVEL TOGETHER. The session goes as `Authorization:
 * Bearer`; a hold's reservation token goes as `x-access-token`, which the API
 * reads first for anything that spends a hold (accessTokens.reservationTokenFrom).
 */

export const PRODUCTION_API_URL = 'https://eventsli.com/api/v1';

/**
 * A development build may point at a laptop over plain HTTP
 * (EXPO_PUBLIC_API_URL in attendee/.env.local). A store build never does.
 */
export function resolveApiUrl(configured: string | undefined, dev: boolean): string {
  const url = (configured || PRODUCTION_API_URL).replace(/\/+$/, '');
  if (!dev && !/^https:\/\//i.test(url)) return PRODUCTION_API_URL;
  return url;
}

export const API_URL = resolveApiUrl(process.env.EXPO_PUBLIC_API_URL, __DEV__);

const CLIENT = `app-${Platform.OS}/${Application.nativeApplicationVersion ?? '0.0.0'}+${Application.nativeBuildVersion ?? '0'}`;

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

export type Pagination = { page: number; limit: number; total: number; totalPages: number };
export type Envelope<T> = { data: T; pagination?: Pagination; meta?: Record<string, unknown> };

type Query = Record<string, string | number | boolean | null | undefined>;
export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** The session. Omitted → the request is anonymous. */
  token?: string | null;
  /** A hold's proof (POST /hold → reservationToken). */
  reservationToken?: string | null;
  query?: Query;
  timeoutMs?: number;
};

export function withQuery(path: string, query?: Query): string {
  if (!query) return path;
  const qs = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return qs ? `${path}${path.includes('?') ? '&' : '?'}${qs}` : path;
}

/**
 * Who hears that the server refused a session (auth/session.ts signs the
 * phone out). A setter, not an import, so this module stays free of the
 * session store that imports it.
 */
let authLost: ((token: string) => void) | null = null;
export function onAuthLost(fn: ((token: string) => void) | null) {
  authLost = fn;
}

/** The whole envelope, for calls that read `pagination` or `meta`. */
export async function request<T>(path: string, opts: RequestOptions = {}): Promise<Envelope<T>> {
  const { method = 'GET', body, token, reservationToken, query, timeoutMs = 15000 } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

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
        ...(reservationToken ? { 'x-access-token': reservationToken } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    // The timer covers the body too: headers then a stall must not hang a screen.
    text = await res.text();
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
    // A session the server no longer accepts (revoked from the web, expired,
    // account gone). Only when a session was SENT: a wrong password at
    // sign-in is a 401 too, and that is not "you were signed out".
    if (res.status === 401 && token) authLost?.(token);
    throw new ApiError(
      res.status,
      json?.error || (res.status >= 500 ? 'SERVER_ERROR' : 'ERROR'),
      json?.message || `The server answered ${res.status}.`,
      json?.meta,
    );
  }
  return { data: json.data as T, pagination: json.pagination, meta: json.meta };
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  return (await request<T>(path, opts)).data;
}

/** A session that ended on the server — revoked, expired, account gone. */
export function isAuthError(err: unknown): err is ApiError {
  return err instanceof ApiError && err.status === 401;
}

/** What a person should read when something failed. */
export function messageFor(err: unknown): string {
  if (err instanceof NetworkError) return 'No connection. Check your signal and try again.';
  if (err instanceof ApiError) return err.message;
  return 'Something went wrong. Try again.';
}
