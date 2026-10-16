const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * REGRESSION (2026-10-16) — a regex bound Postgres cannot compile, twice.
 *
 * `{3,2000}` in a CHECK is accepted by CREATE TABLE and fails on the first
 * INSERT ("invalid repetition count(s)"): Postgres caps a bound at 255. It was
 * fixed on `sponsors` on 2026-09-16 and copied into `event_media` and
 * `event_sponsors` the next day, where it made every gallery save a 500.
 *
 * A static check, because nothing else sees it until a row is written. A
 * migration that is later superseded may keep its original text; what matters
 * is that the newest definition of each constraint is valid, so this checks
 * the files written from now on and the ones known to be corrected.
 */
const DIR = path.join(__dirname, '..', '..', 'supabase', 'migrations');
// Their broken bounds are replaced by these later migrations.
const SUPERSEDED = new Map([
  ['20260916100000_storefront_cms.sql', '20260916110000_fix_sponsor_link_check.sql'],
  ['20260917120000_general_admission_and_event_content.sql', '20261016090000_fix_event_media_and_sponsor_url_checks.sql'],
]);

function oversizedBounds(sql) {
  const code = sql.replace(/--[^\n]*/g, ''); // comments quote the bug on purpose
  const found = [];
  // Any {n}, {n,} or {n,m} inside a single-quoted literal that a regex operator reads.
  for (const [, literal] of code.matchAll(/(?:~\*?|!~\*?|SIMILAR TO|regexp_\w+\([^,]*,)\s*'((?:[^']|'')*)'/gi)) {
    for (const [whole, a, b] of literal.matchAll(/\{(\d+)(?:,(\d*))?\}/g)) {
      if (Number(a) > 255 || (b && Number(b) > 255)) found.push(whole);
    }
  }
  return found;
}

test('the detector catches the bound that broke the gallery', () => {
  assert.deepEqual(oversizedBounds("CHECK (url ~* '^https?://[^[:space:]]{3,2000}$')"), ['{3,2000}']);
  assert.deepEqual(oversizedBounds("CHECK (url ~* '^https?://[^[:space:]]+$' AND length(url) <= 2000)"), []);
  assert.deepEqual(oversizedBounds("CHECK (code ~ '^[A-Z]{2}$')"), []);
});

test('no migration uses a regex repetition bound Postgres cannot compile (max 255)', () => {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql'));
  for (const [broken, fix] of SUPERSEDED) {
    assert.ok(files.includes(fix), `${broken} is only exempt because ${fix} corrects it`);
  }
  const offenders = files
    .filter((f) => !SUPERSEDED.has(f))
    .map((f) => [f, oversizedBounds(fs.readFileSync(path.join(DIR, f), 'utf8'))])
    .filter(([, bad]) => bad.length);
  assert.deepEqual(offenders, []);
});
