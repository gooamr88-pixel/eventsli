/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The offline queue's rules, with no IndexedDB in sight.
 *
 * Split from scanQueue.js on purpose. The storage adapter is twenty lines of
 * `onupgradeneeded` boilerplate that either works or does not; the rules below
 * are where a scan gets lost, and they are worth tests that run in a second on
 * plain arrays instead of a fake database.
 *
 * FOUR RULES, and every one of them is about not losing an admission:
 *
 *   1. A record leaves the queue only when the SERVER has answered it. Not when
 *      the request is sent, not when it looks like it worked. An upload that
 *      times out mid-flight must leave every entry it carried still queued.
 *   2. A replay is free. Every entry carries a client-generated id, and
 *      `check_in_ticket` returns the ORIGINAL answer for an id it has seen, so
 *      re-uploading is a no-op rather than 200 duplicate refusals. That is what
 *      makes rule 1 safe to apply blindly.
 *   3. The clock is the DEVICE's. `occurredAt` is stamped when the code is read
 *      at the door, never when the upload happens. "Who was inside at 8pm" is a
 *      question about the door, and a queue that syncs at 9 would answer it
 *      with 9.
 *   4. Order is arrival order. The queue uploads oldest first, so if two people
 *      present the same ticket the one who actually arrived first is the one
 *      admitted.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** The API accepts 500 per request. 100 keeps a slow venue connection from
 *  spending a minute on one request that then fails as a whole. */
export const BATCH_SIZE = 100;

/** Uploads answered 'error' (other than "unavailable") before the scan settles as one. */
export const MAX_ATTEMPTS = 5;

/**
 * What is written to the device for a record. A ticket's code is a bearer
 * pass, needed only until the server has answered (to upload it): a settled
 * row keeps the ticket id and the answer, never the code — as the app does.
 */
export function stored(record) {
  return isPending(record) || !record.qr ? record : { ...record, qr: '' };
}

/** A scan the server has not answered yet. */
const PENDING = new Set(['queued', 'sending']);

export function isPending(record) {
  return PENDING.has(record?.state);
}

/** Oldest first — rule 4. `sending` is included because an upload that never
 *  came back leaves records in that state and they must be retried, not
 *  stranded. Rule 2 is what makes retrying them correct. */
export function nextBatch(records, limit = BATCH_SIZE) {
  return [...records]
    .filter(isPending)
    .sort((a, b) => String(a.occurredAt).localeCompare(String(b.occurredAt)))
    .slice(0, limit);
}

/** What `POST /scan/sync` wants. Nothing else from the record travels — the
 *  event comes from the device token, never from the body. */
export function toWire(record) {
  return {
    qr: record.qr,
    clientScanId: record.clientScanId,
    occurredAt: record.occurredAt,
  };
}

/**
 * Fold a sync response back into the records it came from.
 *
 * Returns `{ records, resolved, stranded }`:
 *   resolved — ids the server answered, now `done`
 *   stranded — ids that were sent and came back with NOTHING, or with an
 *              `error` that is not an answer yet, put back to `queued`. A
 *              silent gap is the one case where rule 1 gets broken by
 *              accident, so it is named rather than ignored.
 */
export function applyResults(records, results) {
  const byId = new Map();
  for (const r of results || []) {
    if (r?.clientScanId) byId.set(r.clientScanId, r);
  }

  const resolved = [];
  const stranded = [];

  const next = records.map((record) => {
    if (!isPending(record)) return record;

    const answer = byId.get(record.clientScanId);
    if (!answer) {
      if (record.state === 'sending') {
        stranded.push(record.clientScanId);
        return { ...record, state: 'queued' };
      }
      return record;
    }

    // 'error' is not an answer about the ticket (audit 2026-11-20). Settling
    // it lost the scan for good. `unavailable` — the server's database did not
    // answer — goes again however long that lasts; any other error goes again
    // MAX_ATTEMPTS times, so one row that can never be decided cannot hold the
    // queue. Neither is `resolved`: the sync loop stops and the timer retries.
    if (answer.result === 'error') {
      const attempts = (record.attempts || 0) + (answer.unavailable ? 0 : 1);
      if (answer.unavailable || attempts < MAX_ATTEMPTS) {
        stranded.push(record.clientScanId);
        return { ...record, state: 'queued', attempts, message: answer.message || null };
      }
    }

    resolved.push(record.clientScanId);
    return {
      ...record,
      state: 'done',
      // `ok`/`result` are the server's words. They replace nothing the device
      // believed, because offline the device believed nothing — see the
      // `queued` outcome, which is explicitly not a decision.
      result: answer.result,
      reason: answer.reason || null,
      message: answer.message || null,
      // The FIRST scan's device time, when this is a duplicate. That is the
      // number the operator reads out loud.
      scannedAt: answer.scanned_at || null,
      attendee: answer.attendee || null,
      seat: answer.seat || null,
      table: answer.table || null,
      // What this guest has to collect (add-ons, 2026-11-17): "Photo with
      // the headliner". Shown with the admission so staff hand it over.
      addons: Array.isArray(answer.addons) ? answer.addons : [],
      replay: Boolean(answer.replay),
      syncedAt: new Date().toISOString(),
    };
  });

  return { records: next, resolved, stranded };
}

/**
 * Has THIS DEVICE seen this ticket already, in this shift?
 *
 * A hint, not a verdict. It is shown immediately — before any network — because
 * at a door the useful thing to say is "you scanned that one four minutes ago".
 * It does NOT stop the scan being queued and uploaded: only the server decides,
 * and the second scan has to reach it so the log at the end of the night says
 * two codes were presented.
 */
export function priorScan(records, ticketId, exceptId) {
  if (!ticketId) return null;
  const seen = records
    .filter((r) => r.ticketId === ticketId && r.clientScanId !== exceptId)
    .filter((r) => r.state !== 'done' || r.result === 'admitted' || r.result === 'duplicate')
    .sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt)));
  return seen[0] || null;
}

export function counts(records) {
  let queued = 0;
  let admitted = 0;
  let refused = 0;
  for (const r of records) {
    if (isPending(r)) queued += 1;
    else if (r.result === 'admitted') admitted += 1;
    else refused += 1;
  }
  return { queued, admitted, refused, total: records.length };
}

/**
 * What may be forgotten.
 *
 * Only settled records, and only old ones. A tablet worked for a weekend
 * accumulates thousands of rows and the shift log on screen shows the last
 * twenty of them — but a pending scan is never pruned at any age, because the
 * only copy of an admission that has not reached the server is this row.
 */
export function prunable(records, { now = Date.now(), keepMs = 48 * 3600e3, keepMax = 2000 } = {}) {
  const settled = records
    .filter((r) => !isPending(r))
    .sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt)));

  const old = settled.filter((r) => now - Date.parse(r.occurredAt) > keepMs);
  const excess = settled.slice(keepMax);

  return [...new Set([...old, ...excess].map((r) => r.clientScanId))];
}

/**
 * A new record.
 *
 * `crypto.randomUUID` is the client-generated id rule 2 depends on. It has to
 * be made HERE, at the door, at the moment of the scan — an id the server
 * invents on upload would be a different id every retry, which is precisely the
 * bug that turns one guest into three admissions.
 */
export function newScan({ qr, ticketId, eventId, deviceId, occurredAt, state = 'queued' }) {
  return {
    clientScanId: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    qr,
    ticketId: ticketId || null,
    eventId: eventId || null,
    deviceId: deviceId || null,
    occurredAt: occurredAt || new Date().toISOString(),
    state,
    result: null,
    message: null,
    scannedAt: null,
    attendee: null,
    seat: null,
    table: null,
    replay: false,
    syncedAt: null,
  };
}
