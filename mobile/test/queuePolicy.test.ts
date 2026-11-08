import { applyResults, counts, isRepeatRead, nextBatch, prunable, type ScanRecord } from '../src/gate/queuePolicy';

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
