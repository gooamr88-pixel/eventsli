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
        <Link href="/organizer" className="whitespace-nowrap pb-2 pr-2 text-sm text-muted hover:text-ink">
          ← All events
        </Link>
        {TABS.map(([suffix, label]) => {
          const href = `${base}${suffix}`;
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={`whitespace-nowrap border-b-2 px-1 pb-2 text-sm transition-colors ${
                active ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink'
              }`}
            >
              {label}
            </Link>
          );
        })}
      </nav>

      {children}
    </div>
  );
}
