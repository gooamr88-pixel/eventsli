'use client';

import { useState } from 'react';
import { post } from '../../utils/apiClient';
import { describeError } from '../../utils/errors';

/**
 * Resend the ticket email.
 *
 * THE ANSWER IS ALWAYS THE SAME, and that is the design rather than laziness.
 * An endpoint that says "no order for that address" is a directory: anyone can
 * check whether a given person bought a ticket to a given event, one address at
 * a time. The API refuses to distinguish, so this form says "if we have an
 * order, it is on its way" whether or not one exists.
 *
 * Which means the copy has to carry its weight — a person who typed the wrong
 * address needs to work that out from this screen, because nothing else will
 * tell them.
 */
export default function FindTicketForm() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post('/public/tickets/resend', { email: email.trim() }, { noRedirect: true });
      setSent(true);
    } catch (err) {
      // Only a rate limit or an outage reaches here — "no such order" does not.
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="fx-stack fx-stack--sm es-card p-5">
        <p className="text-ink">Check your inbox.</p>
        <p className="text-sm text-muted">
          If an order exists for <span className="text-ink">{email}</span>, the link is on its
          way. It can take a minute, and it may land in spam.
        </p>
        <button
          type="button"
          onClick={() => { setSent(false); setEmail(''); }}
          className="self-start text-sm text-accent"
        >
          Try a different address
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="fx-stack fx-stack--sm">
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoComplete="email"
        placeholder="you@example.com"
        aria-label="Email address"
        className="es-input"
      />

      {error && (
        <p role="alert" className="text-sm text-danger">{describeError(error).recovery}</p>
      )}

      <button
        type="submit"
        disabled={busy || email.trim().length < 5}
        className="es-btn es-btn--primary"
      >
        {busy ? 'Sending…' : 'Send my tickets'}
      </button>
    </form>
  );
}
