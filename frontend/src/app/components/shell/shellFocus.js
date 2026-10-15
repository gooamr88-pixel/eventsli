'use client';

import { useLayoutEffect, useSyncExternalStore } from 'react';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * FOCUS MODE — a page telling the shell "this is a task, not a place".
 *
 * The create-event wizard and the organization setup are TASKS: a sequence with
 * one way forward. On a phone the shell treated them as places, so the screen
 * stacked the app bar, the "Working on" bar, the step counter, the wizard's own
 * Back / Continue bar and the bottom tab bar on top of each other — about 160px
 * of a 568px screen was left for the form, and the refusal message rendered
 * behind two bars. The tabs also offered three ways out of a flow whose draft
 * only lives in this tab.
 *
 * A page opts in with `useShellFocus({ title })`. While it is mounted the shell:
 *
 *   · drops the bottom tab bar, so the page's own action bar is the bottom bar;
 *   · drops the event picker, which has nothing to say during creation;
 *   · names the TASK in the app bar ("Create event"), not the nearest nav item.
 *
 * The menu button stays. It is the way out — to the dashboard, to the site, or
 * to sign out — and taking it away would strand somebody mid-setup on a phone
 * with no route to "Sign out" at all. Drafts survive leaving: the wizard keeps
 * its answers in sessionStorage.
 *
 * A MODULE STORE, not React context, for the reason `useAuth` is one: the shell
 * is rendered by the LAYOUT, which is a different component tree position from
 * the page that knows it is a task, and a store read with
 * `useSyncExternalStore` has no setState-in-an-effect to land in the wrong
 * render. `useLayoutEffect` so the shell changes before the browser paints —
 * a tab bar that flashes and vanishes is the jump this exists to remove.
 * ─────────────────────────────────────────────────────────────────────────────
 */

let current = null;
const listeners = new Set();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const snapshot = () => current;
const serverSnapshot = () => null;

/** For the shell: the focus a mounted page asked for, or null. */
export function useShellFocusState() {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

/**
 * For a page: put the shell into focus mode while this component is mounted.
 *
 * Pass `null` (or nothing) to opt out conditionally — a hook cannot be called
 * conditionally, so the condition goes in the argument.
 *
 * Keyed on the title, not on the object: a caller writing `{ title: '…' }`
 * inline makes a new object every render, and keying on it would tear the mode
 * down and rebuild it on every keystroke in the form underneath.
 */
export function useShellFocus(options) {
  const title = options?.title || null;

  useLayoutEffect(() => {
    if (!title) return undefined;
    const mine = Object.freeze({ title });
    current = mine;
    emit();
    return () => {
      // Only clear what THIS page set. A route change can mount the next
      // page's focus before this one's cleanup runs.
      if (current === mine) {
        current = null;
        emit();
      }
    };
  }, [title]);
}
