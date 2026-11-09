import { applyResults, counts, isRepeatRead, MAX_ATTEMPTS, nextBatch, prunable, type ScanRecord } from '../src/gate/queuePolicy';

const rec = (over: Partial<ScanRecord>): ScanRecord => ({
  clientScanId: Math.random().toString(36).slice(2),
  eventId: 'e',
  qr: 'a.b.c',
  ticketId: null,
  occurredAt: new Date().toISOString(),
  method: 'scan',
  state: 'queued',
  result: null,
  message: null,
  answer: null,
  syncedAt: null,
  offlineVerdict: null,
  attempts: 0,
  ...over,
});

describe('the scan log', () => {
  test('uploads oldest first, only what is still waiting', () => {
    const a = rec({ occurredAt: '2026-11-08T10:00:00Z' });
    const b = rec({ occurredAt: '2026-11-08T09:00:00Z' });
    const done = rec({ state: 'done', result: 'admitted' });
    expect(nextBatch([a, done, b]).map((r) => r.clientScanId)).toEqual([b.clientScanId, a.clientScanId]);
  });

  test('a sync answer settles the scans it names, and an unanswered send is queued again', () => {
    const answered = rec({ state: 'sending' });
    const lost = rec({ state: 'sending' });
    const changed = applyResults([answered, lost], [{ clientScanId: answered.clientScanId, ok: true, result: 'admitted' }], 'now');
    expect(changed.find((r) => r.clientScanId === answered.clientScanId)).toMatchObject({ state: 'done', result: 'admitted', syncedAt: 'now' });
    expect(changed.find((r) => r.clientScanId === lost.clientScanId)?.state).toBe('queued');
  });

  test('counts say how many are waiting', () => {
    expect(counts([rec({}), rec({ state: 'done', result: 'admitted' }), rec({ state: 'done', result: 'void' })]))
      .toEqual({ queued: 1, admitted: 1, refused: 1, total: 3 });
  });

  test('housekeeping never drops a scan that has not uploaded', () => {
    const old = new Date(Date.now() - 72 * 3600e3).toISOString();
    const waiting = rec({ occurredAt: old });
    const settled = rec({ occurredAt: old, state: 'done', result: 'admitted' });
    expect(prunable([waiting, settled])).toEqual([settled.clientScanId]);
  });

  test('the same code held in front of the camera is one read, not a stream', () => {
    expect(isRepeatRead(null, 'x', 1000)).toBe(false);
    expect(isRepeatRead({ token: 'x', at: 1000 }, 'x', 2500)).toBe(true);
    expect(isRepeatRead({ token: 'x', at: 1000 }, 'x', 4500)).toBe(false);
    expect(isRepeatRead({ token: 'x', at: 1000 }, 'y', 1100)).toBe(false);
  });
});

describe('an upload the server could not decide', () => {
  test('stays queued and goes again — an offline admission is not lost to a busy minute', () => {
    const r = rec({ state: 'sending', result: 'admitted', offlineVerdict: 'admitted' });
    const [next] = applyResults([r], [{ clientScanId: r.clientScanId, ok: false, result: 'error', message: 'fetch failed' }], 'now');
    expect(next).toMatchObject({ state: 'queued', attempts: 1, result: 'admitted', offlineVerdict: 'admitted' });
    expect(nextBatch([next]).map((x) => x.clientScanId)).toEqual([r.clientScanId]);
  });

  test('settles as an error after MAX_ATTEMPTS, so it cannot hold the queue', () => {
    const r = rec({ state: 'sending', attempts: MAX_ATTEMPTS - 1 });
    const [next] = applyResults([r], [{ clientScanId: r.clientScanId, ok: false, result: 'error' }], 'now');
    expect(next).toMatchObject({ state: 'done', result: 'error' });
  });

  test('a decided answer after a retry settles as usual', () => {
    const r = rec({ state: 'sending', attempts: 2 });
    const [next] = applyResults([r], [{ clientScanId: r.clientScanId, ok: true, result: 'admitted' }], 'now');
    expect(next).toMatchObject({ state: 'done', result: 'admitted' });
  });
});
