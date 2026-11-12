'use client';

import { post } from '../../../utils/apiClient';
import { describeError, messageFor } from '../../../utils/errors';
import { useConfirm } from '../../../components/ui/Confirm';
import { useToast } from '../../../components/ui/Toast';
import { Panel } from '../../../components/ui/Page';
import GateControl from './GateControl';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * What an admin can do to an event's status.
 *
 * The buttons offered follow the same status machine the API enforces
 * (services/eventRules.js), so an admin is never shown an action that can only
 * fail — but the API's refusal is still the authority and is shown when it
 * comes.
 *
 * CANCELLATION IS HERE, AND ONLY HERE. Final Business Rules §17: the organizer
 * cannot cancel an event; cancellation is done by the admin. It is terminal, it
 * requires a reason for the audit log, and it moves no money — §09 makes tickets
 * non-refundable by default and leaves any refund between the organizer and the
 * buyer, so nothing on this screen issues or promises one.
 *
 * THE GATE (BRD §18) has its own control — GateControl.jsx: follow invoices,
 * keep open, or keep closed, optionally until a time.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const ACTIONS = {
  approve: {
    label: 'Approve and publish',
    className: 'es-btn es-btn--primary',
    from: ['pending_review'],
    confirm: {
      title: 'Publish this event?',
      body: <p>It goes on sale on the public site straight away.</p>,
      confirmLabel: 'Approve and publish',
    },
    done: 'Published.',
  },
  /**
   * Events publish first and are reviewed after (owner, 2026-11-03), so
   * "Reject" works on a LIVE event too: it comes off the site until the
   * organizer fixes it, and they are emailed your reason. Tickets already
   * sold stay valid; anyone mid-checkout is stopped.
   */
  reject: {
    label: 'Reject',
    className: 'es-btn es-btn--secondary',
    from: ['pending_review', 'published'],
    confirm: {
      title: 'Reject this event?',
      body: (
        <>
          <p>It comes off the public site (if it is live) and goes back to the organizer to fix. They can publish it again once it is changed.</p>
          <p>The organizer is emailed your reason straight away. Tickets already sold stay valid.</p>
        </>
      ),
      confirmLabel: 'Reject and email the organizer',
      reason: { label: 'What needs to change?', minLength: 10, maxLength: 2000, hint: 'Emailed to the organizer and shown on their event.' },
    },
    done: 'Rejected. The organizer has been emailed your reason.',
  },
  suspend: {
    label: 'Suspend',
    className: 'es-btn es-btn--secondary',
    from: ['published'],
    confirm: {
      title: 'Suspend this event?',
      body: <p>It comes off sale and out of public view. This is reversible — it is not a cancellation.</p>,
      confirmLabel: 'Suspend',
      reason: { label: 'Why is it being suspended?', minLength: 10, maxLength: 2000, hint: 'Emailed to the organizer.' },
    },
    done: 'Suspended. The organizer has been emailed your reason.',
  },
  unsuspend: {
    label: 'Put back on sale',
    className: 'es-btn es-btn--primary',
    from: ['suspended'],
    confirm: {
      title: 'Put this event back on sale?',
      body: <p>It returns to the public site with its tickets as they were.</p>,
      confirmLabel: 'Put back on sale',
    },
    done: 'Back on sale.',
  },
  cancel: {
    label: 'Cancel event',
    className: 'es-btn es-btn--danger',
    from: ['draft', 'pending_review', 'rejected', 'published', 'suspended'],
    confirm: {
      title: 'Cancel this event?',
      tone: 'danger',
      body: (
        <>
          <p>Sales stop and scanning is switched off immediately. This cannot be undone.</p>
          <p>
            Tickets already sold stay on record and buyers can still see them. Cancelling moves no money:
            under the business rules tickets are non-refundable by default, and any refund is between the
            organizer and the buyer.
          </p>
        </>
      ),
      confirmLabel: 'Cancel the event',
      reason: { label: 'Why is it being cancelled?', minLength: 10, maxLength: 1000, hint: 'Emailed to the organizer.' },
    },
    done: 'Cancelled. The organizer has been emailed your reason.',
  },
};

export default function EventControls({ event, gate, onChanged }) {
  const confirm = useConfirm();
  const toast = useToast();

  const fail = (err) => toast.error(messageFor(err), { title: describeError(err).title });

  async function run(key) {
    const action = ACTIONS[key];
    const answer = await confirm(action.confirm);
    if (!answer) return;
    try {
      await post(
        `/admin/events/${event.id}/${key}`,
        action.confirm.reason ? { reason: answer.reason } : undefined,
        { noRedirect: true },
      );
      toast.success(action.done);
      onChanged();
    } catch (err) {
      fail(err);
    }
  }

  const available = Object.entries(ACTIONS).filter(([, a]) => a.from.includes(event.status));

  return (
    <Panel icon="flag" title="Status">
      {available.length === 0 ? (
        <p className="text-sm text-muted">
          {event.status === 'cancelled' ? 'Cancelled events are final.' : 'This event is finished. Nothing more to do.'}
        </p>
      ) : (
        <div className="fx-row">
          {available.map(([key, action]) => (
            <button key={key} type="button" className={action.className} onClick={() => run(key)}>
              {action.label}
            </button>
          ))}
        </div>
      )}

      {/* BRD §18 — the gate: follow invoices, keep open, keep closed. */}
      <GateControl event={event} gate={gate} onChanged={onChanged} />
    </Panel>
  );
}
