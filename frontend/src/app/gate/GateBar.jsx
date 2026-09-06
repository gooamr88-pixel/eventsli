'use client';

import { doorTime } from './scanOutcome';

/**
 * The strip along the top: who this device is, whether it can reach the server,
 * and how many scans are waiting to be uploaded.
 *
 * The queue count is the number that matters and it is never hidden when it is
 * zero — an operator has to be able to glance and see "nothing waiting", which
 * an absent counter does not say. Something waiting is amber whether or not the
 * device is online, because a scan that has not reached the server is not a
 * scan anybody else can see yet.
 */
export default function GateBar({
  session, status, queued, syncing, online, lastSync, onSync, onSignOut,
}) {
  const stats = status?.stats;
  const locked = status?.gate?.locked;

  return (
    <header className="fx-stack fx-stack--sm fx-safe-top border-b border-border-base bg-surface p-3">
      <div className="fx-row fx-row--between">
        <div className="fx-min0">
          <p className="fx-truncate text-ink">{session?.label || 'This device'}</p>
          <p className="text-xs text-subtle">Eventsli Gate</p>
        </div>

        <div className="fx-row">
          <span
            className={`fx-row whitespace-nowrap rounded-full px-2.5 py-1 text-xs ${
              online ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'
            }`}
          >
            <span
              aria-hidden
              className={`h-2 w-2 rounded-full ${online ? 'bg-success' : 'bg-warning'}`}
            />
            {online ? 'Online' : 'Offline'}
          </span>

          <button
            type="button"
            onClick={onSignOut}
            className="whitespace-nowrap text-sm text-muted hover:text-ink"
          >
            Sign out
          </button>
        </div>
      </div>

      <div className="fx-row fx-row--between">
        <div className="fx-row fx-row--scroll" aria-label="Tonight's numbers">
          {stats && (
            <>
              <Stat label="In" value={stats.admitted} tone="text-success" />
              <Stat label="To come" value={stats.pending} tone="text-ink" />
              <Stat label="Issued" value={stats.issued} tone="text-muted" />
            </>
          )}
          <Stat
            label="Waiting to upload"
            value={queued}
            tone={queued ? 'text-warning' : 'text-muted'}
          />
        </div>

        {queued > 0 && (
          <button
            type="button"
            onClick={onSync}
            disabled={syncing || !online}
            className="whitespace-nowrap rounded-full bg-warning/15 px-3 py-1.5 text-sm text-warning disabled:opacity-40"
          >
            {syncing ? 'Uploading…' : online ? 'Upload now' : 'No signal'}
          </button>
        )}
      </div>

      {/* BRD §18. A locked gate is the one refusal the door staff cannot
          resolve, so it is said here rather than only appearing scan by scan. */}
      {locked && (
        <p role="alert" className="rounded-[--es-radius-md] bg-danger/15 px-3 py-2 text-sm text-danger">
          Scanning is switched off for this event
          {status.gate.reason === 'commission_overdue'
            ? ' — the organizer has an overdue commission invoice.'
            : '.'}
          {' '}Nobody can be admitted until it is settled. Call the organizer.
        </p>
      )}

      {lastSync && lastSync.ok === false && (
        <p className="text-xs text-warning">
          The last upload did not finish. Scans are still held on this device and will be
          retried.
        </p>
      )}

      {lastSync?.ok && lastSync.total > 0 && (
        <p className="text-xs text-subtle">
          Uploaded {lastSync.total} at {doorTime(lastSync.at)}
          {lastSync.replayed > 0 && ` · ${lastSync.replayed} already known`}
        </p>
      )}
    </header>
  );
}

function Stat({ label, value, tone }) {
  return (
    <span className="whitespace-nowrap text-xs text-subtle">
      <span className={`font-mono text-lg ${tone}`}>{value ?? '—'}</span>{' '}
      {label}
    </span>
  );
}
