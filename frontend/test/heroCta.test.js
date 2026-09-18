import { describe, test, expect } from 'vitest';
import { resolveCta } from '../src/app/components/landing/HeroCta';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * "START SELLING" MUST NOT RETURN YOU TO THE PAGE YOU PRESSED IT ON.
 *
 * `proxy.ts` bounces a signed-in visitor off every `/register*` path back to
 * `/`, which is correct — there is nothing to register them for. The hero's
 * secondary button defaults to `/register`, so for everybody already signed in
 * it was a control that did nothing and said nothing.
 *
 * The failure mode is what makes this worth a test: no error, no log, nothing
 * in a console. The only evidence is a person pressing a button twice.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const OUT = { signedIn: false, loading: false, user: null };
const BUYER = { signedIn: true, loading: false, user: { isOrganizer: false } };
const ORGANIZER = { signedIn: true, loading: false, user: { isOrganizer: true } };
const UNKNOWN = { signedIn: false, loading: true, user: null };

describe('resolveCta — the register dead end', () => {
  test('a signed-out visitor gets the admin’s link, untouched', () => {
    expect(resolveCta('/register', OUT)).toBe('/register');
    expect(resolveCta('/register/organizer', OUT)).toBe('/register/organizer');
  });

  test('an organizer is sent to create an event, not to register again', () => {
    expect(resolveCta('/register', ORGANIZER)).toBe('/organizer/events/new');
    expect(resolveCta('/register/organizer', ORGANIZER)).toBe('/organizer/events/new');
  });

  test('a signed-in buyer is sent where they can become an organizer', () => {
    // NOT `/register/organizer` — the proxy would bounce that straight back.
    // `/organizer` is the page that asks them for the details they lack.
    expect(resolveCta('/register/organizer', BUYER)).toBe('/organizer');
  });

  test('nothing moves while the session is still unknown', () => {
    // The button renders server-side with the admin's href. Swapping it before
    // `useAuth` has answered would make it flicker for everybody, including
    // the signed-out majority and every crawler.
    expect(resolveCta('/register', UNKNOWN)).toBe('/register');
  });

  test('an empty href still defaults to register for a stranger', () => {
    expect(resolveCta(undefined, OUT)).toBe('/register');
    expect(resolveCta('', ORGANIZER)).toBe('/organizer/events/new');
  });
});

describe('resolveCta — links the admin meant', () => {
  test('a non-register destination is never rewritten', () => {
    // This repairs one dead end; it does not take the button over. An admin
    // pointing it at a marketing page means it, for everybody.
    for (const state of [OUT, BUYER, ORGANIZER]) {
      expect(resolveCta('/why-us', state)).toBe('/why-us');
      expect(resolveCta('/events', state)).toBe('/events');
      expect(resolveCta('https://example.com/sell', state)).toBe('https://example.com/sell');
    }
  });

  test('a path that merely starts with the letters "register" is not a register page', () => {
    // `/registers-of-interest` is not `/register/…`, and the proxy would not
    // bounce it — so neither does this.
    expect(resolveCta('/registry', ORGANIZER)).toBe('/registry');
  });
});
