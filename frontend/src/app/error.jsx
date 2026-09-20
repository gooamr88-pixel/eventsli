'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { describeBoundaryError } from './utils/errors';

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

  // `describeBoundaryError`, not `describeError`. The latter falls back to
  // `err.message`, which for an API failure is a sentence the server wrote for
  // a person — but this boundary also catches whatever a component throws
  // during render, and Next only redacts those when they were thrown on the
  // SERVER. A client-side render throw arrived here with its original message
  // and this page put it on screen.
  const { title, recovery, tone } = describeBoundaryError(error);

  return (
    <main className="fx-section">
      <div className="fx-container fx-container--sm fx-stack">
        <p className="es-eyebrow text-danger">
          {tone === 'fatal' ? 'Stopped here' : 'Something broke'}
        </p>
        <h1 className="text-3xl">{title}</h1>
        <p className="text-lg text-muted">{recovery}</p>

        <div className="fx-row">
          {/* `reset` re-renders the failed segment in place. Offered only when
              retrying could plausibly work — for a fatal code the same render
              fails the same way, and a button that visibly does nothing is
              worse than no button. */}
          {tone !== 'fatal' && (
            <button
              type="button"
              onClick={reset}
              className="es-btn es-btn--primary"
            >
              Try again
            </button>
          )}
          <Link href="/events" className="es-btn es-btn--secondary">
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
