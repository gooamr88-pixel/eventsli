import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { safeNext } from '../src/app/(auth)/login/LoginForm';

/**
 * `?next=` is the one place this app takes a URL from an attacker-controllable
 * source and navigates to it. Both `proxy.ts` and the login form use it, and
 * both have to reject the same things.
 */
describe('the ?next= redirect', () => {
  test('an ordinary path is kept', () => {
    expect(safeNext('/organizer/events/123')).toBe('/organizer/events/123');
    expect(safeNext('/account/tickets?tab=past')).toBe('/account/tickets?tab=past');
  });

  test('an absolute URL is refused', () => {
    for (const bad of ['https://evil.test', 'http://evil.test/x', 'javascript:alert(1)']) {
      expect(safeNext(bad), bad).toBe('/');
    }
  });

  test('a protocol-relative URL is refused', () => {
    // THE ONE THAT MATTERS. `//evil.test` starts with a slash, so a
    // `startsWith('/')` check alone waves it through — and a browser resolves
    // it as an absolute URL on the current protocol. This is the open redirect.
    expect(safeNext('//evil.test')).toBe('/');
    expect(safeNext('//evil.test/path')).toBe('/');
  });

  test('anything that is not a string is refused', () => {
    for (const bad of [null, undefined, 42, {}, []]) {
      expect(safeNext(bad)).toBe('/');
    }
  });

  test('a stale cookie can still reach the sign-in form', () => {
    // The loop this closes: a revoked session leaves the cookie in the browser,
    // so a protected page 401s, apiFetch sends them to /login?reason=expired,
    // and a naive "signed in? go home" rule sees the cookie and sends them
    // back. Presence of a cookie is not evidence of a session.
    const proxy = fs.readFileSync(
      path.join(process.cwd(), 'src', 'proxy.ts'), 'utf8',
    );
    expect(proxy).toMatch(/reason'\)\s*===\s*'expired'/);
    expect(proxy).toMatch(/hasSession && !bouncedHere/);
  });

  test('proxy.ts applies the identical rule', () => {
    // Two implementations of one rule, in two languages, on two sides of the
    // request. They are checked against each other here because a divergence
    // is silent: the guard that still rejects `//evil.test` hides the one that
    // no longer does.
    const proxy = fs.readFileSync(
      path.join(process.cwd(), 'src', 'proxy.ts'), 'utf8',
    );
    expect(proxy).toMatch(/next\.startsWith\('\/'\)/);
    expect(proxy).toMatch(/!next\.startsWith\('\/\/'\)/);
  });
});

/**
 * The sign-out contract, asserted against the SOURCE rather than by running it.
 *
 * The property that matters — a revoked session is genuinely dead when its
 * token is replayed — is proven by the backend's integration suite against a
 * real database. What can go wrong on this side is subtler and is a matter of
 * ORDER: clearing local state without calling the API leaves the session row
 * alive, so the token keeps working anywhere else it was captured. A test that
 * mocked the fetch would pass whether or not the call was made at all.
 */
describe('signing out', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src', 'app', 'hooks', 'useAuth.js'), 'utf8',
  );

  test('the server is told before the browser navigates away', () => {
    const signOut = source.slice(source.indexOf('export async function signOut'));
    const call = signOut.indexOf("post('/auth/logout'");
    const nav = signOut.indexOf('window.location.assign');
    expect(call, 'signOut must call POST /auth/logout').toBeGreaterThan(-1);
    expect(nav).toBeGreaterThan(call);
  });

  test('the navigation happens even when the request fails', () => {
    // Someone who clicked "sign out" must not be left sitting on their account
    // page because a request failed.
    const signOut = source.slice(source.indexOf('export async function signOut'));
    expect(signOut).toMatch(/catch\s*\{/);
    expect(signOut.indexOf('window.location.assign')).toBeGreaterThan(signOut.indexOf('catch'));
  });

  test('registering does not also sign in', () => {
    // `POST /auth/register` issues a session itself. Following it with a login
    // creates TWO session rows for one sign-up: the second cookie overwrites
    // the first, so nothing appears broken, and the orphan then sits on the
    // account's "Where you are signed in" list as a device the person never
    // used. Caught by counting sessions against a live API, not by a failure.
    const form = fs.readFileSync(
      path.join(process.cwd(), 'src', 'app', '(auth)', 'register', 'RegisterForm.jsx'),
      'utf8',
    );
    const code = form
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '');

    expect(code).toMatch(/post\('\/auth\/register'/);
    expect(code, 'register already issues a session').not.toMatch(/post\('\/auth\/login'/);
  });

  test('nothing about the session is persisted', () => {
    // fancy kept `org_id` and `user_role` in localStorage and trusted them, so
    // a revoked session left the header showing "Sign out" until the visitor
    // clicked through and got bounced. The cookie is httpOnly and unreadable,
    // so asking is the only way to know.
    //
    // Comments are stripped first: the paragraph above says "localStorage" in
    // order to explain why it is absent, and the first version of this test
    // failed on its own prose. An assertion about code has to look at code.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '');

    expect(code).not.toMatch(/localStorage|sessionStorage/);
  });
});
