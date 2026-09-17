'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { del, post } from '../../../utils/apiClient';
import { useConfirm } from '../../../components/ui/Confirm';
import { useToast } from '../../../components/ui/Toast';
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
 * One row that scrolls sideways on a phone, rather than wrapping into a pile.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const ARCHIVABLE = ['draft', 'pending_review', 'rejected', 'published', 'completed'];
const CANCELLABLE = ['draft', 'pending_review', 'rejected', 'published', 'suspended', 'archived'];

export default function EventActions({ event, onChanged }) {
  const pathname = usePathname() || '';
  const confirm = useConfirm();
  const toast = useToast();
  const [busy, setBusy] = useState(null);

  const base = `/organizer/events/${event.id}`;
  const ticketed = event.listingType !== 'display_only';
  const archived = event.status === 'archived';
  const pending = event.cancellationRequest?.status === 'pending';
  const onOverview = pathname === base;

  async function run(key, fn) {
    setBusy(key);
    try {
      await fn();
    } catch (err) {
      toast.error(err?.message || 'That did not work. Try again.', { title: 'Not done' });
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

  return (
    <div className="es-actionbar" role="group" aria-label="Event actions">
      {!onOverview && (
        <Link href={base} className="es-btn es-btn--secondary es-btn--sm">
          <NavIcon name="settings" size={16} /> Manage event
        </Link>
      )}
      {onOverview && !archived && !finished && (
        <a href="#details" className="es-btn es-btn--secondary es-btn--sm">
          <NavIcon name="pencil" size={16} /> Manage event
        </a>
      )}

      {ticketed && !archived && !finished && (
        <Link href={`${base}/map`} className="es-btn es-btn--secondary es-btn--sm">
          <NavIcon name="map" size={16} /> Seating map
        </Link>
      )}

      {archived ? (
        <button type="button" className="es-btn es-btn--secondary es-btn--sm" onClick={restore} disabled={Boolean(busy)}>
          <NavIcon name="undo" size={16} /> {busy === 'restore' ? 'Restoring…' : 'Restore'}
        </button>
      ) : ARCHIVABLE.includes(event.status) && (
        <button type="button" className="es-btn es-btn--secondary es-btn--sm" onClick={archive} disabled={Boolean(busy)}>
          <NavIcon name="archive" size={16} /> {busy === 'archive' ? 'Archiving…' : 'Archive'}
        </button>
      )}

      {CANCELLABLE.includes(event.status) && (
        pending ? (
          <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={withdraw} disabled={Boolean(busy)}>
            <NavIcon name="close" size={16} /> {busy === 'withdraw' ? 'Withdrawing…' : 'Withdraw cancellation request'}
          </button>
        ) : (
          <button type="button" className="es-btn es-btn--ghost es-btn--sm text-danger" onClick={requestCancellation} disabled={Boolean(busy)}>
            <NavIcon name="ban" size={16} /> {busy === 'cancel' ? 'Sending…' : 'Request cancellation'}
          </button>
        )
      )}
    </div>
  );
}
