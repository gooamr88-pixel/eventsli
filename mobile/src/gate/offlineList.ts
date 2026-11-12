import { create } from 'zustand';

import { ApiError, messageFor } from '../api/client';
import * as endpoints from '../api/endpoints';
import type { ManifestPage, ManifestRow, PublicJwk, ScanAnswer } from '../api/types';
import { db } from '../lib/db';
import { DoorAuthError } from './errors';
import type { ListContext, ListTicket } from './offlineDecision';

/**
 * The event's ticket list on this phone, for deciding with no signal
 * (gate/offlineDecision.ts), kept in the encrypted database.
 *
 *   pull()        GET /scan/manifest page by page until the server says
 *                 `done`. The first time that is every ticket; afterwards
 *                 only what changed. Each page is written in one transaction,
 *                 with the cursor that follows it, so a pull cut off half way
 *                 resumes rather than starting again. The public keys that
 *                 verify QR v2 codes come with it (GET /scan/keys).
 *   applyAnswer() keeps the list current between pulls with every answer the
 *                 server gives this phone (a scan, an upload, an undo).
 *   context()     what a decision needs, or null when this phone must not
 *                 decide: no complete list yet, the organizer switched
 *                 offline check-in off, or the event ended over 24 h ago.
 *
 * The list is guest data on a phone, so it is deleted when the door is left
 * or the account signed out (auth/session.ts), when the organizer switches
 * offline check-in off (the server says so on the next pull), and 24 h after
 * the event ends. Names are only in it when the organizer allows them.
 */

const KEYS_EVERY_MS = 30 * 60e3;
const KEEP_AFTER_END_MS = 24 * 3600e3;
/** 2,000 tickets a page: an event of 100,000 is a long first pull, not an endless one. */
const MAX_PAGES = 50;

type EventInfo = ManifestPage['event'];

type MetaRow = {
  event_id: string; cursor: string | null; complete: number; synced_at: string | null; names: number;
  event_json: string | null; gate_locked: number; gate_reason?: string | null; legacy_qr_offline: string; keys_json: string | null; keys_at: string | null;
};

type ListRow = {
  ticket_id: string; v: number; status: string; scanned_at: string | null; tier: string | null;
  seat: string | null; table_label: string | null; holder: string | null;
};

const toTicket = (r: ListRow): ListTicket => ({
  ticketId: r.ticket_id,
  v: Number(r.v) || 0,
  status: (r.status === 'scanned' || r.status === 'void' ? r.status : 'valid'),
  scannedAt: r.scanned_at,
  tier: r.tier,
  seat: r.seat,
  table: r.table_label,
  holder: r.holder,
});

const parse = <T>(json: string | null, fallback: T): T => {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
};

type State = {
  eventId: string | null;
  complete: boolean;
  count: number;
  syncedAt: string | null;
  names: boolean;
  event: EventInfo;
  gateLocked: boolean;
  gateReason: string | null;
  legacyQrOffline: 'allow' | 'hold';
  keys: PublicJwk[];
  keysAt: string | null;
  keysStale: boolean;
  off: boolean;
  pulling: boolean;
  lastError: string | null;
  load: (eventId: string) => Promise<void>;
  pull: (doorToken: string) => Promise<boolean>;
  find: (ticketId: string) => Promise<ListTicket | null>;
  context: (now?: number) => ListContext | null;
  applyAnswer: (answer: Pick<ScanAnswer, 'result' | 'ticket_id' | 'scanned_at'>) => Promise<void>;
  markKeysStale: () => void;
  wipe: () => Promise<void>;
  wipeAll: () => Promise<void>;
};

const EMPTY = {
  complete: false, count: 0, syncedAt: null, names: false, event: null, gateLocked: false, gateReason: null,
  legacyQrOffline: 'allow' as const, keys: [] as PublicJwk[], keysAt: null, keysStale: false, off: false, lastError: null,
};

const expired = (event: EventInfo, now: number) =>
  Boolean(event?.endsAt && now > Date.parse(event.endsAt) + KEEP_AFTER_END_MS);

export const useOfflineList = create<State>((set, get) => {
  /** Read what is on disk for this event into memory. */
  async function refresh(eventId: string) {
    const d = await db();
    const meta = await d.getFirstAsync<MetaRow>('SELECT * FROM ticket_list_meta WHERE event_id = ?', [eventId]);
    const counted = await d.getFirstAsync<{ n: number }>('SELECT count(*) AS n FROM ticket_list WHERE event_id = ?', [eventId]);
    if (get().eventId !== eventId) return;
    set({
      complete: Boolean(meta?.complete),
      count: Number(counted?.n) || 0,
      syncedAt: meta?.synced_at ?? null,
      names: Boolean(meta?.names),
      event: parse<EventInfo>(meta?.event_json ?? null, null),
      gateLocked: Boolean(meta?.gate_locked),
      gateReason: meta?.gate_reason ?? null,
      legacyQrOffline: meta?.legacy_qr_offline === 'hold' ? 'hold' : 'allow',
      keys: parse<PublicJwk[]>(meta?.keys_json ?? null, []),
      keysAt: meta?.keys_at ?? null,
    });
  }

  async function erase(eventId: string | null) {
    const d = await db();
    if (eventId) {
      await d.runAsync('DELETE FROM ticket_list WHERE event_id = ?', [eventId]);
      await d.runAsync('DELETE FROM ticket_list_meta WHERE event_id = ?', [eventId]);
    } else {
      await d.runAsync('DELETE FROM ticket_list', []);
      await d.runAsync('DELETE FROM ticket_list_meta', []);
    }
  }

  async function writePage(eventId: string, page: ManifestPage) {
    const d = await db();
    const now = new Date().toISOString();
    await d.withTransactionAsync(async () => {
      if (page.reset) await d.runAsync('DELETE FROM ticket_list WHERE event_id = ?', [eventId]);
      for (const r of page.rows as ManifestRow[]) {
        await d.runAsync(
          `INSERT OR REPLACE INTO ticket_list
             (event_id, ticket_id, v, status, scanned_at, tier, seat, table_label, holder)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [eventId, r.ticketId, r.v, r.status, r.scannedAt, r.tier, r.seat, r.table, r.holder],
        );
      }
      // A reset makes the list incomplete until the run that began it is done.
      const previous = await d.getFirstAsync<MetaRow>('SELECT * FROM ticket_list_meta WHERE event_id = ?', [eventId]);
      const complete = page.done ? 1 : page.reset ? 0 : (previous?.complete ?? 0);
      await d.runAsync(
        `INSERT OR REPLACE INTO ticket_list_meta
           (event_id, cursor, complete, synced_at, names, event_json, gate_locked, gate_reason, legacy_qr_offline, keys_json, keys_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [eventId, page.cursor, complete, page.done ? now : (previous?.synced_at ?? null), page.names ? 1 : 0,
          JSON.stringify(page.event), page.gateLocked ? 1 : 0, page.gateLocked ? (page.gateReason ?? null) : null, page.legacyQrOffline,
          previous?.keys_json ?? null, previous?.keys_at ?? null],
      );
    });
  }

  async function saveKeys(eventId: string, keys: PublicJwk[]) {
    const d = await db();
    await d.runAsync('UPDATE ticket_list_meta SET keys_json = ?, keys_at = ? WHERE event_id = ?',
      [JSON.stringify(keys), new Date().toISOString(), eventId]);
  }

  return {
    eventId: null,
    pulling: false,
    ...EMPTY,

    async load(eventId) {
      set({ eventId, ...EMPTY });
      await refresh(eventId);
      if (expired(get().event, Date.now())) await get().wipe();
    },

    async pull(doorToken) {
      const eventId = get().eventId;
      // Taken before the first await, like the scan log's upload: the 15 s
      // timer, the reconnect and the return to the foreground arrive together.
      if (!eventId || get().pulling) return false;
      set({ pulling: true });
      try {
        const d = await db();
        let cursor = (await d.getFirstAsync<MetaRow>('SELECT cursor FROM ticket_list_meta WHERE event_id = ?', [eventId]))?.cursor ?? null;
        for (let i = 0; i < MAX_PAGES; i += 1) {
          const page = await endpoints.manifest(doorToken, cursor);
          if (get().eventId !== eventId) return false;
          await writePage(eventId, page);
          cursor = page.cursor;
          if (page.done) break;
        }
        const s = get();
        const keysDue = !s.keysAt || Date.now() - Date.parse(s.keysAt) > KEYS_EVERY_MS;
        if (s.keys.length === 0 || s.keysStale || keysDue) {
          const { keys } = await endpoints.keys(doorToken);
          await saveKeys(eventId, keys);
          set({ keysStale: false });
        }
        await refresh(eventId);
        set({ off: false, lastError: null });
        if (expired(get().event, Date.now())) await get().wipe();
        return get().complete;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) throw new DoorAuthError(err.message);
        if (err instanceof ApiError && err.status === 403 && err.meta?.reason === 'offline_admission_off') {
          await erase(eventId);
          set({ ...EMPTY, off: true });
          return false;
        }
        // Pages already written stay (the next pull resumes after them); show
        // what is on disk, which is not a complete list if a reset began it.
        await refresh(eventId).catch(() => undefined);
        set({ lastError: messageFor(err) });
        return get().complete;
      } finally {
        set({ pulling: false });
      }
    },

    async find(ticketId) {
      const eventId = get().eventId;
      if (!eventId) return null;
      const d = await db();
      const row = await d.getFirstAsync<ListRow>(
        'SELECT * FROM ticket_list WHERE event_id = ? AND ticket_id = ?', [eventId, ticketId],
      );
      return row ? toTicket(row) : null;
    },

    context(now = Date.now()) {
      const s = get();
      if (!s.eventId || !s.complete || s.off || expired(s.event, now)) return null;
      return {
        eventId: s.eventId,
        eventStatus: s.event?.status ?? null,
        gateLocked: s.gateLocked,
        gateReason: s.gateReason,
        legacyQrOffline: s.legacyQrOffline,
        keys: s.keys,
      };
    },

    async applyAnswer(answer) {
      const eventId = get().eventId;
      const ticketId = answer.ticket_id;
      if (!eventId || !ticketId) return;
      let status: ListTicket['status'] | null = null;
      let scannedAt: string | null = null;
      if (answer.result === 'admitted' || answer.result === 'duplicate') {
        status = 'scanned';
        scannedAt = answer.scanned_at ?? new Date().toISOString();
      } else if (answer.result === 'void') {
        status = 'void';
      } else if (answer.result === 'undone') {
        status = 'valid';
      }
      if (!status) return;
      const d = await db();
      await d.runAsync(
        'UPDATE ticket_list SET status = ?, scanned_at = ? WHERE event_id = ? AND ticket_id = ?',
        [status, scannedAt, eventId, ticketId],
      );
    },

    markKeysStale() {
      set({ keysStale: true });
    },

    async wipe() {
      const eventId = get().eventId;
      await erase(eventId);
      set({ ...EMPTY });
    },

    async wipeAll() {
      await erase(null);
      set({ eventId: null, ...EMPTY });
    },
  };
});
