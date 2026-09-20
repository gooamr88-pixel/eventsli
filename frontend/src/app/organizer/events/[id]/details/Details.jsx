'use client';

import { useEventContext } from '../EventContext';
import EventDetailsEditor from '../EventDetailsEditor';
import FeeSummary from '../FeeSummary';
import { Panel } from '../../../../components/ui/Page';
import { Loading, Notice } from '../../../../components/Feedback';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE EVENT'S OWN FIELDS — a build step, on its own screen.
 *
 * This form used to be rendered inside the overview, under everything else.
 * That made the overview two screens wearing one URL: a summary of where the
 * event stands, and a 445-line editor for its name, dates, venue, capacity and
 * refund rules. The editor is the longest thing on the page by a wide margin,
 * so "how is my event doing" and "change my event" were the same scroll — and
 * the sidebar could not tell you which of the two you were looking at, because
 * both were `overview`.
 *
 * As its own step it gets what every other build screen already had: a place in
 * the sidebar that lights up when you are on it, a position in the Back /
 * Save and continue sequence, and a line in the launch checklist that can point
 * somewhere specific.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE CHARGES COME WITH IT, and that is not an arbitrary pairing.
 *
 * `feeBearer` — who absorbs the platform fee — is the one financial field an
 * organizer controls (BRD §04), and it is edited in the form on the left. The
 * panel on the right is what that choice costs. Splitting them across two
 * screens would mean changing a setting on one page to see its effect on
 * another.
 *
 * Read-only, and that is BRD §05/§06: every rate lives in the admin's field
 * map. This panel says what the rates are, not what they could be.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function Details() {
  const ctx = useEventContext();
  const event = ctx?.event;

  if (!event) return <Loading variant="card" />;

  /**
   * A FINISHED EVENT IS A RECORD, NOT A DRAFT.
   *
   * Cancelled, completed and archived events cannot be edited — the overview
   * showed a read-only "How it was sold" panel instead of this form for
   * exactly that reason, and the rule has to travel with the form rather than
   * stay behind on the screen it left.
   */
  if (['cancelled', 'completed', 'archived'].includes(event.status)) {
    return (
      <Notice title="This event can no longer be edited.">
        <p>
          It is {event.status}, so its details are kept as a record of how it was
          sold. The overview has the figures.
        </p>
      </Notice>
    );
  }

  return (
    <div className="es-split">
      <div className="fx-stack fx-min0">
        <EventDetailsEditor event={event} onSaved={ctx.refresh} />
      </div>
      <div className="fx-stack fx-min0">
        <Panel
          title="What you are charged"
          description="Set by Eventsli, and agreed when the terms were accepted."
        >
          <FeeSummary event={event} />
        </Panel>
      </div>
    </div>
  );
}
