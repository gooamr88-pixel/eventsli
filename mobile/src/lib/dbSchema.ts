/**
 * The phone database's tables, and the steps that bring an older copy up to
 * date. Kept apart from db.ts (which opens the encrypted file) so tests can run
 * exactly these statements against a real SQLite.
 *
 *   scans             this door's scan log (gate/scanLog.ts)
 *   ticket_list       the event's tickets, for deciding with no signal
 *   ticket_list_meta  where that list's sync stands, and what came with it
 *                     (gate/offlineList.ts)
 *
 * `PRAGMA user_version` records which steps a file has had. A phone that ran
 * the Phase 2 build has version 0 and a scans table without offline_verdict.
 */

/** The part of a database the migration uses (expo-sqlite's, or a test's). */
export type SchemaDb = {
  execAsync(sql: string): Promise<void>;
  getFirstAsync<T>(sql: string): Promise<T | null>;
  getAllAsync<T>(sql: string): Promise<T[]>;
};

export const SCHEMA_VERSION = 3;

const BASE = `
  CREATE TABLE IF NOT EXISTS scans (
    client_scan_id  TEXT PRIMARY KEY NOT NULL,
    event_id        TEXT NOT NULL,
    qr              TEXT NOT NULL,
    ticket_id       TEXT,
    occurred_at     TEXT NOT NULL,
    method          TEXT NOT NULL DEFAULT 'scan',
    state           TEXT NOT NULL,
    result          TEXT,
    message         TEXT,
    answer_json     TEXT,
    synced_at       TEXT
  );
  CREATE INDEX IF NOT EXISTS scans_event_time ON scans (event_id, occurred_at DESC);
  CREATE INDEX IF NOT EXISTS scans_pending ON scans (state) WHERE state <> 'done';
`;

const V2 = `
  CREATE TABLE IF NOT EXISTS ticket_list (
    event_id     TEXT NOT NULL,
    ticket_id    TEXT NOT NULL,
    v            INTEGER NOT NULL DEFAULT 0,
    status       TEXT NOT NULL,
    scanned_at   TEXT,
    tier         TEXT,
    seat         TEXT,
    table_label  TEXT,
    holder       TEXT,
    PRIMARY KEY (event_id, ticket_id)
  );
  CREATE TABLE IF NOT EXISTS ticket_list_meta (
    event_id           TEXT PRIMARY KEY NOT NULL,
    cursor             TEXT,
    complete           INTEGER NOT NULL DEFAULT 0,
    synced_at          TEXT,
    names              INTEGER NOT NULL DEFAULT 0,
    event_json         TEXT,
    gate_locked        INTEGER NOT NULL DEFAULT 0,
    legacy_qr_offline  TEXT NOT NULL DEFAULT 'allow',
    keys_json          TEXT,
    keys_at            TEXT
  );
  CREATE INDEX IF NOT EXISTS scans_ticket ON scans (event_id, ticket_id);
`;

export async function migrate(db: SchemaDb): Promise<void> {
  await db.execAsync(BASE);
  const version = (await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))?.user_version ?? 0;
  if (version < 2) {
    // Whether this scan let somebody in on the phone's own say-so (offline),
    // which is what turns a late duplicate into a flagged conflict on upload.
    const cols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(scans)');
    if (!cols.some((c) => c.name === 'offline_verdict')) {
      await db.execAsync('ALTER TABLE scans ADD COLUMN offline_verdict TEXT');
    }
    await db.execAsync(V2);
    await db.execAsync('PRAGMA user_version = 2');
  }
  if (version < 3) {
    // How many uploads came back 'error' (the server could not decide). The
    // scan is sent again, up to MAX_ATTEMPTS (gate/queuePolicy.ts), so a busy
    // server never loses an admission and one bad row never blocks the queue.
    const cols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(scans)');
    if (!cols.some((c) => c.name === 'attempts')) {
      await db.execAsync('ALTER TABLE scans ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0');
    }
    await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  }
}
