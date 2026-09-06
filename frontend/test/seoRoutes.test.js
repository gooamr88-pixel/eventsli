import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  PUBLIC_PAGES, PRIVATE_PREFIXES, FOOTER_GROUPS, isPrivatePath,
} from '../src/app/lib/siteRoutes';
import robots from '../src/app/robots';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The sitemap, robots.txt and the footer have to agree with the pages that
 * exist.
 *
 * All three failures here are silent. A page nothing links to and the sitemap
 * does not list is a page that is never crawled. A footer link to a route that
 * was renamed is a 404 on every page of the site. And a private prefix missing
 * from robots.txt is a crawler fetching `/t/<token>` — a signed admission
 * credential in a URL — and writing it into a log.
 *
 * So this walks `src/app` for real route files and checks the three lists
 * against them. Adding a page has to be a decision about whether it is public.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const APP = path.join(process.cwd(), 'src', 'app');

/** Every routable path with a page file, as a URL path. */
function routesOnDisk(dir = APP, prefix = '') {
  const found = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      if (/^page\.(jsx?|tsx?)$/.test(entry.name)) found.push(prefix || '/');
      continue;
    }
    // Not routes: colocated components, hooks, helpers, and the internal API.
    if (['components', 'hooks', 'utils', 'lib', 'api'].includes(entry.name)) continue;

    // A route GROUP contributes no path segment — `(auth)/login` is `/login`.
    const segment = /^\(.*\)$/.test(entry.name) ? '' : `/${entry.name}`;
    found.push(...routesOnDisk(path.join(dir, entry.name), prefix + segment));
  }

  return found;
}

/** `/e/[slug]` and friends. A sitemap lists their instances, never the pattern. */
const isDynamic = (route) => route.includes('[');

describe('the public surface', () => {
  const routes = routesOnDisk();

  test('the walk finds the pages we know are there', () => {
    // A guard on the guard: if this stops matching page files, every assertion
    // below passes on an empty list.
    expect(routes.length).toBeGreaterThan(20);
    expect(routes).toContain('/');
    expect(routes).toContain('/e/[slug]');
    expect(routes).toContain('/gate');
  });

  test('every static page on disk is either in the sitemap or private', () => {
    const listed = new Set(PUBLIC_PAGES.map((p) => p.path));
    const orphans = routes.filter((r) => !isDynamic(r) && !listed.has(r) && !isPrivatePath(r));

    expect(
      orphans,
      'These pages exist and nothing points at them — not the sitemap, not the footer, '
      + 'and robots.txt does not exclude them either. Add each to PUBLIC_PAGES or to '
      + `PRIVATE_PREFIXES in lib/siteRoutes.js:\n  ${orphans.join('\n  ')}`,
    ).toEqual([]);
  });

  test('the sitemap lists nothing that does not exist', () => {
    const onDisk = new Set(routes);
    const missing = PUBLIC_PAGES.filter((p) => !onDisk.has(p.path)).map((p) => p.path);

    expect(missing, `In the sitemap with no page behind it: ${missing.join(', ')}`).toEqual([]);
  });

  test('the sitemap lists nothing private', () => {
    const leaked = PUBLIC_PAGES.filter((p) => isPrivatePath(p.path)).map((p) => p.path);
    expect(leaked).toEqual([]);
  });

  test('every footer link is a page the sitemap publishes', () => {
    const listed = new Set(PUBLIC_PAGES.map((p) => p.path));
    const broken = FOOTER_GROUPS
      .flatMap((g) => g.links.map((l) => l.path))
      .filter((p) => !listed.has(p));

    expect(broken, `Footer links to pages outside PUBLIC_PAGES: ${broken.join(', ')}`).toEqual([]);
  });

  test('the footer is where a crawler finds the marketing pages', () => {
    // The specific value of a footer on a small site: without these three links,
    // nothing on the site points at them at all.
    const linked = new Set(FOOTER_GROUPS.flatMap((g) => g.links.map((l) => l.path)));
    for (const page of ['/how-it-works', '/why-us', '/trust', '/contact']) {
      expect(linked.has(page), `${page} is in the sitemap but nothing links to it`).toBe(true);
    }
  });
});

describe('share cards', () => {
  /**
   * A page's `openGraph` REPLACES the root layout's rather than merging into
   * it. So any page that declares one and omits `images` ships with no share
   * card — which is invisible: nothing errors, nothing logs, and the only place
   * it shows up is in somebody else's chat window.
   *
   * That is exactly how `/e/[slug]` shipped without one for every event that
   * had no cover art. A source scan is crude, and it is enough: the mistake is
   * an omission, and an omission is what this looks for.
   */
  function filesDeclaringOpenGraph(dir = APP, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { filesDeclaringOpenGraph(full, out); continue; }
      if (!/\.(jsx?|tsx?)$/.test(entry.name)) continue;
      const src = fs.readFileSync(full, 'utf8');
      if (/\bopenGraph\s*:/.test(src)) out.push({ rel: path.relative(APP, full), src });
    }
    return out;
  }

  const declaring = filesDeclaringOpenGraph();

  test('the scan finds the files that set one', () => {
    expect(declaring.length).toBeGreaterThan(1);
    expect(declaring.map((f) => f.rel.replace(/\\/g, '/'))).toContain('layout.jsx');
  });

  test('every page that declares openGraph also declares an image', () => {
    const cardless = declaring
      .filter((f) => !/\bimages\s*:/.test(f.src))
      .map((f) => f.rel);

    expect(
      cardless,
      'These declare `openGraph` without `images`. A page-level openGraph does not '
      + 'merge with the layout\'s — it replaces it — so each of these ships a share '
      + `link with no picture:\n  ${cardless.join('\n  ')}`,
    ).toEqual([]);
  });

  test('the default card exists and is the size it says it is', () => {
    const file = path.join(process.cwd(), 'public', 'og-default.png');
    expect(fs.existsSync(file), 'public/og-default.png is referenced but missing').toBe(true);

    // The IHDR chunk of a PNG: width and height as big-endian 32-bit ints at
    // offsets 16 and 20. Declaring 1200×630 in the metadata and shipping
    // something else is a card that lays out wrong on the first share.
    const head = fs.readFileSync(file).subarray(0, 24);
    expect(head.readUInt32BE(16)).toBe(1200);
    expect(head.readUInt32BE(20)).toBe(630);
  });
});

describe('robots.txt', () => {
  const txt = robots();
  const rule = txt.rules[0];

  test('points at the sitemap on the canonical host', () => {
    expect(txt.sitemap).toMatch(/^https?:\/\/.+\/sitemap\.xml$/);
  });

  test('excludes every private prefix, both as a page and as a subtree', () => {
    for (const prefix of PRIVATE_PREFIXES) {
      expect(rule.disallow, `${prefix} subtree`).toContain(`${prefix}/`);
      expect(rule.disallow, `${prefix} itself`).toContain(`${prefix}$`);
    }
  });

  test('a ticket URL is excluded — it carries the admission token', () => {
    expect(rule.disallow).toContain('/t/');
  });

  test('and `/t` does not take `/terms` with it', () => {
    // The typo this pattern pair exists to prevent: a bare `/t` is a prefix
    // match that also silences two legal documents.
    expect(rule.disallow).not.toContain('/t');

    // Matched the way a crawler matches: a pattern ending in `$` is an exact
    // URL, everything else is a prefix. Comparing both as prefixes would report
    // a failure that does not exist — and, worse, would pass if the `$` were
    // ever dropped.
    const matches = (pattern, url) => (
      pattern.endsWith('$') ? url === pattern.slice(0, -1) : url.startsWith(pattern)
    );

    for (const legal of ['/terms', '/terms/organizer', '/privacy']) {
      const silenced = rule.disallow.some((d) => matches(d, legal));
      expect(silenced, `${legal} must stay crawlable`).toBe(false);
    }

    // And the pair really does cover the two shapes it is meant to.
    expect(rule.disallow.some((d) => matches(d, '/t/abc.token'))).toBe(true);
    expect(rule.disallow.some((d) => matches(d, '/login'))).toBe(true);
  });

  test('everything else is allowed', () => {
    expect(rule.allow).toBe('/');
    expect(rule.userAgent).toBe('*');
  });
});
