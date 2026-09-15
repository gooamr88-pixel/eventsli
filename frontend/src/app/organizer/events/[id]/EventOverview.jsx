'use client';

import { useEventContext } from './EventContext';
import ReviewActions from './ReviewActions';
import CoverUpload from './CoverUpload';
import EventStats from './EventStats';
import LaunchChecklist from './LaunchChecklist';
import EventDetailsEditor from './EventDetailsEditor';
import { formatMoney } from '../../../utils/money';
import { Loading, Notice } from '../../../components/Feedback';

/**
 * One event, from the organizer's side.
 *
 * The event itself comes from the event layout (see EventContext) — it used to
 * be fetched again here, on the same page load, for the same row.
 *
 * The money settings are READ ONLY here and that is BRD §05/§06, not an
 * oversight: `eventRules.js` keeps two field-authority maps, and every rate
 * lives in the admin one. `feeBearer` is the single financial field an
 * organizer controls (BRD §04).
 *
 * They are shown in full anyway. BRD §21 requires an organizer to SEE every
 * amount they will bear before they can publish, and a number you cannot edit
 * is still a number you have to be told.
 */
export default function EventOverview() {
  const ctx = useEventContext();
  const event = ctx?.event;

  if (!event) return <Loading variant="card" />;

  const money = event.fees;
  const hasSales = !['draft', 'pending_review', 'rejected'].includes(event.status);

  return (
    <div className="fx-stack">
      {/* BRD §16 — the review verdict, and what to do about it. A rejected
          event CAN go round again, which is the part a bare "rejected" hides. */}
      {event.review?.rejectionReason && event.status === 'rejected' && (
        <Notice tone="warning" title="Changes were asked for">
          <p>{event.review.rejectionReason}</p>
          <p>Make them in <a href="#details" className="text-accent underline">Event details</a> below and submit again — this is not a final decision.</p>
        </Notice>
      )}

      {event.status === 'suspended' && (
        <Notice tone="danger" title="This event has been suspended">
          {event.suspendedReason && <p>{event.suspendedReason}</p>}
          <p>It is off sale. Eventsli can put it back — this is not a cancellation.</p>
        </Notice>
      )}

      {/* BRD §17 — cancelled by Eventsli, never by the organizer. BRD §09 —
          tickets are non-refundable by default and any refund is between the
          organizer and the buyer; nothing here promises one either way. */}
      {event.status === 'cancelled' && (
        <Notice title="Cancelled by Eventsli">
          {event.cancelledReason && <p>{event.cancelledReason}</p>}
          <p>Tickets already sold are kept as a record and buyers can still see them.</p>
        </Notice>
      )}

      {hasSales && <EventStats eventId={event.id} currency={event.currency} />}

      {['draft', 'rejected', 'pending_review'].includes(event.status) ? (
        <div className="grid gap-[var(--fx-gap)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <LaunchChecklist event={event} />
          <div id="going-on-sale" className="scroll-mt-20">
            <ReviewActions event={event} onChanged={ctx.refresh} />
          </div>
        </div>
      ) : (
        <div id="going-on-sale" className="scroll-mt-20">
          <ReviewActions event={event} onChanged={ctx.refresh} />
        </div>
      )}

      {!['cancelled', 'completed'].includes(event.status) && (
        <div id="details" className="scroll-mt-20">
          <EventDetailsEditor event={event} onSaved={ctx.refresh} />
        </div>
      )}

      <div id="cover" className="scroll-mt-20">
        <CoverUpload event={event} onChanged={ctx.refresh} />
      </div>

      <section className="fx-stack fx-stack--sm es-card p-5">
        <h2 className="text-lg">What you will be charged</h2>
        <p className="text-sm text-muted">
          Set by Eventsli, and shown in full before you can publish.
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
              : `${money.paymentFeePct}% + ${formatMoney(money.paymentFeeFixedCents, event.currency)}`}
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

      <section className="fx-stack fx-stack--sm es-card p-5">
        <h2 className="text-lg">Rules</h2>
        <dl className="fx-stack fx-stack--sm text-sm">
          <Money term="Tickets per order" value={event.rules.maxTicketsPerOrder} />
          <Money
            term="Transfers"
            value={event.rules.allowTicketTransfer ? 'Allowed, once' : 'Off'}
            note="A buyer may pass a ticket on one time."
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
