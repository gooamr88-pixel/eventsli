/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT COUNTS AS A PASSWORD — stated once, for the four screens that ask.
 *
 * Sign-up, organizer sign-up, the reset form and the change-password panel each
 * carried their own `const MIN_PASSWORD = 12`, their own "At least 12
 * characters" hint and their own countdown message. Four copies of one rule
 * that the API is the actual authority on.
 *
 * Four copies do not drift while nobody touches them. They drift on the day the
 * API raises the minimum — and the failure is quiet and unpleasant: the form
 * accepts what it believes is fine, the server refuses it, and somebody is told
 * their password is wrong on the screen where they are choosing it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS FILE IS A MIRROR. `backend/utils/passwordPolicy.js` IS THE AUTHORITY.
 *
 * Every rule below also runs on the server, and the server's answer is the one
 * that decides. What this file buys is the difference between finding out while
 * you type and finding out after you press the button — nothing more. A
 * password that passes here and fails there is a bug in this file, not a way
 * in; a password that fails here can still be submitted by anything that is not
 * this form, and the server refuses it identically.
 *
 * `test/passwordPolicy.test.js` reads the backend module off disk and fails if
 * the two blocklists or the two length bounds disagree — the same guard
 * `errorCodes.test.js` puts on the error table, for the same reason: two copies
 * of one rule, in two languages, in two deploys.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const MIN_PASSWORD = 12;
export const MAX_PASSWORD = 200;

/** The hint under the field. One sentence, the same on every screen. */
export const PASSWORD_HINT = `At least ${MIN_PASSWORD} characters. A short phrase works well.`;

/**
 * Common passwords that are twelve characters or longer.
 *
 * Mirrors `COMMON_PASSWORDS` in the backend module, entry for entry — the
 * parity test is what keeps that true. Shorter classics are absent on purpose:
 * `MIN_PASSWORD` refuses them first, and an entry that can never fire is one
 * nobody trusts.
 */
export const COMMON_PASSWORDS = new Set([
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

const SEQUENCES = [
  'abcdefghijklmnopqrstuvwxyz',
  '01234567890',
  'qwertyuiopasdfghjklzxcvbnm',
  'qwertyuiop',
  'asdfghjkl',
  'zxcvbnm',
];

/** `p@ssw0rd` and `password` are the same guess. Mirrors the backend fold. */
function foldLeet(value) {
  return value
    .replace(/[4@]/g, 'a')
    .replace(/[3€]/g, 'e')
    .replace(/[1!|]/g, 'i')
    .replace(/0/g, 'o')
    .replace(/[5$]/g, 's')
    .replace(/7/g, 't')
    .replace(/8/g, 'b');
}

function isSingleCharacter(value) {
  return value.length > 0 && new Set(value).size === 1;
}

/** `abcabcabcabc`, `passwordpassword` — long, varied-looking, and as small a
 *  search space as the unit it repeats. */
function isRepeatedUnit(value) {
  for (let size = 1; size <= Math.floor(value.length / 2); size += 1) {
    if (value.length % size !== 0) continue;
    if (value.slice(0, size).repeat(value.length / size) === value) return true;
  }
  return false;
}

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
 * Is this one of the guesses an attacker makes first?
 *
 * Mirrors `checkPassword`'s blocklist and shape rules. Length is NOT checked
 * here — `passwordProblem` owns that, so the two can be shown as two separate
 * requirements rather than one combined verdict.
 *
 * @param {string} value
 * @param {{ email?: string }} [context]
 */
export function isWeakPassword(value, context = {}) {
  const raw = String(value || '');
  if (!raw) return false;

  const lower = raw.toLowerCase().trim();
  if (isSingleCharacter(lower)) return true;
  if (isRepeatedUnit(lower)) return true;
  if (isSequential(lower)) return true;
  if (COMMON_PASSWORDS.has(lower)) return true;
  if (COMMON_PASSWORDS.has(foldLeet(lower))) return true;

  const local = String(context.email || '').split('@')[0].toLowerCase();
  if (local.length >= 4 && lower.includes(local)) return true;

  return false;
}

/**
 * What to say while it is too short, or `null` when it is fine.
 *
 * Counts DOWN rather than repeating the rule: somebody who has typed nine
 * characters already knows the minimum is twelve — what they want to know is
 * that three more will do it.
 */
export function passwordProblem(value) {
  const length = String(value || '').length;
  if (length === 0 || length >= MIN_PASSWORD) return null;
  const missing = MIN_PASSWORD - length;
  return `${missing} more to go.`;
}

/**
 * The requirement checklist, as data.
 *
 * Returned rather than rendered so the component draws it and the test asserts
 * it. `met` is `null` before anything is typed — an empty form showing a column
 * of red crosses reads as a list of failures before the reader has done
 * anything wrong.
 *
 * @param {string} value
 * @param {{ email?: string, confirm?: string|null }} [context]
 */
export function passwordChecks(value, context = {}) {
  const raw = String(value || '');
  const typed = raw.length > 0;
  const { confirm } = context;

  const checks = [
    {
      id: 'length',
      label: `At least ${MIN_PASSWORD} characters`,
      met: typed ? raw.length >= MIN_PASSWORD : null,
    },
    {
      id: 'strength',
      label: 'Not a commonly used password',
      // Only meaningful once it is long enough to be judged — saying "not
      // common" about `abc` is technically true and useless.
      met: typed && raw.length >= MIN_PASSWORD ? !isWeakPassword(raw, context) : null,
    },
  ];

  // Only when there is a confirmation field on screen.
  if (confirm !== undefined && confirm !== null) {
    checks.push({
      id: 'match',
      label: 'Both entries match',
      met: typed || confirm.length > 0 ? raw === confirm && typed : null,
    });
  }

  return checks;
}

/**
 * A 0–4 score and a word for it.
 *
 * DELIBERATELY COARSE, and deliberately not presented as a guarantee. Real
 * strength estimation needs a dictionary and a model of what people actually
 * choose; anything that fits in this file is a rough proxy for length and
 * variety. So the meter is labelled by BAND, it never says "secure", and the
 * server's blocklist — not this number — is what can refuse a password.
 *
 * Length dominates because length is what actually costs an attacker. Variety
 * contributes at all only past the minimum, so `Aa1!Aa1!Aa1!` does not read
 * as strong for having four character classes in twelve repeated characters.
 */
export function passwordStrength(value, context = {}) {
  const raw = String(value || '');
  if (!raw) return { score: 0, label: '', id: 'none' };

  if (raw.length < MIN_PASSWORD) return { score: 1, label: 'Too short', id: 'short' };
  if (isWeakPassword(raw, context)) return { score: 1, label: 'Too easy to guess', id: 'weak' };

  let score = 2;
  if (raw.length >= 16) score += 1;
  if (raw.length >= 24) score += 1;

  // One step for variety, and only one: it is a tiebreaker, not the measure.
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z0-9]/].filter((re) => re.test(raw)).length;
  if (classes >= 3 && score < 4) score += 1;

  const LABELS = { 2: 'Fair', 3: 'Good', 4: 'Strong' };
  return { score, label: LABELS[score] || 'Fair', id: LABELS[score]?.toLowerCase() || 'fair' };
}
