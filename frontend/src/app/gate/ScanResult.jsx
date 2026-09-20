'use client';

import { useState } from 'react';
import { describeError } from '../utils/errors';
import { describeScan, doorTime } from './scanOutcome';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The answer, sized to be read at arm's length in the dark by somebody who is
 * also looking at a queue.
 *
 * Colour is never the only signal — the title says the same thing in words, and
 * `role="status"` announces it. A door is exactly where colour-blindness, glare
 * and a cracked screen all show up at once.
 *
 * The classes are written out whole. Tailwind scans source as TEXT, so a class
 * assembled from a variable (`bg-${tone}-500`) is a rule that was never
 * generated and a colour that silently does not exist.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const TONE = {
  admit: {
    card: 'border-success/40 bg-success/15',
    dot: 'bg-success',
    title: 'text-success',
  },
  refuse: {
    card: 'border-danger/40 bg-danger/15',
    dot: 'bg-danger',
    title: 'text-danger',
  },
  warn: {
    card: 'border-warning/40 bg-warning/15',
    dot: 'bg-warning',
    title: 'text-warning',
  },
  hold: {
    card: 'border-border-strong bg-surface',
    dot: 'bg-subtle',
    title: 'text-ink',
  },
};

export default function ScanResult({ entry, onUndo, onDismiss }) {
  const [undoing, setUndoing] = useState(false);
  const [undoError, setUndoError] = useState(null);

  if (!entry) {
    return (
      <div className="fx-stack fx-stack--sm rounded-(--es-radius-lg) border border-dashed border-border-strong p-6 text-center">
        <p className="text-muted">Point the camera at a ticket.</p>
        <p className="text-sm text-subtle">
          The answer appears here. It stays until the next scan.
        </p>
      </div>
    );
  }

  const { record, prior, error } = entry;
  // A record still in the queue has no `result` yet, and saying so is the whole
  // point — `queued` is the absence of a decision, not a quiet approval.
  const result = record.state === 'queued' ? 'queued'
    : record.state === 'sending' ? 'sending'
      : record.result;

  const { tone, title, note, known } = describeScan(result);
  const skin = TONE[tone] || TONE.warn;
  const at = doorTime(record.scannedAt || record.occurredAt);

  async function undo() {
    setUndoing(true);
    setUndoError(null);
    try {
      await onUndo(record);
    } catch (err) {
      setUndoError(err);
    } finally {
      setUndoing(false);
    }
  }

  return (
    <div
      role="status"
      aria-live="assertive"
      className={`fx-stack rounded-(--es-radius-lg) border p-5 ${skin.card}`}
    >
      <div className="fx-row fx-row--between">
        <div className="fx-row fx-min0">
          <span aria-hidden className={`mt-2 h-3 w-3 shrink-0 rounded-full ${skin.dot}`} />
          <div className="fx-min0">
            <p className={`text-2xl ${skin.title}`}>{title}</p>
            {/* The time of the FIRST scan, which is what ends the argument. */}
            {result === 'duplicate' && at && (
              <p className="font-mono text-lg text-ink">at {at}</p>
            )}
          </div>
        </div>
        {/* A REAL BUTTON, because of where this is used. The door is a dark
            room, a moving queue and often a gloved thumb, and "Clear" was a
            ~20px line of text — the smallest target in the product sitting on
            the screen with the least margin for a missed tap. `.es-btn--ghost`
            keeps it visually quiet and gives it the 44px floor. */}
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Clear this result"
          className="es-btn es-btn--ghost es-btn--sm shrink-0"
        >
          Clear
        </button>
      </div>

      {record.attendee && (
        <p className="fx-break text-xl text-ink">{record.attendee}</p>
      )}

      {(record.seat || record.table) && (
        <p className="font-mono text-md text-muted">
          {[record.seat, record.table].filter(Boolean).join(' · ')}
        </p>
      )}

      <p className="max-w-[52ch] text-sm text-muted">{record.message || note}</p>

      {!known && (
        <p className="text-sm text-warning">
          Result code: <span className="font-mono">{String(result)}</span>
        </p>
      )}

      {/* The device's own memory, shown even when the server has not answered.
          It never decides anything — it tells the operator where to look. */}
      {prior && (
        <p className="rounded-(--es-radius-md) bg-bg-sunken px-3 py-2 text-sm text-muted">
          This device scanned the same ticket at{' '}
          <span className="font-mono text-ink">{doorTime(prior.occurredAt)}</span>.
          {prior.state !== 'done' && ' That scan has not been uploaded yet.'}
        </p>
      )}

      {error && (
        <p className="text-sm text-muted">{describeError(error).recovery}</p>
      )}

      {record.result === 'admitted' && record.ticketId && (
        <div className="fx-stack fx-stack--sm">
          <button
            type="button"
            onClick={undo}
            disabled={undoing}
            className="self-start rounded-(--es-radius-md) border border-border-strong px-4 py-2.5 text-sm text-ink disabled:opacity-40"
          >
            {undoing ? 'Reversing…' : 'Let them back out — undo'}
          </button>
          <p className="text-xs text-subtle">
            Reverses this admission and makes the ticket scannable again. Recorded as its own
            entry rather than deleting the original, so the log still explains what happened.
          </p>
          {undoError && (
            <p className="text-sm text-danger">{describeError(undoError).recovery}</p>
          )}
        </div>
      )}
    </div>
  );
}
