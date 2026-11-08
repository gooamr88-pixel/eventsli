/**
 * The phone's half of "no admission is ever lost, none is counted twice".
 *
 * The real scan log (src/gate/scanLog.ts) runs against an in-memory stand-in
 * for its SQLite table and a scripted API, so every path a door can take is
 * replayed: online, no signal, a dropped upload, a partial answer, a crash in
 * the middle of a send, a revoked door, the same queue uploaded twice.
 */
import { ApiError, NetworkError } from '../src/api/client';
import * as endpoints from '../src/api/endpoints';
import { bytesToBase64Url } from '../src/lib/base64';
import { DoorAuthError, pendingCount, useScanLog } from '../src/gate/scanLog';

// A jest.mock factory is hoisted above imports, so it can only `require`.
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-crypto', () => ({ randomUUID: () => require('node:crypto').randomUUID() }));
jest.mock('expo-application', () => ({ nativeApplicationVersion: '1.0.0', nativeBuildVersion: '1' }));
jest.mock('../src/api/endpoints', () => ({
  verify: jest.fn(),
  sync: jest.fn(),
  manualCheckIn: jest.fn(),
  undo: jest.fn(),
}));

// ── An in-memory scans table that answers the scan log's five statements ──────
type Row = Record<string, any>;
const table = new Map<string, Row>();
const COLS = ['client_scan_id', 'event_id', 'qr', 'ticket_id', 'occurred_at', 'method', 'state', 'result', 'message', 'answer_json', 'synced_at'];
const fakeDb = {
  async runAsync(sql: string, params: any[]) {
    if (/^\s*INSERT OR REPLACE INTO scans/.test(sql)) {
      const row: Row = {};
      COLS.forEach((c, i) => { row[c] = params[i] ?? null; });
      table.set(row.client_scan_id, row);
      return;
    }
    if (/DELETE FROM scans WHERE client_scan_id = \?/.test(sql)) {
      table.delete(params[0]);
      return;
    }
    throw new Error(`unexpected statement: ${sql}`);
  },
  async getAllAsync(sql: string, params: any[]) {
    const rows = [...table.values()].filter((r) => r.event_id === params[0]);
    if (/state <> 'done' AND qr NOT LIKE 'manual:%'/.test(sql)) {
      return rows.filter((r) => r.state !== 'done' && !String(r.qr).startsWith('manual:'));
    }
    if (/ORDER BY occurred_at DESC LIMIT \?/.test(sql)) {
      return rows.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)).slice(0, params[1]);
    }
    if (/^SELECT \* FROM scans WHERE event_id = \?$/.test(sql.trim())) return rows;
    throw new Error(`unexpected query: ${sql}`);
  },
};
jest.mock('../src/lib/db', () => ({ db: async () => fakeDb }));

const api = endpoints as jest.Mocked<typeof endpoints>;
const EVENT = '11111111-1111-4111-8111-111111111111';
const DOOR = 'door-token';

function ticketQr(tid: string, eid = EVENT) {
  const enc = (o: object) => bytesToBase64Url(new TextEncoder().encode(JSON.stringify(o)));
  return `${enc({ alg: 'HS256' })}.${enc({ typ: 'ticket', tid, eid })}.c2ln`;
}
const admitted = (extra = {}) => ({ ok: true, result: 'admitted', ...extra });
const state = () => useScanLog.getState();
const rowsIn = (s: string) => [...table.values()].filter((r) => r.state === s);

beforeEach(async () => {
  table.clear();
  jest.resetAllMocks();
  state().clear();
  await state().load(EVENT);
});

describe('online', () => {
  test('a scan the server admits is done, and written down', async () => {
    api.verify.mockResolvedValue(admitted({ ticket_id: 't1', attendee: 'John Smith' }));
    const rec = await state().submit(ticketQr('t1'), DOOR);
    expect(rec).toMatchObject({ state: 'done', result: 'admitted', ticketId: 't1' });
    expect(table.get(rec!.clientScanId)?.state).toBe('done');
  });

  test('a code that is certainly not ours is refused without the network', async () => {
    const rec = await state().submit('hello world', DOOR);
    expect(rec?.result).toBe('invalid');
    expect(api.verify).not.toHaveBeenCalled();
  });

  test('a busy server is not a decision: the scan is held, not refused', async () => {
    api.verify.mockRejectedValue(new ApiError(503, 'SERVER_ERROR', 'down'));
    const rec = await state().submit(ticketQr('t1'), DOOR);
    expect(rec?.state).toBe('queued');
    expect(rec?.result).toBeNull();
  });
});

describe('no signal, then signal', () => {
  test('held scans upload once — a second sync sends nothing', async () => {
    api.verify.mockRejectedValue(new NetworkError());
    const a = await state().submit(ticketQr('t1'), DOOR);
    const b = await state().submit(ticketQr('t2'), DOOR);
    expect(pendingCount(state().records)).toBe(2);

    api.sync.mockImplementation(async (_door, scans) => ({
      results: scans.map((s) => ({ ...admitted(), clientScanId: s.clientScanId })),
      summary: { total: scans.length, admitted: scans.length, replayed: 0, conflicts: 0 },
    }));
    const first = await state().sync(DOOR);
    expect(first).toEqual({ uploaded: 2, conflicts: 0 });
    // The SAME client ids went up: a lost answer and a re-send is a replay on the server.
    expect(api.sync.mock.calls[0][1].map((s) => s.clientScanId).sort()).toEqual([a!.clientScanId, b!.clientScanId].sort());
    expect(api.sync.mock.calls[0][1].every((s) => s.method === 'offline')).toBe(true);
    expect(pendingCount(state().records)).toBe(0);

    const second = await state().sync(DOOR);
    expect(second).toEqual({ uploaded: 0, conflicts: 0 });
    expect(api.sync).toHaveBeenCalledTimes(1);
  });

  test('an upload that fails changes nothing, and the next one succeeds', async () => {
    api.verify.mockRejectedValue(new NetworkError());
    await state().submit(ticketQr('t1'), DOOR);
    api.sync.mockRejectedValueOnce(new NetworkError());
    expect(await state().sync(DOOR)).toBeNull();
    expect(rowsIn('queued')).toHaveLength(1);
    expect(state().syncing).toBe(false);

    api.sync.mockImplementation(async (_d, scans) => ({
      results: scans.map((s) => ({ ...admitted(), clientScanId: s.clientScanId })),
      summary: { total: 1, admitted: 1, replayed: 0, conflicts: 0 },
    }));
    expect(await state().sync(DOOR)).toEqual({ uploaded: 1, conflicts: 0 });
    expect(rowsIn('queued')).toHaveLength(0);
  });

  test('a partial answer settles what it names; the rest go next time, alone', async () => {
    api.verify.mockRejectedValue(new NetworkError());
    const a = await state().submit(ticketQr('t1'), DOOR);
    const b = await state().submit(ticketQr('t2'), DOOR);
    api.sync.mockResolvedValueOnce({
      results: [{ ...admitted(), clientScanId: a!.clientScanId }],
      summary: { total: 1, admitted: 1, replayed: 0, conflicts: 0 },
    });
    await state().sync(DOOR);
    expect(table.get(a!.clientScanId)?.state).toBe('done');
    expect(table.get(b!.clientScanId)?.state).toBe('queued');

    api.sync.mockResolvedValueOnce({
      results: [{ ...admitted(), clientScanId: b!.clientScanId }],
      summary: { total: 1, admitted: 1, replayed: 0, conflicts: 0 },
    });
    await state().sync(DOOR);
    expect(api.sync.mock.calls[1][1].map((s) => s.clientScanId)).toEqual([b!.clientScanId]);
  });

  test('a scan caught mid-send by a crash is uploaded after the restart', async () => {
    table.set('crashed', {
      client_scan_id: 'crashed', event_id: EVENT, qr: ticketQr('t9'), ticket_id: 't9',
      occurred_at: new Date(Date.now() - 2 * 60e3).toISOString(), method: 'scan', state: 'sending',
      result: null, message: null, answer_json: null, synced_at: null,
    });
    state().clear();
    await state().load(EVENT);   // the app opening again
    api.sync.mockImplementation(async (_d, scans) => ({
      results: scans.map((s) => ({ ...admitted({ replay: true }), clientScanId: s.clientScanId })),
      summary: { total: 1, admitted: 0, replayed: 1, conflicts: 0 },
    }));
    await state().sync(DOOR);
    expect(api.sync.mock.calls[0][1].map((s) => s.clientScanId)).toEqual(['crashed']);
    expect(table.get('crashed')?.state).toBe('done');
  });

  test('a door revoked during upload stops the phone, and keeps every held scan', async () => {
    api.verify.mockRejectedValue(new NetworkError());
    await state().submit(ticketQr('t1'), DOOR);
    api.sync.mockRejectedValue(new ApiError(401, 'SESSION_REVOKED', 'switched off'));
    await expect(state().sync(DOOR)).rejects.toBeInstanceOf(DoorAuthError);
    expect(rowsIn('queued')).toHaveLength(1);
  });

  test('a door revoked mid-scan keeps the scan, which uploads after signing back in', async () => {
    api.verify.mockRejectedValue(new ApiError(401, 'SESSION_REVOKED', 'expired'));
    await expect(state().submit(ticketQr('t1'), DOOR)).rejects.toBeInstanceOf(DoorAuthError);
    expect(rowsIn('sending')).toHaveLength(1);
    // Signing back in takes longer than the 30 s that marks a send as stranded.
    rowsIn('sending')[0].occurred_at = new Date(Date.now() - 2 * 60e3).toISOString();

    api.sync.mockImplementation(async (_d, scans) => ({
      results: scans.map((s) => ({ ...admitted(), clientScanId: s.clientScanId })),
      summary: { total: 1, admitted: 1, replayed: 0, conflicts: 0 },
    }));
    await state().sync('new-door-token');
    expect(api.sync).toHaveBeenCalledWith('new-door-token', expect.any(Array));
    expect(rowsIn('done')).toHaveLength(1);
  });

  test('two syncs at once make one upload — the reconnect case, where three triggers fire together', async () => {
    api.verify.mockRejectedValue(new NetworkError());
    await state().submit(ticketQr('t1'), DOOR);
    api.sync.mockImplementation((_d, scans) => new Promise((r) => setTimeout(() => r({
      results: scans.map((s) => ({ ...admitted(), clientScanId: s.clientScanId })),
      summary: { total: 1, admitted: 1, replayed: 0, conflicts: 0 },
    }), 20)));
    const [r1, r2, r3] = await Promise.all([state().sync(DOOR), state().sync(DOOR), state().sync(DOOR)]);
    expect(api.sync).toHaveBeenCalledTimes(1);
    expect(r1).toEqual({ uploaded: 1, conflicts: 0 });
    expect(r2).toBeNull();
    expect(r3).toBeNull();
    expect(state().syncing).toBe(false);
  });

  test('a scan whose live check is still in flight is not sent again by a sync', async () => {
    let answer: (v: any) => void = () => {};
    api.verify.mockImplementation(() => new Promise((r) => { answer = r; }));
    const live = state().submit(ticketQr('t1'), DOOR);
    await new Promise((r) => setTimeout(r, 0));
    expect(rowsIn('sending')).toHaveLength(1);

    api.sync.mockResolvedValue({ results: [], summary: { total: 0, admitted: 0, replayed: 0, conflicts: 0 } });
    expect(await state().sync(DOOR)).toEqual({ uploaded: 0, conflicts: 0 });
    expect(api.sync).not.toHaveBeenCalled();

    answer(admitted({ ticket_id: 't1' }));
    expect((await live)?.result).toBe('admitted');
  });

  test('a conflict reported by the server is surfaced', async () => {
    api.verify.mockRejectedValue(new NetworkError());
    await state().submit(ticketQr('t1'), DOOR);
    api.sync.mockImplementation(async (_d, scans) => ({
      results: scans.map((s) => ({ ok: false, result: 'duplicate', conflict: true, clientScanId: s.clientScanId })),
      summary: { total: 1, admitted: 0, replayed: 0, conflicts: 1 },
    }));
    expect(await state().sync(DOOR)).toEqual({ uploaded: 1, conflicts: 1 });
  });
});

describe('by hand', () => {
  test('a manual check-in with no signal is an error to retry — never queued, never synced', async () => {
    api.manualCheckIn.mockRejectedValue(new NetworkError());
    const rec = await state().manual('t5', DOOR);
    const stored = table.get(rec.clientScanId);
    expect(stored?.state).toBe('done');
    expect(stored?.result).toBe('error');
    api.sync.mockResolvedValue({ results: [], summary: { total: 0, admitted: 0, replayed: 0, conflicts: 0 } });
    expect(await state().sync(DOOR)).toEqual({ uploaded: 0, conflicts: 0 });
    expect(api.sync).not.toHaveBeenCalled();
  });

  test('undo reverses an admission and says so', async () => {
    api.verify.mockResolvedValue(admitted({ ticket_id: 't1' }));
    const rec = await state().submit(ticketQr('t1'), DOOR);
    api.undo.mockResolvedValue({ ok: true, result: 'undone' });
    const undone = await state().undo(rec!, DOOR);
    expect(undone.result).toBe('undone');
    expect(api.undo).toHaveBeenCalledWith(DOOR, 't1');
  });
});
