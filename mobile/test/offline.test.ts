/**
 * Offline admission on the phone, end to end: the real ticket list
 * (src/gate/offlineList.ts) and the real scan log (src/gate/scanLog.ts) over
 * a real SQLite with the app's schema, real QR v2 codes signed by the
 * backend's code, and a scripted server that serves the list in pages of two.
 *
 * What must hold at a door with no signal:
 *   • an admission is made once, shown as one, and uploaded exactly once;
 *   • a refusal is final and never uploaded (the server must not later let in
 *     someone the door turned away);
 *   • what the phone cannot know (a ticket bought a minute ago, a key it does
 *     not have) is held, never guessed;
 *   • the list is guest data: it goes when the organizer, the door or time
 *     says so, and held scans stay.
 */
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { ApiError, NetworkError } from '../src/api/client';
import * as endpoints from '../src/api/endpoints';
import type { ManifestPage, ManifestRow } from '../src/api/types';
import { useOfflineList } from '../src/gate/offlineList';
import { DoorAuthError, pendingCount, useScanLog } from '../src/gate/scanLog';
import { migrate } from '../src/lib/dbSchema';
import { openTestDb, type TestDb } from './helpers/sqlite';

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-crypto', () => ({ randomUUID: () => require('node:crypto').randomUUID() }));
jest.mock('expo-application', () => ({ nativeApplicationVersion: '1.0.0', nativeBuildVersion: '1' }));
jest.mock('../src/api/endpoints', () => ({
  verify: jest.fn(), sync: jest.fn(), manualCheckIn: jest.fn(), undo: jest.fn(), manifest: jest.fn(), keys: jest.fn(),
}));
let mockDb: TestDb;
jest.mock('../src/lib/db', () => ({ db: async () => mockDb.db }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const qrSigning = require(join(__dirname, '..', '..', 'backend', 'services', 'qrSigning.js'));
const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const SIGNING = { QR_SIGNING_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string, QR_SIGNING_KID: 'k1' };

const api = endpoints as jest.Mocked<typeof endpoints>;
const EVENT = randomUUID();
const DOOR = 'door-token';
const T = { a: randomUUID(), b: randomUUID(), c: randomUUID(), d: randomUUID(), e: randomUUID() };

const code = (tid: string, opts: { v?: number; eid?: string; env?: object } = {}): string =>
  qrSigning.sign({ typ: 'ticket', tid, eid: opts.eid ?? EVENT, ...(opts.v ? { v: opts.v } : {}) }, opts.env ?? SIGNING);
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const legacyCode = (tid: string) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ typ: 'ticket', tid, eid: EVENT })}.c2ln`;

// ── A scripted server: the event's tickets, a change counter, pages of two ────
const PAGE = 2;
let server: {
  rows: Map<string, ManifestRow>; seq: number; changed: Map<string, number>;
  event: ManifestPage['event']; gateLocked: boolean; legacy: 'allow' | 'hold'; names: boolean;
};

function put(row: Partial<ManifestRow> & { ticketId: string }) {
  const prev = server.rows.get(row.ticketId);
  server.rows.set(row.ticketId, {
    v: 0, status: 'valid', scannedAt: null, tier: 'General Admission', seat: null, table: null, holder: null, ...prev, ...row,
  });
  server.seq += 1;
  server.changed.set(row.ticketId, server.seq);
}

function page(cursor: string | null): ManifestPage {
  const c = cursor ? JSON.parse(cursor) : { since: -1, offset: 0, w: null };
  const changed = [...server.rows.values()]
    .filter((r) => (server.changed.get(r.ticketId) ?? 0) > c.since)
    .sort((x, y) => (server.changed.get(x.ticketId)! - server.changed.get(y.ticketId)!));
  const rows = changed.slice(c.offset, c.offset + PAGE);
  const done = c.offset + PAGE >= changed.length;
  const w = c.w ?? server.seq;
  return {
    rows,
    cursor: JSON.stringify(done ? { since: w, offset: 0, w: null } : { since: c.since, offset: c.offset + PAGE, w }),
    done,
    reset: !cursor,
    names: server.names,
    event: server.event,
    gateLocked: server.gateLocked,
    legacyQrOffline: server.legacy,
    serverTime: new Date().toISOString(),
  };
}

const list = () => useOfflineList.getState();
const log = () => useScanLog.getState();
const rowsIn = (state: string) => mockDb.all('SELECT * FROM scans WHERE state = ?', state);
const admittedAnswer = (scans: { clientScanId: string; qr: string }[], extra = {}) => ({
  results: scans.map((s) => ({ ok: true, result: 'admitted', clientScanId: s.clientScanId, scanned_at: new Date().toISOString(), ...extra })),
  summary: { total: scans.length, admitted: scans.length, replayed: 0, conflicts: 0 },
});

beforeEach(async () => {
  jest.resetAllMocks();
  mockDb = openTestDb();
  await mockDb.ready();
  server = {
    rows: new Map(), seq: 0, changed: new Map(), gateLocked: false, legacy: 'allow', names: true,
    event: { status: 'published', startsAt: new Date(Date.now() - 3600e3).toISOString(), endsAt: new Date(Date.now() + 3 * 3600e3).toISOString() },
  };
  put({ ticketId: T.a, holder: 'Sara Ahmed', tier: 'VIP', seat: 'Floor A1' });
  put({ ticketId: T.b, holder: 'John Smith' });
  put({ ticketId: T.c, holder: 'Noah Wilson', status: 'void' });
  put({ ticketId: T.d, holder: 'Mia Johnson', v: 1 });
  put({ ticketId: T.e, holder: 'Emily Chen' });
  api.manifest.mockImplementation(async (_door, cursor) => page(cursor));
  api.keys.mockResolvedValue({ keys: qrSigning.jwks(SIGNING) });
  log().clear();
  await log().load(EVENT);
  await list().load(EVENT);
});

// ── The phone database ───────────────────────────────────────────────────────
describe('the phone database', () => {
  test('a Phase 2 database is brought up to date without losing a held scan', async () => {
    const old = openTestDb();
    old.raw.exec(`CREATE TABLE scans (client_scan_id TEXT PRIMARY KEY NOT NULL, event_id TEXT NOT NULL, qr TEXT NOT NULL,
      ticket_id TEXT, occurred_at TEXT NOT NULL, method TEXT NOT NULL DEFAULT 'scan', state TEXT NOT NULL, result TEXT,
      message TEXT, answer_json TEXT, synced_at TEXT)`);
    old.run("INSERT INTO scans (client_scan_id, event_id, qr, occurred_at, state) VALUES ('held-1', 'e', 'q', '2026-11-08T10:00:00Z', 'queued')");
    await migrate(old.db);
    await migrate(old.db); // twice is harmless
    expect(old.one('PRAGMA user_version')).toEqual({ user_version: 3 });
    expect(old.all('PRAGMA table_info(scans)').map((c) => c.name)).toEqual(expect.arrayContaining(['offline_verdict', 'attempts']));
    expect(old.one("SELECT state FROM scans WHERE client_scan_id = 'held-1'")).toEqual({ state: 'queued' });
    expect(old.all("SELECT name FROM sqlite_master WHERE type = 'table'").map((t) => t.name))
      .toEqual(expect.arrayContaining(['ticket_list', 'ticket_list_meta']));
  });
});

// ── The ticket list ─────────────────────────────────────────────────────────
describe('the ticket list', () => {
  test('the first pull fetches every page, with the keys, and the phone can then decide', async () => {
    expect(list().context()).toBeNull();
    expect(await list().pull(DOOR)).toBe(true);
    expect(api.manifest).toHaveBeenCalledTimes(3);
    expect(api.manifest.mock.calls[0][1]).toBeNull();
    expect(list()).toMatchObject({ complete: true, count: 5, names: true });
    expect(list().keys.map((k) => k.kid)).toEqual(['k1']);
    expect(list().context()).toMatchObject({ eventId: EVENT, eventStatus: 'published', legacyQrOffline: 'allow' });
    expect(await list().find(T.a)).toMatchObject({ holder: 'Sara Ahmed', tier: 'VIP', status: 'valid', v: 0 });
  });

  test('a pull cut off half way is not a list yet, and the next one resumes where it stopped', async () => {
    let calls = 0;
    api.manifest.mockImplementation(async (_door, cursor) => {
      calls += 1;
      if (calls === 2) throw new NetworkError();
      return page(cursor);
    });
    expect(await list().pull(DOOR)).toBe(false);
    expect(list().complete).toBe(false);
    expect(list().context()).toBeNull();
    expect(list().count).toBe(2);
    const resumeFrom = api.manifest.mock.results[0].value;

    expect(await list().pull(DOOR)).toBe(true);
    expect(api.manifest.mock.calls[2][1]).toBe((await resumeFrom).cursor);
    expect(list().count).toBe(5);
  });

  test('later pulls bring only what changed', async () => {
    await list().pull(DOOR);
    put({ ticketId: T.b, status: 'scanned', scannedAt: '2026-11-09T18:00:00.000Z' });
    api.manifest.mockClear();
    await list().pull(DOOR);
    expect(api.manifest).toHaveBeenCalledTimes(1);
    expect(api.manifest.mock.calls[0][1]).not.toBeNull();
    expect(await list().find(T.b)).toMatchObject({ status: 'scanned', scannedAt: '2026-11-09T18:00:00.000Z' });
  });

  test('the organizer switching offline check-in off deletes the list from the phone', async () => {
    await list().pull(DOOR);
    api.manifest.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'off', { reason: 'offline_admission_off' }));
    expect(await list().pull(DOOR)).toBe(false);
    expect(list()).toMatchObject({ off: true, complete: false });
    expect(list().context()).toBeNull();
    expect(mockDb.all('SELECT * FROM ticket_list')).toHaveLength(0);
  });

  test('a door the server closed (401) leaves; the list says nothing more', async () => {
    api.manifest.mockRejectedValue(new ApiError(401, 'SESSION_REVOKED', 'revoked'));
    await expect(list().pull(DOOR)).rejects.toBeInstanceOf(DoorAuthError);
  });

  test('24 hours after the event ends, the list is deleted, at the next pull or the next launch', async () => {
    server.event = { ...server.event!, endsAt: new Date(Date.now() - 25 * 3600e3).toISOString() };
    await list().pull(DOOR);
    expect(list().context()).toBeNull();
    expect(mockDb.all('SELECT * FROM ticket_list')).toHaveLength(0);

    // A list from before, read on launch.
    server.event = { ...server.event!, endsAt: new Date(Date.now() + 3600e3).toISOString() };
    await list().pull(DOOR);
    mockDb.run('UPDATE ticket_list_meta SET event_json = ?', JSON.stringify({ ...server.event, endsAt: new Date(Date.now() - 25 * 3600e3).toISOString() }));
    await list().load(EVENT);
    expect(mockDb.all('SELECT * FROM ticket_list')).toHaveLength(0);
  });

  test('leaving the door deletes the list, and keeps every held scan', async () => {
    await list().pull(DOOR);
    await log().submit(code(T.a), DOOR, { offline: true });
    await list().wipeAll();
    expect(mockDb.all('SELECT * FROM ticket_list')).toHaveLength(0);
    expect(mockDb.all('SELECT * FROM ticket_list_meta')).toHaveLength(0);
    expect(rowsIn('queued')).toHaveLength(1);
  });

  test('names are only on the phone when the organizer allows them', async () => {
    server.names = false;
    for (const id of Object.values(T)) put({ ticketId: id, holder: null });
    await list().pull(DOOR);
    expect(list().names).toBe(false);
    expect(mockDb.all('SELECT holder FROM ticket_list WHERE holder IS NOT NULL')).toHaveLength(0);
  });
});

// ── Scanning with no signal ─────────────────────────────────────────────────
describe('scanning with no signal', () => {
  beforeEach(async () => {
    await list().pull(DOOR);
  });

  test('a good ticket is admitted on the phone, at once, and waits to upload as an admission', async () => {
    const rec = await log().submit(code(T.a), DOOR, { offline: true });
    expect(api.verify).not.toHaveBeenCalled();
    expect(rec).toMatchObject({ state: 'queued', result: 'admitted', offlineVerdict: 'admitted', method: 'offline' });
    expect(rec?.answer).toMatchObject({ attendee: 'Sara Ahmed', tier: 'VIP', seat: 'Floor A1' });
    expect(pendingCount(log().records)).toBe(1);
  });

  test('the same ticket again is already checked in, and not a second upload', async () => {
    const first = await log().submit(code(T.a), DOOR, { offline: true });
    const again = await log().submit(code(T.a), DOOR, { offline: true });
    expect(again).toMatchObject({ state: 'done', result: 'duplicate' });
    expect(again?.answer?.scanned_at).toBe(first?.occurredAt);
    expect(pendingCount(log().records)).toBe(1);
  });

  test('when the server does not answer in 2.5 s, the phone decides', async () => {
    api.verify.mockRejectedValue(new NetworkError('The server took too long to answer.'));
    const rec = await log().submit(code(T.e), DOOR);
    expect(api.verify.mock.calls[0][4]).toBe(2500);
    expect(rec).toMatchObject({ state: 'queued', offlineVerdict: 'admitted' });
  });

  test('a busy server (503, or a 200 that says it could not decide) is no answer: the phone decides', async () => {
    api.verify.mockRejectedValueOnce(new ApiError(503, 'SCAN_UNAVAILABLE', 'busy'));
    expect(await log().submit(code(T.a), DOOR)).toMatchObject({ state: 'queued', offlineVerdict: 'admitted' });
    api.verify.mockResolvedValueOnce({ ok: false, result: 'error', message: 'fetch failed' });
    expect(await log().submit(code(T.e), DOOR)).toMatchObject({ state: 'queued', offlineVerdict: 'admitted' });
  });

  test('an upload the server could not decide is sent again, and lands once', async () => {
    const rec = await log().submit(code(T.a), DOOR, { offline: true });
    api.sync.mockImplementationOnce(async (_d, scans) => ({
      results: scans.map((s) => ({ ok: false, result: 'error', message: 'fetch failed', clientScanId: s.clientScanId })),
      summary: { total: 1, admitted: 0, replayed: 0, conflicts: 0 },
    }));
    await log().sync(DOOR);
    expect(mockDb.one('SELECT state, attempts, offline_verdict FROM scans WHERE client_scan_id = ?', rec!.clientScanId))
      .toEqual({ state: 'queued', attempts: 1, offline_verdict: 'admitted' });
    api.sync.mockImplementationOnce(async (_d, scans) => admittedAnswer(scans));
    await log().sync(DOOR);
    expect(api.sync.mock.calls[1][1].map((s) => [s.clientScanId, s.offlineVerdict])).toEqual([[rec!.clientScanId, 'admitted']]);
    expect(pendingCount(log().records)).toBe(0);
  });

  test('refusals are final and never uploaded', async () => {
    const forged = (() => {
      const [h, , s] = code(T.b).split('.');
      return `${h}.${b64({ typ: 'ticket', tid: T.b, eid: EVENT, v: 9 })}.${s}`;
    })();
    expect(await log().submit(code(T.c), DOOR, { offline: true })).toMatchObject({ state: 'done', result: 'void' });
    expect(await log().submit(code(T.d), DOOR, { offline: true })).toMatchObject({ state: 'done', result: 'transferred' });
    expect(await log().submit(forged, DOOR, { offline: true })).toMatchObject({ state: 'done', result: 'invalid' });
    expect(await log().submit(code(T.b, { eid: randomUUID() }), DOOR, { offline: true })).toMatchObject({ result: 'wrong_event' });

    expect(await log().sync(DOOR)).toEqual({ uploaded: 0, conflicts: 0 });
    expect(api.sync).not.toHaveBeenCalled();
  });

  test('the new holder\'s code after a transfer is let in', async () => {
    expect(await log().submit(code(T.d, { v: 1 }), DOOR, { offline: true })).toMatchObject({ offlineVerdict: 'admitted' });
  });

  test('a ticket the list does not know is held — and uploaded for the server to decide', async () => {
    const stranger = randomUUID();
    const rec = await log().submit(code(stranger), DOOR, { offline: true });
    expect(rec).toMatchObject({ state: 'queued', result: null, offlineVerdict: 'unconfirmed' });
    api.sync.mockImplementation(async (_d, scans) => admittedAnswer(scans));
    await log().sync(DOOR);
    expect(api.sync.mock.calls[0][1][0]).toEqual(expect.not.objectContaining({ offlineVerdict: expect.anything() }));
  });

  test('admissions upload exactly once, and the list learns the server\'s answer', async () => {
    const a = await log().submit(code(T.a), DOOR, { offline: true });
    const e = await log().submit(code(T.e), DOOR, { offline: true });
    api.sync.mockImplementation(async (_d, scans) => ({
      results: scans.map((s) => ({
        ok: true, result: 'admitted', clientScanId: s.clientScanId, scanned_at: '2026-11-09T19:00:00.000Z',
        ticket_id: s.clientScanId === a!.clientScanId ? T.a : T.e,
      })),
      summary: { total: scans.length, admitted: scans.length, replayed: 0, conflicts: 0 },
    }));

    expect(await log().sync(DOOR)).toEqual({ uploaded: 2, conflicts: 0 });
    const sent = api.sync.mock.calls[0][1];
    expect(sent.map((s) => s.clientScanId).sort()).toEqual([a!.clientScanId, e!.clientScanId].sort());
    expect(sent.every((s) => s.offlineVerdict === 'admitted' && s.method === 'offline')).toBe(true);
    expect(await log().sync(DOOR)).toEqual({ uploaded: 0, conflicts: 0 });
    expect(api.sync).toHaveBeenCalledTimes(1);

    // Uploaded: the phone's own record of it is gone, the list remembers it.
    expect(await list().find(T.a)).toMatchObject({ status: 'scanned', scannedAt: '2026-11-09T19:00:00.000Z' });
    expect(await log().submit(code(T.a), DOOR, { offline: true })).toMatchObject({ result: 'duplicate' });
  });

  test('another door got there first: the upload comes back as a flagged conflict', async () => {
    await log().submit(code(T.b), DOOR, { offline: true });
    api.sync.mockImplementation(async (_d, scans) => ({
      results: scans.map((s) => ({ ok: false, result: 'duplicate', conflict: true, clientScanId: s.clientScanId, ticket_id: T.b })),
      summary: { total: 1, admitted: 0, replayed: 0, conflicts: 1 },
    }));
    expect(await log().sync(DOOR)).toEqual({ uploaded: 1, conflicts: 1 });
    expect(log().records[0]).toMatchObject({ state: 'done', result: 'duplicate', answer: expect.objectContaining({ conflict: true }) });
  });

  test('older codes: let in on the list, or held, as the organizer set it', async () => {
    expect(await log().submit(legacyCode(T.b), DOOR, { offline: true })).toMatchObject({ offlineVerdict: 'admitted' });
    server.legacy = 'hold';
    put({ ticketId: T.e });
    await list().pull(DOOR);
    expect(await log().submit(legacyCode(T.e), DOOR, { offline: true })).toMatchObject({ state: 'queued', offlineVerdict: 'held' });
  });

  test('a code from a key the phone does not have is held, and the keys are fetched again', async () => {
    const { privateKey: next } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const env2 = { QR_SIGNING_KEY: next.export({ type: 'pkcs8', format: 'pem' }), QR_SIGNING_KID: 'k2' };
    expect(await log().submit(code(T.b, { env: env2 }), DOOR, { offline: true })).toMatchObject({ offlineVerdict: 'held' });
    api.keys.mockResolvedValue({ keys: [...qrSigning.jwks(SIGNING), ...qrSigning.jwks(env2)] });
    const before = api.keys.mock.calls.length;
    await list().pull(DOOR);
    expect(api.keys.mock.calls.length).toBe(before + 1);
    expect(await log().submit(code(T.e, { env: env2 }), DOOR, { offline: true })).toMatchObject({ offlineVerdict: 'admitted' });
  });

  test('undo before the upload cancels it on the phone; it never reaches the server', async () => {
    const rec = await log().submit(code(T.a), DOOR, { offline: true });
    const undone = await log().undo(rec!, DOOR);
    expect(undone).toMatchObject({ state: 'done', result: 'undone' });
    expect(api.undo).not.toHaveBeenCalled();
    expect(await log().sync(DOOR)).toEqual({ uploaded: 0, conflicts: 0 });
    // The ticket is free again on this phone.
    expect(await log().submit(code(T.a), DOOR, { offline: true })).toMatchObject({ offlineVerdict: 'admitted' });
  });

  test('undo while that scan may be uploading is refused, not raced', async () => {
    const rec = await log().submit(code(T.a), DOOR, { offline: true });
    let release: (v: any) => void = () => {};
    api.sync.mockImplementation((_d, scans) => new Promise((r) => { release = () => r(admittedAnswer(scans)); }));
    const uploading = log().sync(DOOR);
    await new Promise((r) => setTimeout(r, 0));
    await expect(log().undo(rec!, DOOR)).rejects.toThrow(/uploading/);
    release(undefined);
    await uploading;
  });

  test('a closed gate or a cancelled event, as last heard, refuses offline', async () => {
    server.gateLocked = true;
    put({ ticketId: T.b });
    await list().pull(DOOR);
    expect(await log().submit(code(T.b), DOOR, { offline: true })).toMatchObject({ result: 'scanner_locked' });
    server.gateLocked = false;
    server.event = { ...server.event!, status: 'cancelled' };
    put({ ticketId: T.b });
    await list().pull(DOOR);
    expect(await log().submit(code(T.b), DOOR, { offline: true })).toMatchObject({ result: 'event_cancelled' });
  });
});

describe('without a list', () => {
  test('a phone that never got the list holds scans with no signal, as before', async () => {
    api.verify.mockRejectedValue(new NetworkError());
    const rec = await log().submit(code(T.a), DOOR, { offline: true });
    expect(rec).toMatchObject({ state: 'queued', result: null, offlineVerdict: null });
    expect(api.verify.mock.calls[0][4]).toBe(4000);
  });
});
