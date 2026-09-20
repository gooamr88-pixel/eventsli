import { describe, test, expect } from 'vitest';
import { landingAfterAuth } from '../src/app/lib/authLanding';
import { safeNext } from '../src/app/(auth)/login/LoginForm';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE PRIORITY EVERY WAY IN SHARES.
 *
 * Six of them — email sign-in, Google, sign-up, the activation link, the
 * six-digit code and the cross-device watch — and each one used to decide this
 * for itself. They disagreed: the link had a rule of its own, sign-in and
 * sign-up fell through to the storefront, and the code had no opinion at all,
 * so the same person landed somewhere different depending on which they used.
 *
 * Two facts arrive at all six and they are not equal:
 *
 *   `?next=`      where they were ACTUALLY going. Wins, always.
 *   the API's     where an account of this TYPE belongs otherwise.
 *
 * The open-redirect guard is the same `safeNext` the sign-in form has always
 * used, and it is exercised here because this is now the only place the two
 * facts meet.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const query = (obj) => new URLSearchParams(obj);

const ORGANIZER = { next: '/organizer', accountTypes: ['organizer'] };
const BUYER = { next: '/account', accountTypes: ['buyer'] };

describe('landingAfterAuth', () => {
  test('a real destination beats the account type, both ways round', () => {
    expect(landingAfterAuth(query({ next: '/checkout/abc' }), ORGANIZER)).toBe('/checkout/abc');
    expect(landingAfterAuth(query({ next: '/checkout/abc' }), BUYER)).toBe('/checkout/abc');
  });

  test('with nothing asked for, the account type decides', () => {
    expect(landingAfterAuth(query({}), ORGANIZER)).toBe('/organizer');
    expect(landingAfterAuth(query({}), BUYER)).toBe('/account');
  });

  test('an account that is both lands on the dashboard', () => {
    // The API decides this; the client only has to not override it.
    const both = { next: '/organizer', accountTypes: ['buyer', 'organizer'] };
    expect(landingAfterAuth(query({}), both)).toBe('/organizer');
  });

  /**
   * An off-origin `?next=` is not a destination somebody asked for — it is an
   * open redirect somebody planted. It falls through to the account's own home
   * rather than to the storefront, so a hostile link costs nothing.
   */
  test('a hostile destination is dropped, and the account type still applies', () => {
    for (const hostile of ['//evil.test', 'https://evil.test/steal', 'javascript:alert(1)']) {
      expect(safeNext(hostile), hostile).toBe('/');
      expect(landingAfterAuth(query({ next: hostile }), ORGANIZER), hostile).toBe('/organizer');
      expect(landingAfterAuth(query({ next: hostile }), BUYER), hostile).toBe('/account');
    }
  });

  test('an API that says nothing still produces a destination', () => {
    expect(landingAfterAuth(query({}), null)).toBe('/');
    expect(landingAfterAuth(query({}), {})).toBe('/');
  });

  test('an explicit next of / is not a request, so the type wins', () => {
    // Nobody deliberately asks to be sent to the storefront after signing in;
    // it is what an empty or rejected value collapses to.
    expect(landingAfterAuth(query({ next: '/' }), BUYER)).toBe('/account');
  });

  test('it never needs the role, only the type', () => {
    // A super admin who only buys tickets lands on their tickets. Permission
    // decides what they may do, not what they are shown first.
    const adminBuyer = { next: '/account', role: 'super_admin', accountTypes: ['buyer'] };
    expect(landingAfterAuth(query({}), adminBuyer)).toBe('/account');
  });
});
