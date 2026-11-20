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
 * THE TOKEN IS NOT HERE (2026-11-20). It used to be a Bearer token in
 * localStorage, readable by any script that ran on the site. The API now sets
 * it as an httpOnly cookie scoped to /api/v1/scan (`session: 'cookie'` at sign
 * in) and this code never sees it. What localStorage keeps is only who this
 * tablet is — device, label, event, when it signed in — to draw the screen.
 * Every gate request sends `X-Eventsli-Gate: 1`, without which the API ignores
 * the cookie: a cross-site page can make the browser send a cookie, not add a
 * header.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const KEY = 'eventsli.gate.device';

/**
 * A session saved by the version that kept the token here is dropped, token
 * and all: the tablet signs in once more and gets the cookie. Its queued scans
 * are in IndexedDB, keyed by event, and upload after that sign-in.
 */
function fromStorage(raw) {
  const parsed = raw ? JSON.parse(raw) : null;
  if (parsed && typeof parsed === 'object' && 'token' in parsed) {
    try { localStorage.removeItem(KEY); } catch { /* nothing to do */ }
    return null;
  }
  return parsed;
}

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
    current = fromStorage(localStorage.getItem(KEY));
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

export function saveSession(input) {
  // Never a token, whoever calls this.
  const { token, ...session } = input || {};
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
export async function gateFetch(path, options = {}) {
  try {
    // The door token is the httpOnly cookie apiFetch sends (credentials:
    // 'include'); this header is what makes the API accept it.
    return await apiFetch(path, {
      ...options,
      noRedirect: true,
      headers: { ...options.headers, [GATE_HEADER]: '1' },
    });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      clearSession();
      throw new GateAuthError(err.message);
    }
    throw err;
  }
}

export const GATE_HEADER = 'X-Eventsli-Gate';

export const gatePost = (path, body, options) =>
  gateFetch(path, { ...options, method: 'POST', body: JSON.stringify(body) });

/** Sign this tablet out: the API clears the cookie. Best effort — offline, the session still goes here. */
export async function signOutGate() {
  try {
    await apiFetch('/scan/logout', { method: 'POST', noRedirect: true, timeoutMs: 5000 });
  } catch { /* the cookie expires on its own */ }
  clearSession();
}

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
    // The token comes back as an httpOnly cookie, not in this answer.
    body: JSON.stringify({ deviceId: String(deviceId).trim(), pin, session: 'cookie' }),
  });

  const session = {
    deviceId: data.device.id,
    label: data.device.label,
    eventId: data.device.eventId,
    expiresAt: data.expiresAt || null,
    // A PIN under six digits: the organizer is asked to set a new one.
    pinNeedsReset: Boolean(data.pinNeedsReset),
    signedInAt: new Date().toISOString(),
  };
  saveSession(session);
  return session;
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The second way in: a DOOR-TEAM MEMBER, with their own Eventsli account.
 *
 * The site's session cookie proves who they are (sent with `credentials:
 * 'include'` by apiFetch); the API then decides which events they may scan and
 * hands back a gate token scoped to ONE of them. From there on this is the same
 * Bearer token, the same queue and the same scanner as a PIN device — so every
 * rule above still holds, and removing them from the team refuses their next scan.
 *
 * Their token lasts one shift (sixteen hours), not a device's seven days.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function listAssignments() {
  return apiFetch('/scan/assignments', { noRedirect: true, cache: 'no-store' });
}

export async function signInAsStaff({ eventId }) {
  const data = await apiFetch('/scan/staff-login', {
    method: 'POST',
    noRedirect: true,
    body: JSON.stringify({ eventId, session: 'cookie' }),
  });

  const session = {
    expiresAt: data.expiresAt || null,
    deviceId: data.device.id,
    label: data.device.label,
    eventId: data.device.eventId,
    staff: true,
    eventTitle: data.event?.title || null,
    signedInAt: new Date().toISOString(),
  };
  saveSession(session);
  return session;
}
