/**
 * Who took a scan (PRIVACY-AUDIT-FINAL.md, P-F6). A phone that held scans
 * offline uploads them with whatever door session is open when the signal
 * comes back. Amira scans with no signal, signs out; Ben signs in on the same
 * phone and the queue goes up under Ben's session. Each scan must still say
 * it was Amira's device — the server keeps it under her
 * (backend scanService.syncBatch, test/integration/scanAttributionRetention).
 */
import * as endpoints from '../src/api/endpoints';
import { bytesToBase64Url } from '../src/lib/base64';
import { migrate } from '../src/lib/dbSchema';
import { applyResults, toWire, type ScanRecord } from '../src/gate/queuePolicy';
import { useScanLog } from '../src/gate/scanLog';
import { openTestDb, type TestDb } from './helpers/sqlite';
import { DatabaseSync } from 'node:sqlite';

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-crypto', () => ({ randomUUID: () => require('node:crypto').randomUUID() }));
jest.mock('expo-application', () => ({ nativeApplicationVersion: '1.0.0', nativeBuildVersion: '1' }));
jest.mock('../src/api/endpoints', () => ({
  verify: jest.fn(), sync: jest.fn(), manualCheckIn: jest.fn(), undo: jest.fn(), manifest: jest.fn(), keys: jest.fn(),
}));
let mockDb: TestDb;
jest.mock('../src/lib/db', () => ({ db: async () => mockDb.db }));

const api = endpoints as jest.Mocked<typeof endpoints>;
const EVENT = '11111111-1111-4111-8111-111111111111';
const AMIRA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BEN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function ticketQr(tid: string) {
  const enc = (o: object) => bytesToBase64Url(new TextEncoder().encode(JSON.stringify(o)));
  return `${enc({ alg: 'HS256' })}.${enc({ typ: 'ticket', tid, eid: EVENT })}.c2ln`;
}
const state = () => useScanLog.getState();
const rows = () => mockDb.all('SELECT client_scan_id, state, device_id FROM scans');

beforeEach(async () => {
  mockDb = openTestDb();
  await mockDb.ready();
  jest.resetAllMocks();
  state().clear();
});

async function amiraScansOffline(n: number) {
  await state().load(EVENT, AMIRA);
  for (let i = 0; i < n; i += 1) {
    await state().submit(ticketQr(`t${i}`), 'amira-door', { offline: true });
  }
}

test('a scan is stamped with the device that took it, and kept on disk', async () => {
  await amiraScansOffline(2);
  expect(rows()).toEqual([
    expect.objectContaining({ state: 'queued', device_id: AMIRA }),
    expect.objectContaining({ state: 'queued', device_id: AMIRA }),
  ]);
});

test("Amira signs out, Ben signs in: the upload goes with Ben's token but names Amira's device", async () => {
  await amiraScansOffline(2);
  // Sign-out clears memory, never the held scans (session.ts).
  state().clear();
  expect(rows()).toHaveLength(2);

  await state().load(EVENT, BEN);
  api.sync.mockImplementation(async (_token, scans) => ({
    results: scans.map((s) => ({ ok: true, result: 'admitted', clientScanId: s.clientScanId })),
    summary: { total: scans.length, admitted: scans.length, replayed: 0, conflicts: 0 },
  }) as never);
  await state().sync('ben-door');

  expect(api.sync).toHaveBeenCalledTimes(1);
  const [token, sent] = api.sync.mock.calls[0];
  expect(token).toBe('ben-door');
  expect(sent).toHaveLength(2);
  for (const s of sent) expect(s).toMatchObject({ scannedByDeviceId: AMIRA, method: 'offline' });
  expect(rows().every((r) => r.state === 'done' && r.device_id === AMIRA)).toBe(true);
});

test("Ben's own scans after the switch carry Ben's device", async () => {
  await amiraScansOffline(1);
  state().clear();
  await state().load(EVENT, BEN);
  await state().submit(ticketQr('ben-1'), 'ben-door', { offline: true });
  const byDevice = rows().map((r) => r.device_id).sort();
  expect(byDevice).toEqual([AMIRA, BEN]);
});

test('a retry after an "error" answer keeps the device, and so does the next upload', async () => {
  const rec = {
    clientScanId: 'c1', eventId: EVENT, qr: 'q', ticketId: 't', occurredAt: '2026-11-14T10:00:00Z', method: 'offline',
    state: 'sending', result: null, message: null, answer: null, syncedAt: null, offlineVerdict: 'admitted', attempts: 0,
    deviceId: AMIRA,
  } satisfies ScanRecord;
  const [retry] = applyResults([rec], [{ ok: false, result: 'error', clientScanId: 'c1' } as never]);
  expect(retry).toMatchObject({ state: 'queued', attempts: 1, deviceId: AMIRA });
  expect(toWire(retry)).toMatchObject({ scannedByDeviceId: AMIRA });
});

test('a row from before the device was recorded sends none (the server keeps it with the uploader)', () => {
  const old = {
    clientScanId: 'c0', eventId: EVENT, qr: 'q', ticketId: null, occurredAt: '2026-11-14T10:00:00Z', method: 'offline',
    state: 'queued', result: null, message: null, answer: null, syncedAt: null, offlineVerdict: null, attempts: 0,
  } satisfies ScanRecord;
  expect(toWire(old)).not.toHaveProperty('scannedByDeviceId');
  expect(toWire({ ...old, deviceId: null })).not.toHaveProperty('scannedByDeviceId');
});

test('a phone on schema v4 gains the column and keeps its held scans', async () => {
  const raw = new DatabaseSync(':memory:');
  const conn = {
    execAsync: async (sql: string) => { raw.exec(sql); },
    getFirstAsync: async <T,>(sql: string) => (raw.prepare(sql).get() as T | undefined) ?? null,
    getAllAsync: async <T,>(sql: string) => raw.prepare(sql).all() as T[],
  };
  await migrate(conn as never);
  raw.exec('ALTER TABLE scans DROP COLUMN device_id; PRAGMA user_version = 4;');
  raw.exec("INSERT INTO scans (client_scan_id, event_id, qr, occurred_at, state) VALUES ('held', 'e', 'q', '2026-11-14', 'queued')");
  await migrate(conn as never);
  expect(raw.prepare('PRAGMA user_version').get()).toEqual({ user_version: 5 });
  expect(raw.prepare('SELECT client_scan_id, device_id FROM scans').all()).toEqual([{ client_scan_id: 'held', device_id: null }]);
});
