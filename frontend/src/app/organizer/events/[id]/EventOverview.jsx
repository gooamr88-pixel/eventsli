'use client';

import NavIcon from '../../../components/shell/NavIcon';
import { useSearchParams } from 'next/navigation';
import { useEventContext } from './EventContext';
import ReviewActions from './ReviewActions';
import EventStats from './EventStats';
import LaunchChecklist, { useLaunchSteps, NextStep } from './LaunchChecklist';
import EventDetailsEditor from './EventDetailsEditor';
import FeeSummary from './FeeSummary';
import { Panel } from '../../../components/ui/Page';
import { Loading, Notice } from '../../../components/Feedback';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * One event, from the organizer's side.
 *
 * The event itself comes from the event layout (see EventContext).
 *
 * ARRANGED BY WHAT THE ORGANIZER IS DOING, not by what data exists:
 *   · before it is on sale — what is left, and the terms + submit step, side by
 *     side at the top, because that is the job;
 *   · once it is selling — the numbers first;
 *   · then the editable details, with the charges beside them.
 *
 * What was removed, and why: a "Rules" card repeated three fields the details
 * form directly above it already edits, and "What you will be charged" sat at
 * the very bottom, far from the terms that agree to it. The charges now appear
 * beside the checkbox before acceptance, and in the side column after.
 *
 * The money settings are READ ONLY for an organizer and that is BRD §05/§06:
 * every rate lives in the admin's field map. `feeBearer` is the single financial
 * field an organizer controls (BRD §04), and it is edited in the details form.
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
  // Before acceptance the charges are shown inside the terms step itself.
  const feesInTermsStep = ['draft', 'rejected'].includes(event.status) && !event.review?.termsAccepted;

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
            Make them in <a href="#details" className="text-accent underline">Event details</a> and
            submit again — this is not a final decision.
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

      {/* THE COVER IS EDITED IN ONE PLACE, and it is Page & branding. It was
          here as well, so the same picture had two editors on two screens —
          while the launch checklist's "Cover image" step and the sidebar both
          send an organizer to the other one, and the `#cover` anchor this
          carried was linked from nowhere at all.

          With the cover gone the side column holds the charges alone, so it is
          only a split when there ARE charges to show. Before the terms are
          accepted they appear inside the terms step instead, and a bare grid
          would leave a third of a desktop screen empty beside the form. */}
      <div className={feesInTermsStep ? 'fx-stack' : 'es-split'}>
        <div className="fx-stack fx-min0">
          {finished ? (
            <Panel title="How it was sold">
              <dl className="es-deflist">
                <Row term="Tickets per order" value={event.rules.maxTicketsPerOrder} />
                <Row term="Transfers" value={event.rules.allowTicketTransfer ? 'Allowed, once' : 'Off'} />
                <Row term="Purchase mode" value={readable(event.purchaseMode)} />
              </dl>
            </Panel>
          ) : (
            <div id="details" className="scroll-mt-24">
              <EventDetailsEditor event={event} onSaved={ctx.refresh} />
            </div>
          )}
        </div>

        {!feesInTermsStep && (
          <div className="fx-stack fx-min0">
            <Panel title="What you are charged" description="Set by Eventsli, and agreed when the terms were accepted.">
              <FeeSummary event={event} />
            </Panel>
          </div>
        )}
      </div>
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
