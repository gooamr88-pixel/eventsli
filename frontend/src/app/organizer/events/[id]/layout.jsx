'use client';

import Link from 'next/link';
import { usePathname, useParams } from 'next/navigation';

/**
 * Tabs for one event.
 *
 * Only the tabs whose pages exist — a nav is a promise about what is there.
 * Ordered by when an organizer needs them: build it, put it on sale, then run
 * it on the night.
 */
const TABS = [
  ['', 'Overview'],
  ['/tiers', 'Tickets'],
  ['/map', 'Seat map'],
  ['/tables', 'Table categories'],
  ['/promos', 'Discounts'],
  ['/orders', 'Orders'],
  ['/attendees', 'Door list'],
  ['/door', 'Door sales'],
  ['/commission', 'Commission'],
  ['/devices', 'Scanning'],
];

export default function EventLayout({ children }) {
  const pathname = usePathname();
  const { id } = useParams();
  const base = `/organizer/events/${id}`;

  return (
    <div className="fx-stack">
      <nav className="fx-row fx-row--scroll border-b border-border-base" aria-label="Event">
        {/* Not an `.es-tab`: it leaves this nav rather than selecting within
            it, so it must never be able to show the active underline — a
            "back" link that can look selected is a nav that lies about where
            you are. `pr-3` and a hairline separate it from the tab set. */}
        <Link
          href="/organizer"
          className="fx-touch mr-1 whitespace-nowrap border-r border-border-base pr-3 text-sm text-muted hover:text-ink"
        >
          <span aria-hidden>←</span> All events
        </Link>
        {TABS.map(([suffix, label]) => {
          const href = `${base}${suffix}`;
          const active = pathname === href;
          return (
            <Link key={href} href={href} aria-current={active ? 'page' : undefined} className="es-tab">
              {label}
            </Link>
          );
        })}
      </nav>

      {children}
    </div>
  );
}
