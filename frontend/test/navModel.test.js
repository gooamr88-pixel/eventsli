import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { resolveNav, pickTabs, currentLabel, matches } from '../src/app/components/shell/navModel';
import {
  organizerNavGroups, eventIdFromPath, pathForEvent, ORGANIZER_TABS,
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
  test('without an event, event items are disabled WITH a reason', () => {
    const items = organizerNavGroups({ eventId: null }).flatMap((g) => g.items);
    const scoped = items.filter((i) => !['dashboard', 'events', 'payments', 'profile'].includes(i.key));
    expect(scoped.length).toBeGreaterThan(8);
    for (const item of scoped) {
      expect(item.disabled).toBe(true);
      expect(item.href).toBeNull();
      expect(item.hint).toMatch(/choose an event/i);
    }
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
