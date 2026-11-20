import { getRandomBytes } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';

import { bytesToHex } from './base64';
import { migrate } from './dbSchema';
import { assertEncrypted, hardenConnection, isWrongKey, WrongKeyError } from './dbSecurity';

/**
 * The phone's own database: this door's scan log and the event's ticket list
 * for offline decisions. The tables are in dbSchema.ts.
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

async function key(): Promise<string> {
  const existing = await SecureStore.getItemAsync(KEY, SECURE);
  if (existing) return existing;
  const fresh = bytesToHex(getRandomBytes(32));
  await SecureStore.setItemAsync(KEY, fresh, SECURE);
  return fresh;
}

async function openKeyed(hexKey: string) {
  const db = await SQLite.openDatabaseAsync(NAME);
  try {
    // The raw-key form: 64 hex characters, no key derivation. Must be the first
    // statement on the connection.
    await db.execAsync(`PRAGMA key = "x'${hexKey}'";`);
    // A store build that is not really encrypted stops here (dbSecurity.ts).
    await assertEncrypted(db, __DEV__);
    // Touching the schema proves the key is right; a wrong key fails here, and
    // only that failure is reported as a wrong key.
    try {
      await db.getFirstAsync('SELECT count(*) AS n FROM sqlite_master;');
    } catch (err) {
      throw isWrongKey(err) ? new WrongKeyError() : err;
    }
    await db.execAsync('PRAGMA journal_mode = WAL;');
    await hardenConnection(db);
    await migrate(db);
    return db;
  } catch (err) {
    await db.closeAsync().catch(() => undefined);
    throw err;
  }
}

/**
 * Only a file this phone can no longer read (its key is gone) is deleted and
 * started again. Anything else — a failed migration, a full disk, a busy file
 * — is thrown and the next call tries again: the file may hold admissions
 * made offline that have not been uploaded, and deleting it on any error used
 * to lose them (audit 2026-11-20).
 */
async function open(): Promise<SQLite.SQLiteDatabase> {
  const k = await key();
  try {
    return await openKeyed(k);
  } catch (err) {
    if (!(err instanceof WrongKeyError)) throw err;
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
