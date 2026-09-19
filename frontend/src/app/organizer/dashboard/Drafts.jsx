'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useApi } from '../../hooks/useApi';
import { del } from '../../utils/apiClient';
import { describeError, messageFor } from '../../utils/errors';
import { formatEventTime } from '../../lib/eventTime';
import { Panel } from '../../components/ui/Page';
import { Loading } from '../../components/Feedback';
import { useConfirm } from '../../components/ui/Confirm';
import { useToast } from '../../components/ui/Toast';
import NavIcon from '../../components/shell/NavIcon';
import { useWizardDraft } from './useWizardDraft';

/** "One event" / "4 events", said once. */
function describeCount(n) {
  return n === 1
    ? 'One event you started and have not sent yet.'
    : `${n} events you started and have not sent yet.`;
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * DRAFTS — the events that were started and never sent.
 *
 * WHY THIS IS ON THE DASHBOARD and not a page of its own. A draft is not an
 * archive; it is unfinished work, and unfinished work belongs where somebody
 * looks when they sit down. Behind its own menu item it is a page nobody opens,
 * which is exactly how a draft two clicks from being sellable stays a draft.
 *
 * EACH ONE SAYS WHAT IT IS WAITING ON. "3 of 6 · next: Ticket types" is the
 * whole point: without it every draft looks equally far from done, so none of
 * them get picked up. The step and its link come from the API, computed from
 * the same rules as the per-event checklist — worked out here instead, the two
 * would eventually disagree, and the one an organizer would believe is whichever
 * they read last.
 *
 * RESUME GOES TO THE MISSING THING, not to the overview. Landing somebody on a
 * summary of their own event and letting them find the gap is asking them to do
 * the work this panel just did.
 *
 * DELETE IS REAL, AND ONLY HERE. A draft has never been listed and never sold,
 * so there is nothing to preserve; everything else on the platform archives.
 * The server checks the status and the sales again, and the database refuses on
 * top of that — see draftController.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function Drafts() {
  const { data, error, loading, reload } = useApi('/events/drafts');
  // The wizard that was opened and left before the event was ever created.
  // It is a draft too, and the only one that has no row to list.
  const started = useWizardDraft();
  const confirm = useConfirm();
  const toast = useToast();
  const [busy, setBusy] = useState(null);

  // A dashboard is not the place to report that one optional panel would not
  // load. Your events still lists every draft, and the error is not actionable
  // here. An empty list hides the panel for the same reason.
  if (error && !started) return null;
  if (loading && !started) return <Loading variant="list" rows={2} label="Loading your drafts" />;
  const saved = data || [];
  if (saved.length === 0 && !started) return null;

  async function remove(draft) {
    const ok = await confirm({
      title: `Delete “${draft.title}”?`,
      tone: 'danger',
      body: (
        <>
          <p>This draft is deleted for good, with everything on it — ticket types, the seating map, photos and policies.</p>
          <p>It has never been public and nothing has sold, so nobody else is affected. There is no undo.</p>
        </>
      ),
      confirmLabel: 'Delete draft',
    });
    if (!ok) return;

    setBusy(draft.id);
    try {
      await del(`/events/${draft.id}`, { noRedirect: true });
      toast.success(`${draft.title} was deleted.`);
      reload();
    } catch (err) {
      // `messageFor`, not `err.message`: on a refusal the server says whether
      // this is an archive-instead case, and on a dropped connection the raw
      // message is "Failed to fetch", which says nothing about the draft.
      toast.error(messageFor(err), { title: describeError(err).title });
      reload();
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel
      title="Drafts"
      description={describeCount(saved.length + (started ? 1 : 0))}
      action={(
        <Link href="/organizer/events?status=draft" className="text-sm text-accent hover:text-accent-hover">
          In Your events
        </Link>
      )}
    >
      <ul className="fx-stack fx-stack--sm">
        {/* First, because it is the one that disappears: a wizard draft
            lives in this tab’s session and is gone when the tab is. */}
        {started && (
          <li className="es-draft">
            <div className="fx-min0 flex-1">
              <p className="fx-truncate font-medium text-ink">{started.title}</p>
              <p className="text-sm text-muted">Not created yet — still in the create-event form.</p>
              <p className="es-draft__reason">
                Kept in this browser tab only. Finish it to save it to your account.
              </p>
            </div>
            <div className="es-draft__actions">
              <Link href="/organizer/events/new" className="es-btn es-btn--secondary es-btn--sm">
                <NavIcon name="arrow" size={16} />
                Continue
              </Link>
            </div>
          </li>
        )}

        {saved.map((draft) => (
          <li key={draft.id} className="es-draft">
            <div className="fx-min0 flex-1">
              <p className="fx-row items-center gap-2">
                <Link
                  href={`/organizer/events/${draft.id}`}
                  className="fx-truncate fx-min0 font-medium text-ink hover:text-accent"
                >
                  {draft.title}
                </Link>
                {draft.status === 'rejected' && (
                  <span className="es-status" data-tone="danger">Sent back</span>
                )}
              </p>

              <p className="text-sm text-muted">
                {formatEventTime(draft.startsAt, draft.timezone, { time: false })}
                {draft.venueName ? ` · ${draft.venueName}` : ' · No venue yet'}
                {draft.city ? `, ${draft.city}` : ''}
              </p>

              {/* The state of this one, in the two facts that decide whether
                  somebody picks it up: how far it got, and what is next. */}
              <p className="es-draft__state">
                <progress
                  className="es-draft__bar"
                  max={draft.total}
                  value={draft.done}
                  aria-label={`${draft.done} of ${draft.total} steps done`}
                />
                <span className="es-nums">{draft.done} of {draft.total}</span>
                {draft.next && <span className="text-subtle">· next: {draft.next.label}</span>}
              </p>

              {draft.status === 'rejected' && draft.rejectionReason && (
                <p className="es-draft__reason">
                  <strong className="text-ink">Eventsli asked for a change:</strong> {draft.rejectionReason}
                </p>
              )}
            </div>

            <div className="es-draft__actions">
              <Link
                href={draft.next?.href || `/organizer/events/${draft.id}`}
                className="es-btn es-btn--secondary es-btn--sm"
              >
                <NavIcon name="arrow" size={16} />
                {draft.next ? 'Continue' : 'Open'}
              </Link>
              <button
                type="button"
                className="es-btn es-btn--ghost es-btn--sm text-danger"
                disabled={busy === draft.id}
                onClick={() => remove(draft)}
              >
                <NavIcon name="trash" size={16} />
                <span className="sr-only">Delete </span>
                {busy === draft.id ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </li>
        ))}
      </ul>

      <p className="text-xs text-subtle">
        A draft is private and costs nothing to keep. Venue, seating and payment are only needed
        when you submit it for review.
      </p>
    </Panel>
  );
}
