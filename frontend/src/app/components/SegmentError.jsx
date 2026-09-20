'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { describeBoundaryError } from '../utils/errors';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * What an `error.jsx` renders — written once, used by all of them.
 *
 * WHY SEGMENT BOUNDARIES AT ALL. Without one, anything an organizer page throws
 * unwinds to `app/error.jsx`, which replaces the WHOLE document — including the
 * console's sidebar. Somebody whose orders table failed loses the navigation
 * they would use to go anywhere else, on a screen whose only offer is "Back to
 * events". A boundary inside `app/organizer/` renders in the layout's slot, so
 * the shell, the sidebar and the account footer all survive and the failure is
 * the size of the thing that actually failed.
 *
 * WHAT IT WILL NOT SAY. `describeBoundaryError`, not `describeError`: a
 * boundary catches whatever a component throws, and those messages were written
 * for developers. Only a mapped API code gets to put its own sentence on the
 * screen. Everything else gets fixed wording plus the digest — which is the
 * useful half anyway, because it ties this screen to a line in the server log
 * without putting the log on the screen.
 *
 * `reset` re-renders the failed segment in place. It is offered only when
 * retrying could plausibly work: for a `fatal` tone the same render fails the
 * same way, and a button that visibly does nothing is worse than no button.
 * That rule is `app/error.jsx`'s, kept.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function SegmentError({
  error,
  reset,
  /** What broke, in the reader's words — "This page", "The admin console". */
  area = 'This page',
  /** Where to go if retrying does not help. Stays inside the segment. */
  home,
}) {
  useEffect(() => {
    // The full object, to the console, where a developer is. Not to the DOM.
    console.error(error);
  }, [error]);

  const { title, recovery, tone } = describeBoundaryError(error);

  return (
    // `role="alert"` so the failure is announced rather than silently swapped
    // in — the surrounding shell does not move, so there is no other signal
    // that anything changed.
    <section role="alert" className="fx-section fx-section--sm">
      <div className="fx-container fx-container--sm fx-stack">
        <p className="es-eyebrow text-danger">
          {tone === 'fatal' ? 'Stopped here' : 'Something broke'}
        </p>
        <h1 className="text-2xl">{title}</h1>
        <p className="text-muted">
          {area} could not be shown. {recovery}
        </p>

        <div className="fx-row">
          {tone !== 'fatal' && (
            <button type="button" onClick={reset} className="es-btn es-btn--primary">
              Try again
            </button>
          )}
          {home && (
            <Link href={home.href} className="es-btn es-btn--secondary">
              {home.label}
            </Link>
          )}
        </div>

        {/* The reference, not the reason. Without it a support conversation is
            "it said something went wrong". */}
        {error?.digest && (
          <p className="font-mono text-xs text-subtle">Reference: {error.digest}</p>
        )}
      </div>
    </section>
  );
}
