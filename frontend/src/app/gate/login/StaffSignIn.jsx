'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import FormError from '../../components/forms/FormError';
import { listAssignments, signInAsStaff } from '../gateSession';

/**
 * A door-team member picks the event they are working tonight.
 *
 * Mounted only when "My account" is chosen, deliberately: most gates are PIN
 * tablets, and asking the API who is signed in on every tablet load would be a
 * 401 in the console of a device that may have no signal at all.
 */
export default function StaffSignIn() {
  const router = useRouter();
  const [state, setState] = useState({ loading: true, events: [], signedOut: false, error: null });
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const events = await listAssignments();
        if (!cancelled) setState({ loading: false, events: Array.isArray(events) ? events : [], signedOut: false, error: null });
      } catch (err) {
        if (!cancelled) {
          const signedOut = err?.status === 401;
          setState({ loading: false, events: [], signedOut, error: signedOut ? null : err });
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function choose(eventId) {
    setBusy(eventId);
    setError(null);
    try {
      await signInAsStaff({ eventId });
      router.replace('/gate');
    } catch (err) {
      setError(err);
      setBusy(null);
    }
  }

  if (state.loading) return <p className="text-sm text-muted" role="status">Checking your account…</p>;

  if (state.signedOut) {
    return (
      <div className="fx-stack fx-stack--sm">
        <p className="text-muted">Sign in to your Eventsli account on this device, then come back here.</p>
        <Link href="/login?next=/gate/login" className="es-btn es-btn--secondary self-start">Sign in</Link>
      </div>
    );
  }

  if (state.error) return <FormError error={state.error} />;

  if (state.events.length === 0) {
    return (
      <p className="text-muted">
        Your account is not on the door team for any event on sale right now. Ask the organizer to add
        the email you signed in with.
      </p>
    );
  }

  return (
    <div className="fx-stack fx-stack--sm">
      <p className="text-sm text-muted">Choose the event you are scanning. You stay signed in for this shift.</p>
      <ul className="fx-stack fx-stack--sm">
        {state.events.map((event) => (
          <li key={event.id}>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => choose(event.id)}
              aria-busy={busy === event.id || undefined}
              className="es-card es-card--interactive fx-stack fx-stack--sm w-full gap-1 p-4 text-left disabled:opacity-60"
            >
              <span className="text-ink">{event.title}</span>
              <span className="text-sm text-muted">
                {new Intl.DateTimeFormat('en-US', {
                  dateStyle: 'medium', timeStyle: 'short', timeZone: event.timezone,
                }).format(new Date(event.startsAt))}
                {event.venue && ` · ${event.venue}`}
                {event.as === 'organizer' && ' · your event'}
              </span>
              {busy === event.id && <span className="text-sm text-accent">Signing in…</span>}
            </button>
          </li>
        ))}
      </ul>
      <FormError error={error} />
    </div>
  );
}
