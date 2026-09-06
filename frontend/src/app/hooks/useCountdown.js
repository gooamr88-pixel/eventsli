'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';

/**
 * Time left until `deadline`.
 *
 * Two things this does not do, both deliberate:
 *
 * It does NOT count down from a duration. Every read recomputes from the wall
 * clock against the absolute `expiresAt` the server issued. A duration counter
 * drifts whenever the tab is backgrounded — phones throttle timers to once a
 * minute or stop them dead — so a buyer returning after ten minutes away would
 * see the timer still reading twenty-five, and then be refused at the payment
 * button. Recomputing means the tab wakes up already correct.
 *
 * It does NOT trust the clock to be right, only to advance. The server's expiry
 * is authoritative; on a skewed device this number is wrong and the API still
 * refuses the reservation at exactly the right moment. Nothing may act on this
 * value alone.
 *
 * Built on useSyncExternalStore rather than useState + useEffect: the snapshot
 * is a whole number of SECONDS, which is stable between ticks, so React
 * re-renders once a second rather than on every frame — and there is no
 * setState in an effect body, which React 19 rightly rejects.
 */
export function useCountdown(deadline, { onExpire } = {}) {
  const target = deadline ? new Date(deadline).getTime() : null;
  const valid = target !== null && !Number.isNaN(target);
  const store = getStore(valid ? target : null);

  const secondsLeft = useSyncExternalStore(store.subscribe, store.getSnapshot, () => null);

  // Held in a ref so a caller's inline arrow does not re-run the expiry effect
  // on every render, which would re-arm the latch and fire expiry repeatedly.
  //
  // Written in an effect, not during render: a render can be thrown away or
  // replayed, and a ref written during one is a side effect on a pass that may
  // never commit. Effects run in declaration order, so this lands before the
  // expiry check below reads it.
  const onExpireRef = useRef(onExpire);
  useEffect(() => { onExpireRef.current = onExpire; }, [onExpire]);

  const fired = useRef(false);
  useEffect(() => {
    if (secondsLeft === 0 && !fired.current) {
      fired.current = true;
      onExpireRef.current?.();
    } else if (secondsLeft !== 0) {
      // Re-armed, so a new hold after this one can expire too.
      fired.current = false;
    }
  }, [secondsLeft]);

  return {
    /** Milliseconds, for a caller that needs to compare against a threshold.
     *  Derived from the seconds snapshot so it changes on the same beat. */
    remaining: secondsLeft === null ? null : secondsLeft * 1000,
    expired: secondsLeft !== null && secondsLeft <= 0,
    /** "24:52". Minutes unpadded — a leading zero reads like a stopwatch
     *  rather than like time you have left. */
    formatted: secondsLeft === null ? null : format(secondsLeft),
  };
}

/**
 * One store per deadline.
 *
 * The cache is the contract, not an optimisation: useSyncExternalStore
 * re-subscribes whenever `subscribe` changes identity, so building the closure
 * inline would tear down and recreate the interval on every render. A handful
 * of entries accumulate per session, which is not worth a cleanup mechanism
 * that could evict one still in use.
 */
const stores = new Map();

function getStore(target) {
  const key = target ?? 'none';
  let store = stores.get(key);
  if (store) return store;

  store = {
    subscribe(callback) {
      if (target === null || typeof document === 'undefined') return () => {};
      const id = setInterval(callback, 1000);
      // A backgrounded tab's interval is throttled, so the value is stale the
      // instant it is looked at again. Recomputing on visibilitychange is what
      // makes coming back to the tab honest.
      const onVisible = () => { if (document.visibilityState === 'visible') callback(); };
      document.addEventListener('visibilitychange', onVisible);
      return () => {
        clearInterval(id);
        document.removeEventListener('visibilitychange', onVisible);
      };
    },
    getSnapshot() {
      if (target === null) return null;
      // Ceil, so 0 means genuinely elapsed rather than "less than a second
      // left" — the difference between showing 0:00 for a second and showing
      // it only once the hold is actually gone.
      return Math.max(0, Math.ceil((target - Date.now()) / 1000));
    },
  };

  stores.set(key, store);
  return store;
}

function format(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
