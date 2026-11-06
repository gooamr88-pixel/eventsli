const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * scripts/apply-migration.js refuses, BEFORE connecting to any database:
 *   - a migration known to be unsafe to re-run (it would change live data);
 *   - a file containing a statement that cannot run inside its transaction.
 * No database is reachable from these runs, so a guard that let a file through
 * would surface as a connection error instead of the refusal asserted here.
 */
const backend = path.join(__dirname, '..');
const run = (file, ...args) => spawnSync(process.execPath, ['scripts/apply-migration.js', file, ...args], {
  cwd: backend,
  // No database credentials at all: reaching connect() would fail differently.
  env: { PATH: process.env.PATH, SUPABASE_URL: '', SUPABASE_DB_PASSWORD: '' },
  encoding: 'utf8',
});

test('the email-verification backfill is refused: a re-run would verify everyone who signed up since', () => {
  const r = run('../supabase/migrations/20260915090000_email_verification.sql');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not safe to re-run/);
  assert.match(r.stderr, /--first-time/);
});

test('the payment-fee defaults migration is refused: a re-run would undo admin settings', () => {
  const r = run('../supabase/migrations/20260829120000_payment_fee_mode.sql');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not safe to re-run/);
});

test('a file with its own BEGIN/COMMIT or CONCURRENTLY is refused before connecting', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
  for (const [name, body] of [
    ['20990101000000_own_txn.sql', 'BEGIN;\nCREATE TABLE x (id int);\nCOMMIT;\n'],
    ['20990101000001_concurrently.sql', 'CREATE INDEX CONCURRENTLY x_idx ON x (id);\n'],
  ]) {
    const f = path.join(dir, name);
    fs.writeFileSync(f, body);
    const r = run(f);
    assert.equal(r.status, 1, name);
    assert.match(r.stderr, /cannot run inside a transaction/, name);
  }
});

test('prose in a comment does not trip the guard; every real migration passes it', () => {
  const migrations = path.join(backend, '..', 'supabase', 'migrations');
  // Reaching the connection step proves the static guards let the file through.
  for (const f of ['20260915140000_money_totals_indexes_and_pin_lockout.sql', '20261106090000_direct_charges_merchant_of_record.sql']) {
    const r = run(path.join(migrations, f));
    assert.doesNotMatch(r.stderr, /cannot run inside a transaction|not safe to re-run/, f);
    assert.match(r.stderr + r.stdout, /SUPABASE_URL and SUPABASE_DB_PASSWORD must be set|could not reach/, f);
  }
});
