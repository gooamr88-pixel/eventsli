'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { get, post } from '../utils/apiClient';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Who is signed in.
 *
 * ONE fetch of `/auth/me` per page load, shared by every component that asks.
 * The header, the account nav and the page body all want the same answer, and
 * three independent hooks would make three requests — each of which costs a
 * database round trip, because the session is checked against the `sessions`
 * table on every request rather than trusted from the JWT.
 *
 * WHAT IS NOT STORED, and why it matters here:
 *
 * fancy's version kept `org_id` and `user_role` in localStorage and trusted
 * them, so a revoked or expired session left a marketing page showing
 * "Dashboard / Sign out" until the visitor clicked through and got bounced. The
 * cookie is httpOnly and unreadable to JavaScript, so the ONLY way to know
 * whether a session is alive is to ask — and the answer is not cacheable across
 * page loads, because an admin can end it between two of them.
 *
 * So: nothing persists. Every load asks once — and asks again only while the
 * answer is unknown (see `error` below).
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * `idle` before the first ask, `loading` during, `ready` after — and `ready`
 * with a null user is a real answer, not a missing one.
 *
 * `error` is the FOURTH state, and the reason this file was changed. Every
 * failure of `/auth/me` used to be stored as `ready` with no user: a timeout, a
 * 503 from a database blip, a 429, a dropped connection — all recorded as
 * "signed out", and kept that way until the next full page load, because
 * nothing ever asked again. So a super admin's console answered "This area is
 * for platform staff", the admin card vanished from their dashboard, and the
 * header offered "Sign in" — then all of it came back on a reload. That is the
 * "sometimes it is there, sometimes it is gone" that was reported.
 *
 * Only the API saying so — 401, or 403 for a suspended account — means signed
 * out. Anything else means WE DO NOT KNOW: the last known user is kept, the
 * question is asked again on a backoff, and again when the tab regains focus
 * or the connection comes back.
 */
let state = { status: 'idle', user: null };
let inflight = null;
const listeners = new Set();

/** Backoff for an answer we could not get. After the last, focus or a
 *  reconnect asks again — a tab left open overnight does not poll. */
const RETRY_MS = [1000, 3000, 9000];
let attempt = 0;
let retryTimer = null;

/** The answers that really do mean "no session". */
const isSignedOutAnswer = (err) => err?.status === 401 || err?.status === 403;

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const snapshot = () => state;
const serverSnapshot = () => SERVER_STATE;

// A stable reference, or useSyncExternalStore re-renders forever during SSR.
const SERVER_STATE = Object.freeze({ status: 'idle', user: null });

/**
 * Deduplicated: ten components mounting together produce one request.
 *
 * A 401 here is the expected answer for a signed-out visitor, not an error —
 * `noRedirect` stops apiFetch bouncing them to /login, which would make every
 * public page unreachable to anyone without an account.
 */
async function load() {
  if (inflight) return inflight;
  clearTimeout(retryTimer);
  retryTimer = null;

  // A known answer stays on screen while it is re-checked.
  if (state.status !== 'ready') {
    state = { status: 'loading', user: state.user };
    emit();
  }

  inflight = (async () => {
    try {
      const user = await get('/auth/me', { noRedirect: true, cache: 'no-store' });
      state = { status: 'ready', user };
      attempt = 0;
    } catch (err) {
      if (isSignedOutAnswer(err)) {
        state = { status: 'ready', user: null };
        attempt = 0;
      } else {
        // Not an answer. Keep whoever we last knew, and ask again.
        state = { status: 'error', user: state.user };
        scheduleRetry();
      }
    } finally {
      inflight = null;
      emit();
    }
  })();

  return inflight;
}

function scheduleRetry() {
  if (retryTimer || attempt >= RETRY_MS.length) return;
  const wait = RETRY_MS[attempt];
  attempt += 1;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    load();
  }, wait);
}

/**
 * Ask again when somebody comes back to the tab or the network returns — but
 * only while the answer is unknown. A settled answer is not re-fetched on every
 * focus; that would be a request per alt-tab for nothing.
 */
let watching = false;
function watchForRecovery() {
  if (watching || typeof window === 'undefined') return;
  watching = true;
  const retryIfUnknown = () => {
    if (state.status !== 'error') return;
    attempt = 0;
    load();
  };
  window.addEventListener('focus', retryIfUnknown);
  window.addEventListener('online', retryIfUnknown);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') retryIfUnknown();
  });
}

/** After a sign-in, a sign-out, or anything that changes who we are. */
export function refreshAuth() {
  inflight = null;
  attempt = 0;
  return load();
}

/** Set directly from a login response, so the next paint is already correct
 *  instead of showing a signed-out header for one round trip. */
export function setAuthUser(user) {
  clearTimeout(retryTimer);
  retryTimer = null;
  attempt = 0;
  state = { status: 'ready', user: user || null };
  emit();
}

/** Tests only: back to a fresh page load. */
export function resetAuthForTests() {
  clearTimeout(retryTimer);
  retryTimer = null;
  attempt = 0;
  inflight = null;
  state = { status: 'idle', user: null };
}

export function useAuth() {
  const current = useSyncExternalStore(subscribe, snapshot, serverSnapshot);

  useEffect(() => {
    watchForRecovery();
    // Asks once per page load, then again only while the answer is unknown.
    // `load()` is async, so the setState inside it lands after an await —
    // React 19 rejects a synchronous one in an effect body, and it is right to.
    if (state.status === 'idle') load();
  }, []);

  const known = current.status === 'ready' || (current.status === 'error' && Boolean(current.user));

  return {
    user: current.user,
    /** True until there is a usable answer. Render a neutral header while it
     *  is true — guessing "signed out" and correcting is a visible flicker on
     *  every page for everyone who IS signed in. An unknown answer with nobody
     *  known yet is still "loading" to every consumer that only asks this. */
    loading: !known,
    signedIn: known && Boolean(current.user),
    /** We asked and could not find out, and nobody is known yet. A screen that
     *  would otherwise REFUSE (the admin console) says this instead, with a
     *  way to try again — the answer may be "yes". */
    unknown: current.status === 'error' && !current.user,
    retry: refreshAuth,
  };
}

/**
 * Signs out on the SERVER, then navigates.
 *
 * Clearing the cookie client-side would leave the session row alive, so the
 * token keeps working anywhere else it was captured. `POST /auth/logout`
 * revokes the row; that is what makes the whole thing real.
 *
 * The navigation happens either way — someone who clicked "sign out" must not
 * be left sitting on their account page because a request failed.
 */
export async function signOut(next = '/') {
  try {
    await post('/auth/logout', undefined, { noRedirect: true });
  } catch { /* leaving regardless */ }
  setAuthUser(null);
  // A hard navigation, and `assign()` rather than an href assignment — the
  // session is gone server-side, so the whole client tree and its cached auth
  // state go with it.
  if (typeof window !== 'undefined') window.location.assign(next);
}
