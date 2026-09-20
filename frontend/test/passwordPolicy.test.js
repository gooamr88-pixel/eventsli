import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  MIN_PASSWORD, MAX_PASSWORD, COMMON_PASSWORDS,
  isWeakPassword, passwordProblem, passwordChecks, passwordStrength,
} from '../src/app/lib/passwordRules';

/**
 * The frontend copy of the password policy, and the guard that keeps it a copy.
 *
 * `errorCodes.test.js` reads the backend's envelope off disk and fails when the
 * two sides disagree about an error code. This does the same job for the
 * password rules, for the same reason: one rule, written twice, in two
 * languages, deployed separately. The failure mode without it is quiet and
 * nasty — the browser accepts what the API refuses, and somebody is told their
 * password is wrong on the screen where they are choosing it.
 */
const BACKEND = path.join(process.cwd(), '..', 'backend', 'utils', 'passwordPolicy.js');

function backendSource() {
  return fs.readFileSync(BACKEND, 'utf8');
}

/** The blocklist entries, read out of the backend module's source. */
function backendCommonPasswords() {
  const src = backendSource();
  const block = src.slice(
    src.indexOf('const COMMON_PASSWORDS = new Set(['),
    src.indexOf(']);', src.indexOf('const COMMON_PASSWORDS')),
  );
  return new Set([...block.matchAll(/'([^']+)'/g)].map((m) => m[1]));
}

describe('frontend/backend policy parity', () => {
  test('the backend module is where this test thinks it is', () => {
    // If this fails, the two assertions below are passing vacuously.
    expect(fs.existsSync(BACKEND), `expected the policy at ${BACKEND}`).toBe(true);
  });

  test('the length bounds agree', () => {
    const src = backendSource();
    expect(src).toMatch(new RegExp(`const MIN_PASSWORD = ${MIN_PASSWORD};`));
    expect(src).toMatch(new RegExp(`const MAX_PASSWORD = ${MAX_PASSWORD};`));
  });

  test('the blocklists agree, entry for entry', () => {
    const theirs = backendCommonPasswords();
    const ours = COMMON_PASSWORDS;

    const missingHere = [...theirs].filter((p) => !ours.has(p));
    const missingThere = [...ours].filter((p) => !theirs.has(p));

    expect(missingHere, `in the backend list but not the frontend: ${missingHere.join(', ')}`).toEqual([]);
    expect(missingThere, `in the frontend list but not the backend: ${missingThere.join(', ')}`).toEqual([]);
    expect(theirs.size).toBeGreaterThan(40);
  });

  test('every blocklist entry is long enough to ever fire', () => {
    // An entry shorter than the minimum is refused by length first, so it can
    // never be the reason anything is rejected — and a list full of rules that
    // cannot fire is a list nobody audits.
    const tooShort = [...COMMON_PASSWORDS].filter((p) => p.length < MIN_PASSWORD);
    expect(tooShort, `shorter than ${MIN_PASSWORD}: ${tooShort.join(', ')}`).toEqual([]);
  });
});

describe('length', () => {
  test('refuses anything under the minimum', () => {
    expect(passwordProblem('short')).toBeTruthy();
    expect(passwordProblem('a'.repeat(MIN_PASSWORD - 1))).toBeTruthy();
  });

  test('counts down rather than repeating the rule', () => {
    expect(passwordProblem('a'.repeat(MIN_PASSWORD - 3))).toBe('3 more to go.');
  });

  test('says nothing about an empty box or a long-enough one', () => {
    expect(passwordProblem('')).toBeNull();
    expect(passwordProblem('a'.repeat(MIN_PASSWORD))).toBeNull();
    expect(passwordProblem(null)).toBeNull();
  });
});

describe('isWeakPassword', () => {
  test('accepts real passphrases', () => {
    expect(isWeakPassword('purple lantern dockyard')).toBe(false);
    expect(isWeakPassword('correct horse battery staple')).toBe(false);
    expect(isWeakPassword('Tr0ubad0ur-Mist-9241')).toBe(false);
  });

  test('refuses listed common passwords', () => {
    expect(isWeakPassword('administrator')).toBe(true);
    expect(isWeakPassword('welcome123456')).toBe(true);
    expect(isWeakPassword('secretpassword')).toBe(true);
  });

  test('refuses them through the usual character substitutions', () => {
    // `p@ssw0rd` and `password` are the same guess.
    expect(isWeakPassword('p@ssw0rdp@ssw0rd')).toBe(true);
    expect(isWeakPassword('4dministr4tor')).toBe(true);
  });

  test('is case-insensitive', () => {
    expect(isWeakPassword('ADMINISTRATOR')).toBe(true);
    expect(isWeakPassword('AdMiNiStRaToR')).toBe(true);
  });

  test('refuses a short unit repeated to reach the length', () => {
    // Long, varied-looking, and as small a search space as the unit.
    expect(isWeakPassword('abcabcabcabc')).toBe(true);
    expect(isWeakPassword('passwordpassword')).toBe(true);
    expect(isWeakPassword('12341234123412341234')).toBe(true);
  });

  test('refuses one repeated character', () => {
    expect(isWeakPassword('aaaaaaaaaaaa')).toBe(true);
    expect(isWeakPassword('!'.repeat(30))).toBe(true);
  });

  test('refuses straight runs off the keyboard or the alphabet', () => {
    expect(isWeakPassword('abcdefghijkl')).toBe(true);
    expect(isWeakPassword('qwertyuiopasdfghjkl')).toBe(true);
    expect(isWeakPassword('lkjhgfdsapoiuytrewq')).toBe(true);
  });

  test('refuses a password containing the account email', () => {
    expect(isWeakPassword('yousefamr-rides-again', { email: 'yousefamr@example.com' })).toBe(true);
    // A local part too short to be meaningful does not disqualify everything
    // that happens to contain those letters.
    expect(isWeakPassword('a-perfectly-fine-phrase', { email: 'a@example.com' })).toBe(false);
  });

  test('says nothing about an empty value', () => {
    expect(isWeakPassword('')).toBe(false);
    expect(isWeakPassword(null)).toBe(false);
  });
});

describe('passwordChecks', () => {
  test('is undecided before anything is typed', () => {
    // A column of red crosses on an untouched form reads as a list of failures
    // before the reader has done anything wrong.
    const checks = passwordChecks('');
    expect(checks.every((c) => c.met === null)).toBe(true);
  });

  test('ticks length and strength independently', () => {
    const weak = passwordChecks('aaaaaaaaaaaa');
    expect(weak.find((c) => c.id === 'length').met).toBe(true);
    expect(weak.find((c) => c.id === 'strength').met).toBe(false);

    const good = passwordChecks('purple lantern dockyard');
    expect(good.find((c) => c.id === 'length').met).toBe(true);
    expect(good.find((c) => c.id === 'strength').met).toBe(true);
  });

  test('does not judge strength until the length rule is met', () => {
    // "Not a common password" is technically true of `abc` and useless.
    expect(passwordChecks('abc').find((c) => c.id === 'strength').met).toBeNull();
  });

  test('adds the match rule only when there is a confirmation field', () => {
    expect(passwordChecks('purple lantern dockyard').find((c) => c.id === 'match')).toBeUndefined();

    const matching = passwordChecks('purple lantern dockyard', { confirm: 'purple lantern dockyard' });
    expect(matching.find((c) => c.id === 'match').met).toBe(true);

    const mismatched = passwordChecks('purple lantern dockyard', { confirm: 'purple lantern dock' });
    expect(mismatched.find((c) => c.id === 'match').met).toBe(false);
  });
});

describe('passwordStrength', () => {
  test('a too-short or guessable password never reads above the bottom band', () => {
    expect(passwordStrength('abc').score).toBe(1);
    expect(passwordStrength('aaaaaaaaaaaa').score).toBe(1);
    expect(passwordStrength('administrator').score).toBe(1);
  });

  test('length is what moves it', () => {
    const short = passwordStrength('purple lantern');
    const long = passwordStrength('purple lantern dockyard meridian');
    expect(long.score).toBeGreaterThan(short.score);
  });

  test('variety alone cannot make a minimum-length password read as strong', () => {
    // `Aa1!Aa1!Aa1!` has four character classes and is a repeated unit.
    expect(passwordStrength('Aa1!Aa1!Aa1!').score).toBe(1);
  });

  test('it never claims a password is secure', () => {
    const labels = [
      passwordStrength('purple lantern dockyard meridian saffron').label,
      passwordStrength('purple lantern dockyard').label,
      passwordStrength('purple lantern').label,
    ];
    for (const label of labels) {
      expect(label.toLowerCase()).not.toContain('secure');
      expect(label.toLowerCase()).not.toContain('safe');
    }
  });

  test('an empty box has no band at all', () => {
    expect(passwordStrength('')).toEqual({ score: 0, label: '', id: 'none' });
  });
});
