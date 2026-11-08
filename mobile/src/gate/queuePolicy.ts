import type { ScanAnswer } from '../api/types';

/**
 * The scan log's rules, as pure functions — ported from the web gate
 * (frontend/src/app/gate/queuePolicy.js) so both doors queue the same way.
 *
 * A record is one scan on this phone. `state`:
 *   queued  — taken with no answer yet (no signal); waiting to upload
 *   sending — on its way
 *   done    — the server answered; `result` is its word
 */

export type ScanState = 'queued' | 'sending' | 'done';

export type ScanRecord = {
  clientScanId: string;
  eventId: string;
  qr: string;
  ticketId: string | null;
  occurredAt: string;
  method: 'scan' | 'manual' | 'offline';
  state: ScanState;
  result: string | null;
  message: string | null;
  answer: ScanAnswer | null;
  syncedAt: string | null;
};

export const BATCH_SIZE = 100;

export const isPending = (r: Pick<ScanRecord, 'state'>) => r.state === 'queued' || r.state === 'sending';

/** Oldest first: the door's own order is the fairest one to replay. */
export function nextBatch(records: ScanRecord[], limit = BATCH_SIZE): ScanRecord[] {
  return records
    .filter((r) => r.state === 'queued')
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
    .slice(0, limit);
}

export function toWire(r: ScanRecord) {
  return { qr: r.qr, clientScanId: r.clientScanId, occurredAt: r.occurredAt, method: r.method };
}

/** Fold a sync answer into the log. Unanswered `sending` rows go back to `queued`. */
export function applyResults(
  records: ScanRecord[],
  results: (ScanAnswer & { clientScanId?: string })[],
  now = new Date().toISOString(),
) {
  const byId = new Map(results.filter((r) => r.clientScanId).map((r) => [r.clientScanId as string, r]));
  const changed: ScanRecord[] = [];
  for (const r of records) {
    if (!isPending(r)) continue;
    const answer = byId.get(r.clientScanId);
    if (!answer) {
      if (r.state === 'sending') changed.push({ ...r, state: 'queued' });
      continue;
    }
    changed.push({
      ...r,
      state: 'done',
      result: answer.result,
      message: answer.message || null,
      answer,
      syncedAt: now,
    });
  }
  return changed;
}

export function counts(records: ScanRecord[]) {
  let queued = 0;
  let admitted = 0;
  let refused = 0;
  for (const r of records) {
    if (isPending(r)) queued += 1;
    else if (r.result === 'admitted') admitted += 1;
    else refused += 1;
  }
  return { queued, admitted, refused, total: records.length };
}

/** Settled rows older than 48 h, or beyond the newest 2,000. Never a pending one. */
export function prunable(records: ScanRecord[], { now = Date.now(), keepMs = 48 * 3600e3, keepMax = 2000 } = {}) {
  const settled = records
    .filter((r) => !isPending(r))
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const old = settled.filter((r) => now - Date.parse(r.occurredAt) > keepMs);
  const excess = settled.slice(keepMax);
  return [...new Set([...old, ...excess].map((r) => r.clientScanId))];
}

/**
 * The same code scanned twice in a row by a held phone is one person, not two.
 * Within the cooldown the second read is ignored rather than recorded.
 */
export function isRepeatRead(last: { token: string; at: number } | null, token: string, now: number, cooldownMs = 3000) {
  return Boolean(last && last.token === token && now - last.at < cooldownMs);
}
