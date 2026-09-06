import { describe, test, expect } from 'vitest';
import {
  BATCH_SIZE, applyResults, counts, isPending, newScan, nextBatch, priorScan, prunable, toWire,
} from '../src/app/gate/queuePolicy';

/**
 * The offline queue's rules, on plain arrays.
 *
 * These are the tests that matter for the door: every one of them is a way an
 * admission gets lost, and every one has happened to somebody's scanner.
 */

const at = (mins) => new Date(Date.UTC(2026, 8, 5, 19, mins)).toISOString();

function queued(n, extra = {}) {
  return { ...newScan({ qr: `qr-${n}`, ticketId: `ticket-${n}`, occurredAt: at(n) }), ...extra };
}

describe('queue policy', () => {
  test('uploads oldest first', () => {
    const records = [queued(9), queued(1), queued(5)];
    expect(nextBatch(records).map((r) => r.occurredAt))
      .toEqual([at(1), at(5), at(9)]);
  });

  test('a batch is bounded, and the rest stay queued', () => {
    const records = Array.from({ length: BATCH_SIZE + 30 }, (_, i) => queued(i));
    expect(nextBatch(records)).toHaveLength(BATCH_SIZE);
  });

  test('a record that was mid-upload is retried, not stranded', () => {
    // The tablet was killed while a sync was in flight. `sending` is not a
    // terminal state and must come back round — replays are safe, a lost
    // admission is not.
    const records = [queued(1, { state: 'sending' }), queued(2)];
    expect(nextBatch(records)).toHaveLength(2);
  });

  test('a settled record is never uploaded again', () => {
    const records = [queued(1, { state: 'done', result: 'admitted' })];
    expect(nextBatch(records)).toEqual([]);
    expect(isPending(records[0])).toBe(false);
  });

  test('only the three fields the API wants travel', () => {
    const wire = toWire(queued(3));
    expect(Object.keys(wire).sort()).toEqual(['clientScanId', 'occurredAt', 'qr']);
    // The event is in the device token. A field here would be a way for one
    // venue's tablet to scan another venue's tickets.
    expect(wire).not.toHaveProperty('eventId');
  });

  test('every scan gets its own id', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newScan({ qr: 'x' }).clientScanId));
    expect(ids.size).toBe(200);
  });

  describe('the definition of done for this phase', () => {
    /**
     * Scan a ticket twice offline, sync, and the second answer is the duplicate
     * — carrying the FIRST scan's device time, not the time of the upload.
     *
     * This is the queue's half of it. The server's half — that the second call
     * really does come back `duplicate` with the first `occurred_at`, and that
     * re-uploading the whole batch returns the original answers rather than two
     * fresh refusals — is verified against the live API by the phase probe.
     */
    const first = queued(4);
    const second = { ...newScan({ qr: first.qr, ticketId: first.ticketId, occurredAt: at(6) }) };

    test('both are queued, with different ids and their own clocks', () => {
      expect(first.clientScanId).not.toBe(second.clientScanId);
      expect(nextBatch([second, first])[0].clientScanId).toBe(first.clientScanId);
    });

    test('the second comes back as a duplicate, timed by the first scan', () => {
      const { records, resolved, stranded } = applyResults([first, second], [
        { clientScanId: first.clientScanId, ok: true, result: 'admitted', scanned_at: at(4), attendee: 'A. Buyer' },
        { clientScanId: second.clientScanId, ok: false, result: 'duplicate', scanned_at: at(4), message: 'Already scanned at 19:04' },
      ]);

      expect(resolved).toHaveLength(2);
      expect(stranded).toEqual([]);
      expect(records.every((r) => r.state === 'done')).toBe(true);

      const [a, b] = records;
      expect(a.result).toBe('admitted');
      expect(b.result).toBe('duplicate');
      // The number the operator reads out loud: when the ticket was FIRST used,
      // on the door's clock — not 19:06 when it was presented again, and not
      // whenever the queue happened to reach the server.
      expect(b.scannedAt).toBe(at(4));
      expect(b.scannedAt).toBe(a.scannedAt);
    });

    test('the device knew before the network did', () => {
      // Offline, the useful sentence is "you scanned that two minutes ago". It
      // is a hint and never a verdict — the second scan is still queued and
      // still uploaded, which is what makes the assertion above possible.
      const hint = priorScan([first], second.ticketId, second.clientScanId);
      expect(hint.clientScanId).toBe(first.clientScanId);
      expect(nextBatch([first, second])).toHaveLength(2);
    });
  });

  test('an upload that answers nothing puts everything back', () => {
    const sent = [queued(1, { state: 'sending' }), queued(2, { state: 'sending' })];
    const { records, resolved, stranded } = applyResults(sent, []);

    expect(resolved).toEqual([]);
    expect(stranded).toHaveLength(2);
    expect(records.every((r) => r.state === 'queued')).toBe(true);
  });

  test('a partial answer resolves only what was answered', () => {
    const sent = [queued(1, { state: 'sending' }), queued(2, { state: 'sending' })];
    const { records, resolved, stranded } = applyResults(sent, [
      { clientScanId: sent[0].clientScanId, result: 'admitted' },
    ]);

    expect(resolved).toEqual([sent[0].clientScanId]);
    expect(stranded).toEqual([sent[1].clientScanId]);
    expect(records[1].state).toBe('queued');
  });

  test('a replay is flagged, so the summary does not claim new admissions', () => {
    const sent = [queued(1, { state: 'sending' })];
    const { records } = applyResults(sent, [
      { clientScanId: sent[0].clientScanId, result: 'admitted', replay: true, scanned_at: at(1) },
    ]);
    expect(records[0].replay).toBe(true);
    expect(records[0].result).toBe('admitted');
  });

  test('a pending scan is never pruned, at any age', () => {
    const ancient = new Date(Date.UTC(2020, 0, 1)).toISOString();
    const records = [
      { ...queued(1, { occurredAt: ancient }) },
      { ...queued(2, { occurredAt: ancient, state: 'done', result: 'admitted' }) },
    ];
    const dropped = prunable(records, { now: Date.parse(at(1)) });

    expect(dropped).toEqual([records[1].clientScanId]);
    expect(dropped).not.toContain(records[0].clientScanId);
  });

  test('prunes down to the keep count, newest kept', () => {
    const records = Array.from({ length: 12 }, (_, i) => queued(i, { state: 'done', result: 'admitted' }));
    const dropped = prunable(records, { now: Date.parse(at(12)), keepMax: 5, keepMs: 1e12 });
    expect(dropped).toHaveLength(7);
    // The five newest survive.
    expect(dropped).not.toContain(records[11].clientScanId);
  });

  test('the counters separate what is waiting from what was decided', () => {
    const records = [
      queued(1),
      queued(2, { state: 'sending' }),
      queued(3, { state: 'done', result: 'admitted' }),
      queued(4, { state: 'done', result: 'duplicate' }),
    ];
    expect(counts(records)).toEqual({ queued: 2, admitted: 1, refused: 1, total: 4 });
  });
});
