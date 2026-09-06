'use client';

import { useSyncExternalStore } from 'react';
import { apiFetch, ApiError } from '../utils/apiClient';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The gate's principal: a DEVICE, not a person.
 *
 * Everything else in this app authenticates with an httpOnly cookie the browser
 * holds and JavaScript cannot read. The gate cannot use it, and that is the
 * point rather than an inconvenience:
 *
 *   · Door staff share a tablet and change between shifts. A personal login
 *     means either everyone knows the organizer's password, or nobody scans.
 *   · A device is registered once by the organizer, given a PIN, and revoked
 *     from the dashboard the moment a tablet goes missing — without touching
 *     anyone's account.
 *   · The EVENT is inside the token. `requireDevice` reads it from there and
 *     never from the request body, so one venue's tablet cannot scan another
 *     venue's tickets by changing a field.
 *
 * The token is therefore a Bearer credential and has to be readable by this
 * code to be sent, which means localStorage. That is a real trade and it is
 * bounded on purpose: seven days, one event, revocable, and it opens a scanner
 * rather than an account. Nothing here can buy a ticket, read an attendee list,
 * or see money.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const KEY = 'eventsli.gate.device';

/** The last value read or written. `useSyncExternalStore` demands a snapshot
 *  that is referentially stable between changes — re-parsing localStorage on
 *  every call returns a new object each time and React re-renders forever. */
let current;
let loaded = false;
const listeners = new Set();

function load() {
  if (loaded) return current;
  loaded = true;
  try {
    const raw = localStorage.getItem(KEY);
    current = raw ? JSON.parse(raw) : null;
  } catch {
    current = null;
  }
  return current;
}

function emit() {
  for (const fn of listeners) fn();
}

export function readSession() {
  if (typeof window === 'undefined') return null;
  return load();
}

export function saveSession(session) {
  current = session;
  loaded = true;
  try { localStorage.setItem(KEY, JSON.stringify(session)); } catch { /* private mode */ }
  emit();
}

export function clearSession() {
  current = null;
  loaded = true;
  try { localStorage.removeItem(KEY); } catch { /* nothing to do */ }
  emit();
}

function subscribe(fn) {
  listeners.add(fn);
  // Another tab signing the same tablet out has to take this one with it.
  const onStorage = (e) => {
    if (e.key === KEY) { loaded = false; load(); fn(); }
  };
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(fn); window.removeEventListener('storage', onStorage); };
}

/**
 * `undefined` on the server and on the very first client render, `null` or the
 * session after that.
 *
 * Three states, not two, and collapsing them is a real bug: a server snapshot
 * of `null` would render "sign in" into the HTML, so a signed-in tablet flashes
 * the login screen on every reload — at a door, mid-queue.
 */
export function useGateSession() {
  return useSyncExternalStore(subscribe, readSession, () => undefined);
}

/** A 401 from a device route. Distinct from the site's UNAUTHENTICATED because
 *  the recovery is different: back to /gate/login with a PIN, never to /login
 *  with an email. */
export class GateAuthError extends Error {
  constructor(message) {
    super(message || 'This device is no longer signed in.');
    this.name = 'GateAuthError';
    this.code = 'DEVICE_UNAUTHENTICATED';
  }
}

/**
 * Every call the gate makes.
 *
 * `noRedirect` is not optional. apiFetch's default 401 behaviour sends the
 * browser to `/login?reason=expired` — the right answer everywhere else and the
 * wrong one here, because a door tablet has no email address and the person
 * holding it cannot sign in as anybody.
 */
export async function gateFetch(path, { token, ...options } = {}) {
  const bearer = token || readSession()?.token;

  try {
    return await apiFetch(path, {
      ...options,
      noRedirect: true,
      headers: {
        ...options.headers,
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      },
    });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      clearSession();
      throw new GateAuthError(err.message);
    }
    throw err;
  }
}

export const gatePost = (path, body, options) =>
  gateFetch(path, { ...options, method: 'POST', body: JSON.stringify(body) });

/**
 * Sign the device in.
 *
 * The API answers a wrong PIN and a revoked device identically, on purpose, so
 * whoever is holding a lost tablet learns nothing from the difference. This
 * repeats that message rather than guessing which it was.
 */
export async function signIn({ deviceId, pin }) {
  const data = await apiFetch('/scan/login', {
    method: 'POST',
    noRedirect: true,
    body: JSON.stringify({ deviceId: String(deviceId).trim(), pin }),
  });

  const session = {
    token: data.token,
    deviceId: data.device.id,
    label: data.device.label,
    eventId: data.device.eventId,
    signedInAt: new Date().toISOString(),
  };
  saveSession(session);
  return session;
}
