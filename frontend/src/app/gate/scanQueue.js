/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Where a scan lives between the door and the server.
 *
 * IndexedDB, not localStorage and not memory. The three reasons are all the
 * same reason — a tablet at a venue is a hostile place for state:
 *
 *   · It survives a reload, a crash, and the browser being killed by the OS to
 *     reclaim memory when the camera has been running for four hours.
 *   · It is not a string. localStorage would mean JSON.parse-ing the whole
 *     queue on every write, and a half-written 3000-entry blob after a battery
 *     pull is the entire night's admissions.
 *   · Writes are transactional, so a scan is either recorded or it is not.
 *
 * The rules that decide WHAT is written and when it may be forgotten live in
 * queuePolicy.js, on plain arrays, where they are testable. This file is the
 * adapter and nothing else.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { prunable } from './queuePolicy';

const DB_NAME = 'eventsli-gate';
const DB_VERSION = 1;
const STORE = 'scans';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser has no IndexedDB, so scans cannot be held offline.'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        // Keyed on the CLIENT scan id, which makes writing the same scan twice
        // an overwrite rather than a duplicate — the storage-level half of the
        // replay guarantee the server provides at the other end.
        const store = db.createObjectStore(STORE, { keyPath: 'clientScanId' });
        store.createIndex('state', 'state', { unique: false });
        store.createIndex('eventId', 'eventId', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open the scan queue.'));
    // Private browsing on iOS refuses the open and then never fires either
    // handler. Without this the gate hangs on a spinner with no explanation.
    request.onblocked = () => reject(new Error('The scan queue is open in another tab.'));
  });

  // A failed open must not be cached forever — the next attempt may be after
  // the operator has left private browsing.
  dbPromise.catch(() => { dbPromise = null; });

  return dbPromise;
}

function tx(db, mode) {
  return db.transaction(STORE, mode).objectStore(STORE);
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Everything for one event, oldest first. The event filter matters: a tablet
 *  reused next weekend must not show last weekend's shift log as if it were
 *  tonight's. */
export async function readAll(eventId) {
  const db = await openDb();
  const rows = await wrap(tx(db, 'readonly').getAll());
  return rows
    .filter((r) => !eventId || r.eventId === eventId)
    .sort((a, b) => String(a.occurredAt).localeCompare(String(b.occurredAt)));
}

export async function writeMany(records) {
  if (!records.length) return;
  const db = await openDb();
  const store = tx(db, 'readwrite');
  await Promise.all(records.map((r) => wrap(store.put(r))));
}

export async function writeOne(record) {
  return writeMany([record]);
}

export async function removeMany(ids) {
  if (!ids.length) return;
  const db = await openDb();
  const store = tx(db, 'readwrite');
  await Promise.all(ids.map((id) => wrap(store.delete(id))));
}

/** Drops settled records that are old or beyond the keep count. Never touches a
 *  pending one — see `prunable`. Returns how many went. */
export async function prune(records) {
  const ids = prunable(records);
  await removeMany(ids);
  return ids.length;
}

/** For sign-out on a shared tablet. Deliberately NOT called when a token
 *  expires: an expired token is a re-login, and the queue is the only copy of
 *  scans that have not reached the server. */
export async function clearAll() {
  const db = await openDb();
  await wrap(tx(db, 'readwrite').clear());
}
