'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { get, post } from '../../../utils/apiClient';
import { describeError } from '../../../utils/errors';
import StatusPill from '../../StatusPill';
import ReviewActions from './ReviewActions';
import CoverUpload from './CoverUpload';

/**
 * One event, from the organizer's side.
 *
 * The money settings are READ ONLY here and that is BRD §05/§06, not an
 * oversight: `eventRules.js` keeps two field-authority maps, and every rate
 * lives in the admin one. `feeBearer` is the single financial field an
 * organizer controls (BRD §04) — it decides who pays the payment fee, never how
 * much the platform takes.
 *
 * They are shown in full anyway. BRD §21 requires an organizer to SEE every
 * amount they will bear before they can publish, and a number you cannot edit
 * is still a number you have to be told.
 */
export default function EventOverview({ eventId }) {
  const [event, setEvent] = useState(null);
  const [error, setError] = useState(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await get(`/events/${eventId}`, { cache: 'no-store' });
        if (!cancelled) { setEvent(data); setError(null); }
      } catch (err) {
        if (!cancelled) setError(err);
      }
    })();
    return () => { cancelled = true; };
  }, [eventId, reload]);

  const refresh = useCallback(() => setReload((n) => n + 1), []);

  if (error) {
    const { title, recovery } = describeError(error);
    return (
      <div className="fx-stack fx-stack--sm">
        <p className="font-medium text-ink">{title}</p>
        <p className="text-sm text-muted">{recovery}</p>
        <Link href="/organizer" className="text-sm text-accent">Back to your events</Link>
      </div>
    );
  }

  if (!event) return <p className="text-sm text-subtle">Loading…</p>;

  const money = event.fees;

  return (
    <div className="fx-stack">
      <div className="fx-row fx-row--between">
        <div className="fx-min0">
          <h2 className="fx-break text-xl">{event.title}</h2>
          <p className="text-sm text-muted">
            {new Intl.DateTimeFormat('en-US', {
              dateStyle: 'full', timeStyle: 'short', timeZone: event.timezone,
            }).format(new Date(event.startsAt))}
            {' '}<span className="text-subtle">({event.timezone})</span>
          </p>
        </div>
        <StatusPill status={event.status} />
      </div>

      {/* BRD §16 — the review verdict, and what to do about it. A rejected
          event CAN go round again, which is the part a bare "rejected" hides. */}
      {event.review?.rejectionReason && event.status === 'rejected' && (
        <div className="rounded-[--es-radius-md] bg-warning/10 px-4 py-3">
          <p className="text-sm text-ink">Changes were asked for</p>
          <p className="mt-1 text-sm text-muted">{event.review.rejectionReason}</p>
          <p className="mt-1 text-xs text-subtle">
            Make them and submit again — this is not a final decision.
          </p>
        </div>
      )}

      {event.status === 'suspended' && (
        <div className="rounded-[--es-radius-md] bg-danger/10 px-4 py-3">
          <p className="text-sm text-ink">This event has been suspended</p>
          {event.suspendedReason && (
            <p className="mt-1 text-sm text-muted">{event.suspendedReason}</p>
          )}
          <p className="mt-1 text-xs text-subtle">
            It is off sale. An admin can put it back — this is not a cancellation.
          </p>
        </div>
      )}

      {event.status === 'cancelled' && (
        <div className="rounded-[--es-radius-md] bg-bg-sunken px-4 py-3">
          <p className="text-sm text-ink">Cancelled</p>
          {event.cancelledReason && (
            <p className="mt-1 text-sm text-muted">{event.cancelledReason}</p>
          )}
          <p className="mt-1 text-xs text-subtle">
            Tickets already sold are kept as a record. Contacting buyers and any refund
            is yours to arrange.
          </p>
        </div>
      )}

      <ReviewActions event={event} onChanged={refresh} />

      <CoverUpload event={event} onChanged={refresh} />

      <section className="fx-stack fx-stack--sm rounded-[--es-radius-lg] border border-border-base bg-surface p-5">
        <h3 className="text-lg">What you will be charged</h3>
        <p className="text-sm text-muted">
          Set by us, and shown in full before you can publish.
        </p>

        <dl className="fx-stack fx-stack--sm text-sm">
          <Money term="Eventsli commission" value={`${money.commissionPct}%`}
            note="Of the ticket price. Always yours." />
          {money.commissionTaxPct > 0 && (
            <Money term="Tax on commission" value={`${money.commissionTaxPct}%`} />
          )}
          <Money
            term="Payment fee"
            value={money.paymentFeeMode === 'auto'
              ? 'Matched to what the card costs'
              : `${money.paymentFeePct}% + ${money.paymentFeeFixedCents}¢`}
            note={money.feeBearer === 'buyer'
              ? 'Added to the buyer’s total.'
              : 'Taken from your proceeds.'}
          />
          {money.eventTaxPct > 0 && (
            <Money term="Event tax" value={`${money.eventTaxPct}%`}
              note="Added to the buyer’s total. You remit it." />
          )}
        </dl>

        <p className="text-xs text-subtle">
          The commission and the payment fee are separate on purpose: one is our margin,
          the other recovers what the card costs. Merged into a single number, neither
          question has an answer.
        </p>
      </section>

      <section className="fx-stack fx-stack--sm rounded-[--es-radius-lg] border border-border-base bg-surface p-5">
        <h3 className="text-lg">Rules</h3>
        <dl className="fx-stack fx-stack--sm text-sm">
          <Money term="Tickets per order" value={event.rules.maxTicketsPerOrder} />
          <Money
            term="Transfers"
            value={event.rules.allowTicketTransfer ? 'Allowed, once' : 'Off'}
            note="BRD §10 — a buyer may pass a ticket on one time."
          />
          <Money term="Purchase mode" value={readable(event.purchaseMode)} />
        </dl>
      </section>
    </div>
  );
}

function Money({ term, value, note }) {
  return (
    <div className="fx-row fx-row--between border-t border-border-base pt-2 first:border-0 first:pt-0">
      <dt className="fx-min0">
        <span className="block text-ink">{term}</span>
        {note && <span className="block text-xs text-subtle">{note}</span>}
      </dt>
      <dd className="es-nums whitespace-nowrap text-ink">{value}</dd>
    </div>
  );
}

function readable(mode) {
  return {
    seat_only: 'Individual seats',
    table_only: 'Whole tables',
    seat_and_table: 'Seats or whole tables',
  }[mode] || mode;
}
