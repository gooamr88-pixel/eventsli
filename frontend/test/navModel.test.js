import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { resolveNav, pickTabs, currentLabel, matches } from '../src/app/components/shell/navModel';
import {
  organizerNavGroups, eventIdFromPath, pathForEvent, ORGANIZER_TABS, organizerTabs,
} from '../src/app/organizer/nav/organizerNav';
import { sectionTabsFor } from '../src/app/organizer/nav/sectionTabs';
import { setupSteps } from '../src/app/organizer/nav/organizerNav';
import { adminNavGroups, ADMIN_TABS } from '../src/app/admin/nav/adminNav';
import { accountNavGroups, ACCOUNT_TABS } from '../src/app/account/nav/accountNav';

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
    // 'sms': the organizer's text campaigns (organizer/sms), an account-level destination.
    // 'templates': event templates (organizer/templates, 2026-11-19), account-level too.
    expect(keys).toEqual(['dashboard', 'events', 'templates', 'payments', 'sms', 'profile']);
    expect(groups.find((g) => g.id === 'event').note).toMatch(/open an event/i);
  });

  /**
   * "Create event" lives in `EventBar` and nowhere else.
   *
   * The sidebar carried a second copy, added when the bar's button was
   * icon-only below 40rem and kept after that was fixed in the CSS — so the
   * verb appeared twice on one screen, same words, same route. This is the
   * guard, because the duplicate is easy to re-add and reads as helpful.
   */
  test('the sidebar does not offer Create event — the event bar does', () => {
    for (const options of [{ eventId: null }, { eventId: EVENT }, { eventId: EVENT, listingType: 'ticketed' }]) {
      const items = organizerNavGroups(options).flatMap((g) => g.items);
      expect(items.map((i) => i.key), JSON.stringify(options)).not.toContain('create');
      expect(
        items.filter((i) => i.href === '/organizer/events/new'),
        `${JSON.stringify(options)} routes to the create form from the sidebar`,
      ).toHaveLength(0);
    }
  });

  /**
   * ───────────────────────────────────────────────────────────────────────────
   * "CREATE EVENT" BELONGS WHERE YOU SEE ALL YOUR EVENTS, AND NOWHERE ELSE.
   *
   * It has now been in four places across three passes: the sidebar head, the
   * sidebar list, the event bar, and the two pages that should have had it all
   * along. The event bar was the worst of them, because that bar appears above
   * every one of an event's eleven sections — so "start a new event" rode along
   * on the seat map, the door list and the orders table of an event already
   * running.
   *
   * Source-level, because these are JSX and the rule is about WHERE a control
   * is rendered, which no data structure records.
   * ───────────────────────────────────────────────────────────────────────────
   */
  describe('where Create event is offered', () => {
    const NEW = '/organizer/events/new';
    const read = (rel) => fs.readFileSync(path.resolve(__dirname, '../src/app', rel), 'utf8');

    test('the event switcher that sits above every section does not offer it', () => {
      expect(read('organizer/nav/EventBar.jsx')).not.toContain(NEW);
    });

    test('no screen belonging to a single event offers it', () => {
      const dir = path.resolve(__dirname, '../src/app/organizer/events/[id]');
      const walk = (at, out = []) => {
        for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
          const full = path.join(at, entry.name);
          if (entry.isDirectory()) walk(full, out);
          else if (/\.jsx?$/.test(entry.name)) out.push(full);
        }
        return out;
      };
      const offenders = walk(dir)
        .filter((file) => fs.readFileSync(file, 'utf8').includes(`"${NEW}"`))
        .map((file) => path.relative(dir, file));

      expect(offenders, `these are inside one event and must not start another:\n  ${offenders.join('\n  ')}`)
        .toEqual([]);
    });

    test('the dashboard and Your events both do', () => {
      // The dashboard's lives in its greeting, beside the hero card.
      expect(read('organizer/dashboard/Dashboard.jsx')).toContain('<DashboardHero');
      expect(read('organizer/dashboard/DashboardHero.jsx')).toContain(NEW);
      expect(read('organizer/events/EventsBrowser.jsx')).toContain(NEW);
    });
  });

  test('no two destinations point at the same page', () => {
    // The general form of the bug above: one route reachable from two rows is
    // two controls competing to be the current one.
    for (const options of [{ eventId: null }, { eventId: EVENT }]) {
      const hrefs = organizerNavGroups(options).flatMap((g) => g.items)
        .filter((i) => !i.disabled).map((i) => i.href);
      expect(new Set(hrefs).size, JSON.stringify(options)).toBe(hrefs.length);
    }
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

  test('before launch the bar offers setup, not an empty Orders and Door list', () => {
    // A draft cannot have orders or a door list yet; the two screens it CAN use
    // are its overview (the checklist) and the next thing to build.
    for (const status of ['draft', 'rejected', 'pending_review']) {
      const ticketed = organizerTabs({ eventId: EVENT, listingType: 'ticketed', status });
      expect(ticketed, status).not.toContain('orders');
      expect(ticketed, status).not.toContain('attendees');
      expect(ticketed, status).toContain('overview');
      expect(pickTabs(organizerNavGroups({ eventId: EVENT, listingType: 'ticketed' }), ticketed)).toHaveLength(ticketed.length);

      const listing = organizerTabs({ eventId: EVENT, listingType: 'display_only', status });
      expect(pickTabs(organizerNavGroups({ eventId: EVENT, listingType: 'display_only' }), listing)).toHaveLength(listing.length);
    }
    // On sale, and in every state after it, the bar is the one used on the night.
    for (const status of ['published', 'completed', 'suspended', 'cancelled', 'archived']) {
      expect(organizerTabs({ eventId: EVENT, listingType: 'ticketed', status }), status).toContain('orders');
    }
  });

  test('the event groups name the event they act on', () => {
    const groups = organizerNavGroups({ eventId: EVENT, eventTitle: 'Spring Gala' });
    expect(groups.find((g) => g.id === 'build').caption).toBe('Spring Gala');
    // Pruning a listing's selling screens keeps the caption on what is left.
    const listing = organizerNavGroups({ eventId: EVENT, listingType: 'display_only', eventTitle: 'Art Walk' });
    expect(listing.find((g) => g.id === 'build').caption).toBe('Art Walk');
  });

  test('every destination is a page that exists on disk', () => {
    const app = path.resolve(__dirname, '../src/app');
    // THE BUYER'S NAV IS IN HERE TOO. It is the third workspace and the newest,
    // so it is the one whose destinations are most likely to be typed wrong —
    // and two of them (`/events`, `/events/saved`) point at the storefront
    // rather than at its own prefix, which is exactly the kind of cross-surface
    // href that rots quietly when a route is renamed.
    // `canSell` on, so the conditional destination is covered as well — it is
    // exactly the one nothing else would catch.
    const items = organizerNavGroups({ eventId: EVENT, partners: { sponsors: true, vendors: true } }).flatMap((g) => g.items)
      .flatMap((i) => [i, ...(i.also || []).map((href) => ({ key: `${i.key} (inside)`, href }))])
      .concat(adminNavGroups().flatMap((g) => g.items))
      .concat(accountNavGroups({ canSell: true }).flatMap((g) => g.items));
    for (const item of items) {
      const route = item.href.replace(EVENT, '[id]');
      const page = path.join(app, route, 'page.jsx');
      expect(fs.existsSync(page), `${item.key} → ${route} has no page`).toBe(true);
    }
  });

  test('a display-only event shows no selling screens — only its overview and sharing', () => {
    const groups = organizerNavGroups({ eventId: EVENT, listingType: 'display_only' });
    const keys = groups.flatMap((g) => g.items).map((i) => i.key);
    // `details` is in here deliberately: a listing sells nothing, but it still
    // has a name, a date and a venue, and that form is where they are edited.
    expect(keys).toEqual(expect.arrayContaining(['dashboard', 'events', 'overview', 'details', 'share', 'payments', 'profile']));
    for (const selling of ['tiers', 'map', 'tables', 'promos', 'orders', 'door', 'commission', 'attendees', 'staff', 'devices']) {
      expect(keys, `${selling} must not show for a listing`).not.toContain(selling);
    }
    // No empty group headings left behind.
    expect(groups.every((g) => g.items.length > 0)).toBe(true);
  });

  test('a display-only event is built in three steps, and Page & branding is one of them', () => {
    // REGRESSION (2026-10-16): Page & branding was dropped with the selling
    // screens, so a listing could not be given a cover, a gallery or sponsors —
    // which are what a listing is for. Back / Save and continue walks this list.
    const build = organizerNavGroups({ eventId: EVENT, listingType: 'display_only' })
      .find((g) => g.id === 'build').items.map((i) => i.key);
    expect(build).toEqual(['overview', 'details', 'content']);
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
  test('general admission has the event map too, with a hint, and drops table categories', () => {
    const groups = organizerNavGroups({
      eventId: EVENT, listingType: 'ticketed', admissionType: 'general',
    });
    const items = groups.flatMap((g) => g.items);
    const keys = items.map((i) => i.key);

    // The event map (2026-11-23): live for general admission — the room and
    // its booths, no seats — with a hint saying so and where to switch.
    const map = items.find((i) => i.key === 'map');
    expect(map.label).toBe('Event map');
    expect(map.disabled).toBe(false);
    expect(map.href).toBe(`/organizer/events/${EVENT}/map`);
    expect(map.hint).toMatch(/general admission/i);
    expect(map.hint).toMatch(/Event details/);
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
      // Table categories live inside Tickets now, as a tab.
      const tabs = sectionTabsFor(`/organizer/events/${EVENT}/tiers`, EVENT, { admissionType }).tabs.map((t) => t.key);
      expect(tabs, String(admissionType)).toContain('tables');
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
    expect(pickTabs(accountNavGroups(), ACCOUNT_TABS)).toHaveLength(ACCOUNT_TABS.length);
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
      'overview', 'details', 'tiers', 'map', 'content',
    ]);
  });

  /**
   * The event's own fields come before everything priced or drawn in them: a
   * tier is priced in the event's currency, a seat map is drawn for its venue.
   */
  test('event details is the first thing after the overview', () => {
    expect(buildKeys().indexOf('details')).toBe(1);
    for (const options of [
      { listingType: 'ticketed', admissionType: 'general' },
      { listingType: 'display_only' },
    ]) {
      expect(buildKeys(options).indexOf('details'), JSON.stringify(options)).toBe(1);
    }
  });

  test('general admission keeps the event map in the build steps', () => {
    const options = { listingType: 'ticketed', admissionType: 'general' };
    expect(buildKeys(options)).toEqual(['overview', 'details', 'tiers', 'map', 'content']);
    // BuildNav walks items WITH an href: the event map is one of them now.
    const walked = organizerNavGroups({ eventId: EVENT, ...options })
      .filter((g) => g.id === 'build').flatMap((g) => g.items).filter((i) => i.href).map((i) => i.key);
    expect(walked).toEqual(['overview', 'details', 'tiers', 'map', 'content']);
  });

  test('selling and on-the-day screens are not part of it', () => {
    for (const key of ['share', 'orders', 'door', 'commission', 'attendees', 'staff', 'devices', 'promos', 'tables', 'sponsors', 'vendors']) {
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

/**
 * THE SIMPLER SIDEBAR (owner, 2026-11-23: "very complex and terrible").
 * 25 rows with an event open became four short groups; screens that belong
 * to another moved inside it as tabs; sponsors and vendors are opt-in.
 */
describe('the simpler organizer sidebar', () => {
  const groupsOf = (options = {}) => organizerNavGroups({ eventId: EVENT, ...options });
  const keysOf = (options) => groupsOf(options).flatMap((g) => g.items).map((i) => i.key);

  test('four event groups with plain names, in order', () => {
    expect(groupsOf({ partners: { sponsors: true, vendors: true } }).map((g) => g.label))
      .toEqual([null, 'Set up', 'Sell', 'Partners', 'On the day', 'Your account']);
  });

  test('no event group is longer than five rows', () => {
    for (const g of groupsOf({ partners: { sponsors: true, vendors: true } })) {
      expect(g.items.length, g.label).toBeLessThanOrEqual(5);
    }
  });

  test('sponsors and vendors are hidden until the event turns them on', () => {
    expect(keysOf()).not.toContain('sponsors');
    expect(keysOf()).not.toContain('vendors');
    expect(groupsOf().map((g) => g.id)).not.toContain('partners');
    expect(keysOf({ partners: { sponsors: true, vendors: false } })).toContain('sponsors');
    expect(keysOf({ partners: { sponsors: true, vendors: false } })).not.toContain('vendors');
    // A listing can have both too.
    expect(keysOf({ listingType: 'display_only', partners: { sponsors: false, vendors: true } })).toContain('vendors');
  });

  test('screens moved inside another row are no longer rows of their own', () => {
    for (const key of ['tables', 'offline', 'commission', 'devices']) {
      expect(keysOf({ partners: { sponsors: true, vendors: true } }), key).not.toContain(key);
    }
  });

  test('…and they light up the row they live in', () => {
    const lit = (suffix) => activeKeys(resolveNav(groupsOf(), `/organizer/events/${EVENT}${suffix}`));
    expect(lit('/tables')).toEqual(['tiers']);
    expect(lit('/offline')).toEqual(['orders']);
    expect(lit('/commission/invoices/abc')).toEqual(['orders']);
    expect(lit('/devices')).toEqual(['staff']);
  });

  test('setup counts only what is required for this event', () => {
    const walk = (options) => setupSteps({ eventId: EVENT, ...options }).map((i) => i.key);
    expect(walk({ listingType: 'ticketed', admissionType: 'reserved' })).toEqual(['overview', 'details', 'tiers', 'map', 'content']);
    // A general-admission map is optional: in the sidebar, not in the walk.
    expect(walk({ listingType: 'ticketed', admissionType: 'general' })).toEqual(['overview', 'details', 'tiers', 'content']);
    expect(walk({ listingType: 'display_only' })).toEqual(['overview', 'details', 'content']);
  });

  test('the tabs on top of each family', () => {
    const tabs = (suffix, event) => sectionTabsFor(`/organizer/events/${EVENT}${suffix}`, EVENT, event);
    expect(tabs('/orders').tabs.map((t) => t.key)).toEqual(['orders', 'offline', 'commission']);
    expect(tabs('/commission/invoices/abc').tabs.find((t) => t.current).key).toBe('commission');
    expect(tabs('/staff').tabs.map((t) => t.key)).toEqual(['staff', 'devices']);
    // General admission sells no tables, so Tickets has one tab — and no strip.
    expect(tabs('/tiers', { admissionType: 'general' })).toBeNull();
    expect(tabs('/share')).toBeNull();
    expect(sectionTabsFor('/organizer', null)).toBeNull();
  });
});
