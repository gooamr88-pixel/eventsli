const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  MIN_PASSWORD, MAX_PASSWORD, COMMON_PASSWORDS, checkPassword,
  isRepeatedUnit, isSequential, isSingleCharacter, foldLeet,
  TOO_WEAK_MESSAGE, LENGTH_MESSAGE,
} = require('../utils/passwordPolicy');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SERVER IS THE AUTHORITY, AND THESE ARE WHAT SAY SO.
 *
 * The browser mirrors this policy in `frontend/src/app/lib/passwordRules.js`
 * and that mirror is a convenience: it turns "your password was refused" into
 * "three more characters" while somebody types. It is not a control. Anything
 * that is not that form — curl, a stale tab, a script, a second client — posts
 * straight to the endpoint.
 *
 * So the cases below are written as BYPASS attempts: for each shape the browser
 * would have refused, assert that the module the route calls refuses it too.
 * A rule that exists only in the mirror is a rule that does not exist.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Every shape the UI would have stopped. None of them may get past here. */
const REFUSED = [
  ['under the minimum', 'short'],
  ['one below the minimum', 'a'.repeat(MIN_PASSWORD - 1)],
  ['empty', ''],
  ['over the maximum', 'a'.repeat(MAX_PASSWORD + 1)],
  ['a listed common password', 'administrator'],
  ['a listed one in capitals', 'ADMINISTRATOR'],
  ['a listed one through substitutions', '4dministr4tor'],
  ['one repeated character', 'aaaaaaaaaaaa'],
  ['a repeated unit', 'abcabcabcabc'],
  ['a repeated word', 'passwordpassword'],
  ['an alphabet run', 'abcdefghijkl'],
  ['a keyboard run', 'qwertyuiopasdfghjkl'],
  ['a reversed keyboard run', 'lkjhgfdsapoiuytrewq'],
  ['a digit run', '123456789012'],
];

describe('checkPassword — what the API refuses', () => {
  for (const [name, value] of REFUSED) {
    test(`refuses ${name}`, () => {
      const verdict = checkPassword(value);
      assert.equal(verdict.ok, false, `${JSON.stringify(value)} should not be accepted`);
      assert.ok(verdict.reason, 'a refusal carries a reason for the server to reason about');
    });
  }

  test('refuses a non-string, whatever it is', () => {
    // The route declares `.isString()` first, but this module is called
    // directly from tests and could be called directly from anywhere else.
    for (const value of [null, undefined, 0, 12345678901234, {}, [], true]) {
      assert.equal(checkPassword(value).ok, false, `${JSON.stringify(value)} is not a password`);
    }
  });

  test('refuses a password containing the account email', () => {
    const verdict = checkPassword('yousefamr-rides-again', { email: 'yousefamr@example.com' });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, 'email');
  });

  test('a short email local part does not disqualify everything', () => {
    assert.equal(checkPassword('a-perfectly-fine-phrase', { email: 'a@example.com' }).ok, true);
  });
});

describe('checkPassword — what the API accepts', () => {
  const ACCEPTED = [
    ['a three-word passphrase', 'purple lantern dockyard'],
    ['the canonical four-word one', 'correct horse battery staple'],
    ['a long random string', 'Tr0ubad0ur-Mist-9241'],
    ['exactly the minimum length', 'juniper-vellum'.slice(0, MIN_PASSWORD).padEnd(MIN_PASSWORD, 'x')],
    ['a very long passphrase', 'harbour lantern dockyard meridian saffron quartz thicket'],
  ];

  for (const [name, value] of ACCEPTED) {
    test(`accepts ${name}`, () => {
      const verdict = checkPassword(value);
      assert.equal(verdict.ok, true, `${JSON.stringify(value)} should be accepted (${verdict.reason})`);
    });
  }

  test('accepts a passphrase at the maximum length', () => {
    // The ceiling exists to stop a megabyte paste, not to stop a passphrase.
    const words = ['harbour', 'lantern', 'dockyard', 'meridian', 'saffron', 'quartz', 'thicket'];
    let value = '';
    let i = 0;
    while (value.length < MAX_PASSWORD - 10) { value += `${words[i % words.length]}-`; i += 1; }
    assert.ok(value.length <= MAX_PASSWORD);
    assert.equal(checkPassword(value).ok, true);
  });

  test('does not demand a digit, a symbol or a capital', () => {
    // NIST SP 800-63B. Composition rules produce `Password1!` and reject
    // `correct horse battery staple`, which is backwards.
    assert.equal(checkPassword('purple lantern dockyard').ok, true);
  });
});

describe('the refusal message tells an attacker nothing', () => {
  test('it is the SAME sentence whichever rule fired', () => {
    /**
     * The invariant is constancy, not vocabulary.
     *
     * A message that VARIES by reason is the leak: "that is a known common
     * password" tells somebody working a list to skip to the next entry, and
     * "it contains your email address" confirms they guessed the address.
     * `TOO_WEAK_MESSAGE` is one constant and the route throws it for every
     * non-length refusal, so the reasons below are indistinguishable from
     * outside. General advice inside that one sentence reveals nothing,
     * because it is said to everybody.
     */
    const reasons = new Set(
      ['administrator', 'aaaaaaaaaaaa', 'abcabcabcabc', 'abcdefghijkl']
        .map((p) => checkPassword(p).reason),
    );
    assert.ok(reasons.size > 1, 'these should fail for genuinely different reasons');

    assert.equal(typeof TOO_WEAK_MESSAGE, 'string');
    assert.ok(TOO_WEAK_MESSAGE.length > 0);

    // The one disclosure that would matter: it must never carry the address.
    const withEmail = checkPassword('yousefamr-rides-again', { email: 'yousefamr@example.com' });
    assert.equal(withEmail.ok, false);
    assert.ok(
      !TOO_WEAK_MESSAGE.includes('yousefamr') && !TOO_WEAK_MESSAGE.includes('@'),
      'the message must not carry the address it just matched',
    );
  });

  test('it cannot echo the submitted password', () => {
    // It takes no arguments, so there is no path by which one could reach it.
    assert.equal(typeof TOO_WEAK_MESSAGE, 'string');
    assert.equal(typeof LENGTH_MESSAGE, 'string');
    assert.ok(LENGTH_MESSAGE.includes(String(MIN_PASSWORD)));
  });
});

describe('the shape rules, individually', () => {
  test('isSingleCharacter', () => {
    assert.equal(isSingleCharacter('aaaa'), true);
    assert.equal(isSingleCharacter('aaab'), false);
    assert.equal(isSingleCharacter(''), false);
  });

  test('isRepeatedUnit', () => {
    assert.equal(isRepeatedUnit('abcabc'), true);
    assert.equal(isRepeatedUnit('abab'), true);
    assert.equal(isRepeatedUnit('abcabcd'), false);
    assert.equal(isRepeatedUnit('purple lantern dockyard'), false);
  });

  test('isSequential', () => {
    assert.equal(isSequential('abcdef'), true);
    assert.equal(isSequential('qwerty'), true);
    assert.equal(isSequential('fedcba'), true);
    assert.equal(isSequential('purple'), false);
  });

  test('foldLeet collapses the usual substitutions', () => {
    assert.equal(foldLeet('p@ssw0rd'), 'password');
    assert.equal(foldLeet('4dm1n'), 'admin');
  });
});

describe('the blocklist itself', () => {
  test('every entry is long enough to ever fire', () => {
    // Anything shorter is refused by length first, so it could never be the
    // reason a password was rejected — and a list of rules that cannot fire is
    // a list nobody audits.
    const tooShort = [...COMMON_PASSWORDS].filter((p) => p.length < MIN_PASSWORD);
    assert.deepEqual(tooShort, [], `shorter than ${MIN_PASSWORD}: ${tooShort.join(', ')}`);
  });

  test('every entry is lowercase, because matching lowercases the candidate', () => {
    const wrong = [...COMMON_PASSWORDS].filter((p) => p !== p.toLowerCase());
    assert.deepEqual(wrong, [], `not lowercase: ${wrong.join(', ')}`);
  });
});

describe('all three password endpoints apply the same rules', () => {
  /**
   * Read off disk, like `errorCodes.test.js` reads the error envelope.
   *
   * The risk this pins is specific and is the one the brief calls out: an
   * account-recovery flow that accepts what sign-up refuses is a way around
   * sign-up. The three routes share one builder so they cannot drift — this is
   * what fails if somebody gives one of them its own rules.
   */
  const routes = fs.readFileSync(
    path.join(__dirname, '..', 'routes', 'authRoutes.js'), 'utf8',
  );

  test('register, reset-password and change-password all call passwordRules', () => {
    for (const route of ['/register', '/reset-password', '/change-password']) {
      const at = routes.indexOf(`'${route}'`);
      assert.ok(at > -1, `${route} should exist in authRoutes.js`);
      // The builder call appears within the route's own middleware list.
      const block = routes.slice(at, routes.indexOf('router.post', at + 10));
      assert.ok(
        /passwordRules\(/.test(block),
        `${route} must apply passwordRules — otherwise it is a weaker way to set a password`,
      );
    }
  });

  test('passwordRules runs the shared policy rather than its own literals', () => {
    assert.ok(
      routes.includes("require('../utils/passwordPolicy')"),
      'authRoutes must read the policy from the shared module',
    );
    assert.ok(routes.includes('checkPassword('), 'passwordRules must call checkPassword');
    /**
     * Scoped to the passwordRules builder, not the whole file.
     *
     * `fullName` and `phone` legitimately carry their own `isLength` literals,
     * and an unscoped regex matched those instead — the assertion passed
     * judgement on the wrong validator. What must not reappear is a hard-coded
     * 12/200 on the PASSWORD.
     */
    const builder = routes.slice(
      routes.indexOf('const passwordRules ='),
      routes.indexOf('router.post('),
    );
    assert.ok(builder.length > 0, 'passwordRules should be defined before the routes');
    assert.ok(
      builder.includes('MIN_PASSWORD') && builder.includes('MAX_PASSWORD'),
      'the bounds must be read from the policy module',
    );
    assert.ok(
      !/isLength\(\{\s*min:\s*\d/.test(builder),
      'the password length must not be a literal here — it belongs to the policy',
    );
  });
});
