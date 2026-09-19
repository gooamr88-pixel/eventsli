import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { resolveNav, pickTabs, currentLabel, matches } from '../src/app/components/shell/navModel';
import {
  organizerNavGroups, eventIdFromPath, pathForEvent, ORGANIZER_TABS, organizerTabs,
} from '../src/app/organizer/nav/organizerNav';
import { adminNavGroups, ADMIN_TABS } from '../src/app/admin/nav/adminNav';

/**
 * The sidebar's one job is to say where you are, once. These pin that, and pin
 * that every destination it offers is a page that exists.
 */

const EVENT = '6f1c2a3b-4d5e-4f60-8a1b-2c3d4e5f6a7b';
const OTHER = '0a1b2c3d-4e5f-4a6b-9c8d-7e6f5a4b3c2d';
const activeKeys = (groups) => groups.flatMap((g) => g.items).filter((i) => i.active).map((i) => i.key);

describe('resolveNav', () => {
  const groups = organizerNavGroups({ eventId: EVENT });

  test('exactly one item is current, and it is the most specific', () => {
    const keys = activeKeys(resolveNav(groups, `/organizer/events/${EVENT}/tiers`));
    expect(keys).toEqual(['tiers']);
  });

  test('the event overview is current on its own page only', () => {
    expect(activeKeys(resolveNav(groups, `/organizer/events/${EVENT}`))).toEqual(['overview']);
  });

  test('the dashboard is exact — it does not light up under every organizer page', () => {
    expect(activeKeys(resolveNav(groups, '/organizer'))).toEqual(['dashboard']);
    expect(activeKeys(resolveNav(groups, '/organizer/payments'))).toEqual(['payments']);
  });

  test('a page that is not in the nav falls back to its nearest section', () => {
    expect(activeKeys(resolveNav(groups, '/organizer/events/new'))).toEqual(['events']);
  });

  test('a disabled item is never current', () => {
    const none = organizerNavGroups({ eventId: null });
    const overview = none.flatMap((g) => g.items).find((i) => i.key === 'overview');
    expect(matches(overview, `/organizer/events/${EVENT}`)).toBe(false);
  });

  test('currentLabel names the current page for the phone app bar', () => {
    expect(currentLabel(resolveNav(groups, `/organizer/events/${EVENT}/staff`))).toBe('Door team');
  });
});

describe('organizer destinations', () => {
  test('without an event, no event tools are listed — one note says where they are', () => {
    const groups = organizerNavGroups({ eventId: null });
    const keys = groups.flatMap((g) => g.items).map((i) => i.key);
    expect(keys).toEqual(['dashboard', 'events', 'payments', 'profile']);
    expect(groups.find((g) => g.id === 'event').note).toMatch(/open an event/i);
  });

  test('the bottom bar follows where the organizer is', () => {
    expect(organizerTabs({ eventId: null })).toEqual(ORGANIZER_TABS);
    expect(organizerTabs({ eventId: EVENT, listingType: 'ticketed' })).toContain('orders');
    expect(organizerTabs({ eventId: EVENT, listingType: 'display_only' })).not.toContain('orders');
    for (const listingType of ['ticketed', 'display_only']) {
      const groups = organizerNavGroups({ eventId: EVENT, listingType });
      const keys = organizerTabs({ eventId: EVENT, listingType });
      expect(pickTabs(groups, keys)).toHaveLength(keys.length);
    }
    expect(pickTabs(organizerNavGroups({ eventId: null }), ORGANIZER_TABS)).toHaveLength(ORGANIZER_TABS.length);
  });

  test('every destination is a page that exists on disk', () => {
    const app = path.resolve(__dirname, '../src/app');
    const items = organizerNavGroups({ eventId: EVENT }).flatMap((g) => g.items)
      .concat(adminNavGroups().flatMap((g) => g.items));
    for (const item of items) {
      const route = item.href.replace(EVENT, '[id]');
      const page = path.join(app, route, 'page.jsx');
      expect(fs.existsSync(page), `${item.key} → ${route} has no page`).toBe(true);
    }
  });

  test('a display-only event shows no selling screens — only its overview and sharing', () => {
    const groups = organizerNavGroups({ eventId: EVENT, listingType: 'display_only' });
    const keys = groups.flatMap((g) => g.items).map((i) => i.key);
    expect(keys).toEqual(expect.arrayContaining(['dashboard', 'events', 'overview', 'share', 'payments', 'profile']));
    for (const selling of ['tiers', 'map', 'tables', 'promos', 'orders', 'door', 'commission', 'attendees', 'staff', 'devices']) {
      expect(keys, `${selling} must not show for a listing`).not.toContain(selling);
    }
    // No empty group headings left behind.
    expect(groups.every((g) => g.items.length > 0)).toBe(true);
  });

  test('a ticketed event keeps every screen', () => {
    const all = organizerNavGroups({ eventId: EVENT }).flatMap((g) => g.items).length;
    expect(organizerNavGroups({ eventId: EVENT, listingType: 'ticketed' }).flatMap((g) => g.items)).toHaveLength(all);
  });

  /**
   * GENERAL ADMISSION — the whole point of which is that there is no room to
   * draw. Leaving the seat map in the sidebar for an event that has none is how
   * an organizer running a conference ends up building a fictional floor plan
   * because the product implied they had to.
   */
  test('general admission hides the seat map and the table categories', () => {
    const groups = organizerNavGroups({
      eventId: EVENT, listingType: 'ticketed', admissionType: 'general',
    });
    const keys = groups.flatMap((g) => g.items).map((i) => i.key);

    expect(keys).not.toContain('map');
    expect(keys).not.toContain('tables');
    // Everything that is not about a floor plan stays.
    expect(keys).toEqual(expect.arrayContaining([
      'overview', 'content', 'tiers', 'promos', 'share', 'orders', 'attendees',
    ]));
    expect(groups.every((g) => g.items.length > 0)).toBe(true);
  });

  test('reserved seating keeps the seat map', () => {
    for (const admissionType of ['reserved', null, undefined]) {
      const keys = organizerNavGroups({ eventId: EVENT, listingType: 'ticketed', admissionType })
        .flatMap((g) => g.items).map((i) => i.key);
      expect(keys, String(admissionType)).toContain('map');
      expect(keys, String(admissionType)).toContain('tables');
    }
  });

  test('a display-only event hides the map whatever its admission type says', () => {
    // A listing sells nothing, so it is the stronger claim and is checked
    // first. An event left as `admissionType: 'reserved'` and switched to a
    // listing must not get its seat map back.
    const keys = organizerNavGroups({
      eventId: EVENT, listingType: 'display_only', admissionType: 'reserved',
    }).flatMap((g) => g.items).map((i) => i.key);

    expect(keys).not.toContain('map');
    expect(keys).not.toContain('tiers');
  });

  test('the bottom bars only name keys that exist', () => {
    expect(pickTabs(organizerNavGroups({ eventId: EVENT }), ORGANIZER_TABS)).toHaveLength(ORGANIZER_TABS.length);
    expect(pickTabs(adminNavGroups(), ADMIN_TABS)).toHaveLength(ADMIN_TABS.length);
  });
});

describe('the event in the path', () => {
  test('only a real id is an event — "new" is not', () => {
    expect(eventIdFromPath(`/organizer/events/${EVENT}/orders`)).toBe(EVENT);
    expect(eventIdFromPath('/organizer/events/new')).toBeNull();
    expect(eventIdFromPath('/organizer')).toBeNull();
  });

  test('switching events keeps the section', () => {
    expect(pathForEvent(`/organizer/events/${EVENT}/orders`, OTHER)).toBe(`/organizer/events/${OTHER}/orders`);
  });

  test('switching from an account page opens the event', () => {
    expect(pathForEvent('/organizer/payouts', OTHER)).toBe(`/organizer/events/${OTHER}`);
  });
});

describe('admin destinations', () => {
  test('/admin is the approval queue, and only /admin', () => {
    expect(activeKeys(resolveNav(adminNavGroups(), '/admin'))).toEqual(['approvals']);
    expect(activeKeys(resolveNav(adminNavGroups(), `/admin/events/${EVENT}`))).toEqual(['events']);
  });
});

/**
 * THE BUILD SEQUENCE IS A CONTRACT, not a layout detail.
 *
 * Three things read it and must agree: the sidebar, the scrolling section strip
 * under the event header, and the Back/Next bar at the foot of each build
 * screen. They disagreed — the sidebar put the one optional screen second, the
 * launch checklist asked for the required ones first, and Back/Next walked on
 * past the end of the build into Orders, Commission and the door team under a
 * bar announced as "Event setup steps".
 */
describe('the build sequence', () => {
  const buildKeys = (options) => organizerNavGroups({ eventId: EVENT, ...options })
    .filter((g) => g.id === 'build')
    .flatMap((g) => g.items)
    .map((i) => i.key);

  test('required screens come before the optional ones, in dependency order', () => {
    expect(buildKeys()).toEqual([
      'overview', 'tiers', 'map', 'tables', 'content', 'promos',
    ]);
  });

  test('general admission drops the two map screens and keeps the rest in order', () => {
    expect(buildKeys({ listingType: 'ticketed', admissionType: 'general' }))
      .toEqual(['overview', 'tiers', 'content', 'promos']);
  });

  test('selling and on-the-day screens are not part of it', () => {
    for (const key of ['share', 'orders', 'door', 'commission', 'attendees', 'staff', 'devices']) {
      expect(buildKeys(), key).not.toContain(key);
    }
  });

  test('every build screen has an href once an event is open', () => {
    const items = organizerNavGroups({ eventId: EVENT })
      .filter((g) => g.id === 'build')
      .flatMap((g) => g.items);
    for (const item of items) {
      expect(item.href, item.key).toMatch(new RegExp(`^/organizer/events/${EVENT}`));
      expect(item.disabled, item.key).toBe(false);
    }
  });
});
