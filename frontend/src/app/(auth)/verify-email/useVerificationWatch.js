'use client';

import { useEffect, useState } from 'react';
import { post } from '../../utils/apiClient';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WATCHING FOR THE ACTIVATION THAT HAPPENS SOMEWHERE ELSE.
 *
 * THE BEHAVIOUR THIS FIXES. Somebody signs up on a laptop and opens the email
 * on their phone — which is what most people do, because that is where mail
 * is. The phone taps "Activate my account", the phone is signed in, and the
 * laptop goes on saying "Check your inbox · Open the email · Tap Activate"
 * indefinitely. It has no session, so it cannot ask `/auth/me`; it has no
 * token from the email, so it cannot activate anything itself. Nothing in the
 * product ever told it, and the person is left reading an instruction to do
 * something they have already done.
 *
 * So the tab asks, on a timer, and the server signs it in when the answer
 * turns to yes. `verificationStatus` in the API argues why that is sound.
 *
 * THE TOKEN IS KEPT IN sessionStorage, not in the URL.
 *
 * A credential in a query string reaches browser history, the `Referer` header
 * of every third-party asset on the page, and any analytics running on it. In
 * sessionStorage it belongs to this tab, dies with it, and is never transmitted
 * anywhere except in the body of the request that uses it. It also survives the
 * reload that React state would not — which matters, because "refresh the page"
 * is exactly what somebody does while they wait.
 *
 * IT STOPS ON ITS OWN. The token is good for thirty minutes and the interval
 * gives up a little before that, because a tab polling a dead token forever is
 * a request every two seconds for as long as the laptop stays open.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const KEY = 'eventsli.verifyWatch';
const EVERY_MS = 2500;
/** A shade under the token's own 30 minutes. */
const GIVE_UP_MS = 28 * 60_000;

/** Remembers the token for this tab. Storage may be unavailable; that is survivable. */
export function rememberWatchToken(token) {
  if (!token) return;
  try { sessionStorage.setItem(KEY, token); } catch { /* private window */ }
}

export function forgetWatchToken() {
  try { sessionStorage.removeItem(KEY); } catch { /* private window */ }
}

function readWatchToken() {
  try { return sessionStorage.getItem(KEY); } catch { return null; }
}

/**
 * `null` until something happens, then the server's answer:
 *   { verified: true, signedIn: true,  user, next }  — activated elsewhere, and
 *                                                      this tab is now signed in
 *   { verified: true, signedIn: false }              — activated, but the account
 *                                                      is blocked; go and sign in
 *
 * `enabled` is false once this tab has confirmed the code itself — there is
 * nothing left to watch for, and the poll would be asking about a session it
 * already has.
 */
export function useVerificationWatch({ enabled = true } = {}) {
  const [outcome, setOutcome] = useState(null);

  useEffect(() => {
    if (!enabled) return undefined;
    const token = readWatchToken();
    if (!token) return undefined;

    let stopped = false;
    let timer;
    const startedAt = Date.now();

    async function ask() {
      if (stopped) return;
      try {
        const data = await post('/auth/verification-status', { watchToken: token }, {
          noRedirect: true,
        });
        if (stopped) return;
        if (data?.verified) {
          forgetWatchToken();
          setOutcome(data);
          return;   // no re-arm: this is the answer we were waiting for
        }
      } catch {
        // A blip, or the token has expired. Neither is worth telling somebody
        // who is reading their email — the page still works by hand, and the
        // next tick either recovers or runs out the clock below.
      }
      if (!stopped && Date.now() - startedAt < GIVE_UP_MS) {
        timer = setTimeout(ask, EVERY_MS);
      }
    }

    // A first ask after one interval rather than immediately: the token was
    // issued milliseconds ago by the request that rendered this page, so the
    // answer to an instant question is always no.
    timer = setTimeout(ask, EVERY_MS);
    return () => { stopped = true; clearTimeout(timer); };
  }, [enabled]);

  return outcome;
}
