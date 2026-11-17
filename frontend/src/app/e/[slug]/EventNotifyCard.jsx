'use client';

import { useId, useState } from 'react';
import { post } from '../../utils/apiClient';
import NavIcon from '../../components/shell/NavIcon';
import FormError from '../../components/forms/FormError';
import { formatMonth } from '../../lib/comingSoon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * "NOTIFY ME" — a coming-soon event's call to action (owner, 2026-11-17).
 *
 * Drawn as the same ticket as "Get your tickets" (EventTicketCard), with an
 * email box where the Buy button would be. The address gets ONE email, when
 * the organizer opens ticket sales, and nothing else — the page says so,
 * because that is what makes it safe to type an address into.
 *
 * Signing up twice is answered the same as once, by the API and here.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function EventNotifyCard({ event }) {
  const inputId = useId();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);
  const month = formatMonth(event);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post(`/public/events/${encodeURIComponent(event.slug)}/notify`, { email: email.trim() }, { noRedirect: true });
      setDone(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="event-tickets" className="es-evx-tickets" aria-labelledby="event-notify-title">
      <p className="es-evx-tickets__tab">Tickets</p>

      <div className="es-evx-ticket">
        <div className="es-evx-ticket__body">
          <h2 id="event-notify-title" className="es-evx-ticket__title">
            {done ? 'You’re on the list' : 'Tickets are coming soon'}
          </h2>
          <p className="es-evx-ticket__text" role={done ? 'status' : undefined}>
            {done
              ? 'We will email you once, the moment tickets go on sale. Nothing else.'
              : 'Leave your email and we will tell you the moment tickets go on sale — one email, nothing else.'}
          </p>
          {!done && (
            <form className="es-evx-notify" onSubmit={submit} noValidate>
              <label htmlFor={inputId} className="sr-only">Your email</label>
              <input
                id={inputId}
                type="email"
                name="email"
                required
                autoComplete="email"
                inputMode="email"
                maxLength={254}
                placeholder="you@example.com"
                className="es-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <button type="submit" className="es-evx-ticket__btn" disabled={busy || !email.trim()}>
                <NavIcon name="bell" size={18} />
                {busy ? 'Saving…' : 'Notify me'}
              </button>
            </form>
          )}
          <FormError error={error} />
        </div>

        <div className="es-evx-ticket__stub" aria-hidden>
          <span className="es-evx-ticket__icon"><NavIcon name="bell" size={44} /></span>
          <span className="es-evx-ticket__month">{month || 'Coming soon'}</span>
        </div>
      </div>
    </section>
  );
}
