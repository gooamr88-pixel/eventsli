'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { get, post } from '../utils/apiClient';
import FormError from '../components/forms/FormError';
import { Loading, Empty, ErrorNotice } from '../components/Feedback';

/**
 * The review queue. BRD §16 — an organizer submits, only an admin publishes.
 *
 * Rejecting REQUIRES a reason, and that is not a form nicety: the reason is
 * shown to the organizer on their own event page, and a rejection with no
 * explanation is one they cannot act on. The event goes back to `rejected`,
 * which is a state they can resubmit from — it is not a final decision, and the
 * copy here says so.
 */
export default function Approvals() {
  const [events, setEvents] = useState(null);
  const [error, setError] = useState(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await get('/admin/approvals?limit=50', { cache: 'no-store' });
        if (!cancelled) { setEvents(Array.isArray(data) ? data : []); setError(null); }
      } catch (err) {
        if (!cancelled) setError(err);
      }
    })();
    return () => { cancelled = true; };
  }, [reload]);

  if (error) return <ErrorNotice error={error} />;
  if (!events) return <Loading variant="list" />;

  return (
    <div className="fx-stack">
      <div className="fx-stack fx-stack--sm">
        <h2 className="text-xl">Waiting for review</h2>
        <p className="max-w-[60ch] text-muted">
          Nothing goes on sale until it is approved here.
        </p>
      </div>

      {events.length === 0 ? (
        <Empty
          title="Nothing waiting."
          hint="Submitted events land here. An organizer cannot sell until one is approved."
        />
      ) : (
        <ul className="fx-stack fx-stack--sm">
          {events.map((event) => (
            <ReviewRow key={event.id} event={event} onDone={() => setReload((n) => n + 1)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ReviewRow({ event, onDone }) {
  const [mode, setMode] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function act(what, body) {
    setBusy(true);
    setError(null);
    try {
      await post(`/admin/events/${event.id}/${what}`, body, { noRedirect: true });
      onDone();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <li className="fx-stack fx-stack--sm es-card p-4">
      <div className="fx-row fx-row--between">
        <div className="fx-min0">
          <p className="fx-break text-ink">{event.title}</p>
          <p className="text-sm text-muted">
            {event.organizer?.name}
            {' · '}
            {new Intl.DateTimeFormat('en-US', {
              dateStyle: 'medium', timeStyle: 'short', timeZone: event.timezone || 'UTC',
            }).format(new Date(event.startsAt))}
            {' · '}{event.country} {event.currency}
            {event.listingType === 'display_only' && ' · listing only'}
          </p>
        </div>
        <Link
          href={`/e/${event.slug}`}
          target="_blank"
          rel="noreferrer"
          className="whitespace-nowrap text-sm text-accent"
        >
          Preview →
        </Link>
      </div>

      <FormError error={error} />

      {mode === 'reject' ? (
        <form
          onSubmit={(e) => { e.preventDefault(); act('reject', { reason: reason.trim() }); }}
          className="fx-stack fx-stack--sm rounded-[--es-radius-md] bg-bg-sunken p-3"
        >
          <label htmlFor={`why-${event.id}`} className="text-sm text-ink">
            What needs changing?
          </label>
          <textarea
            id={`why-${event.id}`}
            rows={3}
            required
            maxLength={1000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="es-input"
          />
          {/* Said plainly, because a reviewer typing this needs to know the
              organizer reads it and can act on it. */}
          <p className="text-xs text-subtle">
            The organizer sees this on their event and can fix it and submit again.
          </p>
          <div className="fx-row fx-row--between">
            <button type="button" onClick={() => setMode(null)} className="text-sm text-muted hover:text-ink">
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || reason.trim().length < 3}
              className="rounded-[--es-radius-md] bg-warning px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              {busy ? 'Sending…' : 'Send it back'}
            </button>
          </div>
        </form>
      ) : (
        <div className="fx-row fx-row--between">
          <button
            type="button"
            onClick={() => setMode('reject')}
            className="text-sm text-muted hover:text-warning"
          >
            Ask for changes
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => act('approve')}
            className="es-btn es-btn--primary"
          >
            {busy ? 'Publishing…' : 'Approve and publish'}
          </button>
        </div>
      )}
    </li>
  );
}
