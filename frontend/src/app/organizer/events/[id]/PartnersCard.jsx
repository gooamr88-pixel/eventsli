'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { put, del } from '../../../utils/apiClient';
import { describeError, messageFor } from '../../../utils/errors';
import { useToast } from '../../../components/ui/Toast';
import { useConfirm } from '../../../components/ui/Confirm';
import { Panel } from '../../../components/ui/Page';
import NavIcon from '../../../components/shell/NavIcon';
import { useOrganizerEvents } from '../../nav/OrganizerEvents';
import { useEventContext } from './EventContext';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * "WILL THIS EVENT HAVE SPONSORS? VENDORS?" (owner, 2026-11-23)
 *
 * Sponsors and Vendors were in every event's sidebar, and most events — a
 * wedding, a concert — have neither. Now the overview asks, and only a yes
 * puts them in the sidebar (organizerNav.js, `partners`). The switch is
 * `PUT / DELETE /events/:id/partners/:kind` (backend services/partnerSwitches.js).
 *
 * Saying yes goes straight to the screen, which opens on its own short setup.
 * Saying no again is allowed until the first deal or application exists.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const PARTNER_KINDS = {
  sponsors: {
    label: 'Sponsors',
    icon: 'handshake',
    pitch: 'Sell sponsorship packages to brands. Paid sponsors show on your event page by themselves.',
    offLabel: 'Turn off sponsors',
  },
  vendors: {
    label: 'Vendors',
    icon: 'store',
    pitch: 'Rent booths or stalls to businesses — food, merch, art — and take their applications.',
    offLabel: 'Turn off vendors',
  },
};

/** Turns one kind on or off, then refreshes the event and the sidebar. */
export function usePartnerSwitch(eventId) {
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const ctx = useEventContext();
  const { reload } = useOrganizerEvents();
  const [busy, setBusy] = useState(null);

  async function turnOn(kind, { go = true } = {}) {
    setBusy(kind);
    try {
      await put(`/events/${eventId}/partners/${kind}`, {}, { noRedirect: true });
      ctx?.refresh?.();
      reload?.();
      if (go) router.push(`/organizer/events/${eventId}/${kind}`);
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    } finally {
      setBusy(null);
    }
  }

  async function turnOff(kind) {
    const label = PARTNER_KINDS[kind].label.toLowerCase();
    const ok = await confirm({
      title: `Turn off ${label}?`,
      body: `${PARTNER_KINDS[kind].label} leaves this event's menu and its public page closes. Anything you set up is kept and comes back if you turn it on again.`,
      confirmLabel: 'Turn off',
    });
    if (!ok) return;
    setBusy(kind);
    try {
      await del(`/events/${eventId}/partners/${kind}`, { noRedirect: true });
      ctx?.refresh?.();
      reload?.();
      toast.success(`${PARTNER_KINDS[kind].label} turned off.`);
      router.push(`/organizer/events/${eventId}`);
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    } finally {
      setBusy(null);
    }
  }

  return { turnOn, turnOff, busy };
}

export default function PartnersCard({ event }) {
  const { turnOn, busy } = usePartnerSwitch(event.id);
  const on = event.partners || {};
  return (
    <Panel
      icon="handshake"
      iconTile
      title="Sponsors & vendors"
      description="Optional. Turn on only what this event needs — each one adds its own screen to your menu."
    >
      <ul className="es-partners">
        {Object.entries(PARTNER_KINDS).map(([kind, k]) => (
          <li key={kind} className="es-partners__row">
            <span className="es-partners__icon" aria-hidden="true"><NavIcon name={k.icon} size={22} /></span>
            <span className="fx-min0">
              <span className="es-partners__name">
                {k.label}
                {on[kind] && <span className="es-pill es-pill--accent">On</span>}
              </span>
              <span className="es-partners__pitch">{k.pitch}</span>
            </span>
            {on[kind] ? (
              <Link href={`/organizer/events/${event.id}/${kind}`} className="es-btn es-btn--secondary es-btn--sm">
                Open<NavIcon name="arrow" size={16} />
              </Link>
            ) : (
              <button
                type="button"
                className="es-btn es-btn--secondary es-btn--sm"
                disabled={busy === kind}
                aria-busy={busy === kind || undefined}
                onClick={() => turnOn(kind)}
              >
                <NavIcon name="plus" size={16} />{busy === kind ? 'Turning on…' : `Add ${k.label.toLowerCase()}`}
              </button>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
