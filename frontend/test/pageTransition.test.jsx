import { describe, test, expect } from 'vitest';
import { isDataPage } from '../src/app/components/PageTransition';

// The page transition shows only in front of pages that load from the
// database (owner, 2026-11-18). These pin which side each page falls on.
describe('isDataPage', () => {
  test.each([
    '/',
    '/events',
    '/events/saved',
    '/e/jazz-night',
    '/e/jazz-night/seats',
    '/cart',
    '/checkout/abc123',
    '/t/token123',
    '/terms',
    '/terms/organizer',
    '/account/tickets',
    '/organizer',
    '/organizer/events/42/orders',
    '/admin/invoices',
  ])('%s loads data', (path) => {
    expect(isDataPage(path)).toBe(true);
  });

  test.each([
    '/how-it-works',
    '/why-us',
    '/trust',      // starts with "/t", but is not a ticket
    '/tickets/find',
    '/contact',
    '/privacy',
    '/sms-terms',
    '/login',
    '/register',
    '/gate',
    '/gate/login',
    '/eventsli',   // starts with "/e", but is not an event
  ])('%s is fixed content', (path) => {
    expect(isDataPage(path)).toBe(false);
  });
});
