/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Navigation as data, and the one function that decides what is "current".
 *
 * The shape comes from fancy's `dashboardNavItems.js`, and so do the reasons:
 * a nav written as JSX inside a page existed on one page only, could not know
 * its own active state for routes it did not render, and grew a second
 * hand-maintained copy for the phone's bottom bar. Declared once, the same list
 * renders the sidebar, the drawer and the bar, and resolves its state from the
 * URL — nothing has to remember to keep a variable in sync.
 *
 * An item is `{ key, label, icon, href, exact?, disabled?, hint?, badge? }`.
 * A group is `{ id, label, items, note? }`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

function pathOf(href) {
  return String(href || '').split(/[?#]/)[0];
}

/** Does this item's destination contain the current path? */
export function matches(item, pathname) {
  if (!item?.href || item.disabled) return false;
  const path = pathOf(item.href);
  if (item.exact) return pathname === path;
  return pathname === path || pathname.startsWith(`${path}/`);
}

/**
 * Marks EXACTLY ONE item current: the one with the longest matching href.
 *
 * Without "longest", `/organizer/events/123/tiers` lights "Your events"
 * (prefix `/organizer/events`), "Overview" (prefix `/organizer/events/123`)
 * and "Tickets" all at once — three current pages, which is no current page.
 */
export function resolveNav(groups, pathname = '') {
  let best = null;
  for (const group of groups) {
    for (const item of group.items) {
      if (matches(item, pathname) && (!best || pathOf(item.href).length > pathOf(best.href).length)) {
        best = item;
      }
    }
  }
  return groups.map((group) => ({
    ...group,
    items: group.items.map((item) => ({ ...item, active: item === best })),
  }));
}

export function flattenNav(groups) {
  return groups.flatMap((group) => group.items);
}

/** The bottom bar's destinations, picked from the same list by key — never a second list. */
export function pickTabs(groups, keys) {
  const byKey = new Map(flattenNav(groups).map((item) => [item.key, item]));
  return keys.map((key) => byKey.get(key)).filter(Boolean);
}

/** The label of whatever is current, for the phone's app bar. */
export function currentLabel(groups) {
  return flattenNav(groups).find((item) => item.active)?.label || null;
}
