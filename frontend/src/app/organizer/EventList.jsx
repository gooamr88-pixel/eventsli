'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { get } from '../utils/apiClient';
import { describeError } from '../utils/errors';
import { useOrganizer } from '../hooks/useOrganizer';
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

  useEffect(() => {
    if (!organizer) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const data = await get('/events?limit=100', { cache: 'no-store' });
        if (!cancelled) { setEvents(Array.isArray(data) ? data : []); setError(null); }
      } catch (err) {
        if (!cancelled) setError(err);
      }
    })();
    return () => { cancelled = true; };
  }, [organizer]);

  if (loading) return <p className="text-sm text-subtle">Loading…</p>;

  if (orgError) {
    const { title, recovery } = describeError(orgError);
    return (
      <div className="fx-stack fx-stack--sm">
        <p className="font-medium text-ink">{title}</p>
        <p className="text-sm text-muted">{recovery}</p>
      </div>
    );
  }

  if (!organizer) return <CreateProfile onCreated={refresh} />;

  return (
    <div className="fx-stack">
      {/* BRD §19 — a banned organizer is NOT a blocked account. They still sign
          in and still see what they owe, because an organizer who cannot see
          the invoice cannot pay it. What stops is putting anything new on
          sale. */}
      {organizer.isBanned && (
        <p className="rounded-[--es-radius-md] bg-danger/10 px-4 py-3 text-sm text-muted">
          <span className="text-ink">Your organizer account is suspended.</span> You can
          still see your events and settle anything owed, but nothing new can go on sale.
          Contact support if you think that is a mistake.
        </p>
      )}

      <PayoutBanner organizer={organizer} />

      {error ? (
        <p className="text-sm text-muted">{describeError(error).recovery}</p>
      ) : !events ? (
        <p className="text-sm text-subtle">Loading your events…</p>
      ) : events.length === 0 ? (
        <div className="rounded-[--es-radius-lg] border border-dashed border-border-strong p-10 text-center">
          <p className="text-muted">No events yet.</p>
          <Link href="/organizer/events/new" className="mt-2 inline-block text-sm text-accent">
            Create your first one
          </Link>
        </div>
      ) : (
        <ul className="fx-stack fx-stack--sm">
          {events.map((event) => (
            <li key={event.id}>
              <Link
                href={`/organizer/events/${event.id}`}
                className="fx-row fx-row--between rounded-[--es-radius-lg] border border-border-base bg-surface p-4 transition-shadow hover:shadow-sm"
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
      )}
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
    <div className="fx-row fx-row--between rounded-[--es-radius-md] bg-warning/10 px-4 py-3">
      <p className="fx-min0 text-sm text-muted">
        <span className="text-ink">
          {organizer.stripeConnected ? 'Stripe still needs some details.' : 'No payout account yet.'}
        </span>{' '}
        Until this is done, tickets cannot be sold.
      </p>
      <Link href="/organizer/payouts" className="whitespace-nowrap text-sm text-accent">
        Set up payouts →
      </Link>
    </div>
  );
}
