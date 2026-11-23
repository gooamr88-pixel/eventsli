'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { sectionTabsFor } from '../../nav/sectionTabs';

/**
 * Tabs across the top of a screen that shares one sidebar row with others —
 * Ticket types / Table categories, Orders / Offline payments / Commission,
 * Door team / Scanning devices. The table is in nav/sectionTabs.js.
 */
export default function SectionTabs({ eventId, event }) {
  const pathname = usePathname() || '';
  const family = sectionTabsFor(pathname, eventId, event);
  if (!family) return null;
  return (
    <nav aria-label={family.label} className="es-segmented">
      {family.tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className="es-segmented__option"
          aria-current={tab.current ? 'page' : undefined}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
