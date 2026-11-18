import { describe, test, expect } from 'vitest';
import { isTransitionPage, showsTransition } from '../src/app/components/PageTransition';

// The page transition plays only in front of the storefront's discovery
// pages (owner, 2026-11-18: "not for all pages of database — the suitable
// ones"). These pin which side each page falls on.
describe('isTransitionPage', () => {
  test.each([
    '/',
    '/events',
    '/e/jazz-night',
  ])('%s gets the transition', (path) => {
    expect(isTransitionPage(path)).toBe(true);
  });

  test.each([
    // Purchase steps: mid-purchase, their own loading shapes.
    '/e/jazz-night/seats',
    '/e/jazz-night/tickets',
    '/cart',
    '/checkout/abc123',
    // Dashboards: worked in all day.
    '/organizer',
    '/organizer/events/42/orders',
    '/admin/invoices',
    '/account/tickets',
    // Small or fixed pages.
    '/events/saved',
    '/t/token123',
    '/terms',
    '/how-it-works',
    '/privacy',
    '/login',
    '/gate',
    '/eventsli',   // starts with "/e", but is not an event
  ])('%s does not', (path) => {
    expect(isTransitionPage(path)).toBe(false);
  });
});

describe('showsTransition', () => {
  test.each([
    ['/how-it-works', '/events'],
    ['/events', '/e/jazz-night'],
    ['/e/jazz-night', '/'],
    ['/organizer/events/42', '/e/jazz-night'], // a dashboard out to an event
    ['/e/jazz-night', '/e/other-show'],        // a different event
    ['/e/jazz-night/seats', '/events'],
  ])('%s -> %s plays', (from, to) => {
    expect(showsTransition(from, to)).toBe(true);
  });

  test.each([
    ['/e/jazz-night/seats', '/e/jazz-night'],   // back to the same event
    ['/e/jazz-night/tickets', '/e/jazz-night'],
    ['/e/jazz-night', '/e/jazz-night/seats'],   // into its purchase steps
    ['/organizer', '/organizer/events/42'],     // between dashboard sections
    ['/', '/organizer'],                        // into a dashboard
    ['/events', '/checkout/abc123'],
    ['/events', '/events'],                     // same page
  ])('%s -> %s does not', (from, to) => {
    expect(showsTransition(from, to)).toBe(false);
  });
});
