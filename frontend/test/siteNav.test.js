import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { navLinks, navCta } from '../src/app/lib/siteNav';
import { accountNavGroups } from '../src/app/account/nav/accountNav';
import { PUBLIC_PAGES, isPrivatePath } from '../src/app/lib/siteRoutes';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE MASTHEAD'S RULES, WHICH HAD NONE OF THESE UNTIL NOW.
 *
 * `navLinks` and `navCta` lived inside `SiteHeader.jsx` beside a scroll
 * listener and a burger, so testing either meant mounting a client component
 * that calls `useAuth`. Nobody did, and the decisions in them — which are the
 * whole of the bar's behaviour — were pinned by nothing.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const BUYER = { accountTypes: ['buyer'] };
const ORGANIZER = { accountTypes: ['organizer'], isOrganizer: true };
const UNFINISHED_ORGANIZER = { accountTypes: ['organizer'], isOrganizer: false };
const ADMIN = { accountTypes: ['buyer'], isAdmin: true };

const hrefs = (links) => links.map((l) => l.href);
const guest = (over = {}) => navLinks({ signedIn: false, loading: false, pathname: '/', ...over });
const member = (user, over = {}) => navLinks({ signedIn: true, loading: false, user, pathname: '/', ...over });

/**
 * THE RULE THIS PASS EXISTS FOR.
 *
 * Saved events live in localStorage and need no account, so the link belongs
 * in the masthead for the reader who has no sidebar — and must NOT also be
 * there for the reader who does, because `accountNavGroups` already carries
 * it. One destination, one control, whichever side of the session you are on.
 */
describe('saved events — outside when signed out, inside when signed in', () => {
  test('a visitor with no account gets the link in the navbar', () => {
    expect(hrefs(guest())).toContain('/events/saved');
  });

  test('a signed-in buyer does NOT — the sidebar carries it instead', () => {
    expect(hrefs(member(BUYER))).not.toContain('/events/saved');

    const sidebar = accountNavGroups().flatMap((g) => g.items);
    const saved = sidebar.find((i) => i.href === '/events/saved');
    expect(saved, 'the buyer dashboard must offer the saved list').toBeTruthy();
    expect(saved.label).toBe('Saved events');
  });

  test('no signed-in account gets it in the masthead, whatever they are', () => {
    for (const user of [BUYER, ORGANIZER, UNFINISHED_ORGANIZER, ADMIN]) {
      expect(hrefs(member(user))).not.toContain('/events/saved');
    }
  });

  test('exactly one control points at it, on either side of the session', () => {
    const inMasthead = (links) => hrefs(links).filter((h) => h === '/events/saved').length;
    expect(inMasthead(guest())).toBe(1);
    expect(inMasthead(member(BUYER))).toBe(0);
  });

  /**
   * The count is the receipt for the heart on the last page. Absent at zero:
   * "(0)" is a badge announcing that nothing happened.
   */
  test('the count shows only once something is saved', () => {
    const labelAt = (savedCount) => guest({ savedCount }).find((l) => l.href === '/events/saved').label;
    expect(labelAt(0)).toBe('Saved events');
    expect(labelAt(undefined)).toBe('Saved events');
    expect(labelAt(1)).toBe('Saved events (1)');
    expect(labelAt(12)).toBe('Saved events (12)');
  });

  test('the page it points at exists, and is kept out of the sitemap', () => {
    const page = path.resolve(__dirname, '../src/app/events/saved/page.jsx');
    expect(fs.existsSync(page), '/events/saved has no page').toBe(true);
    // localStorage does not exist on the server, so a crawler would index an
    // empty page describing somebody else's list.
    expect(isPrivatePath('/events/saved')).toBe(true);
    expect(PUBLIC_PAGES.map((p) => p.path)).not.toContain('/events/saved');
    // ...without taking `/events` itself out of it.
    expect(isPrivatePath('/events')).toBe(false);
  });
});

describe('what the bar offers while the session is unknown', () => {
  test('nothing that depends on who is asking', () => {
    const links = navLinks({ signedIn: false, loading: true, pathname: '/' });
    expect(hrefs(links)).toEqual(['/events', '/how-it-works', '/why-us']);
    // A CTA that says one thing and then another moves under the pointer of
    // somebody already reaching for it.
    expect(navCta({ signedIn: false, loading: true })).toBeNull();
  });

  test('the browse links are the same set for everybody once it resolves', () => {
    for (const links of [guest(), member(BUYER), member(ORGANIZER)]) {
      expect(hrefs(links).slice(0, 3)).toEqual(['/events', '/how-it-works', '/why-us']);
    }
  });
});

describe('the promoted button', () => {
  test('a stranger is pitched on selling; a buyer is sent to their dashboard', () => {
    expect(navCta({ signedIn: false, loading: false })).toEqual({
      href: '/register/organizer', label: 'Create event',
    });
    // The buyer used to be told to "Create event" here — the loudest control on
    // every page aimed at the one thing that reader did not come to do.
    expect(navCta({ signedIn: true, loading: false, user: BUYER })).toEqual({
      href: '/account', label: 'Dashboard',
    });
  });

  test('organizer beats admin, the same precedence the API lands on', () => {
    expect(navCta({ signedIn: true, loading: false, user: ORGANIZER }).href).toBe('/organizer');
    expect(navCta({ signedIn: true, loading: false, user: ADMIN }).href).toBe('/admin/overview');
    const both = { accountTypes: ['organizer'], isOrganizer: true, isAdmin: true };
    expect(navCta({ signedIn: true, loading: false, user: both }).href).toBe('/organizer');
  });

  test('the button never duplicates a link beside it', () => {
    for (const user of [BUYER, ORGANIZER, UNFINISHED_ORGANIZER, ADMIN]) {
      const cta = navCta({ signedIn: true, loading: false, user });
      expect(hrefs(member(user)), `${JSON.stringify(user)} has a link duplicating the button`)
        .not.toContain(cta.href);
    }
  });
});

describe('“Create event” in the menu', () => {
  /**
   * The workspace gets you to the setup screen; the PERMISSION says the setup
   * is finished. `/organizer/events/new` needs an organization to create the
   * event under, so offering it before that is a click into a refusal.
   */
  test('only for an organizer who has finished setting up', () => {
    expect(hrefs(member(ORGANIZER))).toContain('/organizer/events/new');
    expect(hrefs(member(UNFINISHED_ORGANIZER))).not.toContain('/organizer/events/new');
    expect(hrefs(member(BUYER))).not.toContain('/organizer/events/new');
  });
});

describe('signing in comes back to where you were', () => {
  test('the current path rides along, encoded', () => {
    const signIn = (pathname) => guest({ pathname }).find((l) => l.label === 'Sign in').href;
    expect(signIn('/events/some-gig')).toBe('/login?next=%2Fevents%2Fsome-gig');
    // A missing pathname must not produce `next=undefined`.
    expect(signIn(null)).toBe('/login?next=%2F');
    expect(signIn('')).toBe('/login?next=%2F');
  });
});

/**
 * Every masthead destination has to be a page that exists — the same check
 * `navModel.test.js` runs over the three sidebars, which the masthead was
 * never part of. That is the gap this closes: the bar's hrefs are typed by
 * hand, several point across surfaces, and nothing has ever read them back.
 */
const APP = path.resolve(__dirname, '../src/app');

/**
 * A URL path, as a page on disk — ROUTE GROUPS AND ALL.
 *
 * `app/(auth)/login/page.jsx` serves `/login`: a `(bracketed)` directory
 * organises files without appearing in the URL. A naive `join(app, route)`
 * therefore reports every auth route as missing, which is how this check first
 * failed on `/login` — a page that has always existed.
 */
function pageFor(route) {
  const direct = path.join(APP, route, 'page.jsx');
  if (fs.existsSync(direct)) return direct;

  const groups = fs.readdirSync(APP, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith('(') && e.name.endsWith(')'));

  return groups
    .map((g) => path.join(APP, g.name, route, 'page.jsx'))
    .find((p) => fs.existsSync(p)) || null;
}

describe('every destination is a page that exists on disk', () => {
  test('signed out and signed in, for every kind of account', () => {
    const sets = [guest(), ...[BUYER, ORGANIZER, UNFINISHED_ORGANIZER, ADMIN].map((u) => member(u))];
    const ctas = [
      navCta({ signedIn: false, loading: false }),
      ...[BUYER, ORGANIZER, ADMIN].map((user) => navCta({ signedIn: true, loading: false, user })),
    ];

    const routes = new Set([
      // `/login?next=…` is a destination plus a query string.
      ...sets.flat().map((l) => l.href.split('?')[0]),
      ...ctas.map((c) => c.href),
    ]);

    for (const route of routes) {
      expect(pageFor(route), `${route} has no page`).not.toBeNull();
    }
  });

  test('the resolver is not just answering yes', () => {
    // A check that cannot fail is a check nobody knows is working.
    expect(pageFor('/events/saved')).toBeTruthy();
    expect(pageFor('/login')).toContain('(auth)');
    expect(pageFor('/pricing')).toBeNull();
  });
});
