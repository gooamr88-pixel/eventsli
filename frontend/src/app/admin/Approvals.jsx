'use client';

import { useState } from 'react';
import Link from 'next/link';
import { post } from '../utils/apiClient';
import { describeError } from '../utils/errors';
import { useApi } from '../hooks/useApi';
import { useToast } from '../components/ui/Toast';
import { useConfirm } from '../components/ui/Confirm';
import { PageHeader } from '../components/ui/Page';
import DataTable from '../components/ui/DataTable';
import { Loading, Empty, ErrorNotice } from '../components/Feedback';

/**
 * The review queue. BRD §16 — an organizer submits, only an admin publishes.
 *
 * Rejecting REQUIRES a reason, and that is not a form nicety: the reason is
 * shown to the organizer on their own event page, and a rejection with no
 * explanation is one they cannot act on. The event goes back to `rejected`,
 * which is a state they can resubmit from — it is not a final decision, and the
 * copy here says so.
 */
export default function Approvals() {
  const toast = useToast();
  const confirm = useConfirm();
  const { data, error, loading, reload } = useApi('/admin/approvals?limit=50');
  const [busyId, setBusyId] = useState(null);

  async function act(event, what, body) {
    setBusyId(event.id);
    try {
      await post(`/admin/events/${event.id}/${what}`, body, { noRedirect: true });
      toast.success(what === 'approve'
        ? `“${event.title}” is published.`
        : `“${event.title}” went back to the organizer.`);
      reload();
    } catch (err) {
      const { title, recovery } = describeError(err);
      toast.error(recovery, { title });
    } finally {
      setBusyId(null);
    }
  }

  async function approve(event) {
    const ok = await confirm({
      title: `Publish “${event.title}”?`,
      body: <p>It goes on sale straight away, at the prices and fees it was submitted with.</p>,
      confirmLabel: 'Approve and publish',
    });
    if (ok) act(event, 'approve');
  }

  async function reject(event) {
    const answer = await confirm({
      title: `Ask for changes to “${event.title}”?`,
      body: <p>The organizer sees your note on their event, can fix it and submit again.</p>,
      confirmLabel: 'Send it back',
      reason: { label: 'What needs changing?', minLength: 3, hint: 'Shown to the organizer and kept in the audit log.' },
    });
    if (answer) act(event, 'reject', { reason: answer.reason });
  }

  const events = Array.isArray(data) ? data : [];

  return (
    <div className="fx-stack">
      <PageHeader
        eyebrow="Console"
        title="Waiting for review"
        lede="Nothing goes on sale until it is approved here."
        actions={<Link href="/admin/events" className="es-btn es-btn--secondary">Every event</Link>}
      />

      {error ? (
        <ErrorNotice error={error} />
      ) : loading && !data ? (
        <Loading variant="list" rows={3} label="Loading the queue" />
      ) : events.length === 0 ? (
        <Empty title="Nothing waiting." hint="Submitted events land here. An organizer cannot sell until one is approved." />
      ) : (
        <DataTable
          caption="Events waiting for review"
          rows={events}
          columns={[
            {
              key: 'event',
              label: 'Event',
              primary: true,
              render: (e) => (
                <span className="fx-stack fx-stack--sm gap-0.5">
                  <Link href={`/admin/events/${e.id}`} className="fx-break text-ink hover:text-accent">{e.title}</Link>
                  <span className="text-sm text-muted">{e.organizer?.name || 'Unknown organizer'}</span>
                </span>
              ),
            },
            {
              key: 'when',
              label: 'Starts',
              render: (e) => new Intl.DateTimeFormat('en-US', {
                dateStyle: 'medium', timeStyle: 'short', timeZone: e.timezone || 'UTC',
              }).format(new Date(e.startsAt)),
            },
            {
              key: 'kind',
              label: 'Kind',
              render: (e) => (
                <span className="fx-row gap-1">
                  <span className="es-pill">{e.country} · {e.currency}</span>
                  {e.listingType === 'display_only' && <span className="es-pill">Listing only</span>}
                  {e.listingType !== 'display_only' && !e.canReceivePayouts && <span className="es-pill es-pill--warning">Payouts not ready</span>}
                </span>
              ),
            },
            {
              key: 'actions',
              label: 'Actions',
              hideLabel: true,
              align: 'end',
              render: (e) => (
                <span className="fx-row justify-end">
                  <Link href={`/e/${e.slug}`} target="_blank" rel="noreferrer" className="es-btn es-btn--ghost es-btn--sm">Preview</Link>
                  <button type="button" className="es-btn es-btn--secondary es-btn--sm" disabled={busyId === e.id} onClick={() => reject(e)}>
                    Ask for changes
                  </button>
                  <button type="button" className="es-btn es-btn--primary es-btn--sm" disabled={busyId === e.id} onClick={() => approve(e)}>
                    {busyId === e.id ? 'Working…' : 'Approve'}
                  </button>
                </span>
              ),
            },
          ]}
        />
      )}
    </div>
  );
}
