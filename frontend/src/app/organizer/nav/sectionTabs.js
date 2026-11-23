/**
 * ─────────────────────────────────────────────────────────────────────────────
 * SCREENS THAT LIVE INSIDE ANOTHER ONE (owner, 2026-11-23).
 *
 * The sidebar lost ten rows by putting screens where they belong instead of
 * one row each: Table categories beside the ticket types they price, Offline
 * payments and Commission beside the orders they come from, Scanning devices
 * beside the door team that uses them. Each family is a row in the sidebar
 * (`also` in organizerNav.js) and a strip of tabs at the top of its pages,
 * drawn once by the event layout from this table.
 *
 * Routes did not move, so every old link and bookmark still lands.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const FAMILIES = [
  {
    id: 'tickets',
    label: 'Ticket sections',
    tabs: [
      { key: 'tiers', label: 'Ticket types', suffix: '/tiers' },
      // Only a reserved-seating event sells tables.
      { key: 'tables', label: 'Table categories', suffix: '/tables', when: (e) => e.admissionType !== 'general' },
    ],
  },
  {
    id: 'orders',
    label: 'Order sections',
    tabs: [
      { key: 'orders', label: 'Orders', suffix: '/orders' },
      { key: 'offline', label: 'Offline payments', suffix: '/offline' },
      { key: 'commission', label: 'Commission', suffix: '/commission' },
    ],
  },
  {
    id: 'door',
    label: 'Door team sections',
    tabs: [
      { key: 'staff', label: 'Door team', suffix: '/staff' },
      { key: 'devices', label: 'Scanning devices', suffix: '/devices' },
    ],
  },
];

/**
 * The tab strip for this path, or null. `event` is the loaded event (null
 * while loading: every tab is shown rather than none, so nothing jumps).
 */
export function sectionTabsFor(pathname, eventId, event = null) {
  if (!eventId) return null;
  const base = `/organizer/events/${eventId}`;
  const path = String(pathname || '');
  const under = (suffix) => path === `${base}${suffix}` || path.startsWith(`${base}${suffix}/`);
  for (const family of FAMILIES) {
    const here = family.tabs.find((t) => under(t.suffix));
    if (!here) continue;
    const tabs = family.tabs
      .filter((t) => !t.when || !event || t.when(event))
      .map((t) => ({ key: t.key, label: t.label, href: `${base}${t.suffix}`, current: t.key === here.key }));
    if (tabs.length < 2) return null;
    return { id: family.id, label: family.label, tabs };
  }
  return null;
}
