'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { get, post } from '../utils/apiClient';
import { describeError, messageFor } from '../utils/errors';
import { formatEventTime } from '../lib/eventTime';
import { useApi } from '../hooks/useApi';
import { useToast } from '../components/ui/Toast';
import { useConfirm } from '../components/ui/Confirm';
import { PageHeader } from '../components/ui/Page';
import { Pagination } from '../components/ui/Filters';
import DataTable from '../components/ui/DataTable';
import { Loading, ErrorNotice } from '../components/Feedback';
import { Kpi, KpiRow } from '../components/ui/Kpi';
import { StackedEmpty } from '../components/ui/SplitEmpty';
import { ClipboardArt } from '../components/ui/Illustrations';
import NavIcon from '../components/shell/NavIcon';

/**
 * The review queue. BRD §16 — an organizer submits, only an admin publishes.
 *
 * Rejecting REQUIRES a reason of 10–2000 characters (approvalRoutes.js), shown
 * to the organizer on their own event page: a rejection with no explanation is
 * one they cannot act on. The event goes back to `rejected`, which they can
 * resubmit from — not a final decision, and the copy says so.
 *
 * "Review" opens the admin event page, which shows what is about to go on sale —
 * the description, venue, ticket types and seat map. The public page, which the
 * queue used to link to, 404s for anything not yet published.
 */
const REASON = { label: 'What needs changing?', minLength: 10, maxLength: 2000, hint: 'Shown to the organizer and kept in the audit log.' };

/**
 * Approved and sent back in the last 30 days, counted from the AUDIT LOG —
 * every decision here writes `event.approved` / `event.rejected` there, so it
 * is the record, not a second count. `limit=1` and `pagination.total`: only
 * the number crosses the wire.
 *
 * The cut-off is worked out inside the effect: `Date.now()` during render is
 * an impure call the React rules here refuse. `null` while loading; `failed`
 * shows a dash rather than a confident zero.
 */
function useDecisionCounts(version) {
  const [counts, setCounts] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const total = (action) => get(
        `/admin/audit?action=${action}&since=${encodeURIComponent(since)}&limit=1`,
        { cache: 'no-store', raw: true, noRedirect: true },
      ).then((body) => Number(body?.pagination?.total ?? 0));
      try {
        const [approved, rejected] = await Promise.all([total('event.approved'), total('event.rejected')]);
        if (!cancelled) setCounts({ approved, rejected });
      } catch {
        if (!cancelled) setCounts({ failed: true });
      }
    })();
    return () => { cancelled = true; };
  }, [version]);
  return counts;
}

export default function Approvals() {
  const toast = useToast();
  const confirm = useConfirm();
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useApi(`/admin/approvals?limit=25&page=${page}`, { raw: true });
  const [busyId, setBusyId] = useState(null);
  // Bumped after every decision, so the two counts move with the queue.
  const [decided, setDecided] = useState(0);
  const counts = useDecisionCounts(decided);

  async function act(event, what, body) {
    setBusyId(event.id);
    try {
      await post(`/admin/events/${event.id}/${what}`, body, { noRedirect: true });
      toast.success(what === 'approve'
        ? `“${event.title}” is published.`
        : `“${event.title}” went back to the organizer.`);
      reload();
      setDecided((n) => n + 1);
    } catch (err) {
      // The API's own sentence — "This organizer is banned from selling", "no
      // recorded terms acceptance" — not a generic recovery line.
      toast.error(messageFor(err), { title: describeError(err).title });
    } finally {
      setBusyId(null);
    }
  }

  async function approve(event) {
    const payable = event.listingType === 'display_only' || event.organizer?.canReceivePayouts;
    const ok = await confirm({
      title: `Publish “${event.title}”?`,
      body: (
        <>
          <p>It goes on sale straight away, at the prices and fees it was submitted with.</p>
          {!payable && <p>The organizer&rsquo;s payout account is not set up, so buyers will not be able to pay yet.</p>}
        </>
      ),
      confirmLabel: 'Approve and publish',
    });
    if (ok) act(event, 'approve');
  }

  async function reject(event) {
    const answer = await confirm({
      title: `Ask for changes to “${event.title}”?`,
      body: <p>The organizer sees your note on their event, can fix it and submit again.</p>,
      confirmLabel: 'Send it back',
      reason: REASON,
    });
    if (answer) act(event, 'reject', { reason: answer.reason });
  }

  const events = data?.data || [];
  const shown = (n) => (counts === null ? '…' : counts.failed ? '—' : n.toLocaleString());

  return (
    <div className="fx-stack">
      <PageHeader
        eyebrow="Events"
        icon="layers"
        title="Waiting for review"
        lede="Nothing goes on sale until it is approved here. Open an event to see exactly what will be sold."
      />

      <KpiRow label="The review queue at a glance" tiles>
        <Kpi icon="clock" label="Waiting for review" value={data ? (data.pagination?.total ?? events.length).toLocaleString() : '…'} featured />
        <Kpi icon="tick" label="Approved" sub="Last 30 days" value={shown(counts?.approved)} iconTone="success" />
        <Kpi icon="close" label="Rejected" sub="Last 30 days" value={shown(counts?.rejected)} iconTone="danger" />
      </KpiRow>

      {error ? (
        <ErrorNotice error={error} onRetry={reload} />
      ) : loading && !data ? (
        <Loading variant="list" rows={3} label="Loading the queue" />
      ) : events.length === 0 ? (
        /* No "review guide" button: there is no such guide. The way on from
           an empty queue is the list of every event. */
        <StackedEmpty
          art={<ClipboardArt />}
          title="Nothing waiting."
          action={(
            <Link href="/admin/events" className="es-btn es-btn--primary">
              <NavIcon name="calendar" size={18} />
              See all events
            </Link>
          )}
        >
          Submitted events land here. An organizer cannot sell until one is approved.
        </StackedEmpty>
      ) : (
        <>
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
              // In the event's own zone, named — a Toronto show at 8pm is not "tomorrow, 00:00 UTC".
              { key: 'when', label: 'Starts', render: (e) => formatEventTime(e.startsAt, e.timezone) },
              {
                key: 'kind',
                label: 'Kind',
                render: (e) => (
                  <span className="fx-row gap-1">
                    <span className="es-pill">{e.country} · {e.currency}</span>
                    {e.listingType === 'display_only' && <span className="es-pill">Listing only</span>}
                    {/* Drafted with the Smart Event Creator: its description
                        and highlights are AI-written copy the organizer kept. */}
                    {e.aiAssisted && <span className="es-pill es-pill--accent">AI-assisted</span>}
                    {e.listingType !== 'display_only' && !e.organizer?.canReceivePayouts && (
                      <span className="es-pill es-pill--warning">Payouts not set up</span>
                    )}
                  </span>
                ),
              },
              {
                key: 'actions',
                label: 'Actions',
                hideLabel: true,
                align: 'end',
                /**
                 * REVIEW LEADS. It was plain grey text beside a filled blue
                 * Approve, so the strongest thing on every card was "publish
                 * this" and the quietest was "look at it first" — on a phone
                 * the hierarchy steered an admin past the one step that is the
                 * point of a review queue. Approve stays here for the case
                 * where the event has already been read, as a secondary.
                 */
                render: (e) => (
                  <span className="fx-row justify-end">
                    <Link href={`/admin/events/${e.id}`} className="es-btn es-btn--primary es-btn--sm">Review</Link>
                    <button type="button" className="es-btn es-btn--secondary es-btn--sm" disabled={busyId === e.id} onClick={() => reject(e)}>
                      Ask for changes
                    </button>
                    <button type="button" className="es-btn es-btn--secondary es-btn--sm" disabled={busyId === e.id} onClick={() => approve(e)}>
                      {busyId === e.id ? 'Working…' : 'Approve'}
                    </button>
                  </span>
                ),
              },
            ]}
          />
          <Pagination pagination={data.pagination} onPage={setPage} />
        </>
      )}
    </div>
  );
}
