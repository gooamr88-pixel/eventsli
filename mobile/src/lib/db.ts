import { getRandomBytes } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';

import { bytesToHex } from './base64';

/**
 * The phone's own database: this door's scan log (and, from Phase 3, the
 * event's ticket list for offline decisions).
 *
 * ENCRYPTED AT REST with SQLCipher (`useSQLCipher` in app.json). The key is 32
 * random bytes made on first launch and kept in the Keychain / Keystore — never
 * in the database, never in a backup. A phone that is lost is a phone whose
 * scan log cannot be read off its storage.
 *
 * If the key is gone but the file is not (a restored backup, a keychain reset),
 * the file is unreadable by design: it is deleted and started again. What is
 * lost is the local log; anything already uploaded is on the server.
 */

const NAME = 'door.db';
const KEY = 'eventsli.db.key';
const SECURE = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

const SCHEMA = `
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS scans (
    client_scan_id TEXT PRIMARY KEY NOT NULL,
    event_id       TEXT NOT NULL,
    qr             TEXT NOT NULL,
    ticket_id      TEXT,
    occurred_at    TEXT NOT NULL,
    method         TEXT NOT NULL DEFAULT 'scan',
    state          TEXT NOT NULL,
    result         TEXT,
    message        TEXT,
    answer_json    TEXT,
    synced_at      TEXT
  );
  CREATE INDEX IF NOT EXISTS scans_event_time ON scans (event_id, occurred_at DESC);
  CREATE INDEX IF NOT EXISTS scans_pending ON scans (state) WHERE state <> 'done';
`;

async function key(): Promise<string> {
  const existing = await SecureStore.getItemAsync(KEY, SECURE);
  if (existing) return existing;
  const fresh = bytesToHex(getRandomBytes(32));
  await SecureStore.setItemAsync(KEY, fresh, SECURE);
  return fresh;
}

async function openKeyed(hexKey: string) {
  const db = await SQLite.openDatabaseAsync(NAME);
  // The raw-key form: 64 hex characters, no key derivation. Must be the first
  // statement on the connection.
  await db.execAsync(`PRAGMA key = "x'${hexKey}'";`);
  // Touching the schema proves the key is right; a wrong key fails here.
  await db.getFirstAsync('SELECT count(*) AS n FROM sqlite_master;');
  await db.execAsync(SCHEMA);
  return db;
}

async function open(): Promise<SQLite.SQLiteDatabase> {
  const k = await key();
  try {
    return await openKeyed(k);
  } catch {
    await SQLite.deleteDatabaseAsync(NAME).catch(() => undefined);
    return openKeyed(k);
  }
}

let handle: Promise<SQLite.SQLiteDatabase> | null = null;

export function db(): Promise<SQLite.SQLiteDatabase> {
  if (!handle) {
    handle = open().catch((err) => {
      handle = null;
      throw err;
    });
  }
  return handle;
}
