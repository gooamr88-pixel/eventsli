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
        <p className="es-eyebrow text-accent">404</p>
        <h1 className="es-display">This page is not here.</h1>
        <p className="text-lg text-muted">
          The link may be wrong, or whatever was here is no longer listed.
        </p>
        {/* A search box, because the likeliest reason to be here is a mistyped
            or outdated event link. A GET form needs no JavaScript. */}
        <form action="/events" method="get" role="search" className="fx-row">
          <label htmlFor="nf-search" className="sr-only">Search events</label>
          <input id="nf-search" name="q" type="search" placeholder="Search events" className="es-input fx-min0 flex-1" />
          <button type="submit" className="es-btn es-btn--secondary">Search</button>
        </form>
        <div className="fx-row">
          <Link
            href="/events"
            className="es-btn es-btn--primary"
          >
            Browse events
          </Link>
          <Link href="/tickets/find" className="es-btn es-btn--secondary">
            Find my ticket
          </Link>
        </div>
      </div>
    </main>
  );
}
