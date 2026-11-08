import { randomUUID } from 'expo-crypto';
import { create } from 'zustand';

import { ApiError, NetworkError } from '../api/client';
import * as endpoints from '../api/endpoints';
import type { ScanAnswer } from '../api/types';
import { db } from '../lib/db';
import { offlineVerdict, peekTicket, extractToken } from './qrToken';
import { applyResults, isPending, nextBatch, prunable, toWire, type ScanRecord } from './queuePolicy';

/**
 * This phone's scan log for the event it is working, and the only path a scan
 * takes:
 *
 *   1. Refuse at once what the server certainly would — not a ticket, or a
 *      ticket for another event. No round trip.
 *   2. Write the scan down FIRST, with a client id and the door's time. From
 *      here it cannot be lost: a crash, a dead battery, a dropped signal all
 *      leave it in the log to upload.
 *   3. Ask the server. Its answer is the decision.
 *   4. No answer (no signal, a timeout, a 5xx) → the scan is HELD — shown as
 *      "Held for upload", never as an admission — and uploaded later through
 *      /scan/sync, where the client id makes a re-upload a no-op.
 *
 * Phase 3 adds an offline verdict between 3 and 4 from the event's ticket list.
 */

export class DoorAuthError extends Error {}

type Row = {
  client_scan_id: string; event_id: string; qr: string; ticket_id: string | null; occurred_at: string;
  method: string; state: string; result: string | null; message: string | null; answer_json: string | null;
  synced_at: string | null;
};

const fromRow = (r: Row): ScanRecord => ({
  clientScanId: r.client_scan_id,
  eventId: r.event_id,
  qr: r.qr,
  ticketId: r.ticket_id,
  occurredAt: r.occurred_at,
  method: r.method as ScanRecord['method'],
  state: r.state as ScanRecord['state'],
  result: r.result,
  message: r.message,
  answer: r.answer_json ? (JSON.parse(r.answer_json) as ScanAnswer) : null,
  syncedAt: r.synced_at,
});

async function save(rec: ScanRecord) {
  const d = await db();
  await d.runAsync(
    `INSERT OR REPLACE INTO scans
       (client_scan_id, event_id, qr, ticket_id, occurred_at, method, state, result, message, answer_json, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [rec.clientScanId, rec.eventId, rec.qr, rec.ticketId, rec.occurredAt, rec.method, rec.state,
      rec.result, rec.message, rec.answer ? JSON.stringify(rec.answer) : null, rec.syncedAt],
  );
}

function settle(rec: ScanRecord, answer: ScanAnswer): ScanRecord {
  return {
    ...rec,
    state: 'done',
    result: answer.result,
    message: answer.message ?? null,
    answer,
    ticketId: answer.ticket_id ?? rec.ticketId,
    syncedAt: new Date().toISOString(),
  };
}

type State = {
  eventId: string | null;
  records: ScanRecord[];
  syncing: boolean;
  lastSync: string | null;
  load: (eventId: string) => Promise<void>;
  submit: (raw: string, doorToken: string) => Promise<ScanRecord | null>;
  manual: (ticketId: string, doorToken: string) => Promise<ScanRecord>;
  sync: (doorToken: string) => Promise<{ uploaded: number; conflicts: number } | null>;
  undo: (rec: ScanRecord, doorToken: string) => Promise<ScanRecord>;
  clear: () => void;
};

const SHOWN = 200;
/** A live /scan/verify gives up after 4 s; a `sending` row older than this was stranded. */
const STALE_SENDING_MS = 30_000;

export const useScanLog = create<State>((set, get) => {
  /** Keep the in-memory list in step with what was written. */
  function upsert(rec: ScanRecord) {
    const rest = get().records.filter((r) => r.clientScanId !== rec.clientScanId);
    set({ records: [rec, ...rest].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, SHOWN) });
  }

  async function ask(rec: ScanRecord, doorToken: string, call: () => Promise<ScanAnswer>): Promise<ScanRecord> {
    try {
      const answer = await call();
      const done = settle(rec, answer);
      await save(done);
      upsert(done);
      return done;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) throw new DoorAuthError(err.message);
      const decided = err instanceof ApiError && err.status === 400;
      const next: ScanRecord = decided
        ? { ...rec, state: 'done', result: 'invalid', message: err.message, syncedAt: new Date().toISOString() }
        // No signal, a timeout, a busy server: not a decision. Held.
        : { ...rec, state: 'queued' };
      await save(next);
      upsert(next);
      if (!decided && !(err instanceof NetworkError)) {
        console.warn('scan held after a server error', err);
      }
      return next;
    }
  }

  return {
    eventId: null,
    records: [],
    syncing: false,
    lastSync: null,

    async load(eventId) {
      const d = await db();
      const rows = await d.getAllAsync<Row>(
        'SELECT * FROM scans WHERE event_id = ? ORDER BY occurred_at DESC LIMIT ?', [eventId, SHOWN],
      );
      set({ eventId, records: rows.map(fromRow) });
      // Housekeeping: settled rows past 48 h or beyond 2,000. Never a pending one.
      const all = await d.getAllAsync<Row>('SELECT * FROM scans WHERE event_id = ?', [eventId]);
      const drop = prunable(all.map(fromRow));
      for (const id of drop) await d.runAsync('DELETE FROM scans WHERE client_scan_id = ?', [id]);
    },

    async submit(raw, doorToken) {
      const eventId = get().eventId;
      if (!eventId) return null;
      const token = extractToken(raw);
      if (!token) return null;

      const now = new Date().toISOString();
      const base: ScanRecord = {
        clientScanId: randomUUID(),
        eventId,
        qr: token,
        ticketId: peekTicket(token)?.ticketId ?? null,
        occurredAt: now,
        method: 'scan',
        state: 'sending',
        result: null,
        message: null,
        answer: null,
        syncedAt: null,
      };

      const certain = offlineVerdict(token, eventId);
      if (certain) {
        const done: ScanRecord = { ...base, state: 'done', result: certain, syncedAt: now };
        await save(done);
        upsert(done);
        return done;
      }

      await save(base);
      upsert(base);
      return ask(base, doorToken, () => endpoints.verify(doorToken, token, base.clientScanId, base.occurredAt));
    },

    async manual(ticketId, doorToken) {
      const eventId = get().eventId as string;
      const rec: ScanRecord = {
        clientScanId: randomUUID(),
        eventId,
        qr: `manual:${ticketId}`,
        ticketId,
        occurredAt: new Date().toISOString(),
        method: 'manual',
        state: 'sending',
        result: null,
        message: null,
        answer: null,
        syncedAt: null,
      };
      await save(rec);
      upsert(rec);
      try {
        return await ask(rec, doorToken, () => endpoints.manualCheckIn(doorToken, ticketId, rec.clientScanId));
      } finally {
        // A manual check-in needs the list to have been reachable; it is never
        // queued for /scan/sync (which takes codes, not ticket ids).
        const latest = get().records.find((r) => r.clientScanId === rec.clientScanId);
        if (latest?.state === 'queued') {
          const failed = { ...latest, state: 'done' as const, result: 'error', message: 'No connection — try again.' };
          await save(failed);
          upsert(failed);
        }
      }
    },

    async sync(doorToken) {
      const eventId = get().eventId;
      // Taken BEFORE the first await. The 20 s timer, "signal is back" and "app
      // is in front again" fire together on reconnect; checked after an await,
      // all three passed the guard and uploaded the same queue at once.
      if (!eventId || get().syncing) return null;
      set({ syncing: true });
      try {
        const d = await db();
        const now = Date.now();
        const pending = (await d.getAllAsync<Row>(
          "SELECT * FROM scans WHERE event_id = ? AND state <> 'done' AND qr NOT LIKE 'manual:%'", [eventId],
        )).map(fromRow)
          // A `sending` row is a live check still waiting on /scan/verify — not
          // ours to send again. Only one left behind (a crash, a killed app)
          // is picked up, once it is clearly stale.
          .filter((r) => r.state === 'queued' || now - Date.parse(r.occurredAt) > STALE_SENDING_MS);
        const batch = nextBatch(pending.map((r) => ({ ...r, state: 'queued' as const })));
        if (batch.length === 0) return { uploaded: 0, conflicts: 0 };

        const res = await endpoints.sync(doorToken, batch.map((r) => ({ ...toWire(r), method: 'offline' as const })));
        const changed = applyResults(batch, res.results);
        for (const rec of changed) {
          await save(rec);
          upsert(rec);
        }
        set({ lastSync: new Date().toISOString() });
        return { uploaded: res.summary.total, conflicts: res.summary.conflicts };
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) throw new DoorAuthError(err.message);
        return null;
      } finally {
        set({ syncing: false });
      }
    },

    async undo(rec, doorToken) {
      if (!rec.ticketId || rec.result !== 'admitted') return rec;
      try {
        await endpoints.undo(doorToken, rec.ticketId);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) throw new DoorAuthError(err.message);
        throw err;
      }
      const undone: ScanRecord = { ...rec, result: 'undone', message: null, syncedAt: new Date().toISOString() };
      await save(undone);
      upsert(undone);
      return undone;
    },

    clear() {
      set({ eventId: null, records: [], lastSync: null, syncing: false });
    },
  };
});

export const pendingCount = (records: ScanRecord[]) => records.filter(isPending).length;
