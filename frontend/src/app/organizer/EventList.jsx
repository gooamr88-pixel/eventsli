'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { get } from '../utils/apiClient';
import { useOrganizer } from '../hooks/useOrganizer';
import { Loading, Empty, Notice, ErrorNotice, Stat } from '../components/Feedback';
import CreateProfile from './CreateProfile';
import StatusPill from './StatusPill';

/**
 * The organizer's own events.
 *
 * Three states before the list itself: no organizer profile (the common one for
 * a buyer who wandered here), a banned profile, and the list. Each is a
 * different thing to say.
 */
export default function EventList() {
  const { loading, organizer, error: orgError, refresh } = useOrganizer();
  const [events, setEvents] = useState(null);
  const [error, setError] = useState(null);
  /**
   * When the list was fetched.
   *
   * Recorded here rather than read in `Summary`, and it is not a style
   * preference: `Date.now()` during render makes the component non-idempotent,
   * which `react-hooks` rejects and which is a real hydration hazard — the
   * server's clock and the browser's are not the same clock. Captured in the
   * effect, it is a plain value that flows down like any other, and it is also
   * the more truthful one: this list is a snapshot, so "what is next" should be
   * answered as of when the snapshot was taken.
   */
  const [fetchedAt, setFetchedAt] = useState(null);

  useEffect(() => {
    if (!organizer) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const data = await get('/events?limit=100', { cache: 'no-store' });
        if (!cancelled) {
          setEvents(Array.isArray(data) ? data : []);
          setFetchedAt(Date.now());
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err);
      }
    })();
    return () => { cancelled = true; };
  }, [organizer]);

  if (loading) return <Loading variant="list" rows={3} label="Loading your events" />;

  if (orgError) return <ErrorNotice error={orgError} />;

  if (!organizer) return <CreateProfile onCreated={refresh} />;

  return (
    <div className="fx-stack">
      {/* BRD §19 — a banned organizer is NOT a blocked account. They still sign
          in and still see what they owe, because an organizer who cannot see
          the invoice cannot pay it. What stops is putting anything new on
          sale. */}
      {organizer.isBanned && (
        <Notice tone="danger" title="Your organizer account is suspended.">
          <p>
            You can still see your events and settle anything owed, but nothing new
            can go on sale. Contact support if you think that is a mistake.
          </p>
        </Notice>
      )}

      <PayoutBanner organizer={organizer} />

      {error ? (
        <ErrorNotice error={error} />
      ) : !events ? (
        <Loading variant="list" rows={3} label="Loading your events" />
      ) : events.length === 0 ? (
        <Empty
          title="No events yet."
          hint="An event stays a draft until you submit it, so nothing goes on sale by accident."
          action={{ href: '/organizer/events/new', label: 'Create your first one' }}
        />
      ) : (
        <>
          <Summary events={events} now={fetchedAt} />

          <ul className="fx-stack fx-stack--sm">
            {events.map((event) => (
              <li key={event.id}>
                <Link
                  href={`/organizer/events/${event.id}`}
                  className="es-card es-card--interactive fx-row fx-row--between p-4"
                >
                  <div className="fx-min0">
                    <p className="fx-break text-ink">{event.title}</p>
                    <p className="text-sm text-muted">
                      {new Intl.DateTimeFormat('en-US', {
                        dateStyle: 'medium', timeStyle: 'short', timeZone: event.timezone,
                      }).format(new Date(event.startsAt))}
                      {event.venue?.name && ` · ${event.venue.name}`}
                    </p>
                  </div>
                  <StatusPill status={event.status} />
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/**
 * Four numbers, above the list.
 *
 * The organizer's landing page had none. It opened on a flat list of titles, so
 * "how many are actually on sale" and "is anything waiting on me" — the two
 * questions somebody opens this page to answer — had to be counted by eye off a
 * column of status pills.
 *
 * EVERY NUMBER HERE IS COUNTED FROM `events`, WHICH IS ALREADY LOADED. No
 * second request, and more to the point no invented figures: `/events` returns
 * status and dates, not sales, so this deliberately says nothing about revenue
 * or tickets sold. A dashboard tile showing a number the endpoint did not
 * return is the worst thing on this page, not the best — and the sales figures
 * do exist, per event, one click away on the event's overview.
 *
 * "Needs you" folds `rejected` in with `draft`: both are events sitting still
 * until the organizer does something, which is the question being asked.
 * `pending_review` is excluded because that one is waiting on US.
 */
function Summary({ events, now }) {
  const count = (...statuses) => events.filter((e) => statuses.includes(e.status)).length;

  const next = events
    .filter((e) => e.status === 'published' && new Date(e.startsAt).getTime() > now)
    .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt))[0];

  return (
    <div className="fx-grid fx-grid--4">
      <Stat label="On sale" value={count('published')} />
      <Stat label="In review" value={count('pending_review')} note="Waiting on us" />
      <Stat label="Needs you" value={count('draft', 'rejected')} note="Drafts and changes asked for" />
      <Stat
        label="Next door open"
        value={next
          ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: next.timezone })
            .format(new Date(next.startsAt))
          : '—'}
        note={next ? next.title : 'Nothing on sale is upcoming'}
      />
    </div>
  );
}

/**
 * Payout state, shown where it is actionable rather than only at checkout.
 *
 * Without a connected account every checkout for this organizer is refused with
 * `STRIPE_NOT_CONNECTED` — and the buyer is deliberately not told which setting
 * is missing, because it is not theirs to fix. So the organizer has to learn it
 * here, before an event is live, rather than from a buyer's complaint.
 */
function PayoutBanner({ organizer }) {
  if (organizer.canReceivePayouts) return null;

  return (
    <Notice
      tone="warning"
      title={organizer.stripeConnected
        ? 'Stripe still needs some details.'
        : 'No payout account yet.'}
      action={{ href: '/organizer/payouts', label: 'Set up payouts' }}
    >
      <p>Until this is done, tickets cannot be sold.</p>
    </Notice>
  );
}
