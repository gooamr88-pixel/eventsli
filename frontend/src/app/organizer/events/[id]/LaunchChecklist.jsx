'use client';

import Link from 'next/link';
import { useApi } from '../../../hooks/useApi';
import { useAuth } from '../../../hooks/useAuth';
import { Panel } from '../../../components/ui/Page';
import NavIcon from '../../../components/shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * "What is left before this goes on sale" — for an event that is not on sale.
 *
 * Fancy guides a new event through a wizard. Eventsli deliberately does not (an
 * event is saved the moment it exists; see NewEventForm), so the guidance lives
 * here instead: every step, whether it is done, and one link to where it gets
 * done. Each item is read from real state — the ticket types and seats come
 * from `/events/:id/stats`, payouts from `/auth/me` — never from a flag this
 * page keeps for itself.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function LaunchChecklist({ event }) {
  const { user } = useAuth();
  const { data: stats } = useApi(`/events/${event.id}/stats?days=7`);
  const base = `/organizer/events/${event.id}`;
  const ticketed = event.listingType !== 'display_only';
  const submitted = ['pending_review', 'published'].includes(event.status);

  const items = [
    { key: 'details', label: 'Event details', done: true, href: base, hint: 'Title, date and place' },
    { key: 'cover', label: 'Cover image', done: Boolean(event.cover), href: `${base}#cover`, hint: 'Recommended — it is the share card too', optional: true },
    ...(ticketed ? [
      { key: 'tiers', label: 'Ticket types', done: (stats?.tiers?.length || 0) > 0, href: `${base}/tiers`, hint: 'At least one price' },
      { key: 'map', label: 'Seat map', done: (stats?.seats?.total || 0) > 0, href: `${base}/map`, hint: 'Tables and seats to sell' },
      { key: 'payouts', label: 'Payout account', done: Boolean(user?.canReceivePayouts), href: '/organizer/payouts', hint: 'Needed to sell online' },
    ] : []),
    { key: 'terms', label: 'Organizer terms', done: Boolean(event.review?.termsAccepted), href: `${base}#going-on-sale`, hint: 'Accepted for this event' },
    { key: 'submit', label: 'Submitted for review', done: submitted, href: `${base}#going-on-sale`, hint: 'Eventsli reviews every event' },
  ];

  const required = items.filter((i) => !i.optional);
  const ready = required.filter((i) => i.done).length;

  return (
    <Panel title="Before it goes on sale">
      <div className="fx-stack fx-stack--sm gap-1">
        <p className="es-nums text-sm text-muted">
          <span className="text-ink">{ready}</span> of {required.length} ready
          {stats ? '' : ' · checking…'}
        </p>
        <progress className="es-progress" max={required.length} value={ready} aria-label={`${ready} of ${required.length} steps ready`} />
      </div>

      <ol className="fx-stack fx-stack--sm">
        {items.map((item) => (
          <li key={item.key} className="fx-row fx-row--between border-t border-border-base pt-3 first:border-0 first:pt-0">
            <span className="fx-row fx-min0 flex-1">
              <span className={item.done ? 'text-accent' : 'text-subtle'}>
                <NavIcon name={item.done ? 'check' : 'info'} size={18} />
              </span>
              <span className="fx-min0 flex-1">
                <span className="block text-ink">
                  {item.label}
                  {item.optional && <span className="text-subtle"> · optional</span>}
                </span>
                <span className="block text-sm text-muted">{item.hint}</span>
              </span>
            </span>
            {item.done ? (
              <span className="es-pill es-pill--accent">Done</span>
            ) : (
              <Link href={item.href} className="text-sm text-accent hover:text-accent-hover">Do this</Link>
            )}
          </li>
        ))}
      </ol>
    </Panel>
  );
}
