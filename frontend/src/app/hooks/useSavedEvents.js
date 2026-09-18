'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Events this browser has saved.
 *
 * LOCAL, AND HONEST ABOUT IT. There is no favourites endpoint and no account
 * requirement — the slug goes into this browser and comes back out of it. That
 * is worth doing because the alternative is a sign-up wall in front of a
 * bookmark, and it is worth being explicit about because a heart that looks
 * like an account feature but evaporates on another device is a small betrayal.
 * Every caller labels it "on this device".
 *
 * ONE STORE, TWO SURFACES. The heart on an event card and the heart on the
 * event page are the same fact, so saving on one has to fill in the other
 * immediately — which is why this is a subscribed store rather than a hook that
 * reads localStorage independently in each component.
 *
 *
 * WHY `useSyncExternalStore` AND NOT AN EFFECT.
 *
 * localStorage does not exist on the server, so the saved state cannot be read
 * during render without the markup disagreeing with what was sent — React
 * discards the whole tree when that happens. Reading it in an effect and
 * setting state works, renders twice, and is what React's compiler refuses as
 * a cascading render. This hook is the built-in answer to exactly that shape:
 * `getServerSnapshot` answers for the server and the first client render,
 * `getSnapshot` afterwards, and the two are allowed to differ.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const KEY = 'eventsli.saved';

/** A convenience list, not a library. Unbounded, it eventually fills the
 *  origin's storage quota and starts throwing on the write that matters. */
const MAX_SAVED = 200;

const listeners = new Set();

function subscribe(listener) {
  listeners.add(listener);
  // `storage` fires in OTHER tabs, which is where the cross-tab part comes
  // from: saving an event in one tab fills the heart in another.
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

/** The saved list, defensively. A hand-edited or half-written value must not
 *  take a page down with it. */
export function readSaved() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((s) => typeof s === 'string') : [];
  } catch {
    // Private browsing, disabled storage, or nonsense under the key.
    return [];
  }
}

function write(next) {
  try {
    localStorage.setItem(KEY, JSON.stringify(next.slice(-MAX_SAVED)));
  } catch {
    // Nothing to do. The next read returns the unchanged list and the heart
    // stays where it was, which is at least truthful.
  }
  // `storage` does not fire in the tab that wrote, so this tab is told here.
  for (const listener of listeners) listener();
}

/**
 * Whether one event is saved, and a way to change that.
 *
 * Returns a BOOLEAN from the store, never the array. `useSyncExternalStore`
 * demands a snapshot that is stable between calls when nothing has changed —
 * handing back `readSaved()` would return a new array every time, React would
 * see the store as perpetually changed, and the component would re-render
 * forever. A primitive compares by value and cannot do that.
 */
export function useSavedEvent(slug) {
  const saved = useSyncExternalStore(
    subscribe,
    () => readSaved().includes(slug),
    () => false,
  );

  const toggle = useCallback(() => {
    const current = readSaved();
    write(current.includes(slug) ? current.filter((s) => s !== slug) : [...current, slug]);
  }, [slug]);

  return [saved, toggle];
}

/**
 * How many events are saved — for a "Saved (3)" filter chip.
 *
 * A count rather than the list, for the stable-snapshot reason above. A caller
 * that needs the slugs themselves calls `readSaved()` inside an event handler,
 * where purity is not at stake.
 */
export function useSavedCount() {
  return useSyncExternalStore(
    subscribe,
    () => readSaved().length,
    () => 0,
  );
}

/**
 * The saved slugs as ONE COMMA-JOINED STRING — for the page that lists them.
 *
 * A string and not the array, for the stable-snapshot rule above:
 * `useSyncExternalStore` compares snapshots by identity, so returning
 * `readSaved()` hands back a new array on every call, React reads the store as
 * permanently changed and the component re-renders forever. A joined string is
 * a primitive and compares by value, so an unchanged list is unchanged.
 *
 * It is also exactly the shape the request wants (`?slugs=a,b,c`), so nothing
 * has to re-join it.
 *
 * `null` from the server snapshot, never `''`, and the difference carries
 * meaning the page depends on: `null` is "this browser has not been read yet",
 * `''` is "read, and nothing is saved". Collapsing them would flash "Nothing
 * saved yet" at somebody who has saved things, for the frame between the
 * server's markup and hydration.
 *
 * Reading it this way rather than in an effect is also what keeps the page
 * lint-clean — `react-hooks/set-state-in-effect` refuses the effect-plus-
 * setState version, and it is right to: that is a render React throws away.
 */
export function useSavedSlugs() {
  return useSyncExternalStore(
    subscribe,
    () => readSaved().join(','),
    () => null,
  );
}
