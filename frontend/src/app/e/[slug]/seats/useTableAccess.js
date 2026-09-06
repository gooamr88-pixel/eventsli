'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Keys to private tables (BRD §27).
 *
 * HOW THIS ACTUALLY WORKS, because it is not obvious from the endpoints:
 *
 * A protected table is omitted from the public seat-map payload ENTIRELY — not
 * returned with a `locked` flag. So there is nothing on the map to click, and
 * no "unlock" affordance can be offered for a table the buyer cannot see. The
 * map reports `hiddenTableCount` so it can say "3 reserved tables" without
 * naming them.
 *
 * The table's id therefore has to arrive from outside: the organizer sends a
 * link carrying `?table=<id>`, and the password gates it. That is also why the
 * unlock endpoint answers every rejection identically — wrong password, not
 * private, no such table — because callers CAN put an arbitrary id in that URL,
 * and a distinguishable answer would turn it into a directory of which tables
 * are worth guessing at.
 *
 * `GET /seat-map` then takes a COMMA-SEPARATED list of tokens in
 * `x-table-access`, so someone holding two invitations sees both tables. A
 * header rather than a query parameter, so the keys stay out of browser
 * history and out of server logs.
 *
 * Each token is scoped to one table, one event, twenty minutes — and it gates
 * the PURCHASE as well as the map, which is why it is kept rather than thrown
 * away once the table appears.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const KEY = 'eventsli.tableAccess';

// Cached for useSyncExternalStore, which needs a stable snapshot: parsing on
// every call would return a new array each time and re-render forever.
let cachedRaw;
let cachedValue = [];
const listeners = new Set();

function read(slug) {
  if (typeof window === 'undefined') return null;
  try { return sessionStorage.getItem(`${KEY}.${slug}`); } catch { return null; }
}

function makeSnapshot(slug) {
  return () => {
    const raw = read(slug);
    if (raw === cachedRaw) return cachedValue;
    cachedRaw = raw;
    try {
      const parsed = raw ? JSON.parse(raw) : [];
      cachedValue = Array.isArray(parsed) ? parsed : [];
    } catch {
      cachedValue = [];
    }
    return cachedValue;
  };
}

function subscribe(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

const EMPTY = [];

export function useTableAccess(slug) {
  const tokens = useSyncExternalStore(subscribe, makeSnapshot(slug), () => EMPTY);

  const add = useCallback((token) => {
    if (!token) return;
    const current = makeSnapshot(slug)();
    if (current.includes(token)) return;
    try {
      sessionStorage.setItem(`${KEY}.${slug}`, JSON.stringify([...current, token]));
    } catch { /* private window — the unlock still worked for this page load */ }
    // Force the next snapshot to re-read rather than trust the cache.
    cachedRaw = undefined;
    for (const listener of listeners) listener();
  }, [slug]);

  /** The header value, or undefined so no empty header is sent. */
  const header = tokens.length > 0 ? tokens.join(',') : undefined;

  return { tokens, header, add };
}
