'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { describeError } from './utils/errors';

/**
 * The last line of defence. Anything a page throws and does not handle lands
 * here.
 *
 * It goes through describeError like every other failure, so a thrown ApiError
 * carrying SEAT_UNAVAILABLE reads as "someone got there first" rather than as a
 * stack trace — the boundary catching it does not make it a different kind of
 * problem, only a less expected one.
 */
export default function GlobalError({ error, reset }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const { title, recovery, tone } = describeError(error);

  return (
    <main className="fx-section">
      <div className="fx-container fx-container--sm fx-stack">
        <p className="font-mono text-xs uppercase tracking-[0.1em] text-danger">
          {tone === 'fatal' ? 'Stopped here' : 'Something broke'}
        </p>
        <h1 className="text-2xl">{title}</h1>
        <p className="text-muted">{recovery}</p>

        <div className="fx-row">
          {/* `reset` re-renders the failed segment in place. Offered only when
              retrying could plausibly work — for a fatal code the same render
              fails the same way, and a button that visibly does nothing is
              worse than no button. */}
          {tone !== 'fatal' && (
            <button
              type="button"
              onClick={reset}
              className="rounded-[--es-radius-md] bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover"
            >
              Try again
            </button>
          )}
          <Link
            href="/"
            className="rounded-[--es-radius-md] border border-border-strong px-4 py-2 text-sm text-ink transition-colors hover:bg-bg-sunken"
          >
            Back to events
          </Link>
        </div>

        {/* The digest is what ties this screen to a line in the server log.
            Without it a support conversation is "it said something went wrong". */}
        {error?.digest && (
          <p className="font-mono text-xs text-subtle">Reference: {error.digest}</p>
        )}
      </div>
    </main>
  );
}
