'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { useApi } from '../../../hooks/useApi';
import { formatEventTime } from '../../../lib/eventTime';
import { Loading } from '../../../components/Feedback';
import FormError from '../../../components/forms/FormError';
import SubmitButton from '../../../components/forms/SubmitButton';
import NavIcon from '../../../components/shell/NavIcon';
import MoneyLines from './MoneyLines';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT YOU ARE ABOUT TO SEND — the last screen before the review queue.
 *
 * Submit used to fire on the first click. An organizer agreed to a commission,
 * a payment fee and a tax rate — three numbers that decide what they are paid
 * for every ticket — by pressing a button with none of them next to it. The
 * fee table was two steps up the same page, which is not the same as being in
 * front of the decision.
 *
 * SO EVERY FIGURE COMES FROM THE SERVER, not from percentages multiplied here.
 * `GET /events/:id/submission-preview` runs the same `describeOrder` that
 * prices a real sale, per ticket type, and this dialog only formats what it
 * says. A total the browser worked out for itself is a total that will one day
 * disagree with the charge — and the organizer believes the one on screen.
 *
 * ONE TICKET, ONE ORDER, AND IT SAYS SO. The fixed part of the payment fee is
 * per charge, not per seat, so a per-ticket figure is only exact for an order
 * of one. Quoting it any other way would flatter or overstate every row.
 *
 * WHAT IS OUTSTANDING IS LISTED, NOT DISCOVERED. The server reports every
 * blocker rather than the first, so three missing things are fixed in one pass
 * instead of three refused submissions.
 *
 * Built on the native <dialog> for the reasons Confirm.jsx gives: focus
 * trapping, Escape, inertness and focus restoration, all correct for free.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function SubmitReview({ eventId, onClose, onConfirm, busy = false, error = null }) {
  const ref = useRef(null);
  const titleId = useId();
  const agreeId = useId();
  const [agreed, setAgreed] = useState(false);
  const { data, error: loadError, loading } = useApi(`/events/${eventId}/submission-preview`);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return undefined;
    // jsdom and some older engines have no showModal; the dialog still renders.
    if (typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal();
    else dialog.setAttribute('open', '');
    return () => { if (dialog.open && typeof dialog.close === 'function') dialog.close(); };
  }, []);

  const event = data?.event;
  const currency = event?.currency || 'USD';
  const blockers = data?.blockers || [];
  const ready = Boolean(data) && data.canSubmit && agreed && !busy;

  return (
    <dialog
      ref={ref}
      className="es-dialog es-dialog--wide"
      aria-labelledby={titleId}
      // Escape would close the native dialog and leave this component mounted
      // over nothing. Routed through the same close the Back button uses.
      onCancel={(e) => { e.preventDefault(); if (!busy) onClose(); }}
    >
      <div className="es-review">
        <header className="es-review__head">
          <p className="es-review__eyebrow">Before you submit</p>
          <h2 id={titleId} className="es-review__title">{event?.title || 'Review your event'}</h2>
          <p className="text-sm text-muted">
            Eventsli reviews this next. Check what buyers will see, and what every ticket pays you.
          </p>
        </header>

        <div className="es-review__body">
          {loading && <Loading variant="list" rows={4} label="Loading your event" />}
          <FormError error={loadError} />

          {data && (
            <>
              {blockers.length > 0 && (
                <div className="es-notice es-notice--warning">
                  <p><strong className="text-ink">Not ready yet.</strong> Fix these, then come back:</p>
                  <ul className="es-review__blockers">
                    {blockers.map((b) => <li key={b.code + b.message}>{b.message}</li>)}
                  </ul>
                </div>
              )}

              <Section title="The event" icon="calendar">
                <Facts rows={[
                  ['Title', event.title],
                  ['Type', event.listingType === 'display_only'
                    ? 'Listing only — no tickets sold'
                    : event.admissionType === 'general'
                      ? 'General admission'
                      : 'Reserved seating'],
                  ['Category', event.category || 'Not set'],
                  ['Tickets per order', event.maxTicketsPerOrder ? String(event.maxTicketsPerOrder) : 'No limit'],
                  ['Ticket transfer', event.allowTicketTransfer ? 'Buyers may transfer their tickets' : 'Not allowed'],
                ]} />
                {event.description && (
                  <p className="es-review__prose">{event.description}</p>
                )}
              </Section>

              <Section title="When" icon="clock">
                <Facts rows={[
                  ['Starts', formatEventTime(event.startsAt, event.timezone)],
                  ['Ends', formatEventTime(event.endsAt, event.timezone)],
                  ['Time zone', event.timezone || 'Not set'],
                ]} />
                <p className="text-xs text-subtle">
                  Every time on the ticket and in every email is this clock, not the buyer&rsquo;s.
                </p>
              </Section>

              <Section title="Where" icon="map">
                <Facts rows={[
                  ['Venue', event.venueName || <Missing>No venue name</Missing>],
                  ['Address', event.venueAddress || <Missing>No street address</Missing>],
                  ['City', event.city || <Missing>No city</Missing>],
                  ['Country', event.country || 'Not set'],
                ]} />
                <p className="text-xs text-subtle">
                  {event.city
                    ? 'The city is what puts this event in “events near me”.'
                    : 'Without a city this event never appears in “events near me”.'}
                </p>
              </Section>

              <Section title="Tickets, fees and what you receive" icon="ticket">
                <MoneyLines
                  lines={data.lines}
                  fees={data.fees}
                  currency={currency}
                  isFree={data.isFree}
                  listingOnly={event.listingType === 'display_only'}
                />
              </Section>

              <Section title="Policies and terms" icon="shield">
                {data.policies.length === 0 ? (
                  <p className="text-sm text-muted">
                    You have no policies of your own on this event. Buyers will see Eventsli&rsquo;s
                    terms only — a refund policy is the one they look for.
                  </p>
                ) : (
                  <ul className="es-review__policies">
                    {data.policies.map((p) => (
                      <li key={p.id}>
                        <p className="text-sm text-ink">
                          {p.title}
                          {p.showAtCheckout && <span className="es-review__tag">Shown at checkout</span>}
                        </p>
                        <p className="es-review__prose">{p.body}</p>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-xs text-subtle">
                  Eventsli&rsquo;s own terms apply to every sale and are accepted separately at the
                  checkout.{' '}
                  {data.terms.accepted
                    ? `You accepted version ${data.terms.version ?? '—'} of the organizer agreement for this event.`
                    : 'You have not accepted the organizer agreement for this event yet.'}{' '}
                  <Link href="/terms/organizer" target="_blank" rel="noreferrer" className="text-accent hover:text-accent-hover">
                    Read it<span className="sr-only"> (opens in a new tab)</span>
                  </Link>
                </p>
              </Section>
            </>
          )}

          <FormError error={error} />
        </div>

        <footer className="es-review__foot">
          <label htmlFor={agreeId} className="es-check">
            <input
              id={agreeId}
              type="checkbox"
              className="es-check__box"
              checked={agreed}
              disabled={busy || !data?.canSubmit}
              onChange={(e) => setAgreed(e.target.checked)}
            />
            <span className="text-sm text-ink">
              I have checked the details, the fees and the policies above, and I want to send this
              event to Eventsli for review.
            </span>
          </label>

          <div className="es-review__actions">
            <button type="button" className="es-btn es-btn--secondary" onClick={onClose} disabled={busy}>
              Back &amp; edit
            </button>
            <SubmitButton
              type="button"
              busy={busy}
              busyLabel="Submitting…"
              disabled={!ready}
              onClick={onConfirm}
            >
              Submit for review
            </SubmitButton>
          </div>
        </footer>
      </div>
    </dialog>
  );
}

/** One titled block of the review. */
function Section({ title, icon, children }) {
  return (
    <section className="es-review__section">
      <h3 className="es-review__heading">
        <NavIcon name={icon} size={16} />
        {title}
      </h3>
      {children}
    </section>
  );
}

/** Label/value pairs. `dl` rather than a table: these are not columns. */
function Facts({ rows }) {
  return (
    <dl className="es-deflist">
      {rows.map(([term, value]) => (
        <div key={term} className="es-deflist__row">
          <dt className="fx-min0 text-muted">{term}</dt>
          <dd className="fx-min0 text-right text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Something the submit will be refused for, said in the row it belongs to. */
function Missing({ children }) {
  return <span className="text-danger">{children}</span>;
}
