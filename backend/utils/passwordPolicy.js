/**
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT COUNTS AS A PASSWORD. The authority is here; the browser mirrors it.
 *
 * The policy is NIST SP 800-63B's shape rather than the older complexity one:
 * length carries the strength, and a blocklist removes the guesses an attacker
 * actually makes first. There is deliberately no "one uppercase, one digit, one
 * symbol" rule — it pushes people to `Password1!`, which is on every list ever
 * leaked, and it rejects `correct horse battery staple`, which is not.
 *
 *   MIN 12   the floor. Under it, an offline attack on a stolen hash is
 *            cheap regardless of what else the string contains.
 *   MAX 200  generous on purpose. The hash does not care how long the input
 *            is, and a ceiling that a passphrase can hit is a ceiling that
 *            teaches people to use short passwords. It exists only so an
 *            accidental paste of a megabyte is refused before it is hashed.
 *
 * WHY A LIST AND A SET OF SHAPES, NOT JUST A LIST. A blocklist of literal
 * strings is worth having and is worth very little on its own: the minimum is
 * already 12, so every short classic (`password`, `qwerty`, `123456`) is
 * refused by length before it gets here, and what remains are the 12+ ones —
 * `passwordpassword`, `qwertyuiopasdf`, `123456789012`. Those follow a handful
 * of SHAPES, and testing the shape catches the thousand variants nobody typed
 * into this file. Both run.
 *
 * WHAT THE REFUSAL SAYS. "This password is too easy to guess — try a longer
 * phrase." It does not say which rule fired, because naming the rule tells
 * somebody working through a list exactly which mutation to try next. It also
 * never echoes the password: see `describe` below, which takes no input.
 *
 * NOTHING HERE HASHES, STORES OR LOGS. This module answers one question about
 * a string and holds no state. The password never leaves the request that
 * carried it.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const MIN_PASSWORD = 12;
const MAX_PASSWORD = 200;

/**
 * Common passwords that are twelve characters or longer.
 *
 * Shorter ones are not listed and must not be added: `MIN_PASSWORD` already
 * refuses them, and a list whose entries can never fire is a list nobody
 * trusts. Entries are lowercase; matching lowercases the candidate.
 *
 * Drawn from the 12+ entries of the public breach compilations (rockyou,
 * SecLists' 10-million, the HIBP top slice). It is a floor, not a survey — the
 * shape rules below are what generalise.
 */
const COMMON_PASSWORDS = new Set([
  'passwordpassword', 'password1234', 'password12345', 'password123456',
  'passw0rdpassw0rd', 'password1111', 'password@123', 'password!234',
  '123456789012', '1234567890123', '12345678901234', '1234567890123456',
  '111111111111', '000000000000', '121212121212', '123123123123',
  'qwertyuiopas', 'qwertyuiopasdf', 'qwertyuiop123', 'qwerty123456',
  'qwertyuiop[]', 'asdfghjklasdf', 'zxcvbnmzxcvbn', '1q2w3e4r5t6y',
  'abcdefghijkl', 'abcdefghijklm', 'abcd1234abcd', 'aaaaaaaaaaaa',
  'letmein123456', 'letmeinletmein', 'iloveyou1234', 'iloveyouiloveyou',
  'trustno1trustno1', 'welcome123456', 'welcomewelcome', 'admin1234567',
  'administrator', 'administrator1', 'superman1234', 'batman123456',
  'football1234', 'baseball1234', 'basketball12', 'sunshine1234',
  'princess1234', 'michael12345', 'jennifer1234', 'jordan123456',
  'monkey123456', 'dragon123456', 'master123456', 'shadow123456',
  'changeme1234', 'changemenow1', 'temppassword', 'temporary123',
  'newpassword1', 'mypassword123', 'secretpassword', 'notapassword',
  'thisisapassword', 'whatisthisfor', 'idontknowit1',
  'eventsli1234', 'eventslievents', 'ticketticket1',
]);

/** Keyboard runs and alphabet/number runs, forwards. Reversed is checked too. */
const SEQUENCES = [
  'abcdefghijklmnopqrstuvwxyz',
  '01234567890',
  'qwertyuiopasdfghjklzxcvbnm',
  'qwertyuiop',
  'asdfghjkl',
  'zxcvbnm',
];

/**
 * `p@ssw0rd` and `password` are the same guess.
 *
 * Folding the usual substitutions means one list entry covers the family. It is
 * applied ONLY when testing against the blocklist — never to anything stored,
 * because this is a lossy transform and the real password is untouched.
 */
function foldLeet(value) {
  return value
    .replace(/[4@]/g, 'a')
    .replace(/[3€]/g, 'e')
    .replace(/[1!|]/g, 'i')
    .replace(/0/g, 'o')
    .replace(/[5$]/g, 's')
    .replace(/7/g, 't')
    .replace(/[8]/g, 'b');
}

/** True when the whole string is one character repeated. */
function isSingleCharacter(value) {
  return value.length > 0 && new Set(value).size === 1;
}

/**
 * True when the string is a short unit repeated to reach the length —
 * `abcabcabcabc`, `passwordpassword`, `12341234123412`.
 *
 * This is the shape that most often sneaks past a length rule: it is long, it
 * looks varied, and its search space is the space of the unit.
 */
function isRepeatedUnit(value) {
  for (let size = 1; size <= Math.floor(value.length / 2); size += 1) {
    if (value.length % size !== 0) continue;
    const unit = value.slice(0, size);
    if (unit.repeat(value.length / size) === value) return true;
  }
  return false;
}

/** True when the string is a straight run off a keyboard row or the alphabet. */
function isSequential(value) {
  if (value.length < 6) return false;
  const reversed = [...value].reverse().join('');
  return SEQUENCES.some((run) => {
    const back = [...run].reverse().join('');
    return run.includes(value) || back.includes(value)
      || run.includes(reversed) || back.includes(reversed);
  });
}

/**
 * Is this password unusable, and why — for the SERVER's own reasoning only.
 *
 * The reason is returned so a test can assert which rule fired. It is never
 * sent to a client: `message` below is one sentence for every case.
 *
 * @param {string} password
 * @param {{ email?: string, name?: string }} [context] values the account
 *   already carries. A password that contains the address it protects is not a
 *   secret from anyone who knows the address.
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
function checkPassword(password, context = {}) {
  if (typeof password !== 'string') return { ok: false, reason: 'type' };

  // Length is measured on the RAW string, before any folding, because that is
  // what gets hashed.
  if (password.length < MIN_PASSWORD) return { ok: false, reason: 'short' };
  if (password.length > MAX_PASSWORD) return { ok: false, reason: 'long' };

  const lower = password.toLowerCase().trim();

  if (isSingleCharacter(lower)) return { ok: false, reason: 'single' };
  if (isRepeatedUnit(lower)) return { ok: false, reason: 'repeated' };
  if (isSequential(lower)) return { ok: false, reason: 'sequential' };

  if (COMMON_PASSWORDS.has(lower)) return { ok: false, reason: 'common' };
  if (COMMON_PASSWORDS.has(foldLeet(lower))) return { ok: false, reason: 'common' };

  // The local part of the email, when it is long enough to be meaningful.
  const local = String(context.email || '').split('@')[0].toLowerCase();
  if (local.length >= 4 && lower.includes(local)) return { ok: false, reason: 'email' };

  return { ok: true };
}

/**
 * The one sentence a client is told, whichever rule fired.
 *
 * Deliberately uniform. "Your password may not contain your email address"
 * confirms to somebody enumerating that they guessed the address; "that is a
 * known common password" tells them to try the next entry on their list. It
 * also takes NO ARGUMENTS, so there is no path by which the submitted password
 * could be reflected back in an error.
 */
const TOO_WEAK_MESSAGE = 'That password is too easy to guess. Use a longer phrase that is not a common password.';

const LENGTH_MESSAGE = `Use at least ${MIN_PASSWORD} characters — a short phrase works well.`;

module.exports = {
  MIN_PASSWORD,
  MAX_PASSWORD,
  COMMON_PASSWORDS,
  checkPassword,
  isRepeatedUnit,
  isSequential,
  isSingleCharacter,
  foldLeet,
  TOO_WEAK_MESSAGE,
  LENGTH_MESSAGE,
};
