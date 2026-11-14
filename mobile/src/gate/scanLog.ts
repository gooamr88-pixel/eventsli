import { randomUUID } from 'expo-crypto';
import { create } from 'zustand';

import { ApiError, NetworkError } from '../api/client';
import * as endpoints from '../api/endpoints';
import type { ScanAnswer } from '../api/types';
import { db } from '../lib/db';
import { DoorAuthError } from './errors';
import { decideOffline, HOLD_MESSAGES, type ListTicket } from './offlineDecision';
import { useOfflineList } from './offlineList';
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
 *   4. No answer (no signal, a timeout, a 5xx):
 *      • with the event's ticket list on the phone (offline admission), the
 *        phone decides (gate/offlineDecision.ts). An admission is queued to
 *        upload as one; a refusal is final and never uploaded; a ticket the
 *        list does not know is held.
 *      • without it, the scan is HELD — shown as "Held for upload", never as
 *        an admission — and uploaded later.
 *      Uploads go through /scan/sync, where the client id makes a re-upload a
 *      no-op, and every answer the server gives is folded into the list.
 */

export { DoorAuthError };

/** How long a live check waits before the phone decides on its own (when it can). */
const VERIFY_MS = 4000;
const VERIFY_MS_WITH_LIST = 2500;

type Row = {
  client_scan_id: string; event_id: string; qr: string; ticket_id: string | null; occurred_at: string;
  method: string; state: string; result: string | null; message: string | null; answer_json: string | null;
  synced_at: string | null; offline_verdict: string | null; attempts: number | null; device_id?: string | null;
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
  offlineVerdict: (r.offline_verdict as ScanRecord['offlineVerdict']) ?? null,
  attempts: Number(r.attempts) || 0,
  deviceId: r.device_id ?? null,
});

/**
 * The ticket's QR code is a bearer pass: whoever holds it can try the door
 * with it. The phone needs it only until the scan is settled (to upload it);
 * a settled row keeps the ticket id and the answer, never the code.
 */
export const storedQr = (rec: Pick<ScanRecord, 'state' | 'qr'>) =>
  rec.state === 'done' && !rec.qr.startsWith('manual:') ? '' : rec.qr;

async function save(rec: ScanRecord) {
  const d = await db();
  await d.runAsync(
    `INSERT OR REPLACE INTO scans
       (client_scan_id, event_id, qr, ticket_id, occurred_at, method, state, result, message, answer_json, synced_at, offline_verdict, attempts, device_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [rec.clientScanId, rec.eventId, storedQr(rec), rec.ticketId, rec.occurredAt, rec.method, rec.state,
      rec.result, rec.message, rec.answer ? JSON.stringify(rec.answer) : null, rec.syncedAt, rec.offlineVerdict, rec.attempts, rec.deviceId ?? null],
  );
}

/**
 * Housekeeping, across EVERY event on the phone (store/PRIVACY.md promises
 * 48 h or 2,000 rows): settled rows past 48 h, or beyond the newest 2,000, are
 * deleted. Never a pending one — that is an admission still to upload. Codes
 * left on settled rows by older versions are blanked (see storedQr).
 * Pruning only the event being opened left every other event's log, guest
 * answers included, on the phone for good.
 */
export async function prune(now = Date.now()): Promise<number> {
  const d = await db();
  await d.runAsync("UPDATE scans SET qr = '' WHERE state = 'done' AND qr <> '' AND qr NOT LIKE 'manual:%'", []);
  const all = await d.getAllAsync<Row>('SELECT * FROM scans', []);
  const drop = prunable(all.map(fromRow), { now });
  for (const id of drop) await d.runAsync('DELETE FROM scans WHERE client_scan_id = ?', [id]);
  return drop.length;
}

/** When this phone let a ticket in offline and has not uploaded it yet. The list cannot know that. */
async function admittedHere(eventId: string, ticketId: string): Promise<string | null> {
  const d = await db();
  const row = await d.getFirstAsync<{ occurred_at: string }>(
    `SELECT occurred_at FROM scans
      WHERE event_id = ? AND ticket_id = ? AND result = 'admitted' AND state <> 'done'
      ORDER BY occurred_at LIMIT 1`,
    [eventId, ticketId],
  );
  return row?.occurred_at ?? null;
}

/** The answer card the phone shows for its own decision, from the list's row. */
function card(ticket: ListTicket | null, result: string, extra: Partial<ScanAnswer> = {}): ScanAnswer {
  return {
    ok: result === 'admitted',
    result,
    method: 'offline',
    ...(ticket ? {
      ticket_id: ticket.ticketId,
      attendee: ticket.holder,
      tier: ticket.tier,
      seat: ticket.seat,
      table: ticket.table,
    } : {}),
    ...extra,
  };
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
  /** The door device working this event on this phone: stamped on every new scan. */
  deviceId: string | null;
  records: ScanRecord[];
  syncing: boolean;
  lastSync: string | null;
  load: (eventId: string, deviceId?: string | null) => Promise<void>;
  /** `offline`: the phone already knows it has no signal, so it does not wait for the server. */
  submit: (raw: string, doorToken: string, opts?: { offline?: boolean }) => Promise<ScanRecord | null>;
  manual: (ticketId: string, doorToken: string) => Promise<ScanRecord>;
  /** `limit`: at most this many scans in this upload (the Syncing screen sends a few at a time to show progress). */
  sync: (doorToken: string, opts?: { limit?: number }) => Promise<{ uploaded: number; conflicts: number } | null>;
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
      // 'error' is the server saying it could not decide: no answer, like a
      // timeout. Held (or decided from the offline list), never shown as settled.
      if (answer.result === 'error') throw new NetworkError(answer.message || 'The server could not decide.');
      const done = settle(rec, answer);
      await save(done);
      upsert(done);
      await useOfflineList.getState().applyAnswer(answer);
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
      // Development only: a store build's device log is readable over USB.
      if (__DEV__ && !decided && !(err instanceof NetworkError)) {
        console.warn('scan held after a server error', err);
      }
      return next;
    }
  }

  /** No server answer, and the event's list is on the phone: decide here. */
  async function decideHere(rec: ScanRecord, token: string): Promise<ScanRecord> {
    const list = useOfflineList.getState();
    const ctx = list.context();
    if (!ctx) return rec;
    const claims = peekTicket(token);
    const ticket = claims ? await list.find(claims.ticketId) : null;
    const here = claims ? await admittedHere(rec.eventId, claims.ticketId) : null;
    const decision = decideOffline(token, ctx, ticket, here);

    const decided: ScanRecord = { ...rec, method: 'offline', message: null, syncedAt: null };
    let next: ScanRecord;
    switch (decision.kind) {
      case 'admit':
        next = { ...decided, state: 'queued', result: 'admitted', offlineVerdict: 'admitted', answer: card(decision.ticket, 'admitted') };
        break;
      case 'duplicate':
        next = {
          ...decided, state: 'done', result: 'duplicate', offlineVerdict: null,
          answer: card(decision.ticket, 'duplicate', decision.at ? { scanned_at: decision.at } : {}),
        };
        break;
      case 'refuse':
        next = {
          ...decided, state: 'done', result: decision.result, offlineVerdict: null,
          answer: card(decision.ticket, decision.result, decision.reason ? { reason: decision.reason } : {}),
        };
        break;
      default:
        if (decision.reason === 'unknown_key') list.markKeysStale();
        next = {
          ...decided, state: 'queued', result: null, answer: null, message: HOLD_MESSAGES[decision.reason],
          offlineVerdict: decision.reason === 'not_on_list' ? 'unconfirmed' : 'held',
        };
    }
    await save(next);
    upsert(next);
    return next;
  }

  return {
    eventId: null,
    deviceId: null,
    records: [],
    syncing: false,
    lastSync: null,

    async load(eventId, deviceId = null) {
      const d = await db();
      const rows = await d.getAllAsync<Row>(
        'SELECT * FROM scans WHERE event_id = ? ORDER BY occurred_at DESC LIMIT ?', [eventId, SHOWN],
      );
      set({ eventId, deviceId, records: rows.map(fromRow) });
      await prune();
    },

    async submit(raw, doorToken, opts = {}) {
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
        offlineVerdict: null,
        attempts: 0,
        deviceId: get().deviceId,
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
      const canDecide = useOfflineList.getState().context() !== null;
      if (opts.offline && canDecide) return decideHere(base, token);

      const answered = await ask(base, doorToken, () => endpoints.verify(
        doorToken, token, base.clientScanId, base.occurredAt, canDecide ? VERIFY_MS_WITH_LIST : VERIFY_MS,
      ));
      return answered.state === 'queued' && canDecide ? decideHere(answered, token) : answered;
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
        offlineVerdict: null,
        attempts: 0,
        deviceId: get().deviceId,
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

    async sync(doorToken, opts = {}) {
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
        const batch = nextBatch(pending.map((r) => ({ ...r, state: 'queued' as const })), opts.limit);
        if (batch.length === 0) return { uploaded: 0, conflicts: 0 };

        const res = await endpoints.sync(doorToken, batch.map((r) => ({ ...toWire(r), method: 'offline' as const })));
        const changed = applyResults(batch, res.results);
        for (const rec of changed) {
          await save(rec);
          upsert(rec);
        }
        const list = useOfflineList.getState();
        for (const answer of res.results) await list.applyAnswer(answer);
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

      // Let in offline and not uploaded yet: the server has never heard of it,
      // so undoing it is cancelling the upload. Not while an upload is in
      // flight, which might be carrying it.
      if (rec.state === 'queued' && rec.offlineVerdict === 'admitted') {
        if (get().syncing) throw new Error('This scan is uploading right now. Try Undo again in a moment.');
        const cancelled: ScanRecord = {
          ...rec, state: 'done', result: 'undone', offlineVerdict: null,
          message: 'Cancelled on this phone before it uploaded.', syncedAt: new Date().toISOString(),
        };
        await save(cancelled);
        upsert(cancelled);
        return cancelled;
      }

      try {
        await endpoints.undo(doorToken, rec.ticketId);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) throw new DoorAuthError(err.message);
        throw err;
      }
      const undone: ScanRecord = { ...rec, result: 'undone', message: null, syncedAt: new Date().toISOString() };
      await save(undone);
      upsert(undone);
      await useOfflineList.getState().applyAnswer({ result: 'undone', ticket_id: rec.ticketId });
      return undone;
    },

    clear() {
      set({ eventId: null, deviceId: null, records: [], lastSync: null, syncing: false });
    },
  };
});

export const pendingCount = (records: ScanRecord[]) => records.filter(isPending).length;
