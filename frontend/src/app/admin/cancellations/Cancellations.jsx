'use client';

import { useState } from 'react';
import Link from 'next/link';
import { post } from '../../utils/apiClient';
import { describeError, messageFor } from '../../utils/errors';
import { formatEventTime } from '../../lib/eventTime';
import { useApi } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../components/ui/Toast';
import { useConfirm } from '../../components/ui/Confirm';
import { PageHeader } from '../../components/ui/Page';
import { Segmented } from '../../components/ui/Filters';
import { Loading, Empty, ErrorNotice, Notice } from '../../components/Feedback';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Organizers asking Eventsli to cancel an event (BRD §17).
 *
 * Every admin can read the queue; a SUPER admin decides, because approving is a
 * cancellation — terminal, it stops sales and closes the gate — made on the
 * organizer's word. The API enforces that; the buttons only follow it.
 *
 * Approving cancels through the same code as the direct cancel on the event
 * page. Rejecting needs a note: the organizer is emailed it and sees it on
 * their event, and a bare "no" only becomes a support ticket.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const STATUSES = [
  { value: 'pending', label: 'Waiting' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'withdrawn', label: 'Withdrawn' },
];

export default function Cancellations() {
  const toast = useToast();
  const confirm = useConfirm();
  const { user } = useAuth();
  const [status, setStatus] = useState('pending');
  const { data, error, loading, reload } = useApi(`/admin/cancellation-requests?status=${status}`);
  const [busyId, setBusyId] = useState(null);
  const canDecide = Boolean(user?.isSuperAdmin);

  async function act(request, what, body) {
    setBusyId(request.id);
    try {
      await post(`/admin/cancellation-requests/${request.id}/${what}`, body, { noRedirect: true });
      toast.success(what === 'approve'
        ? `“${request.event?.title}” is cancelled. The organizer has been emailed.`
        : 'The organizer has been told, with your note.');
      reload();
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    } finally {
      setBusyId(null);
    }
  }

  async function approve(request) {
    const answer = await confirm({
      title: `Cancel “${request.event?.title}”?`,
      body: (
        <>
          <p><strong className="text-ink">This cannot be undone.</strong> Ticket sales stop, open checkouts are closed and the gate is locked.</p>
          <p>Sold tickets stay on record. No refund is issued by Eventsli — refunds are between the organizer and buyers.</p>
        </>
      ),
      reason: { label: 'Note to the organizer (optional)', minLength: 0, maxLength: 2000, hint: 'Emailed to them with the decision.' },
      confirmLabel: 'Approve and cancel event',
      tone: 'danger',
    });
    if (answer) act(request, 'approve', answer.reason ? { note: answer.reason } : {});
  }

  async function reject(request) {
    const answer = await confirm({
      title: 'Reject this cancellation request?',
      body: <p>The event carries on as it is. The organizer is emailed your note and sees it on their event.</p>,
      reason: { label: 'Why not?', minLength: 10, maxLength: 2000, hint: 'Shown to the organizer and kept in the audit log.' },
      confirmLabel: 'Reject request',
    });
    if (answer) act(request, 'reject', { note: answer.reason });
  }

  const requests = Array.isArray(data) ? data : [];

  return (
    <div className="fx-stack">
      <PageHeader
        eyebrow="Events"
        title="Cancellation requests"
        lede="Organizers cannot cancel their own events. They ask here, with a reason, and a super admin decides."
      />

      {!canDecide && (
        <Notice tone="info" title="Only a super admin can decide these.">
          <p>You can read the requests; approving or rejecting needs a super admin.</p>
        </Notice>
      )}

      <Segmented label="Status" value={status} onChange={setStatus} options={STATUSES} />

      {error ? (
        <ErrorNotice error={error} onRetry={reload} />
      ) : loading && !data ? (
        <Loading variant="list" rows={3} label="Loading requests" />
      ) : requests.length === 0 ? (
        <Empty
          title={status === 'pending' ? 'No requests waiting.' : 'Nothing here.'}
          hint={status === 'pending' ? 'When an organizer asks to cancel an event, it appears here.' : null}
        />
      ) : (
        <ul className="fx-stack fx-stack--sm">
          {requests.map((r) => (
            <li key={r.id} className="es-card fx-stack fx-stack--sm p-5">
              <div className="fx-row fx-row--between items-start">
                <div className="fx-min0 flex-1">
                  <p className="fx-break text-lg font-medium text-ink">
                    {r.event ? (
                      <Link href={`/admin/events/${r.event.id}`} className="hover:text-accent">{r.event.title}</Link>
                    ) : 'Deleted event'}
                  </p>
                  <p className="text-sm text-muted">
                    {r.organizer?.name || 'Organizer'}
                    {r.requestedBy?.email && ` · ${r.requestedBy.email}`}
                    {r.event?.startsAt && ` · ${formatEventTime(r.event.startsAt, r.event.timezone)}`}
                  </p>
                </div>
                <span className="es-status" data-tone={{ pending: 'warning', approved: 'danger', rejected: 'neutral', withdrawn: 'muted' }[r.status]}>
                  {STATUSES.find((s) => s.value === r.status)?.label || r.status}
                </span>
              </div>

              <blockquote className="fx-break whitespace-pre-line rounded-(--es-radius-md) bg-bg-sunken px-4 py-3 text-sm text-ink">
                {r.reason}
              </blockquote>
              <p className="text-xs text-subtle">
                Asked {new Date(r.createdAt).toLocaleString()}
                {r.event?.status && ` · event is ${r.event.status.replace('_', ' ')}`}
              </p>

              {r.decisionNote && (
                <p className="fx-break text-sm text-muted"><span className="text-ink">Decision note:</span> {r.decisionNote}</p>
              )}

              {r.status === 'pending' && canDecide && (
                <div className="fx-row">
                  <button type="button" className="es-btn es-btn--danger es-btn--sm" disabled={busyId === r.id} onClick={() => approve(r)}>
                    Approve — cancel event
                  </button>
                  <button type="button" className="es-btn es-btn--secondary es-btn--sm" disabled={busyId === r.id} onClick={() => reject(r)}>
                    Reject
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
