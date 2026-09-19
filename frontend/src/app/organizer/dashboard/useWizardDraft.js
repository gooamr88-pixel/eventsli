'use client';

import { useSyncExternalStore } from 'react';
import { draftKey } from '../events/new/wizardModel';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE EVENT SOMEBODY STARTED AND NEVER CREATED.
 *
 * The create-event wizard keeps what has been typed in `sessionStorage` while
 * it is being filled in, so a detour to set up payments does not cost four
 * steps of typing. It is the earliest kind of draft there is — and until now it
 * was invisible: no event row exists yet, so the Drafts panel could not know
 * about it and the organizer had no reminder that it was there.
 *
 * WHY `useSyncExternalStore` AND NOT AN EFFECT. `sessionStorage` does not exist
 * on the server, so reading it during render would make the markup disagree
 * with what was sent and React would throw the tree away. Reading it in an
 * effect and setting state renders twice and is what React 19's compiler
 * refuses. This is the built-in answer: `getServerSnapshot` answers for the
 * server and the first client render, `getSnapshot` afterwards, and the two are
 * allowed to differ. `useSavedEvents` solves the same problem the same way.
 *
 * THE SNAPSHOT IS THE TITLE, a plain string, never an object.
 * `useSyncExternalStore` needs a value that compares equal when nothing has
 * changed; a fresh object every call reads as a store that changed on every
 * render, and the component re-renders forever.
 *
 * NOTHING SUBSCRIBES. `sessionStorage` does not fire `storage` in the tab that
 * wrote it, and this is read on a dashboard the wizard is not open in — one
 * read on mount is the whole requirement, so `subscribe` registers nothing and
 * returns a no-op rather than pretending to listen.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const TYPES = ['ticketed', 'display_only'];

const subscribe = () => () => {};
const serverSnapshot = () => '';

/** The title typed so far, or `''` — the stable primitive the store hands back. */
function snapshot() {
  try {
    for (const type of TYPES) {
      const saved = JSON.parse(sessionStorage.getItem(draftKey(type)) || 'null');
      const title = String(saved?.form?.title || '').trim();
      // A wizard opened and abandoned on step one holds nothing worth coming
      // back to, so only a typed title counts as unfinished work.
      if (title) return title;
    }
  } catch { /* storage unavailable, or a private window */ }
  return '';
}

/** `{ title }` for an unfinished new event, or `null`. */
export function useWizardDraft() {
  const title = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return title ? { title } : null;
}
