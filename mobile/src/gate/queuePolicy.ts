import type { ScanAnswer } from '../api/types';

/**
 * The scan log's rules, as pure functions — ported from the web gate
 * (frontend/src/app/gate/queuePolicy.js) so both doors queue the same way.
 *
 * A record is one scan on this phone. `state`:
 *   queued  — waiting to upload: taken with no answer, or admitted by the
 *             phone itself with no signal (`offlineVerdict: 'admitted'`)
 *   sending — on its way
 *   done    — decided: by the server, or by the phone when it refused
 *             someone offline (a refusal is never uploaded)
 */

export type ScanState = 'queued' | 'sending' | 'done';

/**
 * What the phone itself decided, with no signal (gate/offlineDecision.ts):
 *   admitted     it let the person in — uploaded as such, so the server flags
 *                a clash with another door as a conflict
 *   unconfirmed  the ticket was not on its list — held, like any held scan
 *   held         it could not check the code (older code, unknown key)
 *   null         it did not decide: the server did, or will
 */
export type OfflineVerdict = 'admitted' | 'unconfirmed' | 'held' | null;

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
  offlineVerdict: OfflineVerdict;
  /** Uploads answered 'error' so far: the server could not decide (see MAX_ATTEMPTS). */
  attempts: number;
  /**
   * The door device that took the scan. Sent with an upload, so a scan held
   * offline stays under the person who made it even if a colleague signed in
   * on this phone before it went. Absent on rows from before schema v5.
   */
  deviceId?: string | null;
};

export const BATCH_SIZE = 100;

/**
 * An upload answered 'error' means the server could not decide (its database
 * did not answer), not that it refused. The scan stays queued and goes again —
 * an admission made offline must not be lost to a busy minute — but only this
 * many times, so one row that can never be decided cannot hold the queue.
 */
export const MAX_ATTEMPTS = 5;

export const isPending = (r: Pick<ScanRecord, 'state'>) => r.state === 'queued' || r.state === 'sending';

/** Oldest first: the door's own order is the fairest one to replay. */
export function nextBatch(records: ScanRecord[], limit = BATCH_SIZE): ScanRecord[] {
  return records
    .filter((r) => r.state === 'queued')
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
    .slice(0, limit);
}

/** Only an admission the phone made itself is reported as one. */
export function toWire(r: ScanRecord) {
  return {
    qr: r.qr,
    clientScanId: r.clientScanId,
    occurredAt: r.occurredAt,
    method: r.method,
    ...(r.offlineVerdict === 'admitted' ? { offlineVerdict: 'admitted' as const } : {}),
    ...(r.deviceId ? { scannedByDeviceId: r.deviceId } : {}),
  };
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
    if (answer.result === 'error' && r.attempts + 1 < MAX_ATTEMPTS) {
      changed.push({ ...r, state: 'queued', attempts: r.attempts + 1, message: answer.message || null });
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
