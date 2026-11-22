import Link from 'next/link';
import { serverFetch } from '../../utils/apiClient';
import { formatEventTime } from '../../lib/eventTime';
import NavIcon from '../../components/shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * A HOST'S OWN GUEST LIST (2026-11-23) — the groom's, the bride's, a
 * department head's. Opened from the private link in their "a guest of yours
 * booked" emails; no account needed. The link is signed and the organizer can
 * replace it, which stops every copy of the old one.
 *
 * Names and ticket counts only: the host invited these people, but their
 * contact details and what they paid stay between them and the organizer.
 * Never cached, never indexed.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Your guest list',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

export default async function HostGuestListPage({ params }) {
  const { token } = await params;
  let data = null;
  try {
    data = await serverFetch(`/public/host-guests/${encodeURIComponent(token)}`, { cache: 'no-store' });
  } catch {
    data = null;
  }
  const { host, event, guests = [], totals } = data || {};

  return (
    <main className="fx-section fx-section--sm">
      <div className="fx-gutter fx-container fx-container--sm fx-stack">
        <header className="es-hostlist__head">
          <p className="es-hostlist__eyebrow"><NavIcon name="users" size={16} /> Your guest list</p>
          <h1 className="es-hostlist__title">{data ? `Guests of ${host.name}` : 'This guest list link has expired'}</h1>
          {data ? (
            <p className="text-muted">
              {event.title}
              {event.startsAt ? ` · ${formatEventTime(event.startsAt, event.timezone)}` : ''}
              {event.venue || event.city ? ` · ${[event.venue, event.city].filter(Boolean).join(', ')}` : ''}
            </p>
          ) : (
            <p className="text-muted">The organizer may have made a new one. Ask them to send it again.</p>
          )}
        </header>

        {!data && <Link href="/" className="text-accent">Go to Eventsli</Link>}

        {data && (
          <>
            <dl className="es-hostlist__totals">
              <div><dt>Bookings</dt><dd className="es-nums">{totals.bookings}</dd></div>
              <div><dt>Tickets</dt><dd className="es-nums">{totals.tickets}</dd></div>
            </dl>

            {guests.length === 0 ? (
              <p className="text-muted">Nobody has booked as your guest yet. When they do, they appear here and you get an email.</p>
            ) : (
              <ol className="es-hostlist__list">
                {guests.map((g, i) => (
                  <li key={`${g.bookedAt}-${i}`} className="es-hostlist__row">
                    <span className="es-hostlist__name">{g.name}</span>
                    <span className="es-hostlist__meta">
                      {g.tickets} ticket{g.tickets === 1 ? '' : 's'}
                      {g.pending ? ' · awaiting payment' : ''}
                      {g.bookedAt ? ` · ${formatEventTime(g.bookedAt, event.timezone, { time: false })}` : ''}
                    </span>
                  </li>
                ))}
              </ol>
            )}

            <p className="text-xs text-subtle">
              This page is private to you — please don’t share the link. Questions about a guest go to the organizer.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
