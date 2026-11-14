/**
 * Privacy audit, 2026-11-14 (mobile/store/PRIVACY-AUDIT.md). Each test holds
 * one finding fixed:
 *   P-04 Sentry: the guest search and ids reach no report, spans included.
 *   P-05 The database: a store build will not store guest data unencrypted;
 *        deleted rows are overwritten; temp files stay in memory.
 *   P-07 Retention: 48 h / 2,000 rows across EVERY event on the phone, and a
 *        settled scan keeps no QR code.
 */
import { DatabaseSync } from 'node:sqlite';

import { assertEncrypted, cipherVersion, hardenConnection, UnencryptedDatabaseError } from '../src/lib/dbSecurity';
import { scrubBreadcrumb, scrubEvent, scrubText } from '../src/lib/monitoring';
import { prune, storedQr, useScanLog } from '../src/gate/scanLog';
import { openTestDb, type TestDb } from './helpers/sqlite';

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-crypto', () => ({ randomUUID: () => require('node:crypto').randomUUID() }));
jest.mock('expo-application', () => ({ nativeApplicationVersion: '1.0.0', nativeBuildVersion: '1' }));
jest.mock('../src/api/endpoints', () => ({
  verify: jest.fn(), sync: jest.fn(), manualCheckIn: jest.fn(), undo: jest.fn(), manifest: jest.fn(), keys: jest.fn(),
}));
let mockDb: TestDb;
jest.mock('../src/lib/db', () => ({ db: async () => mockDb.db }));

const ID = '3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b';

describe('P-04 — what Sentry may receive', () => {
  test('a URL inside any text loses its query string and fragment', () => {
    expect(scrubText('GET https://eventsli.com/api/v1/scan/attendees?q=Sara%20Ali&limit=20 failed'))
      .toBe('GET https://eventsli.com/api/v1/scan/attendees failed');
    expect(scrubText('see https://x.test/a#holder=Sara')).toBe('see https://x.test/a');
  });

  test('ticket, event and device ids become [id]', () => {
    expect(scrubText(`ticket ${ID} not found`)).toBe('ticket [id] not found');
    expect(scrubText(`https://eventsli.com/api/v1/scan/tickets/${ID.toUpperCase()}`)).toBe('https://eventsli.com/api/v1/scan/tickets/[id]');
  });

  test("Sentry's fetch span: description, url and http.query are all clean", () => {
    const tx = scrubEvent({
      transaction: `GET https://eventsli.com/api/v1/scan/attendees?q=Sara`,
      spans: [{
        description: 'GET https://eventsli.com/api/v1/scan/attendees?q=Sara%20Ali',
        data: {
          url: 'https://eventsli.com/api/v1/scan/attendees?q=Sara%20Ali',
          'http.query': '?q=Sara%20Ali',
          'http.fragment': '#x',
          'http.response.status_code': 200,
        },
      }],
    });
    const text = JSON.stringify(tx);
    expect(text).not.toMatch(/Sara/);
    expect(tx.spans?.[0].data).toEqual({ url: 'https://eventsli.com/api/v1/scan/attendees', 'http.response.status_code': 200 });
    expect(tx.transaction).toBe('GET https://eventsli.com/api/v1/scan/attendees');
  });

  test('a fetch breadcrumb keeps method and status, never the query or a body', () => {
    const crumb = scrubBreadcrumb({
      category: 'fetch',
      data: { method: 'POST', url: 'https://eventsli.com/api/v1/scan/verify?x=1', status_code: 200, 'http.query': 'x=1', body: '{"qr":"eyJ.a.b"}' },
    });
    expect(crumb?.data).toEqual({ method: 'POST', url: 'https://eventsli.com/api/v1/scan/verify', status_code: 200 });
  });

  test('guest fields in extra data are dropped by name', () => {
    const e = scrubEvent({ extra: { holder: 'Sara Ali', seat: 'A12', search: 'Sara', result: 'admitted' } });
    expect(e.extra).toEqual({ result: 'admitted' });
  });
});

describe('P-05 — the encrypted database', () => {
  // Node's SQLite is a plain SQLite: exactly the build mistake to catch.
  const plain = () => {
    const raw = new DatabaseSync(':memory:');
    return {
      raw,
      conn: {
        execAsync: async (sql: string) => { raw.exec(sql); },
        getFirstAsync: async <T,>(sql: string) => (raw.prepare(sql).get() as T | undefined) ?? null,
      },
    };
  };

  test('a plain SQLite reports no cipher', async () => {
    expect(await cipherVersion(plain().conn)).toBeNull();
  });

  test('a store build refuses to use it; a development build carries on', async () => {
    await expect(assertEncrypted(plain().conn, false)).rejects.toBeInstanceOf(UnencryptedDatabaseError);
    await expect(assertEncrypted(plain().conn, true)).resolves.toBeUndefined();
  });

  test('a SQLCipher connection passes', async () => {
    const cipher = { execAsync: async () => undefined, getFirstAsync: async <T,>() => ({ cipher_version: '4.6.1 community' }) as T };
    await expect(assertEncrypted(cipher, false)).resolves.toBeUndefined();
  });

  test('deleted rows are overwritten and temp files stay in memory', async () => {
    const { raw, conn } = plain();
    await hardenConnection(conn);
    expect(raw.prepare('PRAGMA secure_delete').get()).toEqual({ secure_delete: 1 });
    expect(raw.prepare('PRAGMA temp_store').get()).toEqual({ temp_store: 2 });
  });
});

describe('P-07 — the scan log keeps 48 h, 2,000 rows, and no codes', () => {
  const H = 3600e3;
  const NOW = Date.parse('2026-11-14T12:00:00Z');
  const at = (hoursAgo: number) => new Date(NOW - hoursAgo * H).toISOString();

  beforeEach(async () => {
    mockDb = openTestDb();
    await mockDb.ready();
    useScanLog.getState().clear();
  });

  async function insert(id: string, eventId: string, state: string, hoursAgo: number, qr = 'eyJhbGciOiJIUzI1NiJ9.e30.sig') {
    await mockDb.db.runAsync(
      `INSERT INTO scans (client_scan_id, event_id, qr, ticket_id, occurred_at, method, state, result, message, answer_json, synced_at, offline_verdict, attempts)
       VALUES (?, ?, ?, NULL, ?, 'camera', ?, ?, NULL, ?, NULL, NULL, 0)`,
      [id, eventId, qr, at(hoursAgo), state, state === 'done' ? 'admitted' : null, '{"attendee":"Sara Ali"}'],
    );
  }

  test("another event's old log is deleted too, not only the event being opened", async () => {
    await insert('old-other', 'event-B', 'done', 72);
    await insert('fresh-other', 'event-B', 'done', 2);
    await insert('old-here', 'event-A', 'done', 72);
    await prune(NOW);
    const left = mockDb.all('SELECT client_scan_id FROM scans ORDER BY client_scan_id').map((r) => r.client_scan_id);
    expect(left).toEqual(['fresh-other']);
  });

  test('a pending scan is never deleted, however old: it is an admission to upload', async () => {
    await insert('held', 'event-B', 'queued', 500);
    await prune(NOW);
    expect(mockDb.all('SELECT client_scan_id FROM scans').map((r) => r.client_scan_id)).toEqual(['held']);
  });

  test('settled rows keep no QR code; pending ones keep theirs to upload', async () => {
    await insert('settled', 'event-A', 'done', 1);
    await insert('waiting', 'event-A', 'queued', 1);
    await insert('manual', 'event-A', 'done', 1, 'manual:t9');
    await prune(NOW);
    const qr = Object.fromEntries(mockDb.all('SELECT client_scan_id, qr FROM scans').map((r) => [r.client_scan_id, r.qr]));
    expect(qr).toEqual({ settled: '', waiting: 'eyJhbGciOiJIUzI1NiJ9.e30.sig', manual: 'manual:t9' });
  });

  test('what is saved for a settled scan has no code', () => {
    expect(storedQr({ state: 'done', qr: 'eyJ.a.b' })).toBe('');
    expect(storedQr({ state: 'queued', qr: 'eyJ.a.b' })).toBe('eyJ.a.b');
    expect(storedQr({ state: 'done', qr: 'manual:t1' })).toBe('manual:t1');
  });

  test('more than 2,000 settled rows keeps the newest 2,000, across events', async () => {
    for (let i = 0; i < 2003; i += 1) {
      await insert(`r${String(i).padStart(4, '0')}`, i % 2 ? 'event-A' : 'event-B', 'done', 1 + i / 1000);
    }
    await prune(NOW);
    expect(mockDb.one('SELECT count(*) AS n FROM scans')?.n).toBe(2000);
    // The three oldest (largest hoursAgo) went.
    expect(mockDb.one("SELECT count(*) AS n FROM scans WHERE client_scan_id IN ('r2000','r2001','r2002')")?.n).toBe(0);
  });
});
