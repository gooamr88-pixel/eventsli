'use client';

import Link from 'next/link';
import NavIcon from '../../../components/shell/NavIcon';
import { useSearchParams } from 'next/navigation';
import { useEventContext } from './EventContext';
import ReviewActions from './ReviewActions';
import EventStats from './EventStats';
import LaunchChecklist, { useLaunchSteps, NextStep } from './LaunchChecklist';
import { Panel } from '../../../components/ui/Page';
import { Loading, Notice } from '../../../components/Feedback';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * One event, AT A GLANCE — and only at a glance.
 *
 * The event itself comes from the event layout (see EventContext).
 *
 * WHAT THIS SCREEN IS FOR: where the event stands, and what to do next.
 *   · needs attention — the status notices, which are the only thing on the
 *     page that can be urgent, so they are first;
 *   · before it is on sale — the next step, every step, and the terms + submit
 *     beside them, because that is the job;
 *   · once it is selling — the numbers.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT LEFT, AND WHY IT HAD TO.
 *
 * `EventDetailsEditor` was rendered here, under everything else: 445 lines of
 * form for the name, dates, venue, capacity, fee bearer and refund rules. It
 * was by a long way the largest thing on the page, so this URL was really two
 * screens — a summary and an editor — sharing one sidebar entry. Reading "how
 * is my event doing" meant scrolling past a form, and changing a date meant
 * scrolling past a checklist.
 *
 * It is a build step now, at `/details`, with its own place in the sidebar and
 * its own place in the Back / Save and continue sequence. `FeeSummary` went
 * with it rather than staying: `feeBearer` is the field that decides those
 * charges and it is in that form, so the setting and its consequence belong on
 * one screen.
 *
 * The overview keeps only what answers "where does this stand" — which is what
 * an overview is, and what this one had stopped being.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const PRE_LAUNCH = ['draft', 'rejected', 'pending_review'];

export default function EventOverview() {
  const ctx = useEventContext();
  const params = useSearchParams();
  const event = ctx?.event;

  if (!event) return <Loading variant="card" />;

  const preLaunch = PRE_LAUNCH.includes(event.status);
  const finished = ['cancelled', 'completed', 'archived'].includes(event.status);
  const ticketed = event.listingType !== 'display_only';
  const justCreated = params.get('created') === '1' && event.status === 'draft';
  const request = event.cancellationRequest;

  return (
    <div className="fx-stack">
      {justCreated && (
        <p className="fx-row flex-nowrap items-start gap-2 text-sm text-muted" role="status">
          <span className="shrink-0 text-accent"><NavIcon name="check" size={18} /></span>
          <span>Your event is saved as a private draft. Follow the steps below to put it on sale.</span>
        </p>
      )}

      {event.status === 'archived' && (
        <Notice title="This event is archived.">
          <p>
            {event.archivedFrom === 'published'
              ? 'Ticket sales are stopped and it is not shown on Eventsli. Tickets already sold still scan at the door.'
              : 'It is out of your main list and cannot be edited.'}
            {' '}Use <strong className="text-ink">Restore</strong> above to bring it back.
          </p>
        </Notice>
      )}

      {/* BRD §17 — the organizer asks; Eventsli decides. Where the latest
          request stands, and what it means for buyers meanwhile. */}
      {request?.status === 'pending' && event.status !== 'cancelled' && (
        <Notice tone="warning" title="Cancellation requested — waiting for Eventsli.">
          <p className="fx-break">Your reason: “{request.reason}”</p>
          <p>Nothing changes until it is approved: the event stays as it is. You will get an email with the decision.</p>
        </Notice>
      )}
      {request?.status === 'rejected' && event.status !== 'cancelled' && (
        <Notice tone="warning" title="Eventsli did not approve your cancellation request.">
          {request.decisionNote && <p className="fx-break">{request.decisionNote}</p>}
          <p>The event carries on. You can send a new request if things change.</p>
        </Notice>
      )}

      {/* BRD §16 — the review verdict, and what to do about it. A rejected
          event CAN go round again, which is the part a bare "rejected" hides. */}
      {event.review?.rejectionReason && event.status === 'rejected' && (
        <Notice tone="warning" title="Eventsli asked for changes">
          <p className="fx-break">{event.review.rejectionReason}</p>
          <p>
            {/* A real route, not `#details`. The form this pointed at is a
                screen of its own now, so an in-page anchor would scroll to
                nothing on the page it is written on. */}
            Make them in{' '}
            <Link href={`/organizer/events/${event.id}/details`} className="text-accent underline">
              Event details
            </Link>{' '}
            and submit again — this is not a final decision.
          </p>
        </Notice>
      )}

      {event.status === 'suspended' && (
        <Notice tone="danger" title="This event has been suspended">
          {event.suspendedReason && <p className="fx-break">{event.suspendedReason}</p>}
          <p>It is off sale. Eventsli can put it back — this is not a cancellation.</p>
        </Notice>
      )}

      {/* BRD §17 — cancelled by Eventsli, never by the organizer. BRD §09 —
          tickets are non-refundable by default and any refund is between the
          organizer and the buyer; nothing here promises one either way. */}
      {event.status === 'cancelled' && (
        <Notice title={request?.status === 'approved' ? 'Cancelled — Eventsli approved your request' : 'Cancelled by Eventsli'}>
          {event.cancelledReason && <p className="fx-break">{event.cancelledReason}</p>}
          <p>Tickets already sold are kept as a record and buyers can still see them.</p>
        </Notice>
      )}

      {!preLaunch && ticketed && <EventStats eventId={event.id} currency={event.currency} />}

      {preLaunch && <PreLaunch event={event} onChanged={ctx.refresh} />}

      {/* ─────────────────────────────────────────────────────────────────
          A FINISHED EVENT HAS NO STEPS LEFT, so this is the one thing it
          gets: how it was set up when it sold. Every other event's details
          are edited on their own screen — see below.
          ───────────────────────────────────────────────────────────────── */}
      {finished && (
        <Panel title="How it was sold">
          <dl className="es-deflist">
            <Row term="Tickets per order" value={event.rules.maxTicketsPerOrder} />
            <Row term="Transfers" value={event.rules.allowTicketTransfer ? 'Allowed, once' : 'Off'} />
            <Row term="Purchase mode" value={readable(event.purchaseMode)} />
          </dl>
        </Panel>
      )}
    </div>
  );
}

/**
 * Before it is on sale: the one next step first, then every step, then the
 * terms and Submit beside them. One hook decides what is done, so the three can
 * never disagree — and Submit waits for the things a reviewer needs to see.
 */
function PreLaunch({ event, onChanged }) {
  const steps = useLaunchSteps(event);
  return (
    <>
      <NextStep steps={steps} />
      <div className="es-split es-split--even">
        <LaunchChecklist steps={steps} />
        <div id="going-on-sale" className="scroll-mt-24">
          <ReviewActions event={event} onChanged={onChanged} buildReady={steps.loaded ? steps.buildReady : true} />
        </div>
      </div>
    </>
  );
}

function Row({ term, value }) {
  return (
    <div className="es-deflist__row">
      <dt className="text-muted">{term}</dt>
      <dd className="es-nums text-right text-ink">{value}</dd>
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
