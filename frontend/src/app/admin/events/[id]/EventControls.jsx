'use client';

import { post } from '../../../utils/apiClient';
import { describeError, messageFor } from '../../../utils/errors';
import { formatEventTime } from '../../../lib/eventTime';
import { useAuth } from '../../../hooks/useAuth';
import { useConfirm } from '../../../components/ui/Confirm';
import { useToast } from '../../../components/ui/Toast';
import { Panel } from '../../../components/ui/Page';

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
 * THE SCANNER OVERRIDE (BRD §18) can now be ended early as well as granted; a
 * reopened gate used to stay open for its whole window.
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
  reject: {
    label: 'Ask for changes',
    className: 'es-btn es-btn--secondary',
    from: ['pending_review'],
    confirm: {
      title: 'Send this event back to the organizer?',
      body: <p>They see your reason on their event, fix it, and can submit again.</p>,
      confirmLabel: 'Send it back',
      reason: { label: 'What needs to change?', minLength: 10, maxLength: 2000, hint: 'Shown to the organizer.' },
    },
    done: 'Sent back to the organizer.',
  },
  suspend: {
    label: 'Suspend',
    className: 'es-btn es-btn--secondary',
    from: ['published'],
    confirm: {
      title: 'Suspend this event?',
      body: <p>It comes off sale and out of public view. This is reversible — it is not a cancellation.</p>,
      confirmLabel: 'Suspend',
      reason: { label: 'Why is it being suspended?', minLength: 10, maxLength: 2000 },
    },
    done: 'Suspended.',
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
      reason: { label: 'Why is it being cancelled?', minLength: 10, maxLength: 1000 },
    },
    done: 'Cancelled.',
  },
};

export default function EventControls({ event, gate, overrideUntil, onChanged }) {
  const { user } = useAuth();
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

  async function reopenScanner() {
    const answer = await confirm({
      title: 'Reopen scanning for 12 hours?',
      body: (
        <p>
          For when the doors are open and the lock is wrong or unresolvable right now. It expires on its
          own, and you can end it sooner from here.
        </p>
      ),
      confirmLabel: 'Reopen for 12 hours',
      reason: { label: 'Why is the gate being reopened?', minLength: 5, maxLength: 500 },
    });
    if (!answer) return;
    try {
      await post(`/admin/events/${event.id}/scanner-override`, { hours: 12, reason: answer.reason }, { noRedirect: true });
      toast.success('Scanning is open for the next 12 hours.');
      onChanged();
    } catch (err) {
      fail(err);
    }
  }

  async function endOverride() {
    const answer = await confirm({
      title: 'End the override now?',
      tone: 'danger',
      body: <p>Scanning goes straight back to what the invoices say. If one is still overdue, the gate locks again at once.</p>,
      confirmLabel: 'End the override',
      reason: { label: 'Why is it ending early?', minLength: 5, maxLength: 500 },
    });
    if (!answer) return;
    try {
      await post(`/admin/events/${event.id}/scanner-override/end`, { reason: answer.reason }, { noRedirect: true });
      toast.success('The override has ended.');
      onChanged();
    } catch (err) {
      fail(err);
    }
  }

  const available = Object.entries(ACTIONS).filter(([, a]) => a.from.includes(event.status));
  const locked = gate?.gate?.locked;
  const overrideActive = Boolean(overrideUntil && new Date(overrideUntil) > new Date());
  const finished = ['cancelled', 'completed'].includes(event.status);

  return (
    <Panel title="Status">
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

      <div className="fx-stack fx-stack--sm border-t border-border-base pt-3">
        <p className="text-sm text-ink">
          Scanning:{' '}
          {gate?.gate?.override ? 'open by override' : locked ? `locked (${readableReason(gate.gate.reason)})` : 'open'}
        </p>
        {overrideActive && (
          <p className="text-xs text-subtle">Override until {formatEventTime(overrideUntil, event.timezone)}</p>
        )}
        {gate?.stats && (
          <p className="es-nums text-xs text-subtle">
            {gate.stats.admitted} admitted · {gate.stats.pending} still to arrive · {gate.stats.void} void
          </p>
        )}
        {/* BRD §18 — only a super admin controls the scanner override. */}
        {user?.isSuperAdmin && !finished && (
          <div className="fx-row">
            {locked && !gate?.gate?.override && (
              <button type="button" className="es-btn es-btn--secondary es-btn--sm" onClick={reopenScanner}>
                Reopen scanning for 12 hours
              </button>
            )}
            {overrideActive && (
              <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={endOverride}>
                End the override now
              </button>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}

function readableReason(reason) {
  return {
    commission_overdue: 'commission overdue',
    event_cancelled: 'event cancelled',
  }[reason] || reason || 'locked';
}
