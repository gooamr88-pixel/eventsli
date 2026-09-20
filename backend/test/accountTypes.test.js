const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  ACCOUNT_TYPE, HOME, normalise, fromSignupChoice, hasType, landingFor,
} = require('../utils/accountTypes');
const { ROLE_LEVEL } = require('../utils/roleLadder');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * ACCOUNT TYPE IS NOT A PERMISSION, and these are what keep it that way.
 *
 * The risk is specific: sign-up posts `accountType`, a string from a browser.
 * The moment that string can influence authorization, anybody can POST
 * `"organizer"` — or `"admin"` — and take what it names. So the tests below
 * pin two separate things:
 *
 *   · what a posted choice is allowed to become (a routing set, and nothing
 *     that appears in the role ladder)
 *   · where each shape of account lands, for every way in
 *
 * `?next=` priority is a client concern and is tested there; this file is the
 * fallback the client uses when nothing was asked for.
 * ─────────────────────────────────────────────────────────────────────────────
 */

describe('what a sign-up choice may become', () => {
  test('choosing organizer records both surfaces — selling does not stop you buying', () => {
    assert.deepEqual(fromSignupChoice('organizer'), ['buyer', 'organizer']);
  });

  test('choosing buyer records exactly that', () => {
    assert.deepEqual(fromSignupChoice('buyer'), ['buyer']);
  });

  test('anything else is a buyer, including the words that name permissions', () => {
    for (const posted of ['admin', 'super_admin', 'SUPER_ADMIN', 'owner', '', null, undefined, 0, {}, []]) {
      assert.deepEqual(
        fromSignupChoice(posted), ['buyer'],
        `posting ${JSON.stringify(posted)} must not widen the account`,
      );
    }
  });

  /**
   * ───────────────────────────────────────────────────────────────────────────
   * 'organizer' NAMES BOTH AN ACCOUNT TYPE AND A ROLE, and it has to: it is the
   * product's word for the thing, in both systems. That shared word is exactly
   * why the separation needs a test rather than a convention — `role: 'attendee'`
   * in the register insert is one careless edit away from `role: accountType`,
   * and the two would then be the same string with very different meanings.
   *
   * So this reads the source. The sign-up handler must hardcode the lowest role
   * and must never assign one from the request body.
   * ───────────────────────────────────────────────────────────────────────────
   */
  test('sign-up hardcodes the lowest role and never assigns one from the body', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'controllers', 'authController.js'), 'utf8',
    );
    const insert = src.slice(src.indexOf('.from(\'profiles\')'), src.indexOf('.select(\'id, email, full_name, role, account_types\')'));

    // Every `role:` in the insert, whatever it is set to. Checked by value
    // rather than with a negative lookahead — `\s*` happily matches nothing and
    // makes the obvious lookahead pass on the very line it is meant to inspect.
    const assigned = [...insert.matchAll(/\brole:\s*([^,\n]+)/g)].map((m) => m[1].trim());
    assert.deepEqual(
      assigned, ["'attendee'"],
      'the sign-up insert must set the role exactly once, to the literal lowest role',
    );
    // Belt and braces: nothing in the file may route a request body into a role.
    assert.doesNotMatch(
      src, /role:\s*(req\.body|accountType|asOrganizer)/,
      'a request value reaches `role` — this is the escalation path',
    );
  });

  test('the role ladder has no idea account types exist', () => {
    // The ladder is the authorization vocabulary. If a type were ever added to
    // it, `requireRole` would start honouring something a browser can post.
    const ladder = Object.keys(ROLE_LEVEL);
    assert.deepEqual(ladder, ['attendee', 'organizer', 'admin', 'super_admin']);
    assert.ok(!ladder.includes(ACCOUNT_TYPE.BUYER), 'buyer must never be a role');
  });
});

describe('reading what is stored', () => {
  test('unknown and duplicate values are dropped', () => {
    assert.deepEqual(normalise(['buyer', 'buyer', 'wizard', 'ORGANIZER']), ['buyer', 'organizer']);
  });

  test('a row that predates the column still resolves', () => {
    // Tolerant on read: an old profile must not throw on the sign-in path.
    for (const stored of [null, undefined, [], ['nonsense'], 'buyer', 42]) {
      assert.deepEqual(normalise(stored), ['buyer'], JSON.stringify(stored));
    }
  });

  test('hasType reads either the database shape or the API shape', () => {
    assert.equal(hasType({ account_types: ['buyer', 'organizer'] }, 'organizer'), true);
    assert.equal(hasType({ accountTypes: ['buyer'] }, 'organizer'), false);
  });
});

describe('where each account lands', () => {
  test('an organizer opens on the dashboard', () => {
    assert.equal(landingFor({ account_types: ['organizer'] }), '/organizer');
  });

  test('a buyer opens on their own dashboard, not the storefront', () => {
    assert.equal(landingFor({ account_types: ['buyer'] }), '/account');
  });

  test('both opens on the dashboard — the surface with work waiting', () => {
    assert.equal(landingFor({ account_types: ['buyer', 'organizer'] }), '/organizer');
    // Order in the column must not change the answer.
    assert.equal(landingFor({ account_types: ['organizer', 'buyer'] }), '/organizer');
  });

  test('an account with nothing stored still lands somewhere', () => {
    assert.equal(landingFor({}), '/account');
    assert.equal(landingFor(null), '/account');
  });

  /**
   * Both destinations sit under a prefix `proxy.ts` guards, so neither can be
   * landed on without a session — which is what makes it safe for this to be
   * the answer for every way in, including the ones that mint the session in
   * the same response.
   */
  test('every home is a signed-in path', () => {
    for (const home of Object.values(HOME)) {
      assert.ok(
        ['/organizer', '/account', '/admin'].some((p) => home.startsWith(p)),
        `${home} is not behind a protected prefix`,
      );
    }
  });

  test('the role has no influence on it', () => {
    // An admin who only ever buys tickets lands on their tickets. Permission
    // decides what they may do, not what they are shown first.
    assert.equal(
      landingFor({ account_types: ['buyer'], role: 'super_admin' }),
      '/account',
    );
    assert.equal(
      landingFor({ account_types: ['organizer'], role: 'attendee' }),
      '/organizer',
    );
  });
});
