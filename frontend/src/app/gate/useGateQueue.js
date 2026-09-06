'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, NetworkError } from '../utils/apiClient';
import { gatePost, GateAuthError } from './gateSession';
import { extractToken, offlineVerdict, peekTicket } from './qrToken';
import * as store from './scanQueue';
import {
  BATCH_SIZE, applyResults, counts, newScan, nextBatch, priorScan, toWire,
} from './queuePolicy';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * One scan, from the lens to the server, with a queue in the middle that never
 * loses one.
 *
 * The records live in a ref as well as in state. That is not a shortcut: a sync
 * walks the queue in batches, and each batch has to be computed from the result
 * of the last one. React state is not readable that way inside a loop — the
 * second batch would be picked from the list as it was before the first one
 * came back, and the same scans would be uploaded twice. Harmless, because
 * replays are safe, but it would loop forever.
 *
 * So: the ref is the value, `commit` is the only writer, and it updates the ref,
 * the screen and IndexedDB together.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** While there is anything pending and a connection, try again on this cadence.
 *  Slow on purpose — the `online` event is what usually fires first; this is the
 *  backstop for a connection that came back without the browser noticing. */
const RETRY_MS = 20_000;

export function useGateQueue(session) {
  const eventId = session?.eventId || null;

  const recordsRef = useRef([]);
  const [records, setRecords] = useState([]);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [online, setOnline] = useState(true);

  const commit = useCallback(async (next, { persist = [] } = {}) => {
    recordsRef.current = next;
    setRecords(next);
    if (persist.length) {
      try { await store.writeMany(persist); } catch (err) { setStorageError(err); }
    }
  }, []);

  // ── Load ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!eventId) return undefined;
    let cancelled = false;

    (async () => {
      try {
        const rows = await store.readAll(eventId);
        if (cancelled) return;
        recordsRef.current = rows;
        setRecords(rows);
        setStorageError(null);
        // Housekeeping, after the screen has what it needs. Pending scans are
        // never pruned at any age — that row is the only copy of an admission
        // that has not reached the server.
        const dropped = await store.prune(rows);
        if (!cancelled && dropped) {
          const kept = await store.readAll(eventId);
          if (!cancelled) { recordsRef.current = kept; setRecords(kept); }
        }
      } catch (err) {
        if (!cancelled) setStorageError(err);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();

    return () => { cancelled = true; };
  }, [eventId]);

  // ── Connectivity ──────────────────────────────────────────────────────────
  // `navigator.onLine` is read in an effect rather than in the initial state,
  // because the server has no navigator and a `false` rendered into the HTML
  // would flash "offline" on a tablet that is not.
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  // ── Upload ────────────────────────────────────────────────────────────────
  const syncingRef = useRef(false);

  const sync = useCallback(async () => {
    if (syncingRef.current || !session?.token) return null;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return null;
    if (!nextBatch(recordsRef.current, 1).length) return null;

    syncingRef.current = true;
    setSyncing(true);
    const totals = { total: 0, admitted: 0, replayed: 0, stranded: 0 };

    try {
      // Bounded. A queue that somehow never resolves must stop rather than spin
      // the tablet's battery flat trying.
      for (let pass = 0; pass < 20; pass += 1) {
        const batch = nextBatch(recordsRef.current, BATCH_SIZE);
        if (!batch.length) break;

        const sending = new Set(batch.map((r) => r.clientScanId));
        await commit(recordsRef.current.map((r) => (
          sending.has(r.clientScanId) ? { ...r, state: 'sending' } : r
        )));

        // Sequential on purpose. Batches are uploaded one after another because
        // each is chosen from what the last one resolved, and because a venue
        // connection that just came back does not want ten parallel requests.
        let response;
        try {
          response = await gatePost('/scan/sync', { scans: batch.map(toWire) });
        } catch (err) {
          // Put every sent record back. Rule 1: a record leaves the queue only
          // when the server has answered it, and a failed upload answered none.
          await commit(recordsRef.current.map((r) => (
            r.state === 'sending' ? { ...r, state: 'queued' } : r
          )), { persist: batch.map((r) => ({ ...r, state: 'queued' })) });
          throw err;
        }

        const { records: next, resolved, stranded } = applyResults(
          recordsRef.current, response.results,
        );
        const touched = next.filter((r) => resolved.includes(r.clientScanId)
          || stranded.includes(r.clientScanId));
        await commit(next, { persist: touched });

        totals.total += response.summary?.total || 0;
        totals.admitted += response.summary?.admitted || 0;
        totals.replayed += response.summary?.replayed || 0;
        totals.stranded += stranded.length;

        // Nothing moved. Retrying the identical batch would loop.
        if (!resolved.length) break;
      }

      setLastSync({ ...totals, at: new Date().toISOString(), ok: true });
      return totals;
    } catch (err) {
      if (err instanceof GateAuthError) throw err;
      setLastSync({ ...totals, at: new Date().toISOString(), ok: false, error: err });
      return null;
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [commit, session?.token]);

  /** The callback identity changes with the session; the ref keeps the timer
   *  and the listener from being torn down and rebuilt on every scan. */
  const syncRef = useRef(sync);
  useEffect(() => { syncRef.current = sync; });

  useEffect(() => {
    if (!ready || !session?.token) return undefined;

    const run = () => { syncRef.current()?.catch?.(() => {}); };
    run();

    window.addEventListener('online', run);
    const timer = setInterval(run, RETRY_MS);
    return () => {
      window.removeEventListener('online', run);
      clearInterval(timer);
    };
  }, [ready, session?.token]);

  // ── One scan ──────────────────────────────────────────────────────────────
  const submit = useCallback(async (raw) => {
    const qr = extractToken(raw);
    if (!qr) return null;

    const claims = peekTicket(qr);
    const verdict = offlineVerdict(qr, eventId);

    const record = newScan({
      qr,
      ticketId: claims?.ticketId || null,
      eventId,
      deviceId: session?.deviceId || null,
      state: verdict ? 'done' : 'queued',
    });

    // The hint, from this device's own log, computed BEFORE the record is added
    // so it does not find itself.
    const prior = priorScan(recordsRef.current, record.ticketId, record.clientScanId);

    /**
     * A code that is not a ticket, or is a ticket for another event, is refused
     * here and never queued. This is a SHAPE check on an unverified payload —
     * it can only refuse, never admit — and it saves the operator from filing
     * rubbish that would come back an hour later as a refusal anyway.
     */
    if (verdict) {
      const settled = { ...record, result: verdict, syncedAt: new Date().toISOString() };
      await commit([...recordsRef.current, settled], { persist: [settled] });
      return { record: settled, prior };
    }

    await commit([...recordsRef.current, record], { persist: [record] });

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return { record, prior };
    }

    // ── Online: ask now. The queue entry stays until the answer lands. ───────
    const sendingRecord = { ...record, state: 'sending' };
    await commit(
      recordsRef.current.map((r) => (r.clientScanId === record.clientScanId ? sendingRecord : r)),
    );

    let answer;
    try {
      answer = await gatePost('/scan/verify', toWire(record));
    } catch (err) {
      if (err instanceof GateAuthError) throw err;

      // A LOCKED GATE IS THE ONE 403. It is a decision, not a failure, so it is
      // recorded as the scan's result rather than left in the queue to be
      // retried against a gate that will refuse it identically forever.
      if (err instanceof ApiError && err.code === 'SCANNER_LOCKED') {
        const locked = {
          ...record, state: 'done', result: 'scanner_locked',
          message: err.message, syncedAt: new Date().toISOString(),
        };
        await commit(
          recordsRef.current.map((r) => (r.clientScanId === record.clientScanId ? locked : r)),
          { persist: [locked] },
        );
        return { record: locked, prior, error: err };
      }

      // Anything else — a dropped connection, a timeout, a 500 — leaves it
      // QUEUED. The request may well have reached the server; the client scan
      // id is what makes finding out later safe.
      const queued = { ...record, state: 'queued' };
      await commit(
        recordsRef.current.map((r) => (r.clientScanId === record.clientScanId ? queued : r)),
        { persist: [queued] },
      );
      return { record: queued, prior, error: err instanceof NetworkError ? err : null };
    }

    const { records: next } = applyResults(recordsRef.current, [
      { ...answer, clientScanId: record.clientScanId },
    ]);
    const settled = next.find((r) => r.clientScanId === record.clientScanId);
    await commit(next, { persist: [settled] });
    return { record: settled, prior };
  }, [commit, eventId, session?.deviceId]);

  // ── Undo ──────────────────────────────────────────────────────────────────
  /**
   * The ticket id comes from the scanned token's own claims, because the
   * admission response does not carry one — `check_in_ticket` returns a name, a
   * seat and a time, which is what a door needs to READ, not an id.
   *
   * A queued scan cannot be undone: there is nothing to reverse yet. Deleting
   * the queue entry instead would be worse — the guest is standing inside.
   */
  const undo = useCallback(async (record) => {
    if (!record?.ticketId || record.result !== 'admitted') return null;
    const result = await gatePost('/scan/undo', { ticketId: record.ticketId });
    const undone = { ...record, result: 'undone', message: null, syncedAt: new Date().toISOString() };
    await commit(
      recordsRef.current.map((r) => (r.clientScanId === record.clientScanId ? undone : r)),
      { persist: [undone] },
    );
    return result;
  }, [commit]);

  return {
    records, ready, storageError, online, syncing, lastSync,
    ...counts(records),
    submit, sync, undo,
  };
}
