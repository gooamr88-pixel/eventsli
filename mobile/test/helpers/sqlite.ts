/**
 * The phone's database for tests: Node's own SQLite (node:sqlite), behind the
 * handful of expo-sqlite calls the app makes, with the app's real schema and
 * migration (src/lib/dbSchema.ts). Every SQL statement the app runs is run for
 * real, in memory, rather than matched against a fake.
 *
 * What it does not cover is SQLCipher: the encryption key is the phone's
 * (src/lib/db.ts) and is checked on the device.
 */
import { DatabaseSync } from 'node:sqlite';

import { migrate } from '../../src/lib/dbSchema';

type Param = string | number | null;

const bind = (params: unknown[] = []): Param[] =>
  params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : (p as Param)));

const plain = <T>(row: unknown): T => ({ ...(row as object) }) as T;

export type TestDb = ReturnType<typeof openTestDb>;

export function openTestDb() {
  const raw = new DatabaseSync(':memory:');
  const db = {
    async execAsync(sql: string) {
      raw.exec(sql);
    },
    async runAsync(sql: string, params: unknown[] = []) {
      const r = raw.prepare(sql).run(...bind(params));
      return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
    },
    async getAllAsync<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      return raw.prepare(sql).all(...bind(params)).map((r) => plain<T>(r));
    },
    async getFirstAsync<T>(sql: string, params: unknown[] = []): Promise<T | null> {
      const row = raw.prepare(sql).get(...bind(params));
      return row ? plain<T>(row) : null;
    },
    async withTransactionAsync(task: () => Promise<void>) {
      raw.exec('BEGIN');
      try {
        await task();
        raw.exec('COMMIT');
      } catch (err) {
        raw.exec('ROLLBACK');
        throw err;
      }
    },
  };
  return {
    db,
    raw,
    ready: () => migrate(db),
    /** Synchronous reads for assertions. */
    all: <T = Record<string, any>>(sql: string, ...params: Param[]) => raw.prepare(sql).all(...params).map((r) => plain<T>(r)),
    one: <T = Record<string, any>>(sql: string, ...params: Param[]) => {
      const row = raw.prepare(sql).get(...params);
      return row ? plain<T>(row) : undefined;
    },
    run: (sql: string, ...params: Param[]) => raw.prepare(sql).run(...params),
  };
}
