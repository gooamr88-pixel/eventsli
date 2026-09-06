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
 * So: nothing persists. Every load asks once.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** `idle` before the first ask, `loading` during, `ready` after — and `ready`
 *  with a null user is a real answer, not a missing one. */
let state = { status: 'idle', user: null };
let inflight = null;
const listeners = new Set();

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

  state = { status: state.status === 'ready' ? 'ready' : 'loading', user: state.user };
  emit();

  inflight = (async () => {
    try {
      const user = await get('/auth/me', { noRedirect: true, cache: 'no-store' });
      state = { status: 'ready', user };
    } catch {
      state = { status: 'ready', user: null };
    } finally {
      inflight = null;
      emit();
    }
  })();

  return inflight;
}

/** After a sign-in, a sign-out, or anything that changes who we are. */
export function refreshAuth() {
  inflight = null;
  return load();
}

/** Set directly from a login response, so the next paint is already correct
 *  instead of showing a signed-out header for one round trip. */
export function setAuthUser(user) {
  state = { status: 'ready', user: user || null };
  emit();
}

export function useAuth() {
  const current = useSyncExternalStore(subscribe, snapshot, serverSnapshot);

  useEffect(() => {
    // Only ever asks once per page load. `load()` is async, so the setState
    // inside it lands after an await — React 19 rejects a synchronous one in an
    // effect body, and it is right to.
    if (state.status === 'idle') load();
  }, []);

  return {
    user: current.user,
    /** True until the first answer arrives. Render a neutral header while it
     *  is true — guessing "signed out" and correcting is a visible flicker on
     *  every page for everyone who IS signed in. */
    loading: current.status !== 'ready',
    signedIn: current.status === 'ready' && Boolean(current.user),
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
