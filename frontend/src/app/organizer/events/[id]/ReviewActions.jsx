'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { post } from '../../../utils/apiClient';
import { useToast } from '../../../components/ui/Toast';
import FormError from '../../../components/forms/FormError';
import SubmitButton from '../../../components/forms/SubmitButton';
import NavIcon from '../../../components/shell/NavIcon';
import FeeSummary from './FeeSummary';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Going on sale: accept the terms, then submit for review.
 *
 * BRD §16 — an organizer SUBMITS; only an admin publishes. `draft → published`
 * does not exist as an edge, so there is no button here that could create it.
 *
 * BRD §21 — the organizer sees every amount they bear and accepts the terms,
 * recorded against a version, before the event can be submitted.
 *
 * THE BUG THIS SCREEN HAD. "Accept and continue" recorded the acceptance, then
 * re-read the event — whose `termsAccepted` came from a column only Submit
 * wrote. So the terms box came straight back, Submit stayed disabled, and
 * accepting looked like it did nothing, however many times it was clicked.
 * The API now stamps the event when the terms are accepted and returns it; this
 * component hands that event straight to the page (`onChanged(event)`), so the
 * next step unlocks from the server's own answer rather than a second guess.
 *
 * The fees are shown HERE, beside the checkbox that agrees to them, rather than
 * further down the overview where they used to be.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function ReviewActions({ event, onChanged, buildReady = true }) {
  const toast = useToast();
  const agreeId = useId();
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const canSubmit = ['draft', 'rejected'].includes(event.status);
  const accepted = Boolean(event.review?.termsAccepted);

  async function acceptTerms() {
    setBusy('terms');
    setError(null);
    try {
      const result = await post(`/events/${event.id}/accept-terms`, undefined, { noRedirect: true });
      toast.success(`Recorded against version ${result?.version ?? '—'} of the organizer agreement.`, {
        title: 'Terms accepted',
      });
      onChanged?.(result?.event);
    } catch (err) {
      setError(err);
      // A refusal usually means this page is behind the server — re-read it.
      if (err?.code === 'CONFLICT') onChanged?.();
    } finally {
      setBusy(null);
    }
  }

  async function submit() {
    setBusy('submit');
    setError(null);
    try {
      const updated = await post(`/events/${event.id}/submit`, undefined, { noRedirect: true });
      toast.success('Eventsli reviews it next — usually within a day. You will get an email either way.', {
        title: 'Submitted for review',
      });
      onChanged?.(updated);
    } catch (err) {
      setError(err);
      // New terms published since the page loaded, or an edit elsewhere: the
      // re-read brings the terms step back rather than leaving a dead button.
      if (['TERMS_NOT_ACCEPTED', 'CONFLICT'].includes(err?.code)) onChanged?.();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="es-card fx-stack fx-stack--sm p-5" aria-labelledby={`${agreeId}-title`}>
      <div className="es-panel-head">
        <h2 id={`${agreeId}-title`} className="es-panel-head__title">Going on sale</h2>
        {canSubmit && (
          <span className="es-status" data-tone={!buildReady ? 'muted' : accepted ? 'success' : 'neutral'}>
            {!buildReady ? 'Not yet' : accepted ? 'Ready to submit' : 'Step 1 of 2'}
          </span>
        )}
      </div>

      {/* Nothing to agree to yet. The fees and the Submit button used to fill
          half a phone screen on a draft with no tickets, and the one button
          that worked sent an empty event to review. */}
      {canSubmit && !buildReady && !accepted && (
        <p className="text-sm text-muted">
          This unlocks once the event has its ticket types, seating map and a way to pay. Then you
          review the fees, accept the terms and send it to Eventsli — two taps.
        </p>
      )}

      {canSubmit && (buildReady || accepted) && (
        <ol className="es-steps">
          <li className="es-steps__item" data-state={accepted ? 'done' : 'current'}>
            <span className="es-steps__marker" aria-hidden="true">
              {accepted ? <NavIcon name="tick" size={16} /> : '1'}
            </span>
            <div className="es-steps__body">
              <p className="es-steps__title">
                Review the fees and accept the terms
                {accepted && <span className="sr-only"> — done</span>}
              </p>

              {accepted ? (
                <p className="text-sm text-muted">
                  Accepted for this event.{' '}
                  <Link href="/terms/organizer" target="_blank" rel="noreferrer" className="text-accent hover:text-accent-hover">
                    Read the agreement<span className="sr-only"> (opens in a new tab)</span>
                  </Link>
                </p>
              ) : (
                <>
                  <p className="text-sm text-muted">
                    What Eventsli charges on this event. Rates are set by Eventsli; who pays the
                    payment fee is yours to choose in the details below.
                  </p>
                  <div className="rounded-(--es-radius-md) bg-bg-sunken px-4 py-3">
                    <FeeSummary event={event} compact />
                  </div>
                  <label htmlFor={agreeId} className="es-check">
                    <input
                      id={agreeId}
                      type="checkbox"
                      className="es-check__box"
                      checked={agreed}
                      onChange={(e) => setAgreed(e.target.checked)}
                    />
                    <span className="text-sm text-ink">
                      I have read the{' '}
                      <Link href="/terms/organizer" target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2 hover:text-accent-hover">
                        organizer agreement<span className="sr-only"> (opens in a new tab)</span>
                      </Link>{' '}
                      and accept these fees for this event.
                    </span>
                  </label>
                  <div>
                    <SubmitButton
                      type="button"
                      busy={busy === 'terms'}
                      busyLabel="Recording…"
                      disabled={!agreed || busy === 'submit'}
                      onClick={acceptTerms}
                    >
                      Accept terms
                    </SubmitButton>
                  </div>
                </>
              )}
            </div>
          </li>

          <li className="es-steps__item" data-state={accepted ? 'current' : 'upcoming'}>
            <span className="es-steps__marker" aria-hidden="true">2</span>
            <div className="es-steps__body">
              <p className="es-steps__title">Submit for review</p>
              <p className="text-sm text-muted">
                {event.status === 'rejected'
                  ? 'Submit it again once you have made the changes Eventsli asked for.'
                  : 'Eventsli reviews every event before it goes on sale. It usually takes a day.'}
              </p>
              <div>
                <SubmitButton
                  type="button"
                  busy={busy === 'submit'}
                  busyLabel="Submitting…"
                  disabled={!accepted || !buildReady || busy === 'terms'}
                  onClick={submit}
                >
                  {event.status === 'rejected' ? 'Submit again' : 'Submit for review'}
                </SubmitButton>
              </div>
              {!buildReady
                ? <p className="text-xs text-subtle">Finish the steps in the checklist first — Eventsli needs to see what you are selling.</p>
                : !accepted && <p className="text-xs text-subtle">Accept the terms first.</p>}
            </div>
          </li>
        </ol>
      )}

      {event.status === 'pending_review' && (
        <div className="es-notice es-notice--info">
          <p>With Eventsli for review.</p>
          <p>You will get an email either way. Editing the details takes it out of the queue until you submit again.</p>
        </div>
      )}

      {event.status === 'published' && (
        <div className="es-notice es-notice--info">
          <p>On sale.</p>
          <p>Prices are locked for any ticket type that has already sold — buyers get what they paid for.</p>
        </div>
      )}

      <FormError error={error} />

      {error?.code === 'PAYMENT_METHOD_REQUIRED' && (
        <div className="fx-row">
          <Link href="/organizer/payments" className="es-btn es-btn--secondary es-btn--sm">Set up payment methods</Link>
          <a href="#details" className="es-btn es-btn--ghost es-btn--sm">Choose this event&rsquo;s payment option</a>
        </div>
      )}

      {/* BRD §17 — the organizer cannot cancel an event; they request it with
          "Request cancellation" at the top of the page, and Eventsli decides. */}
    </section>
  );
}
