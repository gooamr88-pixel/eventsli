'use client';

import { useState } from 'react';
import Link from 'next/link';
import { del, post } from '../../../utils/apiClient';
import { describeError, messageFor } from '../../../utils/errors';
import { useConfirm } from '../../../components/ui/Confirm';
import { useToast } from '../../../components/ui/Toast';
import MoreActions, { MoreItem, MoreDivider } from '../../../components/ui/MoreActions';
import NavIcon from '../../../components/shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * What an organizer can do to an event, beside its title.
 *
 *   Manage            the details and the go-live steps (the overview)
 *   Seating map       ticketed events only
 *   Archive / Restore stop sales and file it away — or bring it back
 *   Request cancellation   a reason, sent to Eventsli, who decide (BRD §17)
 *
 * Every action that changes something asks first, in words that say what
 * happens to buyers — that is the part an organizer is actually worried about.
 * Shown on the event's overview only.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE ROW, NOT SIX EQUAL BUTTONS — rearranged by the mobile pass.
 *
 * Every action was the same outlined button, and below 40rem each took a
 * full-width row: on a phone the overview opened on Public page, Share, Edit
 * details, Seating map and Archive stacked one under another, then a red
 * Request cancellation, before any of the event's numbers — and on a draft,
 * before the "Next step" card that is the one thing to do. Archive, which stops
 * sales, looked exactly like Edit.
 *
 * Now the event header carries one row: Edit details, the header's own Public
 * page and Share (passed in as `children`), and "More". Seating map, Archive and
 * the cancellation request are in More, the destructive ones last and in the
 * danger colour. An ARCHIVED event keeps Restore in the row, because bringing it
 * back is the thing its owner came to do.
 *
 * Seating map is offered only where there is one. A general-admission event has
 * no map and the sidebar hides that screen; this button used to lead to it
 * anyway.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const ARCHIVABLE = ['draft', 'pending_review', 'rejected', 'published', 'completed'];
// Cancelling is for an event people may already have bought or seen. A draft
// or a rejected event is private — archiving it is the whole answer, and a
// "request cancellation" button there only invites a pointless review.
const CANCELLABLE = ['pending_review', 'published', 'suspended'];

export default function EventActions({ event, onChanged, children }) {
  const confirm = useConfirm();
  const toast = useToast();
  const [busy, setBusy] = useState(null);

  const base = `/organizer/events/${event.id}`;
  const ticketed = event.listingType !== 'display_only';
  const archived = event.status === 'archived';
  const pending = event.cancellationRequest?.status === 'pending';

  async function run(key, fn) {
    setBusy(key);
    try {
      await fn();
    } catch (err) {
      // `messageFor`, not `err.message`: on a dropped connection the raw
      // message is "Failed to fetch" (or the bare code), which tells an
      // organizer nothing about whether their event was archived. The mapped
      // recovery says what to do, and keeps the server's specific sentence
      // wherever there is one. Every other action screen already does this.
      toast.error(messageFor(err), { title: describeError(err).title });
      onChanged?.();
    } finally {
      setBusy(null);
    }
  }

  async function archive() {
    const live = event.status === 'published';
    const ok = await confirm({
      title: 'Archive this event?',
      body: (
        <>
          {live
            ? <p><strong className="text-ink">Ticket sales stop right away</strong> and the event leaves the Eventsli website.</p>
            : <p>It moves out of your main list.</p>}
          {live && <p>Tickets already sold stay valid and still scan at the door. Nobody is refunded or told it is cancelled.</p>}
          <p>You find it under <strong className="text-ink">Archived</strong> in Your events, and can restore it any time.</p>
        </>
      ),
      confirmLabel: live ? 'Stop sales and archive' : 'Archive',
      tone: live ? 'danger' : 'default',
    });
    if (!ok) return;
    await run('archive', async () => {
      const updated = await post(`/events/${event.id}/archive`, undefined, { noRedirect: true });
      toast.success(live ? 'Ticket sales have stopped.' : 'Moved to Archived.', { title: 'Event archived' });
      onChanged?.({ ...event, ...updated });
    });
  }

  async function restore() {
    const backOnSale = event.archivedFrom === 'published' && new Date(event.endsAt) > new Date();
    const ok = await confirm({
      title: 'Restore this event?',
      body: backOnSale
        ? <p>It goes <strong className="text-ink">back on sale</strong> straight away, exactly as it was.</p>
        : event.archivedFrom === 'pending_review'
          ? <p>It comes back as a draft. Submit it for review again when it is ready.</p>
          : <p>It comes back to Your events as it was.</p>,
      confirmLabel: backOnSale ? 'Restore and resume sales' : 'Restore',
    });
    if (!ok) return;
    await run('restore', async () => {
      const updated = await post(`/events/${event.id}/restore`, undefined, { noRedirect: true });
      toast.success(backOnSale ? 'It is on sale again.' : 'The event is back.', { title: 'Restored' });
      onChanged?.({ ...event, ...updated });
    });
  }

  async function requestCancellation() {
    const answer = await confirm({
      title: 'Request cancellation',
      body: (
        <>
          <p>Eventsli reviews every cancellation. Tell us why, and we will email you the decision.</p>
          <p>Until it is approved the event stays as it is. If you only want to stop selling, archive it instead.</p>
        </>
      ),
      reason: {
        label: 'Reason for cancelling *',
        minLength: 10,
        maxLength: 2000,
        hint: 'e.g. The venue closed and we could not find another date. Eventsli reads this.',
      },
      confirmLabel: 'Send request',
      tone: 'danger',
    });
    if (!answer) return;
    await run('cancel', async () => {
      await post(`/events/${event.id}/cancellation-request`, { reason: answer.reason }, { noRedirect: true });
      toast.success('Eventsli will review it and email you the decision.', { title: 'Cancellation requested' });
      onChanged?.();
    });
  }

  async function withdraw() {
    const ok = await confirm({
      title: 'Withdraw your cancellation request?',
      body: <p>The event carries on as normal and Eventsli stops reviewing the request.</p>,
      confirmLabel: 'Withdraw request',
    });
    if (!ok) return;
    await run('withdraw', async () => {
      await del(`/events/${event.id}/cancellation-request`, { noRedirect: true });
      toast.success('Your request was withdrawn.');
      onChanged?.();
    });
  }

  const finished = ['cancelled'].includes(event.status);
  const canRequest = CANCELLABLE.includes(event.status)
    || (event.status === 'archived' && event.archivedFrom === 'published');
  const hasMap = ticketed && event.admissionType !== 'general';
  const live = event.status === 'published';

  const showMap = hasMap && !archived && !finished;
  const showArchive = !archived && ARCHIVABLE.includes(event.status);
  const anyMore = showMap || showArchive || canRequest;

  // Said on the button while a request is in flight, because the panel that
  // started it has closed by then and the toast only arrives at the end.
  const working = {
    archive: 'Archiving…', restore: 'Restoring…', cancel: 'Sending…', withdraw: 'Withdrawing…',
  }[busy];

  return (
    <>
      {/* A route, not an anchor: the details form left the overview for its own
          build step, so `#details` scrolled to nothing. "Edit details" rather
          than "Manage event" — it goes to one screen now, and the vaguer word
          suggested it opened all of them. */}
      {!archived && !finished && (
        <Link href={`${base}/details`} className="es-btn es-btn--secondary es-btn--sm">
          <NavIcon name="pencil" size={16} /> Edit details
        </Link>
      )}

      {archived && (
        <button type="button" className="es-btn es-btn--secondary es-btn--sm" onClick={restore} disabled={Boolean(busy)}>
          <NavIcon name="undo" size={16} /> {busy === 'restore' ? 'Restoring…' : 'Restore'}
        </button>
      )}

      {children}

      {anyMore && (
        <MoreActions label={working || 'More'} srLabel="More actions for this event">
          {showMap && <MoreItem href={`${base}/map`} icon="map">Seating map</MoreItem>}
          {showArchive && (
            <>
              {showMap && <MoreDivider />}
              <MoreItem onClick={archive} icon="archive" tone={live ? 'danger' : undefined} disabled={Boolean(busy)}>
                {live ? 'Stop sales and archive' : 'Archive'}
              </MoreItem>
            </>
          )}
          {canRequest && (
            pending ? (
              <MoreItem onClick={withdraw} icon="close" disabled={Boolean(busy)}>
                Withdraw cancellation request
              </MoreItem>
            ) : (
              <MoreItem onClick={requestCancellation} icon="ban" tone="danger" disabled={Boolean(busy)}>
                Request cancellation
              </MoreItem>
            )
          )}
        </MoreActions>
      )}
    </>
  );
}
