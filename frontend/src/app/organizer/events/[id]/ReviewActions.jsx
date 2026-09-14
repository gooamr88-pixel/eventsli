'use client';

import { useState } from 'react';
import Link from 'next/link';
import { post } from '../../../utils/apiClient';
import FormError from '../../../components/forms/FormError';
import SubmitButton from '../../../components/forms/SubmitButton';

/**
 * Accept the terms, submit for review.
 *
 * BRD §16 — an organizer SUBMITS; only an admin publishes. `draft → published`
 * simply does not exist as an edge, so there is no button here that could
 * create it.
 *
 * BRD §21 — submitting requires an accepted terms version on record, and the
 * database enforces it as a CHECK constraint, not as a rule in a controller. So
 * "accept the terms" is a real step with a real consequence rather than a
 * checkbox: the API answers `TERMS_NOT_ACCEPTED` and names the version.
 */
export default function ReviewActions({ event, onChanged }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const canSubmit = ['draft', 'rejected'].includes(event.status);
  // An event that is over, one way or the other, has nothing left to call off.
  const canContact = !['cancelled', 'completed'].includes(event.status);

  async function run(what, path, body) {
    setBusy(what);
    setError(null);
    try {
      await post(path, body, { noRedirect: true });
      onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="fx-stack fx-stack--sm es-card p-5">
      <h3 className="text-lg">Going on sale</h3>

      {!event.review?.termsAccepted && canSubmit && (
        <div className="fx-stack fx-stack--sm rounded-[--es-radius-md] bg-bg-sunken p-4">
          <p className="text-sm text-ink">Accept the organizer terms for this event</p>
          <p className="text-sm text-muted">
            They cover the commission, the fees, refunds and what you are responsible
            for. Acceptance is recorded against the version you were shown.
          </p>
          <div className="fx-row">
            <a
              href="/terms/organizer"
              target="_blank"
              rel="noreferrer"
              className="text-sm text-accent"
            >
              Read them →
            </a>
          </div>
          <SubmitButton
            type="button"
            busy={busy === 'terms'}
            busyLabel="Recording…"
            onClick={() => run('terms', `/events/${event.id}/accept-terms`)}
          >
            Accept and continue
          </SubmitButton>
        </div>
      )}

      {canSubmit && (
        <div className="fx-stack fx-stack--sm">
          <p className="text-sm text-muted">
            {event.status === 'rejected'
              ? 'Submit it again once you have made the changes.'
              : 'We review every event before it goes on sale. It usually takes a day.'}
          </p>
          <SubmitButton
            type="button"
            busy={busy === 'submit'}
            busyLabel="Submitting…"
            disabled={!event.review?.termsAccepted}
            onClick={() => run('submit', `/events/${event.id}/submit`)}
          >
            Submit for review
          </SubmitButton>
        </div>
      )}

      {event.status === 'pending_review' && (
        <p className="rounded-[--es-radius-md] bg-info/10 px-3 py-2.5 text-sm text-muted">
          With us for review. You will get an email either way.
        </p>
      )}

      {event.status === 'published' && (
        <p className="rounded-[--es-radius-md] bg-success/10 px-3 py-2.5 text-sm text-muted">
          <span className="text-ink">On sale.</span> Prices are locked for any ticket type
          that has already sold — buyers must get what they paid for.
        </p>
      )}

      <FormError error={error} />

      {/* BRD §17 — the organizer cannot cancel an event; only Eventsli can.
          So there is no button here, only where to go. */}
      {canContact && (
        <p className="border-t border-border-base pt-4 text-sm text-muted">
          Need to call this event off? Only Eventsli can cancel an event.{' '}
          <Link href="/contact" className="text-accent">Contact us</Link>.
        </p>
      )}
    </section>
  );
}
