/**
 * Checks and settings for the phone's encrypted database (src/lib/db.ts),
 * kept apart so they can be tested on a real SQLite.
 *
 * `PRAGMA key` on a plain SQLite is silently ignored. If a build ever shipped
 * without SQLCipher (the `useSQLCipher` plugin option dropped, a library
 * change), the guest list and scan log would be written in clear text and
 * nothing would say so. A store build therefore refuses to open an
 * unencrypted database: scanning then fails loudly on the first test build
 * instead of quietly storing guest data in the open.
 */

type Conn = {
  execAsync: (sql: string) => Promise<unknown>;
  getFirstAsync: <T>(sql: string) => Promise<T | null>;
};

export class UnencryptedDatabaseError extends Error {
  constructor() {
    super('This build cannot encrypt its database, so it will not store guest data.');
    this.name = 'UnencryptedDatabaseError';
  }
}

/** The SQLCipher version, or null on a plain SQLite. */
export async function cipherVersion(conn: Conn): Promise<string | null> {
  try {
    const row = await conn.getFirstAsync<{ cipher_version?: string }>('PRAGMA cipher_version;');
    return row?.cipher_version || null;
  } catch {
    return null;
  }
}

/**
 * Run right after `PRAGMA key`. Throws in a store build when the database is
 * not SQLCipher; a development build (or a test on Node's SQLite) carries on.
 */
export async function assertEncrypted(conn: Conn, dev: boolean): Promise<void> {
  if (!(await cipherVersion(conn)) && !dev) throw new UnencryptedDatabaseError();
}

/**
 * Deleted rows are overwritten, not just unlinked (a guest list removed at the
 * end of an event does not linger in free pages), and SQLite's temporary
 * files for sorting stay in memory rather than on disk. The write-ahead log is
 * encrypted by SQLCipher like the database itself.
 */
export async function hardenConnection(conn: Conn): Promise<void> {
  await conn.execAsync('PRAGMA secure_delete = ON;');
  await conn.execAsync('PRAGMA temp_store = MEMORY;');
}
