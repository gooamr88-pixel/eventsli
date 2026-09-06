import Link from 'next/link';

/**
 * Deliberately says nothing about WHY.
 *
 * Every unpublished state on the platform — draft, pending review, rejected,
 * suspended, cancelled — returns a byte-identical 404 to a slug that never
 * existed. That is enforced in the API's discovery controller, and this page is
 * the visible half of it: an answer that distinguished "not yet published" from
 * "no such event" would let anyone enumerate slugs and watch an event move
 * through review, or find out that a named organizer was rejected.
 *
 * So the copy offers a way onward and does not speculate.
 */
export default function NotFound() {
  return (
    <main className="fx-section">
      <div className="fx-container fx-container--sm fx-stack">
        <p className="font-mono text-xs uppercase tracking-[0.1em] text-subtle">404</p>
        <h1 className="text-2xl">This page is not here</h1>
        <p className="text-muted">
          The link may be wrong, or whatever was here is no longer listed.
        </p>
        <div className="fx-row">
          <Link
            href="/events"
            className="es-btn es-btn--primary"
          >
            Browse events
          </Link>
          <Link
            href="/tickets/find"
            className="rounded-[--es-radius-md] border border-border-strong px-4 py-2 text-sm text-ink transition-colors hover:bg-bg-sunken"
          >
            Find my ticket
          </Link>
        </div>
      </div>
    </main>
  );
}
